// The home card and the service editor both say how much of a Sunday is left.
// They used to count different slots, so the same service could read
// "7 of 16 set" on the door and "4 of 17 set" in the editor.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Home = require('../public/home-dashboard-core.js');
const { flattenServiceForSave, changedFieldPaths, FIELD_DELETE } = require('../public/service-builder.js');

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
        carriedBy: {},
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
    service.carriedBy = { prayerOfPraise: { name: 'Ada', id: 'ada' } };
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

test('the editor does not count a may-pray prayer until a leader is added', () => {
    const Liturgy = require('../public/liturgy-order-core.js');
    const praise = Liturgy.placeKind(Liturgy.standardCatalog(), 'standard', 'prayer', 0, {
        name: 'Prayer of Praise',
        prayedByOther: true,
    });
    const confession = Liturgy.placeKind(praise.catalog, 'standard', 'prayer', 1, {
        name: 'Prayer of Confession',
        prayedByOther: true,
    });
    const catalog = confession.catalog;
    const praiseId = praise.element.id;
    const confessionId = confession.element.id;
    const service = reportedSunday();
    service.removedHymns = [];
    service.liturgy.hymn1 = hymn('A', '1');
    service.liturgy.hymn2 = hymn('B', '2');
    service.liturgy.hymnMid1 = hymn('C', '3');
    const loaded = editorForm(service);
    loaded.form.liturgyCatalog = catalog;
    loaded.form._ensureLiturgySlots();
    assert.equal(loaded.form.service.carriedBy[praiseId], undefined);
    assert.equal(loaded.form.service.carriedBy[confessionId], undefined);

    const before = Home.readiness(flattenServiceForSave(loaded.form.service), catalog);
    assert.equal(loaded.form.filledLabel, before.fraction);
    assert.equal(
        before.blanks.indexOf('Prayer of Praise'),
        -1
    );

    loaded.form.addPrayerLeader(praiseId);
    const oneEmpty = Home.readiness(flattenServiceForSave(loaded.form.service), catalog);
    assert.equal(oneEmpty.total, before.total + 1);
    assert.equal(oneEmpty.set, before.set);
    assert.equal(loaded.form.filledLabel, oneEmpty.fraction);
    assert.equal(loaded.form.prayerLeaderOpen(praiseId), true);
    assert.equal(loaded.form.prayerLeaderOpen(confessionId), false);

    loaded.form.service.carriedBy[praiseId].id = 'p1';
    loaded.form.service.carriedBy[praiseId].name = 'Ada Example';
    const oneFilled = Home.readiness(flattenServiceForSave(loaded.form.service), catalog);
    assert.equal(oneFilled.total, before.total + 1);
    assert.equal(oneFilled.set, before.set + 1);
    assert.equal(loaded.form.filledLabel, oneFilled.fraction);

    loaded.form.addPrayerLeader(confessionId);
    loaded.form.service.carriedBy[confessionId].id = 'p2';
    loaded.form.service.carriedBy[confessionId].name = 'Owen Example';
    const twoFilled = Home.readiness(flattenServiceForSave(loaded.form.service), catalog);
    assert.equal(twoFilled.total, before.total + 2);
    assert.equal(twoFilled.set, before.set + 2);
    assert.equal(loaded.form.filledLabel, twoFilled.fraction);

    const namedPraise = flattenServiceForSave(JSON.parse(JSON.stringify(loaded.form.service)));
    loaded.form.clearPrayerLeader(praiseId);
    const cleared = Home.readiness(flattenServiceForSave(loaded.form.service), catalog);
    assert.equal(cleared.total, before.total + 2);
    assert.equal(cleared.set, before.set + 1);
    assert.equal(loaded.form.service.carriedBy[praiseId].name, '');
    assert.equal(loaded.form.service.carriedBy[praiseId].id, null);
    assert.equal(loaded.form.filledLabel, cleared.fraction);
    const clearedSlot = changedFieldPaths(namedPraise, flattenServiceForSave(loaded.form.service))['carriedBy.' + praiseId];
    assert.equal(clearedSlot.name, '');
    assert.equal(clearedSlot.id, null);
    assert.notStrictEqual(clearedSlot, FIELD_DELETE);

    const emptyPraise = flattenServiceForSave(JSON.parse(JSON.stringify(loaded.form.service)));
    loaded.form.clearPrayerLeader(praiseId);
    const removed = Home.readiness(flattenServiceForSave(loaded.form.service), catalog);
    assert.equal(removed.total, before.total + 1);
    assert.equal(loaded.form.service.carriedBy[praiseId], undefined);
    assert.equal(loaded.form.filledLabel, removed.fraction);
    const dropped = changedFieldPaths(emptyPraise, flattenServiceForSave(loaded.form.service));
    assert.strictEqual(dropped['carriedBy.' + praiseId], FIELD_DELETE);
});

test('a may-pray row does not ask for a name until a leader is added', () => {
    const Liturgy = require('../public/liturgy-order-core.js');
    const praise = Liturgy.placeKind(Liturgy.standardCatalog(), 'standard', 'prayer', 0, {
        name: 'Prayer of Praise',
        prayedByOther: true,
    });
    const catalog = praise.catalog;
    const praiseId = praise.element.id;
    const service = reportedSunday();
    const form = editorForm(service).form;
    form.liturgyCatalog = catalog;
    form._ensureLiturgySlots();

    const closed = form.rows.find(function (row) { return row.key === praiseId; });
    assert.equal(closed.value, '');
    assert.equal(closed.emptyLabel, '');
    assert.equal(closed.status, 'empty');

    form.addPrayerLeader(praiseId);
    const open = form.rows.find(function (row) { return row.key === praiseId; });
    assert.equal(open.value, '');
    assert.equal(open.emptyLabel, 'Name who prays…');

    form.service.carriedBy[praiseId].id = 'p1';
    form.service.carriedBy[praiseId].name = 'Ada Example';
    const named = form.rows.find(function (row) { return row.key === praiseId; });
    assert.equal(named.value, 'Ada Example');
    assert.equal(named.emptyLabel, '');
    assert.equal(named.status, 'people');
});

test('the service editor loads the shared tally', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/service-builder.html'), 'utf8');
    const core = html.indexOf('<script src="home-dashboard-core.js">');
    const builder = html.indexOf('<script src="service-builder.js">');
    assert.ok(core !== -1 && builder !== -1 && core < builder);
});
