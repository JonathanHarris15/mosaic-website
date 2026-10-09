const { test } = require('node:test');
const assert = require('node:assert/strict');
const Access = require('../public/access-core.js');
const Levels = require('../public/account-levels-core.js');

// MS-725 (ADR 0082): canEditEvents mirrors firestore.rules
// editsWith('calendar.events.edit') clause for clause —
//
//     hasPermission(key) || (!usesPermissionMap() && isEditor())
//
// so a saved permission map is the whole answer, and only an account that has
// never been through Admin → Accounts falls back to the editor level names.
//
// Helm option A: the Editor preset now carries calendar.events.edit, so a
// newly saved Editor map admits the calendar doors. Accounts saved before
// that change still have the old map until the backfill runs.

const saved = (preset) => Levels.userWriteFromLevel(
    Levels.accountLevelIdForPreset(preset));

const custom = (perms, level) => Object.assign(
    Levels.userWriteFromLevel('level_custom_x', {
        custom: true, presetKey: 'member',
        permissions: Object.assign({}, Levels.buildPresetPermissions('member'), perms),
    }), level ? { permissionLevel: level, role: level } : {});

test('saved presets: the map decides', () => {
    for (const p of ['editor', 'admin', 'elder', 'super_admin', 'pastoral_assistant']) {
        assert.equal(Access.canEditEvents(saved(p)), true, p);
    }
    for (const p of ['member', 'viewer', 'kiosk']) {
        assert.equal(Access.canEditEvents(saved(p)), false, p);
    }
});

test('a custom Member-based level with calendar.events.edit may', () => {
    assert.equal(Access.canEditEvents(custom({ 'calendar.events.edit': true })), true);
});

test('a custom level with only roles.manager.edit may not (rules would refuse)', () => {
    assert.equal(Access.canEditEvents(custom({ 'roles.manager.edit': true })), false);
});

test('revoking the key revokes, even when the stored level says editor', () => {
    const revoked = custom({ 'calendar.events.edit': false }, 'editor');
    assert.equal(revoked.permissionLevel, 'editor');
    assert.equal(Access.canEditEvents(revoked), false);
});

test('legacy accounts without a saved map: the editor level names', () => {
    assert.equal(Access.canEditEvents('editor'), true);
    assert.equal(Access.canEditEvents('pastoral_assistant'), true);
    assert.equal(Access.canEditEvents('member'), false);
    assert.equal(Access.canEditEvents(null), false);
    assert.equal(Access.canEditEvents({ permissionLevel: 'editor' }), true);
    assert.equal(Access.canEditEvents({ role: 'admin' }), true);
    assert.equal(
        Access.canEditEvents({ permissionLevel: 'member', pastoralAssistant: true }), true);
});
