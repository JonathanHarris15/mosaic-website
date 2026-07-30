const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-150 — the Event visibility boundary itself.
//
// These rules cannot be exercised from here — that needs a live project, and the
// sub-task keeps a human verification step for exactly that reason (as MS-133
// did). What CAN be pinned is the SHAPE, so the boundary cannot be widened by an
// unrelated edit without a test going red and somebody having to think about it.
//
// The failure being guarded against is not a crash. It is a rule quietly
// becoming `if true` during a refactor, and nobody noticing that the elders'
// meeting went public.
//
// Follows the pattern of firestore-relationship-sharing-rules.test.js.

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

const Core = require('../public/events-occurrence-core.js');

const blockFor = pattern => {
    const m = rules.match(pattern);
    assert.ok(m, 'no rule block matching ' + pattern);
    return m[1];
};

const eventsBlock = () => blockFor(/match \/events\/\{eventId\}\s*\{([\s\S]*?)\n    \}/);
const occurrencesBlock = () => blockFor(/match \/event_occurrences\/\{occurrenceId\}\s*\{([\s\S]*?)\n    \}\n/);
const rosterBlock = () => blockFor(/match \/roster\/\{assignmentId\}\s*\{([\s\S]*?)\n      \}/);
const fnBody = name => blockFor(new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n    \\}'));

// ── The series collection is closed ───────────────────────────────────────────

test('the events series collection is no longer world-readable', () => {
    const block = eventsBlock();
    assert.doesNotMatch(
        block,
        /allow read: if true/,
        'the moment "Elders\' Meeting" can be a series, `if true` publishes its name to the internet'
    );
    assert.match(block, /allow read: if .*rankCanSee\(/);
});

test('the Sunday Service series stays readable by everyone, with no migration in between', () => {
    // Named rather than stamped, so the Services page and the congregant-facing
    // Service Guide keep working exactly as they do today.
    assert.match(eventsBlock(), /eventId == 'sunday_service'/);
});

test('writing a series is still editor-only', () => {
    assert.match(eventsBlock(), /allow create, update, delete: if isEditor\(\)/);
});

// ── The five rungs ────────────────────────────────────────────────────────────

test('all five visibility rungs are named in the rules', () => {
    // The model's ladder and the rules' ladder must be the same ladder. If a rung
    // is added to one and not the other, the new rung is enforced by nothing.
    const laddered = rules.slice(rules.indexOf('function rankCanSee'));
    Core.VISIBILITY_ORDER.forEach(rung => {
        assert.match(laddered, new RegExp("'" + rung + "'"), 'the rung "' + rung + '" is not enforced');
    });
});

test('each rung is gated on the rank that owns it', () => {
    const body = fnBody('rankCanSee');
    assert.match(body, /visibility == 'public'/, 'public needs no rank at all');
    assert.match(body, /isMember\(\) && visibility == 'member'/);
    assert.match(body, /isEditor\(\) && visibility in \[[^\]]*'editor'/);
    assert.match(body, /isElder\(\) && visibility == 'elder'/);
});

test('a member cannot reach participant Events by rank alone', () => {
    // Rank is not the door for `participant` — the participant list is. A member
    // clause covering it would show every restricted Event to every member.
    const body = fnBody('rankCanSee');
    assert.doesNotMatch(body, /isMember\(\) && visibility in/,
        'a member must not satisfy a list of rungs — only their own');
    assert.doesNotMatch(body, /isMember\(\) && visibility == 'participant'/);
});

test('an editor and above sees participant Events without holding a Role', () => {
    assert.match(fnBody('rankCanSee'), /isEditor\(\) && visibility in \[[^\]]*'participant'/);
});

// ── Failing closed ────────────────────────────────────────────────────────────

test('an Event with no visibility stamped is readable by nobody', () => {
    const body = fnBody('stampedVisibility');
    assert.match(body, /'visibility' in resource\.data/,
        'reading an absent field must be guarded, not assumed');
    assert.match(body, /: 'none'/, 'the fallback must be a value that matches no rung');

    // And 'none' must genuinely match nothing.
    assert.strictEqual(Core.VISIBILITY_ORDER.indexOf('none'), -1);
    assert.doesNotMatch(fnBody('rankCanSee'), /'none'/);
});

test('every rung is an equality test, never a negation that could let anything through', () => {
    const body = fnBody('rankCanSee');
    assert.doesNotMatch(body, /visibility != /, 'a != test admits every value the author did not think of');
    assert.doesNotMatch(body, /if true/);
});

// ── participant, answered without a per-row lookup ────────────────────────────

test('participant is answered from the occurrence’s own participant list', () => {
    const body = fnBody('isEventParticipant');
    assert.match(body, /resource\.data\.participantIds/,
        'the list must be ON the document — a get() per row hits the lookup limits (MS-130)');
    assert.match(body, /myPersonId\(\) in resource\.data\.participantIds/);
});

test('the participant check does no document lookup of its own', () => {
    const body = fnBody('isEventParticipant');
    // myPersonId() reads the signed-in user's own record — one lookup, the same
    // for every row. What must NOT appear is a get() of the series or another
    // occurrence, which would be one lookup PER returned document.
    assert.doesNotMatch(body, /get\(\/databases\/\$\(database\)\/documents\/event/);
});

test('a missing participant list is guarded rather than assumed', () => {
    assert.match(fnBody('isEventParticipant'), /'participantIds' in resource\.data/);
});

test('the occurrence read rule uses rank OR participation, and nothing else', () => {
    const block = occurrencesBlock();
    assert.match(block, /allow read: if rankCanSee\(stampedVisibility\(\)\)/);
    assert.match(block, /stampedVisibility\(\) == 'participant' && isEventParticipant\(\)/);
    assert.doesNotMatch(block, /allow read: if true/);
});

test('only an editor writes an occurrence', () => {
    assert.match(occurrencesBlock(), /allow create, update, delete: if isEditor\(\)/);
});

// ── The roster subcollection ──────────────────────────────────────────────────

test('the roster is a subcollection, because a field cannot be hidden from a reader', () => {
    assert.match(rules, /match \/event_occurrences\/\{occurrenceId\}\/roster\/\{assignmentId\}|match \/roster\/\{assignmentId\}/);
});

test('your own assignment is always readable', () => {
    assert.match(
        rosterBlock(),
        /resource\.data\.personId == myPersonId\(\)/,
        'you are always allowed to know what you have been asked to do'
    );
});

test('everyone else’s assignment depends on the Event’s roster setting', () => {
    const block = rosterBlock();
    assert.match(block, /rosterShared == true/, 'an explicit true — an absent field must not share the roster');
    assert.doesNotMatch(block, /rosterShared != false/);
});

test('the roster is not world-readable', () => {
    const block = rosterBlock();
    assert.doesNotMatch(block, /allow read: if true/);
    assert.doesNotMatch(block, /allow read, write: if true/);
});

test('only an editor writes the roster — members confirming for themselves is MS-20', () => {
    assert.match(rosterBlock(), /allow create, update, delete: if isEditor\(\)/);
});

// ── The collection-group roster read ──────────────────────────────────────────

test('the collection-group roster rule lets you read your own row and nobody else’s', () => {
    // The Calendar needs your own assignments across a whole month without
    // reading anybody else's, so it queries each roster for your Person id.
    const block = blockFor(/match \/\{path=\*\*\}\/roster\/\{assignmentId\}\s*\{([\s\S]*?)\n    \}/);
    assert.match(block, /resource\.data\.personId == myPersonId\(\)/);
    assert.match(block, /isEditor\(\)/);
    assert.doesNotMatch(block, /allow read: if true/);
});

test('the collection-group roster grants no writes', () => {
    // Writing goes through the occurrence's own roster rule. A collection-group
    // write rule here would be a second, wider door onto the same documents.
    const block = blockFor(/match \/\{path=\*\*\}\/roster\/\{assignmentId\}\s*\{([\s\S]*?)\n    \}/);
    assert.doesNotMatch(block, /allow (create|update|delete|write)/);
});

// ── The rank helpers ──────────────────────────────────────────────────────────

test('the member floor excludes a viewer', () => {
    const body = fnBody('isMember');
    assert.match(body, /request\.auth != null/);
    assert.doesNotMatch(body, /'viewer'/, 'a viewer is signed in but sees only public things');
    ['member', 'editor', 'admin', 'elder', 'super_admin'].forEach(level => {
        assert.match(body, new RegExp("'" + level + "'"), level + ' is missing from the member floor');
    });
});

test('myPersonId guards the absent field rather than assuming it', () => {
    const body = fnBody('myPersonId');
    assert.match(body, /'personId' in d/);
    assert.match(body, /: null/, 'an unlinked User has no Person, and must match no participant list');
});
