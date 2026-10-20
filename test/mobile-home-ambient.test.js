// MS-770 — ambient home rings must sit under the mobile TopBar.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'mobile.html'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'mobile', 'ui.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'mobile', 'app.js'), 'utf8');

test('ambient rings use a dedicated layer below foreground chrome', () => {
    assert.match(HTML, /\.m-screen-ambient[\s\S]{0,120}z-index:\s*0/);
    assert.match(HTML, /\.m-screen-foreground[\s\S]{0,120}z-index:\s*1/);
    assert.match(UI, /function ScreenAmbientRings/);
    assert.match(UI, /class="m-screen-ambient"/);
    assert.match(UI, /m-mobile-topbar[\s\S]{0,200}zIndex:\s*2/);
    assert.match(UI, /background:\s*"var\(--background\)"/);
});

test('only the home screen renders ambient rings in the mobile shell', () => {
    assert.match(APP, /ScreenAmbientRings/);
    assert.doesNotMatch(APP, /<circle r="90"/);
    const mobileDir = path.join(ROOT, 'public', 'mobile');
    const files = fs.readdirSync(mobileDir).filter(f => f.endsWith('.js'));
    const withRings = files.filter(f => {
        const src = fs.readFileSync(path.join(mobileDir, f), 'utf8');
        return /home-ambient|ScreenAmbientRings|<circle r="90"/.test(src);
    });
    assert.deepStrictEqual(withRings.sort(), ['app.js', 'ui.js']);
});
