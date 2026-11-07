const { test } = require('node:test');
const assert = require('node:assert');
const RolesCore = require('../public/roles-core.js');

// Stress round on the Roles system (Nov 2026). slugify keeps a-z and 0-9 and
// drops everything else, so a Role named in any other script gets an EMPTY
// slug, and validateDefinition still calls it valid. Every callable then
// refuses that Role ("Missing the place"), and a second such Role collides.

test('a Role named outside a-z still gets a usable slug (MS-822)', () => {
    for (const name of ['음향', 'Ушеры', 'Música', '???']) {
        const def = RolesCore.newDefinition(name);
        const check = RolesCore.validateDefinition(def);
        assert.ok(def.slug || !check.valid, `"${name}" got slug "${def.slug}" and was still valid`);
    }
});

test('two different names do not share a slug (MS-822)', () => {
    assert.notEqual(RolesCore.slugify('Café'), RolesCore.slugify('Caf'));
    assert.notEqual(RolesCore.slugify('음향'), RolesCore.slugify('Ушеры'));
});

test('accents fold and other scripts get a stable id (MS-822)', () => {
    assert.equal(RolesCore.slugify('Música'), 'musica');
    assert.equal(RolesCore.slugify('Café'), 'cafe');
    assert.match(RolesCore.slugify('음향'), /^role_[a-z0-9]+$/);
    assert.equal(RolesCore.slugify('음향'), RolesCore.slugify('음향'), 'the same name, the same slug');
});

test('ASCII names slug exactly as before (MS-822)', () => {
    assert.equal(RolesCore.slugify('Kids Ministry'), 'kids_ministry');
    assert.equal(RolesCore.slugify('  Set-up & Tear-down  '), 'set_up_tear_down');
    assert.equal(RolesCore.slugify(''), '');
});

test('a stored empty or unusable slug is refused (MS-822)', () => {
    const def = RolesCore.newDefinition('Ushers');
    assert.equal(RolesCore.validateDefinition(Object.assign({}, def, { slug: '' })).valid, false);
    assert.equal(RolesCore.validateDefinition(Object.assign({}, def, { slug: 'a/b' })).valid, false);
    assert.equal(RolesCore.validateDefinition(def).valid, true);
});

// roles-core says slot ids are never re-issued, because an Assignment points
// at one. nextSlotId reads the highest id still present, so removing the last
// slot and adding another hands the old id to a slot with a new requirement.
test('a removed slot\'s id is never handed out again (MS-823)', () => {
    let def = RolesCore.newDefinition('Kids');
    def = RolesCore.addSlot(def, 'either');
    def = RolesCore.addSlot(def, 'either');
    const gone = def.slots[def.slots.length - 1].id;
    def = RolesCore.removeSlot(def, gone);
    def = RolesCore.addSlot(def, 'female');
    assert.equal(def.slots.some(s => s.id === gone), false, `slot ${gone} was re-issued`);
});

test('a Role stored before the counter keeps working (MS-823)', () => {
    const old = { name: 'Old', slug: 'old', family: 'servant', restrictions: [],
        slots: [{ id: 's1', requirement: 'either' }, { id: 's4', requirement: 'either' }] };
    const next = RolesCore.addSlot(old, 'either');
    assert.deepEqual(next.slots.map(s => s.id), ['s1', 's4', 's5']);
    assert.equal(next.nextSlotSeq, 6);
});
