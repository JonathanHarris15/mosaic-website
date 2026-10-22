const { test } = require('node:test');
const assert = require('node:assert');

const Dotted = require('../public/service-dotted-keys-core.js');
const { normalizeDottedKeys } = require('../public/service-builder.js');

test('plain (dot-free) keys pass through on read', () => {
    const raw = { theme: 'Grace', isIrregular: false, liturgy: { sermon: 'John 1' } };
    assert.deepStrictEqual(Dotted.readServiceDoc(raw), raw);
    assert.deepStrictEqual(normalizeDottedKeys(raw), raw);
});

test('readServiceDoc drops dotted top-level keys', () => {
    const out = Dotted.readServiceDoc({ 'liturgy.sermon': 'John 1', liturgy: { hymn1: 'A' } });
    assert.deepStrictEqual(out, { liturgy: { hymn1: 'A' } });
});

test('normalizeServiceDoc folds dotted keys for migration', () => {
    const out = Dotted.normalizeServiceDoc({ 'liturgy.sermon': 'John 1' });
    assert.deepStrictEqual(out, { liturgy: { sermon: 'John 1' } });
});

test('normalizeServiceDoc merges dotted keys into an existing nested object', () => {
    const out = Dotted.normalizeServiceDoc({
        liturgy: { hymn1: 'Hymn A' },
        'liturgy.sermon': 'John 1',
    });
    assert.deepStrictEqual(out, { liturgy: { hymn1: 'Hymn A', sermon: 'John 1' } });
});

test('normalizeServiceDoc: nested value wins over dotted for the same leaf', () => {
    const out = Dotted.normalizeServiceDoc({
        liturgy: { sermon: 'CANONICAL' },
        'liturgy.sermon': 'LEGACY',
    });
    assert.strictEqual(out.liturgy.sermon, 'CANONICAL');
});

test('planDottedKeyRewrite returns null when nothing to migrate', () => {
    assert.strictEqual(Dotted.planDottedKeyRewrite({ liturgy: { sermon: 'x' } }), null);
});

test('planDottedKeyRewrite plans a full nested document', () => {
    const plan = Dotted.planDottedKeyRewrite({ 'liturgy.sermon': 'John 1', theme: 'Grace' });
    assert.deepEqual(plan.dottedKeys, ['liturgy.sermon']);
    assert.deepStrictEqual(plan.next, { liturgy: { sermon: 'John 1' }, theme: 'Grace' });
});

test('empty or missing input yields an empty object on read', () => {
    assert.deepStrictEqual(Dotted.readServiceDoc({}), {});
    assert.deepStrictEqual(Dotted.readServiceDoc(null), {});
    assert.deepStrictEqual(Dotted.readServiceDoc(undefined), {});
});
