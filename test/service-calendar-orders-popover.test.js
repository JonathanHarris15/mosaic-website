// MS-770 — Orders filter popover must escape the table's overflow/sticky stack.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const HTML = fs.readFileSync(path.join(PUBLIC, 'service-calendar.html'), 'utf8');
const JS = fs.readFileSync(path.join(PUBLIC, 'service-calendar.js'), 'utf8');

test('Orders popover teleports to body with fixed positioning', () => {
    assert.match(HTML, /x-teleport="body"/);
    assert.match(HTML, /:style="ordersPopoverStyle"/);
    assert.match(HTML, /\.cal-orders__popover[\s\S]{0,200}position:\s*fixed/);
    assert.match(HTML, /z-index:\s*90/);
});

test('calendarPage positions the Orders popover on open and viewport changes', () => {
    assert.match(JS, /positionOrdersPopover\(\)/);
    assert.match(JS, /toggleOrdersFilter\(\)/);
    assert.match(JS, /closeOrdersFilter\(event\)/);
    assert.match(JS, /ordersPopoverStyle/);
});
