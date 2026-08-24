// MS-262 — the allowlist and path-shaping oos_update_liturgy relies on to
// merge a partial liturgy update without ever touching a field it shouldn't.

const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/liturgy-save-core.js');

// ── Allowlist ────────────────────────────────────────────────────────────

test('theme and keyVerse are allowed and stay top-level', () => {
    const { rejectedFields, invalidFields } = Core.validateLiturgyUpdate({
        theme: 'The God Who Rescues', keyVerse: 'Exodus 14:14',
    });
    assert.deepStrictEqual(rejectedFields, []);
    assert.deepStrictEqual(invalidFields, []);
    assert.deepStrictEqual(Core.toUpdatePaths({
        theme: 'The God Who Rescues', keyVerse: 'Exodus 14:14',
    }), {
        theme: 'The God Who Rescues', keyVerse: 'Exodus 14:14',
    });
});

test('all 7 hymn slots and 6 text slots are allowed', () => {
    assert.strictEqual(Core.HYMN_FIELDS.length, 7);
    assert.strictEqual(Core.TEXT_FIELDS.length, 6);
    Core.HYMN_FIELDS.concat(Core.TEXT_FIELDS).forEach(field => {
        assert.ok(Core.ALLOWED_FIELDS.includes(field), field);
    });
});

test('a person-assignment field is rejected, not silently dropped', () => {
    const { rejectedFields } = Core.validateLiturgyUpdate({
        preacher: { id: 'p-1', name: 'Someone' },
    });
    assert.deepStrictEqual(rejectedFields, ['preacher']);
});

test('a document field this tool does not own is rejected', () => {
    const { rejectedFields } = Core.validateLiturgyUpdate({ updatedAt: 'x' });
    assert.deepStrictEqual(rejectedFields, ['updatedAt']);
});

// ── Value shape ──────────────────────────────────────────────────────────

test('a hymn slot accepts {id, name}, including a freehand name with id: null', () => {
    const { invalidFields } = Core.validateLiturgyUpdate({
        hymn1: { id: 'h-1', name: 'Holy Holy Holy' },
        hymn2: { id: null, name: 'Typed In By Hand' },
    });
    assert.deepStrictEqual(invalidFields, []);
});

test('a hymn slot rejects a bare string', () => {
    const { invalidFields } = Core.validateLiturgyUpdate({ hymn1: 'Holy Holy Holy' });
    assert.deepStrictEqual(invalidFields, ['hymn1']);
});

test('a hymn slot accepts null as a clear', () => {
    const { invalidFields } = Core.validateLiturgyUpdate({ hymn1: null });
    assert.deepStrictEqual(invalidFields, []);
});

test('a text slot accepts a string or null, rejects an object', () => {
    const ok = Core.validateLiturgyUpdate({ sermon: 'John 3:16', benediction: null });
    assert.deepStrictEqual(ok.invalidFields, []);

    const bad = Core.validateLiturgyUpdate({ sermon: { id: 'x' } });
    assert.deepStrictEqual(bad.invalidFields, ['sermon']);
});

// ── Path shaping ─────────────────────────────────────────────────────────

test('hymn and text fields nest under liturgy., matching writeLiturgyField()', () => {
    assert.deepStrictEqual(
        Core.toUpdatePaths({
            hymn1: { id: 'h-1', name: 'Holy Holy Holy' },
            sermon: 'John 3:16',
        }),
        {
            'liturgy.hymn1': { id: 'h-1', name: 'Holy Holy Holy' },
            'liturgy.sermon': 'John 3:16',
        }
    );
});

test('a rejected field never reaches toUpdatePaths, even if passed anyway', () => {
    assert.deepStrictEqual(
        Core.toUpdatePaths({ preacher: { id: 'p-1', name: 'Someone' }, theme: 'X' }),
        { theme: 'X' }
    );
});

test('an empty update produces no paths', () => {
    assert.deepStrictEqual(Core.toUpdatePaths({}), {});
    assert.deepStrictEqual(Core.validateLiturgyUpdate({}), {
        rejectedFields: [], invalidFields: [],
    });
});

// ── Nested-document fallback (no doc yet, first save of a Sunday) ─────────

test('toNestedDoc nests liturgy fields and keeps theme/keyVerse top-level', () => {
    assert.deepStrictEqual(
        Core.toNestedDoc({
            theme: 'The God Who Rescues',
            hymn1: { id: 'h-1', name: 'Holy Holy Holy' },
            sermon: 'John 3:16',
        }),
        {
            theme: 'The God Who Rescues',
            liturgy: {
                hymn1: { id: 'h-1', name: 'Holy Holy Holy' },
                sermon: 'John 3:16',
            },
        }
    );
});

test('toNestedDoc drops a rejected field, same as toUpdatePaths', () => {
    assert.deepStrictEqual(
        Core.toNestedDoc({ preacher: { id: 'p-1', name: 'Someone' }, theme: 'X' }),
        { theme: 'X' }
    );
});

test('toNestedDoc on an all-liturgy update produces no top-level keys but liturgy', () => {
    assert.deepStrictEqual(
        Core.toNestedDoc({ hymn1: null }),
        { liturgy: { hymn1: null } }
    );
});
