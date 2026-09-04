const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Things that ran off the side of the page.
//
// Two of these were introduced by this run and one was waiting to be. They are
// grouped because they are all the same mistake: a flex container that sizes
// itself to its contents, inside a column that cannot grow to match.
//
// ⚠ A horizontal overflow is a bad bug to ship because it is quiet. Nothing
// errors, the tests pass, and the control that fell off the edge is one nobody
// can press — which on the Answering rung means a form that cannot be made
// elders-only, and on the Forms library means a form that cannot be created.

const ROOT = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, 'public', name), 'utf8').replace(/\r\n/g, '\n');

const FORM = read('form.html');
const LIBRARY = read('forms.html');
const styles = (html) => html.slice(html.indexOf('<style>'));
const ruleFor = (html, selector) => {
    const m = styles(html).match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
    return m ? m[1] : null;
};

// ── The Answering rung ───────────────────────────────────────────────────────

test('the rung control wraps, because four options do not fit 320px', () => {
    // MS-380 took this from two rungs to four. The aside is a 320px column and
    // m-seg options are nowrap with .14em tracking, so without wrapping the
    // last rung is sliced in half by the edge of the card.
    const seg = ruleFor(FORM, '.fp-aside .m-seg');
    assert.ok(seg, 'the aside no longer sizes its segmented controls');
    assert.match(seg, /flex-wrap:\s*wrap/,
        'four rungs across a 320px column run out of their own box');
});

test('a rung button can give up width rather than forcing it', () => {
    const opt = ruleFor(FORM, '.fp-aside .m-seg__opt');
    assert.ok(opt, 'the aside segmented options have no rule of their own');
    assert.match(opt, /flex:\s*1 1 auto/);
});

test('the rung control is still full width, so it fills its column', () => {
    assert.match(ruleFor(FORM, '.fp-aside .m-seg'), /width:\s*100%/);
});

// ── The share link ───────────────────────────────────────────────────────────

test('a long share link ellipsises instead of pushing the row off the card', () => {
    // .f-linkrow is inline-flex, so it grows to whatever it contains. A preview
    // build's URL is long enough to prove it.
    const code = ruleFor(FORM, '.f-linkrow code');
    assert.ok(code, 'the link cell has no rule on this page');
    assert.match(code, /min-width:\s*0/,
        'a flex item will not shrink below its content without this');
    assert.match(code, /flex:\s*1 1 auto/);
    assert.match(ruleFor(FORM, '.f-linkrow'), /max-width:\s*100%/);
});

test('the link is capped at every width, not only on a phone', () => {
    // The old rule was `max-width: 52vw` inside a 640px media query, so on a
    // laptop the URL ran as far as it liked. A fixed vw would also now fight
    // the flex rule above.
    assert.ok(!/max-width:\s*52vw/.test(FORM),
        'the phone-only cap is back, and it conflicts with the flex sizing');
});

// ── Making a form ────────────────────────────────────────────────────────────

test('the new-form row wraps rather than pushing Create off the side', () => {
    // A name box, a two-way choice and two buttons is more than a narrow screen
    // holds, and an m-row does not wrap on its own.
    const row = ruleFor(LIBRARY, '.m-card-list .m-row');
    assert.ok(row, 'the library rows have no wrapping rule');
    assert.match(row, /flex-wrap:\s*wrap/);
    assert.match(ruleFor(LIBRARY, '.m-seg.fl-mode'), /flex-wrap:\s*wrap/);
});

// ── The shape of the mistake ─────────────────────────────────────────────────

test('no segmented control in a narrow column is left unable to wrap', () => {
    // The general version. Any page that puts an m-seg inside a fixed-width
    // column has to say what happens when the options outgrow it — and the
    // answer is always wrapping, because the alternative is a control with a
    // piece missing.
    [['form.html', FORM], ['forms.html', LIBRARY]].forEach(([name, html]) => {
        if (!html.includes('m-seg')) return;
        assert.match(styles(html), /m-seg[^{]*\{[^}]*flex-wrap:\s*wrap/,
            name + ' uses a segmented control and never says how it wraps');
    });
});
