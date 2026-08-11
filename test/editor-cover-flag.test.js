const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const Core = require('../public/events-occurrence-core.js');
const View = require('../public/calendar-view.js');

// Out for cover, or going nowhere? (MS-20, MS-207)
//
// A declined place used to be one thing to an editor: red, "needs sorting".
// Since MS-20 it can be two, and they want opposite things:
//
//   · out for cover  — the whole church has been asked, and it may well fill
//                      itself. Nothing is required of the editor today.
//   · going nowhere  — the Event's rung means nobody can be asked. This is
//                      theirs to fill, and it will not move on its own.
//
// ⚠ RED HAS TO KEEP MEANING SOMETHING. If both flag red, then four of every
// five red marks turn out to be nothing, and the one that is genuinely stuck
// reads exactly like the four that are not. So red narrows to `needsEditor`,
// and out for cover says what it is in a quiet voice.

const declined = { roleSlug: 'ushers', slotId: 's1', personId: 'p1', state: 'declined' };
const confirmed = { roleSlug: 'ushers', slotId: 's2', personId: 'p2', state: 'confirmed' };

const on = (visibility, assignments) => ({
    id: 'occ-1', date: '2026-03-15', visibility, assignments,
});

test('a declined place on an Event that can be covered is not the editor’s ' +
    'job today', () => {
    const o = on('member', [declined, confirmed]);
    assert.equal(Core.needsAttention(o), true);
    assert.equal(Core.outForCover(o), true);
    assert.equal(Core.needsEditor(o), false);
});

test('a declined place nobody can be asked about IS the editor’s job today',
    () => {
        // A `participant`-rung Event never reaches the cover list — there is
        // nobody the list could reach without disclosing what the rung protects.
        const o = on('participant', [declined, confirmed]);
        assert.equal(Core.needsAttention(o), true);
        assert.equal(Core.outForCover(o), false);
        assert.equal(Core.needsEditor(o), true);
    });

test('an unstamped Event falls to the editor rather than going quiet', () => {
    // Fails closed the useful way round: an occurrence nobody can read is one
    // nobody can cover, so it had better still be flagged to the one person who
    // can fix it.
    const o = on(undefined, [declined]);
    assert.equal(Core.needsEditor(o), true);
    assert.equal(Core.outForCover(o), false);
});

test('nothing declined means neither flag, whatever the rung', () => {
    ['public', 'member', 'participant', 'editor', 'elder'].forEach(rung => {
        const o = on(rung, [confirmed]);
        assert.equal(Core.needsAttention(o), false, rung);
        assert.equal(Core.outForCover(o), false, rung);
        assert.equal(Core.needsEditor(o), false, rung);
    });
});

test('the two are exclusive, and together they are needsAttention', () => {
    [
        on('member', [declined]),
        on('participant', [declined]),
        on('elder', [declined]),
        on('member', [confirmed]),
        on(null, [declined]),
    ].forEach(o => {
        assert.ok(!(Core.outForCover(o) && Core.needsEditor(o)),
            'a place cannot be both out for cover and stuck');
        assert.equal(Core.outForCover(o) || Core.needsEditor(o),
            Core.needsAttention(o),
            'a declined place fell through both flags and is now invisible');
    });
});

// ── The month grid ──────────────────────────────────────────────────────────

test('a day whose only trouble is out for cover carries no red glyph', () => {
    const cells = View.monthGrid(
        '2026-03',
        [on('member', [declined])],
        '2026-03-01');
    const day = cells.find(c => c.date === '2026-03-15');

    assert.ok(day, 'the 15th is missing from the grid');
    assert.equal(day.needsAttention, false,
        'the glyph that means "do something" is on a day that asks nothing');
    assert.equal(day.outForCover, true);
});

test('a day nobody can be asked about still carries the red glyph', () => {
    const cells = View.monthGrid(
        '2026-03',
        [on('participant', [declined])],
        '2026-03-01');
    const day = cells.find(c => c.date === '2026-03-15');

    assert.equal(day.needsAttention, true);
    assert.equal(day.outForCover, false);
});

// ── The surfaces ────────────────────────────────────────────────────────────
//
// Shape checks, in the way test/answer-controls.test.js pins the answer
// buttons. What they guard is the tone, which is the whole decision here: the
// moment somebody makes "out for cover" red for consistency, red stops meaning
// anything and this ticket has quietly reversed.

// Normalised to LF. These assertions slice the source between literal
// markers — `</div>\n\`` and the like — and on a Windows checkout, where
// core.autocrlf hands over CRLF, those markers are never found. indexOf
// returns -1, the slice becomes the whole rest of the file, and a test about
// one quiet banner ends up searching every line after it.
const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8')
    .replace(/\r\n/g, '\n');

test('the Roles tab says both things, and only one of them in red', () => {
    const panel = read('roles-panel.js');

    assert.match(panel, /x-show="isEditor && needsEditor"/,
        'the red banner still fires on every decline, covered or not');
    assert.match(panel, /x-show="isEditor && outForCover"/,
        'the Roles tab cannot tell the two apart');
    assert.match(panel, /out for cover/i);

    // The quiet banner is everything between its x-show and the end of its
    // block; it must carry none of the error palette.
    const quiet = panel.slice(panel.indexOf('isEditor && outForCover'));
    const block = quiet.slice(0, quiet.indexOf('</div>\n`'));
    assert.doesNotMatch(block, /\berror\b/,
        'out for cover is the system working and must not read as a fault');
});

test('the Calendar says both things, and only one of them in red', () => {
    const html = read('calendar.html');

    assert.match(html, /x-show="ev\.outForCover"/,
        'the Calendar cannot tell a covered place from a stuck one');
    // Both chips exist; the quiet one carries no error container.
    (html.match(/<span x-show="ev\.outForCover"[\s\S]{0,400}?<\/span>/g) || [])
        .concat(html.match(/<div x-show="ev\.outForCover"[\s\S]{0,400}?<\/div>/g) || [])
        .forEach(chip => {
            assert.doesNotMatch(chip, /error/,
                'the out-for-cover chip has been made to shout');
        });
});
