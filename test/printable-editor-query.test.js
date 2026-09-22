const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/printable-editor.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../public/printable-editor-data.js'), 'utf8');

test('iteration is queried in the data drawer, and a locked query cannot be rebuilt', () => {
    assert.match(html, /class="pe-drawer__section pe-query"/, 'the drawer has a query builder');
    assert.match(html, /This list is not yours to query/, 'a list above the viewer is closed');
    assert.match(js, /queryLocked/, 'the editor knows when the query is not theirs');
    assert.match(js, /querySpecsFor/, 'only filters this viewer may use are offered');
    assert.match(html, /Build the query in the data drawer/, 'the element panel does not carry the query');
});
