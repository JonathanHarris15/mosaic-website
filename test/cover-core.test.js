const { test } = require('node:test');
const assert = require('node:assert');

const Cover = require('../public/cover-core.js');
const Roles = require('../public/roles-core.js');

// May this Person take on an Assignment somebody else declined? (MS-20, ADR-0030)
//
// The rules that answer it already exist and already have an opinion — but the
// opinion is the EDITOR'S. `RolesCore.candidatesFor` returns a reason with every
// candidate and the editor may seat them anyway (ADR-0021). Nobody reviews a
// member's pick, so for them the same reason is a wall.
//
// Three rules, and they are not the same kind of rule:
//   1. The Event's visibility — absolute, and asked FIRST.
//   2. The Role's own rules — refuse a member, advise an editor.
//   3. The Person's own Away — a warning to them, because overruling your own
//      stated plans is changing your mind, not the app disbelieving you.

const person = (id, extra) => Object.assign({ id: id, name: id, tags: [] }, extra);

const alice = person('alice', { sex: 'female', tags: ['kids-cleared'] });
const carl = person('carl', { sex: 'male', tags: ['kids-cleared'] });
const dan = person('dan', { sex: 'male', tags: [] });
const frank = person('frank', {
    sex: 'male', tags: ['kids-cleared'], membership: { inactive: true },
});

const EVERYONE = [alice, carl, dan, frank];

const kidsMinistry = (restrictions) => ({
    id: 'r1',
    name: 'Kids Ministry',
    family: Roles.FAMILIES.SERVANT,
    slots: [
        { id: 's1', requirement: Roles.REQUIREMENTS.EITHER },
        { id: 's2', requirement: Roles.REQUIREMENTS.FEMALE },
    ],
    restrictions: restrictions || [],
});

const eitherSlot = { id: 's1', requirement: Roles.REQUIREMENTS.EITHER };
const femaleSlot = { id: 's2', requirement: Roles.REQUIREMENTS.FEMALE };

// A member-rung occurrence — the ordinary case, visible to any signed-in member.
const openEvent = {
    id: 'midweek_2026-08-14',
    seriesId: 'midweek',
    date: '2026-08-14',
    visibility: 'member',
    participantIds: [],
};

// The base question, with everything permissive. Individual tests override.
const ask = (over) => Cover.verdictFor(Object.assign({
    rank: 'member',
    person: carl,
    occurrence: openEvent,
    roleDef: kidsMinistry(),
    slot: eitherSlot,
    context: { people: EVERYONE, assigned: [], assignedElsewhere: [], awayPersonIds: [] },
}, over || {}));

// ── The ordinary case ────────────────────────────────────────────────────────

test('a member eligible for the place may take it', () => {
    const verdict = ask();
    assert.equal(verdict.permitted, true);
    assert.equal(verdict.reason, null);
    assert.equal(verdict.warning, null);
});

// ── The Role's rules refuse a member and advise an editor ────────────────────

test('a slot wanting a woman refuses a man — this is the wall ADR-0030 puts up', () => {
    const verdict = ask({ slot: femaleSlot });
    assert.equal(verdict.permitted, false);
    assert.equal(verdict.reason, Roles.REASONS.SEX_MISMATCH);
});

test('the same inputs asked for an editor permit it — one function, one flag', () => {
    const asMember = ask({ slot: femaleSlot });
    const asEditor = ask({ slot: femaleSlot, asEditor: true });

    assert.equal(asMember.permitted, false);
    assert.equal(asEditor.permitted, true);
    // The editor is not told nothing — they are told the same thing, as advice.
    assert.equal(asEditor.warning, Roles.REASONS.SEX_MISMATCH);
});

test('a Role kept to a named few refuses somebody not on the list', () => {
    const verdict = ask({
        roleDef: kidsMinistry([
            { kind: Roles.RESTRICTIONS.ALLOWLIST, personIds: ['alice'] },
        ]),
    });
    assert.equal(verdict.permitted, false);
    assert.equal(verdict.reason, Roles.REASONS.NOT_ON_ALLOWLIST);
});

test('a Role requiring a tag refuses somebody without it', () => {
    const verdict = ask({
        person: dan,
        roleDef: kidsMinistry([
            { kind: Roles.RESTRICTIONS.REQUIRE_TAG, tagId: 'kids-cleared' },
        ]),
    });
    assert.equal(verdict.permitted, false);
    assert.equal(verdict.reason, Roles.REASONS.MISSING_REQUIRED_TAG);
});

test('somebody already seated in this Role here cannot take a second place in it', () => {
    const verdict = ask({
        context: {
            people: EVERYONE,
            assigned: [{ slotId: 's2', personId: 'carl' }],
            assignedElsewhere: [],
            awayPersonIds: [],
        },
    });
    assert.equal(verdict.permitted, false);
    assert.equal(verdict.reason, Roles.REASONS.ALREADY_ASSIGNED);
});

test('an Inactive Person is refused, editor or not — that rule was never advisory', () => {
    assert.equal(ask({ person: frank }).permitted, false);
    assert.equal(ask({ person: frank, asEditor: true }).permitted, false);
    assert.equal(ask({ person: frank }).reason, Roles.REASONS.INACTIVE);
});

// The whole reason set, so the wall cannot be half-built. `unknownRole` and
// `unknownSlot` are absent on purpose — only a whole-roster answer produces
// those, never `candidatesFor`, so they cannot reach this module.
const HOUSE_GROUP = 'type-house-group';
const MARRIAGE = 'type-marriage';

const EVERY_REFUSAL = [
    {
        reason: Roles.REASONS.SEX_UNKNOWN,
        note: 'sex never recorded, and the slot wants one',
        over: { person: person('erin', { tags: ['kids-cleared'] }), slot: femaleSlot },
    },
    {
        reason: Roles.REASONS.EXCLUDED_BY_TAG,
        note: 'carries a tag the Role excludes',
        over: {
            roleDef: kidsMinistry([
                { kind: Roles.RESTRICTIONS.EXCLUDE_TAG, tagId: 'kids-cleared' },
            ]),
        },
    },
    {
        reason: Roles.REASONS.SERVING_ELSEWHERE,
        note: 'already holding another Role that morning',
        over: {
            context: {
                people: EVERYONE, assigned: [], awayPersonIds: [],
                assignedElsewhere: [
                    { personId: 'carl', roleSlug: 'coffee', allowsAnotherRole: false },
                ],
            },
        },
    },
    {
        reason: Roles.REASONS.RELATIONSHIP_CONFLICT,
        note: 'his wife is already on this Role',
        over: {
            roleDef: kidsMinistry([
                { kind: Roles.RESTRICTIONS.NOT_TOGETHER, typeId: MARRIAGE },
            ]),
            context: {
                people: EVERYONE, awayPersonIds: [], assignedElsewhere: [],
                assigned: [{ slotId: 's2', personId: 'alice' }],
                relationships: [{ fromId: 'carl', toId: 'alice', typeId: MARRIAGE }],
            },
        },
    },
    {
        reason: Roles.REASONS.SAME_GROUP_CONFLICT,
        note: 'somebody from his house group is already on it',
        over: {
            roleDef: kidsMinistry([
                { kind: Roles.RESTRICTIONS.NOT_SAME_GROUP, typeId: HOUSE_GROUP },
            ]),
            context: {
                people: EVERYONE, awayPersonIds: [], assignedElsewhere: [],
                assigned: [{ slotId: 's2', personId: 'alice' }],
                groups: [{
                    id: 'g1', typeId: HOUSE_GROUP, name: 'Tuesday',
                    leaderId: null, memberIds: ['carl', 'alice'],
                }],
            },
        },
    },
    {
        reason: Roles.REASONS.NOT_IN_REQUIRED_GROUP,
        note: 'the Role is staffed from one group and he is in none of it',
        over: {
            roleDef: kidsMinistry([
                { kind: Roles.RESTRICTIONS.SAME_GROUP, typeId: HOUSE_GROUP },
            ]),
            context: {
                people: EVERYONE, awayPersonIds: [], assigned: [], assignedElsewhere: [],
                groups: [{
                    id: 'g1', typeId: HOUSE_GROUP, name: 'Tuesday',
                    leaderId: null, memberIds: ['alice'],
                }],
            },
        },
    },
];

EVERY_REFUSAL.forEach(({ reason, note, over }) => {
    test(`a member is refused: ${note}`, () => {
        const verdict = ask(over);
        assert.equal(verdict.permitted, false);
        assert.equal(verdict.reason, reason);
    });

    test(`an editor is only advised: ${note}`, () => {
        const verdict = ask(Object.assign({ asEditor: true }, over));
        assert.equal(verdict.permitted, true);
        assert.equal(verdict.warning, reason);
    });
});

test('a refusal carries the detail, so a surface can name the actual clash', () => {
    const verdict = ask({
        person: dan,
        roleDef: kidsMinistry([
            { kind: Roles.RESTRICTIONS.REQUIRE_TAG, tagId: 'kids-cleared' },
        ]),
    });
    assert.equal(verdict.detail.tagId, 'kids-cleared');
});

// ── Your own Away ────────────────────────────────────────────────────────────

test('your own Away warns and lets you through — you are changing your mind', () => {
    const verdict = ask({
        context: {
            people: EVERYONE, assigned: [], assignedElsewhere: [],
            awayPersonIds: ['carl'],
        },
    });
    assert.equal(verdict.permitted, true);
    assert.equal(verdict.warning, Roles.REASONS.AWAY);
    assert.equal(verdict.reason, null);
});

// ⚠ The one that catches the naive implementation. `ineligibilityFor` returns
// only the FIRST reason and checks Away second, so a man who is ALSO away on a
// women's slot comes back as `away`. Waving that through on the strength of the
// Away rule would seat him in a place the Role refuses.
test('Away does not launder a real refusal hiding behind it', () => {
    const verdict = ask({
        slot: femaleSlot,
        context: {
            people: EVERYONE, assigned: [], assignedElsewhere: [],
            awayPersonIds: ['carl'],
        },
    });
    assert.equal(verdict.permitted, false, 'the sex requirement still refuses him');
    assert.equal(verdict.reason, Roles.REASONS.SEX_MISMATCH);
});

// ── Visibility is absolute, and asked first ──────────────────────────────────

test('an Event your rank cannot see refuses you before eligibility is consulted', () => {
    const verdict = ask({
        occurrence: Object.assign({}, openEvent, { visibility: 'elder' }),
        slot: eitherSlot,
    });
    assert.equal(verdict.permitted, false);
    assert.equal(verdict.reason, Cover.REASONS.NOT_VISIBLE);
});

test('visibility outranks eligibility — an ineligible person is told the real cause', () => {
    const verdict = ask({
        occurrence: Object.assign({}, openEvent, { visibility: 'elder' }),
        slot: femaleSlot,
    });
    assert.equal(verdict.reason, Cover.REASONS.NOT_VISIBLE,
        'not sexMismatch — they should not learn the Role wanted a woman');
});

test('an editor does not get waved past a rung they cannot see', () => {
    const verdict = ask({
        rank: 'member',
        asEditor: true,
        occurrence: Object.assign({}, openEvent, { visibility: 'elder' }),
    });
    assert.equal(verdict.permitted, false);
    assert.equal(verdict.reason, Cover.REASONS.NOT_VISIBLE);
});

test('a participant of a participant-rung Event can be judged on eligibility', () => {
    const verdict = ask({
        occurrence: Object.assign({}, openEvent, {
            visibility: 'participant', participantIds: ['carl'],
        }),
    });
    assert.equal(verdict.permitted, true);
});

test('fails closed — an occurrence with no visibility is takeable by nobody', () => {
    const verdict = ask({ occurrence: Object.assign({}, openEvent, { visibility: null }) });
    assert.equal(verdict.permitted, false);
    assert.equal(verdict.reason, Cover.REASONS.NOT_VISIBLE);
});

// ── One-off Roles ────────────────────────────────────────────────────────────

test('a one-off Role has no rules to break, so anyone who can see it may take it', () => {
    const verdict = ask({ person: dan, roleDef: null, slot: null });
    assert.equal(verdict.permitted, true);
    assert.equal(verdict.reason, null);
});

test('a one-off Role still refuses an Inactive Person', () => {
    const verdict = ask({ person: frank, roleDef: null, slot: null });
    assert.equal(verdict.permitted, false);
    assert.equal(verdict.reason, Roles.REASONS.INACTIVE);
});

test('a one-off Role still warns on your own Away', () => {
    const verdict = ask({
        person: dan, roleDef: null, slot: null,
        context: {
            people: EVERYONE, assigned: [], assignedElsewhere: [],
            awayPersonIds: ['dan'],
        },
    });
    assert.equal(verdict.permitted, true);
    assert.equal(verdict.warning, Roles.REASONS.AWAY);
});

// ── Cross-Role Rules reach the member-facing door too (MS-221) ───────────────
//
// ⚠ THE POINT OF PUTTING THE RULE IN `ineligibilityFor` RATHER THAN IN THE
// PICKER. An editor's picker refusing what Cover then hands out is a rule with
// the back door left open: the member takes the place nobody could have given
// them, and the rota is wrong in a way the screen that made it never sees.

const PAIR_MARRIAGE = 'marriage';
const carlAndAlice = {
    id: 'm1', typeId: PAIR_MARRIAGE, name: 'Carl & Alice',
    leaderId: null, memberIds: ['carl', 'alice'],
};

const marriedPairRule = {
    kind: Roles.RESTRICTIONS.NOT_SAME_GROUP,
    typeId: PAIR_MARRIAGE,
    roleSlugs: ['kids_ministry', 'kids_helper'],
};

const askAcross = (over) => ask(Object.assign({
    roleDef: Object.assign(kidsMinistry(), { slug: 'kids_ministry' }),
    context: {
        people: EVERYONE,
        groups: [carlAndAlice],
        assigned: [],
        assignedElsewhere: [{ personId: 'alice', roleSlug: 'kids_helper', allowsAnotherRole: true }],
        awayPersonIds: [],
        crossRoleRules: [marriedPairRule],
    },
}, over || {}));

test('a member may not take a place their spouse\'s Role is paired against', () => {
    const verdict = askAcross();
    assert.equal(verdict.permitted, false);
    assert.equal(verdict.reason, Roles.REASONS.PAIRED_ROLE_CONFLICT);
    assert.equal(verdict.detail.conflictsWith, 'alice');
    assert.equal(verdict.detail.pairedRoleSlug, 'kids_helper');
});

test('with nobody in the paired Role, the same member may take it', () => {
    const verdict = askAcross({
        context: {
            people: EVERYONE,
            groups: [carlAndAlice],
            assigned: [],
            assignedElsewhere: [],
            awayPersonIds: [],
            crossRoleRules: [marriedPairRule],
        },
    });
    assert.equal(verdict.permitted, true);
});

test('an editor taking it on their behalf is warned, not refused', () => {
    // ADR-0021/ADR-0030: a rule about the roster advises an editor and refuses
    // a member, because nobody reviews what a member picks. A cross-Role rule
    // is a rule about the roster like any other.
    const verdict = askAcross({ asEditor: true });
    assert.equal(verdict.permitted, true);
    assert.equal(verdict.warning, Roles.REASONS.PAIRED_ROLE_CONFLICT);
});
