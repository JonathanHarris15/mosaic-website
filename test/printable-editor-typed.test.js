const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/printable-editor.html'), 'utf8');

test('the Fill-in library is only fill-in entries, not a Sunday booklet card', () => {
    const fillAt = html.indexOf('<span>Fill-in library</span>');
    const generalAt = html.indexOf('<span>General live data</span>');
    assert.ok(fillAt > 0 && generalAt > fillAt);
    const fill = html.slice(fillAt, generalAt);
    assert.match(fill, /addEventInput\('text'\)/);
    assert.match(fill, /eventInputs/);
    assert.match(fill, /onEventChipDragStart/);
    assert.doesNotMatch(fill, /Sunday booklet|sundayTypedChips|pe-booklet|prayerNation|Mosaic Kids/);
    assert.doesNotMatch(html, /Type the text for /, 'no pamphlet typing form in the data drawer');
});
