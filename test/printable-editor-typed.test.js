const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/printable-editor.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../public/printable-editor-data.js'), 'utf8');

test('Sunday booklet fields are not bound while the draft is missing', () => {
    assert.match(
        html,
        /<template x-if="canEdit && data\.typed\.draft">/,
        'x-if removes the form so Alpine does not read a null draft'
    );
    assert.doesNotMatch(
        html,
        /pe-typed" x-show=/,
        'x-show still evaluates x-model when the draft is null'
    );
    assert.match(js, /emptyTypedDraft/, 'the editor stands a blank draft up before the Sunday loads');
});

test('the booklet text form is in the Fill-in library, beside its chips, and reachable', () => {
    const fillAt = html.indexOf('<span>Fill-in library</span>');
    const generalAt = html.indexOf('<span>General live data</span>');
    const formAt = html.indexOf('<template x-if="canEdit && data.typed.draft">');
    const chipsAt = html.indexOf('x-for="f in sundayTypedChips"');
    assert.ok(fillAt > 0 && generalAt > fillAt);
    assert.ok(formAt > fillAt && formAt < generalAt, 'the form is in the Fill-in library');
    assert.ok(chipsAt > fillAt && chipsAt < formAt, 'its chips sit above it');
    assert.match(html, /setTypedWhen\(\{ mode: 'next' \}\)/, 'another Sunday\'s text is one press away');
    assert.match(html, /'Type the text for ' \+/, 'the fold names the Sunday it saves to');
    assert.match(js, /await this\.refreshData\(\);\s*\n\s*this\.loadTypedDraft\(\);/, 'the draft loads with the drawer, not when a hidden card opens');
});
