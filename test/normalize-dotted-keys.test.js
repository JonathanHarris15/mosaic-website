const { test } = require('node:test');
const assert = require('node:assert');

const { normalizeDottedKeys } = require('../public/service-builder.js');

// Older Service saves used set() with merge and dotted paths, which Firestore
// stored as LITERAL top-level keys containing a dot (e.g. 'liturgy.sermon')
// rather than as nested fields. On load, normalizeDottedKeys folds those back
// into nested objects so the rest of the Builder sees one consistent shape.
// This logic was an untested blob inside load(); these tests pin its contract.

test('plain (dot-free) keys pass through unchanged', () => {
    const raw = { theme: 'Grace', isIrregular: false, liturgy: { sermon: 'John 1' } };
    assert.deepStrictEqual(normalizeDottedKeys(raw), raw);
});

test('a single dotted key is folded into a nested object', () => {
    const out = normalizeDottedKeys({ 'liturgy.sermon': 'John 1' });
    assert.deepStrictEqual(out, { liturgy: { sermon: 'John 1' } });
});

test('dotted keys merge into an existing nested object', () => {
    const out = normalizeDottedKeys({
        liturgy: { hymn1: 'Hymn A' },
        'liturgy.sermon': 'John 1',
    });
    assert.deepStrictEqual(out, { liturgy: { hymn1: 'Hymn A', sermon: 'John 1' } });
});

test('an already-nested value wins over a dotted-key value for the same leaf', () => {
    const out = normalizeDottedKeys({
        liturgy: { sermon: 'CANONICAL' },
        'liturgy.sermon': 'LEGACY',
    });
    assert.strictEqual(out.liturgy.sermon, 'CANONICAL');
});

test('deeply dotted keys build the full path', () => {
    const out = normalizeDottedKeys({ 'a.b.c': 1 });
    assert.deepStrictEqual(out, { a: { b: { c: 1 } } });
});

test('multiple dotted keys under the same parent coexist', () => {
    const out = normalizeDottedKeys({ 'liturgy.hymn1': 'A', 'liturgy.hymn2': 'B' });
    assert.deepStrictEqual(out, { liturgy: { hymn1: 'A', hymn2: 'B' } });
});

test('a dotted key overwrites a non-object scalar sitting at the parent path', () => {
    // If 'liturgy' arrived as a scalar AND a dotted child exists, the child path
    // must still be buildable — the scalar is replaced by an object.
    const out = normalizeDottedKeys({ liturgy: 'oops', 'liturgy.sermon': 'John 1' });
    assert.deepStrictEqual(out, { liturgy: { sermon: 'John 1' } });
});

test('empty or missing input yields an empty object', () => {
    assert.deepStrictEqual(normalizeDottedKeys({}), {});
    assert.deepStrictEqual(normalizeDottedKeys(null), {});
    assert.deepStrictEqual(normalizeDottedKeys(undefined), {});
});
