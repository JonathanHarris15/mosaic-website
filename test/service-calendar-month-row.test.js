// MS-690 — month separator rows must not drift horizontally when the table scrolls.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'service-calendar.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'service-calendar.html'), 'utf8');

test('month headings use the sticky date column so they do not scroll sideways', () => {
    assert.match(SRC, /separatorRow\.className = 'sticky-month-row/);
    assert.match(SRC, /sticky-col-left bg-surface-container-low\/90 backdrop-blur-sm/);
});

test('month row vertical stickiness still pairs with the table header', () => {
    assert.match(HTML, /\.sticky-month-row td \{[\s\S]{0,120}top:\s*41px/);
});
