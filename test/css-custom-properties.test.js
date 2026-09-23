const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// ⚠ A var() THAT RESOLVES TO NOTHING DOES NOT FALL BACK. It is invalid at
// computed-value time, which deletes the WHOLE declaration it sits in — not
// just the one value. So a stylesheet that names a custom property nothing
// declares is not a stylesheet with a wrong colour in it; it is a stylesheet
// with a rule silently missing.
//
// ⚠ WHAT THIS EXISTS TO STOP COMING BACK. Motion was hand-written in the
// design system's `build/design-tokens/spacing.css`, below the `@generated`
// marker, on the stated grounds that "the app has no opinion on motion". The
// app had seventy-five of them — every button hover, every input focus ring,
// every disclosure, the Calendar's opening week — all written as
// `var(--duration)` and `var(--ease-standard)`, and only the block INSIDE the
// marker is spliced into `mosaic.css`. Not one of those transitions had ever
// run. Nothing looked broken, because a missing fade looks exactly like a
// design that chose not to fade.
//
// It is read off `public/mosaic.css` because that is the sheet every page
// loads and the only one the browser resolves `:root` from.

const SHEET = path.join(__dirname, '..', 'public', 'mosaic.css');

// Tailwind's own plumbing. `--tw-shadow-color` is set by the `shadow-<colour>`
// utilities, which this build does not generate, and Tailwind's ring and
// shadow rules are written to degrade without it. Not ours to declare.
const TAILWIND_INTERNAL = /^--tw-/;

test('mosaic.css declares every custom property it reaches for', () => {
    const css = fs.readFileSync(SHEET, 'utf8');
    const declared = new Set((css.match(/(--[\w-]+)\s*:/g) || []).map(s => s.replace(/\s*:$/, '')));

    // A var() WITH a fallback is a deliberate knob — a page or a script fills
    // it in, and the sheet says what to do when nobody has. Only a bare one is
    // a promise the sheet has to keep itself.
    const missing = new Map();
    const re = /var\(\s*(--[\w-]+)\s*(,)?/g;
    let m;
    while ((m = re.exec(css))) {
        const [, name, hasFallback] = m;
        if (hasFallback || declared.has(name) || TAILWIND_INTERNAL.test(name)) continue;
        missing.set(name, (missing.get(name) || 0) + 1);
    }

    assert.deepStrictEqual([...missing.keys()], [],
        'mosaic.css names custom properties it never declares, so every rule using them ' +
        'is dropped whole: ' + [...missing].map(([n, c]) => `${n} (${c}x)`).join(', '));
});

test('the motion tokens reach the app, not only the design system', () => {
    // Named one at a time rather than counted, because the point is not "some
    // motion exists" — each of these is the duration or curve a different set
    // of rules is written in, and any one of them going missing takes its
    // rules with it.
    const css = fs.readFileSync(SHEET, 'utf8');
    const gone = ['--ease-standard', '--duration-fast', '--duration', '--duration-slow']
        .filter(name => !new RegExp(name + '\\s*:').test(css));

    assert.deepStrictEqual(gone, [],
        'motion has dropped out of mosaic.css again, which silently disables every ' +
        'transition written in it: ' + gone.join(', '));
});

test('motion is generated from the config, not written down twice', () => {
    // One source, four outputs. Hand-writing the same values into the design
    // system's own file is how they got out of the app's reach in the first
    // place — the app compiles only what the generator splices.
    const config = fs.readFileSync(path.join(__dirname, '..', 'tailwind.config.js'), 'utf8');
    assert.ok(/transitionDuration\s*:/.test(config) && /transitionTimingFunction\s*:/.test(config),
        'motion is no longer in tailwind.config.js, so the generator cannot carry it anywhere');

    const spacing = fs.readFileSync(
        path.join(__dirname, '..', 'build', 'design-tokens', 'spacing.css'), 'utf8');
    const afterMarker = spacing.slice(spacing.indexOf('/* @generated:end */'));
    assert.ok(!/--duration|--ease-/.test(afterMarker),
        'motion has been hand-written back below the @generated marker, where only the ' +
        'design system can see it');
});
