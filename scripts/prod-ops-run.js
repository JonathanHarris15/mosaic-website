/**
 * @fileoverview Run one allowlisted `scripts/*.js` op against mosaic-hymn-database.
 *
 * Used by `.github/workflows/prod-ops-script.yml`. Expects:
 *   PROD_OPS_SCRIPT — basename under scripts/ (allowlisted)
 *   PROD_OPS_ARGS   — extra flags, validated and split in-process
 *   PROD_OPS_COMMIT — "true" to append --commit; default is dry-run
 *
 * GOOGLE_APPLICATION_CREDENTIALS must point at the church service account
 * (the workflow sets it the same way as firebase-deploy.yml).
 */

const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const {PROD_PROJECT_ID} = require('./firebase-project');
const {ALLOWLIST} = require('./prod-ops-allowlist');
const {splitOpsArgs} = require('./prod-ops-args');

function main() {
    const script = process.env.PROD_OPS_SCRIPT;
    if (!script) {
        throw new Error('PROD_OPS_SCRIPT is required.');
    }
    if (!ALLOWLIST.has(script)) {
        throw new Error(`Script is not allowlisted: ${script}`);
    }

    const scriptPath = path.join(__dirname, script);
    if (!fs.existsSync(scriptPath)) {
        throw new Error(`Missing scripts/${script}`);
    }

    const commit = process.env.PROD_OPS_COMMIT === 'true';
    const extra = splitOpsArgs(process.env.PROD_OPS_ARGS || '');
    const nodeArgs = [
        scriptPath,
        '--project',
        PROD_PROJECT_ID,
        '--i-mean-prod',
        ...extra,
    ];
    if (commit) {
        nodeArgs.push('--commit');
    }

    console.log(`Running: node scripts/${script} --project ${PROD_PROJECT_ID} --i-mean-prod \\`);
    if (extra.length) {
        console.log(`  ${extra.join(' ')}${commit ? ' --commit' : ''}`);
    } else if (commit) {
        console.log('  --commit');
    }
    console.log(`mode=${commit ? 'commit' : 'dry-run'}`);

    const result = spawnSync(process.execPath, nodeArgs, {
        encoding: 'utf8',
        env: process.env,
    });

    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    process.stdout.write(stdout);
    process.stderr.write(stderr);

    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
        const block = [
            `### Prod ops: \`${script}\``,
            '',
            `- **mode:** ${commit ? 'commit' : 'dry-run'}`,
            `- **args:** \`${extra.join(' ') || '(none)'}\``,
            '',
            '```',
            stdout.trimEnd(),
            '```',
            '',
        ].join('\n');
        fs.appendFileSync(summaryPath, block);
    }

    if (result.error) {
        throw result.error;
    }
    process.exit(result.status === null ? 1 : result.status);
}

main();
