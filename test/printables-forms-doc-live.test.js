const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

// MS-721 (ADR 0081, lead call Oct 8 9:44 PM): Printables editor and Forms
// save one document; remote changes are taken only while nothing is unsaved.

for (const [html, js, coll, reload] of [
    ['printable-editor.html', 'printable-editor.js', 'printables', 'reloadPrintable'],
    ['form.html', 'form.js', 'forms', 'reloadForm'],
]) {
    test(`${html}: no Save button; chip, Retry, Changed elsewhere + Reload`, () => {
        const h = read(html);
        assert.doesNotMatch(h, /@click="save\(true\)"/);
        assert.match(h, /data-live-chip/);
        assert.match(h, /data-live-retry[\s\S]{0,120}@click="retrySave\(\)"/);
        assert.match(h, /Changed elsewhere — reload to see it/);
        assert.match(h, new RegExp(`data-live-reload[\\s\\S]{0,120}@click="${reload}\\(\\)"`));
        for (const s of ['live-read.js', 'doc-live-core.js']) {
            assert.ok(h.indexOf(`src="${s}"`) !== -1 && h.indexOf(`src="${s}"`) < h.indexOf(`src="${js}"`), s);
        }
    });
    test(`${js}: listens to its document and hands remote copies to DocLive`, () => {
        const s = read(js);
        assert.match(s, new RegExp(`MosaicLiveRead\\.watch\\(db\\.collection\\('${coll}'\\)`));
        assert.match(s, /_live\.remote\(data, \{ pendingWrites \}\)/);
        assert.match(s, /_live\.failed\(ticket, e\)/);
    });
}

test('fingerprints ignore what other explicit writes move (name/folder; published/closed)', () => {
    const PC = require('../public/printable-core.js');
    const FC = require('../public/forms-core.js');
    global.PrintableCore = PC; global.FormsCore = FC;
    const win = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (() => ({}))) });
    const pe = new Function('window', read('printable-editor.js') + '; return printableEditor;')(win)();
    const a = pe.printableFingerprint({ name: 'A', template: { paper: 'letter' } });
    assert.equal(a, pe.printableFingerprint({ name: 'B', folderId: 'f', template: { paper: 'letter' } }));
    assert.notEqual(a, pe.printableFingerprint({ name: 'A', bookletExport: true, template: { paper: 'letter' } }));
    const fp = new Function(read('form.js') + '; return formPage;')()();
    const f = fp.formFingerprint({ title: 'T', questions: [] });
    assert.equal(f, fp.formFingerprint({ title: 'T', questions: [], published: true, closed: true }));
    assert.notEqual(f, fp.formFingerprint({ title: 'U', questions: [] }));
});

test('a refused form save is not re-armed on a timer and still stops a publish', () => {
    const s = read('form.js');
    assert.match(s, /setTimeout\(\(\) => this\.save\(false\)\.catch\(\(\) => \{\}\), this\.SAVE_DEBOUNCE\)/);
    assert.match(s, /throw e;\n\s+\}\n\s+\},/);
});
