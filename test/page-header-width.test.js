const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The bar across the top of every desktop page uses the WHOLE WINDOW, and has
// no setting for anything else.
//
// ⚠ WHAT THIS EXISTS TO STOP COMING BACK. `.m-header__inner` used to cap
// itself at `--m-header-max`, which each page set to the width of its own body.
// The effect was that the top of the app moved from page to page: a 720px
// reading page crushed the back link, the title, the actions and the account
// into the middle third of the screen with empty parchment either side, while
// a 1600px table spread the same four things right out. Sixteen of the
// thirty-two pages set it, to eleven different values — and one of them bound
// it to a TAB, so the whole bar jumped when you switched.
//
// Chrome is not content. It belongs to the window it is drawn in, and Home
// being in the same place on every page is the whole of what a person wants
// from it.

const PUBLIC = path.join(__dirname, '..', 'public');

// The gallery is not a page of the app — it draws several headers side by side
// on purpose, which is the whole job of a specimen sheet.
const NOT_A_PAGE = ['components-demo.html'];

const desktopPages = () => fs.readdirSync(PUBLIC)
    .filter(f => f.endsWith('.html') && NOT_A_PAGE.indexOf(f) === -1)
    .map(f => ({ name: f, html: fs.readFileSync(path.join(PUBLIC, f), 'utf8') }))
    .filter(p => /<header class="m-header/.test(p.html));

test('no page sets a width on the header', () => {
    const guilty = desktopPages()
        .filter(p => p.html.indexOf('--m-header-max') !== -1)
        .map(p => p.name);

    assert.deepStrictEqual(guilty, [],
        'a page is sizing the shared header to its own body again: ' + guilty.join(', '));
});

test('the header component has no width setting to reach for', () => {
    // Not merely unused — gone. A variable nothing sets, that the notes tell
    // you never to set, is a variable somebody eventually sets.
    const css = fs.readFileSync(path.join(PUBLIC, 'mosaic.css'), 'utf8');
    assert.ok(css.indexOf('--m-header-max') === -1,
        'the header can be capped again');
    assert.ok(!/\.m-header__inner\{[^}]*max-width/.test(css),
        'the header inner is capped by something else now');
});

test('the header sits on the same gutter the page body does', () => {
    // Full-bleed is not flush. The bar lines up with the window's own margin,
    // which is the gutter `main` already uses — otherwise the back link sits a
    // few pixels off every page's left edge and reads as an accident.
    const css = fs.readFileSync(path.join(PUBLIC, 'mosaic.css'), 'utf8');
    assert.ok(/--m-header-pad:\s*var\(--space-margin\)/.test(css),
        'the header no longer shares the page gutter');
});

test('every desktop page still has exactly one header', () => {
    // The sweep that stripped the widths edited sixteen files with a regex.
    // This is the guard that it took the attribute and nothing else.
    desktopPages().forEach(p => {
        const opens = (p.html.match(/<header class="m-header/g) || []).length;
        assert.strictEqual(opens, 1, p.name + ' has ' + opens + ' headers');
        assert.ok(/<div class="m-header__inner">/.test(p.html),
            p.name + ' lost its header inner');
    });
});
