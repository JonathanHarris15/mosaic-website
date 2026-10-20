const { test } = require('node:test');
const assert = require('node:assert');

const Legacy = require('../public/legacy-oos-migrate-core.js');
const Liturgy = require('../public/liturgy-order-core.js');

const catalog = Liturgy.standardCatalog();

test('plan copies legacy praise into carriedBy.prayerOfPraise when empty', () => {
    const service = {
        prayerPraiseId: 'p-luke',
        prayerPraiseName: 'Luke Metcalf',
        liturgyOrderId: 'standard',
        carriedBy: {},
    };
    const plan = Legacy.planLegacyPrayerMigration(service, catalog);
    assert.equal(plan.wouldWrite, true);
    assert.equal(plan.counts.praise, 1);
    assert.deepStrictEqual(plan.patch.carriedBy.prayerOfPraise, {
        id: 'p-luke',
        name: 'Luke Metcalf',
    });
});

test('plan skips when carriedBy already has a leader', () => {
    const service = {
        prayerPraiseId: 'p-old',
        prayerPraiseName: 'Old Name',
        carriedBy: { prayerOfPraise: { id: 'p-new', name: 'New Name' } },
    };
    const plan = Legacy.planLegacyPrayerMigration(service, catalog);
    assert.equal(plan.wouldWrite, false);
    assert.equal(plan.counts.skipped, 1);
});

test('hydrate mirrors plan without requiring a write', () => {
    const service = {
        prayerConfessionId: 'p-colin',
        prayerConfessionName: 'Colin Beers',
        carriedBy: {},
    };
    Legacy.hydrateCarriedByFromLegacy(service, catalog);
    assert.deepStrictEqual(service.carriedBy.prayerOfConfession, {
        id: 'p-colin',
        name: 'Colin Beers',
    });
});

test('mergePrayerInvolvement dedupes carriedBy and legacy ids for the same prayer', () => {
    const withCarrier = {
        carriedBy: { prayerOfPraise: { id: 'p1', name: 'Ada' } },
        prayerPraiseId: 'p1',
    };
    const merged = Legacy.mergePrayerInvolvement(withCarrier, catalog);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].personId, 'p1');
});
