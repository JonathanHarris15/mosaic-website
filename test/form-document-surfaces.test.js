const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-387 — both surfaces, and the words for what was built.
//
// The dangerous one here is not a layout problem. The phone has its OWN native
// Documents screen, and it routes on `docType`. A Form Document falling through
// that branch would open in the native PROSE editor — an empty body, inviting
// somebody to type into a record whose answers live somewhere else entirely.
// Nothing would error and nothing would be saved where it belonged.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const NATIVE = read('public', 'mobile', 'screens-documents.js');
const PAGE = read('public', 'shepherding-form-document.html');
const CONTEXT = read('CONTEXT.md');

// ── The phone opens one correctly ────────────────────────────────────────────

test('the phone does not open a Form Document in the prose editor', () => {
    const open = NATIVE.match(/function openDoc\(id\)[\s\S]*?\n    \}/);
    assert.ok(open, 'openDoc has gone missing from the native Documents screen');
    assert.match(open[0], /docType === "form"/,
        'a form document falls through to the native prose editor');

    // And the form branch must return before reaching documentEditor.
    const formAt = open[0].indexOf('docType === "form"');
    const proseAt = open[0].indexOf('props.nav("documentEditor"');
    assert.ok(formAt < proseAt, 'the form branch is after the prose editor and never runs');
});

test('the phone opens the one Form Document page rather than a native copy', () => {
    const open = NATIVE.match(/function openDoc\(id\)[\s\S]*?\n    \}/);
    assert.match(open[0], /shepherding-form-document\.html\?id=/);
    assert.match(open[0], /shell=mobile/, 'it opens outside the shell and loses the chrome');

    const mobileDir = fs.readdirSync(path.join(ROOT, 'public', 'mobile'));
    const rogue = mobileDir.filter(f => /^screens-form/.test(f));
    assert.deepEqual(rogue, [],
        'a native phone copy of the Form Document editor has appeared: ' + rogue.join(', '));
});

test('the gap in making one on a phone is written down, not left to be found', () => {
    // The native new-document flow offers a note and a care list only. That is
    // a limitation; an undocumented limitation is a bug report.
    assert.match(NATIVE, /new-document flow here offers the first two only/i,
        'the native screen does not say why there is no Form option');
});

// ── The page itself on a phone ───────────────────────────────────────────────

test('the Form Document page runs inside the mobile shell', () => {
    assert.match(PAGE, /mobile-shell\.js/, 'it does not load the shell');
    assert.match(PAGE, /MOBILE_HEADER/, 'it gives the shell no header to draw');
});

test('its back link stays inside the shell when it is in one', () => {
    // A back link that jumps out of the shell strands somebody on a desktop
    // page with no way home.
    const js = read('public', 'shepherding-form-document.js');
    assert.match(js, /get backHref\(\)[\s\S]*?shell=mobile/,
        'the back link leaves the shell');
});

test('a scale point on this page is as big as one on the fill-in page', () => {
    // The controls are the same code, so their surroundings have to agree or
    // the same question is two different sizes on two screens.
    const point = PAGE.match(/\.fa-scale__point \{([^}]*)\}/);
    assert.ok(point, 'the scale points have no rule on this page');
    const min = point[1].match(/min-height:\s*(\d+)px/);
    assert.ok(min && Number(min[1]) >= 44, 'a tap target under 44px is one people miss');
    assert.match(PAGE, /\.fa-scale__points \{[^}]*flex-wrap:\s*wrap/,
        'a ten-point scale would run off the side of a phone');
});

// ── The words ────────────────────────────────────────────────────────────────

test('the glossary carries Form Document', () => {
    assert.match(CONTEXT, /### Form Document/);
    assert.match(CONTEXT, /third `docType`/, 'it does not say what a Form Document is stored as');
});

test('the glossary says the awkward parts, not only the good ones', () => {
    const entry = CONTEXT.slice(CONTEXT.indexOf('### Form Document'), CONTEXT.indexOf('### Answering rung'));
    assert.match(entry, /elder-only today/,
        'the glossary does not say who can actually use one');
    assert.match(entry, /open one but not yet make one/,
        'the glossary does not mention the phone limitation');
    assert.match(entry, /copy of its template's questions/,
        'the glossary does not say a document stops following its template');
});

test('the glossary says a template has a mode, and what a document one gives up', () => {
    assert.match(CONTEXT, /### Form Mode/);
    const entry = CONTEXT.slice(CONTEXT.indexOf('### Form Mode'), CONTEXT.indexOf('### Form Document'));
    assert.match(entry, /no \[\[Answering rung\]\]/, 'it does not say a document template has no rung');
    assert.match(entry, /null/, 'it does not say how that is stored, which is the part that matters');
});
