const { test } = require('node:test');
const assert = require('node:assert/strict');

const Levels = require('../public/account-levels-core.js');
const Access = require('../public/access-core.js');

const LEVELS = [
    'viewer', 'member', 'editor', 'pastoral_assistant', 'elder', 'admin', 'super_admin', 'kiosk',
];

test('built-in presets match AccessCore for every permission level', () => {
    LEVELS.forEach(level => {
        const withPerms = Levels.userWriteFromLevel(Levels.accountLevelIdForPreset(level));
        assert.equal(Access.isAnElder(withPerms), Access.isAnElder(level), level + ' isAnElder');
        assert.equal(Access.readsAsElder(withPerms), Access.readsAsElder(level), level + ' readsAsElder');
        assert.equal(Access.writesAsEditor(withPerms), Access.writesAsEditor(level), level + ' writesAsEditor');
        assert.equal(Access.canDecide(withPerms), Access.canDecide(level), level + ' canDecide');
        assert.deepEqual(Access.eventRungsFor(withPerms), Access.eventRungsFor(level), level + ' rungs');
    });
});

test('Pastoral Assistant preset locks count_as_elder and be_assignee off', () => {
    const perms = Levels.buildPresetPermissions('pastoral_assistant');
    assert.equal(perms['shep.count_as_elder'], false);
    assert.equal(perms['shep.elder_assignment.be_assignee'], false);
    assert.equal(perms['shep.tags.manage'], true);
    assert.equal(perms['admin.dashboard.access'], false);
});

test('Editor preset grants calendar.events.edit (MS-725, Helm option A)', () => {
    const perms = Levels.buildPresetPermissions('editor');
    assert.equal(perms['calendar.events.edit'], true);
    assert.equal(perms['shep.dashboard.view'], false);
    const admin = Levels.buildPresetPermissions('admin');
    assert.equal(admin['calendar.events.edit'], true);
});

test('a stored pastoralAssistant flag does not become the Pastoral Assistant preset', () => {
    const legacy = { permissionLevel: 'member', pastoralAssistant: true, role: 'member' };
    assert.equal(Access.readsAsElder(legacy), false);
    assert.equal(Access.isAnElder(legacy), false);
    assert.equal(Access.canDecide(legacy), false);
    assert.equal(Access.permissionLevelOf(legacy), 'viewer');
});

test('assigning Pastoral Assistant writes that rung and an elder\'s doors', () => {
    const levelDoc = {
        presetKey: 'member',
        custom: true,
        permissions: Levels.buildPresetPermissions('member'),
    };
    const write = Levels.userWriteFromLevel('level_pastoral_assistant', levelDoc);
    assert.equal(write.accountLevelId, 'level_pastoral_assistant');
    assert.equal(write.permissionLevel, undefined);
    assert.equal(write.role, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(write, 'pastoralAssistant'), false);
    assert.equal(write.permissions['visibility.lift_hidden_tags'], true);
    assert.equal(write.permissions['shep.tags.manage'], true);
    assert.equal(write.permissions['shep.notes.write'], true);
    assert.equal(write.permissions['shep.count_as_elder'], false);
    assert.equal(write.permissions['shep.elder_assignment.be_assignee'], false);
    const elder = Levels.buildPresetPermissions('elder');
    const onlyElder = Object.keys(elder).filter(k => elder[k] && !write.permissions[k]);
    assert.deepEqual(onlyElder, ['shep.count_as_elder', 'shep.elder_assignment.be_assignee']);
});

test('a Member string with a Pastoral Assistant assignment is not a Member', () => {
    const pa = Levels.buildPresetPermissions('pastoral_assistant');
    const stuck = {
        permissionLevel: 'member',
        role: 'member',
        accountLevelId: 'level_pastoral_assistant',
        permissions: Levels.buildPresetPermissions('member'),
        pastoralAssistant: false,
    };
    // The saved map is the whole answer, so a member map stays a member
    // even when accountLevelId still names Pastoral Assistant.
    assert.equal(Levels.canonicalPermissionLevel(stuck), 'member');
    assert.equal(Access.readsAsElder(stuck), false);
    assert.equal(Access.canDecide(stuck), false);
    assert.equal(Access.writesAsEditor(stuck), false);
    assert.equal(Access.isAnElder(stuck), false);
    assert.equal(Access.permissionLevelOf(stuck), 'member');

    const mapOnly = {
        permissionLevel: 'member',
        permissions: pa,
        pastoralAssistant: false,
    };
    assert.equal(Access.permissionLevelOf(mapOnly), 'pastoral_assistant');
    assert.equal(Access.readsAsElder(mapOnly), true);
    assert.equal(Access.isAnElder(mapOnly), false);

    const rawId = { accountLevelId: 'level_pastoral_assistant' };
    assert.equal(Access.permissionLevelOf(rawId), 'pastoral_assistant');
    assert.equal(Access.readsAsElder(rawId), true);
    assert.equal(Access.isAnElder(rawId), false);
});

test('accountLevelId round-trips for built-in presets', () => {
    LEVELS.forEach(level => {
        const id = Levels.accountLevelIdForPreset(level);
        assert.equal(Levels.presetKeyFromAccountLevelId(id), level);
    });
});
