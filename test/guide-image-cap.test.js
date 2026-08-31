const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const Core = require('../public/guide-image-core.js');

const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

// ── What a picture may weigh ─────────────────────────────────────────────────
//
// A guide's pictures are stored INSIDE services/{date}, and Firestore refuses a
// document over 1,048,576 bytes. One photo off a phone was 1.13MB on its own,
// so the week's guide stopped saving — as an autosave, quietly.

test('a picture is capped well under what the document can hold', () => {
    // The rest of a week's guide is around 180KB, so several pictures at the
    // budget still leave room before the 1MB wall.
    assert.ok(Core.BUDGET_BYTES <= 300 * 1024, 'the budget is too close to the wall');
    assert.ok(Core.BUDGET_BYTES * 3 + 200 * 1024 < 1048576,
        'three pictures and a snapshot would not fit in one document');
});

test('a big picture is fitted to the ceiling, and a small one is left alone', () => {
    assert.deepStrictEqual(Core.scaledSize(4000, 3000, 1400), { width: 1400, height: 1050 });
    assert.deepStrictEqual(Core.scaledSize(3000, 4000, 1400), { width: 1050, height: 1400 });
    // Never enlarged: upscaling stores a blurrier, bigger copy.
    assert.deepStrictEqual(Core.scaledSize(600, 400, 1400), { width: 600, height: 400 });
});

test('nonsense dimensions still give a canvas something to be', () => {
    assert.deepStrictEqual(Core.scaledSize(0, 0, 1400), { width: 1, height: 1 });
    assert.deepStrictEqual(Core.scaledSize(null, undefined, 1400), { width: 1, height: 1 });
});

test('the ladder only ever steps down', () => {
    const rungs = Core.attempts();
    assert.ok(rungs.length > 1);
    for (let i = 1; i < rungs.length; i++) {
        assert.ok(rungs[i].maxEdge < rungs[i - 1].maxEdge, 'rung ' + i + ' is not smaller');
        assert.ok(rungs[i].quality <= rungs[i - 1].quality, 'rung ' + i + ' is not lighter');
    }
});

test('the first rung that fits is the one kept', () => {
    const budget = 100;
    const tried = [
        { rung: { maxEdge: 1400 }, dataUrl: 'x'.repeat(400) },
        { rung: { maxEdge: 1100 }, dataUrl: 'x'.repeat(90) },
        { rung: { maxEdge: 900 }, dataUrl: 'x'.repeat(20) },
    ];
    assert.strictEqual(Core.chooseAttempt(tried, budget).rung.maxEdge, 1100,
        'it kept shrinking a picture that already fitted');
});

test('a picture that will not come under budget is stored small, not refused', () => {
    // A Sunday deadline is the wrong moment to be told to go and resize a file.
    const budget = 10;
    const tried = [
        { rung: { maxEdge: 1400 }, dataUrl: 'x'.repeat(400) },
        { rung: { maxEdge: 700 }, dataUrl: 'x'.repeat(40) },
    ];
    assert.strictEqual(Core.chooseAttempt(tried, budget).rung.maxEdge, 700);
    assert.strictEqual(Core.chooseAttempt([], budget), null);
});

test('a data URI is measured as the document will store it', () => {
    const uri = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
    assert.strictEqual(Core.storedBytes(uri), uri.length);
    assert.strictEqual(Core.storedBytes(null), 0);
    assert.strictEqual(Core.fitsBudget(uri, 2000), true);
    assert.strictEqual(Core.fitsBudget(uri, 100), false);
});

test('a picture that already fits is stored exactly as it was picked', () => {
    // Redrawing it would re-encode a PNG logo as a JPEG — white behind its
    // transparency, fuzz along its edges — to save nothing.
    assert.strictEqual(Core.needsRedraw({ type: 'image/png', size: 30 * 1024 }), false);
    assert.strictEqual(Core.needsRedraw({ type: 'image/jpeg', size: 4 * 1024 * 1024 }), true);
});

test('a file is measured as base64, not as it sits on disk', () => {
    // Encoding inflates it by a third, and a file that fits on disk can fail to
    // fit in the document.
    const justOver = { type: 'image/png', size: Math.ceil(Core.BUDGET_BYTES * 3 / 4) };
    assert.ok(Core.storedBytesFor(justOver) > Core.BUDGET_BYTES,
        'a file three-quarters of the budget was measured as if base64 were free');
    assert.strictEqual(Core.needsRedraw(justOver), true);

    // Four characters per three bytes, plus the header.
    assert.strictEqual(Core.storedBytesFor({ type: 'image/jpeg', size: 3 }),
        'data:image/jpeg;base64,'.length + 4);
    assert.strictEqual(Core.storedBytesFor({ type: 'image/jpeg', size: 0 }),
        'data:image/jpeg;base64,'.length);
});

test('only what a canvas can decode is accepted', () => {
    assert.strictEqual(Core.validateImageFile({ type: 'image/jpeg', size: 5000 }).ok, true);
    // An iPhone's own format cannot be drawn, and a file input restricted to the
    // accepted list makes iOS hand over a JPEG instead.
    assert.strictEqual(Core.validateImageFile({ type: 'image/heic', size: 5000 }).ok, false);
    assert.strictEqual(Core.validateImageFile({ type: 'image/jpeg', size: 40 * 1024 * 1024 }).ok, false);
    assert.strictEqual(Core.validateImageFile(null).ok, false);
});

// ── The screens that store one ───────────────────────────────────────────────

test('neither guide screen stores a picked file unread', () => {
    // `readAsDataURL` on a picked file is the bug itself: it stores whatever the
    // camera produced, at whatever size the camera produced it.
    ['service-guide-editor.js', 'service-guide.js'].forEach(f => {
        const js = read(f);
        assert.ok(js.indexOf('GuideImageCore.capToDataUrl') !== -1,
            f + ' does not cap a picked image');
        assert.strictEqual(js.indexOf('readAsDataURL'), -1,
            f + ' still reads a picked file straight into the document');
    });
});

test('the file inputs ask for what can actually be decoded', () => {
    const accept = Core.ACCEPTED_TYPES.join(',');
    ['service-guide-editor.html', 'service-guide.html'].forEach(f => {
        const html = read(f).replace(/\s+/g, ' ');
        assert.ok(html.indexOf('accept="' + accept + '"') !== -1,
            f + ' still offers the picker every file a phone holds');
    });
});
