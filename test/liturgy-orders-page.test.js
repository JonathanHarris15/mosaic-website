// A failed catalog read on the Liturgy Orders page. The preview (and any
// site whose rules do not yet allow liturgy_elements / liturgy_orders) gets
// permission-denied. That is not a dropped connection, and it must not look
// like an unsaved draft of Standard.

const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/liturgy-order-core.js');

function pageWith(load) {
    global.window = global.window || {};
    global.window.LiturgyOrderCore = Core;
    global.db = global.db || {};
    global.LiturgyOrderStore = { load: load, save: async () => { throw new Error('save should not run'); } };
    const { liturgyOrdersPage } = require('../public/liturgy-orders.js');
    const page = liturgyOrdersPage();
    page.$nextTick = (fn) => { if (typeof fn === 'function') fn(); };
    page.canEdit = true;
    return page;
}

function denied() {
    const error = new Error('Missing or insufficient permissions.');
    error.code = 'permission-denied';
    return error;
}

test('a permission-denied read shows Standard and does not call it a connection problem', async () => {
    const page = pageWith(async () => { throw denied(); });
    await page.load();

    assert.match(page.problem, /permissions problem/);
    assert.match(page.problem, /not a connection problem/);
    assert.doesNotMatch(page.problem, /Check your connection/);
    assert.equal(page.loading, false);
    assert.equal(page.catalog.orders[0].id, 'standard');
    assert.ok(page.orderElements.length > 0, 'the stand-in order is on screen');
    assert.equal(page.dirty, false, 'the stand-in is not an unsaved draft');
    assert.equal(page.editing, false, 'saving stays off until a read succeeds');
});

test('a failed read does not save the stand-in over the congregation\'s orders', async () => {
    let saved = false;
    const page = pageWith(async () => { throw denied(); });
    global.LiturgyOrderStore.save = async () => { saved = true; };
    await page.load();
    page.catalog = Core.addElement(page.catalog, { name: 'Offertory', primitive: 'text' }).catalog;
    await page.save();
    assert.equal(saved, false);
});

test('a successful read clears the problem and can be saved', async () => {
    const catalog = Core.standardCatalog();
    const page = pageWith(async () => ({
        catalog: catalog,
        stored: { elementIds: ['preparatoryHymn'], orderIds: ['standard'] },
    }));
    let saved = false;
    global.LiturgyOrderStore.save = async () => { saved = true; return { elementIds: [], orderIds: [] }; };
    await page.load();
    assert.equal(page.problem, '');
    assert.equal(page.editing, true);
    assert.equal(page.dirty, false);
    page.catalog = Core.renameOrder(page.catalog, 'standard', 'Ordinary');
    assert.equal(page.dirty, true);
    await page.save();
    assert.equal(saved, true);
});
