const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/printable-editor.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../public/printable-editor-data.js'), 'utf8');

test('Sunday booklet fields are not bound while the draft is missing', () => {
    assert.match(
        html,
        /<template x-if="src\.key === 'sunday_typed' && canEdit && data\.typed\.draft">/,
        'x-if removes the form so Alpine does not read a null draft'
    );
    assert.doesNotMatch(
        html,
        /pe-typed" x-show=/,
        'x-show still evaluates x-model when the draft is null'
    );
    assert.match(js, /emptyTypedDraft/, 'the editor stands a blank draft up before the Sunday loads');
});
