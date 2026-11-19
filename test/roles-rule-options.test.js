const { test } = require('node:test');
const assert = require('node:assert');

const Roles = require('../public/roles-core.js');

// Rules that can say OR.
//
// A Role's rules all hold at once. A rule may now be a set of OPTIONS — any one
// will do — each option a set of conditions that must all hold:
//
//   { kind: 'anyOf', options: [{ conditions: [cond, cond] }, { conditions: [cond] }] }
//
// (An option is an object, not a bare list: Firestore cannot store a list
// directly inside a list.)
//
// Three things become sayable that were not:
//   • who may do it, with an OR:  tagged Member, OR tagged Special help
//   • the team's LINE-UP:         a man and a woman, OR two men
//   • line-ups across Roles:      (Helper is W+M and Leader is M) OR
//                                 (Helper is M+M and Leader is W)
//
// A line-up is UNORDERED: it says how many men, how many women and how many of
// either, never which seat. A seat-by-seat requirement still works as before.

const person = (id, sex, tags) => ({ id: id, name: id, sex: sex, tags: tags || [] });
const ann = person('ann', 'female', ['member']);
const bea = person('bea', 'female', ['special-help']);
const cal = person('cal', 'male', ['member']);
const dev = person('dev', 'male', []);
const eli = person('eli', 'male', ['member']);
const PEOPLE = [ann, bea, cal, dev, eli];

const opt = (...conditions) => ({ conditions: conditions });
const either = id => ({ id: id, requirement: 'either' });
const role = (slug, count, restrictions) => ({
    slug: slug,
    name: slug,
    family: Roles.FAMILIES.SERVANT,
    slots: Array.from({ length: count }, (_, i) => either('s' + (i + 1))),
    restrictions: restrictions || [],
});

const eligible = (def, slot, context) => Roles.candidatesFor(def, slot, Object.assign({ people: PEOPLE }, context))
    .filter(r => r.eligible).map(r => r.personId);

// ── Who may do it, with an OR ────────────────────────────────────────────────

test('a person passes if they match ANY option', () => {
    const def = role('welcome', 1, [{ kind: 'anyOf', options: [
        opt({ kind: 'requireTag', tagId: 'member' }),
        opt({ kind: 'requireTag', tagId: 'special-help' }),
    ] }]);
    assert.deepEqual(eligible(def, def.slots[0]), ['ann', 'bea', 'cal', 'eli']);
});

test('inside one option every condition must hold', () => {
    const def = role('welcome', 1, [{ kind: 'anyOf', options: [
        opt({ kind: 'requireTag', tagId: 'member' }, { kind: 'sex', sex: 'male' }),
        opt({ kind: 'requireTag', tagId: 'special-help' }),
    ] }]);
    assert.deepEqual(eligible(def, def.slots[0]), ['bea', 'cal', 'eli']);
});

test('a single-option rule refuses with the plain reason, as before', () => {
    const def = role('kids', 1, [{ kind: 'anyOf', options: [opt({ kind: 'requireTag', tagId: 'member' })] }]);
    const dev_ = Roles.candidatesFor(def, def.slots[0], { people: [dev] })[0];
    assert.equal(dev_.reason, Roles.REASONS.MISSING_REQUIRED_TAG);
});

test('failing every one of several options says so', () => {
    const def = role('welcome', 1, [{ kind: 'anyOf', options: [
        opt({ kind: 'requireTag', tagId: 'member' }),
        opt({ kind: 'requireTag', tagId: 'special-help' }),
    ] }]);
    const dev_ = Roles.candidatesFor(def, def.slots[0], { people: [dev] })[0];
    assert.equal(dev_.reason, Roles.REASONS.NO_OPTION_FITS);
});

// ── Line-ups ─────────────────────────────────────────────────────────────────

const lineups = (...options) => ({ kind: 'anyOf', options: options.map(sexes => opt({ kind: 'lineup', sexes: sexes })) });

test('a line-up of a man and a woman: the first seat may be either', () => {
    const def = role('helpers', 2, [lineups(['male', 'female'])]);
    assert.deepEqual(eligible(def, def.slots[0]), ['ann', 'bea', 'cal', 'dev', 'eli']);
});

test('a line-up of a man and a woman: with a woman seated, only men', () => {
    const def = role('helpers', 2, [lineups(['male', 'female'])]);
    const result = eligible(def, def.slots[1], { assigned: [{ slotId: 's1', personId: 'ann' }] });
    assert.deepEqual(result, ['cal', 'dev', 'eli']);
});

test('M+W or M+M: with a man seated, anyone; with a woman seated, only men', () => {
    const def = role('helpers', 2, [lineups(['male', 'female'], ['male', 'male'])]);
    assert.deepEqual(
        eligible(def, def.slots[1], { assigned: [{ slotId: 's1', personId: 'cal' }] }),
        ['ann', 'bea', 'dev', 'eli']
    );
    assert.deepEqual(
        eligible(def, def.slots[1], { assigned: [{ slotId: 's1', personId: 'ann' }] }),
        ['cal', 'dev', 'eli']
    );
});

test('3 men and a woman, or 3 women and a man: a second woman closes off the first', () => {
    const def = role('welcome', 4, [lineups(['male', 'male', 'male', 'female'], ['female', 'female', 'female', 'male'])]);
    const seated = [{ slotId: 's1', personId: 'ann' }, { slotId: 's2', personId: 'bea' }];
    // Two women in: only the 3-women option is left, so a third woman or one man.
    const result = Roles.candidatesFor(def, def.slots[2], { people: PEOPLE, assigned: seated });
    assert.deepEqual(result.filter(r => r.eligible).map(r => r.personId), ['cal', 'dev', 'eli']);
    const ann2 = person('ann2', 'female');
    const withAnn2 = Roles.candidatesFor(def, def.slots[2], { people: [ann2], assigned: seated });
    assert.equal(withAnn2[0].eligible, true);
});

test('an "either" mark takes anybody, a recorded sex or not', () => {
    const def = role('setup', 2, [lineups(['male', 'either'])]);
    const nobody = person('nobody', undefined);
    const results = Roles.candidatesFor(def, def.slots[1], {
        people: [ann, nobody], assigned: [{ slotId: 's1', personId: 'cal' }],
    });
    assert.deepEqual(results.map(r => r.eligible), [true, true]);
});

test('somebody with no recorded sex cannot take a man’s or woman’s mark', () => {
    const def = role('helpers', 2, [lineups(['male', 'female'])]);
    const nobody = person('nobody', undefined);
    const r = Roles.candidatesFor(def, def.slots[0], { people: [nobody] })[0];
    assert.equal(r.eligible, false);
    assert.equal(r.reason, Roles.REASONS.LINEUP_MISMATCH);
});

test('a line-up refusal says it is the line-up', () => {
    const def = role('helpers', 2, [lineups(['male', 'female'])]);
    const r = Roles.candidatesFor(def, def.slots[1], { people: [bea, ann], assigned: [{ slotId: 's1', personId: 'ann' }] })[0];
    assert.equal(r.reason, Roles.REASONS.LINEUP_MISMATCH);
});

test('judging one person at a time, the team comes in as knownPeople', () => {
    // Cover, Trade and a member's own take narrow `people` to the one person
    // asking. Without the team handed in separately the line-up cannot see who
    // is already on it, and would let a second woman in.
    const def = role('helpers', 2, [lineups(['male', 'female'])]);
    const r = Roles.candidatesFor(def, def.slots[1], {
        people: [bea], knownPeople: [ann], assigned: [{ slotId: 's1', personId: 'ann' }],
    })[0];
    assert.equal(r.reason, Roles.REASONS.LINEUP_MISMATCH);
});

test('somebody the context does not know is left out of the count, not guessed at', () => {
    const def = role('helpers', 2, [lineups(['male', 'female'])]);
    const r = Roles.candidatesFor(def, def.slots[1], { people: [bea], assigned: [{ slotId: 's1', personId: 'ann' }] })[0];
    assert.equal(r.eligible, true);
});

test('judgesLineups finds a line-up, inside an option or on its own', () => {
    assert.equal(Roles.judgesLineups([lineups(['male'])]), true);
    assert.equal(Roles.judgesLineups([{ kind: 'lineup', sexes: ['male'] }]), true);
    assert.equal(Roles.judgesLineups([{ kind: 'requireTag', tagId: 'x' }]), false);
});

// ── Line-ups across Roles ────────────────────────────────────────────────────

// (Helper is W+M and Leader is M) OR (Helper is M+M and Leader is W)
const kidsRule = {
    kind: 'anyOf',
    options: [
        opt({ kind: 'lineup', roleSlug: 'helper', sexes: ['female', 'male'] }, { kind: 'lineup', roleSlug: 'leader', sexes: ['male'] }),
        opt({ kind: 'lineup', roleSlug: 'helper', sexes: ['male', 'male'] }, { kind: 'lineup', roleSlug: 'leader', sexes: ['female'] }),
    ],
};
const helper = role('helper', 2);
const leader = role('leader', 1);

test('across Roles: with a woman leading, the helpers must be two men', () => {
    const result = eligible(helper, helper.slots[0], {
        crossRoleRules: [kidsRule],
        assignedElsewhere: [{ personId: 'ann', roleSlug: 'leader', allowsAnotherRole: false }],
    });
    assert.deepEqual(result, ['cal', 'dev', 'eli']);
});

test('across Roles: with a man leading, the helpers are a woman and a man', () => {
    const results = Roles.candidatesFor(helper, helper.slots[1], {
        people: PEOPLE,
        crossRoleRules: [kidsRule],
        assigned: [{ slotId: 's1', personId: 'dev' }],
        assignedElsewhere: [{ personId: 'cal', roleSlug: 'leader', allowsAnotherRole: false }],
    });
    assert.deepEqual(results.filter(r => r.eligible).map(r => r.personId), ['ann', 'bea']);
    assert.equal(results.find(r => r.personId === 'eli').reason, Roles.REASONS.LINEUP_MISMATCH);
});

test('across Roles: two men helping means only a woman may lead', () => {
    const result = eligible(leader, leader.slots[0], {
        crossRoleRules: [kidsRule],
        assignedElsewhere: [
            { personId: 'cal', roleSlug: 'helper', allowsAnotherRole: false },
            { personId: 'dev', roleSlug: 'helper', allowsAnotherRole: false },
        ],
    });
    assert.deepEqual(result, ['ann', 'bea']);
});

test('across Roles: a rule that does not name this Role is not its business', () => {
    const coffee = role('coffee', 1);
    assert.deepEqual(eligible(coffee, coffee.slots[0], { crossRoleRules: [kidsRule] }), ['ann', 'bea', 'cal', 'dev', 'eli']);
});

test('across Roles: an option may mix a line-up with a group rule', () => {
    const groups = [{ id: 'g1', typeId: 'marriage', memberIds: ['ann', 'cal'] }];
    const rule = { kind: 'anyOf', options: [
        opt({ kind: 'notSameGroup', typeId: 'marriage', roleSlugs: ['helper', 'leader'] }),
    ] };
    const result = eligible(helper, helper.slots[0], {
        crossRoleRules: [rule],
        groups: groups,
        assignedElsewhere: [{ personId: 'cal', roleSlug: 'leader', allowsAnotherRole: false }],
    });
    assert.deepEqual(result, ['bea', 'dev', 'eli']);
});

// ── Validation ───────────────────────────────────────────────────────────────

test('an anyOf with no options, or an empty option, is refused', () => {
    assert.equal(Roles.validateRestriction({ kind: 'anyOf', options: [] }).valid, false);
    assert.equal(Roles.validateRestriction({ kind: 'anyOf', options: [opt()] }).valid, false);
});

test('a line-up must have the same number of people as the Role needs', () => {
    const result = Roles.validateRestriction(lineups(['male', 'female', 'male']), [], { count: 2 });
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /3 people.*needs 2/);
});

test('a line-up mark is a man, a woman or either', () => {
    assert.equal(Roles.validateRestriction(lineups(['male', 'child'])).valid, false);
    assert.equal(Roles.validateRestriction(lineups(['male', 'either'])).valid, true);
});

test('the conditions inside an option are checked like rules of their own', () => {
    const bad = { kind: 'anyOf', options: [opt({ kind: 'requireTag' })] };
    assert.match(Roles.validateRestriction(bad).errors.join(' '), /needs a Tag/);
});

// ── At least n tagged ────────────────────────────────────────────────────────

test('at least one first-aider: open until the last seat, then only first-aiders', () => {
    const medic = person('medic', 'female', ['first-aid']);
    const def = role('welcome', 2, [{ kind: 'atLeastTagged', tagId: 'first-aid', atLeast: 1 }]);
    const all = [ann, cal, medic];
    assert.deepEqual(
        Roles.candidatesFor(def, def.slots[0], { people: all }).filter(r => r.eligible).map(r => r.personId),
        ['ann', 'cal', 'medic']
    );
    const last = Roles.candidatesFor(def, def.slots[1], { people: all, assigned: [{ slotId: 's1', personId: 'ann' }] });
    assert.deepEqual(last.filter(r => r.eligible).map(r => r.personId), ['medic']);
    assert.equal(last.find(r => r.personId === 'cal').reason, Roles.REASONS.TOO_FEW_TAGGED);
});
