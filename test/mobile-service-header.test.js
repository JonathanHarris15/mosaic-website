// The phone's header on the Order of Service (MS-310).
//
// On a phone this page hides its own header and the app shell draws one — and
// that header showed the fixed words "Service Editor". The Sunday you were
// editing appeared nowhere on the screen, and there was no way to step to the
// next one without going back out to Services.
//
// The fix does not build a second set of arrows. The page's own arrow group is
// MOVED into the shell's row, so the phone presses the same buttons the desktop
// does. These tests pin that wiring, because it is the kind that breaks
// silently: a renamed class, and the arrows simply stop appearing on phones
// while every test stays green.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

test('the arrow group is marked for the shell to adopt', () => {
    const html = read('service-builder.html');
    const hooks = html.match(/data-mobile-header-nav/g) || [];
    assert.strictEqual(hooks.length, 1,
        'the shell adopts ONE nav group; a second would be silently dropped');
    const hook = html.indexOf('data-mobile-header-nav');
    const back = html.indexOf('stepService(-1)');
    const fwd = html.indexOf('stepService(1)');
    assert.ok(hook !== -1 && back > hook && fwd > hook && fwd - hook < 1600,
        'both arrows should still sit inside the marked group');
});

test('the shell header adopts that group and puts it beside the title', () => {
    const js = read('mobile-shell-header.js');
    assert.match(js, /querySelector\("\[data-mobile-header-nav\]"\)/,
        'the shell never looks for the group, so the arrows die with the hidden header');
    assert.ok(js.indexOf('row.appendChild(title)') < js.indexOf('row.appendChild(adoptedNav)'),
        'the arrows belong after the date, not before it');
});

test('the page names the Sunday in the shell header', () => {
    const js = read('service-builder.js');
    assert.match(js, /setMobileHeaderTitle\(DateUtils\.formatDateMedium\(this\.date\)\)/,
        'the phone header would go back to saying "Service Editor"');
    // Medium, not long: the row already carries a back arrow and two chevrons.
    assert.doesNotMatch(js, /setMobileHeaderTitle\(DateUtils\.formatDateLong/);
});

test('the page loads the shell header before it tries to talk to it', () => {
    const html = read('service-builder.html');
    assert.ok(html.indexOf('mobile-shell.js') < html.indexOf('mobile-shell-header.js'),
        'the header script no-ops unless the shell class is already set');
    assert.match(html, /window\.MOBILE_HEADER/);
});
