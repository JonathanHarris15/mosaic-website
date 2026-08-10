const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The swap screens' load-bearing properties (MS-190, MS-214, MS-215, MS-216).
//
// Shape checks, in the way test/answer-controls.test.js pins the answer
// buttons. These are the decisions most likely to be tidied away by somebody
// making the page more consistent, and each of them costs a real thing.

const PUBLIC = path.join(__dirname, '..', 'public');
const read = f => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

const page = read('commitments.html');
const script = read('commitments.js');

// ── Never a raw slug, never a raw date ──────────────────────────────────────

test('an offered place shows the Role’s name, not its slug', () => {
    // ⚠ This project has already shipped `setup_teardown` onto a member's
    // screen once. An offered place carries only ids, so every one of them has
    // to go through roleNameFor.
    assert.doesNotMatch(page, /x-text="put\.roleSlug"/,
        'a raw slug is on screen again');
    assert.match(page, /roleNameFor\(put\.roleSlug\)/);
});

test('every date beside prose is a readable one', () => {
    assert.doesNotMatch(page, /x-text="put\.date"/);
    assert.doesNotMatch(page, /x-text="swap\.date"/,
        'YYYY-MM-DD beside a sentence is the same failure as a slug');
    assert.match(script, /longDateOf\(date\)/);
});

// ── Taking it outright is its own act ───────────────────────────────────────

test('"Just take it" is a button, not an empty selection', () => {
    // ⚠ It SETTLES THERE AND THEN — no waiting, no acceptance. Hiding an
    // instant, irreversible act behind "submit with nothing ticked" is a trap,
    // and the tidy-minded fix (one button, empty means take) would set it.
    assert.match(page, /Just take it/);
    assert.match(page, /sendOffer\(replying, true\)/);
    assert.match(page, /sendOffer\(replying, false\)/);

    // And the offer button is disabled with nothing picked, so the two paths
    // cannot be confused for one another.
    assert.match(page, /:disabled="busy \|\| !picked\.length"/);
});

// ── The picker ──────────────────────────────────────────────────────────────

test('somebody with no account is offered, and the sender warned', () => {
    // Excluding them would have to be unpicked when MS-189 lands and can text
    // exactly those people. Withdraw is what makes an unanswerable ask safe.
    assert.match(page, /unreachable\(person\)/);
    assert.match(page, /cannot answer in the app/i);
    assert.match(script, /unreachable\(person\) \{ return !person \|\| !person\.userId; \}/);
});

test('the picker asks RolesCore who may appear rather than filtering itself',
    () => {
        // ⚠ ADR-0021 §1: somebody a tag hides must be ABSENT, not greyed. A
        // second copy of that rule here would drift from the one in roles-core,
        // and the drift would print a name somewhere it must not appear.
        const view = read('trades-view.js');
        assert.match(view, /Roles\.assignablePeople\(/);
        assert.doesNotMatch(view, /shepherdingHidden/,
            'the hiding rule has been copied instead of asked for');
    });

// ── The choice when declining ───────────────────────────────────────────────

test('declining asks who should know, and neither answer is the recommended one',
    () => {
        assert.match(page, /Who should know\?/);
        assert.match(page, /declineWith\(declining, false\)/);
        assert.match(page, /declineWith\(declining, true\)/);

        const buttons = (page.match(/<button[\s\S]*?>/g) || [])
            .filter(b => b.includes('declineWith'));
        assert.equal(buttons.length, 2);
        buttons.forEach(b => assert.doesNotMatch(b, /bg-primary|bg-success/,
            'which one is right depends on the Event, and the app does not know'));
    });

test('no choice is offered where it would do nothing', () => {
    // A participant-rung Event can reach nobody outside it, so both options
    // would mean the same thing. A dialog whose answers do not differ teaches
    // people to stop reading dialogs.
    assert.match(script, /coverable\[row\.occurrenceId\] === false/);
});

// ── The split ───────────────────────────────────────────────────────────────

test('the page splits by whose move it is, not by who started it', () => {
    assert.match(page, /Waiting on you/);
    assert.match(page, /Waiting on them/);
    assert.doesNotMatch(page, /x-for="swap in outbound"/,
        'who opened it is a fact about the past');
});

test('the conversation sits on the Commitment it is about', () => {
    // "Who have I asked about the 14th" is a question about the 14th, and
    // answering it two screens away is how a member's page becomes a control
    // panel.
    assert.match(page, /swapsOn\(row\)/);
    assert.match(page, /Ask somebody/);
});

// ── The notification ────────────────────────────────────────────────────────

test('the notification is one line that cannot break the dashboard', () => {
    const notice = read('swaps-notice.js');

    assert.match(notice, /commitments\.html/, 'it must land where the work is');
    assert.match(notice, /catch \(e\)/,
        'a home screen that fails to paint over a swap count is a poor trade');
    // No read state, no inbox, no bell — MS-187 should be able to delete this
    // file whole. Checked against the CODE, not the prose: the comment at the
    // top of that file says "nothing to dismiss", and a test that reads its own
    // documentation as evidence proves nothing.
    const code = notice.split('\n')
        .filter(l => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(code, /localStorage|dismiss|markRead/i);
});

test('the dashboard loads what the notification reaches for', () => {
    const dash = read('index.html');
    ['trade-core.js', 'trades-store.js', 'trades-view.js', 'swaps-notice.js']
        .forEach(f => assert.match(dash, new RegExp(f.replace('.', '\\.')),
            'a missing script renders nothing, not an error'));
});
