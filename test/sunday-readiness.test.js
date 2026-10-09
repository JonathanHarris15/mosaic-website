// The home card and the service editor both say how much of a Sunday is left.
// They used to count different slots, so the same service could read
// "7 of 16 set" on the door and "4 of 17 set" in the editor.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Home = require('../public/home-dashboard-core.js');
const { flattenServiceForSave } = require('../public/service-builder.js');

function hymn(name, id) {
    return { name: name, id: id || null };
}

// The Sunday in the report: three leaders and the sermon are in, three hymns
// are linked but pulled out of the order, and the header fields the editor
// used to count on its own (theme, key verse, prayer leaders) are empty.
function reportedSunday() {
    return {
        theme: '',
        keyVerse: '',
        serviceLeader: { name: 'Mark', id: 'sl' },
        musicLeader: { name: 'Hannah', id: 'ml' },
        musicHelpers: [],
        preacher: { name: 'Daniel', id: 'pr' },
        prayerPraise: { name: '', id: null },
        prayerConfession: { name: '', id: null },
        elements: { name: '', id: null },
        other: { name: '', id: null },
        isIrregular: false,
        hasBaptism: false,
        removedHymns: ['hymn1', 'hymn2', 'hymnMid1'],
        notes: {},
        liturgy: {
            preparatoryHymn: hymn('', null),
            callToWorship: '',
            hymn1: hymn('A', '1'),
            hymn2: hymn('B', '2'),
            callToConfession: '',
            assuranceOfPardon: '',
            hymnMid1: hymn('C', '3'),
            hymnMid2: hymn('', null),
            scriptureReading: '',
            sermon: 'Matthew 12:43-45',
            hymnEnd1: hymn('', null),
            hymnEnd2: hymn('', null),
            benediction: '',
            baptism: [],
        },
    };
}

function editorForm(service) {
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout() {}, clearTimeout() {},
        setInterval() {}, clearInterval() {},
        Promise, Date, Object, Array, Math, String, Number, JSON, Set, Map,
        encodeURIComponent, URLSearchParams,
        module: { exports: {} },
        document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } },
        location: { search: '?date=2026-10-11', href: '' },
        auth: { onAuthStateChanged() {} },
        getUserData: async () => ({}),
        db: {},
        firebase: { firestore: { FieldValue: {} } },
        navigator: { userAgent: '' },
        HomeDashboard: Home,
        LiturgyOrderCore: require('../public/liturgy-order-core.js'),
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '../public/service-builder.js'), 'utf8'),
        sandbox,
        { filename: 'service-builder.js' }
    );
    const form = sandbox.serviceForm();
    form.service = service;
    form.$nextTick = function (fn) { fn(); };
    return { form: form, sandbox: sandbox };
}

test('the reported Sunday is one tally on the door and in the editor', () => {
    const service = reportedSunday();
    const door = Home.readiness(flattenServiceForSave(service));
    const editor = editorForm(service).form.filledLabel;
    assert.equal(door.fraction, '4 of 13 set');
    assert.equal(editor, door.fraction);
    assert.equal(door.notReady, true);
    // Blanks are named in the order the Sunday follows (ADR-0080).
    assert.deepEqual(door.blanks.slice(0, 2), ['Preparatory Hymn', 'Call to Worship']);
});

test('a hymn pulled out of the order is not work left and not work done', () => {
    const ready = Home.readiness({
        serviceLeader: 'Mark',
        removedHymns: ['hymnEnd2'],
        liturgy: { hymnEnd2: hymn('G', '7'), sermon: 'Psalm 23' },
    });
    const labels = Home.checklist({
        removedHymns: ['hymnEnd2'],
        liturgy: { hymnEnd2: hymn('G', '7') },
    }).map(function (item) { return item.label; });
    assert.ok(labels.indexOf('Closing Hymn') === -1);
    assert.ok(ready.blanks.indexOf('Closing Hymn') === -1);
    assert.equal(ready.set, 2);
});

test('an unlinked hymn is unfinished on both surfaces, and theme does not change the tally', () => {
    const service = reportedSunday();
    service.removedHymns = [];
    service.liturgy.hymn1 = hymn('Amazing Grace', null);
    service.liturgy.hymn2 = hymn('', null);
    service.liturgy.hymnMid1 = hymn('', null);
    service.theme = 'A full theme';
    service.keyVerse = 'Psalm 23:1';
    service.prayerPraise = { name: 'Ada', id: 'ada' };
    const door = Home.readiness(flattenServiceForSave(service));
    assert.deepEqual(door.literals, ['Hymn of Praise']);
    assert.equal(door.set, 4);
    assert.equal(editorForm(service).form.filledLabel, door.fraction);
});

test('fix the blanks lands on the first slot the tally still calls unfinished', () => {
    const loaded = editorForm(reportedSunday());
    const asked = [];
    loaded.sandbox.document.querySelector = function (sel) {
        asked.push(sel);
        return null;
    };
    loaded.form.validateForm();
    assert.deepEqual(asked.slice(0, 3), [
        '[data-field-key="preparatoryHymn"]',
        '[data-field-key="callToWorship"]',
        '[data-field-key="callToConfession"]',
    ]);
});

test('the phone home passes removed hymns into the same tally', () => {
    const src = fs.readFileSync(path.join(__dirname, '../public/mobile/data.js'), 'utf8');
    const fn = src.slice(src.indexOf('function mapService'), src.indexOf('function loadServices'));
    assert.match(fn, /removedHymns/);
});

test('the service editor loads the shared tally', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/service-builder.html'), 'utf8');
    const core = html.indexOf('<script src="home-dashboard-core.js">');
    const builder = html.indexOf('<script src="service-builder.js">');
    assert.ok(core !== -1 && builder !== -1 && core < builder);
});
