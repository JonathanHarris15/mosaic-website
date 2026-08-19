const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/usage-stats-core.js');

// diffLiturgyUsage decides what a Cloud Function trigger and a one-off
// backfill script both count as "this hymn/reference just became used" or
// "just stopped being used" — the same question, answered once, so a saved
// service can never disagree with itself about its own history.

test('a hymn picked into an empty slot is a +1', () => {
    const before = { liturgy: { hymn1: { id: null, name: '' } } };
    const after = { liturgy: { hymn1: { id: 'h1', name: 'Amazing Grace' } } };
    const { hymnDeltas, scriptureDeltas } = Core.diffLiturgyUsage(before, after, '2026-08-16');
    assert.deepStrictEqual(hymnDeltas, [{ hymnId: 'h1', countDelta: 1, date: '2026-08-16' }]);
    assert.deepStrictEqual(scriptureDeltas, []);
});

test('swapping one hymn for another is a -1 and a +1', () => {
    const before = { liturgy: { hymn1: { id: 'h1', name: 'Old' } } };
    const after = { liturgy: { hymn1: { id: 'h2', name: 'New' } } };
    const { hymnDeltas } = Core.diffLiturgyUsage(before, after, '2026-08-16');
    assert.deepStrictEqual(hymnDeltas, [
        { hymnId: 'h1', countDelta: -1, date: '2026-08-16' },
        { hymnId: 'h2', countDelta: 1, date: '2026-08-16' },
    ]);
});

test('re-saving the same hymn is not a delta', () => {
    const before = { liturgy: { hymn1: { id: 'h1', name: 'Amazing Grace' } } };
    const after = { liturgy: { hymn1: { id: 'h1', name: 'Amazing Grace' } } };
    assert.deepStrictEqual(Core.diffLiturgyUsage(before, after, '2026-08-16').hymnDeltas, []);
});

test('a freehand hymn name with no registry id produces no delta', () => {
    const before = { liturgy: { hymn1: { id: null, name: '' } } };
    const after = { liturgy: { hymn1: { id: null, name: 'Some Hymn Nobody Registered' } } };
    assert.deepStrictEqual(Core.diffLiturgyUsage(before, after, '2026-08-16').hymnDeltas, []);
});

test('clearing a hymn slot is a -1 with no matching +1', () => {
    const before = { liturgy: { hymn1: { id: 'h1', name: 'Amazing Grace' } } };
    const after = { liturgy: { hymn1: { id: null, name: '' } } };
    assert.deepStrictEqual(Core.diffLiturgyUsage(before, after, '2026-08-16').hymnDeltas,
        [{ hymnId: 'h1', countDelta: -1, date: '2026-08-16' }]);
});

test('a scripture reference typed into an empty slot is a +1', () => {
    const before = { liturgy: { scriptureReading: '' } };
    const after = { liturgy: { scriptureReading: 'Romans 8:28-39' } };
    const { scriptureDeltas } = Core.diffLiturgyUsage(before, after, '2026-08-16');
    assert.deepStrictEqual(scriptureDeltas,
        [{ reference: 'Romans 8:28-39', countDelta: 1, date: '2026-08-16' }]);
});

test('surrounding whitespace on a scripture reference does not create a phantom delta', () => {
    const before = { liturgy: { scriptureReading: 'Romans 8:28-39' } };
    const after = { liturgy: { scriptureReading: '  Romans 8:28-39  ' } };
    assert.deepStrictEqual(Core.diffLiturgyUsage(before, after, '2026-08-16').scriptureDeltas, []);
});

test('a brand-new service (no before doc) counts every filled slot as a +1, nothing as a -1', () => {
    const after = {
        liturgy: {
            hymn1: { id: 'h1', name: 'Amazing Grace' },
            sermon: 'John 3:16',
        },
    };
    const { hymnDeltas, scriptureDeltas } = Core.diffLiturgyUsage(null, after, '2026-08-16');
    assert.deepStrictEqual(hymnDeltas, [{ hymnId: 'h1', countDelta: 1, date: '2026-08-16' }]);
    assert.deepStrictEqual(scriptureDeltas, [{ reference: 'John 3:16', countDelta: 1, date: '2026-08-16' }]);
});

test('a deleted service (no after doc) counts every filled slot as a -1', () => {
    const before = { liturgy: { hymn2: { id: 'h9', name: 'Be Thou My Vision' } } };
    const { hymnDeltas } = Core.diffLiturgyUsage(before, null, '2026-08-16');
    assert.deepStrictEqual(hymnDeltas, [{ hymnId: 'h9', countDelta: -1, date: '2026-08-16' }]);
});

test('roleStatKey folds prayer_type into the key, and leaves everything else alone', () => {
    assert.strictEqual(Core.roleStatKey('preacher'), 'preacher');
    assert.strictEqual(Core.roleStatKey('prayer', 'praise'), 'prayer_praise');
    assert.strictEqual(Core.roleStatKey('prayer', 'confession'), 'prayer_confession');
    assert.strictEqual(Core.roleStatKey(null), null);
    assert.strictEqual(Core.roleStatKey(''), null);
});
