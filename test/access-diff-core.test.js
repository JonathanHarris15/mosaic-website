const {test} = require('node:test');
const assert = require('node:assert/strict');

const Core = require('../scripts/access-diff-core.js');
const Levels = require('../public/account-levels-core.js');
const Catalog = require('../public/permission-catalog.js');

/**
 * @param {Record<string, unknown>} user
 */
function diff(user) {
    return Core.diffAccount(user);
}

test('every catalog key is classified for the client-loss gate', () => {
    for (const key of Catalog.PERMISSION_KEYS) {
        assert.ok(Object.prototype.hasOwnProperty.call(Core.KEY_PAIR, key), key);
    }
});

test('a saved builtin account neither loses nor gains a door', () => {
    // Prod documents still carry the ladder strings the backfill left in
    // place. The frozen pre-cutover columns read those strings. A write that
    // only has accountLevelId and permissions is a gain against that freeze,
    // which is not how the live accounts look.
    for (const preset of Levels.BUILTIN_PRESET_KEYS) {
        const user = Object.assign(
            {},
            Levels.userWriteFromLevel(Levels.accountLevelIdForPreset(preset)),
            { permissionLevel: preset, role: preset },
        );
        const result = diff(user);
        assert.deepEqual(result.blocking, [], preset + ' blocking ' + result.blocking.join(', '));
        assert.deepEqual(result.gains, [], preset + ' gains ' + result.gains.join(', '));
    }
});

test('a legacy editor with only permissionLevel loses the doors the ladder still opens', () => {
    const result = diff({permissionLevel: 'editor', role: 'editor'});
    assert.ok(result.blocking.includes('firestore write.calendar.events.edit'));
    assert.ok(result.blocking.includes('firestore isEditor'));
    assert.ok(result.blocking.includes('storage isEditor'));
    assert.ok(result.blocking.includes('rankOf see.editor'));
    // The client now refuses the ladder too, so it is not a client loss.
    assert.equal(result.blocking.includes('client isEditor'), false);
});

test('a role-only editor is the same loss as a permissionLevel editor', () => {
    const result = diff({role: 'editor'});
    assert.equal(Core.storedLevel({role: 'editor'}), 'editor');
    assert.ok(result.blocking.includes('firestore isEditor'));
    assert.ok(result.blocking.includes('rankOf see.editor'));
});

test('a saved map that turns calendar.events.edit off is already refused by the rules', () => {
    const editor = Levels.userWriteFromLevel(Levels.accountLevelIdForPreset('editor'));
    editor.permissions = Object.assign({}, editor.permissions, { 'calendar.events.edit': false });
    editor.permissionLevel = 'editor';
    editor.role = 'editor';
    const result = diff(editor);
    assert.equal(Core.firestoreDoors(editor)['write.calendar.events.edit'], false);
    assert.equal(Core.canonicalDoors(editor)['write.calendar.events.edit'], false);
    assert.equal(result.blocking.includes('firestore write.calendar.events.edit'), false);
    assert.equal(result.noted.some((line) => line.indexOf('key.calendar.events.edit') !== -1), false);
});

test('pastoralAssistant on a member with no map loses the flag doors', () => {
    const user = {permissionLevel: 'member', role: 'member', pastoralAssistant: true};
    const result = diff(user);
    assert.ok(result.blocking.includes('firestore isEditor'));
    assert.ok(result.blocking.includes('firestore readsAsElder'));
    assert.ok(result.blocking.includes('firestore write.calendar.events.edit'));
    assert.ok(result.blocking.includes('storage isEditor'));
    assert.ok(result.blocking.includes('storage see.elder'));
    assert.ok(result.blocking.includes('formRank see.elder'));
    assert.equal(result.blocking.includes('rankOf see.elder'), false);
});

test('permissionLevel pastoral_assistant with the builtin id keeps the same doors', () => {
    const user = {
        permissionLevel: 'pastoral_assistant',
        role: 'pastoral_assistant',
        accountLevelId: 'level_pastoral_assistant',
    };
    const result = diff(user);
    assert.deepEqual(result.blocking, [], result.blocking.join(', '));
    assert.equal(Core.firestoreDoors(user).isPastoralAssistant, true);
    assert.equal(Core.canonicalDoors(user).isPastoralAssistant, true);
    assert.equal(Core.firestoreDoors(user).countsAsElder, false);
    assert.equal(Core.canonicalDoors(user).countsAsElder, false);
    assert.equal(Core.canonicalDoors(user)['write.calendar.events.edit'], true);
});

test('a sparse super-admin map keeps Storage writes and only gains Firestore keys', () => {
    const user = {
        permissionLevel: 'member',
        role: 'member',
        accountLevelId: 'level_super_admin',
        permissions: {'system.super_admin': true},
    };
    const result = diff(user);
    assert.equal(Core.storageDoors(user)['write.printables.edit'], true);
    assert.equal(Core.canonicalDoors(user)['write.printables.edit'], true);
    assert.equal(Core.firestoreDoors(user)['write.printables.edit'], false);
    assert.ok(result.gains.includes('firestore write.printables.edit'));
    assert.equal(result.blocking.includes('storage write.printables.edit'), false);
    assert.equal(Core.canonicalDoors(user).isKiosk, false);
});

test('storage takes the higher of accountLevelId and the stored rung', () => {
    assert.equal(Core.storagePermissionLevel({
        permissionLevel: 'member',
        accountLevelId: 'level_editor',
    }), 'editor');
});

test('report redacts the uid to a prefix and names a blocking loss', () => {
    const result = Core.report([{
        uid: 'STGsqGJWexampleuid0000000000',
        user: {permissionLevel: 'editor', role: 'editor'},
    }]);
    assert.equal(result.blocking, true);
    assert.equal(result.changed[0].uidPrefix, 'STGsqGJW');
    const text = Core.formatText(result);
    assert.match(text, /uid:STGsqGJW/);
    assert.doesNotMatch(text, /STGsqGJWexample/);
    assert.match(text, /ship the cutover: NO/);
});
