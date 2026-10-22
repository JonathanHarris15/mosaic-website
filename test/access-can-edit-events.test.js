const { test } = require('node:test');
const assert = require('node:assert/strict');
const Access = require('../public/access-core.js');
const Levels = require('../public/account-levels-core.js');

// MS-725 / MS-776: canEditEvents is the calendar.events.edit key. A rank-label
// string is that builtin preset. A stored permissionLevel, role, or
// pastoralAssistant flag grants nothing.
//
// Helm option A: the Editor preset carries calendar.events.edit, so a builtin
// Editor account and the string 'editor' admit the calendar doors.

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

test('a rank label and a builtin editor account edit; a stored level name does not', () => {
    assert.equal(Access.canEditEvents('editor'), true);
    assert.equal(Access.canEditEvents(saved('editor')), true);
    assert.equal(Access.canEditEvents('pastoral_assistant'), true);
    assert.equal(Access.canEditEvents(saved('pastoral_assistant')), true);
    assert.equal(Access.canEditEvents('member'), false);
    assert.equal(Access.canEditEvents(null), false);
    assert.equal(Access.canEditEvents({ permissionLevel: 'editor' }), false);
    assert.equal(Access.canEditEvents({ role: 'admin' }), false);
    assert.equal(
        Access.canEditEvents({ permissionLevel: 'member', pastoralAssistant: true }), false);
});
