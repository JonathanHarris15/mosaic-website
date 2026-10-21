const { test } = require('node:test');
const assert = require('node:assert');

const DeleteCore = require('../public/delete-legacy-oos-prayer-fields-core.js');
const Liturgy = require('../public/liturgy-order-core.js');

const catalog = Liturgy.standardCatalog();

test('blocks deletion when legacy praise exists but carriedBy slot is empty', () => {
    const service = {
        prayerPraiseId: 'p-old',
        prayerPraiseName: 'Old Leader',
        carriedBy: {},
    };
    const plan = DeleteCore.planLegacyPrayerFieldDeletion(service, catalog, '2026-01-05');
    assert.equal(plan.wouldDelete, true);
    assert.equal(plan.blocked, true);
    assert.equal(plan.blockReasons.length, 1);
    assert.equal(plan.blockReasons[0].kind, 'praise');
});

test('plans field deletion when carriedBy has the migrated leader', () => {
    const service = {
        prayerPraiseId: 'p-old',
        prayerPraiseName: 'Old Leader',
        prayerConfessionId: 'p-conf',
        carriedBy: {
            prayerOfPraise: { id: 'p-new', name: 'New Leader' },
            prayerOfConfession: { id: 'p-conf', name: 'Conf Leader' },
        },
    };
    const plan = DeleteCore.planLegacyPrayerFieldDeletion(service, catalog, '2026-01-12');
    assert.equal(plan.blocked, false);
    assert.ok(plan.deleteFields.includes('prayerPraiseId'));
    assert.ok(plan.deleteFields.includes('prayerPraiseName'));
    assert.ok(plan.deleteFields.includes('prayerConfessionId'));
});
