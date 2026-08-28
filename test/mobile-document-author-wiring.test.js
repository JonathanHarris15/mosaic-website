const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The phone could still write an Elder Document with no author (MS-304).
//
// MS-283 fixed this on the web and scoped the phone out, on the grounds that it
// "already resolves identity correctly". That is true of Shepherding Notes,
// Status Changes and Tag Changes, which all use the defensive
// `(user && user.uid) || (auth.currentUser && auth.currentUser.uid)` pattern.
// It was NOT true of `createElderDocument`, which fell through to `null` and
// signed the record with the literal string "Elder".
//
// CONTEXT.md and ADR-0015 decision 8 both say a document whose author cannot be
// resolved is refused rather than written, because an untraceable pastoral
// record is worse than a create that failed: it exists, it stands in the
// Pastoral Record, and nothing surfaces the problem. Both were untrue here.
//
// ⚠ WHY THIS READS SOURCE RATHER THAN CALLING ANYTHING. `mobile/data.js` is a
// browser IIFE over the Firebase SDK — there is no harness in this suite that
// can load it, which is exactly how the fault survived. The behaviour itself is
// already covered against the pure core in shepherding-documents-author.test.js;
// what cannot be covered there is whether the phone actually goes through it.
// So this guards the shape, the way document-library-identity-wiring.test.js
// does for the web page.

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

// One top-level function's body, from its declaration to the next one.
function bodyOf(src, name) {
    const from = src.indexOf('function ' + name + '(');
    assert.notStrictEqual(from, -1,
        name + ' is gone — this guard needs rewriting, not deleting');
    const next = src.indexOf('\n  function ', from + 1);
    return src.slice(from, next === -1 ? src.length : next);
}

const createElderDocument = () => bodyOf(read('mobile/data.js'), 'createElderDocument');

test('the phone builds its Elder Document at the testable seam', () => {
    const body = createElderDocument();

    assert.match(body, /resolveAuthor\(/,
        'who is writing must be resolved by the core, which falls back to the live\n' +
        'auth session for the uid AND recovers a name from that session\'s email');
    assert.match(body, /buildElderDocument\(/,
        'the record must be built by the core builder — that is what refuses an\n' +
        'unauthored document, and what a unit test can reach');
});

test('the phone can no longer sign a pastoral record "Elder"', () => {
    assert.doesNotMatch(createElderDocument(), /["']Elder["']/,
        'a document signed with the literal string "Elder" names nobody. The core\n' +
        'recovers a real name from the signed-in email instead, and refuses when it\n' +
        'cannot — a create that fails is better than a record nobody can be asked about');
});

test('the phone cannot assemble the author fields itself', () => {
    const body = createElderDocument();

    assert.doesNotMatch(body, /authorUid\s*:/,
        'assembling authorUid inline puts the record back where no test can see it');
    assert.doesNotMatch(body, /authorName\s*:/,
        'same for authorName — both fields are the builder\'s to write');
});

test('the core is loaded, and before the code that uses it', () => {
    const html = read('mobile.html');
    const core = html.indexOf('shepherding-documents-core.js');
    const data = html.indexOf('mobile/data.js');

    assert.notStrictEqual(core, -1, 'mobile.html must load the shepherding documents core');
    assert.ok(core < data,
        'the core must load before data.js, or window.ShepherdingDocsCore is undefined\n' +
        'at the moment the create path reaches for it');
});

// A refusal the elder cannot read is the MS-283 failure repeating itself: the
// real cause reached the console and the screen said the same six words for
// every possible fault, which is how a ten-second bug became an undiagnosable
// demo failure.
test('both phone surfaces say why a create was refused', () => {
    const surfaces = ['mobile/screens-documents.js', 'mobile/screens-shepherd.js'];

    surfaces.forEach(file => {
        const src = read(file);
        const from = src.indexOf('data.createElderDocument(');
        assert.notStrictEqual(from, -1, file + ' no longer creates a document');

        // Only the create's own catch. The second catch in each of these chains
        // is the folder-tree save, which fails for entirely different reasons
        // and by then the document genuinely does exist.
        const chain = src.slice(from, src.indexOf('\n    function ', from + 1));

        assert.match(chain, /documentCreateFailure\(/,
            file + ' must tell the elder which failure it was, rather than folding\n' +
            'every cause into one generic "Error creating document"');
    });
});

// The wording is shared so it cannot drift between the two surfaces, which is
// only worth anything if it actually distinguishes the refusal.
test('the shared message names the missing author', () => {
    const src = read('mobile/data.js');
    const from = src.indexOf('function documentCreateFailure(');
    assert.notStrictEqual(from, -1, 'the shared failure message is gone');
    const body = src.slice(from, src.indexOf('\n  function ', from + 1));

    assert.match(body, /MISSING_AUTHOR/,
        'a refusal for a missing author must read differently from anything else —\n' +
        'it is the one an elder can act on by signing in again');
    assert.match(body, /who is signed in/,
        'and it must say so in words an elder reads, not a code');
});
