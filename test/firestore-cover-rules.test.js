const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-20 — the boundary the cover list must not widen (ADR-0030, ADR-0018 §5).
//
// Like the other rules tests here, these cannot EXERCISE the rules — that needs
// a live project. What they pin is the SHAPE, so the boundary cannot be widened
// by an unrelated edit without a test going red and somebody having to think.
//
// The failure guarded against is not a crash. It is a rule quietly becoming
// `if true` during a refactor, and nobody noticing that every member can now
// read every roster row in the church.
//
// Follows firestore-event-visibility-rules.test.js.

// Normalised to LF. The block patterns below close on `\n    \}`, and on a
// Windows checkout core.autocrlf hands over CRLF, so none of them matched and
// the shape they pin went unchecked.
const rules = fs.readFileSync(
    path.join(__dirname, '..', 'firestore.rules'), 'utf8').replace(/\r\n/g, '\n');

const blockFor = pattern => {
    const m = rules.match(pattern);
    assert.ok(m, 'no rule block matching ' + pattern);
    return m[1];
};

const coverBlock = () =>
    blockFor(/match \/cover\/\{coverId\}\s*\{([\s\S]*?)\n    \}/);
const occurrencesBlock = () =>
    blockFor(/match \/event_occurrences\/\{occurrenceId\}\s*\{([\s\S]*?)\n    \}\n/);
const rosterBlock = () =>
    blockFor(/match \/roster\/\{assignmentId\}\s*\{([\s\S]*?)\n      \}/);
const rosterGroupBlock = () =>
    blockFor(/match \/\{path=\*\*\}\/roster\/\{assignmentId\}\s*\{([\s\S]*?)\n    \}/);

// ── The cover list is readable by rank, and by nothing else ──────────────────

test('the cover list exists as its own collection', () => {
    assert.ok(coverBlock(), 'MS-20 needs a /cover collection');
});

test('reading a cover entry is gated on the rung it was stamped with', () => {
    const block = coverBlock();
    assert.doesNotMatch(block, /allow read: if true/,
        'a cover entry names an Event; `if true` publishes it to the internet');
    assert.match(block, /allow read: if rankCanSee\(stampedVisibility\(\)\)/);
});

test('being signed in is not on its own enough to read one', () => {
    // `isMember()` alone would let any member read an elder-level Event's open
    // place — the rung is the whole point of the stamp.
    assert.doesNotMatch(coverBlock(),
        /allow read: if request\.auth != null;/);
});

// The `participant` rung is deliberately absent. The list exists to reach
// people who are NOT in the Event; there is nobody it could reach at that rung
// without disclosing what the rung protects, so such a place never reaches the
// list at all and the rule needs no clause for it.
test('the cover rule has no participant clause, on purpose', () => {
    assert.doesNotMatch(coverBlock(), /isEventParticipant\(\)/,
        'a participant-rung Event never reaches the cover list — see canBeCovered');
});

// ── Nobody writes it from a browser ──────────────────────────────────────────

test('no client may create, edit or delete a cover entry — editors included', () => {
    const block = coverBlock();
    assert.match(block, /allow create, update, delete: if false/);
    assert.doesNotMatch(block, /allow (create|update|delete)[^\n]*isEditor\(\)/,
        'entries move only inside the callable transaction that writes the roster');
    assert.doesNotMatch(block, /allow write/);
});

// ── What this Feature must NOT have loosened ─────────────────────────────────
//
// The whole reason the cover list is a separate collection is that these three
// could not be relaxed. If a later edit relaxes one, the collection stops
// having a purpose and the gate is gone.

test('an occurrence is still editor-only to write', () => {
    assert.match(occurrencesBlock(),
        /allow create, update, delete: if isEditor\(\)/,
        'members write through a callable; opening this would let one restamp ' +
        'visibility or participantIds');
});

test('somebody else’s roster row is still gated on the Event’s roster setting', () => {
    const block = rosterBlock();
    assert.match(block, /rosterShared == true/);
    assert.match(block, /resource\.data\.personId == myPersonId\(\)/);
    assert.doesNotMatch(block, /allow read: if true/);
});

test('the cross-Event roster query is still clamped to your own rows', () => {
    const block = rosterGroupBlock();
    assert.match(block, /resource\.data\.personId == myPersonId\(\)/,
        'unclamped, this is the read the cover list was built to avoid needing');
    assert.doesNotMatch(block, /allow read: if request\.auth != null;/);
});

test('the roster subcollection is still editor-only to write', () => {
    assert.match(rosterBlock(), /allow create, update, delete: if isEditor\(\)/);
});

// ── The stamp the rule depends on ────────────────────────────────────────────

test('an entry with no visibility field is readable by nobody', () => {
    // stampedVisibility() answers 'none' for a document without the field, and
    // rankCanSee('none') is false on every branch. That is what makes a write
    // which forgot the stamp fail closed rather than fail open.
    const fn = blockFor(
        /function stampedVisibility\(\)\s*\{([\s\S]*?)\n    \}/);
    assert.match(fn, /'none'/);

    const rank = blockFor(/function rankCanSee\(visibility\)\s*\{([\s\S]*?)\n    \}/);
    assert.doesNotMatch(rank, /visibility == 'none'/);
    assert.doesNotMatch(rank, /return true;/);
});
