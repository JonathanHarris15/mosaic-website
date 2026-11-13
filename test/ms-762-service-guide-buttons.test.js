// MS-762: Service Guide buttons follow the Liturgy Order's linked Printable.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('Liturgy Orders page offers link and clear for the Service Guide printable', () => {
    const html = fs.readFileSync(path.join(root, 'public/liturgy-orders.html'), 'utf8');
    assert.match(html, /lo-link-printable/);
    assert.match(html, /startLinkPrintable/);
    assert.match(html, /clearPrintable/);
    assert.match(html, /Link a printable/);
});

test('Order of Service Generate Service Guide uses serviceGuideEnabled', () => {
    const html = fs.readFileSync(path.join(root, 'public/service-builder.html'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'public/service-builder.js'), 'utf8');
    assert.match(html, /generate-service-guide/);
    assert.match(html, /serviceGuideEnabled/);
    assert.match(js, /serviceGuideTarget\(/);
    assert.match(js, /LiturgyOrderCore\.serviceGuideTarget|liturgyCore\(\)\.serviceGuideTarget/);
});

test('Service Calendar Service Guide buttons use the liturgy-order helper', () => {
    const js = fs.readFileSync(path.join(root, 'public/service-calendar.js'), 'utf8');
    assert.match(js, /serviceGuideForDate/);
    assert.match(js, /serviceGuideButtonHtml/);
    assert.match(js, /LiturgyOrderCore\.serviceGuideTarget/);
    assert.match(js, /aria-disabled/);
    assert.doesNotMatch(js, /GuideStore\.guideHref/);
});
