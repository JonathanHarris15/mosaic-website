const { test } = require('node:test');
const assert = require('node:assert/strict');

const Levels = require('../public/account-levels-core.js');
const Access = require('../public/access-core.js');

const LEVELS = [
    'viewer', 'member', 'editor', 'pastoral_assistant', 'elder', 'admin', 'super_admin', 'kiosk',
];

test('built-in presets match AccessCore for every permission level', () => {
    LEVELS.forEach(level => {
        const account = { permissionLevel: level };
        const migrated = Levels.migrateLegacyUser(account);
        const withPerms = {
            permissionLevel: migrated.permissionLevel,
            accountLevelId: migrated.accountLevelId,
            permissions: migrated.permissions,
        };
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

test('Editor preset does not grant calendar.events.edit', () => {
    const perms = Levels.buildPresetPermissions('editor');
    assert.equal(perms['calendar.events.edit'], false);
    assert.equal(perms['shep.dashboard.view'], false);
});

test('legacy pastoralAssistant grant migrates to PA-effective permissions', () => {
    const migrated = Levels.migrateLegacyUser({ permissionLevel: 'member', pastoralAssistant: true });
    const account = {
        permissionLevel: migrated.permissionLevel,
        pastoralAssistant: migrated.pastoralAssistant,
        permissions: migrated.permissions,
    };
    assert.equal(Access.readsAsElder(account), true);
    assert.equal(Access.isAnElder(account), false);
    assert.equal(Access.canDecide(account), true);
});

test('assigning Pastoral Assistant writes that rung and an elder\'s doors', () => {
    const levelDoc = {
        presetKey: 'member',
        custom: true,
        permissions: Levels.buildPresetPermissions('member'),
    };
    const write = Levels.userWriteFromLevel('level_pastoral_assistant', levelDoc);
    assert.equal(write.permissionLevel, 'pastoral_assistant');
    assert.equal(write.role, 'pastoral_assistant');
    assert.equal(write.pastoralAssistant, false);
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
    assert.equal(Levels.canonicalPermissionLevel(stuck), 'pastoral_assistant');
    assert.equal(Access.readsAsElder(stuck), true);
    assert.equal(Access.canDecide(stuck), true);
    assert.equal(Access.writesAsEditor(stuck), true);
    assert.equal(Access.isAnElder(stuck), false);
    assert.equal(Access.permissionLevelOf(stuck), 'pastoral_assistant');

    const mapOnly = {
        permissionLevel: 'member',
        permissions: pa,
        pastoralAssistant: false,
    };
    assert.equal(Access.permissionLevelOf(mapOnly), 'pastoral_assistant');
    assert.equal(Access.readsAsElder(mapOnly), true);
    assert.equal(Access.isAnElder(mapOnly), false);

    const rawId = { permissionLevel: 'level_pastoral_assistant' };
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
