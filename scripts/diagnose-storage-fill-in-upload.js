#!/usr/bin/env node
/**
 * READ-ONLY prod diagnostic: why a fill-in image upload on printable_assets/…
 * (or any Storage path whose rule reads Firestore) gets storage/unauthorized.
 *
 * Each section runs on its own, so one failing API call cannot hide the rest:
 *   - the client's bucket, the Firebase default bucket, the linked buckets
 *   - every firebase.storage/<bucket> rules release and its ruleset markers
 *   - the super-admin-shaped users/{uid} docs and their account_levels doc
 *   - project IAM: the roles the Storage service agent holds, including
 *     roles/firebaserules.firestoreServiceAgent (cross-service rules)
 *   - bucket IAM: the roles the Storage service agent holds on each bucket
 *   - whether this caller may read or change the project IAM policy
 *   - a signed-out probe: can Storage rules read Firestore at all?
 *
 *   node scripts/diagnose-storage-fill-in-upload.js \
 *     --project mosaic-hymn-database --i-mean-prod
 *
 * Ignores --commit (this script never writes). Safe for Prod ops workflow
 * with commit=false. A public repo's run logs are public: emails are masked,
 * and no IAM member other than the Storage service agent is printed.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const {
    requireProject,
    loadProject,
    PROD_PROJECT_ID,
} = require('./firebase-project');
const {serviceAccount} = require('./service-account');
const lib = require('./storage-cross-service');

const ROOT = path.join(__dirname, '..');
const PRINTABLE_BLOCK = /match \/printable_assets\/\{printableId\}\/\{fileId\} \{([\s\S]*?)\n    \}/;
const IAM_PERMISSIONS = [
    'resourcemanager.projects.getIamPolicy',
    'resourcemanager.projects.setIamPolicy',
];

function assertReadOnly(argv) {
    if (argv.includes('--commit')) {
        console.log('Note: --commit is ignored; this script is read-only.');
    }
}

function isSuperAdminUser(data) {
    if (!data || typeof data !== 'object') return false;
    const level = data.permissionLevel || data.role || '';
    if (level === 'super_admin') return true;
    if (data.accountLevelId === 'level_super_admin') return true;
    const perms = data.permissions;
    return !!(perms && perms['system.super_admin'] === true);
}

function summarizePermissions(perms) {
    if (!perms || typeof perms !== 'object') return null;
    const keys = Object.keys(perms).filter((k) => perms[k] === true).sort();
    return {
        trueKeyCount: keys.length,
        hasPrintablesEdit: perms['printables.edit'] === true,
        hasServicesBuilderEdit: perms['services.builder.edit'] === true,
        hasSystemSuperAdmin: perms['system.super_admin'] === true,
        sampleKeys: keys.slice(0, 12),
    };
}

function maskEmail(email) {
    const m = /^([^@])[^@]*(@.+)$/.exec(String(email || ''));
    return m ? `${m[1]}***${m[2]}` : '(none)';
}

function rulesMarkers(source, repoSource) {
    const printable = PRINTABLE_BLOCK.exec(source);
    return {
        sameAsRepo: source === repoSource,
        usesCrossService: lib.usesCrossService(source),
        catchAll: /match \/\{allPaths=\*\*\}/.test(source),
        permissionLevelAccount: /function permissionLevelAccount\(\)/.test(source),
        isSuperAdminAccount: /function isSuperAdminAccount\(\)/.test(source),
        printableWrite: printable ? printable[1].replace(/\s+/g, ' ').trim() : '(block not found)',
    };
}

async function section(title, fn) {
    console.log('');
    console.log(`=== ${title} ===`);
    try {
        return await fn();
    } catch (err) {
        const status = err && err.response && err.response.status;
        console.log(`ERROR${status ? ` ${status}` : ''}: ${(err && err.message) || err}`);
        return undefined;
    }
}

async function printUsers(db, auth) {
    const usersSnap = await db.collection('users').get();
    const superAdmins = usersSnap.docs
        .map((doc) => ({id: doc.id, data: doc.data() || {}}))
        .filter((row) => isSuperAdminUser(row.data));
    console.log(`super-admin-shaped users: ${superAdmins.length}`);
    for (const row of superAdmins) {
        let email = '(no auth record)';
        try {
            email = maskEmail((await auth.getUser(row.id)).email);
        } catch (e) {
            email = `(auth lookup failed: ${e.code || e.message})`;
        }
        const d = row.data;
        console.log('');
        console.log(`--- users/${row.id} ---`);
        console.log(`email: ${email}`);
        console.log(`permissionLevel: ${JSON.stringify(d.permissionLevel)}`);
        console.log(`role: ${JSON.stringify(d.role)}`);
        console.log(`accountLevelId: ${JSON.stringify(d.accountLevelId)}`);
        console.log(`pastoralAssistant: ${JSON.stringify(d.pastoralAssistant)}`);
        console.log(`permissions summary: ${JSON.stringify(summarizePermissions(d.permissions))}`);
        if (d.accountLevelId) {
            const levelDoc = await db.collection('account_levels').doc(d.accountLevelId).get();
            if (levelDoc.exists) {
                const ld = levelDoc.data() || {};
                console.log(`account_levels/${d.accountLevelId}: presetKey=${JSON.stringify(ld.presetKey)} custom=${JSON.stringify(ld.custom)} system=${JSON.stringify(ld.system)}`);
                console.log(`  level permissions summary: ${JSON.stringify(summarizePermissions(ld.permissions))}`);
            } else {
                console.log(`account_levels/${d.accountLevelId}: (missing)`);
            }
        }
    }
}

async function main() {
    const argv = process.argv.slice(2);
    assertReadOnly(argv);
    const projectId = requireProject(process.argv);
    if (projectId !== PROD_PROJECT_ID) {
        throw new Error(`This diagnostic is for ${PROD_PROJECT_ID} only.`);
    }
    const project = loadProject(ROOT, projectId);
    const clientBucket = project.storageBucket;
    const repoRules = fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8');
    const creds = serviceAccount();

    if (!admin.apps.length) {
        admin.initializeApp({credential: admin.credential.cert(creds), projectId});
    }
    const request = await lib.authorizedRequest(creds);

    console.log('=== Storage fill-in upload diagnostic (read-only) ===');
    console.log(`project:              ${projectId}`);
    console.log(`client bucket:        ${clientBucket}  (config/firebase-projects.json → public/firebase-config.js)`);

    const buckets = new Set([clientBucket]);
    await section('Buckets', async () => {
        const defaultBucket = await lib.firebaseDefaultBucket(request, projectId).catch((e) => `(error: ${e.message})`);
        const linked = await lib.firebaseLinkedBuckets(request, projectId).catch((e) => [`(error: ${e.message})`]);
        console.log(`Firebase default bucket (what \`firebase deploy --only storage\` releases to): ${defaultBucket}`);
        console.log(`Firebase-linked buckets: ${linked.join(', ') || '(none)'}`);
        console.log(`default bucket is the client bucket: ${defaultBucket === clientBucket}`);
        linked.filter((b) => !b.startsWith('(')).forEach((b) => buckets.add(b));
    });

    await section('Storage rules releases, per bucket (Firebase Rules API)', async () => {
        const releases = lib.storageReleases(await lib.listReleases(request, projectId));
        if (!releases.length) console.log('No firebase.storage/<bucket> release exists.');
        for (const release of releases) {
            buckets.add(release.bucket);
            const source = await lib.rulesetSource(request, release.rulesetName);
            const tag = release.bucket === clientBucket ? '  ← the bucket the client uploads to' : '';
            console.log('');
            console.log(`--- ${release.bucket}${tag} ---`);
            console.log(JSON.stringify({
                release: release.name,
                updateTime: release.updateTime,
                ruleset: release.rulesetName,
                markers: rulesMarkers(source, repoRules),
            }, null, 2));
        }
        if (!releases.some((r) => r.bucket === clientBucket)) {
            console.log(`⚠ No release names ${clientBucket}: the client's bucket has no rules from this repo.`);
        }
    });

    await section('Super-admin users/{uid} (uid + masked email)', async () => {
        await printUsers(admin.firestore(), admin.auth());
    });

    let grant = null;
    let projectNumber = '';
    await section('Project IAM: the Storage service agent and cross-service rules', async () => {
        projectNumber = await lib.projectNumberOf(request, projectId);
        console.log(`projectNumber: ${projectNumber}`);
        grant = lib.crossServiceGrant(await lib.projectIamPolicy(request, projectId), projectNumber);
        console.log(JSON.stringify(grant, null, 2));
    });

    await section('Bucket IAM: roles the Storage service agent holds per bucket', async () => {
        if (!projectNumber) {
            console.log('Skipped: the project number is unknown (see the section above).');
            return;
        }
        const member = lib.storageAgentMember(projectNumber);
        for (const bucket of [...buckets].sort()) {
            try {
                const policy = await lib.bucketIamPolicy(request, bucket);
                console.log(`${bucket}: ${(policy.bindings || []).length} bindings; ` +
                    `service agent roles: ${lib.rolesHeldBy(policy, member).join(', ') || '(none)'}`);
            } catch (err) {
                console.log(`${bucket}: ERROR ${(err.response && err.response.status) || ''} ${err.message}`);
            }
        }
        console.log('(roles/firebaserules.firestoreServiceAgent is a PROJECT binding; it is not expected here.)');
    });

    await section('This caller on the project IAM policy', async () => {
        const held = await lib.callerProjectPermissions(request, projectId, IAM_PERMISSIONS);
        for (const permission of IAM_PERMISSIONS) {
            console.log(`${permission}: ${held.includes(permission) ? 'yes' : 'no'}`);
        }
        console.log(held.includes('resourcemanager.projects.setIamPolicy')
            ? 'This service account could grant the role.'
            : 'This service account cannot grant the role; a project owner must.');
    });

    let probe = null;
    await section('Signed-out probe: can Storage rules read Firestore?', async () => {
        const occurrenceId = await lib.findPublicOccurrenceId({projectId, apiKey: project.apiKey});
        if (!occurrenceId) {
            console.log('No occurrence is stamped public; nothing to probe with.');
            return;
        }
        probe = await lib.probeCrossService({bucket: clientBucket, occurrenceId});
        console.log(JSON.stringify(probe, null, 2));
        console.log('allowed / denied read no Firestore and must answer 404 / 403. crossService is ' +
            'allowed (404) only if firestore.get() on the public occurrence comes back; 403 means it failed.');
    });

    await section('Verdict', async () => {
        const verdict = lib.overallVerdict({grant, probe});
        if (verdict === 'works') {
            console.log('Storage rules CAN read Firestore. Look at the rule, the doc shape, or the client.');
        } else if (verdict === 'broken') {
            console.log('Storage rules CANNOT read Firestore. Every path whose rule calls firestore.get() or ' +
                'firestore.exists() denies every caller: writes to printable_assets, sunday_typed, ' +
                'guide-assets and hymn-sheets; reads and writes of resources and event_attachments; ' +
                'reads of form_uploads and form_uploads_elder.');
            if (!(grant && grant.granted)) {
                console.log('');
                console.log('Fix (project owner, one time):');
                console.log(lib.grantCommand(projectId, projectNumber));
            }
        } else {
            console.log('Inconclusive: neither the IAM read nor the probe gave an answer.');
        }
    });

    await section('Repo storage.rules printable_assets (for diff)', async () => {
        const repoBlock = PRINTABLE_BLOCK.exec(repoRules);
        console.log(repoBlock ? repoBlock[0] : '(printable_assets block not found in repo)');
    });
}

main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exit(1);
});
