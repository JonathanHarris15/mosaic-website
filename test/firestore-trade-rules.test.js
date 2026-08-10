const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The boundary around a Trade (MS-190, MS-210).
//
// Like the other rules tests here, these cannot EXERCISE the rules — that needs
// a live project. What they pin is the SHAPE, so the boundary cannot be widened
// by an unrelated edit without a test going red and somebody having to think.
//
// The failure guarded against is not a crash. It is a rule quietly becoming
// `isMember()` during a refactor, and every member in the church being able to
// read every negotiation anybody is having about their Saturdays.
//
// Follows firestore-cover-rules.test.js.

const rules = fs.readFileSync(
    path.join(__dirname, '..', 'firestore.rules'), 'utf8');

const tradeBlock = () => {
    const m = rules.match(/match \/trades\/\{tradeId\}\s*\{([\s\S]*?)\n    \}/);
    assert.ok(m, 'MS-190 needs a /trades collection');
    return m[1];
};

test('the Trade collection exists', () => {
    assert.ok(tradeBlock());
});

// ── Read: the two parties, and nobody else ──────────────────────────────────

test('a Trade is readable only by the two people in it', () => {
    const block = tradeBlock();

    assert.match(block, /resource\.data\.holderId == myPersonId\(\)/);
    assert.match(block, /resource\.data\.counterpartyId == myPersonId\(\)/);
    assert.doesNotMatch(block, /allow read: if true/,
        'a Trade names two people and what each is giving up');
});

test('being signed in is not on its own enough to read one', () => {
    // The whole rule, on one line, would be `isMember()`. That reads as tight
    // and is not: it publishes every negotiation in the church to everybody in
    // it.
    const block = tradeBlock();
    const read = (block.match(/allow read:[\s\S]*?;/) || [''])[0];

    assert.ok(read.includes('myPersonId()'),
        'the read must be narrowed to the reader’s own Person');
    assert.doesNotMatch(read, /^allow read: if isMember\(\);/);
});

// ⚠ THIS IS THE ONE THAT WILL BE ARGUED WITH. An editor can see the whole
// roster, so it looks inconsistent that they cannot see a Trade on it. It is
// not: the cover list next door is stamped with a rung and readable by anybody
// at it, because a cover entry is an ADVERTISEMENT. A Trade is a CONVERSATION
// between two people, and there is no rank at which reading somebody else's
// becomes anybody's business. The editor already has direct assignment, which
// ends every Trade on the slot anyway — they do not need to read one to act.
test('not even an editor or an elder may read somebody else’s Trade', () => {
    const block = tradeBlock();

    assert.doesNotMatch(block, /allow read[^;]*isEditor\(\)/,
        'an editor has direct assignment; they do not need to read the ' +
        'negotiation to end it');
    assert.doesNotMatch(block, /allow read[^;]*isElder\(\)/);
    assert.doesNotMatch(block, /allow read[^;]*rankCanSee/,
        'a Trade is not stamped with a rung — it is not an advertisement');
});

// ── Write: nobody, through this door ────────────────────────────────────────

test('no client may write a Trade at all — editors included', () => {
    const block = tradeBlock();

    assert.match(block, /allow create, update, delete: if false/);
    assert.doesNotMatch(block, /allow write/);
    assert.doesNotMatch(block, /allow (create|update|delete)[^\n]*isEditor\(\)/);
});

test('a party to a Trade still cannot write their own', () => {
    // The tempting hole: "surely Sarah can set her own refusal." She cannot —
    // that is a state transition, the state machine decides which are legal,
    // and a write from a browser console walks straight round it. Every
    // transition goes through a callable.
    const block = tradeBlock();

    assert.doesNotMatch(block,
        /allow (create|update)[^\n]*counterpartyId == myPersonId\(\)/,
        'a member writing their own transition bypasses trade-core entirely');
    assert.doesNotMatch(block,
        /allow (create|update)[^\n]*holderId == myPersonId\(\)/);
});

// ── What this Feature must not have loosened ────────────────────────────────

test('the cover list’s own rule is untouched by all this', () => {
    const m = rules.match(/match \/cover\/\{coverId\}\s*\{([\s\S]*?)\n    \}/);
    assert.ok(m);
    assert.match(m[1], /allow read: if rankCanSee\(stampedVisibility\(\)\)/);
    assert.match(m[1], /allow create, update, delete: if false/);
});

test('the roster is still nobody else’s to read', () => {
    // A Trade settling moves roster rows, and the temptation is to let the
    // parties read each other's. They must not: the callable reads the roster
    // server-side, where it has no such limit.
    const m = rules.match(
        /match \/\{path=\*\*\}\/roster\/\{assignmentId\}\s*\{([\s\S]*?)\n    \}/);
    assert.ok(m);
    assert.match(m[1], /resource\.data\.personId == myPersonId\(\)/);
});
