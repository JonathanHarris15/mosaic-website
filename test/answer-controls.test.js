const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Confirm and Decline must be indistinguishable from one another (MS-20, MS-205).
//
// ⚠ THIS IS THE ONE DESIGN PROPERTY MOST LIKELY TO ERODE, and it erodes for the
// nicest possible reason: somebody makes the primary action look primary. A
// filled Confirm beside an outlined Decline is what every other screen in every
// other app does, so it will look like an improvement.
//
// It is not. A screen that makes yes prettier than no collects agreements
// people cannot keep — and a yes somebody cannot keep costs the rota more than
// a no given in August, because it is discovered on the Sunday.
//
// So: same classes, both of them, everywhere they appear. Not "similar".

const PUBLIC = path.join(__dirname, '..', 'public');

const read = f => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const squash = s => s.replace(/\s+/g, ' ').trim();

// The class attribute of the <button> whose click handler matches.
function classesOf(html, handler) {
    const buttons = html.match(/<button[\s\S]*?>/g) || [];
    const hit = buttons.find(b => b.includes(handler));
    assert.ok(hit, 'no button found with handler ' + handler);
    const m = hit.match(/\sclass="([^"]*)"/);
    assert.ok(m, 'button has no class: ' + handler);
    return squash(m[1]);
}

test('the Commitments page confirm and decline are styled identically', () => {
    const html = read('commitments.html');
    assert.strictEqual(
        classesOf(html, 'confirm(row)'),
        classesOf(html, 'decline(row)'),
        'one of them has been made to look more inviting than the other'
    );
});

test('the Calendar card controls are styled identically, on both cards', () => {
    const html = read('calendar.html');

    // Two cards — the navy phone one and the desktop rail — so four buttons.
    const buttons = (html.match(/<button[\s\S]*?>/g) || [])
        .filter(b => b.includes('answerCommitment'));
    assert.strictEqual(buttons.length, 4,
        'expected a confirm and a decline on each of the two cards');

    const classOf = b => squash((b.match(/\sclass="([^"]*)"/) || [, ''])[1]);
    const confirms = buttons.filter(b => b.includes("'confirmed'")).map(classOf);
    const declines = buttons.filter(b => b.includes("'declined'")).map(classOf);

    assert.strictEqual(confirms.length, 2);
    assert.strictEqual(declines.length, 2);
    // Pairwise, in card order: each card's two match each other.
    assert.strictEqual(confirms[0], declines[0]);
    assert.strictEqual(confirms[1], declines[1]);
});

test('neither control is filled — a filled one reads as the recommended answer', () => {
    [read('commitments.html'), read('calendar.html')].forEach(html => {
        (html.match(/<button[\s\S]*?>/g) || [])
            .filter(b => b.includes('answerCommitment') ||
                b.includes('confirm(row)') || b.includes('decline(row)'))
            .forEach(b => {
                assert.doesNotMatch(b, /class="[^"]*\bbg-primary\b/,
                    'a filled control is the recommendation this screen must not make');
                assert.doesNotMatch(b, /class="[^"]*\bbg-success\b/);
            });
    });
});

// Answering writes the roster row and the occurrence's derived fields together,
// and the occurrence is editor-only to write — so it cannot be a browser write,
// and the page needs the callable SDK loaded to make it.
test('every page that answers loads the functions SDK', () => {
    ['commitments.html', 'calendar.html'].forEach(page => {
        const html = read(page);
        assert.match(html, /firebase-functions-compat\.js/,
            page + ' calls answerAssignment but never loads the callable SDK');
    });
});
