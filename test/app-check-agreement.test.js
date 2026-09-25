const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-371 / MS-508 — the lock and the key ship together, or not at all.
//
// ⚠ APP CHECK IS TWO DEPLOYMENTS PLUS A PARAM, and they are not the same
// command. The browser decides whether to collect a token (`mode` /
// `enabled` in public/app-check-config.js, shipped by `firebase deploy
// --only hosting`). The server decides whether to demand one
// (`PUBLIC_FORM_APP_CHECK_MODE` on publicForm, shipped by `--only functions`,
// default in code, override via the Functions param — never a committed
// secret). Platform `enforceAppCheck` stays false in every mode so monitor
// can log instead of 401-ing before the handler.
//
// The dangerous disagreement is still:
//
//   enforce on the server, collection off in the browser
//       → EVERY form refuses EVERYBODY. This shipped, and it is most of
//         why nobody could answer a form.
//
// Monitor with collection on is the *intended* landing: the browser does
// the work, the server logs missing tokens, nothing is refused. That used
// to look like a bug to this file; it is now the rollout (MS-534).
//
// This reads both files as text on purpose. functions/index.js cannot be
// require()d here — it pulls in firebase-admin and expects a live project.

const ROOT = path.join(__dirname, '..');

function readFlag(file, re, what) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const m = src.match(re);
    assert.ok(m, `could not find ${what} in ${file} — it was renamed or moved, ` +
        'and this check is now watching nothing');
    return m[1];
}

test('the answering page collects tokens whenever the door is not off', () => {
    const mode = readFlag(
        'public/app-check-config.js',
        /^\s*mode:\s*'(off|monitor|enforce)'\s*,/m,
        'mode');
    const enabled = readFlag(
        'public/app-check-config.js',
        /^\s*enabled:\s*(true|false)\s*,/m,
        'enabled') === 'true';

    const collecting = mode === 'monitor' || mode === 'enforce';
    assert.strictEqual(enabled, collecting,
        enabled ?
            'enabled is true but mode is off, so the page collects tokens the ' +
            'server has not asked for — set mode to monitor or enforce, or ' +
            'set enabled false.' :
            'mode is ' + mode + ' but enabled is false, so the answering page ' +
            'will not collect a token and enforce would refuse everybody.');
});

test('the server default mode matches the answering page, and is not silent enforce', () => {
    const clientMode = readFlag(
        'public/app-check-config.js',
        /^\s*mode:\s*'(off|monitor|enforce)'\s*,/m,
        'mode');
    const serverDefault = readFlag(
        'functions/index.js',
        /defineString\(\s*"PUBLIC_FORM_APP_CHECK_MODE"[\s\S]*?default:\s*"(off|monitor|enforce)"/,
        'PUBLIC_FORM_APP_CHECK_MODE default');

    assert.strictEqual(clientMode, serverDefault,
        'the answering page is in ' + clientMode + ' and the function default ' +
        'is ' + serverDefault + '. Deploying one half would reopen the ' +
        'enforced-not-enabled outage, or collect tokens nobody looks at.');

    assert.notStrictEqual(serverDefault, 'enforce',
        'the committed default is enforce, which would brick prod for anyone ' +
        'whose client cannot present a token. Default monitor; flip enforce ' +
        'via the Functions param after a clean monitor window (Atlas).');
});

test('platform enforceAppCheck stays false so monitor can run the handler', () => {
    const src = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
    const m = src.match(/exports\.publicForm\s*=\s*onCall\([\s\S]*?enforceAppCheck:\s*(true|false)/);
    assert.ok(m, 'could not find enforceAppCheck on publicForm');
    assert.strictEqual(m[1], 'false',
        'platform enforceAppCheck is on, so missing tokens 401 before ' +
        'app-check-door.js runs and monitor cannot log. Keep it false; ' +
        'enforce in-process via PUBLIC_FORM_APP_CHECK_MODE.');
    assert.match(src, /appCheckDoor\.verdict/,
        'publicForm no longer asks app-check-door.js, so the allow/deny tests ' +
        'are watching a function the door does not call');
});

test('turning App Check on still means deploying both halves', () => {
    const cfg = fs.readFileSync(path.join(ROOT, 'public/app-check-config.js'), 'utf8');
    assert.match(cfg, /PUBLIC_FORM_APP_CHECK_MODE/,
        'app-check-config.js no longer points at the server switch it has to ' +
        'agree with, so the next person changes one and ships half a change');
    assert.match(cfg, /enforceAppCheck/,
        'the reminder that platform enforceAppCheck stays false has gone');
});

test('the GitHub Actions deploy workflow ships both halves and stays on monitor', () => {
    const wfPath = path.join(ROOT, '.github/workflows/firebase-deploy.yml');
    assert.ok(fs.existsSync(wfPath),
        'firebase-deploy.yml is missing; Hosting + publicForm have no Actions path');
    const wf = fs.readFileSync(wfPath, 'utf8');
    assert.match(wf, /workflow_dispatch/,
        'the deploy workflow cannot be triggered with gh workflow run');
    assert.match(wf, /^\s+push:\s*$/m,
        'the deploy workflow no longer auto-deploys on push to main');
    assert.match(wf, /branches:\s*\n\s+-\s+main/,
        'the deploy workflow push trigger is not limited to main');
    // MS-545 option B, widened by MS-557, MS-565, then MS-598: standing
    // set must include the attendance trigger, the account-rank sync,
    // sendPrayerRequestNow, mcp, AND firestore:rules. The old prefix
    // without the two new functions still matches a shorter string, so
    // pin the full list (and fail if either export is dropped).
    assert.match(wf, /--only hosting,functions:publicForm,functions:onAttendanceCreated,functions:syncAccountRankToPerson,functions:sendPrayerRequestNow,functions:mcp,functions:notificationOverview,functions:notificationHistory,functions:notificationDevices,functions:notificationRevokeToken,functions:notificationTestPush,firestore:rules/,
        'the deploy workflow no longer ships the standing --only set');
    assert.match(wf, /PUBLIC_FORM_APP_CHECK_MODE=monitor/,
        'the deploy workflow no longer pins App Check to monitor');
    assert.doesNotMatch(wf, /PUBLIC_FORM_APP_CHECK_MODE=enforce/,
        'the deploy workflow sets enforce — that flip is Atlas-escalated HITL, not CI');

    const opsPath = path.join(ROOT, 'docs/ops/ms-545-functions-deploy-set.md');
    assert.ok(fs.existsSync(opsPath),
        'docs/ops/ms-545-functions-deploy-set.md is missing; the standing set is undocumented');
    const ops = fs.readFileSync(opsPath, 'utf8');
    assert.match(ops, /hosting,functions:publicForm,functions:onAttendanceCreated,functions:syncAccountRankToPerson,functions:sendPrayerRequestNow,functions:mcp,functions:notificationOverview,functions:notificationHistory,functions:notificationDevices,functions:notificationRevokeToken,functions:notificationTestPush,firestore:rules/,
        'the ops note no longer lists the standing --only targets');
    assert.match(ops, /functions:sendPrayerRequestNow/,
        'the ops note dropped functions:sendPrayerRequestNow');
    assert.match(ops, /functions:mcp/,
        'the ops note dropped functions:mcp');
    assert.match(ops, /firestore:rules/,
        'the ops note dropped firestore:rules');

    // MS-682. The Push notifications tab is Hosting that cannot work until
    // five callables are live — one of them is the ONLY way a masked Device
    // token reaches a browser. Shipping the page without them is a tab that
    // opens onto an error.
    const pushTab = [
        'notificationOverview', 'notificationHistory', 'notificationDevices',
        'notificationRevokeToken', 'notificationTestPush',
    ];
    pushTab.forEach((name) => {
        assert.match(wf, new RegExp('--only[^\\n]*functions:' + name),
            `the deploy workflow dropped functions:${name}`);
        assert.match(ops, new RegExp('functions:' + name),
            `the ops note dropped functions:${name}`);
        assert.match(
            fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8'),
            new RegExp('exports\\.' + name + '\\s*=\\s*onCall'),
            `${name} is not exported; the standing --only target would deploy nothing`);
    });

    assert.ok(fs.existsSync(path.join(ROOT, 'functions/account-rank-sync.js')),
        'functions/account-rank-sync.js is missing; the trigger has no writer');
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts/backfill-account-rank.js')),
        'scripts/backfill-account-rank.js is missing; existing links cannot be projected');
    const index = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
    assert.match(index, /exports\.syncAccountRankToPerson\s*=\s*onDocumentWritten/,
        'syncAccountRankToPerson is not exported; the standing --only target would deploy nothing');
    assert.match(index, /exports\.sendPrayerRequestNow\s*=\s*onCall/,
        'sendPrayerRequestNow is not exported; the standing --only target would deploy nothing');
    assert.match(index, /exports\.mcp\s*=\s*onRequest/,
        'mcp is not exported; the standing --only target would deploy nothing');
});
