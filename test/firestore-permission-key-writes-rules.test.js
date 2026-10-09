const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// MS-722 (ADR 0081): the static half of the rules change. The emulator
// suite (test/emulator/permission-key-writes.test.js) proves who the doors
// let through; this pins the shape so a later edit cannot quietly drop a
// key, swap one, or reach a read path.

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')
    .replace(/\r\n/g, '\n');

const KEYS = {
    hymns: 'hymns.edit',
    roles: 'roles.manager.edit',
    events: 'calendar.events.edit',
    event_occurrences: 'calendar.events.edit',
    services: 'services.builder.edit',
    liturgy_elements: 'services.builder.edit',
    liturgy_orders: 'services.builder.edit',
    presence: 'services.builder.edit',
    style_presets: 'services.builder.edit',
    page_templates: 'services.builder.edit',
    guide_templates: 'services.builder.edit',
    guide_assets: 'services.builder.edit',
    people: 'directory.edit_identity',
    away: 'calendar.away.edit',
    printables: 'printables.edit',
    printable_folders: 'printables.edit',
    printable_templates: 'printables.edit',
};

// MS-725 (ADR 0082): a saved map is the whole answer. The level names are
// still there, but only behind `!usesPermissionMap()` — put them back as a
// plain OR and unticking a key in Admin → Accounts stops meaning anything.
test('editsWith is keys-only once a map has been saved', () => {
    assert.match(rules,
        /function editsWith\(key\) \{\s*return hasPermission\(key\)\s*\|\| \(!usesPermissionMap\(\) && isEditor\(\)\);\s*\}/);
});

// MS-727: app_config's leftover ladder is isAdmin(), not isEditor().
test('editsAsAdmin is keys-only once a map has been saved', () => {
    assert.match(rules,
        /function editsAsAdmin\(key\) \{\s*return hasPermission\(key\)\s*\|\| \(!usesPermissionMap\(\) && isAdmin\(\)\);\s*\}/);
});

test('app_config writes with the admin dashboard key', () => {
    const at = rules.indexOf('match /app_config/{configId}');
    assert.ok(at >= 0, 'the app_config block moved');
    const firstWrite = rules.slice(at).match(/allow (?:read, write|write)[^;]*;/)[0];
    assert.ok(firstWrite.includes("editsAsAdmin('admin.dashboard.access')"), firstWrite);
});

test('every editsWith key is a real MS-695 permission key', () => {
    const { PERMISSION_KEYS } = require('../public/permission-catalog.js');
    const used = [...rules.matchAll(/editsWith\('([^']+)'\)/g)].map(m => m[1]);
    assert.ok(used.length >= 19, 'expected the 19 write doors');
    for (const k of used) assert.ok(PERMISSION_KEYS.includes(k), k);
});

test('each touched collection writes with its own key', () => {
    for (const [coll, key] of Object.entries(KEYS)) {
        const at = rules.indexOf(`match /${coll}/{`);
        assert.ok(at >= 0, coll);
        const firstWrite = rules.slice(at).match(/allow (?:create|write)[^;]*;/)[0];
        assert.ok(firstWrite.includes(`editsWith('${key}')`), `${coll}: ${firstWrite}`);
    }
});

test('reads never use editsWith (write paths only)', () => {
    for (const line of rules.split('\n')) {
        if (/allow\s+(read|get|list)\b/.test(line)) {
            assert.ok(!line.includes('editsWith'), line.trim());
        }
    }
});

// MS-725: one read does name a write surface's key, and it is `presence`.
// Whoever may write a Sunday may read who else is in it — otherwise a level
// built from Member plus services.builder.edit publishes a claim it can never
// see, and ADR 0035's one-person-per-box lock fails open for that person.
// The exception is named here so a second one cannot arrive unannounced.
const PRESENCE_READ_KEY = 'services.builder.edit';

test('the presence read, and only it, admits the service key', () => {
    const at = rules.indexOf('match /presence/{uid}');
    assert.ok(at >= 0, 'the presence block moved');
    const read = rules.slice(at).match(/allow read:[^;]*;/)[0];
    assert.match(read,
        new RegExp(`readsAsEditor\\(\\) \\|\\| hasPermission\\('${PRESENCE_READ_KEY}'\\)`));

    for (const line of rules.split('\n')) {
        if (!/allow\s+(read|get|list)\b/.test(line)) continue;
        if (line.includes('readsAsEditor() || hasPermission')) continue;
        assert.ok(!line.includes(`hasPermission('${PRESENCE_READ_KEY}')`),
            `a second read grew the service key: ${line.trim()}`);
    }
});

test('shepherding_presence stays elders-only', () => {
    const at = rules.indexOf('match /shepherding_presence/{uid}');
    assert.ok(at >= 0, 'the shepherding_presence block moved');
    const read = rules.slice(at).match(/allow read:[^;]*;/)[0];
    assert.match(read, /allow read: if readsAsElder\(\);/);
});

// The write doors are the only thing editsWith touches, and there are still
// nineteen of them. A read that quietly started asking a write key would be
// caught above; this catches a write door being dropped.
test('the editor-ladder write doors are all still there', () => {
    const used = [...rules.matchAll(/editsWith\('([^']+)'\)/g)].map(m => m[1]);
    // MS-722/725's 19, plus MS-727's four guide collections and people create.
    assert.equal(used.length, 24);
});
