#!/usr/bin/env node
/**
 * Fail when storage.rules reads Firestore but this project's Storage cannot.
 *
 *   node scripts/check-storage-cross-service.js --project <id> [--i-mean-prod] [--probe-only]
 *
 * READ ONLY. Reads the project IAM policy with the deploy service account
 * when it may, then sends three signed-out GETs for objects that do not exist
 * (storage-cross-service.js explains what each one proves). --probe-only
 * skips the IAM read and needs no credentials at all, so anyone can run it
 * from a laptop, including right after a grant to see it take effect.
 *
 * Exit 1 when Storage rules cannot read Firestore. firebase-deploy.yml runs
 * this after the deploy: --non-interactive means the CLI never grants the
 * role itself, so this step is the only thing that notices it is missing.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {requireProject, loadProject} = require('./firebase-project');
const lib = require('./storage-cross-service');

const ROOT = path.join(__dirname, '..');

function annotate(level, title, message) {
    if (process.env.GITHUB_ACTIONS === 'true') {
        console.log(`::${level} title=${title}::${message}`);
    }
}

async function readGrant(projectId) {
    const {serviceAccount} = require('./service-account');
    const request = await lib.authorizedRequest(serviceAccount());
    const projectNumber = await lib.projectNumberOf(request, projectId);
    const policy = await lib.projectIamPolicy(request, projectId);
    return {projectNumber, grant: lib.crossServiceGrant(policy, projectNumber)};
}

async function main() {
    const argv = process.argv.slice(2);
    const projectId = requireProject(process.argv);
    const project = loadProject(ROOT, projectId);
    const rules = fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8');

    console.log(`project: ${projectId}`);
    console.log(`bucket:  ${project.storageBucket}`);
    if (!lib.usesCrossService(rules)) {
        console.log('storage.rules makes no firestore.get() / firestore.exists() call. Nothing to check.');
        return 0;
    }

    let grant = null;
    let projectNumber = '';
    if (!argv.includes('--probe-only')) {
        try {
            ({projectNumber, grant} = await readGrant(projectId));
            console.log(`IAM:     ${grant.member}`);
            console.log(`         ${grant.role}: ${grant.granted ? 'granted' : 'NOT granted'}` +
                (grant.conditionalOnly ? ' (only a conditional binding)' : ''));
            console.log(`         roles held: ${grant.agentRoles.join(', ') || '(none)'}`);
        } catch (err) {
            console.log(`IAM:     could not read the project policy (${err.message}); the probe decides.`);
        }
    }

    let probe = null;
    try {
        const occurrenceId = await lib.findPublicOccurrenceId({projectId, apiKey: project.apiKey});
        if (!occurrenceId) {
            console.log('probe:   no occurrence is stamped public, so there is nothing to probe with.');
        } else {
            probe = await lib.probeCrossService({bucket: project.storageBucket, occurrenceId});
            for (const key of Object.keys(probe.paths)) {
                console.log(`probe:   ${String(probe.statuses[key]).padEnd(4)}${probe.paths[key]}`);
            }
            console.log(`probe:   ${probe.verdict}`);
        }
    } catch (err) {
        console.log(`probe:   failed (${err.message}).`);
    }

    const verdict = lib.overallVerdict({grant, probe});
    console.log('');
    if (verdict === 'works') {
        console.log('Storage rules can read Firestore.');
        return 0;
    }
    if (verdict === 'unknown') {
        const msg = 'Could not tell whether Storage rules can read Firestore (no IAM read, no conclusive probe).';
        annotate('warning', 'Storage cross-service rules', msg);
        console.log(msg);
        return 0;
    }

    const roleBound = grant && grant.granted;
    const msg = roleBound
        ? 'The Storage service agent holds the Firestore role, but Storage rules still cannot read ' +
          'Firestore. A grant takes a few minutes to propagate; otherwise look for an org policy or ' +
          'VPC Service Controls perimeter between Cloud Storage and Firestore.'
        : 'Storage rules cannot read Firestore, so every storage.rules path that calls ' +
          'firestore.get() or firestore.exists() denies everyone. A project owner must grant the ' +
          'Storage service agent its Firestore role (the deploy never does: --non-interactive).';
    annotate('error', 'Storage rules cannot read Firestore', msg);
    console.log(msg);
    if (!roleBound) {
        console.log('');
        console.log(lib.grantCommand(projectId, projectNumber));
    }
    return 1;
}

main().then((code) => {
    process.exitCode = code;
}, (err) => {
    console.error(err.stack || err.message || err);
    process.exitCode = 1;
});
