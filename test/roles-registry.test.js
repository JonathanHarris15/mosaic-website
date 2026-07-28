const { test } = require('node:test');
const assert = require('node:assert');

const Roles = require('../public/roles-core.js');

// The locked half of the Role model (ADR-0016 §1, Option A). Liturgical Roles
// are code-defined: undeletable, uneditable, and still wired into the Service
// entity and the Service Guide. Unifying them with Servant Roles is a matter of
// ONE roles list and one Roles tab — not of rebuilding the plumbing that prints
// the weekly booklet.

const coffee = Object.assign(Roles.newDefinition('Coffee'), { id: 'r-coffee' });
const kids = Object.assign(Roles.newDefinition('Kids Ministry'), { id: 'r-kids' });

// ── What the liturgical Roles are ─────────────────────────────────────────────

test('the liturgical Roles are the six the app already writes as Involvement', () => {
    assert.deepEqual(
        Roles.LITURGICAL_ROLES.map(r => r.slug),
        ['service_leader', 'preacher', 'worship_leader', 'worship_helper', 'sermonette', 'prayer']
    );
});

test('every liturgical Role is marked locked and in the liturgical family', () => {
    Roles.LITURGICAL_ROLES.forEach(role => {
        assert.equal(role.family, Roles.FAMILIES.LITURGICAL, role.slug);
        assert.equal(role.locked, true, role.slug);
    });
});

test('display names match what the UI already shows', () => {
    // These are user-facing strings the Service Guide and calendar already use;
    // renaming them here would silently rename them on the printed booklet.
    const nameOf = slug => Roles.LITURGICAL_ROLES.find(r => r.slug === slug).name;
    assert.equal(nameOf('worship_leader'), 'Music Leader');
    assert.equal(nameOf('worship_helper'), 'Music Helper');
    assert.equal(nameOf('service_leader'), 'Service Leader');
    assert.equal(nameOf('preacher'), 'Preacher');
});

test('the liturgical Roles cannot be mutated through the exported array', () => {
    const count = Roles.LITURGICAL_ROLES.length;
    const firstName = Roles.LITURGICAL_ROLES[0].name;

    // Frozen, so a stray write is a no-op in sloppy mode and a throw in strict —
    // assert the guarantee itself rather than the mode-dependent symptom.
    try { Roles.LITURGICAL_ROLES.push({ slug: 'sneaky' }); } catch (e) { /* strict mode */ }
    try { Roles.LITURGICAL_ROLES[0].name = 'Renamed'; } catch (e) { /* strict mode */ }

    assert.equal(Roles.LITURGICAL_ROLES.length, count);
    assert.equal(Roles.LITURGICAL_ROLES[0].name, firstName);
});

// ── One list, both families ───────────────────────────────────────────────────

test('allRoles answers "what Roles exist" across both families', () => {
    const all = Roles.allRoles([coffee, kids]);

    assert.equal(all.length, Roles.LITURGICAL_ROLES.length + 2);
    assert.deepEqual(
        all.filter(r => r.family === Roles.FAMILIES.SERVANT).map(r => r.name),
        ['Coffee', 'Kids Ministry']
    );
});

test('allRoles puts the liturgical Roles first, in their liturgical order', () => {
    const all = Roles.allRoles([coffee]);
    assert.deepEqual(
        all.slice(0, 6).map(r => r.slug),
        Roles.LITURGICAL_ROLES.map(r => r.slug)
    );
});

test('every Role in the combined list carries its family flag', () => {
    Roles.allRoles([coffee]).forEach(role => {
        assert.ok(
            role.family === Roles.FAMILIES.LITURGICAL || role.family === Roles.FAMILIES.SERVANT,
            'each Role must declare its family: ' + JSON.stringify(role)
        );
    });
});

test('allRoles with no Servant Roles is just the liturgical ones', () => {
    assert.equal(Roles.allRoles([]).length, Roles.LITURGICAL_ROLES.length);
    assert.equal(Roles.allRoles().length, Roles.LITURGICAL_ROLES.length);
});

test('a Servant Role Definition gets a slug so both families key the same way', () => {
    // Involvement records a Role by slug; a Servant Role needs one too or it
    // could not be written as Involvement at all.
    const all = Roles.allRoles([coffee]);
    const found = all.find(r => r.name === 'Coffee');
    assert.ok(found.slug, 'a Servant Role needs a slug');
});

test('a Servant Role may not squat on a liturgical slug', () => {
    const impostor = Object.assign(Roles.newDefinition('Preacher'), { id: 'r-fake' });
    assert.throws(() => Roles.allRoles([impostor]), /preacher/i);
});

// ── Lookup ────────────────────────────────────────────────────────────────────

test('a Role can be found by slug across both families', () => {
    assert.equal(Roles.roleBySlug('preacher', [coffee]).name, 'Preacher');
    assert.equal(Roles.roleBySlug('coffee', [coffee]).name, 'Coffee');
});

test('an unknown slug resolves to null rather than throwing', () => {
    assert.equal(Roles.roleBySlug('nope', [coffee]), null);
});

// ── Locked means locked ───────────────────────────────────────────────────────

test('a liturgical Role reports as locked and a Servant Role does not', () => {
    assert.equal(Roles.isLocked(Roles.roleBySlug('preacher', [])), true);
    assert.equal(Roles.isLocked(coffee), false);
});

test('editing a locked Role is rejected by the model, not just hidden in the UI', () => {
    const preacher = Roles.roleBySlug('preacher', []);
    assert.throws(() => Roles.addSlot(preacher, Roles.REQUIREMENTS.EITHER), /locked/i);
    assert.throws(() => Roles.removeSlot(preacher, 's1'), /locked/i);
    assert.throws(() => Roles.reorderSlots(preacher, 0, 1), /locked/i);
    assert.throws(
        () => Roles.setSlotRequirement(preacher, 's1', Roles.REQUIREMENTS.MALE),
        /locked/i
    );
});

test('deleting a locked Role is rejected', () => {
    assert.throws(() => Roles.assertDeletable(Roles.roleBySlug('preacher', [])), /locked/i);
});

test('deleting a Servant Role is allowed', () => {
    assert.doesNotThrow(() => Roles.assertDeletable(coffee));
});

test('a Servant Role is still freely editable', () => {
    assert.doesNotThrow(() => Roles.addSlot(coffee, Roles.REQUIREMENTS.MALE));
});

// ── The liturgical Roles keep working as they always did ──────────────────────

test('a liturgical Role is a valid target for Involvement without a definition', () => {
    // Liturgical Roles have no editable definition — no slots, no restrictions.
    // They are assigned through the Service entity as they always have been.
    const preacher = Roles.roleBySlug('preacher', []);
    assert.equal(preacher.slots, undefined);
    assert.equal(preacher.restrictions, undefined);
});
