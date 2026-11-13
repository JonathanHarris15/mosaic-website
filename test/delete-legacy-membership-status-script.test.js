const {test} = require('node:test');
const assert = require('node:assert');
const Plan = require('../public/delete-legacy-membership-status-core.js');
const {
    parseStageWinsFromArgv,
    applyStageWinsIfListed,
} = require('../scripts/delete-legacy-membership-status.js');
const {splitOpsArgs} = require('../scripts/prod-ops-args');

test('parseStageWinsFromArgv reads comma-separated ids', () => {
    const ids = parseStageWinsFromArgv([
        'node',
        'script.js',
        '--stage-wins=LD935cnEwFydTJ05S13W,nZlY899LavYsA4SrOFvd',
    ]);
    assert.deepStrictEqual(
        [...ids],
        ['LD935cnEwFydTJ05S13W', 'nZlY899LavYsA4SrOFvd'],
    );
    assert.deepStrictEqual(parseStageWinsFromArgv(['node', 'script.js']), new Set());
});

test('prod ops splitOpsArgs passes --stage-wins through to the script argv', () => {
    const extra = splitOpsArgs(
        '--stage-wins=LD935cnEwFydTJ05S13W,nZlY899LavYsA4SrOFvd',
    );
    assert.deepStrictEqual(extra, [
        '--stage-wins=LD935cnEwFydTJ05S13W,nZlY899LavYsA4SrOFvd',
    ]);
    const ids = parseStageWinsFromArgv(['script', ...extra]);
    assert.ok(ids.has('LD935cnEwFydTJ05S13W'));
    assert.ok(ids.has('nZlY899LavYsA4SrOFvd'));
});

test('stage-wins resolves status-stage conflict for listed ids only', () => {
    const blocked = Plan.planMembershipStatusRemoval({
        membership: {stage: 'member', status: 'previous_member'},
    });
    assert.strictEqual(blocked.blocked, true);

    const resolved = applyStageWinsIfListed(
        'LD935cnEwFydTJ05S13W',
        blocked,
        new Set(['LD935cnEwFydTJ05S13W']),
    );
    assert.strictEqual(resolved.blocked, false);
    assert.strictEqual(resolved.deleteStatus, true);
    assert.strictEqual(resolved.setInactive, false);

    const stillBlocked = applyStageWinsIfListed(
        'other-person',
        blocked,
        new Set(['LD935cnEwFydTJ05S13W']),
    );
    assert.strictEqual(stillBlocked.blocked, true);
});

test('stage-wins does not override non status-stage blocks', () => {
    const plan = {
        blocked: true,
        blockReasons: ['status-stage-conflict:x', 'other-reason'],
        setInactive: false,
        deleteStatus: false,
    };
    const out = applyStageWinsIfListed('any', plan, new Set(['any']));
    assert.strictEqual(out.blocked, true);
});
