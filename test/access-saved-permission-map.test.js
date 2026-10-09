const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Access = require('../public/access-core.js');
const Levels = require('../public/account-levels-core.js');
const Catalog = require('../public/permission-catalog.js');

// MS-725 (ADR 0082). firestore.rules can only read the stored users/{uid}
// document, and a UI gate that mirrors a rule has to get the same answer.
// Two things get in the way, both deliberate:
//
//   * normalizeAccount() synthesises a permission map from the preset for a
//     legacy account, so "has a permissions object" is not "an admin saved a
//     permission map".
//   * auth.js withResolvedLevel() rewrites BOTH fields the rules read:
//     `permissions` becomes the effective map, `permissionLevel` becomes the
//     canonical rung, before any page sees them.
//
// So the stored pair is carried forward, and these are the tests that the
// carrying works and that the gate reads it.

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

// The rule, restated. Kept here rather than imported so a change to the gate
// has to be made twice on purpose.
const EDITOR_LEVELS = ['editor', 'admin', 'elder', 'super_admin', 'pastoral_assistant'];
function rulesWouldAdmit(storedDoc, key) {
    const level = ('permissionLevel' in storedDoc)
        ? storedDoc.permissionLevel : storedDoc.role;
    const pa = level === 'pastoral_assistant' || storedDoc.pastoralAssistant === true;
    const map = storedDoc.permissions;
    if (map && typeof map === 'object') return map[key] === true;
    return EDITOR_LEVELS.includes(level) || pa;
}

test('a raw document with a permissions map has a saved map', () => {
    const doc = Levels.userWriteFromLevel(Levels.accountLevelIdForPreset('editor'));
    assert.ok(Levels.savedPermissionMap(doc));
    assert.equal(Levels.savedPermissionMap(doc)['services.builder.edit'], true);
});

test('a legacy document has none, however editor-ish its level string', () => {
    assert.equal(Levels.savedPermissionMap({ permissionLevel: 'editor' }), null);
    assert.equal(Levels.savedPermissionMap({ role: 'super_admin' }), null);
    assert.equal(Levels.savedPermissionMap('editor'), null);
    assert.equal(Levels.savedPermissionMap(null), null);
});

test('savedPermissions, once carried, outranks a synthesised permissions map', () => {
    const resolved = {
        permissionLevel: 'editor',
        permissions: Levels.buildPresetPermissions('editor'),
        savedPermissions: null,
    };
    assert.equal(Levels.savedPermissionMap(resolved), null,
        'a legacy account resolved by auth.js must not look saved');

    const saved = { permissions: { a: true }, savedPermissions: { b: true } };
    assert.deepEqual(Levels.savedPermissionMap(saved), { b: true });
});

test('storedPermissionLevel reads the stored string, not the canonical rung', () => {
    assert.equal(Levels.storedPermissionLevel({ permissionLevel: 'member' }), 'member');
    assert.equal(Levels.storedPermissionLevel({ role: 'editor' }), 'editor');
    // accountLevelId pushes canonicalPermissionLevel up; the rules cannot see it.
    assert.equal(Levels.canonicalPermissionLevel(
        { permissionLevel: 'member', accountLevelId: 'level_editor' }), 'editor');
    assert.equal(Levels.storedPermissionLevel(
        { permissionLevel: 'member', accountLevelId: 'level_editor' }), 'member');
    assert.equal(Levels.storedPermissionLevel(
        { permissionLevel: 'elder', storedLevel: 'member' }), 'member');
});

const DOOR_KEYS = [
    'hymns.edit', 'roles.manager.edit', 'calendar.events.edit',
    'services.builder.edit', 'calendar.away.edit', 'printables.edit',
];

test('every door key is a real MS-695 permission key', () => {
    for (const k of DOOR_KEYS) assert.ok(Catalog.PERMISSION_KEYS.includes(k), k);
});

test('writesWith agrees with the rule on every account shape and every key', () => {
    const docs = [];
    for (const preset of Levels.BUILTIN_PRESET_KEYS) {
        docs.push(['saved ' + preset,
            Levels.userWriteFromLevel(Levels.accountLevelIdForPreset(preset))]);
    }
    for (const level of ['editor', 'admin', 'elder', 'super_admin',
        'pastoral_assistant', 'member', 'viewer', 'kiosk']) {
        docs.push(['legacy ' + level, { permissionLevel: level, role: level }]);
    }
    docs.push(['legacy member with the old PA flag',
        { permissionLevel: 'member', pastoralAssistant: true }]);
    docs.push(['legacy role-only editor', { role: 'editor' }]);
    for (const key of DOOR_KEYS) {
        docs.push([`custom member + ${key}, stored level editor`, Object.assign(
            Levels.userWriteFromLevel('level_custom_x', {
                custom: true, presetKey: 'member',
                permissions: Object.assign({},
                    Levels.buildPresetPermissions('member'), { [key]: true }),
            }), { permissionLevel: 'editor', role: 'editor' })]);
    }

    for (const [label, doc] of docs) {
        for (const key of DOOR_KEYS) {
            assert.equal(Access.writesWith(doc, key), rulesWouldAdmit(doc, key),
                `${label} / ${key}`);
        }
    }
});

test('a saved map revokes: an editor-named account with the key off is refused', () => {
    const revoked = Object.assign(
        Levels.userWriteFromLevel('level_custom_x', {
            custom: true, presetKey: 'member',
            permissions: Object.assign({}, Levels.buildPresetPermissions('member'), {
                'services.builder.edit': false,
            }),
        }), { permissionLevel: 'editor', role: 'editor' });
    assert.equal(revoked.permissionLevel, 'editor');
    assert.equal(Access.canFixSundayService(revoked), false);
});

test('a legacy editor with no saved map still may', () => {
    assert.equal(Access.canFixSundayService({ permissionLevel: 'editor' }), true);
    assert.equal(Access.canFixSundayService({ role: 'elder' }), true);
    assert.equal(Access.canFixSundayService({ permissionLevel: 'member' }), false);
    assert.equal(Access.canFixSundayService(null), false);
});

test('pageFlags().account can be handed back to a gate', () => {
    const legacy = { permissionLevel: 'editor' };
    assert.equal(Access.canEditEvents(Access.pageFlags(legacy).account), true);

    const savedEditor = Levels.userWriteFromLevel(
        Levels.accountLevelIdForPreset('editor'));
    assert.equal(Access.canEditEvents(Access.pageFlags(savedEditor).account),
        Access.canEditEvents(savedEditor));
    assert.equal(Access.canFixSundayService(Access.pageFlags(savedEditor).account), true);
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

test('a legacy editor keeps the Sunday gate after auth.js resolves them', () => {
    const stored = { permissionLevel: 'editor', role: 'editor' };
    const { resolved, Access: A } = resolveLikeAPage(stored);

    assert.ok(resolved.permissions, 'the effective map is handed to the page');
    assert.equal(resolved.savedPermissions, null, 'and the document had none');
    assert.equal(resolved.storedLevel, 'editor');

    assert.equal(A.canFixSundayService(resolved), rulesWouldAdmit(stored, 'services.builder.edit'));
    assert.equal(A.canEditEvents(resolved), rulesWouldAdmit(stored, 'calendar.events.edit'));
    assert.equal(A.canEditEvents(resolved), true);
});

test('a saved account is resolved to the same answer the rules give', () => {
    for (const preset of ['editor', 'elder', 'member', 'viewer', 'pastoral_assistant']) {
        const stored = Levels.userWriteFromLevel(
            Levels.accountLevelIdForPreset(preset));
        const { resolved, Access: A } = resolveLikeAPage(stored);
        assert.ok(resolved.savedPermissions, preset + ': the saved map is carried');
        for (const key of DOOR_KEYS) {
            assert.equal(A.writesWith(resolved, key), rulesWouldAdmit(stored, key),
                `${preset} / ${key}`);
        }
    }
});

test('a revoked key is still revoked after resolution', () => {
    const stored = Object.assign(
        Levels.userWriteFromLevel('level_custom_x', {
            custom: true, presetKey: 'member',
            permissions: Object.assign({}, Levels.buildPresetPermissions('member'), {
                'services.builder.edit': false,
                'printables.edit': true,
            }),
        }), { permissionLevel: 'editor', role: 'editor' });
    const { resolved, Access: A } = resolveLikeAPage(stored);
    assert.equal(resolved.permissionLevel, 'editor', 'the page still shows the rung');
    assert.equal(A.canFixSundayService(resolved), false);
    assert.equal(A.writesWith(resolved, 'printables.edit'), true);
});

test('the phone profile carries the stored pair to its gate', () => {
    const src = read(path.join('mobile', 'data.js'));
    const profile = src.slice(src.indexOf('function loadProfile'),
        src.indexOf('function onUser'));
    assert.match(profile, /savedPermissions: account\.savedPermissions \|\| null/);
    assert.match(profile, /storedLevel: account\.storedLevel \|\| null/);

    const app = read(path.join('mobile', 'app.js'));
    assert.match(app, /AccessCore\.canFixSundayService\(user\)/,
        'app.js gates the Sunday tile on the profile this builds');
});
