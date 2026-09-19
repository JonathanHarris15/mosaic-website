const { test } = require('node:test');
const assert = require('node:assert');

const {
    VISIT_THRESHOLD,
    WINDOW_MONTHS,
    AUTHOR_NAME,
    SOURCE,
    isEligible,
    churchToday,
    windowStart,
    visitDays,
    lastChangeDayFromStamps,
    shouldMove,
    regularAttenderAdvanceUpdate,
    formatVisitExplanation,
    buildAttendanceRuleRecord,
} = require('../functions/attendance-rule.js');

const track = require('../functions/membership-track.js');
const ac = require('../functions/assignment-conversion.js');
const Core = require('../public/shepherding-core.js');

// The attendance rule (MS-425 / MS-459): a Visitor with 4 distinct visit days
// inside a rolling 2-calendar-month window becomes Regular Attender. These pin
// the decisions — who is eligible, which days count, when to move, and the
// Membership Change the Pastoral Record will render — with no Firestore.

const TODAY = '2026-09-14';
const FOUR_DAYS = ['2026-07-20', '2026-08-03', '2026-08-31', '2026-09-14'];

// ── Eligibility ──────────────────────────────────────────────────────────────

test('a Visitor who is not Inactive is eligible', () => {
    assert.strictEqual(isEligible({ stage: 'visitor', inactive: false }), true);
    assert.strictEqual(isEligible({ stage: track.VISITOR_STAGE }), true);
});

test('every other stage is refused, including Regular Attender', () => {
    for (const stage of [
        'regular_attender', 'prospective_member', 'member',
        'moving_membership', 'previous_member',
    ]) {
        assert.strictEqual(
            isEligible({ stage, inactive: false }), false, stage);
    }
});

test('no stage at all is refused — nobody is put onto the Track', () => {
    assert.strictEqual(isEligible({ stage: null, inactive: false }), false);
    assert.strictEqual(isEligible({}), false);
    assert.strictEqual(isEligible(undefined), false);
    assert.strictEqual(isEligible(null), false);
});

test('an Inactive Person is refused even when their retained stage is Visitor', () => {
    assert.strictEqual(
        isEligible({ stage: 'visitor', inactive: true }), false);
    assert.strictEqual(isEligible({ stage: null, inactive: true }), false);
});

// ── The church clock and the 2-month window ──────────────────────────────────

test('churchToday uses the same America/Chicago clock as the nightly conversions', () => {
    assert.strictEqual(churchToday, ac.churchToday);
    const noonChicago = new Date('2026-09-14T17:00:00Z'); // 12:00 in Chicago
    assert.strictEqual(churchToday(noonChicago), '2026-09-14');
    assert.strictEqual(churchToday(noonChicago), ac.churchToday(noonChicago));
});

test('the window starts on the same calendar day two months earlier', () => {
    assert.strictEqual(WINDOW_MONTHS, 2);
    assert.strictEqual(windowStart('2026-09-14'), '2026-07-14');
    assert.strictEqual(windowStart('2026-03-15'), '2026-01-15');
});

test('31 Oct looks back to 31 Aug — August has 31 days, so no clamp', () => {
    assert.strictEqual(windowStart('2026-10-31'), '2026-08-31');
});

test('30 Apr clamps to the last day of February in a common year', () => {
    assert.strictEqual(windowStart('2026-04-30'), '2026-02-28');
});

test('30 Apr clamps to 29 Feb in a leap year', () => {
    assert.strictEqual(windowStart('2024-04-30'), '2024-02-29');
});

test('the window crosses a year boundary', () => {
    assert.strictEqual(windowStart('2026-01-31'), '2025-11-30');
    assert.strictEqual(windowStart('2026-02-28'), '2025-12-28');
});

// ── Which days count ─────────────────────────────────────────────────────────

test('3 visit days in the window stay below the threshold', () => {
    const days = visitDays(
        ['2026-08-03', '2026-08-31', '2026-09-14'], TODAY, null);
    assert.deepStrictEqual(days, ['2026-08-03', '2026-08-31', '2026-09-14']);
    assert.strictEqual(days.length < VISIT_THRESHOLD, true);
    assert.strictEqual(
        shouldMove({ stage: 'visitor' }, days), false);
});

test('a 4th day inside the window reaches the threshold', () => {
    const days = visitDays(FOUR_DAYS, TODAY, null);
    assert.deepStrictEqual(days, FOUR_DAYS);
    assert.strictEqual(days.length, VISIT_THRESHOLD);
    assert.strictEqual(shouldMove({ stage: 'visitor' }, days), true);
});

test('a 4th day whose earliest visit falls outside the window does not count', () => {
    // Window is 14 Jul–14 Sep. 6 Jul is out; the other three are in.
    const days = visitDays(
        ['2026-07-06', '2026-07-20', '2026-08-03', '2026-09-14'],
        TODAY, null);
    assert.deepStrictEqual(days, ['2026-07-20', '2026-08-03', '2026-09-14']);
    assert.strictEqual(shouldMove({ stage: 'visitor' }, days), false);
});

test('the day on the window start counts — the window is inclusive at both ends', () => {
    const days = visitDays(
        ['2026-07-14', '2026-08-03', '2026-08-31', '2026-09-14'],
        TODAY, null);
    assert.ok(days.includes('2026-07-14'));
    assert.strictEqual(days.length, 4);
});

test('two dates the same day count once', () => {
    const days = visitDays(
        ['2026-07-20', '2026-07-20', '2026-08-03', '2026-08-03',
            '2026-08-31', '2026-09-14'],
        TODAY, null);
    assert.deepStrictEqual(days, FOUR_DAYS);
});

test('dates after today are ignored', () => {
    const days = visitDays(
        ['2026-07-20', '2026-08-03', '2026-08-31', '2026-09-14', '2026-09-21'],
        TODAY, null);
    assert.deepStrictEqual(days, FOUR_DAYS);
    assert.ok(!days.includes('2026-09-21'));
});

test('days on or before the last Membership Change day are ignored', () => {
    // Elder moved them back to Visitor on 3 Aug. Only days after that count.
    const days = visitDays(FOUR_DAYS, TODAY, '2026-08-03');
    assert.deepStrictEqual(days, ['2026-08-31', '2026-09-14']);
    assert.strictEqual(shouldMove({ stage: 'visitor' }, days), false);
});

test('with no Membership Change, every day in the window counts', () => {
    const days = visitDays(FOUR_DAYS, TODAY, null);
    assert.deepStrictEqual(days, FOUR_DAYS);
    assert.deepStrictEqual(visitDays(FOUR_DAYS, TODAY, undefined), FOUR_DAYS);
    assert.deepStrictEqual(visitDays(FOUR_DAYS, TODAY, ''), FOUR_DAYS);
});

test('four visit days after an elder reset still move', () => {
    const afterReset = [
        '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-14',
    ];
    const days = visitDays(afterReset, TODAY, '2026-08-03');
    assert.deepStrictEqual(days, afterReset);
    assert.strictEqual(shouldMove({ stage: 'visitor' }, days), true);
});

function stamp(iso) {
    const date = new Date(iso);
    return {
        toMillis: () => date.getTime(),
        toDate: () => date,
    };
}

test('lastChangeDayFromStamps is null when nothing can be read', () => {
    assert.strictEqual(lastChangeDayFromStamps(null), null);
    assert.strictEqual(lastChangeDayFromStamps([]), null);
    assert.strictEqual(lastChangeDayFromStamps([{}, null, 'x']), null);
});

test('lastChangeDayFromStamps picks the latest church-local day', () => {
    // 17:00 UTC is noon in Chicago — the same clock visit days use.
    assert.strictEqual(
        lastChangeDayFromStamps([
            stamp('2026-07-20T17:00:00Z'),
            stamp('2026-08-03T17:00:00Z'),
        ]),
        '2026-08-03');
});

test('lastChangeDayFromStamps skips junk and keeps a later tie', () => {
    const noon = stamp('2026-08-03T17:00:00Z');
    const alsoNoon = stamp('2026-08-03T17:00:00Z');
    assert.strictEqual(
        lastChangeDayFromStamps([null, noon, {}, alsoNoon]),
        '2026-08-03');
});

test('lastChangeDayFromStamps refuses a stamp whose date is unreadable', () => {
    assert.strictEqual(lastChangeDayFromStamps([{
        toMillis: () => 1,
        toDate: () => new Date('nope'),
    }]), null);
});

test('junk and missing dates are skipped, not thrown', () => {
    const days = visitDays(
        [null, '', 42, '2026-08-03', undefined, '2026-08-31'],
        TODAY, null);
    assert.deepStrictEqual(days, ['2026-08-03', '2026-08-31']);
    assert.deepStrictEqual(visitDays(undefined, TODAY, null), []);
    assert.deepStrictEqual(visitDays(null, TODAY, null), []);
});

test('counted days come back sorted, so the explanation reads in order', () => {
    const days = visitDays(
        ['2026-09-14', '2026-07-20', '2026-08-31', '2026-08-03'],
        TODAY, null);
    assert.deepStrictEqual(days, FOUR_DAYS);
});

// ── Should move ──────────────────────────────────────────────────────────────

test('shouldMove is false when they are not eligible, even with 4 days', () => {
    assert.strictEqual(
        shouldMove({ stage: 'prospective_member' }, FOUR_DAYS), false);
    assert.strictEqual(
        shouldMove({ stage: 'visitor', inactive: true }, FOUR_DAYS), false);
    assert.strictEqual(shouldMove({}, FOUR_DAYS), false);
});

test('shouldMove is false with fewer than 4 counted days', () => {
    assert.strictEqual(
        shouldMove({ stage: 'visitor' }, FOUR_DAYS.slice(0, 3)), false);
    assert.strictEqual(shouldMove({ stage: 'visitor' }, []), false);
    assert.strictEqual(shouldMove({ stage: 'visitor' }, undefined), false);
});

// ── What the advance writes ──────────────────────────────────────────────────

test('the advance moves the stage with dotted paths, so the rest of membership survives', () => {
    const update = regularAttenderAdvanceUpdate(['Visitor']);
    assert.strictEqual(update['membership.stage'], 'regular_attender');
    assert.strictEqual(update['membership.inactive'], false);
    assert.ok(!('membership' in update));
});

test('the tags are re-projected from Regular Attender, not appended to', () => {
    const update = regularAttenderAdvanceUpdate(['Visitor', 'Red Flag']);
    assert.deepStrictEqual(update.tags, ['Red Flag', 'Regular Attender']);
});

test('the projected tags agree with the canonical projection', () => {
    const update = regularAttenderAdvanceUpdate(['Visitor']);
    assert.deepStrictEqual(
        update.tags,
        Core.applyMembershipTags(
            ['Visitor'], { stage: 'regular_attender', inactive: false })
    );
});

// ── The Pastoral Record entry ────────────────────────────────────────────────

test('the explanation lists each counted day the way the PRD locked it', () => {
    assert.strictEqual(
        formatVisitExplanation(FOUR_DAYS),
        'Marked present on 4 days in two months: 20 Jul, 3 Aug, 31 Aug, 14 Sep.');
});

test('the record has the slider\'s fields, credited to Attendance rule', () => {
    const record = buildAttendanceRuleRecord(FOUR_DAYS);
    assert.strictEqual(record.kind, 'membership_change');
    assert.strictEqual(record.previousStage, 'visitor');
    assert.strictEqual(record.newStage, 'regular_attender');
    assert.strictEqual(record.previousInactive, false);
    assert.strictEqual(record.newInactive, false);
    assert.strictEqual(record.authorUid, null);
    assert.strictEqual(record.authorName, AUTHOR_NAME);
    assert.strictEqual(record.authorName, 'Attendance rule');
    assert.strictEqual(record.source, SOURCE);
    assert.strictEqual(record.source, 'attendance_rule');
    assert.strictEqual(record.sourceDocumentId, null);
    assert.strictEqual(
        record.explanation,
        'Marked present on 4 days in two months: 20 Jul, 3 Aug, 31 Aug, 14 Sep.');
});

test('the record has the same shape the slider writes, so the feed renders it', () => {
    const record = buildAttendanceRuleRecord(FOUR_DAYS);
    const fromSlider = Core.buildMembershipChange({
        previous: { stage: 'visitor', inactive: false },
        next: { stage: 'regular_attender', inactive: false },
        authorUid: null, authorName: '', source: 'people_list',
    });
    assert.deepStrictEqual(
        Object.keys(record).sort(), Object.keys(fromSlider).sort());
});

test('the record reads as Advanced to Regular Attender in the Pastoral Record', () => {
    const record = buildAttendanceRuleRecord(FOUR_DAYS);
    assert.strictEqual(
        Core.describeMembershipChange(record),
        'Advanced to Regular Attender');
});

test('the server Track constants name Visitor and Regular Attender', () => {
    assert.strictEqual(track.VISITOR_STAGE, 'visitor');
    assert.strictEqual(track.REGULAR_ATTENDER_STAGE, 'regular_attender');
    assert.ok(Core.MEMBERSHIP_STAGES.includes(track.VISITOR_STAGE));
    assert.ok(Core.MEMBERSHIP_STAGES.includes(track.REGULAR_ATTENDER_STAGE));
});
