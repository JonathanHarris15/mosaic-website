const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// MS-660 / MS-662 — On the computer Membership Directory, Edit Mode → Edit
// Person opens a dialog. Save Profile was at the bottom of the scrolling
// profile fields, so a long involvement history hid it and left only Close.
// Save Profile belongs in the dialog footer, to the right of Close, outside
// the region that scrolls. Close is the quiet way to leave; Save Profile is
// the filled action, the same pairing the merge dialog on this page already
// uses. The header close icon only closes. Nothing about what a save writes
// is asserted here.

const html = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'peoples-page.html'),
    'utf8'
);

function between(src, from, to) {
    const a = src.indexOf(from);
    assert.notEqual(a, -1, 'not found: ' + from);
    const b = src.indexOf(to, a + from.length);
    assert.notEqual(b, -1, 'not found after ' + from + ': ' + to);
    return src.slice(a, b);
}

function personDialog() {
    return between(html, '<!-- Involvement Modal -->', '<!-- Super-admin debug');
}

function scrollingBody(dialog) {
    const start = dialog.indexOf('overflow-y-auto');
    assert.notEqual(start, -1, 'the person dialog has no scrolling body');
    const footerAt = dialog.indexOf('<footer', start);
    assert.notEqual(footerAt, -1, 'the person dialog has no footer after its scrolling body');
    return dialog.slice(start, footerAt);
}

function footerOf(fragment) {
    const start = fragment.lastIndexOf('<footer');
    assert.notEqual(start, -1, 'no footer');
    const end = fragment.indexOf('</footer>', start);
    assert.notEqual(end, -1, 'footer does not close');
    return fragment.slice(start, end);
}

function buttons(fragment) {
    return [...fragment.matchAll(/<button\b[\s\S]*?<\/button>/g)].map((m) => m[0]);
}

function classOf(tag) {
    const found = tag.match(/\bclass="([^"]*)"/);
    assert.ok(found, 'button has no class');
    return found[1];
}

test('Save Profile sits in the person dialog footer, outside the scrolling body', () => {
    const dialog = personDialog();
    const body = scrollingBody(dialog);
    const foot = footerOf(dialog);

    assert.equal(
        (body.match(/Save Profile/g) || []).length,
        0,
        'Save Profile is still inside the scrolling body'
    );
    assert.equal(
        (html.match(/Save Profile/g) || []).length,
        1,
        'Save Profile should appear once, in the person dialog footer'
    );

    const footButtons = buttons(foot);
    assert.equal(footButtons.length, 2, 'the footer should hold Close and Save Profile');
    assert.match(footButtons[0], />Close</);
    assert.match(footButtons[1], /Save Profile/);

    // Same pairing as the merge dialog: quiet leave, then the filled action.
    // Compared as class strings, not as colors or pixel positions.
    const merge = between(html, '<!-- Merge Confirmation Modal -->', '<!-- Involvement Modal -->');
    const mergeButtons = buttons(footerOf(merge));
    assert.equal(mergeButtons.length, 2, 'the merge dialog footer changed shape');
    assert.equal(
        classOf(footButtons[0]),
        classOf(mergeButtons[0]),
        'Close is not the quiet footer button'
    );
    assert.equal(
        classOf(footButtons[1]),
        classOf(mergeButtons[1]),
        'Save Profile is not the filled footer button'
    );

    assert.match(footButtons[1], /@click="updatePerson"/);
    assert.match(footButtons[1], /:disabled="isSubmitting"/);
    assert.match(footButtons[1], /x-show="!isSubmitting"/);
    assert.match(footButtons[1], /x-show="isSubmitting"/);
});

test('Close and the header icon leave the person dialog without writing the profile', () => {
    const dialog = personDialog();
    const close = buttons(footerOf(dialog))[0];
    assert.match(close, /@click="showInvolvementModal = false"/);
    assert.doesNotMatch(close, /updatePerson/);

    const head = between(dialog, '<header', 'overflow-y-auto');
    const icon = buttons(head).find((button) => />close</.test(button));
    assert.ok(icon, 'the header close icon is gone');
    assert.match(icon, /@click="showInvolvementModal = false"/);
    assert.doesNotMatch(icon, /updatePerson/);
    assert.doesNotMatch(head, /updatePerson/);
});

test('Membership Track, tags, and Family in the person dialog still write as they change', () => {
    const body = scrollingBody(personDialog());
    assert.match(body, /@change="setMembershipStageByIndex\(\$event\.target\.value\)"/);
    assert.match(body, /@click="toggleMembershipInactive\(\)"/);
    assert.match(body, /@click="addTag\(selectedPerson, tag\)/);
    assert.match(body, /@click="removeTag\(selectedPerson, tag\)"/);
    assert.match(body, /@click="setSpouse\(c\.id\)"/);
    assert.match(body, /@click="addChild\(c\.id\)"/);
    assert.doesNotMatch(body, /@click="updatePerson"/);
});
