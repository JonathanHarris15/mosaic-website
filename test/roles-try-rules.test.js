const { test } = require('node:test');
const assert = require('node:assert');

const Roles = require('../public/roles-core.js');
const Fairness = require('../public/fairness-core.js');

// Must, or Try to.
//
// A rule is MUST unless it says otherwise: nobody is offered a place it refuses,
// the solve never breaks it, and an editor who breaks it by hand is warned.
//
// A TRY TO rule is a preference. It refuses nobody and warns nobody. The solve
// fills every place it can first, and among fillings that fill as many places it
// picks the one that breaks the fewest Try rules — and only then the fairest.
// "Try not to put two from one family on Welcome" must never leave the door
// unmanned when the only people left are a married couple.

const person = (id, sex, tags) => ({ id: id, name: id, sex: sex, tags: tags || [] });
const ann = person('ann', 'female', ['first-aid']);
const bob = person('bob', 'male');
const cat = person('cat', 'female');
const PEOPLE = [ann, bob, cat];

const slot = id => ({ id: id, requirement: 'either' });
const role = (restrictions, count) => ({
    slug: 'welcome',
    name: 'Welcome',
    family: Roles.FAMILIES.SERVANT,
    slots: Array.from({ length: count || 1 }, (_, i) => slot('s' + (i + 1))),
    restrictions: restrictions,
    intensity: 1,
});

const tryTag = { kind: 'requireTag', tagId: 'first-aid', strength: 'try' };

test('a Try rule refuses nobody', () => {
    const def = role([tryTag]);
    const results = Roles.candidatesFor(def, def.slots[0], { people: PEOPLE });
    assert.deepEqual(results.map(r => r.eligible), [true, true, true]);
});

test('each eligible person says how many Try rules they would break', () => {
    const def = role([tryTag]);
    const results = Roles.candidatesFor(def, def.slots[0], { people: PEOPLE });
    assert.deepEqual(results.map(r => r.misses), [0, 1, 1]);
});

test('a Must rule still refuses, exactly as before', () => {
    const def = role([{ kind: 'requireTag', tagId: 'first-aid' }]);
    const results = Roles.candidatesFor(def, def.slots[0], { people: PEOPLE });
    assert.deepEqual(results.map(r => r.eligible), [true, false, false]);
});

test('a Try rule leaves no warning on a finished roster', () => {
    const def = role([tryTag]);
    const warnings = Roles.warningsFor(
        [{ roleSlug: 'welcome', slotId: 's1', personId: 'bob' }],
        { roles: [def], people: PEOPLE }
    );
    assert.deepEqual(warnings, []);
});

test('a Try line-up across Roles refuses nobody either', () => {
    const def = role([], 1);
    const rule = { kind: 'anyOf', strength: 'try', options: [{ conditions: [{ kind: 'lineup', roleSlug: 'welcome', sexes: ['female'] }] }] };
    const results = Roles.candidatesFor(def, def.slots[0], { people: PEOPLE, crossRoleRules: [rule] });
    assert.deepEqual(results.map(r => [r.eligible, r.misses]), [[true, 0], [true, 1], [true, 0]]);
});

// ── The solve ───────────────────────────────────────────────────────────────

const solve = def => Fairness.solve({
    seriesId: 'sunday_service',
    date: '2026-08-02',
    roles: [def],
    people: PEOPLE,
    history: [],
    occurrenceDates: ['2026-07-26'],
    windowSize: 12,
    intensityOf: () => 1,
    liturgicalSlugs: Roles.LITURGICAL_SLUGS,
    liturgicalHolders: [],
    relationships: [],
    groups: [],
    candidatesFor: Roles.candidatesFor,
});

test('the solve prefers somebody who keeps a Try rule over a fairer pick who breaks it', () => {
    // Nobody has served, so fairness alone would pick by tie-break; the Try rule
    // must outrank that.
    const result = solve(role([tryTag], 1));
    assert.deepEqual(result.filled.map(f => f.personId), ['ann']);
});

test('the solve still fills the place when nobody can keep the Try rule', () => {
    const result = solve(role([{ kind: 'requireTag', tagId: 'nobody-has-this', strength: 'try' }], 1));
    assert.equal(result.filled.length, 1);
    assert.equal(result.unfilled.length, 0);
});

test('a Try line-up shapes the solve: two women preferred, not required', () => {
    const def = role([{ kind: 'anyOf', strength: 'try', options: [{ conditions: [{ kind: 'lineup', sexes: ['female', 'female'] }] }] }], 2);
    const result = solve(def);
    assert.deepEqual(result.filled.map(f => f.personId).sort(), ['ann', 'cat']);
});
