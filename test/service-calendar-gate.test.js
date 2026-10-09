// MS-719 (ADR 0081) — the Services table decides who gets click-to-edit
// cells by the MS-695 permission, the same one the Order of Service edit
// path asks for, and not by a list of permissionLevel strings.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
global.PermissionCatalog = require(path.join(PUBLIC, 'permission-catalog.js'));
global.AccountLevelsCore = require(path.join(PUBLIC, 'account-levels-core.js'));
const AccessCore = require(path.join(PUBLIC, 'access-core.js'));
const Levels = global.AccountLevelsCore;

const SOURCE = fs.readFileSync(path.join(PUBLIC, 'service-calendar.js'), 'utf8');

function authBlock() {
    const start = SOURCE.indexOf('// --- AUTH PROTECTION ---');
    assert.ok(start !== -1, 'auth block marker moved');
    return SOURCE.slice(start, start + 4000);
}

test('the table gates editing on AccessCore.canFixSundayService', () => {
    assert.match(authBlock(), /if \(AccessCore\.canFixSundayService\(userData\)\) \{/);
});

test('no level-string list decides who edits the table', () => {
    assert.doesNotMatch(authBlock(), /\[\s*'editor'\s*,\s*'elder'/);
    assert.doesNotMatch(authBlock(), /\.includes\(permissionLevel\)/);
});

test('the page loads the cores the gate needs, in order', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'service-calendar.html'), 'utf8');
    const at = name => html.indexOf('src="' + name + '"');
    assert.ok(at('permission-catalog.js') !== -1 && at('permission-catalog.js') < at('account-levels-core.js'));
    assert.ok(at('account-levels-core.js') < at('access-core.js'));
    assert.ok(at('access-core.js') < at('service-calendar.js'));
});

function seeded(preset) {
    return Levels.userWriteFromLevel(Levels.accountLevelIdForPreset(preset), null);
}

const can = u => AccessCore.canFixSundayService(u);

test('a seeded editor, elder and admin edit the table; a viewer and a member do not', () => {
    assert.strictEqual(can(seeded('editor')), true);
    assert.strictEqual(can(seeded('elder')), true);
    assert.strictEqual(can(seeded('super_admin')), true);
    assert.strictEqual(can(seeded('viewer')), false);
    assert.strictEqual(can(seeded('member')), false);
});

test('a Pastoral Assistant edits the table (the old list left them out; the rules admit them)', () => {
    assert.strictEqual(can(seeded('pastoral_assistant')), true);
});

test('an editor string without services.builder.edit in the map does not', () => {
    const perms = Object.assign({}, seeded('editor').permissions, { 'services.builder.edit': false });
    assert.strictEqual(can({ accountLevelId: 'level_custom_x', permissionLevel: 'editor', permissions: perms }), false);
});

test('a custom level carrying services.builder.edit edits the table', () => {
    const perms = Object.assign({}, seeded('member').permissions, { 'services.builder.edit': true });
    assert.strictEqual(can({ accountLevelId: 'level_custom_music', permissionLevel: 'member', permissions: perms }), true);
});

test('an unmigrated legacy editor still edits; signed out does not', () => {
    assert.strictEqual(can({ permissionLevel: 'editor' }), true);
    assert.strictEqual(can(null), false);
});
