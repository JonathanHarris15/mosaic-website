const { test } = require('node:test');
const assert = require('node:assert');

// The Roles Manager page (MS-120). The surface, not the model: RolesCore owns
// Role Definitions, slots, restrictions, validation, and the locked liturgical
// registry, and this page renders and persists what it says.
//
// What is pinned here is what the page itself decides — who may open it, what
// reaches Firestore and what is refused before it does, and above all that the
// Relationship Type query is CONSTRAINED to shared Types (ADR-0017): an
// unconstrained one does not return fewer rows, it errors, and the error looks
// exactly like "this church has no relationship types".
//
// The Alpine template is not covered; it needs a real page.

// ── An in-memory Firestore that remembers how it was queried ─────────────────

function fakeDb(seed = {}, { deny = [], failWrites = false } = {}) {
    const data = JSON.parse(JSON.stringify(seed));
    const queries = [];
    let n = 1;
    const coll = name => (data[name] = data[name] || {});
    const docsOf = name => Object.entries(coll(name)).map(([id, d]) => ({ id, data: () => d }));

    function query(name, filters) {
        return {
            where: (field, op, value) => query(name, filters.concat([{ field, op, value }])),
            orderBy: () => query(name, filters),
            get: async () => {
                queries.push({ collection: name, filters });
                if (deny.includes(name)) {
                    const e = new Error('Missing or insufficient permissions.');
                    e.code = 'permission-denied';
                    throw e;
                }
                // Firestore fails a list query outright when a returned document
                // would fail its read rule — it does NOT quietly return fewer
                // rows. The shared-records rule is modelled here so an
                // unconstrained relationship query blows up in the test exactly
                // as it would in production.
                const rows = docsOf(name).filter(doc => filters.every(f => doc.data()[f.field] === f.value));
                if (name === 'relationship_types' && rows.some(doc => doc.data().sharedWithEditors !== true)) {
                    const e = new Error('Missing or insufficient permissions.');
                    e.code = 'permission-denied';
                    throw e;
                }
                return { docs: rows, empty: rows.length === 0 };
            },
        };
    }

    let failing = failWrites;
    const guard = fn => async (...args) => {
        if (failing) throw new Error('network down');
        return fn(...args);
    };

    return {
        _data: data,
        _queries: queries,
        // Flip mid-test to model a write that fails after the user has typed.
        _failWritesFromNowOn() { failing = true; },
        collection(name) {
            return Object.assign(query(name, []), {
                add: guard(doc => {
                    const id = 'new' + (n++);
                    coll(name)[id] = JSON.parse(JSON.stringify(doc));
                    return { id };
                }),
                doc: id => ({
                    set: guard(doc => { coll(name)[id] = JSON.parse(JSON.stringify(doc)); }),
                    update: guard(patch => { coll(name)[id] = { ...coll(name)[id], ...patch }; }),
                    delete: guard(() => { delete coll(name)[id]; }),
                }),
            });
        },
    };
}

global.window = global;
const Roles = require('../public/roles-core.js');
require('../public/relationship-core.js');
require('../public/roles-manager.js');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const KIDS_CLEARED = 'tag_kids';
const SABBATICAL = 'tag_sabbatical';

const TAGS = {
    [KIDS_CLEARED]: { name: 'Kids Cleared' },
    [SABBATICAL]: { name: 'On Sabbatical' },
};

const MARRIAGE = { name: 'Marriage', kind: 'pairwise', priority: false, sharedWithEditors: true };
const DISCIPLESHIP = { name: 'Discipleship', kind: 'pairwise', priority: true, sharedWithEditors: false };
const HOUSE_GROUP = { name: 'House Group', kind: 'group', priority: true, sharedWithEditors: true };

const kidsDefinition = () => ({
    name: 'Kids Ministry',
    slug: 'kids_ministry',
    family: Roles.FAMILIES.SERVANT,
    slots: [
        { id: 's1', requirement: Roles.REQUIREMENTS.FEMALE },
        { id: 's2', requirement: Roles.REQUIREMENTS.EITHER },
        { id: 's3', requirement: Roles.REQUIREMENTS.EITHER },
    ],
    restrictions: [],
});

const coffeeDefinition = () => ({
    name: 'Coffee',
    slug: 'coffee',
    family: Roles.FAMILIES.SERVANT,
    slots: [{ id: 's1', requirement: Roles.REQUIREMENTS.EITHER }],
    restrictions: [],
});

// Mount the page against a seeded store and run its loads, as init() does once
// the permission gate has passed.
async function mountPage(seed = {}, { deny = [], confirmAnswer = true } = {}) {
    global.db = fakeDb({ people_tags: TAGS, ...seed }, { deny });
    global.confirm = () => confirmAnswer;
    const page = window.RolesManager();
    await page.loadEverything();
    return page;
}

const stored = name => global.db._data[name] || {};
const queriesFor = name => global.db._queries.filter(q => q.collection === name);

// ── Who may open the page (MS-135) ───────────────────────────────────────────

test('the Roles Manager is an editor+ surface', () => {
    const page = window.RolesManager();
    for (const level of ['editor', 'elder', 'admin', 'super_admin']) {
        assert.equal(page.mayManageRoles(level), true, level + ' should reach the Roles Manager');
    }
    for (const level of ['viewer', 'member', null, undefined, 'nonsense']) {
        assert.equal(page.mayManageRoles(level), false, String(level) + ' must not reach the Roles Manager');
    }
});

// ── The one roles list (MS-136) ──────────────────────────────────────────────

test('liturgical Roles lead the list in their canonical order, servant Roles follow', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition(), r2: coffeeDefinition() } });
    const slugs = page.roles.map(r => r.slug);
    assert.deepStrictEqual(slugs.slice(0, Roles.LITURGICAL_SLUGS.length), Roles.LITURGICAL_SLUGS.slice());
    assert.deepStrictEqual(slugs.slice(Roles.LITURGICAL_SLUGS.length).sort(), ['coffee', 'kids_ministry']);
});

test('liturgical Roles come from code and are never fetched', async () => {
    await mountPage({ roles: { r1: kidsDefinition() } });
    assert.equal(queriesFor('roles').length, 1, 'the servant definitions are read once');
    assert.equal(Object.keys(stored('roles')).length, 1, 'nothing liturgical is written to /roles');
});

test('every liturgical Role reads as locked and every Servant Role as editable', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    for (const role of page.roles) {
        assert.equal(
            Roles.isLocked(role),
            role.family === Roles.FAMILIES.LITURGICAL,
            role.slug + ' has the wrong locked state'
        );
    }
});

test('a Servant Role reports how many people it needs', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    const kids = page.roles.find(r => r.slug === 'kids_ministry');
    assert.equal(page.peopleNeeded(kids), 3);
});

test('with no Servant Roles defined the page invites the user to create one', async () => {
    const page = await mountPage({ roles: {} });
    assert.equal(page.hasServantRoles, false);
    const withOne = await mountPage({ roles: { r1: coffeeDefinition() } });
    assert.equal(withOne.hasServantRoles, true);
});

test('a stored definition that would take a liturgical slug is quarantined, not fatal', async () => {
    // /roles is editor-writable, so a hand-edited document can arrive claiming a
    // liturgical slug. allRoles rightly throws on that; the page must still open.
    const page = await mountPage({
        roles: {
            bad: { name: 'Preacher', slug: 'preacher', family: Roles.FAMILIES.SERVANT, slots: [{ id: 's1', requirement: 'either' }], restrictions: [] },
            r1: coffeeDefinition(),
        },
    });
    assert.deepStrictEqual(page.roles.filter(r => r.family === Roles.FAMILIES.SERVANT).map(r => r.slug), ['coffee']);
    assert.equal(page.conflictingDefinitions.length, 1);
    assert.equal(page.conflictingDefinitions[0].slug, 'preacher');
});

// ── Create, rename, delete (MS-137) ──────────────────────────────────────────

test('a new Role starts from RolesCore.newDefinition — one either-slot, valid at once', async () => {
    const page = await mountPage({ roles: {} });
    await page.createRole('Setup Team');
    const written = Object.values(stored('roles'));
    assert.equal(written.length, 1);
    assert.deepStrictEqual(written[0].slots, [{ id: 's1', requirement: Roles.REQUIREMENTS.EITHER }]);
    assert.equal(written[0].slug, 'setup_team');
    assert.equal(Roles.validateDefinition(written[0]).valid, true);
});

test('naming a Role after a liturgical Role is refused before anything is written', async () => {
    const page = await mountPage({ roles: {} });
    await page.createRole('Preacher');
    assert.deepStrictEqual(stored('roles'), {}, 'nothing may reach Firestore');
    assert.ok(page.toast.message.length, 'the refusal is explained');
    assert.match(page.toast.message, /Preacher|liturgical/i);
    assert.equal(page.toast.type, 'error');
});

test('a name that collides with an existing Servant Role slug is refused', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    await page.createRole('kids ministry');
    assert.equal(Object.keys(stored('roles')).length, 1);
    assert.equal(page.toast.type, 'error');
});

test('an unnamed Role is refused', async () => {
    const page = await mountPage({ roles: {} });
    await page.createRole('   ');
    assert.deepStrictEqual(stored('roles'), {});
});

test('renaming changes the display name and leaves the slug — serve history stays attached', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.name = 'Kids Team';
    await page.saveDraft();
    assert.equal(stored('roles').r1.name, 'Kids Team');
    assert.equal(stored('roles').r1.slug, 'kids_ministry', 'the slug is fixed at creation');
});

test('deleting confirms, says the serve history is kept, and removes only the definition', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    const asked = [];
    global.confirm = message => { asked.push(message); return true; };
    await page.deleteRole(page.roles.find(r => r.slug === 'kids_ministry'));
    assert.equal(asked.length, 1);
    assert.match(asked[0], /serv(ing|e)/i, 'the warning names what is kept');
    assert.match(asked[0], /kept|keep|stay/i);
    assert.deepStrictEqual(stored('roles'), {});
});

test('declining the delete confirmation leaves the Role alone', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } }, { confirmAnswer: false });
    await page.deleteRole(page.roles.find(r => r.slug === 'kids_ministry'));
    assert.equal(Object.keys(stored('roles')).length, 1);
});

test('a locked liturgical Role can be neither edited nor deleted, even if a control is reached', async () => {
    const page = await mountPage({ roles: {} });
    const preacher = page.roles.find(r => r.slug === 'preacher');
    page.startEdit(preacher);
    assert.equal(page.draft, null, 'no draft opens for a locked Role');
    await page.deleteRole(preacher);
    assert.deepStrictEqual(stored('roles'), {});
    assert.equal(page.toast.type, 'error');
});

test('an invalid definition never reaches Firestore, and every problem is reported at once', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.name = '';
    page.draft.slots = [];
    await page.saveDraft();
    assert.equal(stored('roles').r1.name, 'Kids Ministry', 'the stored Role is untouched');
    assert.ok(page.draftErrors.length >= 2, 'the name AND the missing slot are both reported');
    assert.ok(page.draftErrors.some(e => /name/i.test(e)));
    assert.ok(page.draftErrors.some(e => /slot/i.test(e)));
});

test('a failed write leaves the on-screen list matching what is actually stored', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.name = 'Kids Team';
    // The write fails after the user has already typed the new name.
    global.db._failWritesFromNowOn();
    await page.saveDraft();
    assert.equal(page.roleDefinitions.find(d => d.id === 'r1').name, 'Kids Ministry',
        'the list re-reads from the store rather than showing an unsaved name');
    assert.equal(stored('roles').r1.name, 'Kids Ministry');
    assert.equal(page.toast.type, 'error');
});

// ── The slot editor (MS-138) ─────────────────────────────────────────────────

test('slots can be added, removed, and given a requirement', async () => {
    const page = await mountPage({ roles: { r1: coffeeDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.addSlot();
    page.addSlot();
    assert.equal(page.draftPeopleNeeded, 3);
    page.setSlotRequirement('s2', Roles.REQUIREMENTS.MALE);
    assert.equal(page.draft.slots[1].requirement, 'male');
    page.removeSlot('s2');
    assert.deepStrictEqual(page.draft.slots.map(s => s.id), ['s1', 's3'],
        'ids are never re-issued — an assignment points at a specific slot');
    assert.equal(page.draftPeopleNeeded, 2);
});

test('reordering changes only the order — identity and requirement travel with the slot', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.moveSlot(0, 2);
    assert.deepStrictEqual(page.draft.slots, [
        { id: 's2', requirement: 'either' },
        { id: 's3', requirement: 'either' },
        { id: 's1', requirement: 'female' },
    ]);
});

test('removing the last slot is refused — a Role with no slots is invalid', async () => {
    const page = await mountPage({ roles: { r1: coffeeDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.removeSlot('s1');
    assert.equal(page.draft.slots.length, 1, 'the only slot survives');
    assert.equal(page.toast.type, 'error');
    assert.match(page.toast.message, /slot/i);
});

test('cancelling an edit restores the definition as stored, with nothing partial written', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.name = 'Renamed';
    page.addSlot();
    page.cancelEdit();
    assert.equal(page.draft, null);
    assert.deepStrictEqual(stored('roles').r1, kidsDefinition());
    assert.deepStrictEqual(page.roleDefinitions.find(d => d.id === 'r1').slots, kidsDefinition().slots);
});

test('editing a draft never mutates the stored definition until it is saved', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.setSlotRequirement('s2', Roles.REQUIREMENTS.MALE);
    assert.equal(page.roleDefinitions.find(d => d.id === 'r1').slots[1].requirement, 'either');
    assert.equal(stored('roles').r1.slots[1].requirement, 'either');
});

// ── Tag restriction rules (MS-139) ───────────────────────────────────────────

test('a Role can require a Tag and exclude a Tag, and both survive a save', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.addTagRule(Roles.RESTRICTIONS.REQUIRE_TAG, KIDS_CLEARED);
    page.addTagRule(Roles.RESTRICTIONS.EXCLUDE_TAG, SABBATICAL);
    await page.saveDraft();
    assert.deepStrictEqual(stored('roles').r1.restrictions, [
        { kind: 'requireTag', tagId: KIDS_CLEARED },
        { kind: 'excludeTag', tagId: SABBATICAL },
    ]);
});

test('Tags are offered from the church\'s own Tags, not typed free-hand', async () => {
    const page = await mountPage({ roles: {} });
    assert.deepStrictEqual(
        page.shepherdingTags.map(t => t.id).sort(),
        [KIDS_CLEARED, SABBATICAL].sort()
    );
    const page2 = await mountPage({ roles: { r1: kidsDefinition() } });
    page2.startEdit(page2.roleDefinitions.find(d => d.id === 'r1'));
    page2.addTagRule(Roles.RESTRICTIONS.REQUIRE_TAG, 'a_tag_that_does_not_exist');
    assert.equal(page2.draft.restrictions.length, 0, 'an unknown tag id is not accepted');
});

test('a rule can be removed', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.addTagRule(Roles.RESTRICTIONS.REQUIRE_TAG, KIDS_CLEARED);
    page.addTagRule(Roles.RESTRICTIONS.EXCLUDE_TAG, SABBATICAL);
    page.removeRule(0);
    await page.saveDraft();
    assert.deepStrictEqual(stored('roles').r1.restrictions, [{ kind: 'excludeTag', tagId: SABBATICAL }]);
});

test('the same Tag rule cannot be added twice', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.addTagRule(Roles.RESTRICTIONS.REQUIRE_TAG, KIDS_CLEARED);
    page.addTagRule(Roles.RESTRICTIONS.REQUIRE_TAG, KIDS_CLEARED);
    assert.equal(page.draft.restrictions.length, 1);
});

test('each rule reads as a sentence a non-technical user can check', async () => {
    const page = await mountPage({ roles: {}, relationship_types: { t1: MARRIAGE } });
    assert.match(page.ruleSentence({ kind: 'requireTag', tagId: KIDS_CLEARED }), /Kids Cleared/);
    assert.match(page.ruleSentence({ kind: 'requireTag', tagId: KIDS_CLEARED }), /must/i);
    assert.match(page.ruleSentence({ kind: 'excludeTag', tagId: SABBATICAL }), /On Sabbatical/);
    assert.match(page.ruleSentence({ kind: 'notTogether', typeId: 't1' }), /Marriage/);
    // No raw field names leak into the sentence.
    assert.doesNotMatch(page.ruleSentence({ kind: 'requireTag', tagId: KIDS_CLEARED }), /tagId|requireTag/);
});

test('saved Tag rules round-trip and the eligibility engine reads them untranslated', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.addTagRule(Roles.RESTRICTIONS.REQUIRE_TAG, KIDS_CLEARED);
    await page.saveDraft();

    const reopened = await mountPage({ roles: stored('roles') });
    const def = reopened.roleDefinitions.find(d => d.id === 'r1');
    assert.deepStrictEqual(def.restrictions, [{ kind: 'requireTag', tagId: KIDS_CLEARED }]);

    const verdicts = Roles.candidatesFor(def, def.slots[1], {
        people: [
            { id: 'ann', sex: 'female', tags: [KIDS_CLEARED] },
            { id: 'ben', sex: 'male', tags: [] },
        ],
        assigned: [],
    });
    assert.equal(verdicts.find(v => v.personId === 'ann').eligible, true);
    assert.equal(verdicts.find(v => v.personId === 'ben').eligible, false);
    assert.equal(verdicts.find(v => v.personId === 'ben').reason, Roles.REASONS.MISSING_REQUIRED_TAG);
});

// ── Relationship restriction rules (MS-140) ──────────────────────────────────

test('the Relationship Type query is constrained to shared Types', async () => {
    await mountPage({ relationship_types: { t1: MARRIAGE, t2: DISCIPLESHIP } });
    const q = queriesFor('relationship_types');
    assert.equal(q.length, 1);
    assert.ok(
        q[0].filters.some(f => f.field === 'sharedWithEditors' && f.op === '==' && f.value === true),
        'an unconstrained query errors outright — it does not return fewer rows'
    );
});

test('only Shared Relationship Types are offered, and an unshared one is nowhere on the page', async () => {
    const page = await mountPage({ relationship_types: { t1: MARRIAGE, t2: DISCIPLESHIP } });
    assert.deepStrictEqual(page.sharedRelationshipTypes.map(t => t.id), ['t1']);
    assert.deepStrictEqual(page.relationshipRuleOptions.map(t => t.id), ['t1']);
    const page_json = JSON.stringify({
        types: page.sharedRelationshipTypes,
        options: page.relationshipRuleOptions,
        notice: page.relationshipTypesNotice,
    });
    assert.doesNotMatch(page_json, /Discipleship/, 'an unshared Type is not named, listed, or hinted at');
});

test('the page behaves identically for an elder — it is not a second route into shepherding data', async () => {
    const asEditor = await mountPage({ relationship_types: { t1: MARRIAGE, t2: DISCIPLESHIP } });
    asEditor.currentPermissionLevel = 'editor';
    const asElder = await mountPage({ relationship_types: { t1: MARRIAGE, t2: DISCIPLESHIP } });
    asElder.currentPermissionLevel = 'elder';
    assert.deepStrictEqual(
        asElder.relationshipRuleOptions.map(t => t.id),
        asEditor.relationshipRuleOptions.map(t => t.id)
    );
});

test('a group-kind shared Type is not offered as a pair rule', async () => {
    const page = await mountPage({ relationship_types: { t1: MARRIAGE, t3: HOUSE_GROUP } });
    assert.deepStrictEqual(page.relationshipRuleOptions.map(t => t.id), ['t1'],
        'a "may not serve together" rule connects two people');
});

test('a permission failure says so rather than looking like an empty church', async () => {
    const page = await mountPage({ relationship_types: { t1: MARRIAGE } }, { deny: ['relationship_types'] });
    assert.equal(page.relationshipTypesDenied, true);
    assert.match(page.relationshipTypesNotice, /permission|couldn't|could not/i);
    assert.doesNotMatch(page.relationshipTypesNotice, /^No relationship types$/i);
});

test('when nothing is shared yet the page says so and points at an elder', async () => {
    const page = await mountPage({ relationship_types: { t2: DISCIPLESHIP } });
    assert.deepStrictEqual(page.relationshipRuleOptions, []);
    assert.match(page.relationshipTypesNotice, /elder/i);
});

test('a "may not serve together" rule can be added and saved', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() }, relationship_types: { t1: MARRIAGE } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.addRelationshipRule('t1');
    await page.saveDraft();
    assert.deepStrictEqual(stored('roles').r1.restrictions, [{ kind: 'notTogether', typeId: 't1' }]);
});

test('a rule naming an unshared Type is refused rather than saved to match nobody', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() }, relationship_types: { t1: MARRIAGE } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.addRelationshipRule('t2'); // Discipleship — never offered here
    assert.equal(page.draft.restrictions.length, 0);
});

test('a rule whose Type is later unshared degrades safely — the Role still loads, the rule reads unavailable', async () => {
    const withRule = kidsDefinition();
    withRule.restrictions = [{ kind: 'notTogether', typeId: 't1' }];
    // The elder has since made Marriage private again.
    const page = await mountPage({
        roles: { r1: withRule },
        relationship_types: { t1: { ...MARRIAGE, sharedWithEditors: false } },
    });
    const def = page.roleDefinitions.find(d => d.id === 'r1');
    assert.equal(def.restrictions.length, 1, 'the rule is not silently dropped');
    assert.equal(page.isRuleAvailable(def.restrictions[0]), false);
    assert.match(page.ruleSentence(def.restrictions[0]), /unavailable|no longer|elder/i);
    page.startEdit(def);
    assert.ok(page.draft, 'the Role still opens for editing');
});

test('saved relationship rules round-trip through the eligibility engine', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() }, relationship_types: { t1: MARRIAGE } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.addRelationshipRule('t1');
    await page.saveDraft();

    const reopened = await mountPage({ roles: stored('roles'), relationship_types: { t1: MARRIAGE } });
    const def = reopened.roleDefinitions.find(d => d.id === 'r1');
    const verdicts = Roles.candidatesFor(def, def.slots[1], {
        people: [{ id: 'ann', sex: 'female' }, { id: 'ben', sex: 'male' }],
        relationships: [{ typeId: 't1', fromId: 'ann', toId: 'ben' }],
        assigned: [{ slotId: 's1', personId: 'ann' }],
    });
    assert.equal(verdicts.find(v => v.personId === 'ben').eligible, false);
    assert.equal(verdicts.find(v => v.personId === 'ben').reason, Roles.REASONS.RELATIONSHIP_CONFLICT);
});

test('the demo: Kids Ministry with three slots, a Tag rule and a couple rule, reopened unchanged', async () => {
    const page = await mountPage({ roles: {}, relationship_types: { t1: MARRIAGE } });
    await page.createRole('Kids Ministry');
    const id = Object.keys(stored('roles'))[0];
    page.startEdit(page.roleDefinitions.find(d => d.id === id));
    page.setSlotRequirement('s1', Roles.REQUIREMENTS.FEMALE);
    page.addSlot();
    page.addSlot();
    page.addTagRule(Roles.RESTRICTIONS.REQUIRE_TAG, KIDS_CLEARED);
    page.addRelationshipRule('t1');
    await page.saveDraft();

    const reopened = await mountPage({ roles: stored('roles'), relationship_types: { t1: MARRIAGE } });
    const def = reopened.roleDefinitions.find(d => d.id === id);
    assert.equal(def.name, 'Kids Ministry');
    assert.deepStrictEqual(def.slots, [
        { id: 's1', requirement: 'female' },
        { id: 's2', requirement: 'either' },
        { id: 's3', requirement: 'either' },
    ]);
    assert.deepStrictEqual(def.restrictions, [
        { kind: 'requireTag', tagId: KIDS_CLEARED },
        { kind: 'notTogether', typeId: 't1' },
    ]);
    assert.equal(Roles.validateDefinition(def).valid, true);
});
