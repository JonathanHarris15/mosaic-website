const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// MS-724: saveVerseSelection wrote `liturgy.<field>` with set(merge), which
// stores a literal dotted field name rather than a nested one. Nothing
// called it — verse edits go through writeLiturgyField (dot-path update(),
// ADR 0034) — so it was deleted rather than fixed. Pin that it stays gone.

const pub = path.join(__dirname, '..', 'public');

test('saveVerseSelection is gone from service-calendar.js and nothing calls it', () => {
    const js = fs.readFileSync(path.join(pub, 'service-calendar.js'), 'utf8');
    assert.doesNotMatch(js, /saveVerseSelection/);
    for (const f of fs.readdirSync(pub).filter(n => /\.(js|html)$/.test(n))) {
        const text = fs.readFileSync(path.join(pub, f), 'utf8');
        assert.doesNotMatch(text, /saveVerseSelection/, f);
    }
});

test('no service write in service-calendar.js uses a dotted key with set(merge)', () => {
    const js = fs.readFileSync(path.join(pub, 'service-calendar.js'), 'utf8');
    assert.doesNotMatch(js, /\[`liturgy\.\$\{[^}]+\}`\][^;]*;\s*await db\.collection\('services'\)\.doc\([^)]*\)\.set\(/);
});
