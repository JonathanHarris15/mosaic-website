/**
 * Every Cloud Function is either shipped by the standing deploy job or named
 * here as not shipped by it.
 *
 * The deploy workflow (`.github/workflows/firebase-deploy.yml`) ships a fixed
 * `--only` list, not every function. A function missing from it merges to
 * main and never reaches production: the hourly sender for told event
 * announcements sat outside it, so every fix to it shipped nothing (found
 * 2026-11-16, MS-623).
 *
 * So a new export must make a choice, and a reviewer sees it: add it to the
 * standing set (workflow, ops note, app-check-agreement test), or add it to
 * NOT_SHIPPED_BY_THE_JOB below. The list below is what was outside the set on
 * 2026-11-16. Each one still deploys only by hand, so a change to it does not
 * reach the church until somebody ships it. Moving one into the set is the
 * fix.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const NOT_SHIPPED_BY_THE_JOB = [
    'getHymnIndex', 'createUser', 'deleteUser', 'deleteOwnAccount',
    'updateUserPasswordAdmin', 'resolveDirectoryRequest', 'cleanUpReplacedPhoto',
    'sealEventAttachment', 'cleanUpFormUploads', 'cleanUpDeletedAttachment',
    'unlinkDirectoryPerson', 'updateOrderOfServiceUsageStats', 'updateRoleUsageStats',
    'updatePastoralPrayerUsageStats', 'scoreTheme', 'oosGetScriptureHeatmap',
    'onGuidanceWritten', 'mcpCapabilities', 'restoreGuidanceVersion',
    'onServiceThemeWritten', 'syncPermissionLevelToMembershipStage',
    'syncMemberTagToRole', 'syncElderRoleToTag', 'smsCheckQuota', 'smsSendTest',
    'notificationReachability', 'deleteFormTemplate',
    'shepherdingTask',
];

/** @return {Set<string>} the functions the deploy job ships */
function shipped() {
    const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/firebase-deploy.yml'), 'utf8');
    const m = /echo "targets=([^"]+)"/.exec(wf);
    assert.ok(m, 'the deploy workflow no longer echoes its targets');
    return new Set(Array.from(m[1].matchAll(/functions:([A-Za-z0-9_]+)/g), (x) => x[1]));
}

/** @return {Array<string>} every exported Cloud Function */
function exported() {
    const src = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
    return Array.from(src.matchAll(/^exports\.([A-Za-z0-9_]+)\s*=/gm), (x) => x[1]);
}

test('every exported function is shipped by the deploy job or named as not shipped', () => {
    const set = shipped();
    const outside = new Set(NOT_SHIPPED_BY_THE_JOB);
    const undecided = exported().filter((name) => !set.has(name) && !outside.has(name));
    assert.deepStrictEqual(undecided, [],
        'these functions would never reach production. Add each to the standing ' +
        'deploy set, or to NOT_SHIPPED_BY_THE_JOB with the reason');
});

test('nothing is both shipped and named as not shipped, and nothing named is gone', () => {
    const set = shipped();
    const names = new Set(exported());
    NOT_SHIPPED_BY_THE_JOB.forEach((name) => {
        assert.ok(!set.has(name), name + ' is shipped now; take it off NOT_SHIPPED_BY_THE_JOB');
        assert.ok(names.has(name), name + ' is no longer exported; take it off NOT_SHIPPED_BY_THE_JOB');
    });
});
