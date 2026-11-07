const { test } = require('node:test');
const assert = require('node:assert');
const Core = require('../scripts/roles-merge-impact-core.js');
const Levels = require('../public/account-levels-core.js');

/**
 * A custom level as Admin -> Accounts saves it: Member plus some keys.
 * @param {Record<string, boolean>} extra
 * @returns {Record<string, unknown>}
 */
function custom(extra) {
    return {
        accountLevelId: 'level_custom_x',
        permissions: Object.assign({}, Levels.buildPresetPermissions('member'), extra),
    };
}

/**
 * @param {string} preset
 * @returns {Record<string, unknown>}
 */
function presetMap(preset) {
    return {
        accountLevelId: Levels.accountLevelIdForPreset(preset),
        permissions: Levels.buildPresetPermissions(preset),
    };
}

test('preset levels keep every People door, with or without a saved map', () => {
    for (const preset of ['editor', 'elder', 'pastoral_assistant', 'admin', 'super_admin']) {
        assert.deepEqual(Core.peopleLosses(presetMap(preset)), [], preset + ' with a map');
        assert.deepEqual(Core.peopleLosses({ accountLevelId: Levels.accountLevelIdForPreset(preset) }), [],
            preset + ' with no map');
    }
});

test('members, viewers and kiosks had no editor door, so lose nothing', () => {
    for (const preset of ['member', 'viewer', 'kiosk']) {
        assert.deepEqual(Core.peopleLosses(presetMap(preset)), [], preset);
    }
});

test('a hymns-only or printables-only level loses People edits and serving history', () => {
    for (const key of ['hymns.edit', 'printables.edit']) {
        const losses = Core.peopleLosses(custom({ [key]: true }));
        assert.equal(losses.length, 3, key);
        assert.match(losses[2], /^write serving history$/);
    }
});

test('a Services builder or Event level keeps serving history', () => {
    const losses = Core.peopleLosses(custom({ 'services.builder.edit': true }));
    assert.equal(losses.length, 2);
    assert.equal(losses.some(l => /history/.test(l)), false);
    // calendar.events.edit alone never made isEditor() true, so it loses nothing.
    assert.deepEqual(Core.peopleLosses(custom({ 'calendar.events.edit': true })), []);
});

test('a Roles Manager level keeps only its own seeds', () => {
    const losses = Core.peopleLosses(custom({ 'roles.manager.edit': true }));
    assert.match(losses[2], /auto-assign seeds/);
});

test('an Editor level with the directory key unticked loses People edits but keeps history', () => {
    const user = presetMap('editor');
    /** @type {Record<string, boolean>} */ (user.permissions)['directory.edit_identity'] = false;
    const losses = Core.peopleLosses(user);
    assert.equal(losses.length, 2);
});

test('a link counts only when it goes both ways', () => {
    const people = new Map([
        ['p1', { userId: 'u1' }],
        ['p2', {}],
        ['p3', { userId: 'u9' }],
    ]);
    assert.equal(Core.linkProblem('u1', { personId: 'p1' }, people), null);
    assert.equal(Core.linkProblem('u1', {}, people), null);
    assert.match(String(Core.linkProblem('u2', { personId: 'p2' }, people)), /does not point back/);
    assert.match(String(Core.linkProblem('u3', { personId: 'p3' }, people)), /different account/);
    assert.match(String(Core.linkProblem('u4', { personId: 'gone' }, people)), /does not exist/);
});

test('a Role from the Roles page passes the shape check; a broken one names why', () => {
    const RolesCore = require('../public/roles-core.js');
    assert.deepEqual(Core.roleShapeProblems(RolesCore.newDefinition('Greeters')), []);
    assert.deepEqual(Core.roleShapeProblems({ name: 'Ushers', family: 'servant', slug: 'ushers',
        slots: [{ id: 's1', requirement: 'either' }] }), []);
    const bad = Core.roleShapeProblems({ name: '', family: 'liturgical', slots: [],
        slug: 'Bad Slug', description: 'x'.repeat(601), intensity: -1 });
    assert.equal(bad.length, 6);
    assert.deepEqual(Core.extraRoleFields({ name: 'x', createdAt: 1, notes: 'y' }), ['createdAt', 'notes']);
});

test('the report prints uid prefixes only', () => {
    const r = Core.report(
        [{ id: 'abcdefghijklmnop', data: custom({ 'hymns.edit': true }) },
            { id: 'qrstuvwxyz123456', data: { personId: 'p-x' } }],
        [],
        [{ id: 'r1', data: { name: 'Ushers', family: 'servant', slots: [] } }],
    );
    const text = Core.formatText(r);
    assert.match(text, /uid:abcdefgh /);
    assert.doesNotMatch(text, /abcdefghi/);
    assert.match(text, /lose an editor door on People: 1/);
    assert.match(text, /no longer counts: 1/);
    assert.match(text, /could no longer be saved: 1/);
});
