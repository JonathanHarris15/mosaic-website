const { test } = require('node:test');
const assert = require('node:assert');

const Roles = require('../public/roles-core.js');
const Fairness = require('../public/fairness-core.js');

// MS-814. A Role with fewer people than places (five on an allowlist, six
// slots) can never be filled, and widening used to re-solve the date once per
// member of the church trying anyway: 20 seconds and more at 800 people, on
// the page's own thread. Counted in judge calls rather than milliseconds, so
// the test says the same thing on any machine.

const PAST = ['2026-10-25', '2026-10-18', '2026-10-11', '2026-10-04', '2026-09-27', '2026-09-20',
    '2026-09-13', '2026-09-06', '2026-08-30', '2026-08-23', '2026-08-16', '2026-08-09'];

function church(n) {
    return Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'p' + i, sex: 'male', tags: [], membership: {} }));
}

function solve(people, def) {
    let calls = 0;
    const result = Fairness.solve({
        seriesId: 's', date: '2026-11-01', roles: [def], people, history: [],
        occurrenceDates: PAST, windowSize: 12, intensityOf: () => 1,
        liturgicalSlugs: [], liturgicalHolders: [], relationships: [], groups: [],
        candidatesFor: (d, s, x) => { calls++; return Roles.candidatesFor(d, s, x); },
    });
    return { result, calls };
}

test('a Role with fewer people than places does not re-solve once per member (MS-814)', () => {
    const people = church(800);
    const def = {
        slug: 'communion', name: 'Communion', family: 'servant', intensity: 1,
        restrictions: [{ kind: 'allowlist', personIds: people.slice(795).map(p => p.id) }],
        slots: Array.from({ length: 6 }, (_, i) => ({ id: 's' + (i + 1), requirement: 'either' })),
    };
    const { result, calls } = solve(people, def);

    assert.equal(result.filled.length, 5, 'every one of the five should still be seated');
    assert.equal(result.unfilled.length, 1);
    assert.ok(calls < 2000, 'judged ' + calls + ' times; it used to be hundreds of thousands');
});

test('a Role whose rule nobody meets stops at once (MS-814)', () => {
    const people = church(1000);
    const def = {
        slug: 'readers', name: 'Readers', family: 'servant', intensity: 1,
        restrictions: [{ kind: 'requireTag', tagId: 'nobody-has-this' }],
        slots: [{ id: 's1', requirement: 'either' }, { id: 's2', requirement: 'either' }],
    };
    const { result, calls } = solve(people, def);

    assert.equal(result.filled.length, 0);
    assert.equal(result.unfilled.length, 2);
    assert.ok(result.unfilled[0].reason, 'the gap still names why');
    assert.ok(calls < 100, 'judged ' + calls + ' times');
});

test('widening still reaches the one person far down the ranking who can fill it (MS-814)', () => {
    // Everybody has served lately except the only person allowed, who has
    // served the most, so they sit last in load order.
    const people = church(300);
    const only = people[299].id;
    const history = [];
    PAST.forEach(date => history.push({ personId: only, roleSlug: 'other', date }));
    const def = {
        slug: 'sound', name: 'Sound', family: 'servant', intensity: 1,
        restrictions: [{ kind: 'allowlist', personIds: [only] }],
        slots: [{ id: 's1', requirement: 'either' }],
    };
    const result = Fairness.solve({
        seriesId: 's', date: '2026-11-01', roles: [def], people, history,
        occurrenceDates: PAST, windowSize: 12, intensityOf: () => 1,
        liturgicalSlugs: [], liturgicalHolders: [], relationships: [], groups: [],
        candidatesFor: Roles.candidatesFor,
    });
    assert.deepEqual(result.filled.map(s => s.personId), [only]);
});

test('group and relationship lookups agree with the plain scan (MS-814)', () => {
    const groups = [
        { id: 'g1', typeId: 'house', leaderId: 'a', memberIds: ['b', 'c'] },
        { id: 'g2', typeId: 'house', leaderId: 'd', memberIds: ['a'] },
        { id: 'g3', typeId: 'family', leaderId: null, memberIds: ['a', 'b'] },
    ];
    const index = Roles.groupIndex(groups);
    ['a', 'b', 'c', 'd', 'z'].forEach(p => ['house', 'family'].forEach(t => {
        assert.deepEqual(Roles.groupsFor(groups, t, p, index).map(g => g.id),
            Roles.groupsFor(groups, t, p).map(g => g.id), p + ' in ' + t);
    }));
});
