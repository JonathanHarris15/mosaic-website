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
// The Alpine template's LAYOUT is not covered; that needs a real page. What is
// covered is that every name it binds exists on the factory — see "the template
// only reaches for things the page defines". A name that does not resolve
// renders as nothing at all, with no error anywhere.

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
                    get: async () => ({
                        id,
                        exists: coll(name)[id] !== undefined,
                        data: () => coll(name)[id],
                    }),
                    // `merge` is honoured, because the difference matters: the
                    // Sunday Service series is written by this page for one
                    // field and by the seeder for the rest, and a fake that
                    // silently replaced the document would hide a real
                    // clobbering bug.
                    set: guard((doc, options) => {
                        const next = JSON.parse(JSON.stringify(doc));
                        coll(name)[id] = (options && options.merge)
                            ? { ...coll(name)[id], ...next }
                            : next;
                    }),
                    update: guard(patch => { coll(name)[id] = { ...coll(name)[id], ...patch }; }),
                    delete: guard(() => { delete coll(name)[id]; }),
                }),
            });
        },
    };
}

global.window = global;
const Roles = require('../public/roles-core.js');
const EventsCore = require('../public/events-core.js');
require('../public/relationship-core.js');
require('../public/roles-manager.js');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const KIDS_CLEARED = 'tag_kids';
const SABBATICAL = 'tag_sabbatical';
const DISCIPLINE = 'tag_discipline';

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
async function mountPage(seed = {}, { deny = [], confirmAnswer = true, rank = 'editor' } = {}) {
    global.db = fakeDb({ people_tags: TAGS, ...seed }, { deny });
    global.confirm = () => confirmAnswer;
    const page = window.RolesManager();
    // init() settles the permission level before it loads anything, because the
    // loads read it — hidden tags are filtered by who is asking.
    page.currentPermissionLevel = rank;
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

// ── Tags an elder keeps private ──────────────────────────────────────────────
//
// `hiddenFromOthers` is an elder saying the TAG is theirs. The name is the
// private thing, so offering it in a rule picker has already leaked it.

test('a tag an elder has hidden is never offered to an editor building a rule', async () => {
    const page = await mountPage({
        roles: { r1: kidsDefinition() },
        people_tags: { ...TAGS, [DISCIPLINE]: { name: 'Under Discipline', hiddenFromOthers: true } },
    }, { rank: 'editor' });

    assert.deepStrictEqual(page.shepherdingTags.map(t => t.id).sort(), [KIDS_CLEARED, SABBATICAL].sort());
    assert.deepStrictEqual(page.ruleValueOptions.map(o => o.id).sort(), [KIDS_CLEARED, SABBATICAL].sort());
    assert.ok(
        !JSON.stringify(page.ruleValueOptions).includes('Under Discipline'),
        'the hidden tag\'s name must not reach the picker'
    );

    // And not by hand either: the id can be typed, the rule cannot be built.
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.addTagRule(Roles.RESTRICTIONS.REQUIRE_TAG, DISCIPLINE);
    assert.equal(page.draft.restrictions.length, 0);
});

test('an elder still sees their own hidden tags — they are hidden from everyone else FOR elders', async () => {
    for (const rank of ['elder', 'super_admin']) {
        const page = await mountPage({
            people_tags: { ...TAGS, [DISCIPLINE]: { name: 'Under Discipline', hiddenFromOthers: true } },
        }, { rank });
        assert.ok(page.shepherdingTags.some(t => t.id === DISCIPLINE), rank + ' should see the hidden tag');
        assert.deepStrictEqual(page.hiddenTagIds, [], 'nothing is held back from ' + rank);
    }
});

test('a rule already built on a hidden tag says it is private, not that it is broken', async () => {
    const withRule = kidsDefinition();
    withRule.restrictions = [{ kind: 'requireTag', tagId: DISCIPLINE }];
    const page = await mountPage({
        roles: { r1: withRule },
        people_tags: { ...TAGS, [DISCIPLINE]: { name: 'Under Discipline', hiddenFromOthers: true } },
    }, { rank: 'editor' });

    const sentence = page.ruleSentence({ kind: 'requireTag', tagId: DISCIPLINE });
    assert.doesNotMatch(sentence, /Under Discipline/, 'the name is the thing being hidden');
    assert.doesNotMatch(sentence, /no longer exists/, 'a hidden tag is not a deleted one');
    assert.match(sentence, /private/i);
    // A tag that really is gone still reads as gone.
    assert.match(page.ruleSentence({ kind: 'requireTag', tagId: 'tag_deleted' }), /no longer exists/);
});

// ── The write list, and the field that fell off it ───────────────────────────

test('what is typed into the description is what comes back on reopening', async () => {
    // The behaviour the source checks below are proxies for. Saved through the
    // real page, read back through a fresh mount, opened again for editing.
    const page = await mountPage({ roles: { r1: coffeeDefinition() }, people: PEOPLE });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.description = '  Arrive by 9:15 and put the urns on.  ';
    await page.saveDraft();

    assert.equal(stored('roles').r1.description, 'Arrive by 9:15 and put the urns on.',
        'the description never reached Firestore');

    const reopened = await mountPage({ roles: stored('roles'), people: PEOPLE });
    const def = reopened.roleDefinitions.find(d => d.id === 'r1');
    assert.equal(Roles.descriptionOf(def), 'Arrive by 9:15 and put the urns on.',
        'a saved description does not read back');

    reopened.startEdit(def);
    assert.equal(reopened.draft.description, 'Arrive by 9:15 and put the urns on.',
        'the editor reopens with an empty box');
});

test('clearing a description clears it, rather than leaving the old words', async () => {
    const withOne = coffeeDefinition();
    withOne.description = 'The old words.';
    const page = await mountPage({ roles: { r1: withOne }, people: PEOPLE });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.description = '';
    await page.saveDraft();

    assert.equal(stored('roles').r1.description, '');
    assert.equal(Roles.descriptionOf(stored('roles').r1), null);
});

test('saving a Role does not drop the rest of it either', async () => {
    // The write is WHOLE, so this is the shape of every version of this bug.
    const page = await mountPage({ roles: { r1: kidsDefinition() }, people: PEOPLE });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.description = 'Two adults in the room at all times.';
    page.addTagRule(Roles.RESTRICTIONS.REQUIRE_TAG, KIDS_CLEARED);
    await page.saveDraft();

    const saved = stored('roles').r1;
    assert.equal(saved.description, 'Two adults in the room at all times.');
    assert.equal(saved.slots.length, 3, 'the slots went');
    assert.deepStrictEqual(saved.restrictions, [{ kind: 'requireTag', tagId: KIDS_CLEARED }]);
    assert.equal(saved.slug, 'kids_ministry', 'the slug moved, orphaning its serve history');
});


test('a description survives a save and comes back when the Role is reopened', () => {
    // ⚠ THE BUG THIS EXISTS FOR. `description` was added to the model, to the
    // form, and to five screens — and not to the object saveDraft writes. So it
    // was typed, validated, and dropped: the Role reopened blank every time and
    // nothing anywhere reported a problem.
    //
    // A synchronous check of the write list itself, because the failure was not
    // in any behaviour a mounted page performs — it was a missing line.
    const source = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', 'public', 'roles-manager.js'), 'utf8');
    const written = source.match(/const definition = \{([\s\S]*?)\n {8}\};/);
    assert.ok(written, 'saveDraft no longer builds the document it writes');
    assert.match(written[1], /description:/, 'a saved Role would lose its description');
});

test('EVERY field a new Role has is written when one is saved', () => {
    // The general form of the same mistake. The document is written WHOLE, so a
    // field missing from that object is not merely unsaved — it is deleted from
    // the stored Role on the next save. `newDefinition` is the list of what a
    // Role has; this walks it so the next field added cannot go missing quietly.
    const source = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', 'public', 'roles-manager.js'), 'utf8');
    const written = source.match(/const definition = \{([\s\S]*?)\n {8}\};/)[1];

    Object.keys(Roles.newDefinition('Anything')).forEach(field => {
        assert.match(written, new RegExp('\\b' + field + ':'),
            '`' + field + '` is part of a Role but saveDraft does not write it — ' +
            'saving would silently drop it');
    });
});

test('a description is stored trimmed, so what is read back is what is shown', () => {
    const source = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', 'public', 'roles-manager.js'), 'utf8');
    assert.match(source, /description: String\(this\.draft\.description \|\| ''\)\.trim\(\)/,
        'the stored value is not normalised, so a whitespace-only one reads as present');
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

// ── How the list and the editor read (the two-pane redesign) ─────────────────
//
// The list is the navigation now: a row IS the edit control, and it has to say
// enough at a glance that you know which Role to open. These are the sentences
// it says.

test('a Role row says how many people it needs and how many rules it carries', async () => {
    const withRule = kidsDefinition();
    withRule.restrictions = [{ kind: 'requireTag', tagId: KIDS_CLEARED }];
    const page = await mountPage({ roles: { r1: withRule, r2: coffeeDefinition() } });
    const kids = page.roles.find(r => r.slug === 'kids_ministry');
    const coffee = page.roles.find(r => r.slug === 'coffee');

    assert.equal(page.peopleNeededLabel(kids), 'Needs 3 people');
    assert.equal(page.peopleNeededLabel(coffee), 'Needs 1 person', 'one person, not "1 people"');
    assert.equal(page.ruleCountLabel(kids), '1 rule');
    assert.equal(page.ruleCountLabel(coffee), '0 rules');
    assert.equal(page.restrictionCount(coffee), 0);
    assert.equal(page.roleCountLabel, '2 roles');
});

test('the roles count covers the Servant Roles the list actually shows', async () => {
    // The liturgical Roles live in their own locked card and are not counted here.
    const page = await mountPage({ roles: { r1: coffeeDefinition() } });
    assert.equal(page.roleCountLabel, '1 role');
    const empty = await mountPage({ roles: {} });
    assert.equal(empty.roleCountLabel, '0 roles');
});

test('the open Role is the selected row, so the list shows where you are', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition(), r2: coffeeDefinition() } });
    const kids = page.roleDefinitions.find(d => d.id === 'r1');
    assert.equal(page.isSelected(kids), false);
    page.startEdit(kids);
    assert.equal(page.isSelected(kids), true);
    assert.equal(page.isSelected(page.roleDefinitions.find(d => d.id === 'r2')), false);
    page.cancelEdit();
    assert.equal(page.isSelected(kids), false);
});

test('delete acts on the stored Role, not on the half-typed draft name', async () => {
    // The narrow editor carries its own delete button, and by then the only
    // Role in view is the draft — so the confirmation has to name the Role as
    // it is actually saved.
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.name = 'Half-typed nam';
    const asked = [];
    global.confirm = message => { asked.push(message); return true; };
    await page.deleteRole(page.draftRole);
    assert.match(asked[0], /Kids Ministry/);
    assert.deepStrictEqual(stored('roles'), {});
});

test('deleting nothing does nothing', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    assert.equal(page.draftRole, null, 'no Role is open');
    await page.deleteRole(page.draftRole);
    assert.equal(Object.keys(stored('roles')).length, 1);
});

test('each kind of rule gets its own glyph, so a list of rules is scannable', async () => {
    const page = await mountPage({ roles: {} });
    const icons = [
        page.ruleIcon({ kind: 'requireTag', tagId: KIDS_CLEARED }),
        page.ruleIcon({ kind: 'excludeTag', tagId: SABBATICAL }),
        page.ruleIcon({ kind: 'notTogether', typeId: 't1' }),
    ];
    assert.equal(new Set(icons).size, 3, 'a required tag must not look like an excluded one');
    icons.forEach(icon => assert.ok(icon && typeof icon === 'string'));
});

// ── Composing a rule from one pair of pickers ────────────────────────────────

test('the rule kinds on offer include a relationship rule only when a Type is shared', async () => {
    // The allowlist is always on offer and always last: it needs nothing shared
    // to build, and it is the blunt one — right for the four who serve
    // communion, wrong for anything a tag could say.
    // The GROUP rules are always on offer too, because Family and Marriage come
    // from the Membership Directory and need nobody to share them.
    const withShared = await mountPage({ relationship_types: { t1: MARRIAGE } });
    assert.deepStrictEqual(
        withShared.ruleKindOptions.map(o => o.value),
        ['requireTag', 'excludeTag', 'notTogether', 'notSameGroup', 'sameGroup', 'allowlist']
    );

    const withNone = await mountPage({ relationship_types: { t2: DISCIPLESHIP } });
    assert.deepStrictEqual(withNone.ruleKindOptions.map(o => o.value),
        ['requireTag', 'excludeTag', 'notSameGroup', 'sameGroup', 'allowlist'],
        'the PAIRWISE rule is the dead end without a shared Type; the group ones never are');
    // And every label is a sentence opener, not a field name.
    withShared.ruleKindOptions.forEach(o => assert.doesNotMatch(o.label, /Tag[A-Z]|kind|typeId/));
});

test('the second picker follows the first — tags for a tag rule, shared Types for a pair rule', async () => {
    const page = await mountPage({ relationship_types: { t1: MARRIAGE, t2: DISCIPLESHIP } });

    page.newRuleKind = Roles.RESTRICTIONS.REQUIRE_TAG;
    assert.deepStrictEqual(page.ruleValueOptions.map(o => o.id).sort(), [KIDS_CLEARED, SABBATICAL].sort());
    assert.match(page.ruleValuePlaceholder, /tag/i);

    page.newRuleKind = Roles.RESTRICTIONS.NOT_TOGETHER;
    assert.deepStrictEqual(page.ruleValueOptions.map(o => o.id), ['t1'],
        'an unshared Type is never offered, whichever picker is asking');
    assert.match(page.ruleValuePlaceholder, /relationship/i);
});

test('adding a composed rule routes to the right kind and clears the picker', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() }, relationship_types: { t1: MARRIAGE } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));

    page.newRuleKind = Roles.RESTRICTIONS.EXCLUDE_TAG;
    page.newRuleValue = SABBATICAL;
    page.addComposedRule();

    page.newRuleKind = Roles.RESTRICTIONS.NOT_TOGETHER;
    page.newRuleValue = 't1';
    page.addComposedRule();

    assert.deepStrictEqual(page.draft.restrictions, [
        { kind: 'excludeTag', tagId: SABBATICAL },
        { kind: 'notTogether', typeId: 't1' },
    ]);
    assert.equal(page.newRuleValue, '', 'the picker resets, ready for the next rule');
});

test('adding a rule with nothing chosen says so rather than adding a rule about nothing', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.newRuleValue = '';
    page.addComposedRule();
    assert.equal(page.draft.restrictions.length, 0);
    assert.equal(page.toast.type, 'error');
});

// ── Group restriction rules (MS-141 reaching the rule builder) ───────────────
//
// The engine has understood same-group / not-same-group since MS-141; this page
// is what lets anyone author one. A church whose only Shared Type is a Group
// must not be told "nothing has been shared with editors yet".

test('shared Group-kind Types are offered for group rules, and pairwise ones are not', async () => {
    const page = await mountPage({ relationship_types: { t1: MARRIAGE, t3: HOUSE_GROUP } });
    // Family and Marriage lead, always: they are the commonest rule in a church
    // and the Membership Directory already knows them.
    assert.deepStrictEqual(page.groupRuleOptions.map(t => t.id), ['family', 'marriage', 't3']);
    assert.deepStrictEqual(page.relationshipRuleOptions.map(t => t.id), ['t1'],
        'the two lists stay separate — a Type is one kind or the other');
});

test('an unshared Group Type is offered nowhere', async () => {
    const page = await mountPage({
        relationship_types: { t3: { ...HOUSE_GROUP, sharedWithEditors: false } },
    });
    assert.deepStrictEqual(page.customGroupTypes, [],
        'the directory pair are always there; a CUSTOM Type still has to be shared');
    assert.doesNotMatch(JSON.stringify(page.groupRuleOptions), /House Group/);
    assert.doesNotMatch(JSON.stringify(page.ruleKindOptions) + page.relationshipTypesNotice, /House Group/);
});

test('the rule kinds follow what is actually shared, pairwise and group independently', async () => {
    const groupOnly = await mountPage({ relationship_types: { t3: HOUSE_GROUP } });
    assert.deepStrictEqual(groupOnly.ruleKindOptions.map(o => o.value),
        ['requireTag', 'excludeTag', 'notSameGroup', 'sameGroup', 'allowlist'],
        'a shared Group Type must open the group rules even with no pairwise Type');

    const pairOnly = await mountPage({ relationship_types: { t1: MARRIAGE } });
    assert.deepStrictEqual(pairOnly.ruleKindOptions.map(o => o.value),
        ['requireTag', 'excludeTag', 'notTogether', 'notSameGroup', 'sameGroup', 'allowlist'],
        'the group rules do not wait on a shared Type any more');

    const both = await mountPage({ relationship_types: { t1: MARRIAGE, t3: HOUSE_GROUP } });
    assert.deepStrictEqual(both.ruleKindOptions.map(o => o.value),
        ['requireTag', 'excludeTag', 'notTogether', 'notSameGroup', 'sameGroup', 'allowlist']);
});

test('a shared Group Type is not reported as nothing being shared', async () => {
    // The bug this replaces: the page said "no relationship types have been
    // shared with editors yet" to a church that had shared exactly one.
    const page = await mountPage({ relationship_types: { t3: HOUSE_GROUP } });
    assert.equal(page.relationshipTypesNotice, '', 'there is something to build a rule from');

    const nothing = await mountPage({ relationship_types: { t2: DISCIPLESHIP } });
    assert.match(nothing.relationshipTypesNotice, /elder/i);
});

test('the group pickers offer groups, and composing a group rule saves one', async () => {
    const page = await mountPage({
        roles: { r1: kidsDefinition() },
        relationship_types: { t1: MARRIAGE, t3: HOUSE_GROUP },
    });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));

    page.newRuleKind = Roles.RESTRICTIONS.SAME_GROUP;
    assert.deepStrictEqual(page.ruleValueOptions.map(o => o.id), ['family', 'marriage', 't3']);
    assert.match(page.ruleValuePlaceholder, /group/i);
    page.newRuleValue = 't3';
    page.addComposedRule();

    page.newRuleKind = Roles.RESTRICTIONS.NOT_SAME_GROUP;
    page.newRuleValue = 't3';
    page.addComposedRule();

    await page.saveDraft();
    assert.deepStrictEqual(stored('roles').r1.restrictions, [
        { kind: 'sameGroup', typeId: 't3' },
        { kind: 'notSameGroup', typeId: 't3' },
    ]);
});

test('a group rule against a pairwise Type is refused before it is written', async () => {
    // RolesCore calls this a mistake rather than a no-op; the page must not
    // build one in the first place.
    const page = await mountPage({
        roles: { r1: kidsDefinition() },
        relationship_types: { t1: MARRIAGE, t3: HOUSE_GROUP },
    });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.addGroupRule(Roles.RESTRICTIONS.SAME_GROUP, 't1');
    assert.equal(page.draft.restrictions.length, 0);
    assert.equal(page.toast.type, 'error');
});

test('group rules read as sentences and carry their own glyphs', async () => {
    const page = await mountPage({ relationship_types: { t1: MARRIAGE, t3: HOUSE_GROUP } });
    const same = { kind: 'sameGroup', typeId: 't3' };
    const notSame = { kind: 'notSameGroup', typeId: 't3' };

    assert.match(page.ruleSentence(same), /House Group/);
    assert.match(page.ruleSentence(notSame), /House Group/);
    assert.notEqual(page.ruleSentence(same), page.ruleSentence(notSame),
        'the two rules are opposites and must not read alike');

    const icons = [page.ruleIcon(same), page.ruleIcon(notSame), page.ruleIcon({ kind: 'notTogether', typeId: 't1' })];
    assert.equal(new Set(icons).size, 3);
});

// ⚠ THE BUG THIS REPLACES. A rule naming Marriage rendered as "unavailable —
// an elder is no longer sharing the relationship type it uses", because the
// label looked the type up in `sharedRelationshipTypes` alone. Wrong, and
// unfixable by the person reading it: no elder can share a type that is not a
// document.
test('a rule naming Family or Marriage reads as a sentence, not as unavailable', async () => {
    // Deliberately a church with NOTHING shared.
    const page = await mountPage({ relationship_types: {} });

    const marriage = { kind: 'notSameGroup', typeId: 'marriage' };
    const family = { kind: 'notSameGroup', typeId: 'family' };

    assert.equal(page.isRuleAvailable(marriage), true);
    assert.equal(page.isRuleAvailable(family), true);
    assert.match(page.ruleSentence(marriage), /Marriage/);
    assert.match(page.ruleSentence(family), /Family/);
    assert.doesNotMatch(page.ruleSentence(marriage), /unavailable/);
});

// Still true of a CUSTOM type, and still worth saying: an elder really can
// unshare one after a rule was written against it.
test('a rule naming a type nobody shares any more still says so', async () => {
    const page = await mountPage({ relationship_types: {} });
    const orphan = { kind: 'notSameGroup', typeId: 't3' };

    assert.equal(page.isRuleAvailable(orphan), false);
    assert.match(page.ruleSentence(orphan), /unavailable/);
});

test('saved group rules round-trip through the eligibility engine', async () => {
    const page = await mountPage({ roles: { r1: coffeeDefinition() }, relationship_types: { t3: HOUSE_GROUP } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.addSlot();
    page.addGroupRule(Roles.RESTRICTIONS.NOT_SAME_GROUP, 't3');
    await page.saveDraft();

    const reopened = await mountPage({ roles: stored('roles'), relationship_types: { t3: HOUSE_GROUP } });
    const def = reopened.roleDefinitions.find(d => d.id === 'r1');
    assert.equal(Roles.validateDefinition(def).valid, true);
    assert.equal(reopened.isRuleAvailable(def.restrictions[0]), true);

    // Ann is already seated; Ben shares her group, so he is out.
    const verdicts = Roles.candidatesFor(def, def.slots[1], {
        people: [{ id: 'ann', sex: 'female' }, { id: 'ben', sex: 'male' }, { id: 'cal', sex: 'male' }],
        groups: [{ id: 'g1', typeId: 't3', leaderId: 'ann', memberIds: ['ben'] }],
        assigned: [{ slotId: 's1', personId: 'ann' }],
    });
    assert.equal(verdicts.find(v => v.personId === 'ben').eligible, false,
        'the leader counts as being in her own group');
    assert.equal(verdicts.find(v => v.personId === 'cal').eligible, true);
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

// ── The Roles Manager on a phone (MS-99) ─────────────────────────────────────
//
// The page is opened whole inside the app's WebView with ?shell=mobile rather
// than ported to a native screen: it is the authoring home for what a Role IS,
// and a second copy of it is a second place for slots and restriction rules to
// drift from RolesCore.
//
// What that costs is chrome. The shell draws the header, the page must not draw
// a second one, and every gate the page had was written for a browser tab where
// "away from here" meant index.html. These hold both ends of that.

const fs = require('node:fs');
const path = require('node:path');
const PUBLIC = path.join(__dirname, '..', 'public');

const rolesManagerHtml = () => fs.readFileSync(path.join(PUBLIC, 'roles-manager.html'), 'utf8');
const rolesManagerJs = () => fs.readFileSync(path.join(PUBLIC, 'roles-manager.js'), 'utf8');

test('the Roles Manager can actually enter the phone shell', () => {
    // A page can carry every `html.shell-mobile` rule in the world and never
    // load the one script that sets the class. That has shipped before.
    const html = rolesManagerHtml();
    assert.match(html, /src="mobile-shell\.js"/, 'the page cannot enter the shell');
    assert.match(html, /href="mobile-shell\.css"/, 'the page has no shell stylesheet');
    assert.match(html, /window\.MOBILE_HEADER/, 'the page has no shell header');
    assert.match(html, /src="mobile-shell-header\.js"/, 'the page never builds its header');

    assert.ok(html.indexOf('mobile-shell.js') < html.indexOf('mobile-shell-header.js'),
        'the header is built before the page knows it is in the shell');
    assert.ok(html.indexOf('mobile-shell.js') < html.indexOf('src="roles-manager.js"'),
        'the page script runs before the shell class is set');
});

test('every phone rule on the Roles Manager has something to style', () => {
    // The general form of a whole family of bugs: a rule for a class nothing
    // carries is styling that can never fire, and it reads in review as done.
    const html = rolesManagerHtml();
    const hooks = new Set();
    const re = /html\.shell-mobile\s+\.([\w-]+)/g;
    let m;
    while ((m = re.exec(html))) hooks.add(m[1]);

    assert.ok(hooks.size, 'the phone rules moved off this page');
    hooks.forEach(hook => {
        assert.ok(new RegExp('class="[^"]*\\b' + hook + '\\b').test(html),
            'no element carries ' + hook + ', so that phone rule can never fire');
    });
});

test('the phone never draws two headers, or two back arrows', () => {
    const html = rolesManagerHtml();

    // The shell header says "Roles Manager", so the page's own title block —
    // heading and the paragraph explaining the page — stands down entirely.
    //
    // It used to stand down only in the shell, with a `display: none` rule.
    // MS-234 deleted it at every width: the list says what the page is, and the
    // paragraph was costing most of a phone screen before the first Role. So
    // the check is now that it does not exist rather than that it is hidden,
    // which is the stronger of the two.
    assert.doesNotMatch(html, /rm-title-block/,
        'the standfirst is back — the shell would print it under the shell\'s own title');

    // The page is a DRAWER DESTINATION, so its header carries a hamburger like
    // every other one. It used to carry a back arrow that asked the page what
    // back meant, and the editor skipped drawing its own as a duplicate.
    assert.match(html, /MOBILE_HEADER\s*=\s*{[^}]*menu:\s*true/,
        'the header is back to an arrow, so this page is not in the drawer');
    assert.match(html, /MOBILE_HEADER\s*=\s*{[^}]*route:\s*'rolesManager'/,
        'the drawer cannot show which row you are on without the route');

    // ⚠ WHICH MAKES THE EDITOR'S OWN ARROW THE ONLY WAY OUT OF AN OPEN ROLE.
    // A hamburger opens the drawer; it does not close a Role. So this arrow
    // must render in the shell too — gating it behind !inShell, which is what
    // it did while the header had an arrow to borrow, now strands you in the
    // editor with the list unreachable.
    const back = html.slice(0, html.indexOf('Back to the roles list'));
    assert.doesNotMatch(back.slice(-400), /<template x-if="!inShell">/,
        'an open Role has no way back to the list on a phone');
});

test('the editor bar clears the shell header instead of hiding behind it', () => {
    // Both are sticky at the top of the same scrollport and the shell's sits at
    // z-index 1000. Pinned at 0 the editor's bar — the Role\'s name, its count,
    // and the only delete on a phone — would never be seen again.
    assert.match(rolesManagerHtml(), /html\.shell-mobile \.rm-editor-bar\s*{\s*top:\s*var\(--msh-height/);
});

test('a phone row is a card, and it does not offer delete next to open', () => {
    const html = rolesManagerHtml();
    // No pointer means no hover, so a row that only shows its edge on hover
    // shows nothing at all.
    const rule = html.match(/html\.shell-mobile \.rm-role-row\s*{([^}]*)}/)[1];
    assert.match(rule, /border/,
        'the rows are an undifferentiated stack on a phone');

    // ⚠ DELETE IS NOT ON THE ROW AT ALL any more, at any width (MS-234). It
    // used to be rendered on a desktop and gated off a phone, which is the
    // arrangement the next test's comment describes at length. The hazard it
    // was guarding — a destructive control a thumb-width from the tap that
    // OPENS a Role — is now gone rather than gated, and the only delete is in
    // the open Role's own head, where nothing else is competing for the tap.
    const rows = html.slice(html.indexOf('<ul x-show="hasServantRoles"'), html.indexOf('</ul>', html.indexOf('<ul x-show="hasServantRoles"')));
    assert.doesNotMatch(rows, /deleteRole/,
        'a Role row offers delete beside the tap that opens the Role');
    assert.match(html, /deleteRole\(draftRole\)/,
        'the open Role has no delete, so a Role cannot be removed at all');

    // And the row rule must not paint over the selected row: the selection is
    // `.m-picklist__item--current`, one class, and this rule is two — so a
    // background set here would win on specificity and the selection would
    // vanish.
    assert.doesNotMatch(rule, /background/,
        'the phone row rule repaints the selected row as unselected');
});

test('being refused never throws you out of the app', () => {
    // Both gates fire before anything renders. In a browser tab "away from here"
    // is login.html / index.html; inside the WebView those are the WEBSITE, and
    // landing there is a refusal you cannot come back from.
    const page = window.RolesManager();

    delete global.MOSAIC_SHELL;
    assert.equal(page.signInHref, 'login.html');
    assert.equal(page.homeHref, 'index.html');

    global.MOSAIC_SHELL = 'mobile';
    try {
        assert.equal(page.signInHref, 'mobile.html#/login');
        assert.equal(page.homeHref, 'mobile.html#/home');
    } finally {
        delete global.MOSAIC_SHELL;
    }

    // And the gates use them rather than the literals they replaced.
    const js = rolesManagerJs();
    assert.doesNotMatch(js, /href = 'login\.html'/, 'the sign-in gate still leaves the app');
    assert.doesNotMatch(js, /href = 'index\.html'/, 'the permission gate still leaves the app');
});

// The header on this page is a hamburger now, so nothing fires this today.
// The handler is kept for any shell header that DOES draw a back arrow, and
// this holds it to meaning what the page means by back rather than leaving
// mid-edit.
test('a shell back arrow, where one exists, closes the Role first and leaves the page second', async () => {
    const handlers = {};
    const realDocument = global.document;
    global.MOSAIC_SHELL = 'mobile';
    global.document = { addEventListener(name, fn) { (handlers[name] = handlers[name] || []).push(fn); } };
    global.location = { href: '' };

    try {
        const page = await mountPage({ roles: { r1: coffeeDefinition() } });
        page.listenForShellBack();
        const back = () => handlers['mobile-header:back'].forEach(fn => fn());

        page.startEdit(page.roleDefinitions[0]);
        back();
        assert.equal(page.draft, null, 'back left the page instead of closing the Role');
        assert.equal(global.location.href, '', 'back left the page with a Role still open');

        back();
        assert.equal(global.location.href, 'mobile.html#/home',
            'with nothing open, back does nothing at all');
    } finally {
        delete global.MOSAIC_SHELL;
        if (realDocument === undefined) delete global.document; else global.document = realDocument;
    }
});

test('an editor can actually reach the Roles Manager from a phone', () => {
    // The page gates itself, but a page nothing links to is a page nobody opens.
    const D = require('../public/mobile/destinations.js');
    assert.equal(D.SHELL_PAGES.rolesManager, 'roles-manager.html',
        'the phone has no route to the Roles Manager');
    assert.equal(D.routeHref('rolesManager'), 'roles-manager.html?shell=mobile',
        'the route opens the page outside the shell');

    const appJs = fs.readFileSync(path.join(PUBLIC, 'mobile', 'app.js'), 'utf8');
    const tile = appJs.match(/{[^{}]*route: "rolesManager"[^{}]*}/);
    assert.ok(tile, 'the phone home has no Roles Manager tile');

    // The same gate as the dashboard card it mirrors — a tile offered to
    // somebody the page will bounce is worse than no tile.
    const gate = ['editor', 'elder', 'admin', 'super_admin'];
    gate.forEach(level => assert.ok(tile[0].indexOf('"' + level + '"') !== -1,
        level + ' is offered the Roles Manager on the web but not on a phone'));
    ['member', 'viewer'].forEach(level => assert.equal(tile[0].indexOf('"' + level + '"'), -1,
        level + ' is offered a page they will be refused'));

    const page = window.RolesManager();
    gate.forEach(level => assert.equal(page.mayManageRoles(level), true));
});

test('a desktop page in the shell never reaches for a token it does not have', () => {
    // A bare `var(--x)` that nothing defines does not fall back — the whole
    // declaration is dropped, silently, leaving whatever the utility class
    // already said. That shipped once as a row border nobody could see.
    //
    // The rule used to be "always write a fallback", because the tokens lived
    // in mobile/tokens.css and only mobile.html loaded it. They are generated
    // into mosaic.css now (build/design-tokens), which this page loads at line
    // 8, so naming a real token is enough and a fallback is just a second copy
    // of the value waiting to go stale. What still has to hold is that the
    // token is real.
    const html = rolesManagerHtml();
    assert.match(html, /<link rel="stylesheet" href="mosaic\.css"/,
        'the page does not load the stylesheet its tokens come from');

    // ⚠ This list has to mirror scripts/build-design-tokens.mjs, not a subset of
    // it. It carried only colours, spacing, shadows and families, which was
    // enough while the page's own CSS reached for almost nothing — the first
    // rule to name --radius or --label-xs-size would have failed against a real
    // token. Radius, the container width and the type scale are generated too,
    // and the whole point of the check is that the token is REAL.
    const theme = require('../tailwind.config.js').theme.extend;
    const sizes = theme.fontSize || {};
    const generated = new Set([
        ...Object.keys(theme.colors || {}),
        ...Object.keys(theme.spacing || {}).map(k => 'space-' + k),
        ...Object.keys(theme.boxShadow || {}).map(k => 'shadow-' + k),
        // fontFamily also carries one alias per size role; the build emits only
        // the families that are not also a role, so neither list is wrong here.
        ...Object.keys(theme.fontFamily || {}).map(k => 'font-' + k),
        ...Object.keys(theme.maxWidth || {}).map(k => (k === 'container' ? 'container-max' : 'width-' + k)),
        ...Object.keys(theme.borderRadius || {}).map(k => (k === 'DEFAULT' ? 'radius' : 'radius-' + k)),
        ...Object.keys(sizes).flatMap(k => [k + '-size', k + '-line', k + '-spacing']),
    ].map(k => '--' + k));

    // Not generated, and this is the trap. --duration, --ease-standard and the
    // rest of the motion set live AFTER the @generated marker in spacing.css —
    // they are the design system's own, and nothing splices them into
    // mosaic.css. A page that names one loses the whole declaration.
    ['--duration', '--duration-fast', '--duration-slow', '--ease-standard', '--border-hairline']
        .forEach(t => assert.equal(generated.has(t), false,
            t + ' is generated now — this guard is stale, and the page may use it'));

    // Comments are stripped first, the same way the next test does it. A note
    // saying "⚠ NOT var(--duration), it resolves to nothing here" is the most
    // useful thing that can be written next to one of these rules, and scanning
    // it as if it were a declaration makes writing it impossible.
    const raw = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    const style = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    const defined = new Set([...style.matchAll(/(--[\w-]+):/g)].map(m => m[1]));

    [...style.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)].forEach(m => {
        if (defined.has(m[1]) || generated.has(m[1]) || m[2] === ',') return;
        assert.fail(m[1] + ' is not a theme token, is not defined on this page, and has no fallback');
    });
});

test('the template only reaches for things the page defines', () => {
    // ⚠ A NAME THE FACTORY DOES NOT HAVE FAILS SILENTLY. Alpine evaluates the
    // expression, gets undefined, and renders nothing — no error, no warning,
    // an empty row where a Role's name should be. Which makes a renamed helper
    // the cheapest possible way to blank a section of this page, and the
    // rewrite in MS-234 touched every binding on it.
    //
    // This is the check the header of this file used to say was missing.
    const html = rolesManagerHtml();
    const DIRECTIVES = /(?:x-text|x-show|x-if|x-model(?:\.\w+)?|x-for|@click|@change|@keydown[\w.]*|:class|:value|:title|:disabled|:aria-[\w-]+|:maxlength)="([^"]*)"/g;
    const exprs = [...html.matchAll(DIRECTIVES)].map(m => m[1]);
    assert.ok(exprs.length > 40, 'the directives are not being found — this test is passing vacuously');

    // Names x-for introduces are locals, not page state, and Alpine's magics
    // belong to Alpine.
    const locals = new Set(['$event', '$el', '$refs', '$store', '$watch', '$dispatch', '$nextTick']);
    for (const [, e] of html.matchAll(/x-for="([^"]*)"/g)) {
        e.split(/\s+in\s+/)[0].trim().replace(/^\(|\)$/g, '')
            .split(',').forEach(v => locals.add(v.trim()));
    }
    const builtin = new Set(['true', 'false', 'null', 'undefined', 'new', 'typeof', 'in', 'of',
        'return', 'if', 'else', 'this', 'length', 'trim', 'indexOf', 'filter', 'map', 'find',
        'slice', 'toLowerCase', 'push', 'concat', 'includes', 'Number', 'String', 'Boolean',
        'Object', 'Array', 'Math', 'JSON']);

    const page = window.RolesManager();
    const defined = new Set(Object.getOwnPropertyNames(page));

    exprs.forEach(e => {
        const code = e
            // A template literal is mostly prose; only what is inside ${} is code.
            .replace(/`([^`]*)`/g, (_, body) => [...body.matchAll(/\$\{([^}]*)\}/g)].map(x => x[1]).join(';'))
            .replace(/'[^']*'/g, "''")
            .replace(/"[^"]*"/g, '""');
        // Leading identifiers only: `draft.name` is a question about `draft`.
        [...code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)].forEach(([, id]) => {
            if (builtin.has(id) || locals.has(id) || defined.has(id)) return;
            assert.fail(id + ' is bound in the template and defined nowhere on the page: ' + e);
        });
    });
});

test('the page\'s own styles are all still inside the stylesheet', () => {
    // A stray `*/` ends a comment that was never open, and everything after it
    // up to the next `*/` is parsed as garbage — the browser drops the rules in
    // between WITHOUT a word. That is how the row border above went missing on a
    // build where the rule was right there in the file, and why reading the CSS
    // as text is not enough to know it fires.
    const html = rolesManagerHtml();
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    const opens = (style.match(/\/\*/g) || []).length;
    const closes = (style.match(/\*\//g) || []).length;
    assert.equal(opens, closes, 'a comment in the page\'s <style> is unbalanced');

    // And nothing outside a comment may start with prose.
    const code = style.replace(/\/\*[\s\S]*?\*\//g, '');
    code.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
        assert.ok(/[{}:;,]|^<style>$|^[.\w#\[@]/.test(line),
            'this line is neither CSS nor a comment: ' + line);
    });
});

test('a phone control that must not be pressed is not rendered, not hidden', () => {
    // This one cost a day. Both duplicate controls were hidden with
    // `display: none` inside the shell, and they still fired: a tap anywhere on
    // a Role row arrived at the hidden delete button as a SYNTHESIZED click —
    // clientX/clientY 0,0, not a pointer — so every tap meant to open a Role
    // asked to delete it instead. getBoundingClientRect on the button read
    // 0,0,0x0 and elementFromPoint over the row returned the row's own name,
    // which is exactly why this was invisible from the outside.
    //
    // So the rule is: a control that must not be pressed on a phone does not
    // exist on a phone. An invisible control is still a control.
    const html = rolesManagerHtml();

    // A heading may be hidden — it does nothing when pressed. Anything that
    // ACTS may not be.
    [...html.matchAll(/html\.shell-mobile\s+\.([\w-]+)\s*{([^}]*)}/g)].forEach(([, hook, body]) => {
        if (!/display:\s*none/.test(body)) return;
        const tag = html.slice(html.lastIndexOf('<', html.indexOf('class="' + hook)));
        const opening = tag.slice(0, tag.indexOf('>'));
        assert.doesNotMatch(opening, /^<(button|a)\b|@click/,
            hook + ' is a control hidden by CSS — hidden is not the same as gone');
    });

    // NO gates left, and that is the end state rather than a regression. There
    // were two. The editor's back arrow stopped being gated when this page
    // joined the drawer — a hamburger cannot close a Role, so that arrow is the
    // only way out and always renders. The row's delete stopped being gated in
    // MS-234 because it stopped existing: delete moved into the open Role's own
    // head at every width, so there is no phone-only control left to gate.
    //
    // A gate coming back means a control has been put somewhere it has to be
    // taken away from again, which is the pattern this whole test distrusts.
    assert.equal((html.match(/x-if="!inShell"/g) || []).length, 0,
        'a control is being gated off the phone again — render it nowhere instead');

    // `inShell` itself still has to answer honestly: the page reads it for the
    // sign-in and permission gates, which send a WebView somewhere different.
    const page = window.RolesManager();
    global.MOSAIC_SHELL = 'mobile';
    try {
        assert.equal(page.inShell, true);
    } finally {
        delete global.MOSAIC_SHELL;
    }
    assert.equal(page.inShell, false, 'the web page would lose its own controls');
});

// ── The fairness fields (MS-170) ─────────────────────────────────────────────
//
// Three controls, and the one that matters most is a number that means nothing
// without its sentence: `4` is only legible as "four weeks before asking again".

const PEOPLE = {
    p1: { name: 'Ada Lovelace' },
    p2: { name: 'Grace Hopper' },
    p3: { name: 'Katherine Johnson' },
};

test('opening a Role shows the defaults rather than two empty controls', async () => {
    const page = await mountPage({ roles: { r1: coffeeDefinition() }, people: PEOPLE });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));

    assert.equal(page.draft.intensity, 1, 'a Role nobody has configured owes one week');
    assert.equal(page.draft.allowsAnotherRole, false, 'and uses up the morning');
});

test('intensity and exclusivity are stored on the Role', async () => {
    const page = await mountPage({ roles: { r1: coffeeDefinition() }, people: PEOPLE });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.intensity = 4;
    page.draft.allowsAnotherRole = true;
    await page.saveDraft();

    assert.equal(stored('roles').r1.intensity, 4);
    assert.equal(stored('roles').r1.allowsAnotherRole, true);
});

test('a cleared intensity box is refused, never silently saved as a free job', async () => {
    // A number input hands back '' when emptied, and Number('') is 0 — a REAL
    // intensity meaning the job costs nothing. Saving that silently would empty
    // the rest budget of whoever does it, so validation stops the save instead.
    const page = await mountPage({ roles: { r1: coffeeDefinition() }, people: PEOPLE });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.intensity = '';
    await page.saveDraft();

    assert.equal(stored('roles').r1.intensity, undefined, 'nothing was written');
    assert.match(page.draftErrors.join(' '), /intensity/i);
});

// ⚠ THE BUG THIS REPLACES. Plain `x-model` on a number input writes a STRING,
// and the model reads intensity strictly — so the moment anybody typed a new
// number the Role became unsaveable, with an error blaming the value they had
// just correctly entered.
test('a typed intensity saves, string or not', async () => {
    const page = await mountPage({ roles: { r1: coffeeDefinition() }, people: PEOPLE });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));

    page.draft.intensity = '1.2';           // what the box actually hands back
    assert.deepEqual(page.draftErrors, [], 'the number they typed is not a problem');

    await page.saveDraft();
    assert.equal(stored('roles').r1.intensity, 1.2, 'stored as a number, never a string');
});

test('an intensity that is not a number at all is still refused', async () => {
    const page = await mountPage({ roles: { r1: coffeeDefinition() }, people: PEOPLE });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));

    page.draft.intensity = 'soon';
    assert.match(page.draftErrors.join(' '), /intensity/i);

    page.draft.intensity = '-2';
    assert.match(page.draftErrors.join(' '), /negative/i);
});

test('intensity 0 is kept, because a free job is a real answer', async () => {
    const page = await mountPage({ roles: { r1: coffeeDefinition() }, people: PEOPLE });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.intensity = 0;
    await page.saveDraft();

    assert.equal(stored('roles').r1.intensity, 0);
});

// ── The allowlist ────────────────────────────────────────────────────────────

test('an allowlist is built from people and stored as one rule, not one per person', async () => {
    const page = await mountPage({ roles: { r1: coffeeDefinition() }, people: PEOPLE });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));

    page.newRuleKind = Roles.RESTRICTIONS.ALLOWLIST;
    page.newAllowlistPick = 'p1';
    page.addToNewAllowlist();
    page.newAllowlistPick = 'p3';
    page.addToNewAllowlist();
    page.addComposedRule();

    assert.deepStrictEqual(page.draft.restrictions, [
        { kind: 'allowlist', personIds: ['p1', 'p3'] },
    ]);
});

test('adding an allowlist replaces any earlier one — a Role has one list', async () => {
    const page = await mountPage({ roles: { r1: coffeeDefinition() }, people: PEOPLE });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.newRuleKind = Roles.RESTRICTIONS.ALLOWLIST;

    page.newAllowlistPick = 'p1';
    page.addToNewAllowlist();
    page.addComposedRule();

    page.newAllowlistPick = 'p2';
    page.addToNewAllowlist();
    page.addComposedRule();

    const lists = page.draft.restrictions.filter(r => r.kind === 'allowlist');
    assert.equal(lists.length, 1);
    assert.deepStrictEqual(lists[0].personIds, ['p2']);
});

test('an empty allowlist is refused rather than saved as a Role nobody can fill', async () => {
    const page = await mountPage({ roles: { r1: coffeeDefinition() }, people: PEOPLE });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.newRuleKind = Roles.RESTRICTIONS.ALLOWLIST;
    page.addComposedRule();

    assert.deepStrictEqual(page.draft.restrictions, []);
});

test('the same person cannot be added to an allowlist twice', async () => {
    const page = await mountPage({ people: PEOPLE });
    page.newAllowlistPick = 'p1';
    page.addToNewAllowlist();
    page.newAllowlistPick = 'p1';
    page.addToNewAllowlist();

    assert.deepStrictEqual(page.newAllowlist, ['p1']);
    assert.equal(page.allowlistOptions.some(o => o.id === 'p1'), false,
        'someone already picked is not offered again');
});

test('an allowlist reads as names, never as ids', async () => {
    // The names live in the chips, which are the editable list; the sentence
    // above them says what KIND of rule it is and does not repeat all eleven.
    const page = await mountPage({ people: PEOPLE });
    const rule = { kind: 'allowlist', personIds: ['p1', 'p2'] };

    assert.deepStrictEqual(page.allowlistNames(rule), ['Ada Lovelace', 'Grace Hopper']);
    assert.doesNotMatch(page.allowlistNames(rule).join(' '), /p1|p2/);
    assert.match(page.ruleSentence(rule), /only these people/i);
    assert.doesNotMatch(page.ruleSentence(rule), /p1|p2|personIds/);
});

test('a person who has left is SAID to be missing, not quietly dropped', async () => {
    // A shorter allowlist than the editor believes they have is how a Role
    // silently stops being fillable.
    const page = await mountPage({ people: PEOPLE });
    const names = page.allowlistNames({ kind: 'allowlist', personIds: ['p1', 'gone'] });

    assert.deepStrictEqual(names, ['Ada Lovelace', 'Someone no longer in the directory']);
});

test('an empty stored allowlist says so rather than reading as no rule', async () => {
    const page = await mountPage({ people: PEOPLE });
    assert.match(page.ruleSentence({ kind: 'allowlist', personIds: [] }), /nobody could ever fill/i);
    assert.equal(page.isRuleAvailable({ kind: 'allowlist', personIds: [] }), false);
});

// ── Editing an allowlist that already exists ─────────────────────────────────
//
// An allowlist is the one rule made of MANY things, and the only way to change
// it used to be to throw it away and name everybody again. Six months later,
// with one person joining the coffee rota, that is a list retyped from memory —
// and a name forgotten in the retyping is a Role that quietly stops offering
// somebody. So the list already on the Role is edited where it sits.

const withAllowlist = (...ids) => {
    const def = coffeeDefinition();
    def.restrictions = [{ kind: 'allowlist', personIds: ids }];
    return def;
};

const openWithAllowlist = async (...ids) => {
    const page = await mountPage({ roles: { r1: withAllowlist(...ids) }, people: PEOPLE });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    return page;
};

const listOf = page => page.draft.restrictions.find(r => r.kind === 'allowlist').personIds;

test('somebody can be added to a list that is already on the Role', async () => {
    const page = await openWithAllowlist('p1');
    page.addToAllowlistRule(0, 'p3');

    assert.deepStrictEqual(listOf(page), ['p1', 'p3']);
    await page.saveDraft();
    assert.deepStrictEqual(stored('roles').r1.restrictions, [
        { kind: 'allowlist', personIds: ['p1', 'p3'] },
    ]);
});

test('somebody can be taken off a list that is already on the Role', async () => {
    const page = await openWithAllowlist('p1', 'p2', 'p3');
    page.removeFromAllowlistRule(0, 'p2');

    assert.deepStrictEqual(listOf(page), ['p1', 'p3']);
    await page.saveDraft();
    assert.deepStrictEqual(stored('roles').r1.restrictions, [
        { kind: 'allowlist', personIds: ['p1', 'p3'] },
    ]);
});

test('editing the list leaves the Role\'s other rules alone', async () => {
    const def = withAllowlist('p1');
    def.restrictions.unshift({ kind: 'requireTag', tagId: KIDS_CLEARED });
    const page = await mountPage({ roles: { r1: def }, people: PEOPLE });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));

    page.addToAllowlistRule(1, 'p2');
    assert.deepStrictEqual(page.draft.restrictions, [
        { kind: 'requireTag', tagId: KIDS_CLEARED },
        { kind: 'allowlist', personIds: ['p1', 'p2'] },
    ]);
});

test('the picker for a list offers only people not already on it', async () => {
    const page = await openWithAllowlist('p1');
    const offered = page.allowlistOptionsFor(page.draft.restrictions[0]).map(p => p.id);

    assert.deepStrictEqual(offered.sort(), ['p2', 'p3']);
});

test('the same person cannot be added to an existing list twice', async () => {
    const page = await openWithAllowlist('p1');
    page.addToAllowlistRule(0, 'p1');
    assert.deepStrictEqual(listOf(page), ['p1']);
});

test('the list reads as names, and a person who has left can be cleared off it', async () => {
    // Before this, a name that had left the directory was a dead entry an
    // editor could see and not remove without rebuilding the whole list.
    const page = await openWithAllowlist('p1', 'gone');
    assert.deepStrictEqual(
        page.allowlistNames(page.draft.restrictions[0]),
        ['Ada Lovelace', 'Someone no longer in the directory']
    );

    page.removeFromAllowlistRule(0, 'gone');
    assert.deepStrictEqual(listOf(page), ['p1']);
});

test('taking the last person off is refused, and says which control means that', async () => {
    // An empty allowlist is a Role nobody can ever fill. Removing the RULE is
    // how you say "anyone" — and that control is right there, so the refusal
    // points at it instead of leaving a Role that cannot be saved.
    const page = await openWithAllowlist('p1');
    page.removeFromAllowlistRule(0, 'p1');

    assert.deepStrictEqual(listOf(page), ['p1'], 'the list was emptied');
    assert.equal(page.toast.type, 'error');
    assert.match(page.toast.message, /remove the rule/i);
});

test('editing anything other than an allowlist does nothing', async () => {
    // The index comes from the rendered list; a stale one must not turn a tag
    // rule into a list of people.
    const page = await mountPage({ roles: { r1: kidsDefinition() }, people: PEOPLE });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.addTagRule(Roles.RESTRICTIONS.REQUIRE_TAG, KIDS_CLEARED);

    page.addToAllowlistRule(0, 'p1');
    page.removeFromAllowlistRule(0, 'p1');
    assert.deepStrictEqual(page.draft.restrictions, [{ kind: 'requireTag', tagId: KIDS_CLEARED }]);
});

// ── Liturgical intensity ─────────────────────────────────────────────────────

test('a liturgical Role with nothing set reads as one week', async () => {
    const page = await mountPage({});
    assert.equal(page.liturgicalIntensity('preacher'), 1);
});

test('liturgical intensity is written to the Event series, never to /roles', async () => {
    const page = await mountPage({ events: { sunday_service: { id: 'sunday_service', name: 'Sunday Service' } } });
    await page.setLiturgicalIntensity('preacher', 3);

    assert.equal(stored('events').sunday_service.liturgicalIntensity.preacher, 3);
    assert.equal(Object.keys(stored('roles')).length, 0,
        'a document in /roles would make a locked Role editable (ADR-0016)');
    assert.equal(page.liturgicalIntensity('preacher'), 3, 'and the screen matches what was stored');
});

test('setting one liturgical intensity leaves the others alone', async () => {
    const page = await mountPage({
        events: { sunday_service: { id: 'sunday_service', liturgicalIntensity: { prayer: 2 } } },
    });
    await page.setLiturgicalIntensity('preacher', 3);

    assert.equal(stored('events').sunday_service.liturgicalIntensity.prayer, 2);
    assert.equal(stored('events').sunday_service.liturgicalIntensity.preacher, 3);
});

test('a negative liturgical intensity is refused and nothing is written', async () => {
    const page = await mountPage({ events: { sunday_service: { id: 'sunday_service' } } });
    await page.setLiturgicalIntensity('preacher', -1);

    assert.equal(stored('events').sunday_service.liturgicalIntensity, undefined);
});

test('liturgical Roles are still refused by the editor — intensity is the only exception', async () => {
    const page = await mountPage({});
    page.startEdit(page.liturgicalRoles[0]);
    assert.equal(page.draft, null, 'the lock holds everywhere else');
});

// ── Who does not serve ──────────────────────────────────────────────────────
//
// ⚠ A FACT ABOUT THE PERSON, so it lives on their record. A Role's allowlist
// answers "who may do THIS"; this answers "who does none of it", and copying
// that onto each Role is how the two go out of step the next time a Role is
// added.

test('marking somebody as not serving writes it on the person, not on a Role', async () => {
    const page = await mountPage({ roles: { r1: coffeeDefinition() }, people: PEOPLE });

    await page.setDoesNotServe('p2', true);

    assert.equal(stored('people').p2.doesNotServe, true);
    assert.equal(stored('roles').r1.restrictions.length, 0,
        'no Role was touched — the next Role added would not have got the copy');
    assert.deepStrictEqual(page.nonServers.map(p => p.id), ['p2'],
        'and the screen matches without a re-read');
});

test('putting somebody back is the same one field', async () => {
    const page = await mountPage({
        roles: { r1: coffeeDefinition() },
        people: { ...PEOPLE, p2: { name: 'Grace Hopper', doesNotServe: true } },
    });
    assert.deepStrictEqual(page.nonServers.map(p => p.id), ['p2']);

    await page.setDoesNotServe('p2', false);

    assert.equal(stored('people').p2.doesNotServe, false);
    assert.deepStrictEqual(page.nonServers, []);
});

// A search, not a dropdown of the whole church: the list it adds to is short
// and the church is not.
test('the search finds people who are not on the list already', async () => {
    const page = await mountPage({
        roles: { r1: coffeeDefinition() },
        people: { ...PEOPLE, p2: { name: 'Grace Hopper', doesNotServe: true } },
    });

    page.nonServerSearch = 'grace';
    assert.deepStrictEqual(page.nonServerMatches, [], 'already on it');

    page.nonServerSearch = 'ada';
    assert.deepStrictEqual(page.nonServerMatches.map(p => p.id), ['p1']);

    page.nonServerSearch = '';
    assert.deepStrictEqual(page.nonServerMatches, [],
        'an empty box offers the whole church, which is not an offer');
});

test('a write that fails changes nothing on screen', async () => {
    const page = await mountPage(
        { roles: { r1: coffeeDefinition() }, people: PEOPLE },
        { deny: ['people'] }
    );

    await page.setDoesNotServe('p2', true);

    assert.deepStrictEqual(page.nonServers, []);
    assert.equal(page.savingNonServer, '', 'and the control is usable again');
});
