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
    assert.match(html, /class="lo-workspace" x-show="!loading"/);
    assert.match(html, /class="m-header__actions lo-header__actions"/);
    assert.match(html, /id="liturgy-orders-save"[^>]*x-show="editing"/);
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
    assert.match(js, /type === 'other'/);
    assert.match(js, /LiturgyOrderStore\.load\(db\)/);
    assert.match(js, /legacyPrayerHomes/);
    assert.match(js, /el\.prayedByOther/);
    assert.match(js, /rowOpens\(item\)/);
    assert.match(html, /rowOpens\(item\)/);
    assert.match(html, /station-quiet/);
    assert.doesNotMatch(html, /Nothing to enter/);
    assert.match(html, /x-show="rowOpens\(item\) && !heldBy\(item\.key\)"/);
    const panel = html.indexOf("openKey === item.key || item.type === 'legacy'");
    assert.ok(panel !== -1, 'the row panel is the dropdown');
    assert.ok(panel < html.indexOf('Prayer Leader (Confession)'), 'the confession leader is inside the dropdown');
    assert.ok(panel < html.indexOf('Prayer Leader (Praise)'), 'the praise leader is inside the dropdown');
    assert.ok(panel < html.indexOf('>Pastoral Prayer<'), 'the pastoral fields are inside the dropdown');
    assert.ok(panel < html.indexOf('Who prays '), 'a prayer leader is inside the dropdown');
    const leaderGate = html.indexOf('x-if="item.prayedByOther && service.carriedBy[item.key]"');
    const who = html.indexOf("'Who prays '");
    assert.ok(leaderGate !== -1 && leaderGate < who, 'the person picker is only on a prayer that can be prayed by someone else');
    assert.equal(html.indexOf("'Who prays '", who + 1), -1);
});

test('the Liturgy Orders page uses tabs, a palette, a list, and an inspector', () => {
    const html = read('liturgy-orders.html');
    const js = read('liturgy-orders.js');
    const workspace = html.indexOf('class="lo-workspace"');
    const palette = html.indexOf('class="lo-palette"');
    const order = html.indexOf('id="order-elements"');
    const inspector = html.indexOf('class="lo-inspector"');
    assert.ok(workspace !== -1 && palette > workspace && order > palette && inspector > order);
    assert.match(html, /class="lo-tabs"/);
    assert.match(html, /selectOrder\(o\.id\)/);
    assert.match(html, /addOrder\(\)/);
    assert.match(html, /id="kind-palette"/);
    assert.match(html, /:data-kind="kind"/);
    assert.match(html, /placeKindFromTile\(kind\)/);
    assert.match(html, /kindPointerDown\(\$event, kind\)/);
    assert.match(html, /lo-kind-btn__grip/);
    assert.match(js, /function kindDropIndex/);
    assert.match(js, /lo-drop-line/);
    const desktop = html.slice(html.indexOf('@media (min-width: 1024px)'));
    const paletteRule = desktop.match(/\.lo-palette \{[^}]+\}/);
    assert.ok(paletteRule, 'the desktop palette rule is present');
    assert.match(paletteRule[0], /padding: 16px 12px 20px 16px/);
    assert.doesNotMatch(paletteRule[0], /20px 0/);
    assert.match(html, /Send prayer requests/);
    assert.match(html, /Add a person/);
    assert.match(html, /Days before the Sunday/);
    assert.match(html, /id="prayer-message"/);
    assert.match(html, /id="prayer-response"/);
    assert.doesNotMatch(html, /Days in advance/);
    assert.doesNotMatch(html, /How many/);
    assert.match(html, /Someone other than the service leader may pray it/);
    assert.match(js, /cannot be deleted/);
    assert.match(html, /class="m-page m-page--tool lo-page"/);
    assert.match(html, /\.lo-list \{[^}]*overflow-y: auto/);
    assert.match(js, /function indexInList/);
    assert.match(js, /elementMeta\(el\)/);
    assert.match(js, /placeHint/);
    assert.match(js, /lo-row__handle/);
    assert.match(js, /AccessCore\.pageFlags/);
});

test('the management page loads the order core before its own script', () => {
    const html = read('liturgy-orders.html');
    const core = html.indexOf('src="liturgy-order-core.js"');
    const store = html.indexOf('src="liturgy-order-store.js"');
    const page = html.indexOf('src="liturgy-orders.js"');
    assert.ok(core !== -1 && store !== -1 && page !== -1);
    assert.ok(core < store && store < page);
});
