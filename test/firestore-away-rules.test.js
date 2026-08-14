const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-188 — the Away boundary.
//
// Like the other rules tests here, this pins the SHAPE rather than exercising
// it: live enforcement needs a real project and stays a human verification step.
//
// The failure being guarded against is specific and quiet. If an Away ever
// ends up as readable as the rest of the directory, the app starts publishing
// which houses are empty on which dates. That is not a crash, it is a rule
// that looks fine in a diff.
//
// ⚠ THE TRIPWIRE BELOW HAS FIRED, AND WAS ANSWERED RATHER THAN DELETED.
// When this file was written, `people/{personId}` was `allow read: if true` —
// every name, email, phone number and home address, open to the internet — and
// the test asserted it, deliberately, so that whoever closed the directory
// would be sent back here to re-read the Away decision rather than discover
// it. MS-197 closed it (ADR-0031). The decision survives one rung lower: the
// directory is now readable by any signed-in account, and Away is still not,
// because a member has no business knowing who is on holiday.
//
// Follows the pattern of firestore-event-visibility-rules.test.js.

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

const blockFor = pattern => {
    const m = rules.match(pattern);
    assert.ok(m, 'no rule block matching ' + pattern);
    return m[1];
};

const awayBlock = () => blockFor(/match \/away\/\{stretchId\}\s*\{([\s\S]*?)\n      \}/);
const awayGroupBlock = () => blockFor(/match \/\{path=\*\*\}\/away\/\{stretchId\}\s*\{([\s\S]*?)\n    \}/);
const peopleBlock = () => blockFor(/match \/people\/\{personId\}\s*\{([\s\S]*?)\n      match/);

// ── The thing this rule exists to prevent ────────────────────────────────────

test('the Person document is no longer world-readable (MS-197 answered the tripwire)', () => {
    // This assertion used to run the other way round. See the note at the top:
    // it was the marker MS-188 left for whoever closed the directory, and
    // MS-197 is that person. Kept, inverted, so the two decisions stay tied
    // together — Away's rule is defined by being NARROWER than this one, and a
    // test that stops mentioning it stops explaining itself.
    assert.doesNotMatch(
        peopleBlock(),
        /allow read: if true/,
        'the directory has gone back to being world-readable — see ADR-0031'
    );
    assert.match(peopleBlock(), /allow read: if isSignedIn\(\)/);
});

test('Away is narrower than the Person record it hangs off', () => {
    // The whole reason Away is a subcollection rather than a field. The
    // directory asks for an account; Away asks for the person themselves or an
    // editor. If these two ever say the same thing, Away has been widened by
    // somebody tidying up.
    const away = awayBlock();
    const person = peopleBlock();
    assert.match(person, /allow read: if isSignedIn\(\)/);
    assert.doesNotMatch(
        away,
        /allow read[^\n]*if request\.auth != null;/,
        'Away has been flattened to the directory boundary — re-read ADR-0023'
    );
});

test('an Away is never world-readable', () => {
    assert.doesNotMatch(
        awayBlock(),
        /allow read[^\n]*if true/,
        'Away has gone public — a name, an address and a date range is a house-empty notice'
    );
});

test('an Away is not readable by any signed-in person', () => {
    // A member has no business knowing who is on holiday, and every reader is
    // blast radius. `request.auth != null` alone would be the whole church.
    const block = awayBlock();
    assert.doesNotMatch(
        block,
        /allow read[^\n]*if request\.auth != null;/,
        'Away is readable by anyone signed in'
    );
});

// ── Who it IS for ────────────────────────────────────────────────────────────

test('the person themselves can read and write their own Away', () => {
    const block = awayBlock();
    assert.match(block, /personId == myPersonId\(\)/,
        'the person can no longer reach their own days');
    assert.match(block, /request\.auth != null/,
        'the self clause must be guarded on being signed in at all');
});

test('editors and above can read and write an Away', () => {
    // They will keep being told in the car park, and the picker has to be able
    // to say "Sarah said she's away" while it is deciding who to offer.
    assert.match(awayBlock(), /isEditor\(\)/);
});

test('the self clause is scoped to the Person in the path, not to any Person', () => {
    // `myPersonId() != null` or a bare comparison the other way round would let
    // one member write everybody's days.
    assert.match(
        awayBlock(),
        /personId == myPersonId\(\)/,
        'the rule must tie the document to the caller by the path segment'
    );
});

// ── Across everybody ─────────────────────────────────────────────────────────

test('the collection-group read is editors only', () => {
    // This is what the picker, the fairness solve and auto-assign ask. Opened to
    // members it would hand the whole church's holidays to anyone signed in —
    // exactly what the per-person rule is there to stop.
    const block = awayGroupBlock();
    assert.match(block, /allow read: if isEditor\(\);/);
    assert.doesNotMatch(block, /if true/);
    assert.doesNotMatch(block, /request\.auth != null/);
});

test('the collection group grants no writes', () => {
    // A write here would be a write to anybody's Away from any path.
    const block = awayGroupBlock();
    assert.doesNotMatch(block, /allow (create|update|delete|write)/);
});

// ── The trap that has already been documented twice ──────────────────────────

test('the query-constraint warning is on the collection-group rule', () => {
    // Firestore fails the WHOLE read if any returned document would fail, so an
    // under-privileged caller does not get fewer rows — they get an error that
    // reads like "nobody is ever away". The same trap is already documented for
    // the relationship collections and for the Calendar, and it has bitten this
    // codebase before.
    const before = rules.slice(0, rules.indexOf('match /{path=**}/away/{stretchId}'));
    const preamble = before.slice(-800);
    assert.match(preamble, /Constrain this query/i,
        'the collection-group rule needs the constraint warning above it');
});
