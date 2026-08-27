const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const Core = require('../public/shepherding-core.js');

// The Hold-Duration scrubber runs in one of two directions — held at least, or
// held less than — stored as 'gte' / 'lt'. The maths was always right; the words
// were not. The scrubber's tooltip was hardcoded to "Held at least …" in both
// templates and never read the direction the elder had picked, so the control
// contradicted the list it was filtering (MS-279).
//
// ⚠ WHY THIS TEST EXISTS, AND WHY THE 22 TESTS NEXT DOOR DIDN'T CATCH IT.
//
// shepherding-tags.test.js pins holdSatisfies in both directions and it passes.
// Nothing computed the wrong answer. The bug lived one layer out, in a `:title`
// attribute inside an HTML template — a layer the behavioural suite cannot see.
// So this file works on two fronts: the wording helper is pinned as a plain unit
// (the durable seam), and the templates are read as source to check they route
// through it rather than writing the phrase out by hand.
//
// The widget exists twice — the People list filter and the saved Filtered View
// editor — and that duplication is what let one copy drift from the other. The
// source test below is what stops them drifting again.

// ── The wording helper (unit) ─────────────────────────────────────────────────

test('holdDirectionWord names the stored direction in a word an elder can read', () => {
    assert.strictEqual(Core.holdDirectionWord('gte'), 'older');
    assert.strictEqual(Core.holdDirectionWord('lt'), 'recent');
});

test('holdDirectionWord treats an absent or unknown direction as the default', () => {
    assert.strictEqual(Core.holdDirectionWord(undefined), 'older');
    assert.strictEqual(Core.holdDirectionWord(null), 'older');
    assert.strictEqual(Core.holdDirectionWord(''), 'older');
    assert.strictEqual(Core.holdDirectionWord('sideways'), 'older');
});

test('holdDirectionHint says which way it runs now and what a click will do', () => {
    assert.strictEqual(Core.holdDirectionHint('gte'), 'Held at least — click for held less than');
    assert.strictEqual(Core.holdDirectionHint('lt'), 'Held less than — click for held at least');
    assert.strictEqual(Core.holdDirectionHint(undefined), Core.holdDirectionHint('gte'));
});

test('holdScrubberLabel follows the direction actually selected', () => {
    assert.strictEqual(Core.holdScrubberLabel('gte', '3mo'), 'Held at least 3mo');
    assert.strictEqual(Core.holdScrubberLabel('lt', '3mo'), 'Held less than 3mo');
});

test('holdScrubberLabel defaults an unknown direction to held at least', () => {
    assert.strictEqual(Core.holdScrubberLabel(undefined, '1w'), 'Held at least 1w');
    assert.strictEqual(Core.holdScrubberLabel('sideways', '1w'), 'Held at least 1w');
});

test('holdScrubberLabel with no threshold set describes both directions', () => {
    const idle = Core.holdScrubberLabel('gte', '');
    assert.strictEqual(Core.holdScrubberLabel('lt', ''), idle, 'the idle scrubber reads the same either way');
    assert.strictEqual(Core.holdScrubberLabel('gte', undefined), idle);
    assert.match(idle, /older/, 'the idle tooltip names the older direction');
    assert.match(idle, /recent/, 'the idle tooltip names the recent direction');
    assert.doesNotMatch(idle, /Held at least|Held less than/,
        'with nothing set the scrubber must not claim a direction');
});

// ── The templates route through it (source) ───────────────────────────────────

const PUBLIC = path.join(__dirname, '..', 'public');
const WIDGET_FILES = [
    'shepherding-people.html',
    'shepherding-people.js',
    'shepherding-dashboard.html',
    'shepherding-dashboard.js',
];
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

// These files run to thousands of lines. assert.match would print the whole
// source on failure and bury the message, so assert what the pattern found.
const contains = (src, re, msg) => assert.ok(re.test(src), msg);
const lacks = (src, re, msg) => assert.ok(!re.test(src), msg);

test('only the core knows the direction phrases — no template writes one out', () => {
    const offenders = WIDGET_FILES.filter(f => /Held at least|Held less than/.test(read(f)));
    assert.deepEqual(offenders, [],
        'a hardcoded direction phrase is the MS-279 bug returning; compose it with ' +
        'ShepherdingCore.holdScrubberLabel instead:\n  ' + offenders.join('\n  '));
});

// The two copies name their method differently because each reads its own state
// — the People list's live filter, the editor's half-built view — so the test
// names both rather than pattern-matching loosely across them.
const SCRUBBER_TOOLTIP = {
    'shepherding-people.html': 'holdScrubberLabel',
    'shepherding-dashboard.html': 'viewNewScrubberLabel',
};

test('both copies of the widget build their scrubber tooltip through the helper', () => {
    for (const [html, method] of Object.entries(SCRUBBER_TOOLTIP)) {
        const src = read(html);
        const slider = src.match(/<input[^>]*class="tag-hold-slider[^"]*"/gs);
        assert.ok(slider && slider.length > 0, html + ' has no Hold-Duration scrubber to check');
        slider.forEach(tag => {
            contains(tag, new RegExp(':title="' + method + '\\('),
                html + ': the scrubber tooltip must be ' + method + '(), not a literal');
        });
    }
});

test('both copies of the widget delegate their wording to the shared core', () => {
    for (const js of ['shepherding-people.js', 'shepherding-dashboard.js']) {
        const src = read(js);
        contains(src, /ShepherdingCore\.holdScrubberLabel\(/,
            js + ' must ask the core for the scrubber tooltip');
        contains(src, /ShepherdingCore\.holdDirectionWord\(/,
            js + ' must ask the core for the direction word');
    }
});

// The glyph appeared in a THIRD place — the saved view's own card, which
// summarises the filter the editor beside it is building. Review caught it; the
// first draft of this test did not, because it only read the .js files. Hence
// every file the widget touches, markup included.
test('nowhere maps the direction to a > / < glyph any more', () => {
    for (const file of WIDGET_FILES) {
        lacks(read(file), /===\s*'lt'\s*\?\s*'<'\s*:\s*'>'/,
            file + ' still derives a > / < glyph; MS-279 replaced it with older / recent');
    }
});

// ── The slider axis (source of the "it runs backwards" report) ────────────────
// Cheap, and it locks the axis so a future "fix" cannot invert the wrong layer.

test('the Hold-Duration stops ascend, and the first one means no threshold', () => {
    const stops = Core.HOLD_FILTER_STOPS;
    assert.strictEqual(stops[0], 0, 'sliding fully left must mean any length of hold');
    for (let i = 1; i < stops.length; i++) {
        assert.ok(stops[i] > stops[i - 1],
            `stop ${i} (${stops[i]}) must be longer than stop ${i - 1} (${stops[i - 1]}) — ` +
            'sliding right always means more time held, whichever direction is selected');
    }
});
