const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// ADR-0080. The pages a Liturgy Order is chosen and managed from, read as
// text: the legacy generator is off the user path, the Order of Service
// header selects the Sunday's order, and the management page is reachable.

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

test('the Order of Service has no "Use legacy system" toggle', () => {
    const html = read('service-builder.html');
    assert.doesNotMatch(html, /Use legacy system/i);
    assert.doesNotMatch(html, /guideSystem/);
});

test('the Order of Service header selects this Sunday\'s Liturgy Order', () => {
    const html = read('service-builder.html');
    assert.match(html, /<select id="liturgy-order-select"/);
    assert.match(html, /for="liturgy-order-select"/, 'the dropdown has a label');
    assert.match(html, /href="'liturgy-orders\.html\?date=/, 'the manage control opens the management page');
});

test('no page routes a Sunday to the legacy generator', () => {
    ['service-builder.html', 'service-builder.js', 'service-calendar.html', 'service-calendar.js',
        'service-guide-editor.html', 'service-guide-editor.js', 'guide-store.js', 'mobile/app.js']
        .forEach((f) => assert.doesNotMatch(read(f), /service-guide\.html/, f));
});

test('the calendar\'s table mode toggles orders and links the management page', () => {
    const html = read('service-calendar.html');
    assert.match(html, /id="table-orders"/);
    assert.match(html, /toggleTableOrder\(o\.id\)/);
    assert.match(html, /href="liturgy-orders\.html"/);
});

test('a failed read keeps the orders on screen and does not treat Standard as a draft', () => {
    const html = read('liturgy-orders.html');
    const js = read('liturgy-orders.js');
    assert.match(html, /class="lo-stack" x-show="!loading"/);
    assert.doesNotMatch(html, /lo-stack" x-show="!loading && !problem"/);
    assert.match(html, /m-header__actions" x-show="editing"/);
    assert.match(js, /permissions problem, not a connection problem/);
    assert.match(js, /this\.baseline = JSON\.stringify\(catalog\)/);
});

test('the Order of Service fills a locked order and does not compose it', () => {
    const html = read('service-builder.html');
    const js = read('service-builder.js');
    assert.doesNotMatch(html, /id="element-library"/);
    assert.doesNotMatch(html, /sortable-1\.15\.0\.min\.js/);
    assert.doesNotMatch(html, /placeKind\(kind\)/);
    assert.doesNotMatch(html, /moveOrderRow\(/);
    assert.doesNotMatch(html, /takeFromOrder\(/);
    assert.doesNotMatch(js, /LiturgyOrderStore\.save/);
    assert.doesNotMatch(js, /function indexInList/);
    assert.match(html, /showsPraise\(item\)/);
    assert.match(html, /showsConfession\(item\)/);
    assert.match(html, /showsPastoral\(item\)/);
    assert.match(html, /Prayer Leader \(Praise\)/);
    assert.match(html, /Male Being Prayed For/);
    assert.match(html, /item\.type === 'prayer'/);
    assert.match(html, /Who prays /);
    assert.doesNotMatch(html, /Scripture Reading/);
    assert.match(html, /item\.type === 'person'/);
    assert.match(html, /item\.type === 'other'/);
    assert.match(js, /LiturgyOrderStore\.load\(db\)/);
    assert.match(js, /legacyPrayerHomes/);
    assert.match(js, /el\.prayedByOther/);
});

test('the Liturgy Orders page drags the collection into the selected order', () => {
    const html = read('liturgy-orders.html');
    const js = read('liturgy-orders.js');
    const grid = html.indexOf('class="lo-grid"');
    const library = html.indexOf('id="element-library"');
    const order = html.indexOf('id="order-elements"');
    assert.ok(grid !== -1 && library > grid && library < order, 'the kinds are the left panel of the order');
    assert.match(html, /id="order-picker"/);
    assert.match(html, /selectOrder\(\$event\.target\.value\)/);
    assert.match(html, /aria-label="New order"/);
    assert.match(html, /addOrder\(\)/);
    assert.match(html, /placeKind\(kind\)/);
    assert.match(html, /Send prayer requests/);
    assert.match(html, /Days in advance/);
    assert.match(html, /Prayed by someone other than the service leader/);
    assert.match(html, /A name here, and a reference on the Sunday/);
    assert.match(html, /class="m-page m-page--tool"/);
    assert.match(html, /class="m-section lo-kinds"/);
    assert.match(html, /class="m-section lo-order"/);
    assert.match(html, /#order-elements \{[^}]*overflow-y: auto/);
    assert.match(js, /function indexInList/);
    const onAdd = js.slice(js.indexOf('onAdd:'), js.indexOf('onEnd:'));
    assert.match(onAdd, /indexInList\(evt\.to, evt\.item\)/);
    assert.doesNotMatch(onAdd, /newDraggableIndex/);
    const librarySortable = js.slice(js.indexOf("getElementById('element-library')"), js.indexOf("getElementById('order-elements')"));
    assert.match(librarySortable, /pull: 'clone'/);
    assert.match(librarySortable, /preventOnFilter: false/);
    assert.doesNotMatch(librarySortable, /handle:/, 'the kind row itself drags');
    assert.match(js, /placeKind\(kind, to\)/);
});

test('the management page loads the order core before its own script', () => {
    const html = read('liturgy-orders.html');
    const core = html.indexOf('src="liturgy-order-core.js"');
    const store = html.indexOf('src="liturgy-order-store.js"');
    const page = html.indexOf('src="liturgy-orders.js"');
    assert.ok(core !== -1 && store !== -1 && page !== -1);
    assert.ok(core < store && store < page);
});
