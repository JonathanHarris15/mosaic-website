// Liturgy Orders (ADR-0080): the Standard seed, the table-mode column union,
// and the edits the management page makes.

const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/liturgy-order-core.js');

const STANDARD_IDS = [
    'preparatoryHymn', 'callToWorship', 'hymn1', 'hymn2', 'callToConfession',
    'assuranceOfPardon', 'hymnMid1', 'hymnMid2', 'scriptureReading', 'sermon',
    'baptism', 'hymnEnd1', 'hymnEnd2', 'benediction',
];

test('the Standard seed carries the fourteen elements in service order', () => {
    assert.equal(Core.STANDARD_ORDER.id, 'standard');
    assert.equal(Core.STANDARD_ORDER.name, 'Standard');
    assert.deepEqual(Array.from(Core.STANDARD_ORDER.elementIds), STANDARD_IDS);
    assert.deepEqual(Core.STANDARD_ELEMENTS.map(el => el.id), STANDARD_IDS);
});

test('the Standard seed names, primitives, and flags', () => {
    const rows = Core.STANDARD_ELEMENTS.map(el => [el.id, el.name, el.primitive]);
    assert.deepEqual(rows, [
        ['preparatoryHymn', 'Preparatory Hymn', 'song'],
        ['callToWorship', 'Call to Worship', 'scripture'],
        ['hymn1', 'Hymn 1', 'song'],
        ['hymn2', 'Hymn 2', 'song'],
        ['callToConfession', 'Call to Confession', 'scripture'],
        ['assuranceOfPardon', 'Assurance of Pardon', 'scripture'],
        ['hymnMid1', 'Hymn 3', 'song'],
        ['hymnMid2', 'Hymn 4', 'song'],
        ['scriptureReading', 'Pastoral Prayer', 'scripture'],
        ['sermon', 'Sermon', 'scripture'],
        ['baptism', 'Baptism', 'people'],
        ['hymnEnd1', 'Closing Hymn', 'song'],
        ['hymnEnd2', 'Final Hymn', 'song'],
        ['benediction', 'Benediction', 'scripture'],
    ]);
    Core.STANDARD_ELEMENTS.forEach(el => {
        assert.equal(el.hasRole, false, el.id);
        assert.equal(el.hasNote, true, el.id);
    });
});

test('an empty collection reads as the seed, and Standard is always there', () => {
    const empty = Core.catalogFrom({ elements: [], orders: [] });
    assert.deepEqual(empty.orders.map(o => o.id), ['standard']);
    assert.deepEqual(empty.elements.map(el => el.id), STANDARD_IDS);

    const saved = Core.catalogFrom({
        elements: [{ id: 'offertory', name: 'Offertory', primitive: 'text' }],
        orders: [{ id: 'evening', name: 'Evening', elementIds: ['offertory', 'offertory'] }],
    });
    assert.deepEqual(saved.orders.map(o => o.id), ['standard', 'evening']);
    assert.deepEqual(saved.orders[1].elementIds, ['offertory']);
});

test('a stored element with an unknown primitive is dropped, not guessed', () => {
    const cat = Core.catalogFrom({
        elements: [{ id: 'a', name: 'A', primitive: 'song' }, { id: 'b', name: 'B', primitive: 'video' }],
    });
    assert.deepEqual(cat.elements.map(el => el.id), ['a']);
});

test('a Sunday with no order, or a deleted one, follows Standard', () => {
    const cat = Core.standardCatalog();
    assert.equal(Core.orderFor({}, cat).id, 'standard');
    assert.equal(Core.orderFor({ liturgyOrderId: 'gone' }, cat).id, 'standard');
    assert.deepEqual(Core.elementsFor({}, cat).map(el => el.id), STANDARD_IDS);
});

function twoOrderCatalog() {
    let cat = Core.standardCatalog();
    let made = Core.addElement(cat, { name: 'Offertory', primitive: 'text', hasRole: true });
    cat = made.catalog;
    made = Core.addOrder(cat, { name: 'Lessons and Carols' });
    cat = made.catalog;
    cat = Core.addToOrder(cat, made.order.id, 'callToWorship');
    cat = Core.addToOrder(cat, made.order.id, 'offertory');
    cat = Core.addToOrder(cat, made.order.id, 'benediction');
    return cat;
}

test('table columns: a shared element is one column, and Standard comes first', () => {
    const cat = twoOrderCatalog();
    const both = Core.tableColumns(cat, ['lessonsAndCarols', 'standard']).map(el => el.id);
    assert.deepEqual(both, STANDARD_IDS.concat(['offertory']));
    assert.equal(both.filter(id => id === 'callToWorship').length, 1);
    assert.equal(both.filter(id => id === 'benediction').length, 1);
});

test('table columns: the other orders follow by name, each element at first sight', () => {
    let cat = twoOrderCatalog();
    const made = Core.addOrder(cat, { name: 'Advent' });
    cat = Core.addToOrder(made.catalog, 'advent', 'offertory');
    cat = Core.addToOrder(cat, 'advent', 'hymn1');
    const cols = Core.tableColumns(cat, ['lessonsAndCarols', 'advent']).map(el => el.id);
    assert.deepEqual(cols, ['offertory', 'hymn1', 'callToWorship', 'benediction']);
    assert.deepEqual(Core.toggledOrders(cat, ['lessonsAndCarols', 'advent', 'standard']).map(o => o.id),
        ['standard', 'advent', 'lessonsAndCarols']);
});

test('the toggles default to Standard alone and forget orders that are gone', () => {
    const cat = twoOrderCatalog();
    assert.deepEqual(Core.readToggles(null, cat), ['standard']);
    assert.deepEqual(Core.readToggles(['gone'], cat), ['standard']);
    assert.deepEqual(Core.readToggles(['gone', 'lessonsAndCarols'], cat), ['lessonsAndCarols']);
    assert.deepEqual(Core.readToggles([], cat), []);
});

test('an element appears at most once per order', () => {
    let cat = twoOrderCatalog();
    cat = Core.addToOrder(cat, 'lessonsAndCarols', 'offertory');
    const order = Core.orderById(cat, 'lessonsAndCarols');
    assert.deepEqual(order.elementIds, ['callToWorship', 'offertory', 'benediction']);
});

test('deleting an element removes it from every order', () => {
    const cat = Core.deleteElement(twoOrderCatalog(), 'callToWorship');
    assert.equal(Core.elementById(cat, 'callToWorship'), null);
    cat.orders.forEach(o => assert.ok(o.elementIds.indexOf('callToWorship') === -1, o.id));
});

test('a new element id is stable, readable, and never a reserved or taken key', () => {
    let cat = Core.standardCatalog();
    const a = Core.addElement(cat, { name: 'Hymn 1', primitive: 'song' });
    assert.equal(a.element.id, 'hymn12');
    const b = Core.addElement(cat, { name: 'Theme', primitive: 'text' });
    assert.equal(b.element.id, 'theme2');
    cat = Core.updateElement(b.catalog, 'theme2', { name: 'Season' });
    assert.equal(Core.elementById(cat, 'theme2').name, 'Season');
    assert.throws(() => Core.addElement(cat, { name: 'Clip', primitive: 'video' }));
});

test('a scripture is titled on the order and the kind is called Scripture', () => {
    assert.equal(Core.KIND_LABELS.scripture, 'Scripture');
    assert.equal(Core.PRIMITIVE_LABELS.scripture, 'Scripture');
    assert.equal(Core.kindTakesName('scripture'), true);
    assert.equal(Core.kindTakesName('hymn'), false);
    const made = Core.placeKind(Core.standardCatalog(), 'standard', 'scripture', 2);
    assert.equal(made.element.name, 'Scripture');
    assert.equal(made.element.hasRole, false);
    const renamed = Core.updateElement(made.catalog, made.element.id, { name: 'The Epistle' });
    assert.equal(Core.elementById(renamed, made.element.id).name, 'The Epistle');
    const round = Core.normaliseElement({ id: made.element.id, kind: 'scripture', name: 'The Epistle' });
    assert.equal(round.name, 'The Epistle');
    assert.equal(round.kind, 'scripture');
});

test('a kind lands where it was dropped, not at the top', () => {
    const made = Core.placeKind(Core.standardCatalog(), 'standard', 'other', 3, { name: 'Offertory' });
    assert.equal(made.catalog.orders[0].elementIds[3], made.element.id);
    assert.equal(made.catalog.orders[0].elementIds[0], 'preparatoryHymn');
});

test('a prayer can be prayed by someone other than the service leader', () => {
    const made = Core.placeKind(Core.standardCatalog(), 'standard', 'prayer', 1, { name: 'Opening Prayer' });
    assert.equal(made.element.prayedByOther, false);
    assert.equal(made.element.hasRole, false);
    const on = Core.updateElement(made.catalog, made.element.id, { prayedByOther: true });
    const el = Core.elementById(on, made.element.id);
    assert.equal(el.prayedByOther, true);
    assert.equal(el.hasRole, false);
    const round = Core.normaliseElement({ id: el.id, kind: 'prayer', name: el.name, prayedByOther: true });
    assert.equal(round.prayedByOther, true);
    assert.equal(round.hasRole, false);
    const off = Core.updateElement(on, el.id, { prayedByOther: false });
    assert.equal(Core.elementById(off, el.id).prayedByOther, false);
    const hymn = Core.updateElement(off, 'hymn1', { prayedByOther: true });
    assert.ok(!Core.elementById(hymn, 'hymn1').prayedByOther);
});

test('a prayer that sends requests keeps one line per person and a list of days', () => {
    const made = Core.placeKind(Core.standardCatalog(), 'standard', 'prayer', 0, { name: 'Pastoral Prayer' });
    const on = Core.updateElement(made.catalog, made.element.id, { requests: { people: [{ who: 'either' }] } });
    const el = Core.elementById(on, made.element.id);
    assert.deepEqual(el.noticeDays, [5, 3, 1]);
    assert.deepEqual(el.requests.people, [{ who: 'either' }]);
    const lines = Core.updateElement(on, el.id, {
        requests: { people: [{ who: 'female' }, { who: 'male' }] },
    });
    const lined = Core.elementById(lines, el.id);
    assert.equal(lined.requests.count, 2);
    assert.deepEqual(lined.requests.people, [{ who: 'female' }, { who: 'male' }]);
    assert.equal(lined.requests.who, 'either');
    const sooner = Core.updateElement(lines, el.id, { noticeDays: [10, 4, 1] });
    assert.deepEqual(Core.elementById(sooner, el.id).noticeDays, [10, 4, 1]);
    const quiet = Core.updateElement(sooner, el.id, { noticeDays: [] });
    assert.deepEqual(Core.elementById(quiet, el.id).noticeDays, []);
    const off = Core.updateElement(quiet, el.id, { requests: null });
    assert.equal(Core.elementById(off, el.id).noticeDays, null);
    const round = Core.normaliseElement({
        id: el.id, kind: 'prayer', name: el.name,
        requests: { count: 2, who: 'male' }, noticeDays: 7,
    });
    assert.equal(round.requests.count, 2);
    assert.deepEqual(round.requests.people, [{ who: 'male' }, { who: 'male' }]);
    assert.deepEqual(round.noticeDays, [7, 5]);
    const words = Core.updateElement(on, el.id, {
        message: '  Pray for {name}. {link}  ',
        response: 'Thank you, {name}.',
    });
    const written = Core.elementById(words, el.id);
    assert.equal(written.message, 'Pray for {name}. {link}');
    assert.equal(written.response, 'Thank you, {name}.');
});

test('older prayer fields sit under the seed rows they belong with', () => {
    const order = Core.standardCatalog().orders[0];
    const homes = Core.legacyPrayerHomes(order, 'Pastoral Prayer');
    assert.equal(homes.praiseId, 'callToWorship');
    assert.equal(homes.confessionId, 'callToConfession');
    assert.equal(homes.pastoralId, 'scriptureReading');
    const renamed = Core.legacyPrayerHomes(order, 'congregational prayer');
    assert.equal(renamed.pastoralId, null);
    const stripped = {
        elements: order.elements.filter(function (el) { return el.id !== 'callToWorship'; }),
    };
    assert.equal(Core.legacyPrayerHomes(stripped, 'Pastoral Prayer').praiseId, null);
});

test('moving within an order reorders it and the source catalog is untouched', () => {
    const cat = Core.standardCatalog();
    const moved = Core.moveInOrder(cat, 'standard', 0, 2);
    assert.deepEqual(moved.orders[0].elementIds.slice(0, 3), ['callToWorship', 'hymn1', 'preparatoryHymn']);
    assert.equal(cat.orders[0].elementIds[0], 'preparatoryHymn');
});

test('Standard cannot be deleted; another order can', () => {
    const cat = twoOrderCatalog();
    assert.throws(() => Core.deleteOrder(cat, 'standard'));
    assert.deepEqual(Core.deleteOrder(cat, 'lessonsAndCarols').orders.map(o => o.id), ['standard']);
});

test('an element is one record; each order keeps its own sequence of ids', () => {
    let cat = Core.standardCatalog();
    const made = Core.addElement(cat, { name: 'Offertory', primitive: 'text' });
    cat = made.catalog;
    const elementId = made.element.id;
    const carols = Core.addOrder(cat, { name: 'Lessons and Carols' });
    cat = carols.catalog;
    const communion = Core.addOrder(cat, { name: 'Communion Sunday' });
    cat = communion.catalog;
    cat = Core.addToOrder(cat, carols.order.id, elementId, 0);
    cat = Core.addToOrder(cat, communion.order.id, 'hymn1', 0);
    cat = Core.addToOrder(cat, communion.order.id, elementId, 1);
    const reordered = Core.moveInOrder(cat, communion.order.id, 0, 1);

    assert.equal(Core.elementById(reordered, elementId).name, 'Offertory');
    assert.equal(reordered.elements.filter(el => el.id === elementId).length, 1);
    assert.deepEqual(Core.orderById(reordered, carols.order.id).elementIds, [elementId]);
    assert.deepEqual(Core.orderById(reordered, communion.order.id).elementIds.slice(0, 2), [elementId, 'hymn1']);
    assert.equal(Core.orderById(cat, communion.order.id).elementIds[0], 'hymn1');
});

test('validateCatalog finds a duplicate id and an order naming a missing element', () => {
    const cat = Core.standardCatalog();
    cat.elements.push({ id: 'hymn1', name: 'Again', primitive: 'song' });
    cat.orders[0].elementIds.push('ghost');
    const problems = Core.validateCatalog(cat);
    assert.ok(problems.some(p => /share the id "hymn1"/.test(p)));
    assert.ok(problems.some(p => /gone/.test(p)));
    assert.deepEqual(Core.validateCatalog(Core.standardCatalog()), []);
});
