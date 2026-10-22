// MS-778 / MS-779 — retire the template-system Service Guide editor; Printables
// on the Liturgy Order are the Service Guide. Event-series printables are other
// handouts.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

const Core = require('../public/liturgy-order-core.js');

test('a legacy guide.elements blob on the service doc does not change the Printable href (MS-778)', () => {
    let cat = Core.standardCatalog();
    cat = Core.setOrderPrintable(cat, 'standard', 'order-guide');
    const legacyService = {
        liturgyOrderId: 'standard',
        guide: { elements: [{ type: 'announcements', items: ['Old week'] }] },
    };
    const target = Core.serviceGuideTarget(legacyService, cat, {
        date: '2026-10-18',
        occurrenceId: 'sunday_service_2026-10-18',
        printables: { 'order-guide': { memberVisible: true } },
        viewerCanEdit: true,
    });
    assert.equal(target.enabled, true);
    assert.equal(target.printableId, 'order-guide');
    assert.match(target.href, /printable-view\.html\?id=order-guide/);
});

test('event surfaces say series printables are not the Sunday Service Guide (MS-779)', () => {
    const event = read('calendar-event.html');
    const series = read('recurring-events.html');
    const orders = read('liturgy-orders.html');
    assert.match(event, /not the Sunday Service Guide/i);
    assert.match(series, /not the Sunday Service Guide/i);
    assert.match(orders, /calendar event series are separate/i);
});

test('mobile Services opens the Liturgy Order printable, not the retired editor (MS-778)', () => {
    const mobile = read('mobile/screens-content.js');
    const app = read('mobile/app.js');
    assert.doesNotMatch(mobile, /service-guide-editor\.html/);
    assert.doesNotMatch(app, /service-guide-editor\.html/);
    assert.match(mobile, /serviceGuideTarget/);
    assert.match(mobile, /target\.href/);
});

test('the admin tools tab no longer ships the Service Guide Manager (MS-778)', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'admin-dashboard.html'), 'utf8');
    assert.doesNotMatch(html, /service-guide-manager\.html/);
    assert.doesNotMatch(html, /Service Guide Manager/);
});
