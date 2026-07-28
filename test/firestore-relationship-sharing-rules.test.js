const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-133: the disclosure boundary itself.
//
// These rules cannot be exercised from here — that needs a live project, and the
// ticket keeps a human verification step for exactly that reason. What CAN be
// pinned is the shape, so the boundary can't be widened by an unrelated edit
// without a test going red and someone having to think about it.
//
// The failure this guards against is not a crash. It is a rule quietly becoming
// `if true` during a refactor, and nobody noticing that the shepherding graph
// went public.

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

const RELATIONSHIP_COLLECTIONS = ['relationships', 'relationship_types', 'relationship_groups'];

const blockFor = collection => {
    const m = rules.match(
        new RegExp('match /' + collection + '/\\{[^}]+\\}\\s*\\{([\\s\\S]*?)\\n    \\}')
    );
    assert.ok(m, 'no rule block for /' + collection);
    return m[1];
};

// ── Reads ─────────────────────────────────────────────────────────────────────

test('every relationship collection gates reads on the shared-record predicate', () => {
    RELATIONSHIP_COLLECTIONS.forEach(collection => {
        assert.match(
            blockFor(collection),
            /allow read: if canReadRelationshipRecord\(\)/,
            collection
        );
    });
});

test('the predicate lets elders through and editors only for shared records', () => {
    const fn = rules.match(/function canReadRelationshipRecord\(\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(fn, 'canReadRelationshipRecord() is missing');
    const body = fn[1];

    assert.match(body, /isElder\(\)/, 'elders keep full access');
    assert.match(body, /isEditor\(\)/, 'editors are the floor');
    assert.match(body, /sharedWithEditors == true/, 'editors need an explicit true');
});

test('the predicate requires an explicit true, so an absent field fails closed', () => {
    const fn = rules.match(/function canReadRelationshipRecord\(\)\s*\{([\s\S]*?)\n    \}/)[1];
    // `!= false` or a bare truthiness check would let an unstamped record
    // through. Only an equality test against true is safe here.
    assert.match(fn, /sharedWithEditors == true/);
    assert.doesNotMatch(fn, /sharedWithEditors != false/);
});

test('no relationship collection is world-readable', () => {
    RELATIONSHIP_COLLECTIONS.forEach(collection => {
        const block = blockFor(collection);
        assert.doesNotMatch(block, /allow read: if true/, collection);
        assert.doesNotMatch(block, /allow read, write: if true/, collection);
    });
});

test('the floor is editor — no member or viewer tier appears in the predicate', () => {
    const fn = rules.match(/function canReadRelationshipRecord\(\)\s*\{([\s\S]*?)\n    \}/)[1];
    assert.doesNotMatch(fn, /member/i);
    assert.doesNotMatch(fn, /viewer/i);
});

// ── Writes stay exactly where they were ──────────────────────────────────────

test('writing a relationship record is still elder-only', () => {
    RELATIONSHIP_COLLECTIONS.forEach(collection => {
        assert.match(blockFor(collection), /allow write: if isElder\(\)/, collection);
    });
});

test('no relationship collection grants write to editors', () => {
    RELATIONSHIP_COLLECTIONS.forEach(collection => {
        assert.doesNotMatch(blockFor(collection), /write.*isEditor/, collection);
    });
});

// ── The rest of the shepherding layer is untouched ───────────────────────────

test('the other elder-only collections did not get swept along', () => {
    // Only the three relationship collections open. Sharing a Relationship Type
    // must not have widened notes, tags, views, or reminders.
    ['shepherding_tags', 'shepherding_views', 'shepherding_reminders'].forEach(collection => {
        const m = rules.match(new RegExp('match /' + collection + '/\\{[^}]+\\}\\s*\\{([\\s\\S]*?)\\n    \\}'));
        if (!m) return; // not every one exists
        assert.match(m[1], /allow read, write: if isElder\(\)/, collection);
    });
});

// ── The client's half of the contract ────────────────────────────────────────

test('the query constraint a non-elder must apply is documented beside the rule', () => {
    // Firestore fails a list query outright rather than returning fewer rows, so
    // the client has to filter to shared records itself. Someone WILL hit this;
    // the explanation needs to be where they are already looking.
    const preamble = rules.slice(0, rules.indexOf('function canReadRelationshipRecord'));
    assert.match(preamble, /sharedWithEditors', '==', true|sharedWithEditors' *, *'==' *, *true/);
    assert.match(preamble, /per returned document/i);
});
