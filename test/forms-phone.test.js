const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-381 — the surface that is easiest to forget.
//
// The phone opens the SAME library, form page and fill-in page rather than a
// second implementation of them (CONTEXT.md), so everything MS-361 added has to
// survive being opened in the mobile shell and being used with a thumb.
//
// The risk is concentrated in two places. Folders were built with a drag, and
// a touch screen has no drag — so if the "Move to…" fallback is ever behind a
// hover, filing becomes impossible on the device most people are holding. And
// the new question types are answered by strangers on phones, because the form
// arrives as a link in a text message.

const ROOT = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, 'public', name), 'utf8').replace(/\r\n/g, '\n');

const LIBRARY = read('forms.html');
const FORM = read('form.html');
const ANSWER = read('form-answer.html');

// ── The shell ────────────────────────────────────────────────────────────────

test('the library and the form page open inside the mobile shell', () => {
    [['forms.html', LIBRARY], ['form.html', FORM]].forEach(([name, page]) => {
        assert.match(page, /mobile-shell\.js/, name + ' does not load the shell');
        assert.match(page, /MOBILE_HEADER/, name + ' gives the shell no header to draw');
    });
});

test('the fill-in page deliberately does NOT load the shell', () => {
    // A stranger answering a public form has no account and no Mosaic
    // navigation. Loading the app shell there would offer a drawer full of
    // places they cannot go — and the shell assumes somebody is signed in.
    assert.doesNotMatch(ANSWER, /mobile-shell\.js/,
        'the page a stranger answers on should not carry the signed-in shell');
    assert.match(ANSWER, /name="viewport"/, 'it still has to be a phone page');
});

// ── Filing without a drag ────────────────────────────────────────────────────

test('every row offers "Move to…" as well as the drag', () => {
    assert.match(LIBRARY, /startMove\(folder, 'folder'\)/, 'a folder cannot be moved without dragging it');
    assert.match(LIBRARY, /startMove\(form, 'form'\)/, 'a form cannot be moved without dragging it');
});

test('the move and rename buttons are never behind a hover', () => {
    // A hover-only action row is invisible on a touch screen, and these are the
    // only way to file anything there.
    const styles = LIBRARY.slice(LIBRARY.indexOf('<style>'));
    assert.doesNotMatch(styles, /\.f-acts\s*\{[^}]*display:\s*none/,
        'the action buttons start hidden');
    assert.doesNotMatch(styles, /:hover[^{]*\.f-acts/,
        'the action buttons only appear on hover, which a thumb cannot do');
});

test('the breadcrumb wraps rather than running off the side', () => {
    const styles = LIBRARY.slice(LIBRARY.indexOf('<style>'));
    const crumbs = styles.match(/\.f-crumbs\s*\{([^}]*)\}/);
    assert.ok(crumbs, 'the breadcrumb has no rule of its own');
    assert.match(crumbs[1], /flex-wrap:\s*wrap/,
        'three folders deep would push the last one off a 390px screen');
});

test('the library has a phone width it was actually thought about at', () => {
    assert.match(LIBRARY, /@media \(max-width: \d+px\)/,
        'nothing in this page changes shape on a phone');
});

// ── Answering the new types with a thumb ─────────────────────────────────────

test('every new question type has a control on the fill-in page', () => {
    ['choice_many', 'dropdown', 'number', 'scale', 'date', 'time'].forEach(type => {
        assert.ok(ANSWER.includes("q.type === '" + type + "'"),
            type + ' has nothing to answer it with');
    });
});

test('the date and time questions use the phone\'s own pickers', () => {
    // A hand-drawn date picker is worse than the one built into the device,
    // and this page is met on a phone more often than not.
    assert.match(ANSWER, /type="date"/);
    assert.match(ANSWER, /type="time"/);
});

test('a linear scale wraps instead of scrolling sideways', () => {
    // A ten-point scale on a narrow phone becomes two rows, which is readable.
    // A sideways scroll hides the end somebody is reaching for.
    const styles = ANSWER.slice(ANSWER.indexOf('<style>'));
    const points = styles.match(/\.fa-scale__points\s*\{([^}]*)\}/);
    assert.ok(points, 'the scale row has no rule of its own');
    assert.match(points[1], /flex-wrap:\s*wrap/);
});

test('a scale point is big enough to hit with a thumb', () => {
    const styles = ANSWER.slice(ANSWER.indexOf('<style>'));
    const point = styles.match(/\.fa-scale__point\s*\{([^}]*)\}/);
    assert.ok(point, 'the scale points have no rule of their own');
    const min = point[1].match(/min-height:\s*(\d+)px/);
    assert.ok(min && Number(min[1]) >= 44,
        'a tap target under 44px is one people miss');
});

// ── One implementation, not two ──────────────────────────────────────────────

test('the phone opens these pages rather than reimplementing them', () => {
    // CONTEXT.md's rule. A second phone-only forms library is the thing this
    // whole shell arrangement exists to avoid.
    const mobileDir = fs.readdirSync(path.join(ROOT, 'public', 'mobile'));
    const rogue = mobileDir.filter(f => /^screens-forms?/.test(f));
    assert.deepEqual(rogue, [],
        'a native phone copy of the forms screens has appeared: ' + rogue.join(', '));
});

// ── The door onto the library ────────────────────────────────────────────────
//
// MS-360 built the Forms library and never put a door on it: no dashboard card,
// no drawer entry, reachable only by typing the URL. Both surfaces get one now,
// and the gate is written in three places — the page's own check, the web card,
// and the phone drawer. Three copies of one rule is three chances to drift, so
// this holds them together.

const MAY_MANAGE = ['editor', 'elder', 'admin', 'super_admin'];

test('the dashboard offers Forms to editors and above', () => {
    const index = read('index.html');
    const card = index.match(/id = 'forms-card'[\s\S]{0,1200}?grid\.appendChild\(card\);/);
    assert.ok(card, 'the Forms card has gone missing from the dashboard');
    assert.match(card[0], /card\.href = 'forms\.html'/);
    assert.match(card[0], /Forms/, 'the card does not say what it is');
});

test('the dashboard card, the drawer entry and the page agree on who may see it', () => {
    const index = read('index.html');
    const gate = index.match(/!document\.getElementById\('forms-card'\) &&\s*\n\s*\[([^\]]*)\]/);
    assert.ok(gate, 'the Forms card has no permission gate at all');
    MAY_MANAGE.forEach(level => {
        assert.ok(gate[1].includes(`'${level}'`), `the card is closed to ${level}`);
    });
    assert.ok(!gate[1].includes("'member'"), 'the card is open to a member, who the page will refuse');
    assert.ok(!gate[1].includes("'viewer'"), 'the card is open to a viewer, who the page will refuse');

    const Destinations = require('../public/mobile/destinations.js');
    const forms = Destinations.DESTINATIONS.find(d => d.key === 'forms');
    assert.ok(forms, 'the phone drawer has no Forms entry');
    MAY_MANAGE.forEach(level => {
        assert.equal(Destinations.canSee(forms, { permissionLevel: level }), true, level);
    });
    ['member', 'viewer'].forEach(level => {
        assert.equal(Destinations.canSee(forms, { permissionLevel: level }), false,
            `the drawer offers Forms to a ${level}, who the page will refuse`);
    });
    assert.equal(Destinations.canSee(forms, null), false, 'a signed-out guest is offered Forms');

    // And the page's own check, which is the one that actually refuses.
    const page = fs.readFileSync(path.join(ROOT, 'public', 'forms.js'), 'utf8');
    const may = page.match(/mayManageForms\(level\) \{[\s\S]*?\n        \}/);
    assert.ok(may, 'forms.js no longer gates itself');
    MAY_MANAGE.forEach(level => {
        assert.ok(may[0].includes(`'${level}'`), `the page refuses ${level}, who the card offers it to`);
    });
});

test('the phone opens the same library rather than a native copy of it', () => {
    const Destinations = require('../public/mobile/destinations.js');
    assert.equal(Destinations.SHELL_PAGES.forms, 'forms.html',
        'the drawer route should open the one library in the shell');
    assert.match(Destinations.routeHref('forms'), /forms\.html\?shell=mobile/);
});
