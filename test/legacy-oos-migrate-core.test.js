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

test('plan skips when carriedBy already has a leader and reports slot detail', () => {
    const service = {
        prayerPraiseId: 'p-old',
        prayerPraiseName: 'Old Name',
        carriedBy: { prayerOfPraise: { id: 'p-new', name: 'New Name' } },
    };
    const plan = Legacy.planLegacyPrayerMigration(service, catalog);
    assert.equal(plan.wouldWrite, false);
    assert.equal(plan.counts.skipped, 1);
    assert.equal(plan.skippedSlots.length, 1);
    assert.deepStrictEqual(plan.skippedSlots[0].legacy, { id: 'p-old', name: 'Old Name' });
    assert.deepStrictEqual(plan.skippedSlots[0].existing, { id: 'p-new', name: 'New Name' });
});
