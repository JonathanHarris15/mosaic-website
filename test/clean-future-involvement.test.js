const { test } = require('node:test');
const assert = require('node:assert');

// MS-161 — the predicate that decides which serve records get deleted.
//
// Everything else in the cleanup script is Firestore I/O and reporting. This is
// the part that can destroy something, so it is a pure function and it is
// tested: a slug that leaks into it deletes a legitimate record, and a date
// comparison off by one deletes a Sunday that actually happened.

const { isFutureServing, SERVING_SLUGS } = require('../scripts/clean-future-involvement.js');

const TODAY = '2026-07-31';
const record = (over) => Object.assign({ serviceDate: '2026-10-12', type: 'preacher' }, over);

// ── What goes ────────────────────────────────────────────────────────────────

test('a serve record for a Sunday still ahead goes', () => {
    assert.strictEqual(isFutureServing(record(), TODAY), true);
});

test('every Role a Service save writes is caught', () => {
    // Sermonette is deliberately absent: it is no longer a Service field, so a
    // record carrying that slug now belongs to a Servant Role's Assignment, and
    // deleting one of those is exactly what this list exists to prevent.
    ['service_leader', 'worship_leader', 'preacher',
        'prayer', 'elements', 'other', 'worship_helper'].forEach(type => {
        assert.strictEqual(isFutureServing(record({ type }), TODAY), true,
            'a Role left out here keeps its duplicate forever: ' + type);
    });
});

test('a record dated today goes too', () => {
    // The day has not finished, and the scheduled job will not convert this date
    // until tomorrow — so leaving it in place would leave a duplicate behind.
    assert.strictEqual(isFutureServing(record({ serviceDate: TODAY }), TODAY), true);
});

// ── What stays ───────────────────────────────────────────────────────────────

test('a Sunday that has already happened stays', () => {
    assert.strictEqual(isFutureServing(record({ serviceDate: '2026-07-26' }), TODAY), false);
    assert.strictEqual(isFutureServing(record({ serviceDate: '2020-01-05' }), TODAY), false);
});

test('yesterday stays', () => {
    assert.strictEqual(isFutureServing(record({ serviceDate: '2026-07-30' }), TODAY), false);
});

test('pastoral prayer stays, whatever its date', () => {
    // Being prayed for is not serving. MS-160 deliberately left its timing
    // alone, so deleting it here would break the prayer rotation.
    assert.strictEqual(isFutureServing(record({ type: 'pastoral_prayer' }), TODAY), false);
    assert.strictEqual(SERVING_SLUGS.has('pastoral_prayer'), false);
});

test('a servant Role stays', () => {
    // Those already follow the new model — an Assignment becomes Involvement
    // only once Confirmed and past — so any that exist are legitimate.
    ['coffee', 'welcome_team', 'sound_desk', 'kids', 'one_off'].forEach(type => {
        assert.strictEqual(isFutureServing(record({ type }), TODAY), false,
            'deleting a converted Assignment would lose real serving: ' + type);
    });
});

test('a record with no date, a junk date or no type stays', () => {
    assert.strictEqual(isFutureServing(record({ serviceDate: undefined }), TODAY), false);
    assert.strictEqual(isFutureServing(record({ serviceDate: 'someday' }), TODAY), false);
    assert.strictEqual(isFutureServing(record({ serviceDate: '2026-10' }), TODAY), false);
    assert.strictEqual(isFutureServing(record({ type: undefined }), TODAY), false);
});

test('nothing is deleted when today is unknown', () => {
    // A bad clock must not become a mass delete.
    assert.strictEqual(isFutureServing(record(), null), false);
    assert.strictEqual(isFutureServing(record(), 'not-a-date'), false);
});

test('an empty or absent record stays', () => {
    assert.strictEqual(isFutureServing(null, TODAY), false);
    assert.strictEqual(isFutureServing({}, TODAY), false);
});
