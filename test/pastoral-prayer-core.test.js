const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/pastoral-prayer-core.js');

// Being prayed for is recorded twice: a history record per Sunday, and the
// newest of those dates cached on the Person as `lastPastoralPrayerDate`. Every
// bug this module exists to close came from a surface deciding one of these
// questions for itself.

test('the doc ID for a history record is the service date', () => {
    assert.strictEqual(Core.historyDocId('2026-08-16'), '2026-08-16');
    assert.deepStrictEqual(Core.historyRecord('2026-08-16'), { serviceDate: '2026-08-16' });
});

test('a non-date never becomes a doc ID', () => {
    // Better to fail the write than to strand a record under a junk ID that no
    // later save can address.
    assert.strictEqual(Core.historyDocId(''), null);
    assert.strictEqual(Core.historyDocId('16 Aug'), null);
    assert.strictEqual(Core.historyDocId(undefined), null);
});

test('never prayed for is null, whichever sentinel is stored', () => {
    assert.strictEqual(Core.normalizeDate(null), null);
    assert.strictEqual(Core.normalizeDate(undefined), null);
    assert.strictEqual(Core.normalizeDate(''), null);
    // The legacy sentinel two of the old write paths used.
    assert.strictEqual(Core.normalizeDate('0000-00-00'), null);
    assert.strictEqual(Core.normalizeDate('2026-08-16'), '2026-08-16');

    assert.strictEqual(Core.wasPrayedFor('0000-00-00'), false);
    assert.strictEqual(Core.wasPrayedFor(null), false);
    assert.strictEqual(Core.wasPrayedFor('2026-08-16'), true);
});

test('the cached date is the newest history date', () => {
    assert.strictEqual(
        Core.latestDate(['2026-01-04', '2026-08-16', '2025-11-30']), '2026-08-16');
    assert.strictEqual(Core.latestDate([]), null);
    assert.strictEqual(Core.latestDate(null), null);
});

test('a Sunday still ahead counts as the newest date', () => {
    // A booking six weeks out is already a commitment to pray for that person,
    // so the rotation has to stop offering them from the moment it is made.
    assert.strictEqual(Core.latestDate(['2026-01-04', '2099-01-01']), '2099-01-01');
});

test('junk in the history never outranks a real date', () => {
    assert.strictEqual(Core.latestDate(['2026-01-04', '0000-00-00', '', null]), '2026-01-04');
    assert.strictEqual(Core.latestDate(['0000-00-00']), null);
});

// ── nextLastPrayerDate — the pending-write case ──────────────────────────────
// The editor writes the history change and the cache in one batch, so it has to
// answer "what will the newest date be" from a read taken BEFORE the write. It
// used to just read the newest stored date, which is the answer to the question
// as it stood before the edit.

test('choosing a subject moves their date to this service', () => {
    assert.strictEqual(
        Core.nextLastPrayerDate(['2026-01-04'], '2026-08-16', true), '2026-08-16');
});

test('a first-time subject stops reading as never prayed for', () => {
    assert.strictEqual(Core.nextLastPrayerDate([], '2026-08-16', true), '2026-08-16');
});

test('removing a subject falls back to their previous date', () => {
    assert.strictEqual(
        Core.nextLastPrayerDate(['2026-01-04', '2026-08-16'], '2026-08-16', false),
        '2026-01-04');
});

test('removing a subject with no other history clears the date', () => {
    assert.strictEqual(Core.nextLastPrayerDate(['2026-08-16'], '2026-08-16', false), null);
});

test('re-saving an unchanged subject is idempotent', () => {
    assert.strictEqual(
        Core.nextLastPrayerDate(['2026-08-16'], '2026-08-16', true), '2026-08-16');
});

test('an older service does not overwrite a later one', () => {
    // Editing a Sunday from three months ago must not make that person look
    // like the most recently prayed for.
    assert.strictEqual(
        Core.nextLastPrayerDate(['2026-08-16'], '2026-05-03', true), '2026-08-16');
});

test('the legacy sentinel is not treated as a stored date', () => {
    assert.strictEqual(
        Core.nextLastPrayerDate(['0000-00-00'], '2026-08-16', false), null);
});

test('every surface shows the same "last prayed for" label', () => {
    assert.strictEqual(Core.lastPrayedLabel('2026-08-16'), 'Last: 2026-08-16');
    assert.strictEqual(Core.lastPrayedLabel(null), 'Never prayed for');
    assert.strictEqual(Core.lastPrayedLabel('0000-00-00'), 'Never prayed for');
    assert.strictEqual(Core.lastPrayedLabel(undefined), 'Never prayed for');
});
