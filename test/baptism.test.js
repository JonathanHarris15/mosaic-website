const { test } = require('node:test');
const assert = require('node:assert');

const { parseBaptismNames, personRefSetChanges, coerceBaptismCandidates } = require('../public/service-builder.js');

// The migration turns a free-text baptism value into Baptism Candidates.
// parseBaptismNames splits a value into confident full-name candidates and
// signals needsReview when a segment can't be confidently resolved to a
// First-Last name (single token, contains digits, etc.) — the migration's
// dry-run surfaces those for a human to resolve rather than guessing.

test('a single full name yields one candidate, no review', () => {
    const r = parseBaptismNames('John Smith');
    assert.deepStrictEqual(r.candidates, ['John Smith']);
    assert.strictEqual(r.needsReview, false);
});

test('multiple full names split on "and", comma, semicolon, and ampersand', () => {
    assert.deepStrictEqual(parseBaptismNames('John Smith and Jane Doe').candidates, ['John Smith', 'Jane Doe']);
    assert.deepStrictEqual(parseBaptismNames('John Smith, Jane Doe & Bob Lee').candidates, ['John Smith', 'Jane Doe', 'Bob Lee']);
    assert.deepStrictEqual(parseBaptismNames('Christian Buchanan; Karley Buchanan').candidates, ['Christian Buchanan', 'Karley Buchanan']);
});

test('extra whitespace is collapsed and trimmed', () => {
    const r = parseBaptismNames('  Mary   Jane   Watson  ');
    assert.deepStrictEqual(r.candidates, ['Mary Jane Watson']);
    assert.strictEqual(r.needsReview, false);
});

test('a shared-surname value flags for review and does not guess the bare first name', () => {
    const r = parseBaptismNames('John and Jane Smith');
    assert.strictEqual(r.needsReview, true);
    assert.deepStrictEqual(r.candidates, ['Jane Smith']); // confident part kept
    assert.ok(!r.candidates.includes('John'));            // bare first name NOT invented
});

test('a single-token name flags for review with no candidate', () => {
    const r = parseBaptismNames('Madonna');
    assert.strictEqual(r.needsReview, true);
    assert.deepStrictEqual(r.candidates, []);
});

test('a value containing digits flags for review', () => {
    const r = parseBaptismNames('3 infants');
    assert.strictEqual(r.needsReview, true);
});

test('empty and placeholder values yield nothing to do', () => {
    for (const v of ['', '   ', '—', 'TBD', 'N/A', 'none']) {
        const r = parseBaptismNames(v);
        assert.deepStrictEqual(r.candidates, [], `value: ${JSON.stringify(v)}`);
        assert.strictEqual(r.needsReview, false, `value: ${JSON.stringify(v)}`);
    }
});

test('a non-string (already-migrated array) parses to nothing to do', () => {
    const r = parseBaptismNames([{ name: 'John Smith', id: 'p1' }]);
    assert.deepStrictEqual(r.candidates, []);
    assert.strictEqual(r.needsReview, false);
});

// The save-time baptism date sync diffs the previously-saved Baptism Candidates
// against the current ones (same person-set semantics as Music Helpers): added
// people get their baptismDate set to the service date; removed people get it
// cleared. personRefSetChanges is the shared, pure set-diff over Person refs.

const ref = (id) => ({ id, name: id });

test('adding a baptism candidate reports them as added', () => {
    const { added, removed } = personRefSetChanges([], [ref('p1')]);
    assert.deepStrictEqual(added, ['p1']);
    assert.deepStrictEqual(removed, []);
});

test('removing a baptism candidate reports them as removed', () => {
    const { added, removed } = personRefSetChanges([ref('p1')], []);
    assert.deepStrictEqual(added, []);
    assert.deepStrictEqual(removed, ['p1']);
});

test('candidates without an id (not yet a Person) carry no date change', () => {
    const { added, removed } = personRefSetChanges([], [{ name: 'Unsaved', id: null }]);
    assert.deepStrictEqual(added, []);
    assert.deepStrictEqual(removed, []);
});

// ADR-0006: liturgy.baptism is polymorphic during the migration. coerceBaptismCandidates
// is the single reader that turns whatever shape is on disk into a clean
// array of { name, id } candidates for the Builder's load path.

test('an array of candidates is normalised, defaulting missing name/id', () => {
    const out = coerceBaptismCandidates([{ name: 'John Smith', id: 'p1' }, { name: 'Jane' }, { id: 'p3' }]);
    assert.deepStrictEqual(out, [
        { name: 'John Smith', id: 'p1' },
        { name: 'Jane', id: null },
        { name: '', id: 'p3' },
    ]);
});

test('a legacy free-text string becomes one literal candidate (id null)', () => {
    assert.deepStrictEqual(coerceBaptismCandidates('  John Smith  '), [{ name: 'John Smith', id: null }]);
});

test('empty, blank, or absent values become an empty array', () => {
    for (const v of ['', '   ', null, undefined, 0, false]) {
        assert.deepStrictEqual(coerceBaptismCandidates(v), [], `value: ${JSON.stringify(v)}`);
    }
});
