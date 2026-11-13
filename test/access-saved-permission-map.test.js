const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Access = require('../public/access-core.js');
const Levels = require('../public/account-levels-core.js');
const Catalog = require('../public/permission-catalog.js');

// MS-776. A saved `permissions` map is the whole answer. A false key stays
// false and does not fall through to a builtin accountLevelId. An object
// with no permissions field and a builtin accountLevelId uses that preset.
// A permissions field that is present but not a map grants nothing.
// permissionLevel, role, and pastoralAssistant grant nothing.

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

function account(preset, extra) {
    return Object.assign({}, Levels.userWriteFromLevel(Levels.BUILTIN_LEVEL_IDS[preset]), extra || {});
}

// The rule, restated beside Access.writesWith. A change to the gate has to
// be made twice on purpose. role, permissionLevel, and pastoralAssistant
// are not read.
function rulesWouldAdmit(storedDoc, key) {
    if (typeof storedDoc === 'string') {
        const preset = Levels.BUILTIN_LEVEL_IDS[storedDoc]
            ? storedDoc
            : Levels.presetKeyFromAccountLevelId(storedDoc);
        if (!preset) return false;
        const map = Levels.buildPresetPermissions(preset);
        return map['system.super_admin'] === true || map[key] === true;
    }
    if (!storedDoc || typeof storedDoc !== 'object') return false;
    if (Object.prototype.hasOwnProperty.call(storedDoc, 'permissions')) {
        const raw = storedDoc.permissions;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
        if (raw['system.super_admin'] === true) return true;
        return raw[key] === true;
    }
    const preset = Levels.presetKeyFromAccountLevelId(storedDoc.accountLevelId);
    if (!preset) return false;
    const map = Levels.buildPresetPermissions(preset);
    return map['system.super_admin'] === true || map[key] === true;
}

test('the removed ladder readers are not on the account-levels core', () => {
    for (const name of [
        'savedPermissionMap',
        'storedPermissionLevel',
        'migrateLegacyUser',
        'storedMarkers',
        'presetKeyFromPermissionLevel',
    ]) {
        assert.equal(Levels[name], undefined, name);
    }
});

test('a saved permissions map is the whole answer, and a false key stays false', () => {
    const editor = account('editor');
    assert.equal(editor.permissions['services.builder.edit'], true);
    assert.equal(Access.canFixSundayService(editor), true);

    const revoked = {
        accountLevelId: 'level_editor',
        permissionLevel: 'editor',
        role: 'editor',
        permissions: Object.assign({}, editor.permissions, {
            'services.builder.edit': false,
        }),
    };
    assert.equal(Levels.accessMap(revoked)['services.builder.edit'], false);
    assert.equal(Access.canFixSundayService(revoked), false);
    assert.equal(Access.canEditEvents(revoked), true);
    assert.equal(Levels.accessRank(revoked), 'editor');

    const partial = {
        accountLevelId: 'level_editor',
        permissions: {'services.builder.edit': false, 'core.sign_in': true},
    };
    assert.equal(Access.canFixSundayService(partial), false);
    assert.equal(Levels.accessRank(partial), 'viewer');
});

test('no permissions field and a builtin accountLevelId uses the preset', () => {
    const doc = {
        accountLevelId: 'level_editor',
        permissionLevel: 'member',
        role: 'viewer',
        pastoralAssistant: true,
    };
    assert.equal(Levels.accessRank(doc), 'editor');
    assert.equal(Access.canFixSundayService(doc), true);
    assert.equal(Access.canEditEvents(doc), true);
    assert.equal(Access.isPastoralAssistant(doc), false);
    assert.equal(Levels.accessRank({accountLevelId: 'level_pastoral_assistant'}), 'pastoral_assistant');
    assert.equal(Access.canDecide({accountLevelId: 'level_pastoral_assistant'}), true);
    assert.equal(Access.isAnElder({accountLevelId: 'level_pastoral_assistant'}), false);
});

test('permissions present but not a map grants no keys and ignores accountLevelId', () => {
    for (const permissions of [null, [], 'editor']) {
        const doc = {
            accountLevelId: 'level_editor',
            permissionLevel: 'super_admin',
            role: 'elder',
            permissions,
        };
        assert.equal(Access.canFixSundayService(doc), false, String(permissions));
        assert.equal(Access.writesAsEditor(doc), false, String(permissions));
        assert.equal(Levels.accessRank(doc), 'viewer', String(permissions));
        assert.equal(Levels.accessMap(doc)['services.builder.edit'], false, String(permissions));
    }
});

test('permissionLevel and role grant nothing', () => {
    const ladder = {permissionLevel: 'editor', role: 'super_admin', pastoralAssistant: true};
    assert.equal(Levels.accessRank(ladder), 'viewer');
    assert.equal(Access.canFixSundayService(ladder), false);
    assert.equal(Access.writesAsEditor(ladder), false);
    assert.equal(Access.canDecide(ladder), false);
    assert.equal(Access.readsAsElder(ladder), false);
    assert.equal(Access.isPastoralAssistant(ladder), false);
    assert.equal(Access.canFixSundayService({role: 'elder'}), false);
    assert.equal(Access.canFixSundayService(null), false);
});

test('a rank label and a builtin id are that preset', () => {
    assert.equal(Levels.accessRank('editor'), 'editor');
    assert.equal(Levels.accessRank('level_editor'), 'editor');
    assert.equal(Access.canFixSundayService('editor'), true);
    assert.equal(Access.canFixSundayService('level_pastoral_assistant'), true);
    assert.equal(Access.isAnElder('pastoral_assistant'), false);
    assert.equal(Access.canDecide('pastoral_assistant'), true);
});

const DOOR_KEYS = [
    'hymns.edit', 'roles.manager.edit', 'calendar.events.edit',
    'services.builder.edit', 'calendar.away.edit', 'printables.edit',
    'resources.edit',
];

test('every door key is a real MS-695 permission key', () => {
    for (const k of DOOR_KEYS) assert.ok(Catalog.PERMISSION_KEYS.includes(k), k);
});

test('writesWith agrees with the rule on every account shape and every key', () => {
    const docs = [];
    for (const preset of Levels.BUILTIN_PRESET_KEYS) {
        docs.push(['saved ' + preset, account(preset)]);
        docs.push(['id only ' + preset, {
            accountLevelId: Levels.accountLevelIdForPreset(preset),
            permissionLevel: 'viewer',
            role: 'member',
            pastoralAssistant: true,
        }]);
        docs.push(['rank string ' + preset, preset]);
        docs.push(['level id string ' + preset, Levels.accountLevelIdForPreset(preset)]);
    }
    docs.push(['ladder editor', {permissionLevel: 'editor', role: 'editor'}]);
    docs.push(['ladder role-only editor', {role: 'editor'}]);
    docs.push(['flag', {permissionLevel: 'member', pastoralAssistant: true}]);
    docs.push(['null map', {accountLevelId: 'level_editor', permissions: null}]);
    docs.push(['array map', {accountLevelId: 'level_super_admin', permissions: []}]);
    for (const key of DOOR_KEYS) {
        docs.push(['custom member + ' + key, Object.assign(
            Levels.userWriteFromLevel('level_custom_x', {
                custom: true, presetKey: 'member',
                permissions: Object.assign({},
                    Levels.buildPresetPermissions('member'), {[key]: true}),
            }), {permissionLevel: 'editor', role: 'editor'})]);
        const turnedOff = Object.assign({}, account('editor').permissions, {[key]: false});
        docs.push(['editor map with ' + key + ' false', {
            accountLevelId: 'level_editor',
            permissionLevel: 'editor',
            permissions: turnedOff,
        }]);
    }

    for (const [label, doc] of docs) {
        for (const key of DOOR_KEYS) {
            assert.equal(Access.writesWith(doc, key), rulesWouldAdmit(doc, key),
                `${label} / ${key}`);
        }
    }
});

test('pageFlags().account can be handed back to a gate', () => {
    const ladder = {permissionLevel: 'editor'};
    assert.equal(Access.canEditEvents(Access.pageFlags(ladder).account), false);
    assert.equal(Access.pageFlags(ladder).currentPermissionLevel, 'viewer');

    assert.equal(Access.canEditEvents(Access.pageFlags('editor').account), true);

    const savedEditor = account('editor');
    assert.equal(Access.canEditEvents(Access.pageFlags(savedEditor).account),
        Access.canEditEvents(savedEditor));
    assert.equal(Access.canFixSundayService(Access.pageFlags(savedEditor).account), true);

    const idOnly = {accountLevelId: 'level_editor'};
    assert.equal(Access.canFixSundayService(Access.pageFlags(idOnly).account), true);
});

function resolveLikeAPage(storedDoc) {
    const sandbox = {
        console: { log() {}, error() {}, warn() {} },
        setTimeout,
        location: { hostname: 'mosaic-hymn-database.web.app', search: '', href: '' },
        document: {
            readyState: 'complete',
            body: { appendChild() {} },
            getElementById: () => null,
            createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
            addEventListener() {},
            dispatchEvent: () => true,
        },
        CustomEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
        firebase: {
            apps: [{}],
            initializeApp() {},
            auth: () => ({ onAuthStateChanged() {}, signOut: () => Promise.resolve() }),
            firestore: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) }),
        },
    };
    sandbox.window = sandbox;
    sandbox.window.addEventListener = () => {};
    vm.createContext(sandbox);
    vm.runInContext(read('firebase-config.js'), sandbox, { filename: 'firebase-config.js' });
    vm.runInContext(read('permission-catalog.js'), sandbox, { filename: 'permission-catalog.js' });
    vm.runInContext(read('account-levels-core.js'), sandbox, { filename: 'account-levels-core.js' });
    vm.runInContext(read('access-core.js'), sandbox, { filename: 'access-core.js' });
    vm.runInContext(read('auth.js'), sandbox, { filename: 'auth.js' });
    assert.equal(typeof sandbox.withResolvedLevel, 'function',
        'auth.js no longer defines withResolvedLevel');
    return { resolved: sandbox.withResolvedLevel(storedDoc), Access: sandbox.AccessCore };
}

test('a ladder field stays a viewer after auth.js resolves it', () => {
    const stored = {permissionLevel: 'editor', role: 'editor'};
    const { resolved, Access: A } = resolveLikeAPage(stored);
    assert.equal(resolved.permissionLevel, 'viewer');
    assert.equal(resolved.pastoralAssistant, false);
    assert.equal(resolved.savedPermissions, undefined);
    assert.equal(A.canFixSundayService(resolved), false);
    assert.equal(A.canEditEvents(resolved), false);
    assert.equal(A.canFixSundayService(resolved), rulesWouldAdmit(stored, 'services.builder.edit'));
});

test('a pastoralAssistant flag does not resolve to Pastoral Assistant', () => {
    const stored = {permissionLevel: 'member', pastoralAssistant: true};
    const { resolved, Access: A } = resolveLikeAPage(stored);
    assert.equal(resolved.permissionLevel, 'viewer');
    assert.equal(resolved.pastoralAssistant, false);
    assert.equal(A.canDecide(resolved), false);
    assert.equal(A.readsAsElder(resolved), false);
});

test('a builtin id with no permissions field resolves to that preset', () => {
    const stored = {
        accountLevelId: 'level_editor',
        permissionLevel: 'member',
        role: 'viewer',
        pastoralAssistant: true,
    };
    const { resolved, Access: A } = resolveLikeAPage(stored);
    assert.equal(resolved.permissionLevel, 'editor');
    assert.equal(resolved.pastoralAssistant, false);
    assert.equal(resolved.permissions['services.builder.edit'], true);
    assert.equal(A.canFixSundayService(resolved), true);
    assert.equal(A.canEditEvents(resolved), true);
});

test('a saved account is resolved to the same answer the rules give', () => {
    for (const preset of ['editor', 'elder', 'member', 'viewer', 'pastoral_assistant']) {
        const stored = account(preset);
        const { resolved, Access: A } = resolveLikeAPage(stored);
        assert.equal(resolved.permissionLevel, preset);
        assert.equal(resolved.savedPermissions, undefined, preset);
        assert.ok(resolved.permissions, preset);
        for (const key of DOOR_KEYS) {
            assert.equal(A.writesWith(resolved, key), rulesWouldAdmit(stored, key),
                `${preset} / ${key}`);
        }
    }
});

test('a revoked key is still revoked after resolution', () => {
    const stored = Object.assign(account('editor'), {
        permissionLevel: 'editor',
        role: 'editor',
        permissions: Object.assign({}, account('editor').permissions, {
            'services.builder.edit': false,
            'printables.edit': true,
        }),
    });
    const { resolved, Access: A } = resolveLikeAPage(stored);
    assert.equal(resolved.permissionLevel, 'editor');
    assert.equal(A.canFixSundayService(resolved), false);
    assert.equal(A.writesWith(resolved, 'printables.edit'), true);
});

test('permissions that are not a map stay empty after resolution', () => {
    const stored = {accountLevelId: 'level_super_admin', permissions: null, permissionLevel: 'super_admin'};
    const { resolved, Access: A } = resolveLikeAPage(stored);
    assert.equal(resolved.permissionLevel, 'viewer');
    assert.equal(A.canFixSundayService(resolved), false);
    assert.equal(A.accessesAdminDashboard(resolved), false);
});

test('the phone profile carries the account map to its gate', () => {
    const src = read(path.join('mobile', 'data.js'));
    const profile = src.slice(src.indexOf('function loadProfile'),
        src.indexOf('function onUser'));
    assert.match(profile, /permissions: account\.permissions \|\| null/);
    assert.doesNotMatch(profile, /savedPermissions/);
    assert.doesNotMatch(profile, /storedLevel/);

    const app = read(path.join('mobile', 'app.js'));
    assert.match(app, /AccessCore\.canFixSundayService\(user\)/,
        'app.js gates the Sunday tile on the profile this builds');
});
