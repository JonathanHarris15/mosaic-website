const { test } = require('node:test');
const assert = require('node:assert');

const Roles = require('../public/roles-core.js');
const Fairness = require('../public/fairness-core.js');
const Loop = require('../public/auto-assign-core.js');
const View = require('../public/calendar-view.js');
const Saved = require('../public/auto-assign-saved-core.js');

// MS-188 — the scheduler listening.
//
// THE ASYMMETRY IS THE WHOLE POINT, and it is what these tests exist to pin:
//
//   • To a HUMAN, Away is advisory. The picker shows the person, greys them,
//     gives the reason in their own words, and the editor may place them anyway
//     — ADR-0021, the editor is the final word on the church's own rota.
//   • To the MACHINE, Away is absolute. Fairness and auto-assign seat only
//     `eligible` people and override nothing, so a program can never draft over
//     somebody's own word. A person knowingly doing it is defensible; a program
//     silently doing it is not.
//
// That asymmetry is not implemented twice. It falls out of Away being an
// ineligibility REASON: the picker draws reasons, the solve refuses them.

const person = (id, extra) => Object.assign({ id: id, name: id, tags: [] }, extra);
const either = n => ({ id: 's' + n, requirement: Roles.REQUIREMENTS.EITHER });
const role = (slug, slots) => ({
    slug: slug, name: slug, family: Roles.FAMILIES.SERVANT, slots: slots, restrictions: [],
});

const COFFEE = role('coffee', [either(1), either(2)]);
const PEOPLE = [person('ann'), person('bob'), person('cat'), person('dan')];

// ── The picker: shown, explained, and still placeable ────────────────────────

test('somebody away is judged ineligible, with Away as the reason', () => {
    const judged = Roles.candidatesFor(COFFEE, either(1), {
        people: PEOPLE,
        awayPersonIds: ['bob'],
    });

    const bob = judged.find(c => c.personId === 'bob');
    assert.strictEqual(bob.eligible, false);
    assert.strictEqual(bob.reason, Roles.REASONS.AWAY);
});

test('somebody away is still RETURNED — shown and passed over, never dropped', () => {
    // The whole design of the picker: an editor can see who was passed over and
    // why. Dropping them silently would be the omission this screen exists to
    // avoid, and it is what "not offered at all" means for an Inactive person —
    // which Away deliberately is not.
    const judged = Roles.candidatesFor(COFFEE, either(1), {
        people: PEOPLE,
        awayPersonIds: ['bob'],
    });
    assert.deepStrictEqual(judged.map(c => c.personId), ['ann', 'bob', 'cat', 'dan']);
});

test('Away outranks every rule about the roster', () => {
    // Somebody who will not be there cannot meaningfully be told that this place
    // wants a woman. Being absent explains everything else about them, which is
    // why it sits directly under Inactive in the order.
    const menOnly = role('coffee', [{ id: 's1', requirement: Roles.REQUIREMENTS.MALE }]);
    const judged = Roles.candidatesFor(menOnly, menOnly.slots[0], {
        people: [person('sarah', { sex: 'female' })],
        awayPersonIds: ['sarah'],
    });
    assert.strictEqual(judged[0].reason, Roles.REASONS.AWAY);
});

test('having left the church still outranks being away', () => {
    const judged = Roles.candidatesFor(COFFEE, either(1), {
        people: [person('gone', { membership: { inactive: true } })],
        awayPersonIds: ['gone'],
    });
    assert.strictEqual(judged[0].reason, Roles.REASONS.INACTIVE);
});

test('no away list at all changes nothing', () => {
    const judged = Roles.candidatesFor(COFFEE, either(1), { people: PEOPLE });
    assert.ok(judged.every(c => c.eligible), 'nobody should be blocked');
});

// ── The words ────────────────────────────────────────────────────────────────

test('the reason is the person’s own words, not a verdict', () => {
    const note = View.blockReason(
        { eligible: false, reason: Roles.REASONS.AWAY, personId: 'sarah' },
        { awayNote: "Sarah said they're away" }
    );
    assert.strictEqual(note, "Sarah said they're away");
});

test('an editor-entered Away is attributed to the editor', () => {
    const note = View.blockReason(
        { eligible: false, reason: Roles.REASONS.AWAY, personId: 'sarah' },
        { awayNote: 'Ann marked Sarah away' }
    );
    assert.strictEqual(note, 'Ann marked Sarah away');
});

test('the reason never reads as Unavailable, even with nothing to attribute', () => {
    // The fallback still has to be a sentence about what somebody said, because
    // "Unavailable" is the word this whole feature is worded against.
    const note = View.blockReason({ eligible: false, reason: Roles.REASONS.AWAY }, {});
    assert.doesNotMatch(note, /unavailab/i);
    assert.match(note, /away/i);
});

// ── The solve: absolute ──────────────────────────────────────────────────────

const solveWith = extra => Fairness.solve(Object.assign({
    seriesId: 'sunday_service',
    date: '2026-08-02',
    roles: [COFFEE],
    people: PEOPLE,
    history: [],
    occurrenceDates: ['2026-07-26', '2026-07-19', '2026-07-12'],
    windowSize: 12,
    intensityOf: () => 1,
    liturgicalSlugs: Roles.LITURGICAL_SLUGS,
    liturgicalHolders: [],
    relationships: [],
    groups: [],
    candidatesFor: Roles.candidatesFor,
}, extra || {}));

test('the solve never seats somebody who said they are away', () => {
    const result = solveWith({ awayPersonIds: ['ann', 'bob'] });
    const seated = result.filled.map(s => s.personId);
    assert.ok(!seated.includes('ann'), 'ann was drafted over her own word');
    assert.ok(!seated.includes('bob'), 'bob was drafted over his own word');
});

test('the solve still fills the places it can', () => {
    // Away is not a reason to give up on the rota — only on those people.
    const result = solveWith({ awayPersonIds: ['ann', 'bob'] });
    assert.strictEqual(result.filled.length, 2);
    assert.strictEqual(result.unfilled.length, 0);
});

test('a place left empty because everybody is away says so', () => {
    // Rather than shrugging. This is why Away is threaded through eligibility
    // instead of being filtered out of the people list before the solve runs —
    // filtered out, the gap could only report some unrelated rule.
    const result = solveWith({ awayPersonIds: ['ann', 'bob', 'cat', 'dan'] });
    assert.strictEqual(result.filled.length, 0);
    const reasons = result.unfilled.map(g => g.reason);
    assert.ok(reasons.includes(Roles.REASONS.AWAY),
        'the gap should name Away; got ' + JSON.stringify(reasons));
});

// ── Across a range ───────────────────────────────────────────────────────────

const RANGE = ['2026-10-04', '2026-10-11'];
const PAST = [
    '2026-09-27', '2026-09-20', '2026-09-13', '2026-09-06',
    '2026-08-30', '2026-08-23', '2026-08-16', '2026-08-09',
    '2026-08-02', '2026-07-26', '2026-07-19', '2026-07-12',
];

const draftWith = extra => Loop.draft(Object.assign({
    dates: RANGE,
    pastDates: PAST,
    history: [],
    existing: {},
    choice: Loop.CHOICES.KEEP,
    roles: [COFFEE],
    people: PEOPLE,
    windowSize: 12,
    seriesId: 'sunday_service',
    solve: Fairness.solve,
    candidatesFor: Roles.candidatesFor,
    intensityOf: () => 1,
    liturgicalSlugs: [],
    liturgicalHoldersFor: () => [],
    relationships: [],
    groups: [],
}, extra || {}));

const seatedOn = (draft, date) => (draft.dates.find(d => d.date === date).seats || [])
    .map(s => s.personId).filter(Boolean);

test('a draft with no away callback seats people exactly as before', () => {
    // The guard on every other test in this section: all four assertions below
    // are about somebody NOT being seated, and each of them would pass by
    // accident if the fixture seated nobody at all.
    const draft = draftWith({});
    assert.strictEqual(seatedOn(draft, RANGE[0]).length, 2);
    assert.strictEqual(seatedOn(draft, RANGE[1]).length, 2);
});

test('a draft never seats somebody on a date they said they are away', () => {
    const draft = draftWith({ awayOn: date => (date === RANGE[0] ? ['ann'] : []) });
    assert.ok(!seatedOn(draft, RANGE[0]).includes('ann'), 'ann was drafted over her own word');
    assert.strictEqual(seatedOn(draft, RANGE[0]).length, 2, 'the places were still filled');
});

test('Away is asked per date, because the 4th says nothing about the 11th', () => {
    const draft = draftWith({ awayOn: date => (date === RANGE[0] ? ['ann'] : []) });
    // Away on one date must not take somebody out of the whole range. With four
    // people and two places a fortnight running, fairness puts the two who did
    // not serve first onto the second date — ann among them.
    assert.ok(seatedOn(draft, RANGE[1]).includes('ann'),
        'being away on one date removed her from the range');
});

test('being Out and being Away are different questions, asked separately', () => {
    // The rename in MS-188 exists so these cannot be confused, and answering one
    // must never satisfy the other.
    const draft = draftWith({
        outOn: date => (date === RANGE[0] ? ['bob'] : []),
        awayOn: date => (date === RANGE[0] ? ['ann'] : []),
    });
    const seated = seatedOn(draft, RANGE[0]);
    assert.ok(!seated.includes('ann'), 'away');
    assert.ok(!seated.includes('bob'), 'out');
    assert.deepStrictEqual(seated.sort(), ['cat', 'dan'], 'the other two still serve');
});

// ── The rename's one compatibility promise ───────────────────────────────────

test('a draft saved before the rename keeps its out-list', () => {
    // `away` became `out` in MS-188. Drafts saved under the old key are still
    // sitting in editors' browsers, and losing somebody's work to tidy a name
    // would be a poor trade.
    const packed = Saved.pack({ dates: [] }, { away: { '2026-08-02': ['bob'] } });
    assert.deepStrictEqual(packed.out, { '2026-08-02': ['bob'] });
});

test('the new key wins when both are somehow present', () => {
    const packed = Saved.pack({ dates: [] }, {
        out: { '2026-08-02': ['ann'] },
        away: { '2026-08-02': ['bob'] },
    });
    assert.deepStrictEqual(packed.out, { '2026-08-02': ['ann'] });
});

test('nothing in the draft layer is called away any more', () => {
    // The word belongs to the Person now. A field called `away` on a draft is
    // exactly the collision the rename was for.
    const packed = Saved.pack({ dates: [] }, { out: {} });
    assert.ok(!('away' in packed), 'the saved draft still carries an `away` key');
});
