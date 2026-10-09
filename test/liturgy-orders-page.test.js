// Liturgy Orders page — catalog load failures and MS-716 editor interactions.

const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/liturgy-order-core.js');

function pageWith(load) {
    global.window = global.window || {};
    global.window.LiturgyOrderCore = Core;
    global.db = global.db || {};
    global.LiturgyOrderStore = { load: load, save: async () => { throw new Error('save should not run'); } };
    delete require.cache[require.resolve('../public/liturgy-orders.js')];
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

async function loadedPage() {
    const catalog = Core.standardCatalog();
    const page = pageWith(async () => ({
        catalog,
        stored: {
            elementIds: catalog.elements.map(el => el.id),
            orderIds: catalog.orders.map(o => o.id),
        },
    }));
    await page.load();
    return page;
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

test('a chosen index places the kind there even when another element is selected', async () => {
    const page = await loadedPage();
    const ids = page.selectedOrder.elementIds.slice();
    page.selectElement(ids[2]);
    page.placeKind('hymn', 0);
    assert.equal(page.selectedOrder.elementIds[0], page.selectedElementId);
    const el = Core.elementById(page.catalog, page.selectedElementId);
    assert.equal(el.kind, 'hymn');
    assert.equal(page.selectedOrder.elementIds[3], ids[2]);
});

test('a drag-finished click does not insert a second kind', async () => {
    const page = await loadedPage();
    const before = page.selectedOrder.elementIds.length;
    page._suppressKindClick = true;
    page.placeKindFromTile('other');
    assert.equal(page.selectedOrder.elementIds.length, before);
    assert.equal(page._suppressKindClick, false);
    page.placeKindFromTile('other');
    assert.equal(page.selectedOrder.elementIds.length, before + 1);
});

test('insert-after places a new kind after the selected element', async () => {
    const page = await loadedPage();
    const ids = page.selectedOrder.elementIds.slice();
    const anchor = ids[2];
    page.selectElement(anchor);
    const before = ids.length;
    page.placeKind('other');
    assert.equal(page.selectedOrder.elementIds.length, before + 1);
    assert.equal(page.selectedOrder.elementIds[3], page.selectedElementId);
    const el = Core.elementById(page.catalog, page.selectedElementId);
    assert.equal(el.kind, 'other');
});

test('drag reorder moves an element in the order', async () => {
    const page = await loadedPage();
    const from = 1;
    const to = 4;
    const id = page.selectedOrder.elementIds[from];
    page._apply(cat => Core.moveInOrder(cat, page.selectedOrder.id, from, to));
    assert.equal(page.selectedOrder.elementIds[to], id);
});

test('up and down in the inspector reorder the list', async () => {
    const page = await loadedPage();
    const id = page.selectedOrder.elementIds[3];
    page.selectElement(id);
    page.move(3, 1, { currentTarget: { dataset: { move: 'down' } } });
    assert.equal(page.selectedOrder.elementIds[4], id);
    page.move(4, -1, { currentTarget: { dataset: { move: 'up' } } });
    assert.equal(page.selectedOrder.elementIds[3], id);
});

test('remove takes an element out of the order', async () => {
    const page = await loadedPage();
    const id = page.selectedOrder.elementIds[5];
    page.selectElement(id);
    page.removeFromOrder(id);
    assert.equal(page.selectedOrder.elementIds.indexOf(id), -1);
    assert.equal(page.selectedElementId, '');
});

test('renaming a hymn keeps its id and persists the display name', async () => {
    const page = await loadedPage();
    const hymnId = 'preparatoryHymn';
    page.selectElement(hymnId);
    page.renameElement(hymnId, { target: { value: 'Opening Hymn' } });
    assert.equal(Core.elementById(page.catalog, hymnId).id, hymnId);
    assert.equal(Core.elementById(page.catalog, hymnId).name, 'Opening Hymn');
    assert.equal(page.displayName(Core.elementById(page.catalog, hymnId)), 'Opening Hymn');
    let saved = null;
    global.LiturgyOrderStore.save = async (_db, catalog) => {
        saved = catalog;
        return { elementIds: [], orderIds: ['standard'] };
    };
    await page.save();
    const el = Core.elementById(saved, hymnId);
    assert.equal(el.name, 'Opening Hymn');
});

test('rename updates the element name in the catalog', async () => {
    const page = await loadedPage();
    const id = page.selectedOrder.elementIds[1];
    page.selectElement(id);
    page.renameElement(id, { target: { value: 'Opening Hymn' } });
    assert.equal(Core.elementById(page.catalog, id).name, 'Opening Hymn');
});

test('note toggle persists on the element', async () => {
    const page = await loadedPage();
    const id = page.selectedOrder.elementIds[0];
    page.updateElement(id, { hasNote: false });
    assert.equal(Core.elementById(page.catalog, id).hasNote, false);
    page.updateElement(id, { hasNote: true });
    assert.equal(Core.elementById(page.catalog, id).hasNote, true);
});

test('prayer settings, days chips, and message or response survive reload', async () => {
    const page = await loadedPage();
    page.placeKind('prayer');
    const prayerId = page.selectedElementId;
    page.selectElement(prayerId);
    page.updateElement(prayerId, {
        prayedByOther: true,
        requests: { people: [{ who: 'male' }, { who: 'female' }] },
        noticeDays: [5, 3, 1],
        message: 'Hello {name}',
        response: 'Thanks {name}',
    });
    const snapshot = JSON.stringify(page.catalog);
    const page2 = pageWith(async () => ({
        catalog: JSON.parse(snapshot),
        stored: { elementIds: [], orderIds: ['standard'] },
    }));
    await page2.load();
    const el = Core.elementById(page2.catalog, prayerId);
    assert.equal(el.message, 'Hello {name}');
    assert.equal(el.response, 'Thanks {name}');
    assert.deepEqual(el.noticeDays, [5, 3, 1]);
    assert.equal(el.requests.people.length, 2);
    assert.match(page2.elementMeta(el), /Another may pray it/);
    assert.match(page2.elementMeta(el), /days 5, 3, 1/);
});

test('toggleRequests seeds default notice days', async () => {
    const page = await loadedPage();
    page.placeKind('prayer');
    const prayer = Core.elementById(page.catalog, page.selectedElementId);
    page.toggleRequests(prayer, true);
    const el = Core.elementById(page.catalog, prayer.id);
    assert.ok(el.requests);
    assert.deepEqual(el.noticeDays, Core.DEFAULT_NOTICE_LIST);
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

test('order subtitle names Standard as the default', async () => {
    const page = await loadedPage();
    assert.match(page.orderSubtitle(), /cannot be deleted/);
});
