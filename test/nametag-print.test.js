// Getting the print dialog to actually open (MS-317 / MS-320, fixed here).
//
// ⚠ WHAT WENT WRONG ON A SUNDAY MORNING. Greeters pressed the button and
// NOTHING happened — no dialog, no error, no label. Ctrl+P on the same machine
// worked fine, which ruled out the printer, the driver and the browser.
//
// The cause was the scheduling, not the printing. `printLabels` waited for the
// frame's `load` and then asked THE FRAME for an animation frame before calling
// print(). That frame is parked off-screen at `opacity: 0`, and Chrome skips
// rendering work for a subtree it is not going to paint — so the callback never
// ran, `win.print()` was never called, and the page sat there with `printing`
// stuck true. The dialog was never suppressed; it was never requested.
//
// The mechanics of printLabels had never been under test at all — nametag-core's
// suite covers `printHtml`, the markup, which was always fine. This is the seam
// the bug actually lived in.

const {test, describe} = require('node:test');
const assert = require('node:assert');

const Nametag = require('../public/nametag-core.js');

const LABELS = [{kind: 'adult', first: 'Ada', last: 'Cole'}];

/**
 * A document stand-in whose clocks the test drives by hand.
 *
 * `runFrames()` and `runTimers()` are separate on purpose: the bug was a
 * callback queued on a clock that never ticked, so a fake that ran everything
 * automatically would have hidden it just as effectively as Chrome did.
 */
function fakeDoc() {
    const frames = [];
    const timers = [];
    const printed = [];
    const created = [];

    const view = {
        requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
        setTimeout(fn, ms) { timers.push({fn, ms}); return timers.length; },
    };

    const body = {children: [], appendChild(el) { this.children.push(el); }};

    const doc = {
        defaultView: view,
        body,
        getElementById(id) {
            return created.find(el => el.id === id) || null;
        },
        createElement() {
            const el = {
                id: '',
                style: {cssText: ''},
                onload: null,
                _srcdoc: '',
                attrs: {},
                setAttribute(k, v) { this.attrs[k] = v; },
                contentWindow: {
                    focus() {},
                    print() { printed.push(el._srcdoc); },
                },
                set srcdoc(html) {
                    this._srcdoc = html;
                    this.loadPending = true;
                },
                get srcdoc() { return this._srcdoc; },
            };
            created.push(el);
            return el;
        },
    };

    return {
        doc,
        printed,
        created,
        // The frame finished loading, as Chrome would say it had.
        fireLoad() {
            created.forEach(el => { if (el.onload) el.onload(); });
        },
        // Two ticks, because laying out before printing takes more than one.
        runFrames(times = 4) {
            for (let i = 0; i < times; i += 1) {
                const queued = frames.splice(0, frames.length);
                queued.forEach(fn => fn());
            }
        },
        runTimers() {
            const queued = timers.splice(0, timers.length);
            queued.forEach(t => t.fn());
        },
        pendingFrames: () => frames.length,
        pendingTimers: () => timers.slice(),
    };
}

describe('asking for the print dialog', () => {
    test('the dialog is asked for once the frame has loaded', () => {
        const env = fakeDoc();
        Nametag.printLabels(LABELS, env.doc);

        env.fireLoad();
        env.runFrames();

        assert.strictEqual(env.printed.length, 1);
        assert.match(env.printed[0], /Ada/);
    });

    test('the waiting is done on the PAGE\'s clock, not the hidden frame\'s', () => {
        // The bug, pinned. The frame is off-screen and unpainted, so Chrome may
        // never run an animation frame inside it. Nothing here may be scheduled
        // on `frame.contentWindow`.
        const env = fakeDoc();
        Nametag.printLabels(LABELS, env.doc);

        const frame = env.created[0];
        assert.strictEqual(typeof frame.contentWindow.requestAnimationFrame, 'undefined',
            'the frame was given no rAF, so the code must not have reached for one');

        env.fireLoad();
        env.runFrames();
        assert.strictEqual(env.printed.length, 1);
    });

    test('a load event that never arrives still prints', () => {
        // The belt to the braces. A frame that fails to fire `load` used to mean
        // silence; now a fallback timer asks anyway.
        const env = fakeDoc();
        Nametag.printLabels(LABELS, env.doc);

        assert.ok(env.pendingTimers().length >= 1, 'a fallback timer must be armed');
        env.runTimers();

        assert.strictEqual(env.printed.length, 1);
    });

    test('it prints once, not twice, when both the load and the fallback land', () => {
        const env = fakeDoc();
        Nametag.printLabels(LABELS, env.doc);

        env.fireLoad();
        env.runFrames();
        env.runTimers();
        env.runFrames();

        assert.strictEqual(env.printed.length, 1);
    });

    test('the caller is told it is over, so the button cannot stick', () => {
        // `printing` on the kiosk page is set true before this and false in the
        // callback. A callback that never runs leaves the greeter looking at a
        // disabled button with no dialog — which is what they reported.
        const env = fakeDoc();
        let done = 0;
        Nametag.printLabels(LABELS, env.doc, () => { done += 1; });

        env.fireLoad();
        env.runFrames();

        assert.strictEqual(done, 1);
    });

    test('the caller is told it is over even when the frame never loads', () => {
        const env = fakeDoc();
        let done = 0;
        Nametag.printLabels(LABELS, env.doc, () => { done += 1; });

        env.runTimers();

        assert.strictEqual(done, 1);
    });

    test('the caller is told it is over even if print() itself throws', () => {
        const env = fakeDoc();
        let done = 0;
        Nametag.printLabels(LABELS, env.doc, () => { done += 1; });

        env.created[0].contentWindow.print = () => { throw new Error('no printer'); };
        env.fireLoad();
        env.runFrames();

        assert.strictEqual(done, 1, 'a failed print must still release the button');
    });
});

describe('the frame the labels are printed from', () => {
    test('has a real size — a 0x0 frame makes Chrome close its own dialog', () => {
        const env = fakeDoc();
        Nametag.printLabels(LABELS, env.doc);

        const css = env.created[0].style.cssText;
        assert.match(css, /width:\s*\d+px/);
        assert.match(css, /height:\s*\d+px/);
        assert.ok(!/width:\s*0/.test(css), css);
    });

    test('is off-screen but not invisible', () => {
        // `opacity: 0` is the other half of what stopped Chrome doing rendering
        // work here. Off-screen is enough to keep it out of the greeter's way.
        const env = fakeDoc();
        Nametag.printLabels(LABELS, env.doc);

        const css = env.created[0].style.cssText;
        assert.match(css, /left:\s*-\d+px/);
        assert.ok(!/opacity/.test(css), 'opacity must not be used to hide the frame: ' + css);
    });

    test('is made once and reused, never rebuilt under an open dialog', () => {
        const env = fakeDoc();
        Nametag.printLabels(LABELS, env.doc);
        Nametag.printLabels(LABELS, env.doc);

        assert.strictEqual(env.created.length, 1);
    });

    test('a second print sends the new labels, not the first set again', () => {
        const env = fakeDoc();

        Nametag.printLabels([{kind: 'adult', first: 'Ada', last: 'Cole'}], env.doc);
        env.fireLoad();
        env.runFrames();

        Nametag.printLabels([{kind: 'adult', first: 'Bram', last: 'Vale'}], env.doc);
        env.fireLoad();
        env.runFrames();

        assert.strictEqual(env.printed.length, 2);
        assert.match(env.printed[1], /Bram/);
    });

    test('with no document to hang a frame off, it still returns the markup', () => {
        const html = Nametag.printLabels(LABELS, null);
        assert.match(html, /Ada/);
    });
});
