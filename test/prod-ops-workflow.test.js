const {test} = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const {ALLOWLIST_SORTED} = require('../scripts/prod-ops-allowlist');

test('prod ops workflow stays main-only with read permissions and concurrency', () => {
    const wfPath = path.join(ROOT, '.github', 'workflows', 'prod-ops-script.yml');
    const wf = fs.readFileSync(wfPath, 'utf8');
    assert.match(wf, /workflow_dispatch/);
    assert.match(wf, /permissions:\s*\n\s+contents:\s+read/);
    assert.match(wf, /concurrency:\s*\n\s+group:\s+prod-ops-script-mosaic-hymn-database/);
    assert.match(wf, /if:\s+github\.ref == 'refs\/heads\/main'/);
    assert.match(wf, /Refuse prod ops outside main/);
    assert.match(wf, /GOOGLE_APPLICATION_CREDENTIALS/);
    assert.match(wf, /FIREBASE_SERVICE_ACCOUNT/);
    assert.match(wf, /node scripts\/prod-ops-run\.js/);
    assert.match(wf, /check-firebase-deploy\.js --project mosaic-hymn-database --i-mean-prod/);
    assert.doesNotMatch(wf, /push:/);
});

test('prod ops workflow script choices match the allowlist module', () => {
    const wfPath = path.join(ROOT, '.github', 'workflows', 'prod-ops-script.yml');
    const wf = fs.readFileSync(wfPath, 'utf8');
    for (const name of ALLOWLIST_SORTED) {
        assert.match(wf, new RegExp(`- ${name.replace('.', '\\.')}`));
    }
});
