const { test } = require('node:test');
const assert = require('node:assert');

const Roles = require('../public/roles-core.js');

// Warnings (MS-18, ADR-0021): judge a SEATED ROSTER and say what is wrong with
// it, rather than judging one candidate about to be seated.
//
// The two questions are genuinely different, and that difference is the reason
// this exists rather than being folded into `candidatesFor`:
//
//   candidatesFor — "may I seat this person NEXT?" Asked while building, and
//                   the answer is thrown away once they are placed.
//   warningsFor   — "is this roster, AS IT STANDS, legal?" A lineup can be
//                   perfectly legal when drafted and break later, when somebody
//                   marries or a tag changes. Nothing was overridden and there
//                   is still a problem — which is also why it is a Warning and
//                   not an override.
//
// Eligibility now ADVISES. It does not refuse. Placing someone against a rule
// is permitted everywhere; what the app owes the editor is to say so.

const person = (id, extra) => Object.assign({ id: id, name: id, tags: [] }, extra);
const slot = (n, requirement) => ({
    id: 's' + n,
    requirement: requirement || Roles.REQUIREMENTS.EITHER,
});

const role = (slug, slots, extra) => Object.assign({
    slug: slug,
    name: slug,
    family: Roles.FAMILIES.SERVANT,
    slots: slots,
    restrictions: [],
    intensity: 1,
    allowsAnotherRole: false,
}, extra);

const seat = (roleSlug, slotId, personId) => ({
    roleSlug: roleSlug, slotId: slotId, personId: personId,
});

const KIDS = role('kids', [slot(1), slot(2)]);
const SETUP = role('setup', [slot(1)]);
const COFFEE = role('coffee', [slot(1)], { allowsAnotherRole: true });
const GREETING = role('greeting', [slot(1)], { allowsAnotherRole: true });

const ANN = person('ann', { sex: 'female' });
const BEN = person('ben', { sex: 'male' });
const CARA = person('cara', { sex: 'female' });

function ask(roster, over) {
    return Roles.warningsFor(roster, Object.assign({
        roles: [KIDS, SETUP, COFFEE, GREETING],
        people: [ANN, BEN, CARA],
        relationships: [],
        groups: [],
        liturgicalHolders: [],
    }, over || {}));
}

const reasonsIn = warnings => warnings.map(w => w.reason).sort();

// ── A clean roster ───────────────────────────────────────────────────────────

test('a roster that breaks nothing comes back with no warnings', () => {
    const warnings = ask([
        seat('kids', 's1', 'ann'),
        seat('kids', 's2', 'cara'),
        seat('setup', 's1', 'ben'),
    ]);

    assert.deepEqual(warnings, []);
});

test('an empty place is not a warning', () => {
    const warnings = ask([seat('kids', 's1', 'ann')]);

    assert.deepEqual(warnings, [],
        'leaving a place unfilled is a legitimate answer, not a broken rule');
});

// ── Each rule an editor authored ─────────────────────────────────────────────

test('a slot that asks for a man warns when it holds a woman', () => {
    const menOnly = role('setup', [slot(1, Roles.REQUIREMENTS.MALE)]);
    const warnings = ask([seat('setup', 's1', 'ann')], { roles: [menOnly] });

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].reason, Roles.REASONS.SEX_MISMATCH);
    assert.equal(warnings[0].personId, 'ann');
    assert.equal(warnings[0].roleSlug, 'setup');
    assert.equal(warnings[0].slotId, 's1');
});

test('a married couple in one Role warns, and names who', () => {
    const kids = role('kids', [slot(1), slot(2)], {
        restrictions: [{ kind: Roles.RESTRICTIONS.NOT_TOGETHER, typeId: 'spouse' }],
    });
    const warnings = ask(
        [seat('kids', 's1', 'ann'), seat('kids', 's2', 'ben')],
        {
            roles: [kids],
            relationships: [{ typeId: 'spouse', fromId: 'ann', toId: 'ben' }],
        }
    );

    assert.ok(warnings.length >= 1);
    assert.ok(warnings.every(w => w.reason === Roles.REASONS.RELATIONSHIP_CONFLICT));
    assert.ok(warnings.some(w => w.personId === 'ben'));
});

test('somebody off a Role\'s allowlist warns', () => {
    const communion = role('communion', [slot(1)], {
        restrictions: [{ kind: Roles.RESTRICTIONS.ALLOWLIST, personIds: ['cara'] }],
    });
    const warnings = ask([seat('communion', 's1', 'ann')], { roles: [communion] });

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].reason, Roles.REASONS.NOT_ON_ALLOWLIST);
});

test('a Role kept to a Tag warns when somebody without it is seated', () => {
    const kids = role('kids', [slot(1)], {
        restrictions: [{ kind: Roles.RESTRICTIONS.REQUIRE_TAG, tagId: 'dbs' }],
    });
    const warnings = ask([seat('kids', 's1', 'ann')], { roles: [kids] });

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].reason, Roles.REASONS.MISSING_REQUIRED_TAG);
    assert.equal(warnings[0].tagId, 'dbs');
});

// ── Exclusivity and the two-Role limit ───────────────────────────────────────

test('two exclusive Roles on one date warn', () => {
    const warnings = ask([
        seat('kids', 's1', 'ann'),
        seat('setup', 's1', 'ann'),
    ]);

    assert.ok(warnings.length >= 1);
    assert.ok(warnings.some(w => w.reason === Roles.REASONS.SERVING_ELSEWHERE));
    assert.ok(warnings.every(w => w.personId === 'ann'));
});

test('two permissive Roles on one date do not warn', () => {
    const warnings = ask([
        seat('coffee', 's1', 'ann'),
        seat('greeting', 's1', 'ann'),
    ]);

    assert.deepEqual(warnings, [],
        'a Role that says it does not use up your morning means it');
});

test('three Roles warn even when every one of them is permissive', () => {
    const tea = role('tea', [slot(1)], { allowsAnotherRole: true });
    const warnings = ask(
        [seat('coffee', 's1', 'ann'), seat('greeting', 's1', 'ann'), seat('tea', 's1', 'ann')],
        { roles: [COFFEE, GREETING, tea] }
    );

    assert.ok(warnings.length >= 1, 'at most two Roles, however light they are');
    assert.ok(warnings.every(w => w.reason === Roles.REASONS.SERVING_ELSEWHERE));
});

test('the same person in two places of one Role warns', () => {
    const warnings = ask([seat('kids', 's1', 'ann'), seat('kids', 's2', 'ann')]);

    assert.ok(warnings.length >= 1);
    assert.ok(warnings.some(w => w.reason === Roles.REASONS.ALREADY_ASSIGNED));
});

// ── Liturgy ──────────────────────────────────────────────────────────────────

test('somebody preaching that morning warns if they are also on a Servant Role', () => {
    const warnings = ask([seat('setup', 's1', 'ben')], {
        liturgicalHolders: [{ personId: 'ben', roleSlug: 'preacher' }],
    });

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].reason, Roles.REASONS.SERVING_ELSEWHERE);
    assert.equal(warnings[0].roleSlug, 'setup');
    assert.equal(warnings[0].heldRoleSlug, 'preacher',
        'naming the clash saves the editor hunting for it');
});

// ── Drift, which is the reason this is a roster question ─────────────────────

test('a roster legal when drafted warns once the data behind it changes', () => {
    const kids = role('kids', [slot(1), slot(2)], {
        restrictions: [{ kind: Roles.RESTRICTIONS.NOT_TOGETHER, typeId: 'spouse' }],
    });
    const roster = [seat('kids', 's1', 'ann'), seat('kids', 's2', 'ben')];

    const whenDrafted = ask(roster, { roles: [kids], relationships: [] });
    assert.deepEqual(whenDrafted, [], 'nobody was married when this was drafted');

    const later = ask(roster, {
        roles: [kids],
        relationships: [{ typeId: 'spouse', fromId: 'ann', toId: 'ben' }],
    });
    assert.ok(later.length >= 1,
        'they married, nothing was overridden, and there is still a problem');
});

test('somebody who has left the church warns if they are still on the rota', () => {
    const gone = person('ann', { sex: 'female', membership: { status: 'inactive' } });
    const warnings = ask([seat('setup', 's1', 'ann')], { people: [gone, BEN, CARA] });

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].reason, Roles.REASONS.INACTIVE);
});

// ── The paired test ADR-0021 asks for ────────────────────────────────────────

test('the roster pass and candidatesFor agree about every seat', () => {
    // Judge each seat as though it were being placed last. Whatever
    // `candidatesFor` would have said about that person, in that place, with
    // everyone else already sitting there, is exactly what the roster pass must
    // say — or the two have drifted and one surface starts lying.
    const kids = role('kids', [slot(1), slot(2, Roles.REQUIREMENTS.FEMALE)], {
        restrictions: [{ kind: Roles.RESTRICTIONS.NOT_TOGETHER, typeId: 'spouse' }],
    });
    const roles = [kids, SETUP, COFFEE];
    const people = [ANN, BEN, CARA];
    const relationships = [{ typeId: 'spouse', fromId: 'ann', toId: 'ben' }];

    const rosters = [
        [seat('kids', 's1', 'ann'), seat('kids', 's2', 'cara')],
        [seat('kids', 's1', 'ben'), seat('kids', 's2', 'ann')],
        [seat('kids', 's1', 'ben'), seat('kids', 's2', 'ben')],
        [seat('kids', 's2', 'ben')],
        [seat('setup', 's1', 'ann'), seat('coffee', 's1', 'ann')],
        [seat('setup', 's1', 'ann'), seat('kids', 's1', 'cara')],
    ];

    rosters.forEach(roster => {
        const warnings = Roles.warningsFor(roster, {
            roles: roles, people: people, relationships: relationships, groups: [],
            liturgicalHolders: [],
        });

        roster.forEach(s => {
            const def = roles.find(r => r.slug === s.roleSlug);
            const theSlot = def.slots.find(x => x.id === s.slotId);
            const judged = Roles.candidatesFor(def, theSlot, {
                people: people,
                relationships: relationships,
                groups: [],
                // Everyone else in this Role, and everyone this person holds
                // elsewhere — the same view the roster pass must be taking.
                assigned: roster.filter(x => x.roleSlug === s.roleSlug && x !== s),
                assignedElsewhere: roster
                    .filter(x => x.roleSlug !== s.roleSlug)
                    .map(x => Object.assign({}, x, {
                        allowsAnotherRole: roles.find(r => r.slug === x.roleSlug).allowsAnotherRole === true,
                    })),
            }).find(c => c.personId === s.personId);

            const warned = warnings.find(w => (
                w.roleSlug === s.roleSlug && w.slotId === s.slotId && w.personId === s.personId
            ));

            assert.equal(!!warned, !judged.eligible,
                `${s.personId} in ${s.roleSlug}/${s.slotId}: the two must agree`);
            if (warned) assert.equal(warned.reason, judged.reason, 'and agree on why');
        });
    });
});

// ── What a Warning is not ────────────────────────────────────────────────────

test('warnings are derived, never stamped onto the roster', () => {
    const roster = [seat('kids', 's1', 'ann'), seat('setup', 's1', 'ann')];
    const before = JSON.parse(JSON.stringify(roster));

    Roles.warningsFor(roster, {
        roles: [KIDS, SETUP], people: [ANN], relationships: [], groups: [], liturgicalHolders: [],
    });

    assert.deepEqual(roster, before,
        'nothing is stored, acknowledged or dismissed — it is recomputed every read');
});

test('a seat naming a Role that no longer exists is reported, not thrown', () => {
    const warnings = ask([seat('gone', 's1', 'ann')]);

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].reason, Roles.REASONS.UNKNOWN_ROLE);
});
