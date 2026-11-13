/**
 * Allowlisted prod-ops entry for baptism string migration (MS-795, ADR-0006).
 *
 * Delegates to migrate-baptism.cjs. Dry-run by default; prod-ops-run appends
 * --project mosaic-hymn-database --i-mean-prod and optional --commit.
 */

const path = require('path');
const {spawnSync} = require('child_process');

require('./firebase-project').requireProject(process.argv);

const commit = process.argv.includes('--commit');
const childArgs = [path.join(__dirname, 'migrate-baptism.cjs')];
if (commit) childArgs.push('--commit');

const result = spawnSync(process.execPath, childArgs, {
    stdio: 'inherit',
    env: process.env,
});

process.exit(result.status == null ? 1 : result.status);
