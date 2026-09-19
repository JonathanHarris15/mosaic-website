const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const Typed = require('../public/sunday-typed-core.js');

const ROOT = path.join(__dirname, '..');
const rules = fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8').replace(/\r\n/g, '\n');

const countryMapBlock = () => {
    const m = rules.match(/match \/sunday_typed\/\{dateId\}\/country_map\/\{fileId\} \{([\s\S]*?)\n    \}/);
    assert.ok(m, 'there is no Storage rule for the Sunday country-map path');
    return m[1].split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
};

test('country-map Storage path matches the write helper and is editor + image + 8MB', () => {
    assert.equal(
        Typed.countryMapStoragePath('2026-09-06', 'map.png'),
        'sunday_typed/2026-09-06/country_map/map.png'
    );
    const block = countryMapBlock();
    assert.match(block, /allow write: if isEditorAccount\(\)/);
    assert.match(block, /request\.resource\.size < 8 \* 1024 \* 1024/);
    assert.match(block, /contentType\.matches\('image\/\.\*'\)/);
    assert.match(block, /allow delete: if false;/);
    assert.match(block, /allow read: if request\.auth != null;/);
});

test('country-map rule does not widen the catch-all or other Storage paths', () => {
    assert.match(rules, /match \/\{\s*allPaths=\*\*\s*\} \{\s*\n\s*allow read, write: if request\.auth != null;/);
    assert.doesNotMatch(countryMapBlock(), /allow read: if true/);
    assert.doesNotMatch(countryMapBlock(), /allow write: if request\.auth != null;/);
    assert.equal((rules.match(/match \/sunday_typed\//g) || []).length, 1);
});
