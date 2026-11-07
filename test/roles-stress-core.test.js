const { test } = require('node:test');
const assert = require('node:assert');
const RolesCore = require('../public/roles-core.js');

// Stress round on the Roles system (Nov 2026). slugify keeps a-z and 0-9 and
// drops everything else, so a Role named in any other script gets an EMPTY
// slug, and validateDefinition still calls it valid. Every callable then
// refuses that Role ("Missing the place"), and a second such Role collides.

test('a Role named outside a-z still gets a usable slug', { todo: 'slugify drops every non-ASCII letter' }, () => {
    for (const name of ['음향', 'Ушеры', 'Música', '???']) {
        const def = RolesCore.newDefinition(name);
        const check = RolesCore.validateDefinition(def);
        assert.ok(def.slug || !check.valid, `"${name}" got slug "${def.slug}" and was still valid`);
    }
});

test('two different names do not share a slug', { todo: 'Café and Caf collide; Kids 2–5 and Kids (2-5) collide' }, () => {
    assert.notEqual(RolesCore.slugify('Café'), RolesCore.slugify('Caf'));
});

// roles-core says slot ids are never re-issued, because an Assignment points
// at one. nextSlotId reads the highest id still present, so removing the last
// slot and adding another hands the old id to a slot with a new requirement.
test('a removed slot\'s id is never handed out again', { todo: 'nextSlotId uses the highest id present' }, () => {
    let def = RolesCore.newDefinition('Kids');
    def = RolesCore.addSlot(def, 'either');
    def = RolesCore.addSlot(def, 'either');
    const gone = def.slots[def.slots.length - 1].id;
    def = RolesCore.removeSlot(def, gone);
    def = RolesCore.addSlot(def, 'female');
    assert.equal(def.slots.some(s => s.id === gone), false, `slot ${gone} was re-issued`);
});
