/**
 * @fileoverview Whether this project's Storage rules can read Cloud Firestore.
 *
 * A storage.rules call to firestore.get() or firestore.exists() is made by the
 * Cloud Storage for Firebase service agent, and it succeeds only while that
 * agent holds roles/firebaserules.firestoreServiceAgent on the project. Without
 * the role every such call fails, so every rule built on one denies every
 * caller — super admin included — with the same storage/unauthorized a wrong
 * rule gives.
 *
 * `firebase deploy` adds the role only after asking, and with
 * --non-interactive it never asks: firebase-tools rulesDeploy.js
 * checkStorageRulesIamPermissions returns before it looks. Both deploy
 * workflows pass --non-interactive.
 *
 * Two ways to tell, used together by check-storage-cross-service.js and
 * diagnose-storage-fill-in-upload.js:
 *   - the project IAM policy, when the caller may read it;
 *   - a signed-out probe that needs no credentials: a read under a public
 *     occurrence's event_attachments prefix is allowed only when the rule's
 *     firestore.get() comes back. Two control reads that touch no Firestore
 *     prove the bucket is answering the way the probe assumes.
 */

'use strict';

const CROSS_SERVICE_ROLE = 'roles/firebaserules.firestoreServiceAgent';

// cloud-platform, not cloud-platform.read-only: Cloud Storage refuses the
// read-only scope on a bucket's getIamPolicy ("Provided scope(s) are not
// authorized"), which is where the first version of the diagnostic stopped.
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

const RULES_API = 'https://firebaserules.googleapis.com/v1';
const CRM_API = 'https://cloudresourcemanager.googleapis.com/v1';
const STORAGE_OBJECTS_API = 'https://firebasestorage.googleapis.com/v0';
const FIREBASE_STORAGE_API = 'https://firebasestorage.googleapis.com';
const PROBE_SEGMENT = '__cross_service_probe__';

// The same test firebase-tools applies before it offers the grant.
function usesCrossService(rulesSource) {
    return /firestore\.(get|exists)/.test(String(rulesSource || ''));
}

function storageAgentEmail(projectNumber) {
    return `service-${projectNumber}@gcp-sa-firebasestorage.iam.gserviceaccount.com`;
}

function storageAgentMember(projectNumber) {
    return `serviceAccount:${storageAgentEmail(projectNumber)}`;
}

function grantCommand(projectId, projectNumber) {
    const number = projectNumber
        ? String(projectNumber)
        : `$(gcloud projects describe ${projectId} --format='value(projectNumber)')`;
    return [
        `gcloud projects add-iam-policy-binding ${projectId} \\`,
        `  --member="${storageAgentMember(number)}" \\`,
        `  --role="${CROSS_SERVICE_ROLE}" \\`,
        '  --condition=None',
    ].join('\n');
}

// Rules API releases → one row per `firebase.storage/<bucket>` release.
function storageReleases(releases) {
    return (releases || [])
        .map((release) => {
            const name = String((release && release.name) || '');
            const m = /\/releases\/firebase\.storage\/(.+)$/.exec(name);
            if (!m) return null;
            return {
                bucket: m[1],
                name,
                rulesetName: release.rulesetName || '',
                updateTime: release.updateTime || '',
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

function rolesHeldBy(policy, member) {
    return ((policy && policy.bindings) || [])
        .filter((b) => (b.members || []).includes(member))
        .map((b) => (b.condition
            ? `${b.role} (only when: ${b.condition.title || b.condition.expression || 'a condition'})`
            : b.role))
        .sort();
}

// A conditional binding grants only while its condition holds, so it does not
// count as the role being held.
function crossServiceGrant(policy, projectNumber) {
    const member = storageAgentMember(projectNumber);
    const bindings = ((policy && policy.bindings) || [])
        .filter((b) => b.role === CROSS_SERVICE_ROLE && (b.members || []).includes(member));
    return {
        member,
        role: CROSS_SERVICE_ROLE,
        granted: bindings.some((b) => !b.condition),
        conditionalOnly: bindings.length > 0 && bindings.every((b) => !!b.condition),
        agentRoles: rolesHeldBy(policy, member),
    };
}

// Signed out, for objects that do not exist. `allowed` and `denied` read no
// Firestore (hymn-sheets is `if true`, people_photos is isSignedIn()), so they
// show what an allow and a deny look like from this bucket. `crossService` is
// allowed only through canSeeOccurrence()'s firestore.get() on a public
// occurrence.
function probePaths(occurrenceId) {
    return {
        allowed: `hymn-sheets/${PROBE_SEGMENT}/none`,
        denied: `people_photos/${PROBE_SEGMENT}/none`,
        crossService: `event_attachments/${occurrenceId}/${PROBE_SEGMENT}/none`,
    };
}

function objectUrl(bucket, objectPath) {
    return `${STORAGE_OBJECTS_API}/b/${bucket}/o/${encodeURIComponent(objectPath)}`;
}

// Rules answer before the object lookup: an allowed read of a missing object
// is 404, a denied one is 403.
function isAllowedStatus(status) {
    return status === 200 || status === 404;
}

function probeVerdict(statuses) {
    const s = statuses || {};
    if (!isAllowedStatus(s.allowed) || s.denied !== 403) return 'inconclusive';
    if (isAllowedStatus(s.crossService)) return 'works';
    if (s.crossService === 403) return 'broken';
    return 'inconclusive';
}

async function probeCrossService({bucket, occurrenceId, fetchImpl = globalThis.fetch}) {
    const paths = probePaths(occurrenceId);
    const statuses = {};
    for (const [key, objectPath] of Object.entries(paths)) {
        const res = await fetchImpl(objectUrl(bucket, objectPath), {method: 'GET'});
        statuses[key] = res.status;
    }
    return {occurrenceId, paths, statuses, verdict: probeVerdict(statuses)};
}

// Signed out, with the public web API key: firestore.rules lets anyone read
// an occurrence stamped `public`, so this needs no credentials either.
async function findPublicOccurrenceId({projectId, apiKey, fetchImpl = globalThis.fetch}) {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}` +
        `/databases/(default)/documents:runQuery?key=${encodeURIComponent(apiKey)}`;
    const body = {
        structuredQuery: {
            from: [{collectionId: 'event_occurrences'}],
            where: {
                fieldFilter: {
                    field: {fieldPath: 'visibility'},
                    op: 'EQUAL',
                    value: {stringValue: 'public'},
                },
            },
            select: {fields: [{fieldPath: 'visibility'}]},
            limit: 1,
        },
    };
    const res = await fetchImpl(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        throw new Error(`Firestore answered ${res.status} to the public occurrence query`);
    }
    const rows = await res.json();
    const doc = (Array.isArray(rows) ? rows : []).map((r) => r && r.document).find(Boolean);
    return doc ? String(doc.name).split('/').pop() : '';
}

// Behaviour outranks configuration: a bound role that still fails reads is
// broken, and a working probe needs no IAM read to say so.
function overallVerdict({grant, probe}) {
    if (probe && probe.verdict === 'works') return 'works';
    if (probe && probe.verdict === 'broken') return 'broken';
    if (grant) return grant.granted ? 'works' : 'broken';
    return 'unknown';
}

async function authorizedRequest(credentials) {
    const {GoogleAuth} = require('google-auth-library');
    const auth = new GoogleAuth({credentials, scopes: [CLOUD_PLATFORM_SCOPE]});
    const client = await auth.getClient();
    return async (url, {method = 'GET', data} = {}) =>
        (await client.request({url, method, data})).data;
}

async function projectNumberOf(request, projectId) {
    const data = await request(`${CRM_API}/projects/${projectId}`);
    return String(data.projectNumber || '');
}

async function projectIamPolicy(request, projectId) {
    return request(`${CRM_API}/projects/${projectId}:getIamPolicy`, {
        method: 'POST',
        data: {options: {requestedPolicyVersion: 3}},
    });
}

async function callerProjectPermissions(request, projectId, permissions) {
    const data = await request(`${CRM_API}/projects/${projectId}:testIamPermissions`, {
        method: 'POST',
        data: {permissions},
    });
    return data.permissions || [];
}

async function bucketIamPolicy(request, bucket) {
    return request(
        `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/iam` +
        '?optionsRequestedPolicyVersion=3');
}

async function listReleases(request, projectId) {
    const releases = [];
    let pageToken = '';
    do {
        const query = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '';
        const page = await request(`${RULES_API}/projects/${projectId}/releases${query}`);
        releases.push(...(page.releases || []));
        pageToken = page.nextPageToken || '';
    } while (pageToken);
    return releases;
}

async function rulesetSource(request, rulesetName) {
    const ruleset = await request(`${RULES_API}/${rulesetName}`);
    return ((ruleset.source && ruleset.source.files) || []).map((f) => f.content).join('\n');
}

// What `firebase deploy --only storage` releases to when firebase.json names
// no bucket (firebase-tools gcp/storage.js getDefaultBucket).
async function firebaseDefaultBucket(request, projectId) {
    const data = await request(`${FIREBASE_STORAGE_API}/v1alpha/projects/${projectId}/defaultBucket`);
    return String((data.bucket && data.bucket.name) || '').split('/').pop();
}

async function firebaseLinkedBuckets(request, projectId) {
    const data = await request(`${FIREBASE_STORAGE_API}/v1beta/projects/${projectId}/buckets`);
    return (data.buckets || []).map((b) => String(b.name || '').split('/').pop()).sort();
}

module.exports = {
    CROSS_SERVICE_ROLE,
    CLOUD_PLATFORM_SCOPE,
    usesCrossService,
    storageAgentEmail,
    storageAgentMember,
    grantCommand,
    storageReleases,
    rolesHeldBy,
    crossServiceGrant,
    probePaths,
    objectUrl,
    probeVerdict,
    probeCrossService,
    findPublicOccurrenceId,
    overallVerdict,
    authorizedRequest,
    projectNumberOf,
    projectIamPolicy,
    callerProjectPermissions,
    bucketIamPolicy,
    listReleases,
    rulesetSource,
    firebaseDefaultBucket,
    firebaseLinkedBuckets,
};
