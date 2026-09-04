const { test } = require('node:test');
const assert = require('node:assert');

// MS-391 — a photo off a phone is bigger than a form can take.
//
// ⚠ THE PROBLEM THIS SOLVES IS NOT A SIZE LIMIT, IT IS A DEAD END. A public
// form's uploads go through the publicForm function under admin credentials,
// because a stranger has no account and every storage rule wants one
// (ADR-0051). A function call is capped near 10MB and base64 inflates by a
// third, so the form's cap is 5MB — while a modern phone camera makes 8 to
// 12MB pictures. Refusing them means the person holding the phone cannot
// answer the form at all, and has no way to make the photo smaller.
//
// So a big photo is redrawn before it is sent. Every judgment about that lives
// here; the canvas work that carries it out is on the fill-in page, because
// only a browser can do it.

const FormsCore = require('../public/forms-core.js');

const MB = 1024 * 1024;
const photo = (type, mb) => ({ name: 'IMG_0421.jpg', type: type, size: mb * MB });

// ── What gets redrawn ────────────────────────────────────────────────────────

test('a phone photo too big to send is redrawn rather than refused', () => {
    const plan = FormsCore.shrinkPlan(photo('image/jpeg', 12));
    assert.strictEqual(plan.shrink, true, 'a 12MB photo is a dead end without this');
    assert.strictEqual(plan.type, 'image/jpeg');
    assert.ok(plan.maxEdge > 0 && plan.quality > 0 && plan.quality <= 1);
});

test('a photo comfortably under the cap is still redrawn, because the wait is the cost', () => {
    // 3MB fits, but as base64 up a phone's uplink it is a long silent wait for
    // a picture nobody looks at above 2000 pixels.
    assert.strictEqual(FormsCore.shrinkPlan(photo('image/jpeg', 3)).shrink, true);
});

test('a small photo is left exactly as it was chosen', () => {
    const plan = FormsCore.shrinkPlan(photo('image/jpeg', 0.4));
    assert.strictEqual(plan.shrink, false);
});

test('a PNG is redrawn as a JPEG, and its name says so', () => {
    // The size win is mostly the re-encode, not the resize.
    assert.strictEqual(FormsCore.shrinkPlan(photo('image/png', 9)).type, 'image/jpeg');
    assert.strictEqual(FormsCore.renamedFor('signature.png', 'image/jpeg'), 'signature.jpg');
});

test('a file already named .jpg is not renamed again', () => {
    assert.strictEqual(FormsCore.renamedFor('IMG_0421.jpg', 'image/jpeg'), 'IMG_0421.jpg');
    assert.strictEqual(FormsCore.renamedFor('scan.jpeg', 'image/jpeg'), 'scan.jpeg');
});

test('a photo with no extension gets one', () => {
    assert.strictEqual(FormsCore.renamedFor('photo', 'image/jpeg'), 'photo.jpg');
});

// ── What must never be redrawn ───────────────────────────────────────────────

test('an animation is never redrawn, because it would lose all but one frame', () => {
    // ⚠ A canvas keeps frame one and throws the rest away without saying so.
    // An over-sized GIF is refused instead, which at least tells somebody.
    assert.strictEqual(FormsCore.shrinkPlan(photo('image/gif', 9)).shrink, false);
});

test('a drawing is never redrawn, because it would stop being a drawing', () => {
    assert.strictEqual(FormsCore.shrinkPlan(photo('image/svg+xml', 9)).shrink, false);
});

test('a document is never redrawn — this is for photos only', () => {
    assert.strictEqual(FormsCore.shrinkPlan(photo('application/pdf', 9)).shrink, false);
    assert.strictEqual(FormsCore.shrinkPlan(photo('', 9)).shrink, false);
    assert.strictEqual(FormsCore.shrinkPlan(null).shrink, false);
});

// ── The size to redraw at ────────────────────────────────────────────────────

test('a photo comes down to its longest edge and keeps its shape', () => {
    const fit = FormsCore.fittedSize(4032, 3024, 2000);
    assert.strictEqual(fit.width, 2000);
    assert.strictEqual(fit.height, 1500, 'the picture was stretched');
});

test('a portrait photo comes down by its height, not its width', () => {
    const fit = FormsCore.fittedSize(3024, 4032, 2000);
    assert.strictEqual(fit.height, 2000);
    assert.strictEqual(fit.width, 1500);
});

test('a photo already small enough is never scaled up', () => {
    // Enlarging costs bytes and adds nothing that was not there.
    const fit = FormsCore.fittedSize(800, 600, 2000);
    assert.deepEqual(fit, { width: 800, height: 600 });
});

test('a redrawn photo is never zero pixels on a side', () => {
    // A panorama is the case: 8000×200 scaled to a 20-pixel edge rounds the
    // short side to nothing, and a zero-width canvas throws.
    const fit = FormsCore.fittedSize(8000, 200, 20);
    assert.ok(fit.width >= 1 && fit.height >= 1);
});

// ── Whether the result was worth keeping ─────────────────────────────────────

test('a redraw that came back bigger is thrown away', () => {
    // ⚠ Re-encoding can grow a file — a flat graphic pushed through JPEG is
    // the usual way. Sending a copy that is both worse AND heavier than what
    // somebody chose is wrong in both directions at once.
    assert.strictEqual(FormsCore.worthKeeping(2 * MB, 3 * MB), false);
    assert.strictEqual(FormsCore.worthKeeping(2 * MB, 2 * MB), false);
});

test('a redraw that saved something is kept', () => {
    assert.strictEqual(FormsCore.worthKeeping(9 * MB, 600 * 1024), true);
});

test('a redraw that produced nothing at all is thrown away', () => {
    assert.strictEqual(FormsCore.worthKeeping(9 * MB, 0), false);
    assert.strictEqual(FormsCore.worthKeeping(9 * MB, NaN), false);
});

// ── The cap the whole thing exists to get under ──────────────────────────────

test('a typical phone photo lands well under the cap once redrawn', () => {
    // Not a promise about any one picture — it pins that the target is
    // meaningfully below the cap rather than level with it, so an awkward
    // photo still has room.
    const pixels = FormsCore.SHRINK_MAX_EDGE * FormsCore.SHRINK_MAX_EDGE;
    const roughBytes = pixels * 0.25; // a generous JPEG at this quality
    assert.ok(roughBytes < FormsCore.MAX_UPLOAD_BYTES,
        'the size we redraw to could still be refused, which would help nobody');
});

test('the threshold for redrawing sits under the cap, not on it', () => {
    assert.ok(FormsCore.SHRINK_OVER_BYTES < FormsCore.MAX_UPLOAD_BYTES,
        'a photo would only be redrawn once it was already too big to send');
});

// ── The page that carries it out ─────────────────────────────────────────────

const fs = require('node:fs');
const path = require('node:path');
const ANSWER_JS = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'form-answer.js'), 'utf8').replace(/\r\n/g, '\n');

test('a redraw that fails still lets the photo through', () => {
    // ⚠ A browser that cannot do canvas work must not become a form nobody can
    // answer. The original goes instead and the size check decides its fate —
    // which is the worst case we had before, not a new one.
    const fn = ANSWER_JS.match(/onFileChosen\(q, ev\) \{[\s\S]*?\n            \},/);
    assert.ok(fn, 'onFileChosen has gone missing');
    assert.match(fn[0], /\.catch\(/, 'a failed redraw is not caught at all');
    assert.match(fn[0], /catch\(\(\) => \{[\s\S]*?takeFile\(q, file\)/,
        'a failed redraw drops the photo instead of sending the original');
});

test('the page asks the model whether the redraw was worth keeping', () => {
    const fn = ANSWER_JS.match(/onFileChosen\(q, ev\) \{[\s\S]*?\n            \},/);
    assert.match(fn[0], /FormsCore\.worthKeeping\(file\.size, smaller\.size\)/,
        'the page decides for itself, so a bigger redraw could be sent');
    assert.match(fn[0], /FormsCore\.shrinkPlan\(file\)/,
        'the page decides for itself what to redraw');
});

test('the canvas is painted white before the photo is drawn on it', () => {
    // ⚠ A signature on a transparent background saved as JPEG comes out as a
    // BLACK BOX without this. Verified in a real browser: the corner pixel of
    // a redrawn transparent PNG reads 255,255,255.
    const fn = ANSWER_JS.match(/function shrinkImage\(file, plan\) \{[\s\S]*?\n    \}/);
    assert.ok(fn, 'shrinkImage has gone missing');
    const fill = fn[0].indexOf('fillRect');
    const draw = fn[0].indexOf('drawImage');
    assert.ok(fill !== -1 && draw !== -1, 'the canvas is not filled before it is drawn on');
    assert.ok(fill < draw, 'the photo is drawn first and then painted over');
});

test('the object URL is released on every way out', () => {
    // A page somebody fills in on a phone, choosing and re-choosing a photo,
    // would otherwise hold every one of them in memory.
    const fn = ANSWER_JS.match(/function shrinkImage\(file, plan\) \{[\s\S]*?\n    \}/);
    const releases = (fn[0].match(/revokeObjectURL/g) || []).length;
    assert.ok(releases >= 3,
        'one of the ways out of shrinkImage leaks the photo it opened');
});
