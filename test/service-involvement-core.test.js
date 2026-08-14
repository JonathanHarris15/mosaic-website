const { test } = require('node:test');
const assert = require('node:assert');

// MS-158 — the control for MS-16's write-timing change.
//
// Saving a Service writes Involvement records. Today it writes them the moment
// you save, even for a Sunday six weeks out, which is the bug MS-160 fixes. But
// before the timing can move, WHICH records a Service produces has to be pinned
// — otherwise a change to when they are written is indistinguishable from a
// change to what is written, and the second one would go unnoticed.
//
// So this file describes the desired set as a pure function of the Service
// document: given what is stored on `services/{date}`, who served and in what
// Role. The save path's old diffing (compare original to current, add and
// remove the difference) is an optimisation over exactly this set.

const Core = require('../public/service-involvement-core.js');
const Roles = require('../public/roles-core.js');

// A Service with every serving field filled, in the SAVED shape — the flattened
// one `service-builder` writes and the one the scheduled job will read back.
function fullService() {
    return {
        serviceLeader: 'Sam Okoye', serviceLeaderId: 'p-sam',
        musicLeader: 'Mia Chen', musicLeaderId: 'p-mia',
        musicHelpers: [{ name: 'Ade Bello', id: 'p-ade' }, { name: 'Ruth Vale', id: 'p-ruth' }],
        preacher: 'Jono Harris', preacherId: 'p-jono',
        prayerPraiseName: 'Ana Diaz', prayerPraiseId: 'p-ana',
        prayerConfessionName: 'Ben Cole', prayerConfessionId: 'p-ben',
        elementsName: 'Cara Fox', elementsId: 'p-cara',
        otherName: 'Dev Rao', otherId: 'p-dev',
    };
}

const find = (records, type, personId) =>
    records.find(r => r.type === type && r.personId === personId);

// ── What a Service produces ──────────────────────────────────────────────────

test('every filled serving field produces one Involvement record', () => {
    const records = Core.servingInvolvement(fullService());

    assert.ok(find(records, 'service_leader', 'p-sam'));
    assert.ok(find(records, 'worship_leader', 'p-mia'));
    assert.ok(find(records, 'preacher', 'p-jono'));
    assert.ok(find(records, 'prayer', 'p-ana'));
    assert.ok(find(records, 'prayer', 'p-ben'));
    assert.ok(find(records, 'elements', 'p-cara'));
    assert.ok(find(records, 'other', 'p-dev'));
    assert.ok(find(records, 'worship_helper', 'p-ade'));
    assert.ok(find(records, 'worship_helper', 'p-ruth'));
    assert.strictEqual(records.length, 9);
});

test('the two prayer roles share the prayer slug and are told apart by metadata', () => {
    const records = Core.servingInvolvement(fullService());
    const prayers = records.filter(r => r.type === 'prayer');

    assert.strictEqual(prayers.length, 2);
    assert.strictEqual(find(records, 'prayer', 'p-ana').metadata.prayer_type, 'praise');
    assert.strictEqual(find(records, 'prayer', 'p-ben').metadata.prayer_type, 'confession');
});

test('an empty field produces nothing', () => {
    const records = Core.servingInvolvement({ preacherId: 'p-jono' });
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].type, 'preacher');
});

// A visiting speaker typed in by hand has a name and no id. There is no Person
// to credit, so there is nothing to write — the same rule liturgicalHolders uses.
test('a name with no id is not a Person and produces nothing', () => {
    const records = Core.servingInvolvement({ preacher: 'A visiting speaker', preacherId: null });
    assert.deepStrictEqual(records, []);
});

test('a helper with no id is skipped while the others are kept', () => {
    const records = Core.servingInvolvement({
        musicHelpers: [{ name: 'Ade Bello', id: 'p-ade' }, { name: 'Someone', id: null }],
    });
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].personId, 'p-ade');
});

test('the same person in two different Roles is credited for both', () => {
    const records = Core.servingInvolvement({ preacherId: 'p-jono', serviceLeaderId: 'p-jono' });
    assert.strictEqual(records.length, 2);
    assert.ok(find(records, 'preacher', 'p-jono'));
    assert.ok(find(records, 'service_leader', 'p-jono'));
});

test('an absent, empty or malformed Service produces nothing rather than throwing', () => {
    assert.deepStrictEqual(Core.servingInvolvement(null), []);
    assert.deepStrictEqual(Core.servingInvolvement({}), []);
    assert.deepStrictEqual(Core.servingInvolvement({ musicHelpers: 'not a list' }), []);
});

// ── Pastoral prayer is deliberately not here ─────────────────────────────────
//
// `liturgy.prayerMale` / `prayerFemale` write a `pastoral_prayer` Involvement on
// the same save path, and they are NOT serving — they record someone being
// prayed FOR. They drive `lastPastoralPrayerDate`, which the prayer rotation
// reads, and MS-17's fairness engine never looks at them. Moving their timing
// would change the rotation for no benefit to this ticket.

test('pastoral prayer is not serving and is left out', () => {
    const records = Core.servingInvolvement({
        preacherId: 'p-jono',
        liturgy: { prayerMale: { id: 'p-male' }, prayerFemale: { id: 'p-female' } },
    });
    assert.strictEqual(records.length, 1);
    assert.ok(!records.some(r => r.type === 'pastoral_prayer'));
});

// ── The slugs stay in step with the Role model ───────────────────────────────
//
// RolesCore.roleBySlug is the only way a slug becomes a human name on a serve
// history surface. A slug written here that it cannot resolve renders as
// nothing, so the six liturgical ones must match exactly.

test('every liturgical slug this module writes is a real liturgical Role', () => {
    const written = new Set(Core.servingInvolvement(fullService()).map(r => r.type));
    Roles.LITURGICAL_SLUGS.forEach(slug => {
        assert.ok(written.has(slug), 'a liturgical Role with no field here is never credited: ' + slug);
    });
});

test('elements and other are written but are not liturgical Roles', () => {
    // Named so nobody "tidies" them into LITURGICAL_SLUGS: they are serving, and
    // they predate the Role model, but they are not part of the printed liturgy.
    assert.strictEqual(Roles.LITURGICAL_SLUGS.includes('elements'), false);
    assert.strictEqual(Roles.LITURGICAL_SLUGS.includes('other'), false);
    assert.ok(Core.SERVING_SLUGS.includes('elements'));
    assert.ok(Core.SERVING_SLUGS.includes('other'));
});

// ── The id a record is written under (MS-159) ────────────────────────────────

test('the same fact produces the same id every time', () => {
    const record = { personId: 'p-jono', type: 'preacher' };
    assert.strictEqual(
        Core.involvementId('2026-10-12', record),
        Core.involvementId('2026-10-12', record),
        'a deterministic id is what makes a second conversion run a no-op');
});

test('the two prayer roles get different ids', () => {
    const praise = { personId: 'p-ana', type: 'prayer', metadata: { prayer_type: 'praise' } };
    const confession = { personId: 'p-ana', type: 'prayer', metadata: { prayer_type: 'confession' } };
    assert.notStrictEqual(
        Core.involvementId('2026-10-12', praise),
        Core.involvementId('2026-10-12', confession),
        'one person can lead both prayers on the same Sunday');
});

test('different dates and different Roles get different ids', () => {
    const record = { personId: 'p-jono', type: 'preacher' };
    assert.notStrictEqual(Core.involvementId('2026-10-12', record), Core.involvementId('2026-10-19', record));
    assert.notStrictEqual(
        Core.involvementId('2026-10-12', record),
        Core.involvementId('2026-10-12', { personId: 'p-jono', type: 'service_leader' }));
});

test('a junk date or record has no id rather than a junk one', () => {
    assert.strictEqual(Core.involvementId('not-a-date', { type: 'preacher' }), null);
    assert.strictEqual(Core.involvementId('2026-10-12', null), null);
    assert.strictEqual(Core.involvementId('2026-10-12', {}), null);
});

// ── When it is written (MS-160) ──────────────────────────────────────────────

test('a Sunday that has not happened yet produces no records', () => {
    const records = Core.involvementAsAt(fullService(), '2026-10-12', '2026-08-31');
    assert.deepStrictEqual(records, [], 'assigning a preacher six weeks out is not serving');
});

test('a Sunday that has passed produces its records', () => {
    const records = Core.involvementAsAt(fullService(), '2026-10-12', '2026-10-13');
    assert.strictEqual(records.length, 9);
});

test('the day itself has not passed yet', () => {
    // A Sunday is over when it is over, not when it starts. The scheduled job
    // runs after midnight in the church's timezone, so same-day is still ahead.
    assert.strictEqual(Core.hasPassed('2026-10-12', '2026-10-12'), false);
    assert.strictEqual(Core.hasPassed('2026-10-12', '2026-10-13'), true);
});

test('a junk date never counts as passed', () => {
    assert.strictEqual(Core.hasPassed(null, '2026-10-13'), false);
    assert.strictEqual(Core.hasPassed('2026-10-12', null), false);
});

// ── Making the records agree with the Service ────────────────────────────────

test('a past Sunday nobody has converted yet writes everything, removes nothing', () => {
    const desired = Core.desiredFor(fullService(), '2026-10-12', '2026-10-13');
    const { write, remove } = Core.reconcile(desired, []);
    assert.strictEqual(write.length, 9);
    assert.deepStrictEqual(remove, []);
});

test('running the conversion twice writes nothing the second time', () => {
    const desired = Core.desiredFor(fullService(), '2026-10-12', '2026-10-13');
    const { write, remove } = Core.reconcile(desired, desired);
    assert.deepStrictEqual(write, [], 'this is the whole point of a deterministic id');
    assert.deepStrictEqual(remove, []);
});

test('two music helpers both survive reconciliation', () => {
    // They share a Role and therefore a slug, so anything keyed by slug alone
    // silently drops one of them — and the helper who is dropped is never
    // credited for a Sunday they actually played.
    const service = { musicHelpers: [{ name: 'Ade', id: 'p-ade' }, { name: 'Ruth', id: 'p-ruth' }] };
    const desired = Core.desiredFor(service, '2026-10-12', '2026-10-13');
    const { write } = Core.reconcile(desired, []);

    assert.strictEqual(write.length, 2);
    assert.ok(write.some(r => r.personId === 'p-ade'));
    assert.ok(write.some(r => r.personId === 'p-ruth'));
});

test('swapping the preacher writes the new one and removes the old', () => {
    const before = Core.desiredFor({ preacherId: 'p-jono' }, '2026-10-12', '2026-10-13');
    const after = Core.desiredFor({ preacherId: 'p-sam' }, '2026-10-12', '2026-10-13');
    const { write, remove } = Core.reconcile(after, before);

    assert.strictEqual(write.length, 1);
    assert.strictEqual(write[0].personId, 'p-sam');
    assert.strictEqual(remove.length, 1);
    assert.strictEqual(remove[0].personId, 'p-jono');
});

test('dropping a helper removes only that helper', () => {
    const before = Core.desiredFor(
        { musicHelpers: [{ id: 'p-ade' }, { id: 'p-ruth' }] }, '2026-10-12', '2026-10-13');
    const after = Core.desiredFor(
        { musicHelpers: [{ id: 'p-ade' }] }, '2026-10-12', '2026-10-13');
    const { write, remove } = Core.reconcile(after, before);

    assert.deepStrictEqual(write, []);
    assert.strictEqual(remove.length, 1);
    assert.strictEqual(remove[0].personId, 'p-ruth');
});

test('every desired record carries its id and its date', () => {
    const desired = Core.desiredFor({ preacherId: 'p-jono' }, '2026-10-12', '2026-10-13');
    assert.strictEqual(desired[0].id, '2026-10-12_preacher');
    assert.strictEqual(desired[0].serviceDate, '2026-10-12');
});
