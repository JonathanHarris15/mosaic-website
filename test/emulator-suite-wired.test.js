const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The emulator suite is wired up and can still be run (MS-217).
//
// ⚠ WHY THIS GUARD EXISTS. test/emulator/ needs a running Firestore emulator,
// and without one it SKIPS rather than fails — which is the right behaviour on
// a machine with no Java, and a quiet way for a whole suite to rot. A skipped
// test is one line in a run of two thousand, and nobody reads it.
//
// So the plain suite checks the things that would make the emulator suite
// unrunnable without anything going red: the script that starts it, the file it
// runs, and that the file still exercises both callables' writes.

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('npm run test:emulator exists and points at the emulator suite', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.ok(pkg.scripts['test:emulator'],
        'the only way to run these tests has gone');
    assert.match(pkg.scripts['test:emulator'], /test-emulator/);
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts/test-emulator.mjs')));
});

test('the emulator suite still covers both callables’ writes', () => {
    const suite = read('test/emulator/assignment-writes.test.js');
    assert.match(suite, /writes\.answer\(/, 'answering is no longer exercised');
    assert.match(suite, /writes\.take\(/, 'taking is no longer exercised');
});

// The four claims MS-217 was filed for. Each is a sentence in the code's own
// comments that was, until that suite, only a claim.
test('it still proves the three things that fail silently', () => {
    const suite = read('test/emulator/assignment-writes.test.js');
    [
        [/leaves none of the three written/, 'the writes are one transaction'],
        [/deletes the previous holder/, 'a place changes hands as delete + create'],
        [/at once/, 'a real race has exactly one winner'],
        [/not as a fault/, 'the loser is told plainly rather than shown a crash'],
    ].forEach(([pattern, claim]) => {
        assert.match(suite, pattern, 'nothing now proves that ' + claim);
    });
});

// The writes take a `db` rather than reaching for `admin.firestore()`. That is
// the only reason they can be pointed at an emulator at all — undone, the suite
// above cannot run and this whole ticket quietly reverses.
test('the writes still take a Firestore handle rather than reaching for one',
    () => {
        const writes = read('functions/assignment-writes.js');
        assert.ok(!/require\(["']firebase-admin["']\)/.test(writes),
            'importing the admin SDK here is how the handle stops being an ' +
            'argument, and the writes become untestable again');
        assert.match(writes, /function answer\(db, spec\)/);
        assert.match(writes, /function take\(db, spec\)/);
    });
