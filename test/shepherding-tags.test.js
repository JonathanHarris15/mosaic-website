const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/shepherding-core.js');

// Shepherding Tags gained a stable identity (independent of the tag name), a
// derived Tag Hold (how long a Person has continuously carried a tag), and a
// Tag Merge. The pure pieces of that — deriving a hold from the Pastoral Record,
// formatting its Hold Duration, the Hold-Duration filter predicate, and planning
// a Merge — live in shepherding-core.js and are pinned here. See ADR-0011.

const DAY = 24 * 60 * 60 * 1000;
const ts = (ms) => ({ toDate: () => new Date(ms) }); // stand-in for a Firestore Timestamp
const added = (tagId, ms) => ({ tagId, action: 'added', kind: 'tag_change', createdAt: ts(ms) });
const removed = (tagId, ms) => ({ tagId, action: 'removed', kind: 'tag_change', createdAt: ts(ms) });

// ── deriveTagHolds ────────────────────────────────────────────────────────────
// The Tag Hold for a currently-carried tag begins at the most recent `added`
// Tag Change that has no later `removed`. Derived from the activity feed; the
// current `tags` array is the source of truth for what the Person carries now.

test('deriveTagHolds dates a hold from its single added Tag Change', () => {
    const holds = Core.deriveTagHolds([added('T', 1000)], ['T'], 1000 + 3 * DAY);
    assert.strictEqual(holds['T'].heldSinceMs, 1000);
    assert.strictEqual(holds['T'].durationMs, 3 * DAY);
});

test('deriveTagHolds re-dates the hold to the latest add after a removal', () => {
    // added, removed, added again — the current hold starts at the second add.
    const activity = [added('T', 1000), removed('T', 2000), added('T', 5000)];
    const holds = Core.deriveTagHolds(activity, ['T'], 5000 + DAY);
    assert.strictEqual(holds['T'].heldSinceMs, 5000);
    assert.strictEqual(holds['T'].durationMs, DAY);
});

test('deriveTagHolds treats a tag whose last change was a removal as not held', () => {
    // History says removed-last, yet the tag lingers in the array (legacy write):
    // the hold is unknown, so the tag is omitted rather than guessed.
    const activity = [added('T', 1000), removed('T', 2000)];
    const holds = Core.deriveTagHolds(activity, ['T'], 9000);
    assert.ok(!('T' in holds), 'no determinable current hold → omitted');
});

test('deriveTagHolds omits a carried tag that has no Tag Change history', () => {
    // Applied before Tag Changes were recorded → Hold Duration unknown.
    const holds = Core.deriveTagHolds([], ['Legacy'], 9000);
    assert.ok(!('Legacy' in holds));
});

test('deriveTagHolds ignores history for tags the Person no longer carries', () => {
    const holds = Core.deriveTagHolds([added('Gone', 1000)], ['Other'], 9000);
    assert.ok(!('Gone' in holds));
});

test('deriveTagHolds resolves each carried tag independently', () => {
    const activity = [added('A', 1000), added('B', 3000), removed('B', 4000)];
    const holds = Core.deriveTagHolds(activity, ['A', 'B'], 5000);
    assert.strictEqual(holds['A'].heldSinceMs, 1000);
    assert.ok(!('B' in holds), 'B was removed last → unknown current hold');
});

// ── formatHoldDuration ────────────────────────────────────────────────────────
// A Hold Duration renders as a single, largest-unit, human span.

test('formatHoldDuration renders a same-day hold as "today"', () => {
    assert.strictEqual(Core.formatHoldDuration(0), 'today');
    assert.strictEqual(Core.formatHoldDuration(5 * 60 * 60 * 1000), 'today');
});

test('formatHoldDuration renders days, months and years, singular and plural', () => {
    assert.strictEqual(Core.formatHoldDuration(1 * DAY), '1 day');
    assert.strictEqual(Core.formatHoldDuration(3 * DAY), '3 days');
    assert.strictEqual(Core.formatHoldDuration(29 * DAY), '29 days');
    assert.strictEqual(Core.formatHoldDuration(45 * DAY), '1 month');
    assert.strictEqual(Core.formatHoldDuration(90 * DAY), '3 months');
    assert.strictEqual(Core.formatHoldDuration(400 * DAY), '1 year');
    assert.strictEqual(Core.formatHoldDuration(800 * DAY), '2 years');
});

test('formatHoldDuration renders an unknown duration as empty', () => {
    assert.strictEqual(Core.formatHoldDuration(null), '');
    assert.strictEqual(Core.formatHoldDuration(undefined), '');
});

// ── holdMeetsMinimum ──────────────────────────────────────────────────────────
// The Hold-Duration filter keeps Persons who have held a tag for at least N days.
// An unknown hold never satisfies the filter (ADR-0011: excluded, not guessed).

test('holdMeetsMinimum passes a hold at or beyond the threshold', () => {
    assert.strictEqual(Core.holdMeetsMinimum(30 * DAY, 30), true);
    assert.strictEqual(Core.holdMeetsMinimum(31 * DAY, 30), true);
});

test('holdMeetsMinimum fails a shorter or unknown hold', () => {
    assert.strictEqual(Core.holdMeetsMinimum(29 * DAY, 30), false);
    assert.strictEqual(Core.holdMeetsMinimum(null, 30), false);
    assert.strictEqual(Core.holdMeetsMinimum(undefined, 30), false);
});

// ── holdSatisfies (directional) ───────────────────────────────────────────────

test('holdSatisfies with default direction means held at least days', () => {
    assert.strictEqual(Core.holdSatisfies(30 * DAY, 30), true);
    assert.strictEqual(Core.holdSatisfies(29 * DAY, 30), false);
});

test('holdSatisfies with lt means held less than days', () => {
    assert.strictEqual(Core.holdSatisfies(29 * DAY, 30, 'lt'), true);
    assert.strictEqual(Core.holdSatisfies(30 * DAY, 30, 'lt'), false);
});

test('holdSatisfies imposes no constraint at a zero threshold', () => {
    assert.strictEqual(Core.holdSatisfies(5 * DAY, 0, 'lt'), true);
    assert.strictEqual(Core.holdSatisfies(null, 0, 'lt'), true);
});

test('holdSatisfies never passes an unknown hold in either direction', () => {
    assert.strictEqual(Core.holdSatisfies(null, 30), false);
    assert.strictEqual(Core.holdSatisfies(undefined, 30, 'lt'), false);
});

// ── per-tag slider helpers ────────────────────────────────────────────────────
// Each selected tag filter chip carries its own Hold-Duration stop.

test('HOLD_FILTER_STOPS starts at 0 and ends at a year', () => {
    assert.strictEqual(Core.HOLD_FILTER_STOPS[0], 0);
    assert.strictEqual(Core.HOLD_FILTER_STOPS[Core.HOLD_FILTER_STOPS.length - 1], 365);
});

test('holdStopIndex snaps a stored day count to the nearest slider stop', () => {
    assert.strictEqual(Core.holdStopIndex(0), 0);
    assert.strictEqual(Core.holdStopIndex(30), Core.HOLD_FILTER_STOPS.indexOf(30));
    assert.strictEqual(Core.holdStopIndex(365), Core.HOLD_FILTER_STOPS.length - 1);
    assert.strictEqual(Core.holdStopIndex(33), Core.HOLD_FILTER_STOPS.indexOf(30)); // nearest
});

test('formatHoldShort gives a compact caption, empty at zero', () => {
    assert.strictEqual(Core.formatHoldShort(0), '');
    assert.strictEqual(Core.formatHoldShort(7), '1w');
    assert.strictEqual(Core.formatHoldShort(14), '2w');
    assert.strictEqual(Core.formatHoldShort(30), '1mo');
    assert.strictEqual(Core.formatHoldShort(90), '3mo');
    assert.strictEqual(Core.formatHoldShort(365), '1y');
});

// ── planTagMerge ──────────────────────────────────────────────────────────────
// A Merge folds merged tags into a surviving tag: rewrite each carrier's tags
// array, re-point their Tag Changes at the survivor (so the survivor inherits the
// hold), and delete the merged tags. Pure planner; a browser writer applies it.

test('planTagMerge repoints carriers and their Tag Changes onto the survivor', () => {
    const people = [
        { id: 'p1', tags: ['A', 'B'], activity: [added('B', 100)] },
        { id: 'p2', tags: ['B'], activity: [added('B', 200)] },
        { id: 'p3', tags: ['C'], activity: [] },
    ];
    const plan = Core.planTagMerge({ people, mergedTagIds: ['B'], survivorTagId: 'A' });

    // p1 already carries A, so the folded B dedupes away; p2 now carries A.
    const byId = Object.fromEntries(plan.personUpdates.map(u => [u.personId, u.newTags]));
    assert.deepStrictEqual(byId['p1'], ['A']);
    assert.deepStrictEqual(byId['p2'], ['A']);
    assert.ok(!('p3' in byId), 'a Person carrying no merged tag is untouched');

    // Both B Tag Changes are re-pointed at A.
    assert.strictEqual(plan.activityRewrites.length, 2);
    assert.ok(plan.activityRewrites.every(r => r.tagId === 'A'), 'every rewrite targets the survivor');
    assert.deepStrictEqual(
        plan.activityRewrites.map(r => r.personId).sort(),
        ['p1', 'p2']);

    assert.deepStrictEqual(plan.deleteTagIds, ['B']);
});

test('planTagMerge lets the survivor inherit the earlier (longer) hold', () => {
    // A held since 500, B since 100; after merging B into A the hold is since 100.
    const people = [{ id: 'p1', tags: ['A', 'B'], activity: [added('A', 500), added('B', 100)] }];
    const plan = Core.planTagMerge({ people, mergedTagIds: ['B'], survivorTagId: 'A' });

    // Apply the plan's rewrites to reconstruct the post-merge activity feed.
    const merged = people[0].activity.map(e =>
        e.tagId === 'B' ? { ...e, tagId: 'A' } : e);
    const holds = Core.deriveTagHolds(merged, ['A'], 100 + 10 * DAY);
    assert.strictEqual(holds['A'].heldSinceMs, 100, 'inherits the earlier application');
    assert.strictEqual(holds['A'].durationMs, 10 * DAY);
});

test('planTagMerge folds several tags into one survivor and dedupes', () => {
    const people = [{ id: 'p1', tags: ['A', 'B', 'C'], activity: [] }];
    const plan = Core.planTagMerge({ people, mergedTagIds: ['B', 'C'], survivorTagId: 'A' });
    assert.deepStrictEqual(plan.personUpdates[0].newTags, ['A']);
    assert.deepStrictEqual(plan.deleteTagIds.sort(), ['B', 'C']);
});

test('planTagMerge ignores the survivor listed among the merged tags', () => {
    const people = [{ id: 'p1', tags: ['A'], activity: [] }];
    const plan = Core.planTagMerge({ people, mergedTagIds: ['A', 'B'], survivorTagId: 'A' });
    assert.ok(!plan.deleteTagIds.includes('A'), 'the survivor is never deleted');
    assert.deepStrictEqual(plan.deleteTagIds, ['B']);
});
