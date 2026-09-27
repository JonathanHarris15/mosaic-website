const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');

function loadGuideEditor() {
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout() {}, clearTimeout() {},
        setInterval() {}, clearInterval() {},
        Promise, Date, Object, Array, Math, String, Number, JSON,
        encodeURIComponent, URLSearchParams,
        location: { search: '?date=2026-09-28', href: '' },
        auth: { onAuthStateChanged() {} },
        getUserData: async () => ({}),
        db: {},
        document: { addEventListener() {}, getElementById() { return null; } },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(
        fs.readFileSync(path.join(PUBLIC, 'service-guide.js'), 'utf8'),
        sandbox,
        { filename: 'service-guide.js' },
    );
    const page = sandbox.guideEditor();
    page.$watch = () => {};
    return page;
}

test('kidsPageEnabled is false when the Mosaic Kids page element is toggled off', () => {
    const page = loadGuideEditor();
    page.generateDefaultElements();
    const kids = page.elements.find((e) => e.type === 'kids_section');
    assert.ok(kids);
    kids.enabled = false;
    assert.equal(page.kidsPageEnabled, false);
});

test('kidsPageEnabled is true when the Mosaic Kids page element is enabled', () => {
    const page = loadGuideEditor();
    page.generateDefaultElements();
    const kids = page.elements.find((e) => e.type === 'kids_section');
    kids.enabled = true;
    assert.equal(page.kidsPageEnabled, true);
});

test('announcements Weekly Events Mosaic Kids line is gated on kidsPageEnabled', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'service-guide.html'), 'utf8');
    assert.match(html, /x-show="kidsPageEnabled"/);
    assert.match(html, /<b>Mosaic Kids:<\/b> We have a Mosaic Kids/);
    const serviceReviewIdx = html.indexOf('<b>Service Review:</b>');
    const kidsIdx = html.indexOf('<b>Mosaic Kids:</b>');
    assert.ok(kidsIdx !== -1 && serviceReviewIdx !== -1);
    const kidsLine = html.slice(kidsIdx - 40, kidsIdx + 120);
    assert.match(kidsLine, /x-show="kidsPageEnabled"/);
    const reviewLine = html.slice(serviceReviewIdx - 40, serviceReviewIdx + 80);
    assert.doesNotMatch(reviewLine, /x-show="kidsPageEnabled"/);
});
