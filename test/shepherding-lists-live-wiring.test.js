// MS-494 / MS-495 / MS-497 — the Shepherding lists follow changes live.
//
// The dashboard, the People list and the Tags page, on the web and the phone,
// used to read once when they opened. Each now subscribes through live-read.js
// (web) or the phone data layer's watch* functions, stops when it goes, and no
// longer re-reads after its own writes. A delivery never closes what an elder
// has open unless the thing itself has gone.
//
// The web pages are read as source like the other wiring tests, plus one run of
// the dashboard's view adoption in a sandbox.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

function loadsBefore(html, first, second) {
    const a = html.indexOf('src="' + first + '"');
    const b = html.indexOf('src="' + second + '"');
    return a !== -1 && b !== -1 && a < b;
}

test('each web list page loads the live reads before itself', () => {
    [['shepherding-dashboard.html', 'shepherding-dashboard.js'],
        ['shepherding-people.html', 'shepherding-people.js'],
        ['shepherding-tags.html', 'shepherding-tags.js'],
        ['shepherding-documents.html', 'shepherding-documents.js']].forEach(([html, js]) => {
        assert.ok(loadsBefore(read(html), 'live-read.js', js), html + ' does not load live-read.js first');
    });
});

test('the web lists subscribe instead of reading once, and stop when the page goes', () => {
    const dash = read('shepherding-dashboard.js');
    const people = read('shepherding-people.js');
    const tags = read('shepherding-tags.js');
    [['dashboard', dash], ['people', people], ['tags', tags]].forEach(([name, src]) => {
        assert.match(src, /MosaicLiveRead\.watch\(|Live\.watch\(/, name + ' does not subscribe');
        assert.match(src, /addEventListener\('pagehide'/, name + ' keeps listening after it goes');
    });
    assert.ok(!/async load(PanelTasks|Views|People|Tags|TagHolds)\(/.test(dash), 'the dashboard still reads once');
    assert.ok(!/async load(People|Tags|FilterViews|TagHolds)\(/.test(people), 'the People list still reads once');
    assert.ok(!/async loadTags\(/.test(tags), 'the Tags page still reads once');
});

test('nothing re-reads after its own write any more', () => {
    const dash = read('shepherding-dashboard.js');
    assert.ok(!/await this\.load\w+\(\)/.test(dash), 'the dashboard re-reads after a write');
    assert.ok(!/await this\.loadPeople\(\)/.test(read('shepherding-people.js')), 'the People list re-reads after adding somebody');
    const phone = read('mobile/screens-shepherd.js');
    assert.ok(!/reloadViews\(|reloadTasks\(|getShepherdingViews\(\)\.then/.test(phone), 'the phone re-reads after a write');
});

test('the phone lists subscribe on mount and stop on leaving', () => {
    const phone = read('mobile/screens-shepherd.js');
    ['watchShepherdingPanelTasks', 'watchShepherdingViews', 'watchShepherdingPeople',
        'watchShepherdingLastNoteDates', 'watchShepherdingTagActivity'].forEach(fn => {
        assert.ok(phone.includes('data.' + fn + '('), 'the phone does not use ' + fn);
    });
    assert.match(read('mobile/screens-shepherd-tags.js'), /data\.watchShepherdingTags\(/);
    ['mobile/screens-shepherd.js', 'mobile/screens-shepherd-tags.js'].forEach(file => {
        assert.match(read(file), /stops\.forEach\(function \(stop\)/, file + ' never stops its watches');
    });
});

test('Tag-Hold history is only followed while a view needs it (ADR-0011)', () => {
    assert.match(read('shepherding-dashboard.js'), /views\.some\(v => this\.viewHasHoldFilter\(v\)\)\) this\.watchTagHolds\(\)/);
    assert.match(read('mobile/screens-shepherd.js'), /if \(!needsHolds\) return;/);
});

// ── The dashboard's views, arriving ──────────────────────────────────────────

function loadDashboard() {
    let factory = null;
    const sandbox = {
        console, Promise, JSON, Object, Array, String, Math, Date, setTimeout, clearTimeout,
        document: { addEventListener: (name, cb) => { if (name === 'alpine:init') sandbox._init = cb; } },
        Alpine: { data: (name, fn) => { factory = fn; } },
        ShepherdingCore: require('../public/shepherding-core.js'),
        window: { addEventListener: () => {} },
    };
    vm.createContext(sandbox);
    vm.runInContext(read('shepherding-dashboard.js'), sandbox);
    sandbox._init();
    const page = factory();
    page.toasts = [];
    page.showToast = (message, type) => page.toasts.push({ message, type });
    return page;
}

test('an open view editor survives other views changing, and closes when its own view is deleted', () => {
    const page = loadDashboard();
    page.adoptViews([{ id: 'v1', title: 'Red flags' }, { id: 'v2', title: 'New members' }]);
    page.openEditView({ id: 'v1', title: 'Red flags', filterTags: ['t1'] });
    page.newView.title = 'Red flags — being renamed';

    page.adoptViews([{ id: 'v1', title: 'Red flags' }, { id: 'v2', title: 'Renamed by Ann' }, { id: 'v3', title: 'Added' }]);
    assert.strictEqual(page.showViewModal, true);
    assert.strictEqual(page.newView.title, 'Red flags — being renamed', 'what was typed was lost');

    page.adoptViews([{ id: 'v2', title: 'Renamed by Ann' }]);
    assert.strictEqual(page.showViewModal, false);
    assert.strictEqual(page.editingViewId, null);
    assert.match(page.toasts[0].message, /deleted/);
});

test('the selected view moves only when it has gone', () => {
    const page = loadDashboard();
    page.adoptViews([{ id: 'v1' }, { id: 'v2' }]);
    page.selectedViewId = 'v2';
    page.adoptViews([{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }]);
    assert.strictEqual(page.selectedViewId, 'v2');
    page.adoptViews([{ id: 'v1' }, { id: 'v3' }]);
    assert.strictEqual(page.selectedViewId, 'v1');
});
