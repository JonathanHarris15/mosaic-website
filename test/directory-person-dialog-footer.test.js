const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// MS-660 / MS-662 — On the computer Membership Directory, Edit Mode → Edit
// Person opens the person dialog. Save Profile was at the bottom of the
// scrolling fields, so a long involvement history hid it and left only Close.
// Save Profile belongs in the dialog footer, to the right of Close, outside
// the region that scrolls. Close stays the way to leave. The header close
// icon only closes. Nothing about what a save writes is asserted here, and
// neither are colors or pixel positions.

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

// The whole element, nested tags of the same name included, so a footer
// sitting inside the scroller is still inside it.
function elementFrom(html, start) {
    const open = html.slice(start).match(/^<(\w+)\b/);
    assert.ok(open, 'not a tag at ' + start);
    const name = open[1];
    const re = new RegExp(`</?${name}\\b[^>]*>`, 'g');
    re.lastIndex = start;
    let depth = 0;
    let match;
    while ((match = re.exec(html))) {
        const tok = match[0];
        if (tok.startsWith('</')) {
            depth -= 1;
            if (depth === 0) return html.slice(start, match.index + tok.length);
        } else if (!tok.endsWith('/>')) {
            depth += 1;
        }
    }
    assert.fail('unclosed <' + name + '>');
}

function scrollingBody(dialog) {
    const classAt = dialog.indexOf('class="flex-grow overflow-y-auto');
    assert.notEqual(classAt, -1, 'the person dialog has no scrolling body');
    const tagAt = dialog.lastIndexOf('<div', classAt);
    assert.notEqual(tagAt, -1, 'the scrolling body has no opening tag');
    return { html: elementFrom(dialog, tagAt), end: tagAt + elementFrom(dialog, tagAt).length };
}

function footerOf(fragment) {
    const start = fragment.lastIndexOf('<footer');
    assert.notEqual(start, -1, 'no footer');
    return elementFrom(fragment, start);
}

function buttons(fragment) {
    return [...fragment.matchAll(/<button\b[\s\S]*?<\/button>/g)].map((m) => m[0]);
}

test('Save Profile sits in the person dialog footer, outside the scrolling body', () => {
    const dialog = personDialog();
    const scrolled = scrollingBody(dialog);
    const foot = footerOf(dialog);
    const footAt = dialog.lastIndexOf('<footer');

    assert.ok(
        footAt >= scrolled.end,
        'the footer is inside the scrolling body, so Save Profile scrolls away'
    );
    assert.equal(
        (scrolled.html.match(/Save Profile/g) || []).length,
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
    assert.match(footButtons[1], /@click="updatePerson"/);
    assert.match(footButtons[1], /:disabled="isSubmitting"/);
    assert.match(footButtons[1], /x-show="!isSubmitting"/);
    assert.match(footButtons[1], /x-show="isSubmitting"/);
});

test('Close and the header icon leave the person dialog without saving the Person', () => {
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
    const body = scrollingBody(personDialog()).html;
    assert.match(body, /@change="setMembershipStageByIndex\(\$event\.target\.value\)"/);
    assert.match(body, /@click="toggleMembershipInactive\(\)"/);
    assert.match(body, /@click="addTag\(selectedPerson, tag\)/);
    assert.match(body, /@click="removeTag\(selectedPerson, tag\)"/);
    assert.match(body, /@click="setSpouse\(c\.id\)"/);
    assert.match(body, /@click="addChild\(c\.id\)"/);
    assert.doesNotMatch(body, /@click="updatePerson"/);
});
