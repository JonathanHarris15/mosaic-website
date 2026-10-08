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

// A row opens only when its panel has a field. A prayer that asks for people
// opens so those people can be named there. A name that is only on the order
// has nothing to enter.
function catalogWithQuietRows() {
    let catalog = Core.standardCatalog();
    const place = (kind, fields) => {
        const placed = Core.placeKind(catalog, 'standard', kind, null, fields);
        catalog = placed.catalog;
        return placed.element.id;
    };
    const praise = place('prayer', { name: 'Prayer of Praise', hasNote: false });
    const asked = place('prayer', { name: 'Asked Prayer', hasNote: false, requests: { count: 1, who: 'either' } });
    const other = place('other', { name: 'Announcements', hasNote: false });
    const noted = place('other', { name: 'Welcome', hasNote: true });
    const hymn = place('hymn', { hasNote: false });
    return { catalog, praise, asked, other, noted, hymn };
}

test('a row with nothing to enter does not open', () => {
    global.PresenceStore = { release() {}, claim() { return true; }, leave() {} };
    const made = catalogWithQuietRows();
    const form = formWith({ load: async () => ({ catalog: made.catalog, stored: null }) });
    form.liturgyCatalog = made.catalog;
    form.canEdit = false;

    const byKey = Object.fromEntries(form.displayRows.map(row => [row.key, row]));
    assert.equal(form.rowOpens(byKey[made.praise]), false);
    assert.equal(form.rowOpens(byKey[made.asked]), true);
    form.toggleRow(made.asked);
    assert.equal(form.openKey, made.asked);
    form.closeRow();
    assert.equal(form.rowOpens(byKey[made.other]), false);
    assert.equal(form.rowOpens(byKey[made.noted]), true);
    assert.equal(form.rowOpens(byKey[made.hymn]), true);
    assert.equal(form.rowOpens(byKey.callToConfession), true);
    assert.equal(form.rowOpens({ type: 'legacy' }), false);

    form.service.carriedBy[made.praise] = { id: 'p-robin', name: 'Robin Hale' };
    const quiet = Object.fromEntries(form.displayRows.map(row => [row.key, row]));
    assert.equal(quiet[made.praise].prayedByOther, false);
    assert.equal(quiet[made.praise].carrierName, '');
    form.toggleRow(made.praise);
    assert.equal(form.openKey, null);

    form.toggleRow(made.hymn);
    assert.equal(form.openKey, made.hymn);

    form.openKey = made.praise;
    form.releaseQuietRow();
    assert.equal(form.openKey, null);
});
