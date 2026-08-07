// Copy the pure domain modules the Cloud Functions need out of `public/` and
// into `functions/shared/` (MS-20).
//
// ⚠ WHY THIS EXISTS. `functions/` deploys as its own bundle: only that folder
// is uploaded, so nothing in it can `require('../public/...')`. Until now that
// did not matter — the functions restated the handful of constants they needed
// (`assignment-conversion.js` has its own copy of the assignment states) and a
// test held the copies together.
//
// MS-20 breaks that. ADR-0030 says a member taking a place off the cover list
// must be refused BY THE SERVER, not merely by the screen — and answering "may
// this person take this place" is the whole of `RolesCore.candidatesFor`: five
// restriction kinds, the allowlist, sex requirements, Role exclusivity, the
// relationship and group rules. Restating that by hand would duplicate the most
// security-sensitive logic in the app, in the one place a divergence would be
// invisible: the server would quietly permit what the screen refuses, or the
// reverse, and no test of either half would notice.
//
// So the modules are COPIED rather than rewritten. There is one authored copy,
// in `public/`. `test/functions-shared-sync.test.js` asserts the copies match
// what this script would produce, so a stale copy fails `npm test` rather than
// being discovered in production.
//
// Run by hand (`node scripts/sync-shared-to-functions.js`) and automatically
// before every functions deploy, via the `predeploy` hook in firebase.json.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FROM = path.join(ROOT, 'public');
const TO = path.join(ROOT, 'functions', 'shared');

// The closure, smallest first. None of these requires anything beyond the
// others in this list, which is what makes copying them safe — a module that
// reached for the DOM or for Firestore could not come along.
const MODULES = [
    'events-occurrence-core.js',
    'roles-core.js',
    'cover-core.js',
];

const BANNER = [
    '// ⚠ GENERATED FILE — DO NOT EDIT.',
    '//',
    '// Copied from public/%NAME% by scripts/sync-shared-to-functions.js, because',
    '// functions/ deploys as its own bundle and cannot require across into',
    '// public/. Edit the original; run the script; commit both.',
    '//',
    '// test/functions-shared-sync.test.js fails if this copy is stale.',
    '',
    '',
].join('\n');

function render(name, source) {
    return BANNER.replace('%NAME%', name) + source;
}

function sourceOf(name) {
    return fs.readFileSync(path.join(FROM, name), 'utf8');
}

function expected(name) {
    return render(name, sourceOf(name));
}

function copyPath(name) {
    return path.join(TO, name);
}

function sync() {
    fs.mkdirSync(TO, { recursive: true });
    const written = [];
    MODULES.forEach(name => {
        const want = expected(name);
        const at = copyPath(name);
        const have = fs.existsSync(at) ? fs.readFileSync(at, 'utf8') : null;
        if (have !== want) {
            fs.writeFileSync(at, want);
            written.push(name);
        }
    });
    return written;
}

if (require.main === module) {
    const written = sync();
    if (!written.length) {
        console.log('functions/shared is already up to date.');
    } else {
        written.forEach(n => console.log('synced ' + n));
    }
}

module.exports = { MODULES, FROM, TO, render, sourceOf, expected, copyPath, sync };
