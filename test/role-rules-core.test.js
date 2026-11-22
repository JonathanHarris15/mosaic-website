const { test } = require('node:test');
const assert = require('node:assert');

const RoleRules = require('../public/role-rules-core.js');

// The Roles & rules table on an Event. Each Role row opens into three things:
//
//   Who can do it — each person on their own; any one option will do
//   The team      — the people on it together: line-up, at least n tagged…
//   What this allows — worked out, never typed: which line-ups can happen
//
// This module turns what is stored on the series into that form and back, and
// does the working-out. The page only draws it.

/** @param {*} extra */
const stored = extra => Object.assign({
    slug: 'helper',
    name: 'Kids Helper',
    slots: [{ id: 's1' }, { id: 's2' }],
    nextSlotSeq: 3,
    restrictions: [],
    intensity: 5,
    allowsAnotherRole: false,
}, extra || {});

/** @param {*} form */
const conds = form => form.who.options.map((/** @type {*} */ o) => o.conditions.map((/** @type {*} */ c) => c.kind));

// ── Reading what is stored ───────────────────────────────────────────────────

test('count, rest and "another role that day" come straight across', () => {
    const form = RoleRules.formFrom(stored());
    assert.equal(form.count, 2);
    assert.equal(form.intensity, 5);
    assert.equal(form.allowsAnotherRole, false);
    assert.deepEqual(form.who.options, []);
    assert.deepEqual(form.team, []);
});

test('only OR rules are read; the shapes from before ADR 0085 are not', () => {
    // Every series was copied into the OR shape on 2026-11-21, so a loose rule
    // or a sex on a seat can only be a leftover, and reading it back would
    // bring it to life again the next time somebody saves.
    const form = RoleRules.formFrom(stored({
        slots: [{ id: 's1', requirement: 'male' }, { id: 's2', requirement: 'male' }],
        restrictions: [{ kind: 'requireTag', tagId: 'cleared' }, { kind: 'notSameGroup', typeId: 'family' }],
    }));
    assert.deepEqual(form.who.options, []);
    assert.deepEqual(form.team, []);
});

test('stored OR rules come back as they were written', () => {
    const who = { kind: 'anyOf', scope: 'person', options: [
        { conditions: [{ kind: 'requireTag', tagId: 'member' }] },
        { conditions: [{ kind: 'requireTag', tagId: 'help' }] },
    ] };
    const team = { kind: 'anyOf', scope: 'team', strength: 'try', options: [
        { conditions: [{ kind: 'notSameGroup', typeId: 'family' }] },
    ] };
    const form = RoleRules.formFrom(stored({ restrictions: [who, team] }));
    assert.deepEqual(conds(form), [['requireTag'], ['requireTag']]);
    assert.equal(form.team[0].strength, 'try');
});

// ── Writing it back ─────────────────────────────────────────────────────────

test('settings keep the slot ids that exist and add new ones after them', () => {
    const form = RoleRules.formFrom(stored());
    form.count = 3;
    const settings = RoleRules.settingsFrom(form, stored());
    assert.deepEqual(settings.slots.map((/** @type {*} */ s) => s.id), ['s1', 's2', 's3']);
    assert.equal(settings.nextSlotSeq, 4);
    assert.ok(settings.slots.every((/** @type {*} */ s) => Object.keys(s).join() === 'id'), 'a seat is only its id');
});

test('fewer people drops the last seats, and ids are never reused', () => {
    const form = RoleRules.formFrom(stored());
    form.count = 1;
    const one = RoleRules.settingsFrom(form, stored());
    assert.deepEqual(one.slots.map((/** @type {*} */ s) => s.id), ['s1']);
    assert.equal(one.nextSlotSeq, 3);
});

test('who-can-do-it and the team are stored as OR rules, with no screen-only ids', () => {
    const form = RoleRules.formFrom(stored());
    form.who.options.push(RoleRules.newOption('who'));
    form.team.push(RoleRules.newRule('team', 2));
    const settings = RoleRules.settingsFrom(form, stored());
    assert.equal(settings.restrictions.length, 2);
    assert.equal(settings.restrictions[0].scope, 'person');
    assert.equal(settings.restrictions[1].scope, 'team');
    assert.equal(settings.restrictions[1].strength, 'must');
    assert.equal(JSON.stringify(settings).indexOf('"id":"c'), -1);
    assert.equal(JSON.stringify(settings.restrictions).indexOf('"id"'), -1);
});

test('round trip: what is written reads back the same', () => {
    const form = RoleRules.formFrom(stored({ restrictions: [
        { kind: 'anyOf', scope: 'person', options: [{ conditions: [{ kind: 'requireTag', tagId: 'x' }] }] },
    ] }));
    assert.deepEqual(conds(form), [['requireTag']]);
    const again = RoleRules.formFrom(Object.assign(stored(), RoleRules.settingsFrom(form, stored())));
    assert.deepEqual(conds(again), conds(form));
});

// ── Rules across Roles ───────────────────────────────────────────────────────

test('a pair rule from before OR rules is not read', () => {
    assert.deepEqual(RoleRules.crossFormsFrom([{ kind: 'notSameGroup', typeId: 'marriage', roleSlugs: ['a', 'b'] }]), []);
});

test('a stored OR rule across Roles reads back with its strength', () => {
    const forms = RoleRules.crossFormsFrom([{ kind: 'anyOf', strength: 'try', options: [
        { conditions: [{ kind: 'notSameGroup', typeId: 'marriage', roleSlugs: ['a', 'b'] }] },
    ] }]);
    assert.equal(forms[0].strength, 'try');
    assert.deepEqual(forms[0].options[0].conditions[0].roleSlugs, ['a', 'b']);
});

test('rules across Roles are stored as OR rules', () => {
    const forms = RoleRules.crossFormsFrom([]);
    forms.push(RoleRules.newRule('across', 1, 'helper'));
    const out = RoleRules.crossRulesFrom(forms);
    assert.equal(out[0].kind, 'anyOf');
    assert.equal(out[0].options[0].conditions[0].roleSlug, 'helper');
});

// ── What this allows ────────────────────────────────────────────────────────

/** @param {*} men @param {*} women */
const people = (men, women) => [
    ...Array.from({ length: men }, (_, i) => ({ id: 'm' + i, sex: 'male' })),
    ...Array.from({ length: women }, (_, i) => ({ id: 'w' + i, sex: 'female' })),
];
const lineupRule = (strength, ...options) => ({
    strength: strength,
    options: options.map((/** @type {*} */ sexes) => ({ conditions: [{ kind: 'lineup', sexes: sexes }] })),
});

test('no line-up rule allows every mix the people allow', () => {
    assert.deepEqual(RoleRules.makeups(2, people(5, 5), []), [{ men: 2, women: 0 }, { men: 1, women: 1 }, { men: 0, women: 2 }]);
});

test('a line-up rule narrows it to its options', () => {
    const rule = lineupRule('must', ['male', 'female'], ['male', 'male']);
    assert.deepEqual(RoleRules.makeups(2, people(5, 5), [rule]), [{ men: 2, women: 0 }, { men: 1, women: 1 }]);
});

test('a Try line-up does not narrow what is allowed', () => {
    const rule = lineupRule('try', ['female', 'female']);
    assert.equal(RoleRules.makeups(2, people(5, 5), [rule]).length, 3);
});

test('too few women who can do it rules a mix out', () => {
    assert.deepEqual(RoleRules.makeups(2, people(5, 1), []), [{ men: 2, women: 0 }, { men: 1, women: 1 }]);
});

test('across Roles: the combinations that meet every Must rule', () => {
    const roles = [
        { slug: 'helper', count: 2, makeups: RoleRules.makeups(2, people(5, 5), [lineupRule('must', ['male', 'female'], ['male', 'male'])]) },
        { slug: 'leader', count: 1, makeups: RoleRules.makeups(1, people(5, 5), []) },
    ];
    const rule = { strength: 'must', options: [
        { conditions: [{ kind: 'lineup', roleSlug: 'helper', sexes: ['female', 'male'] }, { kind: 'lineup', roleSlug: 'leader', sexes: ['male'] }] },
        { conditions: [{ kind: 'lineup', roleSlug: 'helper', sexes: ['male', 'male'] }, { kind: 'lineup', roleSlug: 'leader', sexes: ['female'] }] },
    ] };
    const combos = RoleRules.combos(roles, [rule]);
    assert.deepEqual(combos, [
        { helper: { men: 2, women: 0 }, leader: { men: 0, women: 1 } },
        { helper: { men: 1, women: 1 }, leader: { men: 1, women: 0 } },
    ]);
});

test('across Roles: rules that cannot all be met leave no combination', () => {
    const roles = [{ slug: 'leader', count: 1, makeups: [{ men: 1, women: 0 }] }];
    const rule = { strength: 'must', options: [{ conditions: [{ kind: 'lineup', roleSlug: 'leader', sexes: ['female'] }] }] };
    assert.deepEqual(RoleRules.combos(roles, [rule]), []);
});

// ── Reading a rule aloud ─────────────────────────────────────────────────────

test('a rule reads as a sentence, OR between options', () => {
    const names = { tag: id => ({ member: 'Member', help: 'Special help' })[id], role: s => s, type: t => t, person: p => p };
    const who = { options: [
        { conditions: [{ kind: 'requireTag', tagId: 'member' }] },
        { conditions: [{ kind: 'requireTag', tagId: 'help' }, { kind: 'sex', sex: 'female' }] },
    ] };
    assert.equal(RoleRules.sentence(who, 'who', names),
        'Each person is tagged Member, or (tagged Special help and a woman).');
    assert.equal(RoleRules.sentence(lineupRule('must', ['male', 'male', 'female']), 'team', names),
        '2 men and a woman.');
});
