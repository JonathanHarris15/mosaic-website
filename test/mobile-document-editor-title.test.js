const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The editor is strict. Assigning _currentDocTitle without this declaration
// throws ReferenceError while a document is loading, and the load catch shows
// the error state.
test('the mobile document editor declares _currentDocTitle before it assigns it', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'mobile', 'screens-document-editor.js'),
        'utf8');
    assert.match(src, /"use strict"/);
    assert.match(src, /var _currentDocId = null, _currentDocTitle = "", _user = null, _nav = null/);
    assert.match(src, /_currentDocTitle = doc\.title/);
    assert.match(src, /_currentDocTitle = titleRef\.current/);
});
