// A Sunday fills a Liturgy Order that is already locked. Composing — placing,
// moving, taking out — happens on the Liturgy Orders page, and a catalog that
// was not read is not written back from here.

const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/liturgy-order-core.js');

function formWith(store) {
    global.window = { LiturgyOrderCore: Core, LiturgyOrderStore: store };
    global.db = {};
    global.document = { addEventListener() {}, querySelector() { return null; }, createElement() { return { innerHTML: '', textContent: '' }; } };
    global.LiturgyOrderStore = store;
    const { serviceForm } = require('../public/service-builder.js');
    const form = serviceForm();
    form.canEdit = true;
    form.$nextTick = (fn) => { if (typeof fn === 'function') fn(); };
    form.service.liturgyOrderId = 'standard';
    return form;
}

test('the Sunday page does not compose the shared order', () => {
    const form = formWith({ load: async () => { throw new Error('unread'); }, save: async () => { throw new Error('save should not run'); } });
    assert.equal(typeof form.placeInOrder, 'undefined');
    assert.equal(typeof form.placeKind, 'undefined');
    assert.equal(typeof form.reorderOrder, 'undefined');
    assert.equal(typeof form.takeFromOrder, 'undefined');
    assert.equal(typeof form.moveOrderRow, 'undefined');
});

test('a catalog that failed to load is not saved from the Sunday page', async () => {
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

    assert.equal(form.liturgyCatalogLoaded, false);
    assert.match(form.liturgyReadProblem, /permissions problem/);
    assert.match(form.liturgyReadProblem, /not a connection problem/);
    assert.equal(saved, false);
    assert.equal(form.liturgyCatalog.orders[0].id, 'standard');
});
