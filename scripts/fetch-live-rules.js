#!/usr/bin/env node
// What the project is ACTUALLY enforcing right now, as against what this repo
// says it should be.
//
// Written for MS-693, which added `storage` to the standing deploy set and so
// needed to know what the first shipment of storage.rules would replace. The
// answer was four merged tickets' worth of undeployed rules, which nothing in
// CI would have told anybody — see docs/ops/ms-693-storage-rules-vs-live.md.
// Run it before any deploy that ships a rules file after a long gap.
//
// READ ONLY. It calls GET on the Firebase Rules API and writes to /tmp. There
// is no code path here that deploys, releases or edits anything, which is why
// it does not ask for --i-mean-prod the way a writing script must.

'use strict';

const fs = require('fs');
const path = require('path');

const {GoogleAuth} = require('google-auth-library');
const {loadProject} = require('./firebase-project.js');

const API = 'https://firebaserules.googleapis.com/v1';

// Which env var holds the key for which project. A key for the wrong project
// is refused rather than tried: the error you get back otherwise is a 403
// that reads like a permissions problem.
const KEY_ENV = {
    'mosaic-hymn-database': 'FIREBASE_SERVICE_ACCOUNT_PROD',
    'mosaic-manager-ghost': 'FIREBASE_SERVICE_ACCOUNT_GHOST',
};

function flag(argv, name) {
    const i = argv.indexOf(name);
    return i === -1 ? '' : (argv[i + 1] || '');
}

function credentialsFor(projectId) {
    const envName = KEY_ENV[projectId];
    if (!envName) {
        throw new Error(`No service-account env var is mapped to ${projectId}.`);
    }
    const raw = process.env[envName];
    if (!raw) throw new Error(`${envName} is not set.`);
    const creds = JSON.parse(raw);
    if (creds.project_id !== projectId) {
        throw new Error(
            `${envName} holds a key for ${creds.project_id}, not ${projectId}.`);
    }
    return creds;
}

async function main() {
    const projectId = flag(process.argv, '--project');
    if (!projectId) {
        console.error('Usage: node scripts/fetch-live-rules.js --project <id>');
        process.exit(1);
    }
    loadProject(path.join(__dirname, '..'), projectId);

    const auth = new GoogleAuth({
        credentials: credentialsFor(projectId),
        scopes: ['https://www.googleapis.com/auth/firebase.readonly'],
    });
    const client = await auth.getClient();
    const get = async (url) => (await client.request({url, method: 'GET'})).data;

    const {releases = []} = await get(`${API}/projects/${projectId}/releases`);
    if (!releases.length) {
        console.log('No rules releases on this project.');
        return;
    }

    for (const release of releases) {
        const name = release.name.split('/releases/')[1];
        const ruleset = await get(`${API}/${release.rulesetName}`);
        const source = (ruleset.source.files || [])
            .map((f) => f.content).join('\n');

        // Named for the service, not the release, so the two files a reader
        // wants to diff have predictable names.
        const kind = name.startsWith('firebase.storage') ? 'storage' : 'firestore';
        const out = `/tmp/live-${kind}.rules`;
        fs.writeFileSync(out, source);

        console.log(`${name}`);
        console.log(`  ruleset  ${release.rulesetName.split('/rulesets/')[1]}`);
        console.log(`  released ${release.updateTime}`);
        console.log(`  written  ${out}`);
        console.log(`  diff     diff -u ${out} ${kind}.rules`);
    }
}

main().catch((e) => {
    console.error('Failed:', e.message);
    process.exit(1);
});
