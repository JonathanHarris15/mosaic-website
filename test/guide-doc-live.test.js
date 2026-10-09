const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

// MS-721 (ADR 0081, lead call Oct 8 9:44 PM): the Service Guide pages save
// one document, so remote changes are taken only while nothing is unsaved.

for (const [html, js] of [['service-guide.html', 'service-guide.js'], ['service-guide-editor.html', 'service-guide-editor.js']]) {
    test(`${html}: no Save buttons; chip, Retry, Changed elsewhere + Reload`, () => {
        const h = read(html);
        assert.doesNotMatch(h, /Save Progress/);
        assert.doesNotMatch(h, /@click="save\(/);
        assert.match(h, /data-live-chip/);
        assert.match(h, /data-live-retry @click="retrySave\(\)"/);
        assert.match(h, /Changed elsewhere — reload to see it/);
        assert.match(h, /data-live-reload @click="reloadGuide\(\)"/);
        for (const s of ['live-read.js', 'doc-live-core.js']) {
            assert.ok(h.indexOf(`src="${s}"`) !== -1 && h.indexOf(`src="${s}"`) < h.indexOf(`src="${js}"`), s);
        }
    });
    test(`${js}: listens to the week and hands remote copies to DocLive`, () => {
        const s = read(js);
        assert.match(s, /MosaicLiveRead\.watch\(db\.collection\('services'\)\.doc\(this\.date\)/);
        assert.match(s, /_live\.remote\(/);
        assert.match(s, /_live\.failed\(ticket, /);
        assert.match(s, /DocLive\.create\(/);
    });
}

test('the guide editor fingerprint covers what it writes (template, snapshot, values)', () => {
    global.window = global.window || {};
    const src = read('service-guide-editor.js');
    const factory = new Function('window', 'GuideStore', src + '; return guideEditorV2;')({}, {});
    const page = factory();
    const a = page.guideFingerprint({ guide: { guideTemplateId: 't', snapshot: { pages: [] }, values: { x: 1 } } });
    const b = page.guideFingerprint({ guide: { guideTemplateId: 't', snapshot: { pages: [] }, values: { x: 1 }, updatedAt: 5 } });
    const c = page.guideFingerprint({ guide: { guideTemplateId: 't', snapshot: { pages: [] }, values: { x: 2 } } });
    assert.equal(a, b, 'updatedAt is not a change');
    assert.notEqual(a, c);
});
