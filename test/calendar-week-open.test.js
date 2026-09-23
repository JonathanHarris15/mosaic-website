const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Opening a week on the Calendar's month grid — the "N more" control.
//
// ⚠ WHAT THIS EXISTS TO STOP COMING BACK. One row was asked to grow and the
// whole month moved: every one of the five weeks took a share of a height
// nothing in it had asked for, the cells stayed pinned to the pixel height
// they were given, and each day ended up with a gap under its chips. It was
// not a wobble — the grid stayed like that for as long as the row took to
// travel, which was the whole of the open and the whole of the close.
//
// Three separate things had to be true for that, and each one has a test here.
// They are all layout rules, so they are read off the stylesheet the browser
// actually loads rather than the source they are generated from: what ships is
// public/mosaic.css, and a rule that is right in build/design-components.mjs
// and missing from the build is a rule that does nothing.

const PUBLIC = path.join(__dirname, '..', 'public');
const css = () => fs.readFileSync(path.join(PUBLIC, 'mosaic.css'), 'utf8');

/** The declarations of a rule in the minified sheet, as one string. */
function ruleBody(sheet, selector) {
    const at = sheet.indexOf(selector + '{');
    if (at === -1) return null;
    return sheet.slice(at + selector.length + 1, sheet.indexOf('}', at));
}

test('the opened week is the only row that can grow', () => {
    // Auto rows SHARE OUT whatever height the grid box has beyond what its
    // rows need — and open, the box is not the one deciding how tall it is.
    // Without `align-content: start` the surplus lands on all five rows at
    // once while the cells stay at their pinned height, which is the gap under
    // every day in the month.
    const body = ruleBody(css(), '.m-cal--fit .m-cal__grid--open');
    assert.ok(body, 'the opened month no longer has a rule of its own');
    assert.ok(/grid-auto-rows:\s*auto/.test(body),
        'the opened month is dividing its box equally again, so the opened row cannot be taller');
    assert.ok(/align-content:\s*start/.test(body),
        'the opened month will share surplus height across all five weeks again');
});

test('the row travels to its open height rather than jumping to it', () => {
    // ⚠ WRITTEN IN TOKENS, SO THE TOKENS HAVE TO BE IN THE SHEET THAT SHIPS
    // IT. `--duration-slow` and `--ease-standard` used to be hand-written in
    // the design system's spacing.css, below the @generated marker, and
    // nothing spliced them into mosaic.css. A transition written in terms of
    // them resolves to nothing and takes the whole declaration with it — the
    // row then snaps open and snaps shut, and the 320ms the component waits
    // before letting the grid re-fit is 320ms of a month sitting in the
    // in-between state rather than 320ms of animation.
    const sheet = css();
    const body = ruleBody(sheet, '.m-cal--open .m-cal__cell');
    assert.ok(body, 'the opened cell has no transition rule at all');
    assert.ok(/transition:[^;]*height/.test(body),
        'the opened cell no longer transitions its height');

    const used = body.match(/var\(\s*(--[\w-]+)/g) || [];
    const dead = used
        .map(v => v.replace(/var\(\s*/, ''))
        .filter(name => !new RegExp(name + '\\s*:').test(sheet));
    assert.deepStrictEqual(dead, [],
        'the transition names custom properties mosaic.css never declares, so it does nothing: ' +
        dead.join(', '));
});

test('nothing beside the month can stretch it while a week is open', () => {
    // Two ways in, and the grid cannot tell them apart — it is simply handed a
    // box taller than its weeks.
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar.html'), 'utf8');

    // From the side: open, the page stops fitting the window and the layout
    // row is as tall as the TALLER of its two columns. "Needs sorting" is
    // routinely taller than five weeks of grid.
    assert.ok(/body\.cal-open[^{]*\.m-cal--fit\s*\{[^}]*align-self:\s*start/.test(html),
        'the rail can stretch the month card again while a week is open');

    // From the rail: the five months are laid out in one grid row, so that row
    // is as tall as the tallest of them. Fitted they are all 100% and agree;
    // open, `height: auto` let the four nobody is looking at grow to their own
    // contents and hold the month on screen open with them.
    assert.ok(/\.m-cal--fit\.m-cal--open \[data-rail-month\]:not\(\.m-cal__grid--open\)\s*\{[^}]*height:\s*0/.test(html),
        'the months off screen are back in the measuring, so one of them can set the height of the month on screen');
});
