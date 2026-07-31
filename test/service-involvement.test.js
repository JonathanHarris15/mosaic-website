const { test } = require('node:test');
const assert = require('node:assert');

// MS-160 — the Cloud Function's copy of the liturgy conversion rules.
//
// `functions/` is deployed on its own and cannot require anything out of
// `public/`, so the rules exist twice. That is the same trade
// assignment-conversion.js already makes, and it is only safe because a test
// holds the two together: a rule changed in one copy and not the other is a
// serve log that disagrees with the screen that wrote it.

const fn = require('../functions/service-involvement.js');
const Core = require('../public/service-involvement-core.js');
const Roles = require('../public/roles-core.js');

function fullService() {
    return {
        serviceLeaderId: 'p-sam',
        musicLeaderId: 'p-mia',
        musicHelpers: [{ name: 'Ade Bello', id: 'p-ade' }, { name: 'Ruth Vale', id: 'p-ruth' }],
        preacherId: 'p-jono',
        sermonetteId: 'p-tom',
        prayerPraiseId: 'p-ana',
        prayerConfessionId: 'p-ben',
        elementsId: 'p-cara',
        otherId: 'p-dev',
    };
}

// ── The two copies agree ─────────────────────────────────────────────────────

test('both copies read the same fields onto the same slugs', () => {
    assert.deepStrictEqual(
        fn.SERVING_FIELDS.map(f => [f.idField, f.slug, f.list || false]),
        Core.SERVING_FIELDS.map(f => [f.idField, f.slug, f.list || false]));
});

test('both copies credit the same people for the same Service', () => {
    assert.deepStrictEqual(
        fn.servingInvolvement(fullService()),
        Core.servingInvolvement(fullService()));
});

test('both copies write under the same id', () => {
    const records = fn.servingInvolvement(fullService());
    records.forEach(r => {
        assert.strictEqual(
            fn.involvementId('2026-10-12', r),
            Core.involvementId('2026-10-12', r),
            'an id that differs between the editor and the job is a duplicate record');
    });
});

test('both copies produce the same conversion for a passed Sunday', () => {
    assert.deepStrictEqual(
        fn.conversion(fullService(), '2026-10-12', '2026-10-13'),
        Core.desiredFor(fullService(), '2026-10-12', '2026-10-13'));
});

// ── The rules themselves ─────────────────────────────────────────────────────

test('a Sunday still ahead converts nothing', () => {
    assert.deepStrictEqual(fn.conversion(fullService(), '2026-10-12', '2026-08-31'), []);
});

test('the Sunday itself has not passed until the next day', () => {
    assert.deepStrictEqual(fn.conversion(fullService(), '2026-10-12', '2026-10-12'), []);
    assert.strictEqual(fn.conversion(fullService(), '2026-10-12', '2026-10-13').length, 10);
});

test('conversion is unconditional — there is no state to be confirmed', () => {
    // The whole difference from a Servant Role. Nobody said yes to preaching;
    // they are on the booklet, and the booklet went out.
    const records = fn.conversion({ preacherId: 'p-jono' }, '2026-10-12', '2026-10-13');
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].personId, 'p-jono');
});

test('running it twice produces the same ids, so the second run overwrites', () => {
    const first = fn.conversion(fullService(), '2026-10-12', '2026-10-13');
    const second = fn.conversion(fullService(), '2026-10-12', '2026-10-13');
    assert.deepStrictEqual(first.map(r => r.id), second.map(r => r.id));
});

test('the two Music Helpers get one record each', () => {
    const records = fn.conversion(
        { musicHelpers: [{ id: 'p-ade' }, { id: 'p-ruth' }] }, '2026-10-12', '2026-10-13');
    assert.strictEqual(records.length, 2);
    assert.deepStrictEqual(records.map(r => r.personId).sort(), ['p-ade', 'p-ruth']);
});

test('the two prayers get one record each, told apart by metadata', () => {
    const records = fn.conversion(
        { prayerPraiseId: 'p-ana', prayerConfessionId: 'p-ana' }, '2026-10-12', '2026-10-13');
    assert.strictEqual(records.length, 2);
    assert.notStrictEqual(records[0].id, records[1].id, 'one person can lead both');
});

test('a visiting speaker with no id is credited to nobody', () => {
    assert.deepStrictEqual(
        fn.conversion({ preacher: 'A visiting speaker' }, '2026-10-12', '2026-10-13'), []);
});

test('a junk or missing date converts nothing rather than throwing', () => {
    assert.deepStrictEqual(fn.conversion(fullService(), null, '2026-10-13'), []);
    assert.deepStrictEqual(fn.conversion(fullService(), '2026-10-12', null), []);
    assert.deepStrictEqual(fn.conversion(null, '2026-10-12', '2026-10-13'), []);
});

test('every liturgical Role has a field here', () => {
    // A liturgical Role with no field would leave whoever held it uncredited,
    // silently, forever.
    const written = new Set(fn.servingInvolvement(fullService()).map(r => r.type));
    Roles.LITURGICAL_SLUGS.forEach(slug => {
        assert.ok(written.has(slug), 'no field credits the liturgical Role: ' + slug);
    });
});

test('pastoral prayer is left alone', () => {
    const records = fn.conversion({
        preacherId: 'p-jono',
        liturgy: { prayerMale: { id: 'p-male' }, prayerFemale: { id: 'p-female' } },
    }, '2026-10-12', '2026-10-13');
    assert.ok(!records.some(r => r.type === 'pastoral_prayer'),
        'being prayed for is not serving, and its timing is not this ticket');
});
