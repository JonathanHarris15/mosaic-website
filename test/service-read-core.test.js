const { describe, test } = require('node:test');
const assert = require('node:assert');

const Read = require('../public/service-read-core.js');
const Liturgy = require('../public/liturgy-order-core.js');

// The MCP read of one Sunday (MS-262), in the Sunday's Liturgy Order
// (ADR-0080). Fixtures are fictional.

const WITH_ORDERS = {
    elements: Liturgy.STANDARD_ELEMENTS.concat([
        { id: 'lordsSupper', name: "Lord's Supper", primitive: 'text', hasRole: true, hasNote: true },
        { id: 'offertory', name: 'Offertory', primitive: 'song', hasRole: false, hasNote: false },
    ]),
    orders: [
        Liturgy.STANDARD_ORDER,
        { id: 'communion', name: 'Communion', elementIds: ['callToWorship', 'lordsSupper', 'offertory', 'benediction'] },
    ],
};

const fields = (s) => s.liturgy.map((r) => r.field);

describe('readableService walks the Sunday\'s Liturgy Order', () => {
    test('a Sunday with no order reads in Standard, element names as labels', () => {
        const s = Read.readableService('2031-03-02', {
            liturgy: { callToWorship: 'Psalm 100', hymnEnd1: { id: 'h-9', name: 'A Closing Song' } },
        });
        assert.deepStrictEqual(fields(s), Liturgy.STANDARD_ORDER.elementIds.slice());
        assert.deepStrictEqual(s.liturgyOrder, { id: 'standard', name: 'Standard' });
        const closing = s.liturgy.find((r) => r.field === 'hymnEnd1');
        assert.strictEqual(closing.label, 'Closing Hymn');
        assert.strictEqual(closing.primitive, 'song');
        assert.deepStrictEqual(closing.value, { name: 'A Closing Song', id: 'h-9' });
        assert.deepStrictEqual(s.liturgy.filter((r) => r.filled).map((r) => r.field),
            ['callToWorship', 'hymnEnd1']);
    });

    test('a chosen order is emitted in its order, and other values stay hidden', () => {
        const s = Read.readableService('2031-03-09', {
            liturgyOrderId: 'communion',
            liturgy: { callToWorship: 'Isaiah 55:1', hymn1: { id: 'h-1', name: 'A Hidden Song' }, lordsSupper: 'Words of institution' },
            carriedBy: { lordsSupper: { id: 'p-7', name: 'Rowan Example' } },
            notes: { lordsSupper: '<p>Bread first</p>', offertory: '<p>never shown</p>' },
        }, WITH_ORDERS);
        assert.deepStrictEqual(fields(s), ['callToWorship', 'lordsSupper', 'offertory', 'benediction']);
        assert.deepStrictEqual(s.liturgyOrder, { id: 'communion', name: 'Communion' });
        const supper = s.liturgy.find((r) => r.field === 'lordsSupper');
        assert.strictEqual(supper.carriedBy, 'Rowan Example');
        assert.strictEqual(supper.note, 'Bread first');
        assert.strictEqual(s.liturgy.find((r) => r.field === 'offertory').note, null,
            'an element without a note does not read one back');
        assert.strictEqual(s.liturgy.find((r) => r.field === 'callToWorship').carriedBy, null);
    });

    test('an order that has since been deleted reads as Standard', () => {
        const s = Read.readableService('2031-03-16', { liturgyOrderId: 'gone', liturgy: {} }, WITH_ORDERS);
        assert.strictEqual(s.liturgyOrder.id, 'standard');
        assert.deepStrictEqual(fields(s), Liturgy.STANDARD_ORDER.elementIds.slice());
    });

    test('⚠ a legacy dotted key is still folded in', () => {
        const s = Read.readableService('2031-03-23', { 'liturgy.sermon': 'Romans 8:28', 'liturgy': { sermon: '' } });
        const sermon = s.liturgy.find((r) => r.field === 'sermon');
        assert.strictEqual(sermon.filled, true);
        assert.strictEqual(sermon.value, 'Romans 8:28');
    });

    test('the people prayed for read beside the order, never as rows', () => {
        const s = Read.readableService('2031-03-30', {
            liturgy: { prayerMale: { id: 'p-1', name: 'Sam Sample' }, prayerFemale: { id: null, name: '' } },
            preacher: 'Pat Placeholder',
        });
        assert.ok(!fields(s).includes('prayerMale'));
        assert.deepStrictEqual(s.prayedFor, { 'Male Being Prayed For': { id: 'p-1', name: 'Sam Sample' } });
        assert.strictEqual(s.people.Preacher, 'Pat Placeholder');
    });

    test('a people element keeps only the people somebody named', () => {
        const s = Read.readableService('2031-04-06', {
            liturgy: { baptism: [{ id: 'p-2', name: 'Avery Test' }, { id: '', name: '' }] },
        });
        const baptism = s.liturgy.find((r) => r.field === 'baptism');
        assert.deepStrictEqual(baptism.value, [{ id: 'p-2', name: 'Avery Test' }]);
        assert.strictEqual(Read.readableService('2031-04-13', { liturgy: { baptism: [{ id: '', name: ' ' }] } })
            .liturgy.find((r) => r.field === 'baptism').filled, false);
    });

    test('an irregular Sunday still says where its content lives', () => {
        const s = Read.readableService('2031-04-20', { isIrregular: true, irregularElements: [{ name: 'Lessons and Carols' }] });
        assert.strictEqual(s.isIrregular, true);
        assert.deepStrictEqual(s.irregularElements, [{ name: 'Lessons and Carols' }]);
    });

    test('leftovers come back with the Sunday, and an empty drawer is an empty list', () => {
        const held = Read.readableService('2031-05-04', {
            liturgyOrderId: 'communion',
            liturgy: { callToWorship: 'Isaiah 55:1' },
            liturgyLeftovers: [{
                sourceId: 'hymn1',
                kind: 'hymn',
                name: 'Opening Hymn',
                value: { id: 'h-1', name: 'It Is Well' },
                note: '<p>Check the key</p>',
                text: '',
            }],
        }, WITH_ORDERS);
        assert.deepStrictEqual(held.leftovers, [{
            sourceId: 'hymn1',
            name: 'Opening Hymn',
            kind: 'hymn',
            value: { name: 'It Is Well', id: 'h-1' },
            note: 'Check the key',
        }]);
        assert.ok(!fields(held).includes('hymn1'), 'a leftover is not also a row of this order');

        const clear = Read.readableService('2031-05-11', { liturgy: {} });
        assert.deepStrictEqual(clear.leftovers, []);
    });

    test('a date with no document is an answer, not an error', () => {
        assert.deepStrictEqual(Read.readableService('2031-04-27', null, WITH_ORDERS),
            { date: '2031-04-27', exists: false, liturgy: [], people: {} });
    });
});
