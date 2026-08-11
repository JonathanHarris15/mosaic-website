const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// "The membership slider often does not line up with the text."
//
// Two different scales drawn on top of each other. The six stage labels are
// equal columns, so their centres fall at 1/12, 3/12, 5/12 … of the row. A
// range thumb's centre travels from half a thumb in to half a thumb from the
// far end — 0, 1/5, 2/5 … The two agree near the middle and diverge towards
// the ends, which is exactly what it looked like: Member fine, Visitor and
// Previous Member visibly off.
//
// The fix insets the input by half a column less half a thumb, so the thumb
// stops under each label's centre. That is arithmetic, and arithmetic can be
// checked: the numbers below come out of the real stylesheet, and the model of
// how a browser lays a range input out is written down here rather than
// assumed.

const ROOT = path.join(__dirname, '..');
const SOURCE_CSS = fs.readFileSync(path.join(ROOT, 'build', 'tailwind-input.css'), 'utf8');
const BUILT_CSS = fs.readFileSync(path.join(ROOT, 'public', 'mosaic.css'), 'utf8');

const STAGES = require('../public/shepherding-core.js').MEMBERSHIP_STAGES;

// The declared value of a custom property in the .track-slider block.
function declared(name) {
    const block = SOURCE_CSS.match(/\.track-slider \{([\s\S]*?)\n\}/);
    assert.ok(block, '.track-slider is gone from the stylesheet source');
    const m = block[1].match(new RegExp('\\' + name + ':\\s*([^;]+);'));
    assert.ok(m, name + ' is gone from .track-slider');
    return m[1].replace(/\s+/g, ' ').trim();
}

const px = value => parseFloat(String(value));
const THUMB = px(declared('--track-thumb'));
const STOPS = px(declared('--track-stops'));

// Evaluate one of the stylesheet's calc() expressions for a container this
// wide. Percentages resolve against the container, which is what they do for
// width and margin on a block-level child.
function evaluate(expr, containerWidth) {
    const filled = expr
        .replace(/var\(--track-stops\)/g, String(STOPS))
        .replace(/var\(--track-thumb\)/g, String(THUMB))
        .replace(/calc/g, '')
        .replace(/(\d+(?:\.\d+)?)%/g, (_, n) => `(${containerWidth} * ${n} / 100)`)
        .replace(/(\d+(?:\.\d+)?)px/g, '$1');
    return Function('"use strict"; return (' + filled + ')')();
}

const WIDTHS = [240, 300, 384, 512, 720];

test('the stylesheet still describes six stops, matching the Track itself', () => {
    // The stages are code-defined and there are six. If a seventh is ever
    // added, the inset is wrong everywhere until this follows.
    assert.equal(STOPS, STAGES.length,
        'the slider is laid out for ' + STOPS + ' stops but the Track has ' + STAGES.length);
});

test('every stop sits under the label that names it', () => {
    // The model: the input is inset on both sides, the thumb's centre starts
    // half a thumb inside it and travels to half a thumb from its far end.
    // The labels are equal columns, so label i is centred at (i + ½)/n.
    for (const W of WIDTHS) {
        const inset = evaluate(declared('--track-inset'), W);
        const sliderWidth = W - 2 * inset;
        const travel = sliderWidth - THUMB;

        for (let i = 0; i < STOPS; i++) {
            const thumbCentre = inset + THUMB / 2 + (i / (STOPS - 1)) * travel;
            const labelCentre = W * (i + 0.5) / STOPS;
            assert.ok(
                Math.abs(thumbCentre - labelCentre) < 0.001,
                `at ${W}px, stop ${i} sits at ${thumbCentre.toFixed(2)}px but its label ` +
                `is centred at ${labelCentre.toFixed(2)}px`
            );
        }
    }
});

test('the old geometry really was off, so this test can tell the difference', () => {
    // Guards the test, not the code: if the model above were wrong in a way
    // that made everything pass, this would pass too. A full-width input — what
    // shipped — must fail it, and by a visible margin at the ends.
    const W = 300;
    const worst = Math.max(...[0, STOPS - 1].map(i => {
        const thumbCentre = THUMB / 2 + (i / (STOPS - 1)) * (W - THUMB);
        return Math.abs(thumbCentre - W * (i + 0.5) / STOPS);
    }));
    assert.ok(worst > 8, 'a full-width slider now measures as aligned — the model is wrong');
});

test('the fill stops under the thumb, not short of it or past it', () => {
    // The rail is painted by hand, so its filled portion has to end where the
    // thumb's centre is — measured inside the input, whose own width is the
    // 100% the gradient resolves against.
    const fill = declared('--track-fill');
    for (const W of WIDTHS) {
        const inset = evaluate(declared('--track-inset'), W);
        const sliderWidth = W - 2 * inset;
        for (let i = 0; i < STOPS; i++) {
            const at = evaluate(fill.replace(/var\(--track-index\)/g, String(i)), sliderWidth);
            const thumbCentre = THUMB / 2 + (i / (STOPS - 1)) * (sliderWidth - THUMB);
            assert.ok(Math.abs(at - thumbCentre) < 0.001,
                `at ${W}px, stop ${i}'s fill ends at ${at.toFixed(2)}px, thumb centre ${thumbCentre.toFixed(2)}px`);
        }
    }
});

// ── The pages that draw one ──────────────────────────────────────────────────

const PAGES = ['peoples-page.html', 'shepherding-profile.html'];

test('every Membership Track slider uses the shared geometry', () => {
    let found = 0;
    for (const page of PAGES) {
        const html = fs.readFileSync(path.join(ROOT, 'public', page), 'utf8');
        const inputs = html.match(/<input type="range"[\s\S]*?>/g) || [];
        const track = inputs.filter(tag => /membershipStages\.length - 1/.test(tag));
        assert.ok(track.length, page + ' has no Membership Track slider');
        for (const tag of track) {
            found++;
            assert.match(tag, /class="track-slider/, page + ': a Track slider is laid out by hand again');
            assert.match(tag, /--track-index:/, page + ': a Track slider paints no fill');
            assert.match(tag, /--track-stops:/, page + ': a Track slider does not say how many stops it has');
            // The pair that shipped misaligned: full width, native thumb.
            assert.doesNotMatch(tag, /w-full/, page + ': a Track slider is full-width again, which is the bug');
            assert.doesNotMatch(tag, /accent-primary/, page + ': a Track slider is back on the native thumb');
        }
    }
    assert.equal(found, 3, 'expected the card, the person modal and the Shepherding Profile');
});

test('the built stylesheet has the component in it', () => {
    // mosaic.css is generated from build/tailwind-input.css and committed. An
    // edit to the source that never ran `npm run build:css` ships nothing.
    assert.match(BUILT_CSS, /\.track-slider\{/, 'mosaic.css is stale — run npm run build:css');
    assert.match(BUILT_CSS, /\.track-slider::-webkit-slider-thumb\{/, 'mosaic.css is stale — run npm run build:css');
    assert.match(BUILT_CSS, /\.track-slider::-moz-range-thumb\{/, 'mosaic.css is stale — run npm run build:css');
});
