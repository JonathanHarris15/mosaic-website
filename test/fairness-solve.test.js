const { test } = require('node:test');
const assert = require('node:assert');

const Fairness = require('../public/fairness-core.js');
const Roles = require('../public/roles-core.js');

// The solve (MS-17, ADR-0020): staff a whole Event occurrence at once,
// maximising the total time-since-last-served across the roster.
//
// Backtracking search with branch-and-bound. The two rejected alternatives are
// both represented below by the tests they would fail:
//
//   • max-weight bipartite matching is WRONG, not merely approximate — it
//     expresses only unary constraints and would seat a married couple in Kids,
//     because notTogether / notSameGroup / sameGroup constrain COMBINATIONS.
//   • best-of-N shuffles is non-deterministic, and a roster that redraws
//     differently on Wednesday than Tuesday cannot be reviewed.

const SUNDAYS = [
    '2026-07-26', '2026-07-19', '2026-07-12', '2026-07-05',
    '2026-06-28', '2026-06-21', '2026-06-14', '2026-06-07',
    '2026-05-31', '2026-05-24', '2026-05-17', '2026-05-10',
];

const person = (id, extra) => Object.assign({ id: id, name: id, tags: [] }, extra);
const serve = (personId, type, serviceDate) => ({
    personId: personId, type: type, serviceDate: serviceDate, seriesId: 'sunday_service',
});

const either = n => ({ id: 's' + n, requirement: Roles.REQUIREMENTS.EITHER });

const role = (slug, slots, extra) => Object.assign({
    slug: slug,
    name: slug,
    family: Roles.FAMILIES.SERVANT,
    slots: slots,
    restrictions: [],
}, extra || {});

const COFFEE = role('coffee', [either(1), either(2)]);
const SETUP = role('setup', [either(1)]);

const solveWith = extra => Fairness.solve(Object.assign({
    seriesId: 'sunday_service',
    date: '2026-08-02',
    roles: [COFFEE],
    people: [person('a'), person('b'), person('c'), person('d'),
             person('e'), person('f'), person('g'), person('h')],
    history: [],
    occurrenceDates: SUNDAYS,
    windowSize: 12,
    intensityOf: () => 1,
    liturgicalSlugs: Roles.LITURGICAL_SLUGS,
    liturgicalHolders: [],
    relationships: [],
    groups: [],
    // Eligibility is roles-core's, injected rather than imported — the solver
    // never gets to hold its own opinion about who may serve.
    candidatesFor: Roles.candidatesFor,
}, extra || {}));

const seatedIds = result => result.filled.map(f => f.personId).sort();
const seatFor = (result, roleSlug, slotId) =>
    result.filled.find(f => f.roleSlug === roleSlug && f.slotId === slotId);

// ── Every slot comes back, filled or explained ───────────────────────────────

test('every slot of every Role comes back either filled or explicitly unfilled', () => {
    const result = solveWith({ roles: [COFFEE, SETUP] });
    assert.equal(result.filled.length + result.unfilled.length, 3);
});

test('a slot that cannot be filled is returned empty with the rule that blocked it', () => {
    const gated = role('communion', [either(1)], {
        restrictions: [{ kind: Roles.RESTRICTIONS.ALLOWLIST, personIds: ['nobody-here'] }],
    });
    const result = solveWith({ roles: [gated] });

    assert.equal(result.filled.length, 0);
    assert.equal(result.unfilled.length, 1);
    assert.equal(result.unfilled[0].reason, Roles.REASONS.NOT_ON_ALLOWLIST);
});

test('an unfillable slot is never simply omitted', () => {
    const gated = role('communion', [either(1)], {
        restrictions: [{ kind: Roles.RESTRICTIONS.ALLOWLIST, personIds: ['nobody-here'] }],
    });
    const result = solveWith({ roles: [gated, SETUP] });

    assert.equal(result.unfilled.length, 1);
    assert.equal(result.filled.length, 1, 'the fillable Role must still be filled');
});

// ── The rules a score sort would break ───────────────────────────────────────

test('a roster never seats two people a notTogether rule keeps apart', () => {
    // Only two people exist, and they are married. The Role needs both slots.
    const kids = role('kids', [either(1), either(2)], {
        restrictions: [{ kind: Roles.RESTRICTIONS.NOT_TOGETHER, typeId: 'marriage' }],
    });
    const result = solveWith({
        roles: [kids],
        people: [person('carl'), person('alice')],
        relationships: [{ fromId: 'carl', toId: 'alice', typeId: 'marriage' }],
    });

    assert.equal(result.filled.length, 1, 'one of them may serve, never both');
    assert.equal(result.unfilled.length, 1);
});

test('a notTogether rule holds even when the fresher pair would score higher', () => {
    // Alice and Carl are the two least-loaded, so any greedy pass takes both.
    const kids = role('kids', [either(1), either(2)], {
        restrictions: [{ kind: Roles.RESTRICTIONS.NOT_TOGETHER, typeId: 'marriage' }],
    });
    const result = solveWith({
        roles: [kids],
        people: [person('alice'), person('carl'), person('brenda')],
        relationships: [{ fromId: 'carl', toId: 'alice', typeId: 'marriage' }],
        history: [serve('brenda', 'kids', '2026-07-26')],
    });

    const ids = seatedIds(result);
    assert.equal(result.filled.length, 2);
    assert.equal(ids.includes('alice') && ids.includes('carl'), false);
});

test('a sameGroup Role is staffed from one group, not from the freshest people', () => {
    const cohesive = role('welcome', [either(1), either(2)], {
        restrictions: [{ kind: Roles.RESTRICTIONS.SAME_GROUP, typeId: 'house-group' }],
    });
    const result = solveWith({
        roles: [cohesive],
        people: [person('a'), person('b'), person('c')],
        groups: [
            { id: 'g1', typeId: 'house-group', leaderId: 'b', memberIds: ['c'] },
            { id: 'g2', typeId: 'house-group', leaderId: 'a', memberIds: [] },
        ],
    });

    assert.deepEqual(seatedIds(result), ['b', 'c']);
});

test('a notSameGroup Role spreads across groups', () => {
    const spread = role('sound', [either(1), either(2)], {
        restrictions: [{ kind: Roles.RESTRICTIONS.NOT_SAME_GROUP, typeId: 'house-group' }],
    });
    const result = solveWith({
        roles: [spread],
        people: [person('a'), person('b'), person('c')],
        groups: [{ id: 'g1', typeId: 'house-group', leaderId: 'a', memberIds: ['b'] }],
    });

    const ids = seatedIds(result);
    assert.equal(result.filled.length, 2);
    assert.equal(ids.includes('a') && ids.includes('b'), false);
});

test('an allowlisted Role is filled only from its list', () => {
    const communion = role('communion', [either(1)], {
        restrictions: [{ kind: Roles.RESTRICTIONS.ALLOWLIST, personIds: ['g'] }],
    });
    const result = solveWith({ roles: [communion] });
    assert.deepEqual(seatedIds(result), ['g']);
});

// ── Exclusivity ──────────────────────────────────────────────────────────────

test('nobody is given two Roles when both are exclusive', () => {
    const result = solveWith({
        roles: [COFFEE, SETUP],
        people: [person('a'), person('b'), person('c')],
    });
    const ids = result.filled.map(f => f.personId);
    assert.equal(new Set(ids).size, ids.length);
});

test('two permissive Roles may fall to one person when nobody else is left', () => {
    const greetA = role('greet-a', [either(1)], { allowsAnotherRole: true });
    const greetB = role('greet-b', [either(1)], { allowsAnotherRole: true });
    const result = solveWith({ roles: [greetA, greetB], people: [person('a')] });

    assert.equal(result.filled.length, 2);
    assert.deepEqual(result.filled.map(f => f.personId), ['a', 'a']);
});

test('an exclusive Role never doubles up even when it is the only way to fill', () => {
    const result = solveWith({ roles: [COFFEE, SETUP], people: [person('a')] });
    assert.equal(result.filled.length, 1);
    assert.equal(result.unfilled.length, 2);
});

// ── Recency is what the search maximises ─────────────────────────────────────

test('among equally unloaded people the Role goes to whoever did it longest ago', () => {
    const result = solveWith({
        roles: [SETUP],
        people: [person('a'), person('b')],
        history: [
            serve('a', 'setup', '2026-07-26'),
            serve('b', 'setup', '2026-05-10'),
            // levelled on load, so only recency for THIS Role can separate them
            serve('a', 'x', '2026-05-10'),
            serve('b', 'x', '2026-07-26'),
        ],
    });
    assert.deepEqual(seatedIds(result), ['b']);
});

test('the search maximises the total, not each slot in turn', () => {
    // Greedy would give Coffee s1 to `a` (freshest at coffee) and then have
    // nobody good for setup. Taking the whole roster together scores higher.
    const result = solveWith({
        roles: [role('coffee', [either(1)]), role('setup', [either(1)])],
        people: [person('a'), person('b')],
        history: [
            serve('a', 'setup', '2026-07-26'),
            serve('b', 'coffee', '2026-07-26'),
        ],
    });

    assert.equal(seatFor(result, 'coffee', 's1').personId, 'a');
    assert.equal(seatFor(result, 'setup', 's1').personId, 'b');
});

// ── Determinism ──────────────────────────────────────────────────────────────

test('the same occurrence solves identically twice', () => {
    const once = solveWith();
    const twice = solveWith();
    assert.deepEqual(once.filled, twice.filled);
});

test('a re-run is identical even though ties are shuffled', () => {
    // Everybody is identical, so every roster scores the same and only the
    // tie-break decides. It must still land in the same place both times.
    const runs = [solveWith(), solveWith(), solveWith()];
    assert.deepEqual(runs[0].filled, runs[1].filled);
    assert.deepEqual(runs[1].filled, runs[2].filled);
});

test('week after week, a tie does not keep falling to the same people', () => {
    // Everyone is identical, so recency ties every time and only the tie-break
    // decides. Alphabetical would give `a` and `b` every Sunday for ever.
    //
    // Asserting that two PARTICULAR dates differ would be a coin flip, not a
    // property — with eight people and two slots the same pair can come up
    // twice honestly. What must hold is that the picks move around.
    const rosters = ['2026-08-02', '2026-08-09', '2026-08-16', '2026-08-23', '2026-08-30']
        .map(date => seatedIds(solveWith({ date: date })).join(','));

    assert.ok(new Set(rosters).size > 1, 'every week picked the same pair: ' + rosters[0]);
});

test('a different series on the same date solves differently', () => {
    const sunday = solveWith({ seriesId: 'sunday_service' });
    const midweek = solveWith({ seriesId: 'midweek' });
    assert.notDeepEqual(seatedIds(sunday), seatedIds(midweek));
});

// ── The pool widens rather than failing ──────────────────────────────────────

test('a pool too tight to be legal widens until a valid roster exists', () => {
    // Only `z` carries the tag, and `z` is the most loaded person there is, so
    // a pool cut to the least-loaded few would never reach them.
    const gated = role('kids', [either(1)], {
        restrictions: [{ kind: Roles.RESTRICTIONS.REQUIRE_TAG, tagId: 'dbs' }],
    });
    const people = 'abcdefghijklmn'.split('').map(id => person(id))
        .concat([person('z', { tags: ['dbs'] })]);
    const history = SUNDAYS.map(d => serve('z', 'sound', d));

    const result = solveWith({ roles: [gated], people: people, history: history });

    assert.deepEqual(seatedIds(result), ['z']);
    assert.equal(result.widened > 0, true, 'and it should say that it had to reach');
});

test('widening is reported so tight restrictions become visible', () => {
    const result = solveWith();
    assert.equal(typeof result.widened, 'number');
});

test('a roster of people all over their rest budget is flagged', () => {
    const people = [person('a'), person('b')];
    const history = [];
    people.forEach(p => SUNDAYS.forEach(d => history.push(serve(p.id, 'sound', d))));

    const result = solveWith({ roles: [SETUP], people: people, history: history });

    assert.equal(result.allSpent, true);
    assert.equal(result.filled.length, 1, 'a rota that refuses to fill is useless');
});

// ── Inactive people ──────────────────────────────────────────────────────────

test('an inactive person is never seated, even if handed to the solver', () => {
    const result = solveWith({
        roles: [SETUP],
        people: [person('gone', { membership: { inactive: true } }), person('a')],
    });
    assert.deepEqual(seatedIds(result), ['a']);
});

// ── Stepping a range ─────────────────────────────────────────────────────────

test('ten stepped occurrences spread work better than ten against static history', () => {
    const people = 'abcdefgh'.split('').map(id => person(id));
    const dates = ['2026-08-02', '2026-08-09', '2026-08-16', '2026-08-23', '2026-08-30',
                   '2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04'];

    const spread = counts => {
        const values = Object.values(counts);
        return Math.max.apply(null, values) - Math.min.apply(null, values);
    };

    // Stepped: each week's picks roll into the next week's history.
    let history = [];
    let past = SUNDAYS.slice();
    const stepped = {};
    people.forEach(p => { stepped[p.id] = 0; });

    dates.forEach(date => {
        const result = solveWith({
            date: date, roles: [COFFEE], people: people,
            history: history, occurrenceDates: past,
        });
        result.filled.forEach(f => {
            stepped[f.personId] += 1;
            history = history.concat([serve(f.personId, f.roleSlug, date)]);
        });
        past = [date].concat(past);
    });

    // Static: every week solved against the same untouched history.
    const stat = {};
    people.forEach(p => { stat[p.id] = 0; });
    dates.forEach(date => {
        solveWith({
            date: date, roles: [COFFEE], people: people,
            history: [], occurrenceDates: SUNDAYS,
        }).filled.forEach(f => { stat[f.personId] += 1; });
    });

    assert.ok(
        spread(stepped) < spread(stat),
        'stepping is the whole reason this staffs an occurrence rather than ranking: ' +
        'stepped spread ' + spread(stepped) + ' vs static ' + spread(stat)
    );
});

test('across ten stepped weeks nobody is worked far harder than anyone else', () => {
    const people = 'abcdefgh'.split('').map(id => person(id));
    let history = [];
    let past = SUNDAYS.slice();
    const counts = {};
    people.forEach(p => { counts[p.id] = 0; });

    ['2026-08-02', '2026-08-09', '2026-08-16', '2026-08-23', '2026-08-30',
     '2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04'].forEach(date => {
        const result = solveWith({
            date: date, roles: [COFFEE], people: people,
            history: history, occurrenceDates: past,
        });
        result.filled.forEach(f => {
            counts[f.personId] += 1;
            history = history.concat([serve(f.personId, f.roleSlug, date)]);
        });
        past = [date].concat(past);
    });

    const values = Object.values(counts);
    // 20 slots across 8 people. Perfectly even is 2.5 each; nobody should be
    // more than one turn away from anyone else.
    assert.ok(
        Math.max.apply(null, values) - Math.min.apply(null, values) <= 1,
        'uneven: ' + JSON.stringify(counts)
    );
});

// ── Cross-Role Rules reach the solve (MS-220) ────────────────────────────────
//
// ⚠ A draft gets no easier a ride than a hand-made rota. If the solve did not
// see these rules it would cheerfully seat the very roster the warnings pass
// then complains about — a screen arguing with itself, every week.

const CROSS_MARRIAGE = 'marriage';
// Exclusive, like a real pair of jobs on one morning — which also means the
// two places go to two different people, so the couple is what tempts the
// solve rather than one person holding both.
const HELPER = role('kids_helper', [either(1)]);
const LEADER = role('kids_leader', [either(1)]);

// Everyone in the pool is married to somebody else in it, so the rule has to
// bite: two of the four are refused whichever way the solve fills the pair.
const COUPLES = [
    { id: 'c1', typeId: CROSS_MARRIAGE, name: 'A & B', leaderId: null, memberIds: ['a', 'b'] },
    { id: 'c2', typeId: CROSS_MARRIAGE, name: 'C & D', leaderId: null, memberIds: ['c', 'd'] },
];

const noMarriedPair = {
    kind: Roles.RESTRICTIONS.NOT_SAME_GROUP,
    typeId: CROSS_MARRIAGE,
    roleSlugs: ['kids_leader', 'kids_helper'],
};

test('the solve never drafts a married couple into a paired Role', () => {
    // ⚠ THE FIXTURE IS THE TEST. A and B have never served, so fairness wants
    // them in both places more than it wants anybody else — without the rule
    // that is exactly what it does, which is what makes this measure the rule
    // rather than the solve's happening to pick somebody else.
    const people = [person('a'), person('b'), person('c')];
    const history = [
        serve('c', 'kids_leader', '2026-07-26'),
        serve('c', 'kids_helper', '2026-07-19'),
    ];

    const free = solveWith({
        roles: [LEADER, HELPER], people: people, history: history, groups: COUPLES,
    });
    const seatedIn = (r, slug) => r.filled.filter(s => s.roleSlug === slug)[0].personId;
    assert.deepStrictEqual(
        [seatedIn(free, 'kids_leader'), seatedIn(free, 'kids_helper')].sort(),
        ['a', 'b'],
        'the fixture no longer tempts the solve into the couple, so it proves nothing'
    );

    const bound = solveWith({
        roles: [LEADER, HELPER], people: people, history: history, groups: COUPLES,
        crossRoleRules: [noMarriedPair],
    });
    const pair = [seatedIn(bound, 'kids_leader'), seatedIn(bound, 'kids_helper')];
    assert.ok(pair.every(Boolean), 'a place went unfilled rather than differently filled');
    assert.ok(pair.indexOf('c') !== -1, 'the solve seated the married couple anyway');
});

test('what the solve drafts, the warnings pass agrees with', () => {
    // The pairing that keeps the two honest. A roster the solve produced must
    // never come back with a warning about the rule the solve was given.
    const result = solveWith({
        roles: [LEADER, HELPER],
        people: [person('a'), person('b'), person('c'), person('d')],
        groups: COUPLES,
        crossRoleRules: [noMarriedPair],
    });

    const warnings = Roles.warningsFor(result.filled, {
        roles: [LEADER, HELPER],
        people: [person('a'), person('b'), person('c'), person('d')],
        groups: COUPLES,
        crossRoleRules: [noMarriedPair],
    });

    assert.deepStrictEqual(warnings, [], 'the solve drafted a roster it then warns about');
});

test('with no rule given, the solve is free to seat a couple', () => {
    // Proves the test above is measuring the rule and not some other refusal.
    const result = solveWith({
        roles: [LEADER, HELPER],
        people: [person('a'), person('b')],
        groups: COUPLES,
    });
    assert.equal(result.filled.filter(s => s.personId).length, 2);
});
