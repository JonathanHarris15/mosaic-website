const { test } = require('node:test');
const assert = require('node:assert/strict');

const Backfill = require('../scripts/backfill-editor-calendar-key.js');
const Levels = require('../public/account-levels-core.js');
const Catalog = require('../public/permission-catalog.js');

const editorMap = () => Levels.buildPresetPermissions('editor');
const oldEditorMap = () => {
    const map = editorMap();
    map[Backfill.KEY] = false;
    return map;
};

test('a saved Editor map missing the key is a one-field write', () => {
    const plan = Backfill.planForUser({
        permissionLevel: 'editor',
        role: 'editor',
        accountLevelId: 'level_editor',
        permissions: oldEditorMap(),
    });
    assert.ok(plan);
    assert.equal(plan.field, 'permissions.calendar.events.edit');
    assert.equal(plan.before, false);
    assert.equal(plan.after, true);
});

test('a map that already has the key is skipped', () => {
    assert.equal(Backfill.planForUser({
        permissionLevel: 'editor',
        accountLevelId: 'level_editor',
        permissions: editorMap(),
    }), null);
});

test('a legacy editor with no saved map is skipped', () => {
    assert.equal(Backfill.planForUser({ permissionLevel: 'editor', role: 'editor' }), null);
});

test('a saved Editor map with any other key off is skipped', () => {
    const tweaked = oldEditorMap();
    tweaked['hymns.edit'] = false;
    assert.equal(Backfill.planForUser({
        permissionLevel: 'editor',
        accountLevelId: 'level_editor',
        permissions: tweaked,
    }), null);
});

test('a saved Elder or Member map is skipped', () => {
    assert.equal(Backfill.planForUser({
        permissionLevel: 'elder',
        accountLevelId: 'level_elder',
        permissions: Levels.buildPresetPermissions('elder'),
    }), null);
    assert.equal(Backfill.planForUser({
        permissionLevel: 'member',
        accountLevelId: 'level_member',
        permissions: Levels.buildPresetPermissions('member'),
    }), null);
});

test('level_editor with a stored member string is skipped', () => {
    assert.equal(Backfill.planForUser({
        permissionLevel: 'member',
        accountLevelId: 'level_editor',
        permissions: oldEditorMap(),
    }), null);
});

test('the current Editor preset still matches on every other catalog key', () => {
    const expected = editorMap();
    assert.equal(
        Backfill.equalsEditorPresetExceptCalendarKey(oldEditorMap(), expected),
        true);
    assert.equal(expected[Backfill.KEY], true);
    assert.ok(Catalog.PERMISSION_KEYS.includes(Backfill.KEY));
});

test('the write path keeps the dotted key as one field name', () => {
    function FieldPath(a, b) {
        this.segments = [a, b];
    }
    const fp = Backfill.permissionFieldPath({ FieldPath });
    assert.deepEqual(fp.segments, ['permissions', 'calendar.events.edit']);
});

test('dry-run is the default; --commit needs --i-mean-prod; only the church project', () => {
    assert.equal(Backfill.committing(['node', 'backfill-editor-calendar-key.js']), false);
    assert.equal(Backfill.willWrite([
        'node', 'x', '--project', 'mosaic-hymn-database', '--i-mean-prod',
    ]), false);
    assert.equal(Backfill.willWrite(['node', 'x', '--commit']), false);
    assert.equal(Backfill.willWrite([
        'node', 'x', '--commit', '--i-mean-prod',
    ]), true);
    assert.equal(Backfill.allowedProject([
        'node', 'x', '--project', 'mosaic-hymn-database', '--i-mean-prod',
    ]), 'mosaic-hymn-database');
    assert.throws(() => Backfill.allowedProject([
        'node', 'x', '--project', 'mosaic-hymn-database',
    ]));
    assert.throws(() => Backfill.allowedProject([
        'node', 'x', '--project', 'mosaic-manager-ghost', '--i-mean-prod',
    ]));
});
