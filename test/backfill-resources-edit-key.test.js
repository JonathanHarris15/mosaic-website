// MS-693 — carrying `resources.edit` onto maps that were saved before it
// existed.
//
// ⚠ WHAT THIS PROVES. ADR-0082 says a saved permission map is the whole
// answer, so a brand-new catalog key reads `false` on every account that has
// one — including the editors the Resources library was built for. The
// backfill fixes that WITHOUT touching anybody whose map somebody shaped on
// purpose. Both halves matter: a backfill that skipped the editors would ship
// a read-only library, and one that overwrote a narrowed account would hand
// out a permission a person had deliberately taken away.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const Backfill = require('../scripts/backfill-resources-edit-key.js');
const Levels = require('../public/account-levels-core.js');
const Catalog = require('../public/permission-catalog.js');

const presetMap = (preset) => Levels.buildPresetPermissions(preset);
const before693 = (preset) => {
    const map = presetMap(preset);
    map[Backfill.KEY] = false;
    return map;
};

// Every rung whose preset carries the key. MS-725's equivalent was editor
// only; `resources.edit` is in the editor operational bundle, which admin,
// elder and the Pastoral Assistant all inherit.
const CARRIERS = ['editor', 'admin', 'elder', 'pastoral_assistant', 'super_admin'];

test('every rung that should fill the library is in the preset', () => {
    CARRIERS.forEach((preset) => {
        assert.equal(presetMap(preset)[Backfill.KEY], true, preset);
    });
    ['member', 'viewer', 'kiosk'].forEach((preset) => {
        assert.notEqual(presetMap(preset)[Backfill.KEY], true, preset);
    });
    assert.ok(Catalog.PERMISSION_KEYS.includes(Backfill.KEY));
});

test('a saved map from any of those rungs, missing the key, is a one-field write', () => {
    CARRIERS.forEach((preset) => {
        const plan = Backfill.planForUser({
            permissionLevel: preset,
            accountLevelId: Levels.accountLevelIdForPreset(preset),
            permissions: before693(preset),
        });
        assert.ok(plan, preset);
        assert.equal(plan.field, 'permissions.resources.edit');
        assert.equal(plan.preset, preset);
        assert.equal(plan.before, false);
        assert.equal(plan.after, true);
    });
});

test('a map that already has the key is skipped', () => {
    assert.equal(Backfill.planForUser({
        permissionLevel: 'editor',
        accountLevelId: 'level_editor',
        permissions: presetMap('editor'),
    }), null);
});

test('a legacy account with no saved map is skipped — the rung still answers for it', () => {
    assert.equal(
        Backfill.planForUser({ permissionLevel: 'editor', role: 'editor' }), null);
});

// The guard that matters. Somebody who narrowed an editor on purpose does not
// get them widened back by a script that was only meant to add one key.
test('a map with any other key changed is skipped', () => {
    const tweaked = before693('editor');
    tweaked['hymns.edit'] = false;
    assert.equal(Backfill.planForUser({
        permissionLevel: 'editor',
        accountLevelId: 'level_editor',
        permissions: tweaked,
    }), null);

    const widened = before693('member');
    widened['hymns.edit'] = true;
    assert.equal(Backfill.planForUser({
        permissionLevel: 'member',
        accountLevelId: 'level_member',
        permissions: widened,
    }), null);
});

test('a member keeps their map — the library is theirs to read, not to fill', () => {
    assert.equal(Backfill.planForUser({
        permissionLevel: 'member',
        accountLevelId: 'level_member',
        permissions: before693('member'),
    }), null);
});

test('a custom Account Level is left alone — it has no preset to compare to', () => {
    assert.equal(Backfill.planForUser({
        permissionLevel: 'editor',
        accountLevelId: 'level_custom_welcome_desk',
        permissions: before693('editor'),
    }), null);
    assert.equal(Backfill.planForUser({
        permissionLevel: 'editor',
        permissions: before693('editor'),
    }), null);
});

test('the account level id decides, not the level name typed beside it', () => {
    // A member-shaped map wearing an editor id, or the other way round, is
    // not a preset this script recognises and is not quietly repaired.
    assert.equal(Backfill.planForUser({
        permissionLevel: 'editor',
        accountLevelId: 'level_member',
        permissions: before693('editor'),
    }), null);
});

test('the write path keeps the dotted key as one field name', () => {
    function FieldPath(a, b) {
        this.segments = [a, b];
    }
    const fp = Backfill.permissionFieldPath({ FieldPath });
    assert.deepEqual(fp.segments, ['permissions', 'resources.edit']);
});

test('dry-run is the default; --commit needs --i-mean-prod; only the church project', () => {
    assert.equal(Backfill.committing(['node', 'backfill-resources-edit-key.js']), false);
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
