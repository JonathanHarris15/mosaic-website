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

test('the management page loads the order core before its own script', () => {
    const html = read('liturgy-orders.html');
    const core = html.indexOf('src="liturgy-order-core.js"');
    const store = html.indexOf('src="liturgy-order-store.js"');
    const page = html.indexOf('src="liturgy-orders.js"');
    assert.ok(core !== -1 && store !== -1 && page !== -1);
    assert.ok(core < store && store < page);
});
