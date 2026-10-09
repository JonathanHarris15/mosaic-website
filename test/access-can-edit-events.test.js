const { test } = require('node:test');
const assert = require('node:assert/strict');
const Access = require('../public/access-core.js');
const Levels = require('../public/account-levels-core.js');

// MS-720: canEditEvents mirrors firestore.rules editsWith('calendar.events.edit')
// (MS-722) — the key, OR the editor level names. Not the key alone: the
// Editor preset does not carry it, and editors have always edited events.

const user = (preset) => Levels.userWriteFromLevel(Levels.accountLevelIdForPreset(preset));
const custom = (perms, level) => Object.assign(
    Levels.userWriteFromLevel('level_custom_x', {
        custom: true, presetKey: 'member',
        permissions: Object.assign({}, Levels.buildPresetPermissions('member'), perms),
    }), level ? { permissionLevel: level, role: level } : {});

test('seeded presets', () => {
    for (const p of ['editor', 'elder', 'super_admin', 'admin', 'pastoral_assistant']) {
        assert.equal(Access.canEditEvents(user(p)), true, p);
    }
    for (const p of ['member', 'viewer', 'kiosk']) {
        assert.equal(Access.canEditEvents(user(p)), false, p);
    }
});

test('a custom Member-based level with calendar.events.edit may', () => {
    assert.equal(Access.canEditEvents(custom({ 'calendar.events.edit': true })), true);
});

test('a custom level with only roles.manager.edit may not (rules would refuse)', () => {
    assert.equal(Access.canEditEvents(custom({ 'roles.manager.edit': true })), false);
});

test('legacy accounts without a map: the editor level names', () => {
    assert.equal(Access.canEditEvents('editor'), true);
    assert.equal(Access.canEditEvents('pastoral_assistant'), true);
    assert.equal(Access.canEditEvents('member'), false);
    assert.equal(Access.canEditEvents(null), false);
});
