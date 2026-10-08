// An Order of Service composes a shared Liturgy Order from the congregation's
// element collection. The write is the order's ids, in a sequence. The element
// stays one record. A catalog that was not read is not written back.

const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/liturgy-order-core.js');
const Store = require('../public/liturgy-order-store.js');

function fakeDb() {
    const writes = [];
    const db = {
        writes: writes,
        batch() {
            const ops = [];
            return {
                set(ref, data) { ops.push({ op: 'set', path: ref.path, data: data }); },
                delete(ref) { ops.push({ op: 'del', path: ref.path }); },
                async commit() { writes.push(ops); },
            };
        },
        collection(name) {
            return { doc(id) { return { path: name + '/' + id }; } };
        },
    };
    return db;
}

function formWith(store) {
    global.window = { LiturgyOrderCore: Core, LiturgyOrderStore: store };
    global.document = { addEventListener() {}, querySelector() { return null; }, createElement() { return { innerHTML: '', textContent: '' }; } };
    global.LiturgyOrderStore = store;
    const { serviceForm } = require('../public/service-builder.js');
    const form = serviceForm();
    form.canEdit = true;
    form.$nextTick = (fn) => { if (typeof fn === 'function') fn(); };
    form.service.liturgyOrderId = 'standard';
    return form;
}

function withOffertory(form) {
    const made = Core.addElement(form.liturgyCatalog, { name: 'Offertory', primitive: 'text' });
    form.liturgyCatalog = made.catalog;
    form._orderShapeGood = made.catalog;
    form.liturgyCatalogLoaded = true;
    form.liturgyStored = {
        elementIds: made.catalog.elements.map(el => el.id),
        orderIds: made.catalog.orders.map(o => o.id),
    };
    return made.element.id;
}

test('placing an element writes the shared order and keeps one element record', async () => {
    const db = fakeDb();
    global.db = db;
    const form = formWith(Store);
    const id = withOffertory(form);

    const previouslyStored = form.liturgyStored.elementIds.slice();
    form.placeInOrder(id, 0);
    await form._orderShapeFlight;

    assert.equal(db.writes.length, 1);
    const ops = db.writes[0];
    const orders = ops.filter(op => op.op === 'set' && op.path.indexOf('liturgy_orders/') === 0).map(op => op.data);
    const elementSets = ops.filter(op => op.op === 'set' && op.path.indexOf('liturgy_elements/') === 0);
    const elementDeletes = ops.filter(op => op.op === 'del' && op.path.indexOf('liturgy_elements/') === 0)
        .map(op => op.path.slice('liturgy_elements/'.length));
    orders.forEach(order => {
        assert.ok(Array.isArray(order.elements));
        order.elements.forEach(el => {
            assert.ok(el.kind);
            assert.equal(el.primitive, undefined);
        });
    });
    const standard = orders.find(o => o.id === 'standard');
    const placed = standard.elements.find(el => el.id === id);
    assert.equal(placed.kind, 'other');
    assert.equal(standard.elementIds.filter(x => x === id).length, 1);
    assert.equal(elementSets.length, 0, 'an element is stored on the order, not in its own collection');
    assert.deepEqual(elementDeletes.slice().sort(), previouslyStored.slice().sort());
    assert.match(form.orderShapeNote, /Saved to Standard/);
    assert.equal(form.orderShapeError, '');
});

test('a second move during the write is saved after the first, not dropped', async () => {
    const db = fakeDb();
    global.db = db;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const form = formWith({
        save(dbArg, catalog, stored) {
            return gate.then(() => Store.save(dbArg, catalog, stored));
        },
    });
    const id = withOffertory(form);

    form.placeInOrder(id, 0);
    const first = form._orderShapeFlight;
    form.reorderOrder(0, 2);
    release();
    await first;
    await form._orderShapeFlight;

    assert.equal(db.writes.length, 2);
    const last = db.writes[1].find(op => op.path === 'liturgy_orders/standard').data;
    assert.equal(last.elementIds[2], id);
    assert.equal(last.elementIds.filter(x => x === id).length, 1);
});

test('a failed write puts the last saved combination back', async () => {
    const form = formWith({
        save() { return Promise.reject(new Error('unavailable')); },
    });
    const id = withOffertory(form);
    const before = form.liturgyCatalog;

    form.placeInOrder(id, 0);
    await form._orderShapeFlight;

    assert.equal(form.liturgyCatalog, before);
    assert.equal(form.orderHas(id), false);
    assert.equal(Core.elementById(form.liturgyCatalog, id).name, 'Offertory');
    assert.match(form.orderShapeError, /did not save/);
    assert.equal(form.orderShapeNote, '');
});

test('a catalog that failed to load is not composed and not saved', async () => {
    let saved = false;
    const form = formWith({
        async load() {
            const error = new Error('Missing or insufficient permissions.');
            error.code = 'permission-denied';
            throw error;
        },
        async save() { saved = true; },
    });
    await form.loadLiturgyCatalog();
    form.canEdit = true;
    form.placeInOrder('offertory', 0);
    form.reorderOrder(0, 1);
    form.takeFromOrder('hymn1');

    assert.equal(form.liturgyCatalogLoaded, false);
    assert.match(form.liturgyReadProblem, /permissions problem/);
    assert.match(form.liturgyReadProblem, /not a connection problem/);
    assert.equal(saved, false);
    assert.equal(form._orderShapeFlight, undefined);
});
