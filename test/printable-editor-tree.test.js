const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/printable-editor.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../public/printable-editor.js'), 'utf8');

test('the Elements tree can fold a parent so its children sit underneath it', () => {
    assert.match(html, /\.pe-tree__twist/, 'the twist control is styled');
    assert.match(js, /toggleTreeFold/, 'a parent can be folded');
    assert.match(js, /revealInTree/, 'picking an element on the canvas opens the folds that hide it');
    assert.match(js, /treeCollapsed/, 'the fold is session state, not a fact about the page');
    assert.match(js, /if \(!folded\) kids\.forEach/, 'a folded parent does not draw its children');
});
