#!/usr/bin/env node
/**
 * READ-ONLY prod diagnostic: why a super-admin fill-in image upload may get
 * storage/unauthorized on printable_assets/…
 *
 * Prints stored users/{uid} permission fields (uid + email only), linked
 * account_levels doc, live Storage rules markers for printable_assets, and
 * whether the Storage service agent has firebaserules.firestoreServiceAgent
 * on the bucket (cross-service firestore.get in storage.rules).
 *
 *   node scripts/diagnose-storage-fill-in-upload.js \
 *     --project mosaic-hymn-database --i-mean-prod
 *
 * Ignores --commit (this script never writes). Safe for Prod ops workflow
 * with commit=false.
 */

'use strict';

const path = require('path');
const admin = require('firebase-admin');
const {GoogleAuth} = require('google-auth-library');
const {
    requireProject,
    loadProject,
    PROD_PROJECT_ID,
} = require('./firebase-project');
const {serviceAccount} = require('./service-account');

const ROOT = path.join(__dirname, '..');
const RULES_API = 'https://firebaserules.googleapis.com/v1';

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

async function authClient(scopes) {
    const creds = serviceAccount();
    const auth = new GoogleAuth({credentials: creds, scopes});
    return auth.getClient();
}

async function fetchLiveStorageRules(projectId) {
    const client = await authClient(['https://www.googleapis.com/auth/firebase.readonly']);
    const get = async (url) => (await client.request({url, method: 'GET'})).data;
    const {releases = []} = await get(`${RULES_API}/projects/${projectId}/releases`);
    const storageRelease = releases.find((r) => String(r.name || '').includes('firebase.storage'));
    if (!storageRelease) {
        return {found: false, markers: {}};
    }
    const ruleset = await get(`${RULES_API}/${storageRelease.rulesetName}`);
    const source = (ruleset.source.files || []).map((f) => f.content).join('\n');
    const printableBlock = /match \/printable_assets\/\{printableId\}\/\{fileId\} \{([\s\S]*?)\n    \}/
        .exec(source);
    return {
        found: true,
        release: storageRelease.name,
        updateTime: storageRelease.updateTime,
        rulesetId: storageRelease.rulesetName,
        markers: {
            permissionLevelAccount: /function permissionLevelAccount\(\)/.test(source),
            isSuperAdminAccount: /function isSuperAdminAccount\(\)/.test(source),
            editsWithPrintables: /editsWithAccount\('printables\.edit'\)/.test(source),
            catchAll: /match \/\{allPaths=\*\*\}/.test(source),
            printableWrite: printableBlock ? printableBlock[1].replace(/\s+/g, ' ').trim() : '(block not found)',
        },
    };
}

async function fetchProjectNumber(projectId) {
    const client = await authClient(['https://www.googleapis.com/auth/cloud-platform.read-only']);
    const url = `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`;
    const data = (await client.request({url, method: 'GET'})).data;
    return String(data.projectNumber || '');
}

async function fetchBucketIam(bucket) {
    const client = await authClient(['https://www.googleapis.com/auth/cloud-platform.read-only']);
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/iam`;
    return (await client.request({url, method: 'GET'})).data;
}

function storageAgentHasFirestoreRole(iam, projectNumber) {
    const expectedMember = `serviceAccount:service-${projectNumber}@gcp-sa-firebasestorage.iam.gserviceaccount.com`;
    const role = 'roles/firebaserules.firestoreServiceAgent';
    const bindings = iam.bindings || [];
    const hit = bindings.find((b) => b.role === role
        && (b.members || []).includes(expectedMember));
    return {expectedMember, role, granted: !!hit, bindings: bindings.length};
}

async function main() {
    const argv = process.argv.slice(2);
    assertReadOnly(argv);
    const projectId = requireProject(argv);
    if (projectId !== PROD_PROJECT_ID) {
        throw new Error(`This diagnostic is for ${PROD_PROJECT_ID} only.`);
    }
    loadProject(ROOT, projectId);
    const bucket = loadProject(ROOT, projectId).storageBucket;

    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount()),
            projectId,
        });
    }
    const db = admin.firestore();
    const auth = admin.auth();

    console.log('=== Storage fill-in upload diagnostic (read-only) ===');
    console.log(`project: ${projectId}`);
    console.log(`bucket:  ${bucket}`);
    console.log('');

    const usersSnap = await db.collection('users').get();
    const superAdmins = [];
    for (const doc of usersSnap.docs) {
        const data = doc.data() || {};
        if (isSuperAdminUser(data)) superAdmins.push({id: doc.id, data});
    }
    console.log(`super-admin-shaped users: ${superAdmins.length}`);
    for (const row of superAdmins) {
        let email = '(no auth record)';
        try {
            const rec = await auth.getUser(row.id);
            email = rec.email || email;
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

    console.log('');
    console.log('=== Live Storage rules (Firebase Rules API) ===');
    const live = await fetchLiveStorageRules(projectId);
    console.log(JSON.stringify(live, null, 2));

    console.log('');
    console.log('=== Bucket IAM (Storage service agent → Firestore Rules) ===');
    const projectNumber = await fetchProjectNumber(projectId);
    const iam = await fetchBucketIam(bucket);
    const agent = storageAgentHasFirestoreRole(iam, projectNumber);
    console.log(JSON.stringify({projectNumber, ...agent}, null, 2));

    console.log('');
    console.log('=== Repo storage.rules printable_assets (for diff) ===');
    const fs = require('fs');
    const repoRules = fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8');
    const repoBlock = /match \/printable_assets\/\{printableId\}\/\{fileId\} \{([\s\S]*?)\n    \}/.exec(repoRules);
    console.log(repoBlock ? repoBlock[0] : '(printable_assets block not found in repo)');
}

main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exit(1);
});
