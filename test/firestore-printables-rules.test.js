const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-392 — the Printables boundary.
//
// A Printable holds a layout and which live field feeds which element, never
// the values, so reading one discloses nothing a Person or an Event would not.
// Even so it is editor-and-above: it is hours of somebody's layout, and the
// library that lists it is an editor's tool.
//
// Like the other rules tests here, this pins the SHAPE rather than exercising
// it — live enforcement needs a real project. Follows firestore-forms-rules.

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')
    .replace(/\r\n/g, '\n');

const blockFor = pattern => {
    const m = rules.match(pattern);
    assert.ok(m, 'no rule block matching ' + pattern);
    return m[1];
};

const code = block => block
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');

const printablesBlock = () => blockFor(/match \/printables\/\{printableId\}\s*\{([\s\S]*?)\n    \}/);
const foldersBlock = () => blockFor(/match \/printable_folders\/\{folderId\}\s*\{([\s\S]*?)\n    \}/);
const templatesBlock = () => blockFor(/match \/printable_templates\/\{templateId\}\s*\{([\s\S]*?)\n    \}/);

test('a Printable is written by editors and above, and nobody below', () => {
    const block = code(printablesBlock());
    assert.match(block, /allow read, write: if isEditor\(\);/);
    assert.doesNotMatch(block, /if true/, 'a Printable is not world-readable');
    assert.doesNotMatch(block, /request\.auth != null/,
        'request.auth != null accepts an anonymous token anybody can mint; isSignedIn() is the floor');
});

test('a Printable folder is editor-and-above, the same ladder as the Forms library', () => {
    const block = code(foldersBlock());
    assert.match(block, /allow read, write: if isEditor\(\);/);
    assert.doesNotMatch(block, /if true/);
});

test('a custom page template is editor-and-above, like the projects it seeds', () => {
    const block = code(templatesBlock());
    assert.match(block, /allow read, write: if isEditor\(\);/);
    assert.doesNotMatch(block, /if true/);
});
