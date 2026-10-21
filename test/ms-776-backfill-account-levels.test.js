const {test} = require('node:test');
const assert = require('node:assert/strict');

const Backfill = require('../scripts/ms-776-backfill-account-levels.js');
const Levels = require('../public/account-levels-core.js');

/**
 * @param {unknown} user
 * @returns {string}
 */
function skipReason(user) {
    const decision = Backfill.classify(user);
    assert.equal(decision.action, 'skip');
    if (decision.action !== 'skip') throw new Error('expected a skip');
    return decision.reason;
}

test('every builtin ladder-only account gets that preset and nothing else', () => {
    for (const preset of Levels.BUILTIN_PRESET_KEYS) {
        const plan = Backfill.planForUser({role: preset});
        assert.ok(plan, preset);
        assert.equal(plan.preset, preset);
        assert.equal(plan.source, 'role');
        assert.equal(plan.accountLevelId, Levels.accountLevelIdForPreset(preset));
        assert.deepEqual(plan.permissions, Levels.buildPresetPermissions(preset));
        const payload = Backfill.writePayload(plan);
        assert.deepEqual(Object.keys(payload).sort(), ['accountLevelId', 'permissions']);
        const stored = {
            role: preset,
            permissionLevel: preset,
            pastoralAssistant: false,
            accountLevelId: payload.accountLevelId,
            permissions: payload.permissions,
        };
        assert.equal(Backfill.planForUser(stored), null);
        assert.equal(stored.role, preset);
        assert.equal(stored.permissionLevel, preset);
        assert.equal(stored.pastoralAssistant, false);
    }
});

test('kiosk maps to level_kiosk and the kiosk preset', () => {
    const plan = Backfill.planForUser({permissionLevel: 'kiosk', role: 'kiosk'});
    assert.ok(plan);
    assert.equal(plan.preset, 'kiosk');
    assert.equal(plan.source, 'permissionLevel');
    assert.equal(plan.accountLevelId, 'level_kiosk');
    assert.equal(plan.permissions['system.kiosk'], true);
    assert.deepEqual(plan.permissions, Levels.buildPresetPermissions('kiosk'));
});

test('permissionLevel wins when both rungs are present', () => {
    const plan = Backfill.planForUser({permissionLevel: 'elder', role: 'member'});
    assert.ok(plan);
    assert.equal(plan.preset, 'elder');
    assert.equal(plan.source, 'permissionLevel');
    assert.equal(plan.accountLevelId, 'level_elder');
});

test('an empty permissionLevel does not fall through to role', () => {
    assert.equal(Backfill.planForUser({permissionLevel: '', role: 'editor'}), null);
    assert.equal(skipReason({permissionLevel: '', role: 'editor'}), 'not a builtin rung');
});

test('an unknown rung is skipped', () => {
    assert.equal(Backfill.planForUser({role: 'deacon'}), null);
    assert.equal(Backfill.planForUser({}), null);
});

test('pastoral-assistant and existing-map accounts are skipped', () => {
    const pastoral = {
        permissionLevel: 'member',
        role: 'member',
        accountLevelId: 'level_pastoral_assistant',
        permissions: Levels.buildPresetPermissions('pastoral_assistant'),
        pastoralAssistant: false,
    };
    assert.equal(Backfill.planForUser(pastoral), null);
    assert.equal(skipReason(pastoral), 'has accountLevelId and permissions');

    const savedEditor = Levels.userWriteFromLevel(Levels.accountLevelIdForPreset('editor'));
    assert.equal(Backfill.planForUser(savedEditor), null);
    assert.equal(savedEditor.role, 'editor');
    assert.equal(savedEditor.permissionLevel, 'editor');

    const mapOnly = {role: 'member', permissions: {'directory.view': true}};
    assert.equal(Backfill.planForUser(mapOnly), null);
    assert.equal(skipReason(mapOnly), 'has permissions');

    const idOnly = {role: 'editor', accountLevelId: 'level_editor'};
    assert.equal(Backfill.planForUser(idOnly), null);
    assert.equal(skipReason(idOnly), 'has accountLevelId');

    assert.equal(Backfill.planForUser({role: 'editor', permissions: {}}), null);
    assert.equal(Backfill.planForUser({role: 'editor', permissions: null}), null);
});

test('the pastoralAssistant flag does not choose the preset', () => {
    const plan = Backfill.planForUser({role: 'member', pastoralAssistant: true});
    assert.ok(plan);
    assert.equal(plan.preset, 'member');
    assert.deepEqual(plan.permissions, Levels.buildPresetPermissions('member'));
    assert.equal(
        Object.prototype.hasOwnProperty.call(Backfill.writePayload(plan), 'pastoralAssistant'),
        false);
    assert.equal(
        Object.prototype.hasOwnProperty.call(Backfill.writePayload(plan), 'role'),
        false);
    assert.equal(
        Object.prototype.hasOwnProperty.call(Backfill.writePayload(plan), 'permissionLevel'),
        false);
});

test('the dry-run report names the fields and hides the rest of the uid', () => {
    const uid = 'D36i0WVhexampleuid0000000000';
    const text = Backfill.formatReport(Backfill.planUsers([{
        uid,
        user: {permissionLevel: 'kiosk', role: 'kiosk'},
    }]), 'dry-run');
    assert.match(text, /uid:D36i0WVh/);
    assert.match(text, /from=permissionLevel:kiosk/);
    assert.match(text, /accountLevelId=level_kiosk/);
    assert.match(text, /permissions=kiosk preset/);
    assert.match(text, /untouched=role,permissionLevel,pastoralAssistant/);
    assert.match(text, /No writes/);
    assert.equal(text.includes('D36i0WVhexample'), false);
});

test('a second plan of the same rows is a no-op once the write is applied', () => {
    const rows = [
        {uid: 'role-editor-0001', user: {role: 'editor'}},
        {uid: 'level-editor-0001', user: Levels.userWriteFromLevel('level_editor')},
    ];
    const first = Backfill.planUsers(rows);
    assert.equal(first.filter((entry) => entry.action === 'write').length, 1);
    const again = Backfill.planUsers(rows.map((row) => {
        const decision = Backfill.classify(row.user);
        if (decision.action !== 'write') return row;
        return {uid: row.uid, user: Object.assign({}, row.user, Backfill.writePayload(decision.plan))};
    }));
    assert.equal(again.filter((entry) => entry.action === 'write').length, 0);
    assert.match(Backfill.formatReport(again, 'dry-run'), /Nothing to write/);
});

test('dry-run is the default; --commit needs --i-mean-prod', () => {
    assert.equal(Backfill.willWrite(['node', 'ms-776-backfill-account-levels.js']), false);
    assert.equal(Backfill.willWrite(['node', 'x', '--commit']), false);
    assert.equal(Backfill.willWrite([
        'node', 'x', '--project', 'mosaic-hymn-database', '--i-mean-prod',
    ]), false);
    assert.equal(Backfill.willWrite([
        'node', 'x', '--project', 'mosaic-hymn-database', '--i-mean-prod', '--commit',
    ]), true);
});
