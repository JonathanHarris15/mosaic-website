'use strict';
// MS-721: event documents, shepherding documents and shepherding form
// documents follow the whole-document live pattern (DocLive): chip, Retry,
// "Changed elsewhere" notice with Reload, no manual Save button.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

const pages = [
    { html: 'event-document.html', js: 'event-document.js', watch: /documents/ },
    { html: 'shepherding-document.html', js: 'shepherding-document.js', watch: /elder_documents/ },
    { html: 'shepherding-form-document.html', js: 'shepherding-form-document.js', watch: /elder_documents/ },
];

for (const p of pages) {
    test(`${p.html} carries the live chip, Retry and Changed elsewhere + Reload`, () => {
        const html = read(p.html);
        for (const hook of ['data-live-chip', 'data-live-retry', 'data-changed-elsewhere', 'data-live-reload']) {
            assert.ok(html.includes(hook), `${p.html} missing ${hook}`);
        }
        assert.ok(html.includes('doc-live-core.js'), 'loads doc-live-core.js');
        assert.ok(html.includes('live-read.js'), 'loads live-read.js');
        assert.ok(html.indexOf('doc-live-core.js') < html.indexOf(`src="${p.js}`) || html.indexOf('doc-live-core.js') < html.indexOf(p.js), 'core loads before the page');
        assert.ok(!/>\s*Save\s*</.test(html), `${p.html} still has a manual Save button`);
    });
    test(`${p.js} creates DocLive and watches its own document`, () => {
        const js = read(p.js);
        assert.match(js, /DocLive\.create\(/);
        assert.match(js, /MosaicLiveRead\.watch\(/);
        assert.match(js, p.watch);
        assert.match(js, /pendingWrites/);
    });
}
