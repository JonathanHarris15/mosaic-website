// The liturgy translator. Same id and a unique name stay in code. Anything
// still open is either Jev's distribution or, when Jev did not answer, the
// next unused element of that kind. Baptism stays blank unless the source
// actually has a baptism. What does not fit is a leftover.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Translate = require('../public/liturgy-translate-core.js');
const Orders = require('../public/liturgy-order-core.js');

function el(id, name, kind, extra) {
    const item = { id: id, name: name, kind: kind, hasNote: true, requests: null };
    return Object.assign(item, extra || {});
}

function order(id, name, elements) {
    return { id: id, name: name, elements: elements };
}

function hymn(name) {
    return { id: null, name: name };
}

function serviceWith(orderElements, liturgy, extras) {
    return Object.assign({
        liturgyOrderId: 'from',
        liturgy: liturgy,
        notes: {},
        carriedBy: {},
        liturgyLeftovers: [],
    }, extras || {}, { _orderElements: orderElements });
}

test('three hymns and a prayer fill two hymns and the prayer, and the extra hymn is left over', () => {
    const from = order('from', 'Order 1', [
        el('h1', 'Hymn', 'hymn'),
        el('h2', 'Hymn', 'hymn'),
        el('p1', 'Prayer', 'prayer'),
        el('h3', 'Hymn', 'hymn'),
    ]);
    const to = order('to', 'Order 2', [
        el('o1', 'Hymn', 'hymn'),
        el('baptism', 'Baptism', 'person'),
        el('p2', 'Prayer', 'prayer'),
        el('o2', 'Hymn', 'hymn'),
    ]);
    const sunday = {
        liturgy: {
            h1: hymn('Holy Holy Holy'),
            h2: hymn('It Is Well'),
            p1: [],
            h3: hymn('Doxology'),
        },
        notes: { p1: '<p>the sick</p>' },
        carriedBy: {},
        liturgyLeftovers: [],
    };
    const sources = Translate.filledItemsFromService(sunday, from);
    const plan = Translate.plan(sources, Translate.targetsFromOrder(to), { mode: 'order' });

    const byTarget = {};
    plan.placements.forEach(function (placement) { byTarget[placement.targetId] = placement; });
    assert.equal(byTarget.o1.value.name, 'Holy Holy Holy');
    assert.equal(byTarget.o2.value.name, 'It Is Well');
    assert.equal(byTarget.p2.note, '<p>the sick</p>');
    assert.equal(byTarget.baptism, undefined);
    assert.ok(plan.blanks.indexOf('baptism') !== -1);
    assert.equal(plan.leftovers.length, 1);
    assert.equal(plan.leftovers[0].sourceId, 'h3');
    assert.equal(plan.leftovers[0].value.name, 'Doxology');
    assert.equal(plan.judge, 'order');
});

test('the same element id stays put, and a differently named twin does not steal it', () => {
    const sources = [
        {
            sourceId: 'hymn1', origin: 'element', kind: 'hymn', name: 'Hymn 1',
            position: 0, value: hymn('Holy Holy Holy'), note: '', people: false, requests: null,
        },
        {
            sourceId: 'hymn2', origin: 'element', kind: 'hymn', name: 'Hymn 2',
            position: 1, value: hymn('It Is Well'), note: '', people: false, requests: null,
        },
    ];
    const targets = Translate.targetsFromOrder(order('std', 'Standard', [
        el('hymn1', 'Hymn 1', 'hymn'),
        el('opening', 'Opening Hymn', 'hymn'),
    ]));
    const plan = Translate.plan(sources, targets);
    const byTarget = {};
    plan.placements.forEach(function (placement) { byTarget[placement.targetId] = placement; });
    assert.equal(byTarget.hymn1.sourceId, 'hymn1');
    assert.equal(byTarget.hymn1.method, 'id');
    assert.equal(byTarget.opening.sourceId, 'hymn2');
    assert.equal(byTarget.opening.value.name, 'It Is Well');
});

test('unique names beat position, so a middle hymn is not poured into the closing slot', () => {
    const sources = [
        {
            sourceId: 'a', origin: 'element', kind: 'hymn', name: 'Opening Hymn',
            position: 0, value: hymn('Holy Holy Holy'), note: '', people: false, requests: null,
        },
        {
            sourceId: 'b', origin: 'element', kind: 'hymn', name: 'Sermon Hymn',
            position: 1, value: hymn('It Is Well'), note: '', people: false, requests: null,
        },
        {
            sourceId: 'c', origin: 'element', kind: 'hymn', name: 'Closing Hymn',
            position: 2, value: hymn('Doxology'), note: '', people: false, requests: null,
        },
    ];
    const targets = Translate.targetsFromOrder(order('short', 'Short', [
        el('open', 'Opening Hymn', 'hymn'),
        el('close', 'Closing Hymn', 'hymn'),
    ]));
    const plan = Translate.plan(sources, targets);
    const byTarget = {};
    plan.placements.forEach(function (placement) { byTarget[placement.targetId] = placement; });
    assert.equal(byTarget.open.value.name, 'Holy Holy Holy');
    assert.equal(byTarget.open.method, 'name');
    assert.equal(byTarget.close.value.name, 'Doxology');
    assert.equal(plan.leftovers.length, 1);
    assert.equal(plan.leftovers[0].value.name, 'It Is Well');
});

test('baptism candidates do not land on a different person event', () => {
    const sources = Translate.filledItemsFromService({
        liturgy: { baptism: [{ id: 'p1', name: 'Jane Doe' }] },
        notes: {},
        carriedBy: {},
        liturgyLeftovers: [],
    }, order('from', 'From', [el('baptism', 'Baptism', 'person')]));
    const targets = Translate.targetsFromOrder(order('to', 'To', [
        el('testimony', 'Testimony', 'person'),
    ]));
    const plan = Translate.plan(sources, targets);
    assert.equal(plan.placements.length, 0);
    assert.equal(plan.leftovers.length, 1);
    assert.equal(plan.leftovers[0].sourceId, 'baptism');
    assert.equal(plan.leftovers[0].people, true);
});

test('moving a hymn clears the old slot in place and writes the new one', () => {
    const hymn1 = { id: 'h-1', name: 'Holy Holy Holy' };
    const sunday = {
        liturgyOrderId: 'from',
        liturgy: { hymn1: hymn1, hymn2: { id: null, name: 'It Is Well' } },
        notes: { hymn1: 'check the key' },
        carriedBy: {},
        liturgyLeftovers: [],
    };
    const from = order('from', 'From', [
        el('hymn1', 'Hymn 1', 'hymn'),
        el('hymn2', 'Hymn 2', 'hymn'),
    ]);
    const to = order('to', 'To', [el('opening', 'Opening Hymn', 'hymn')]);
    const plan = Translate.plan(Translate.filledItemsFromService(sunday, from), Translate.targetsFromOrder(to));
    Translate.applyToService(sunday, to, plan);

    assert.equal(sunday.liturgyOrderId, 'to');
    assert.equal(sunday.liturgy.hymn1, hymn1, 'the picker keeps its object');
    assert.equal(hymn1.name, '');
    assert.equal(hymn1.id, null);
    assert.equal(sunday.notes.hymn1, '');
    assert.equal(sunday.liturgy.opening.name, 'Holy Holy Holy');
    assert.equal(sunday.notes.opening, 'check the key');
    assert.equal(sunday.liturgyLeftovers.length, 1);
    assert.equal(sunday.liturgyLeftovers[0].value.name, 'It Is Well');
    assert.equal(sunday.liturgy.hymn2.name, '');
});

test('a leftover is offered again and lands on its old id', () => {
    const sunday = {
        liturgy: { opening: hymn('Holy Holy Holy') },
        notes: {},
        carriedBy: {},
        liturgyLeftovers: [{
            sourceId: 'hymn2', kind: 'hymn', name: 'Hymn 2', value: hymn('It Is Well'),
            note: '', people: false,
        }],
    };
    const from = order('custom', 'Custom', [el('opening', 'Opening Hymn', 'hymn')]);
    const back = Orders.STANDARD_ORDER;
    const plan = Translate.plan(
        Translate.filledItemsFromService(sunday, from),
        Translate.targetsFromOrder(back));
    const hymn2 = plan.placements.find(function (placement) { return placement.targetId === 'hymn2'; });
    assert.ok(hymn2);
    assert.equal(hymn2.value.name, 'It Is Well');
    assert.equal(hymn2.method, 'id');
});

test('Jev probabilities that share one source give it to the stronger slot', () => {
    const sources = [
        {
            sourceId: 'open', origin: 'element', kind: 'hymn', name: 'Gathering',
            position: 0, value: hymn('Holy Holy Holy'), note: '', people: false, requests: null,
        },
        {
            sourceId: 'close', origin: 'element', kind: 'hymn', name: 'Sending',
            position: 1, value: hymn('Doxology'), note: '', people: false, requests: null,
        },
    ];
    const targets = Translate.targetsFromOrder(order('to', 'To', [
        el('first', 'First Hymn', 'hymn'),
        el('last', 'Last Hymn', 'hymn'),
    ]));
    const plan = Translate.plan(sources, targets, {
        answers: {
            slot_first: {
                probabilities: { none: 0.05, open: 0.7, close: 0.25 },
            },
            slot_last: {
                probabilities: { none: 0.05, open: 0.55, close: 0.4 },
            },
        },
    });
    const byTarget = {};
    plan.placements.forEach(function (placement) { byTarget[placement.targetId] = placement; });
    assert.equal(plan.judge, 'jev');
    assert.equal(byTarget.first.sourceId, 'open');
    assert.equal(byTarget.last.sourceId, 'close');
    assert.equal(byTarget.last.method, 'jev');
});

test('a slot Jev calls empty stays empty even when a hymn is left over', () => {
    const sources = [{
        sourceId: 'sermonHymn', origin: 'element', kind: 'hymn', name: 'Sermon Hymn',
        position: 0, value: hymn('It Is Well'), note: '', people: false, requests: null,
    }];
    const targets = Translate.targetsFromOrder(order('to', 'To', [
        el('opening', 'Opening Hymn', 'hymn'),
    ]));
    const plan = Translate.plan(sources, targets, {
        answers: { slot_opening: { probabilities: { none: 0.8, sermonHymn: 0.2 } } },
    });
    assert.equal(plan.placements.length, 0);
    assert.equal(plan.leftovers[0].sourceId, 'sermonHymn');
});

test('an empty hymn is not something to translate', () => {
    const sources = Translate.filledItemsFromService({
        liturgy: { hymn1: { id: null, name: '' }, hymn2: hymn('Doxology') },
        notes: {},
        carriedBy: {},
        liturgyLeftovers: [],
    }, order('from', 'From', [el('hymn1', 'Hymn 1', 'hymn'), el('hymn2', 'Hymn 2', 'hymn')]));
    assert.deepEqual(sources.map(function (item) { return item.sourceId; }), ['hymn2']);
});

test('a known bulletin lands on Standard without Jev, and a reference is not split into a label', () => {
    const text = [
        'Date: October 11, 2026',
        'Service Theme: The Kindness of God',
        'Key Verse: Romans 2:4',
        'Service Leader: Ann Lee',
        'Music Leader: Ben Ross',
        'Preacher: Dan Hall',
        'Preparatory Hymn: Be Thou My Vision',
        'Scriptural Call to Worship: Psalm 100:1-2',
        'Hymn: Holy Holy Holy',
        'Hymn: It Is Well',
        'Romans 8:28-39',
        'Call to Confession: Psalm 51:1',
        'Sermon: Romans 8:28-39',
        'Baptism: Jane Doe and John Doe',
        'Benediction: Numbers 6:24-26',
        'Notes:',
        'Sermon: preach the whole chapter',
    ].join('\n');
    const parsed = Translate.fragmentsFromText(text);
    const bare = parsed.fragments.find(function (item) { return item.text === 'Romans 8:28-39'; });
    assert.equal(bare.kind, null, 'a citation is a line, not a "Romans 8" label');

    const plan = Translate.plan(
        parsed.fragments,
        Translate.targetsFromOrder(Orders.STANDARD_ORDER, { headers: true }),
        { mode: 'document' });
    const patch = Translate.importPatch(plan, Orders.STANDARD_ORDER);

    assert.equal(patch.dateText, 'October 11, 2026');
    assert.equal(patch.theme, 'The Kindness of God');
    assert.equal(patch.keyVerse, 'Romans 2:4');
    assert.equal(patch.serviceLeader, 'Ann Lee');
    assert.equal(patch.liturgy.preparatoryHymn.name, 'Be Thou My Vision');
    assert.equal(patch.liturgy.callToWorship, 'Psalm 100:1-2');
    assert.equal(patch.liturgy.hymn1.name, 'Holy Holy Holy');
    assert.equal(patch.liturgy.hymn2.name, 'It Is Well');
    assert.equal(patch.liturgy.sermon, 'Romans 8:28-39');
    assert.equal(patch.notes.sermon, 'preach the whole chapter');
    assert.deepEqual(patch.liturgy.baptism.map(function (person) { return person.name; }), ['Jane Doe', 'John Doe']);
    assert.equal(patch.hasBaptism, true);
    assert.equal(patch.liturgy.benediction, 'Numbers 6:24-26');
    assert.ok(plan.leftovers.some(function (left) { return left.text === 'Romans 8:28-39'; }));
});

test('Jev can place an unlabeled line onto the slot it describes', () => {
    const text = [
        'Sunday 11 October 2026',
        'We open with Be Thou My Vision',
        'The sermon is Romans 8',
    ].join('\n');
    const fragments = Translate.fragmentsFromText(text).fragments;
    const plan = Translate.plan(fragments, Translate.targetsFromOrder(Orders.STANDARD_ORDER, { headers: true }), {
        mode: 'document',
        answers: {
            slot_date: { probabilities: { none: 0.1, L0: 0.9 } },
            slot_preparatoryHymn: { probabilities: { none: 0.15, L1: 0.8, L0: 0.05 } },
            slot_sermon: { probabilities: { none: 0.1, L2: 0.85 } },
        },
    });
    const patch = Translate.importPatch(plan, Orders.STANDARD_ORDER);
    assert.equal(patch.dateText, 'Sunday 11 October 2026');
    assert.equal(patch.liturgy.preparatoryHymn.name, 'We open with Be Thou My Vision');
    assert.equal(patch.liturgy.sermon, 'The sermon is Romans 8');
    assert.equal(plan.judge, 'jev');
});

test('the order of service and the bulletin import both call the translator', () => {
    const root = path.join(__dirname, '..', 'public');
    const page = fs.readFileSync(path.join(root, 'service-builder.html'), 'utf8');
    const calendar = fs.readFileSync(path.join(root, 'service-calendar.html'), 'utf8');
    const builder = fs.readFileSync(path.join(root, 'service-builder.js'), 'utf8');
    const importer = fs.readFileSync(path.join(root, 'docx-importer.js'), 'utf8');
    assert.match(page, /id="liturgy-leftovers"/);
    assert.match(page, /discardLeftover\(item\.sourceId\)/);
    assert.match(page, /liturgy-translate-core\.js/);
    assert.match(calendar, /liturgy-translate\.js/);
    assert.match(builder, /LiturgyTranslate\.translate/);
    assert.match(builder, /liturgyLeftovers/);
    assert.match(importer, /LiturgyTranslate\.translate/);
    assert.doesNotMatch(importer, /Hymn3 is cleared/);
});
