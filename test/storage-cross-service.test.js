const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Storage rules that read Firestore work only while the Cloud Storage for
// Firebase service agent holds roles/firebaserules.firestoreServiceAgent on
// the project, and a --non-interactive deploy never grants it. That is how
// every fill-in upload was refused in prod — super admin and fresh editor
// alike — with rules that were right all along. scripts/storage-cross-service.js
// is what tells the two apart; these pin its logic and the premises its
// signed-out probe stands on.

const ROOT = path.join(__dirname, '..');
const lib = require('../scripts/storage-cross-service');

const storageRules = fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8')
    .replace(/\r\n/g, '\n');

const storageBlock = (pattern, what) => {
    const m = new RegExp(pattern + '\\s*\\{([\\s\\S]*?)\\n    \\}').exec(storageRules);
    assert.ok(m, `the ${what} Storage rule has moved or been renamed, so the probe premise is unchecked`);
    return m[1];
};

const storageFn = (name) => {
    const m = new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n    \\}').exec(storageRules);
    assert.ok(m, `storage.rules no longer defines ${name}()`);
    return m[1];
};

function response(status, body) {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => body,
    };
}

// ── What the deploy and the diagnostic look for ──────────────────────────────

test('storage.rules reads Firestore, so the cross-service role is load-bearing', () => {
    assert.strictEqual(lib.usesCrossService(storageRules), true);
    assert.strictEqual(lib.usesCrossService('allow read: if request.auth != null;'), false);
});

test('IAM and bucket reads ask for cloud-platform, the scope Cloud Storage accepts for getIamPolicy', () => {
    assert.strictEqual(lib.CLOUD_PLATFORM_SCOPE, 'https://www.googleapis.com/auth/cloud-platform',
        'cloud-platform.read-only is refused on a bucket getIamPolicy with "Provided scope(s) are not ' +
        'authorized" — the error that stopped the first diagnostic before it reached IAM');
});

test('storage releases are read per bucket and other services are ignored', () => {
    const rows = lib.storageReleases([
        {name: 'projects/p/releases/cloud.firestore', rulesetName: 'projects/p/rulesets/f'},
        {name: 'projects/p/releases/firebase.storage/p.firebasestorage.app',
            rulesetName: 'projects/p/rulesets/b', updateTime: '2026-10-21T15:42:13Z'},
        {name: 'projects/p/releases/firebase.storage/p.appspot.com', rulesetName: 'projects/p/rulesets/a'},
    ]);
    assert.deepStrictEqual(rows.map((r) => r.bucket), ['p.appspot.com', 'p.firebasestorage.app']);
    assert.strictEqual(rows[1].rulesetName, 'projects/p/rulesets/b');
    assert.strictEqual(rows[1].updateTime, '2026-10-21T15:42:13Z');
});

// ── The role, read from the project IAM policy ────────────────────────────────

const AGENT = 'serviceAccount:service-55@gcp-sa-firebasestorage.iam.gserviceaccount.com';

test('the role counts only as an unconditional project binding for the Storage service agent', () => {
    const granted = lib.crossServiceGrant({bindings: [
        {role: 'roles/firebasestorage.serviceAgent', members: [AGENT]},
        {role: lib.CROSS_SERVICE_ROLE, members: ['user:owner@example.test', AGENT]},
    ]}, '55');
    assert.strictEqual(granted.member, AGENT);
    assert.strictEqual(granted.granted, true);
    assert.deepStrictEqual(granted.agentRoles,
        [lib.CROSS_SERVICE_ROLE, 'roles/firebasestorage.serviceAgent'].sort());

    const missing = lib.crossServiceGrant({bindings: [
        {role: 'roles/firebasestorage.serviceAgent', members: [AGENT]},
        {role: lib.CROSS_SERVICE_ROLE, members: ['serviceAccount:service-99@gcp-sa-firebasestorage.iam.gserviceaccount.com']},
    ]}, '55');
    assert.strictEqual(missing.granted, false);
    assert.strictEqual(missing.conditionalOnly, false);

    const conditional = lib.crossServiceGrant({bindings: [
        {role: lib.CROSS_SERVICE_ROLE, members: [AGENT], condition: {title: 'until Friday', expression: 'x'}},
    ]}, '55');
    assert.strictEqual(conditional.granted, false);
    assert.strictEqual(conditional.conditionalOnly, true);

    assert.strictEqual(lib.crossServiceGrant({}, '55').granted, false);
});

test('the grant command binds the role on the project to the Storage service agent', () => {
    assert.strictEqual(lib.grantCommand('mosaic-hymn-database', '55153890298'), [
        'gcloud projects add-iam-policy-binding mosaic-hymn-database \\',
        '  --member="serviceAccount:service-55153890298@gcp-sa-firebasestorage.iam.gserviceaccount.com" \\',
        '  --role="roles/firebaserules.firestoreServiceAgent" \\',
        '  --condition=None',
    ].join('\n'));
    assert.match(lib.grantCommand('mosaic-hymn-database', ''),
        /service-\$\(gcloud projects describe mosaic-hymn-database --format='value\(projectNumber\)'\)@gcp-sa-firebasestorage/);
});

// ── The signed-out probe ──────────────────────────────────────────────────────

test('the probe verdict reads the cross-service status only when both controls behave', () => {
    assert.strictEqual(lib.probeVerdict({allowed: 404, denied: 403, crossService: 404}), 'works');
    assert.strictEqual(lib.probeVerdict({allowed: 200, denied: 403, crossService: 200}), 'works');
    assert.strictEqual(lib.probeVerdict({allowed: 404, denied: 403, crossService: 403}), 'broken');
    assert.strictEqual(lib.probeVerdict({allowed: 403, denied: 403, crossService: 403}), 'inconclusive',
        'a bucket that denies the if-true control is not answering the way the probe assumes');
    assert.strictEqual(lib.probeVerdict({allowed: 404, denied: 404, crossService: 404}), 'inconclusive');
    assert.strictEqual(lib.probeVerdict({allowed: 404, denied: 403, crossService: 500}), 'inconclusive');
});

test('the probe sends three signed-out GETs to the object paths it names', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({url, options});
        if (url.includes('hymn-sheets')) return response(404);
        return response(403);
    };
    const probe = await lib.probeCrossService({
        bucket: 'p.firebasestorage.app',
        occurrenceId: 'core_seminar_2026-09-06',
        fetchImpl,
    });
    assert.strictEqual(probe.verdict, 'broken');
    assert.deepStrictEqual(probe.statuses, {allowed: 404, denied: 403, crossService: 403});
    assert.deepStrictEqual(calls.map((c) => c.url), [
        'https://firebasestorage.googleapis.com/v0/b/p.firebasestorage.app/o/hymn-sheets%2F__cross_service_probe__%2Fnone',
        'https://firebasestorage.googleapis.com/v0/b/p.firebasestorage.app/o/people_photos%2F__cross_service_probe__%2Fnone',
        'https://firebasestorage.googleapis.com/v0/b/p.firebasestorage.app/o/event_attachments%2Fcore_seminar_2026-09-06%2F__cross_service_probe__%2Fnone',
    ]);
    for (const call of calls) {
        assert.strictEqual(call.options.method, 'GET');
        assert.ok(!call.options.headers, 'the probe must stay signed out — no Authorization header');
    }
});

test('a public occurrence is found with a signed-out query on its visibility stamp', async () => {
    let seen;
    const fetchImpl = async (url, options) => {
        seen = {url, body: JSON.parse(options.body), method: options.method};
        return response(200, [{
            document: {name: 'projects/p/databases/(default)/documents/event_occurrences/occ-public'},
        }]);
    };
    const id = await lib.findPublicOccurrenceId({projectId: 'p', apiKey: 'k', fetchImpl});
    assert.strictEqual(id, 'occ-public');
    assert.strictEqual(seen.method, 'POST');
    assert.strictEqual(seen.url,
        'https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents:runQuery?key=k');
    assert.deepStrictEqual(seen.body.structuredQuery.where.fieldFilter, {
        field: {fieldPath: 'visibility'},
        op: 'EQUAL',
        value: {stringValue: 'public'},
    });

    const none = await lib.findPublicOccurrenceId({
        projectId: 'p', apiKey: 'k', fetchImpl: async () => response(200, [{readTime: 't'}]),
    });
    assert.strictEqual(none, '');

    await assert.rejects(
        lib.findPublicOccurrenceId({projectId: 'p', apiKey: 'k', fetchImpl: async () => response(403, {})}),
        /answered 403/);
});

test('behaviour outranks configuration in the overall verdict', () => {
    const granted = {granted: true};
    const missing = {granted: false};
    assert.strictEqual(lib.overallVerdict({grant: granted, probe: {verdict: 'broken'}}), 'broken');
    assert.strictEqual(lib.overallVerdict({grant: missing, probe: {verdict: 'works'}}), 'works');
    assert.strictEqual(lib.overallVerdict({grant: missing, probe: {verdict: 'inconclusive'}}), 'broken');
    assert.strictEqual(lib.overallVerdict({grant: granted, probe: null}), 'works');
    assert.strictEqual(lib.overallVerdict({grant: null, probe: {verdict: 'inconclusive'}}), 'unknown');
    assert.strictEqual(lib.overallVerdict({grant: null, probe: null}), 'unknown');
});

// ── The rules the probe leans on ──────────────────────────────────────────────

test('probe premise: the allowed control is an if-true read and the denied control needs a sign-in', () => {
    assert.match(storageBlock('match /hymn-sheets/\\{hymnFolder\\}/\\{fileName\\}', 'hymn-sheets'),
        /allow read: if true;/);
    assert.match(storageBlock('match /people_photos/\\{personId\\}/\\{fileId\\}', 'people_photos'),
        /allow read: if isSignedIn\(\);/);
});

test('probe premise: a public occurrence is answered by its own firestore.get, before any sign-in', () => {
    assert.match(
        storageBlock('match /event_attachments/\\{occurrenceId\\}/\\{attachmentId\\}/\\{fileName\\}', 'event_attachments'),
        /allow read: if canSeeOccurrence\(occurrenceId\);/);
    assert.match(storageFn('canSeeOccurrence'),
        /firestore\.get\(\/databases\/\(default\)\/documents\/event_occurrences\/\$\(occurrenceId\)\)\.data/);
    assert.match(storageFn('canSee'), /^\s*return stampedVisibility\(occ\) == 'public'\s*\n\s*\|\|/,
        'canSee() must answer a public occurrence first; otherwise a signed-out probe is denied ' +
        'whether or not Storage can read Firestore, and the probe would report a broken grant');
});

// ── The deploy cannot grant the role, so it checks for it ────────────────────

test('the church deploy checks the cross-service grant after shipping storage rules', () => {
    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'firebase-deploy.yml'), 'utf8');
    const deployAt = wf.search(/npx firebase deploy \\/);
    assert.ok(deployAt >= 0, 'firebase-deploy.yml no longer runs `npx firebase deploy`');
    const deployCmd = wf.slice(deployAt, wf.indexOf('"${EXTRA[@]}"', deployAt));
    assert.match(deployCmd, /--only [^\n]*\bstorage\b/);
    assert.match(deployCmd, /--non-interactive/,
        'if the deploy ever runs interactively the CLI may prompt for the grant itself; ' +
        'revisit this check rather than deleting it');
    const checkAt = wf.indexOf(
        'node scripts/check-storage-cross-service.js --project mosaic-hymn-database --i-mean-prod');
    assert.ok(checkAt > deployAt,
        'the cross-service check must run after the deploy step: a --non-interactive deploy never ' +
        'grants roles/firebaserules.firestoreServiceAgent, and nothing else would notice it missing');
});
