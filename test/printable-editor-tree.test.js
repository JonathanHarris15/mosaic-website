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

test('the Elements tree shows only the selected page; pages live in the filmstrip (MS-760)', () => {
    assert.match(html, /pe-pages/, 'the pages filmstrip is in the chrome');
    assert.match(html, /id="pe-pages-strip"/, 'the strip is drawn by hand');
    assert.match(js, /renderPagesStrip/, 'the filmstrip is rebuilt with the canvas');
    assert.match(js, /currentPage/, 'the tree is keyed off the selection');
    assert.match(js, /Elements of the selected page only/, 'page rows left the tree');
    assert.doesNotMatch(js, /pe-tree__page/, 'page chrome is not drawn inside the elements tree');
    assert.match(js, /Overflow run/, 'continuation runs are labelled in the filmstrip');
    assert.match(js, /canInsertAfter/, 'insert respects overflow runs');
    assert.match(js, /movePageRun/, 'reorder moves a whole run');
    assert.match(html, /\.pe-pages__run/, 'the run rail is styled');
    assert.match(js, /nearestPageReorderSlot/, 'a page drag picks the gap under the pointer');
    assert.match(js, /pageReorderTarget/, 'the drop lands before the page after that gap');
    assert.match(html, /\.pe-pages__insert\.is-drop/, 'the gap draws a line');
    assert.match(html, /100cqw/, 'the thumbnail scales to the card');
    assert.doesNotMatch(html, /aspect-ratio:\s*1\s*\/\s*1\.294/, 'thumbnails are not forced into a letter frame');
    assert.doesNotMatch(js, /reorderPageBefore\(ui\.pageDrag\.pageId, page\.id\)/, 'dropping does not target the page under the pointer');
});
