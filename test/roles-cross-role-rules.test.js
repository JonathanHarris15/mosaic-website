const { test } = require('node:test');
const assert = require('node:assert');

const Roles = require('../public/roles-core.js');

// Cross-Role Rules (MS-221).
//
// Every restriction before this one is a rule a Role makes about ITSELF. The
// Children's Ministry Leader and the Children's Ministry Helper are two Roles,
// and a married couple must not hold one each — which neither Role can say,
// because neither is the thing being constrained. The pair is.
//
// So the rule belongs to the Event that runs both Roles, and is judged in the
// one place that decides whether a person may fill a slot. Everything that asks
// — the picker, the roster judge, auto-assign, Cover, Trade — reaches that
// function, and a rule any one of them did not know would be a rule you could
// walk round.

const person = (id, extra) => Object.assign({ id, name: id, tags: [], sex: 'female' }, extra);

const adam = person('adam', { sex: 'male' });
const eve = person('eve');
const noah = person('noah', { sex: 'male' });
const ruth = person('ruth');

const MARRIAGE = 'type-marriage';
const HOUSE = 'type-house';

// A marriage is a group of two, the way the Membership Directory projects it.
const adamAndEve = { id: 'm1', typeId: MARRIAGE, name: 'Adam & Eve', leaderId: null, memberIds: ['adam', 'eve'] };
const noahAndRuth = { id: 'm2', typeId: MARRIAGE, name: 'Noah & Ruth', leaderId: null, memberIds: ['noah', 'ruth'] };
const north = { id: 'g1', typeId: HOUSE, name: 'North', leaderId: null, memberIds: ['adam', 'eve', 'noah'] };

const GROUPS = [adamAndEve, noahAndRuth, north];

const LEADER = 'kids_leader';
const HELPER = 'kids_helper';

const slot = { id: 's1', requirement: Roles.REQUIREMENTS.EITHER };

// ⚠ `allowsAnotherRole` on purpose. Exclusivity (ADR-0020) would otherwise
// refuse anybody already holding the paired Role, and every test below would
// pass for a reason that has nothing to do with the rule under test.
const role = (slug, name) => ({
    id: slug, slug, name, family: Roles.FAMILIES.SERVANT,
    slots: [slot], restrictions: [], allowsAnotherRole: true,
});

const leader = role(LEADER, 'Kids Leader');
const helper = role(HELPER, 'Kids Helper');

const notSameMarriage = {
    kind: Roles.RESTRICTIONS.NOT_SAME_GROUP,
    typeId: MARRIAGE,
    roleSlugs: [LEADER, HELPER],
};

const sameHouse = {
    kind: Roles.RESTRICTIONS.SAME_GROUP,
    typeId: HOUSE,
    roleSlugs: [LEADER, HELPER],
};

// Judge candidates for the Helper slot, with `holding` already in other Roles.
const judgeHelper = (holding, rules) => Roles.candidatesFor(helper, slot, {
    people: [adam, eve, noah, ruth],
    groups: GROUPS,
    assigned: [],
    assignedElsewhere: holding,
    crossRoleRules: rules,
});

const eligibleIds = results => results.filter(r => r.eligible).map(r => r.personId);
const resultFor = (results, id) => results.find(r => r.personId === id);

// ── The rule the feature exists for ──────────────────────────────────────────

test('a spouse cannot take the paired Role when their husband is already leading', () => {
    const results = judgeHelper(
        [{ personId: 'adam', roleSlug: LEADER, allowsAnotherRole: true }],
        [notSameMarriage]
    );

    assert.deepStrictEqual(eligibleIds(results), ['adam', 'noah', 'ruth'],
        'only Eve is refused, and only because she is married to the leader');
    assert.equal(resultFor(results, 'eve').reason, Roles.REASONS.PAIRED_ROLE_CONFLICT);
});

test('a person is not their own spouse — holding both Roles is exclusivity\'s call, not this rule\'s', () => {
    // Adam leading AND helping breaks no marriage rule. Whether one person may
    // hold two Roles is ADR-0020's question, and it is asked separately.
    const results = judgeHelper(
        [{ personId: 'adam', roleSlug: LEADER, allowsAnotherRole: true }],
        [notSameMarriage]
    );
    assert.equal(resultFor(results, 'adam').eligible, true);
});

test('the refusal names the other Role and the person in it', () => {
    // "Not available" sends the editor hunting across a rota for somebody they
    // have never been told about.
    const blocked = resultFor(judgeHelper(
        [{ personId: 'adam', roleSlug: LEADER, allowsAnotherRole: true }],
        [notSameMarriage]
    ), 'eve');

    assert.equal(blocked.pairedRoleSlug, LEADER);
    assert.equal(blocked.conflictsWith, 'adam');
    assert.equal(blocked.groupName, 'Adam & Eve');
    assert.equal(blocked.typeId, MARRIAGE);
});

test('nobody in the paired Role yet means nobody is constrained', () => {
    const results = judgeHelper([], [notSameMarriage]);
    assert.deepStrictEqual(eligibleIds(results), ['adam', 'eve', 'noah', 'ruth']);
});

test('somebody in a THIRD Role is not the pair, and does not constrain anyone', () => {
    const results = judgeHelper(
        [{ personId: 'adam', roleSlug: 'coffee', allowsAnotherRole: true }],
        [notSameMarriage]
    );
    assert.deepStrictEqual(eligibleIds(results), ['adam', 'eve', 'noah', 'ruth']);
});

test('the rule reads both ways round — it is a pair, not an order', () => {
    // Written [leader, helper], but filling the LEADER while the helper is
    // seated has to be refused the same way, or the rule depends on which
    // column the editor happened to fill first.
    const results = Roles.candidatesFor(leader, slot, {
        people: [adam, eve, noah, ruth],
        groups: GROUPS,
        assigned: [],
        assignedElsewhere: [{ personId: 'eve', roleSlug: HELPER, allowsAnotherRole: true }],
        crossRoleRules: [notSameMarriage],
    });

    assert.equal(resultFor(results, 'adam').reason, Roles.REASONS.PAIRED_ROLE_CONFLICT);
    assert.deepStrictEqual(eligibleIds(results), ['eve', 'noah', 'ruth']);
});

// ── The cohesive half ────────────────────────────────────────────────────────

test('must-be-in-the-same refuses anyone who shares no group with the paired Role', () => {
    const results = judgeHelper(
        [{ personId: 'adam', roleSlug: LEADER, allowsAnotherRole: true }],
        [sameHouse]
    );

    // Adam, Eve and Noah are all North; Ruth is in no house group.
    assert.deepStrictEqual(eligibleIds(results), ['adam', 'eve', 'noah']);
    assert.equal(resultFor(results, 'ruth').reason, Roles.REASONS.NOT_IN_PAIRED_GROUP);
});

test('must-be-in-the-same is satisfied by ONE group covering everyone in the paired Role', () => {
    // Two people hold the paired Role. A candidate needs a single group holding
    // both of them, not a different group per person.
    const results = judgeHelper([
        { personId: 'adam', roleSlug: LEADER, allowsAnotherRole: true },
        { personId: 'ruth', roleSlug: LEADER, allowsAnotherRole: true },
    ], [sameHouse]);

    assert.deepStrictEqual(eligibleIds(results), [], 'no group holds both Adam and Ruth');
});

// ── Rules that must not fire ─────────────────────────────────────────────────

test('a rule naming one Role twice is ignored, not judged against itself', () => {
    // That rule is already sayable on the Role itself. Honouring it here too
    // would mean two places to look for why somebody was refused.
    const results = judgeHelper(
        [{ personId: 'adam', roleSlug: HELPER, allowsAnotherRole: true }],
        [{ kind: Roles.RESTRICTIONS.NOT_SAME_GROUP, typeId: MARRIAGE, roleSlugs: [HELPER, HELPER] }]
    );
    assert.deepStrictEqual(eligibleIds(results), ['adam', 'eve', 'noah', 'ruth']);
});

test('a rule naming neither of the Roles being filled does nothing', () => {
    const results = judgeHelper(
        [{ personId: 'adam', roleSlug: LEADER, allowsAnotherRole: true }],
        [{ kind: Roles.RESTRICTIONS.NOT_SAME_GROUP, typeId: MARRIAGE, roleSlugs: ['coffee', 'setup'] }]
    );
    assert.deepStrictEqual(eligibleIds(results), ['adam', 'eve', 'noah', 'ruth']);
});

test('an unknown rule kind is skipped, never a blanket refusal', () => {
    // A typo in the config must not empty a rota.
    const results = judgeHelper(
        [{ personId: 'adam', roleSlug: LEADER, allowsAnotherRole: true }],
        [{ kind: 'notMarriedToEachOther', typeId: MARRIAGE, roleSlugs: [LEADER, HELPER] }]
    );
    assert.deepStrictEqual(eligibleIds(results), ['adam', 'eve', 'noah', 'ruth']);
});

test('no cross-Role rules at all changes nothing', () => {
    assert.deepStrictEqual(
        eligibleIds(judgeHelper([{ personId: 'adam', roleSlug: LEADER, allowsAnotherRole: true }], [])),
        ['adam', 'eve', 'noah', 'ruth']
    );
    assert.deepStrictEqual(
        eligibleIds(judgeHelper([{ personId: 'adam', roleSlug: LEADER, allowsAnotherRole: true }], undefined)),
        ['adam', 'eve', 'noah', 'ruth']
    );
});

// ── The roster judge asks the same question ──────────────────────────────────
//
// ⚠ candidatesFor says "may I seat this person NEXT"; warningsFor says "is this
// roster, as it stands, legal". A rota can be drafted legally and break later —
// somebody marries. If the two ever disagree, one of them is lying.

test('a roster that breaks a cross-Role rule warns, however it got that way', () => {
    const warnings = Roles.warningsFor([
        { roleSlug: LEADER, slotId: 's1', personId: 'adam' },
        { roleSlug: HELPER, slotId: 's1', personId: 'eve' },
    ], {
        roles: [leader, helper],
        people: [adam, eve],
        groups: GROUPS,
        crossRoleRules: [notSameMarriage],
    });

    assert.equal(warnings.length, 2, 'both halves of the pair are wrong, and both are said');
    warnings.forEach(w => assert.equal(w.reason, Roles.REASONS.PAIRED_ROLE_CONFLICT));
    assert.deepStrictEqual(warnings.map(w => w.roleSlug).sort(), [HELPER, LEADER]);
});

test('a legal roster warns about nothing', () => {
    const warnings = Roles.warningsFor([
        { roleSlug: LEADER, slotId: 's1', personId: 'adam' },
        { roleSlug: HELPER, slotId: 's1', personId: 'ruth' },
    ], {
        roles: [leader, helper],
        people: [adam, ruth],
        groups: GROUPS,
        crossRoleRules: [notSameMarriage],
    });

    assert.deepStrictEqual(warnings, []);
});

test('the picker and the roster judge agree about the same pair of seats', () => {
    // The pairing that keeps the two honest. Whatever the picker refuses, a
    // roster holding it must warn about, and the reverse.
    const seated = [{ personId: 'adam', roleSlug: LEADER, allowsAnotherRole: true }];
    const refused = resultFor(judgeHelper(seated, [notSameMarriage]), 'eve');

    const warned = Roles.warningsFor([
        { roleSlug: LEADER, slotId: 's1', personId: 'adam' },
        { roleSlug: HELPER, slotId: 's1', personId: 'eve' },
    ], {
        roles: [leader, helper], people: [adam, eve], groups: GROUPS,
        crossRoleRules: [notSameMarriage],
    }).find(w => w.roleSlug === HELPER);

    assert.equal(refused.eligible, false);
    assert.equal(warned.reason, refused.reason);
    assert.equal(warned.conflictsWith, refused.conflictsWith);
    assert.equal(warned.pairedRoleSlug, refused.pairedRoleSlug);
});

// ── Validation, before a rule is ever stored ─────────────────────────────────

const TYPES = [
    { id: MARRIAGE, name: 'Marriage', kind: 'group', sharedWithEditors: true },
    { id: HOUSE, name: 'House Group', kind: 'group', sharedWithEditors: true },
    { id: 'type-mentor', name: 'Mentoring', kind: 'pairwise', sharedWithEditors: true },
    { id: 'type-secret', name: 'Care', kind: 'group', sharedWithEditors: false },
];
const SLUGS = [LEADER, HELPER, 'coffee'];

const check = rule => Roles.validateCrossRoleRule(rule, TYPES, SLUGS);

test('a well-formed rule passes', () => {
    assert.equal(check(notSameMarriage).valid, true);
    assert.equal(check(sameHouse).valid, true);
});

test('a rule needs two DIFFERENT Roles', () => {
    assert.equal(check({ ...notSameMarriage, roleSlugs: [LEADER] }).valid, false);
    const same = check({ ...notSameMarriage, roleSlugs: [LEADER, LEADER] });
    assert.equal(same.valid, false);
    assert.match(same.errors.join(' '), /same Role/i);
});

test('a rule may only name Roles this event actually runs', () => {
    const bad = check({ ...notSameMarriage, roleSlugs: [LEADER, 'setup'] });
    assert.equal(bad.valid, false);
    assert.match(bad.errors.join(' '), /not one of this event/i);
});

test('a rule may not use a Type an elder has not shared', () => {
    assert.equal(check({ ...notSameMarriage, typeId: 'type-secret' }).valid, false);
});

test('a rule may not use a pairwise Type as a group rule', () => {
    const bad = check({ ...notSameMarriage, typeId: 'type-mentor' });
    assert.equal(bad.valid, false);
    assert.match(bad.errors.join(' '), /connects two people/i);
});

test('only the two group kinds are cross-Role rules', () => {
    assert.equal(check({ ...notSameMarriage, kind: Roles.RESTRICTIONS.NOT_TOGETHER }).valid, false);
    assert.equal(check({ ...notSameMarriage, kind: Roles.RESTRICTIONS.ALLOWLIST }).valid, false);
    assert.equal(check({}).valid, false);
});

// ── Where a rule lives ───────────────────────────────────────────────────────
//
// On the Event that runs both Roles — the only place that knows they run
// together. EventsCore arranges them; it never judges one.

const Events = require('../public/events-core.js');

const series = () => Events.newSeries({
    id: 'sunday_service', name: 'Sunday Service', roleSlugs: [LEADER, HELPER, 'coffee'],
});

test('a series with no rules reads as none, never as undefined', () => {
    assert.deepStrictEqual(Events.crossRoleRulesOf(series()), []);
    assert.deepStrictEqual(Events.crossRoleRulesOf(null), []);
    assert.deepStrictEqual(Events.crossRoleRulesOf({ crossRoleRules: 'nonsense' }), []);
});

test('a rule is added to the series and the input is left alone', () => {
    const before = series();
    const after = Events.addCrossRoleRule(before, notSameMarriage);

    assert.deepStrictEqual(Events.crossRoleRulesOf(after), [notSameMarriage]);
    assert.deepStrictEqual(Events.crossRoleRulesOf(before), [], 'the original series changed');
});

test('a rule can be removed by position', () => {
    let s = Events.addCrossRoleRule(series(), notSameMarriage);
    s = Events.addCrossRoleRule(s, sameHouse);
    assert.deepStrictEqual(Events.crossRoleRulesOf(Events.removeCrossRoleRule(s, 0)), [sameHouse]);
});

test('dropping a Role from the Event drops the rules that named it', () => {
    // ⚠ A rule about a Role that is no longer here can never fire, and one left
    // lying about is worse than absent: put the Role back a year later and a
    // rule nobody remembers writing starts refusing people.
    let s = Events.addCrossRoleRule(series(), notSameMarriage);
    s = Events.addCrossRoleRule(s, {
        kind: Roles.RESTRICTIONS.NOT_SAME_GROUP, typeId: MARRIAGE, roleSlugs: ['coffee', HELPER],
    });

    const after = Events.removeRole(s, LEADER);
    assert.deepStrictEqual(Events.crossRoleRulesOf(after).map(r => r.roleSlugs), [['coffee', HELPER]]);
    assert.deepStrictEqual(after.roleSlugs, [HELPER, 'coffee']);
});

// ── The words somebody actually reads ────────────────────────────────────────

const View = require('../public/calendar-view.js');

test('a cross-Role refusal names the OTHER Role, not just the clash', () => {
    // Every other reason is about THIS Role. An editor reading "in the same
    // household as Dave" would look down this Role's list and not find him,
    // which is the hunt that showing blocked people exists to avoid.
    const words = View.blockReason({
        eligible: false,
        reason: Roles.REASONS.PAIRED_ROLE_CONFLICT,
        conflictsWith: 'adam',
        groupName: 'Adam & Eve',
    }, {
        people: [{ id: 'adam', name: 'Adam Smith' }],
        pairedRoleName: 'Kids Leader',
    });

    assert.match(words, /Adam Smith/);
    assert.match(words, /Adam & Eve/);
    assert.match(words, /Kids Leader/);
});

test('the cohesive half reads as what is missing, not as a bare refusal', () => {
    const words = View.blockReason({
        eligible: false,
        reason: Roles.REASONS.NOT_IN_PAIRED_GROUP,
    }, { people: [], groupName: 'House Group', pairedRoleName: 'Kids Leader' });

    assert.match(words, /House Group/);
    assert.match(words, /Kids Leader/);
});

test('every reason the model can give has words for it', () => {
    // ⚠ A reason with no sentence renders as an empty refusal — blocked, with
    // no explanation. Adding one to REASONS without adding words here is the
    // easy half of the mistake, so the whole list is walked.
    const spoken = Object.keys(Roles.REASONS).map(key => Roles.REASONS[key]);
    const silent = spoken.filter(reason => !View.blockReason(
        { eligible: false, reason: reason, conflictsWith: 'adam' },
        { people: [{ id: 'adam', name: 'Adam Smith' }] }
    ));
    assert.deepStrictEqual(silent, [], 'these reasons block somebody and say nothing');
});

// ── The page that authors them ───────────────────────────────────────────────
//
// Pinned as SHAPE, the way the other page-markup tests here do it: the
// authoring controls are Alpine bindings against a real page, and what can be
// checked without a browser is that each one is bound to something that exists.

const fs = require('node:fs');
const path = require('node:path');

const PAGE_JS = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'recurring-events.js'), 'utf8');
const PAGE_HTML = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'recurring-events.html'), 'utf8');

test('every control the rules panel binds to exists on the page', () => {
    const bound = [
        'pairRules', 'pairRuleSentence', 'pairRuleAvailable', 'pairRuleErrors',
        'pairRoleOptions', 'pairTypeOptions', 'addPairRule', 'removePairRule',
        'newPairKind', 'newPairTypeId', 'newPairRoleA', 'newPairRoleB',
        'savingPairRule', 'groupTypesDenied',
    ];
    bound.forEach(name => {
        assert.ok(PAGE_HTML.indexOf(name) !== -1, name + ' is not used by the page');
        assert.ok(PAGE_JS.indexOf(name) !== -1, name + ' is bound in the markup but does not exist');
    });
});

test('the relationship-type query is constrained to shared types', () => {
    // ⚠ The same trap the Roles Manager documents. Firestore evaluates read
    // rules per returned document and fails the WHOLE query if one would fail,
    // so an unconstrained query does not return fewer rows — it errors, and the
    // error looks exactly like "this church has no relationship types".
    assert.match(PAGE_JS, /where\('sharedWithEditors', '==', true\)/,
        'the query is unconstrained, so it will error rather than return less');
});

test('the two rule kinds read as the same sentence the Roles Manager uses', () => {
    // An editor who has written "no two people from the same" once should not
    // have to learn a second phrasing to say it across two Roles.
    assert.match(PAGE_HTML, /cannot be from the same/);
    assert.match(PAGE_HTML, /must be from the same/);
});
