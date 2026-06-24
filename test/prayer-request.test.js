const { test } = require('node:test');
const assert = require('node:assert');

const pr = require('../functions/prayer-request.js');

// prayer-request.js is the pure pastoral-prayer domain module: it decides when a
// pastoral-prayer subject should be texted (automatically or manually), renders
// the admin-editable message templates, and shapes the Shepherding Note a reply
// becomes. No Firebase/Textbelt here — the orchestrator in index.js supplies the
// loaded config and performs I/O. These tests pin the interface grilled in
// Phase 1.

// ── Message rendering (config-driven) ──────────────────────────────────────
// The templates are admin-editable (app_config/prayer_request_sms) with a {name}
// placeholder; render substitutes the subject's first name and falls back to
// "there" when it is unknown, and to the built-in defaults when a template is
// blank/missing.

test('renderPrayerRequestMessage substitutes {name} with the first name', () => {
    const msg = pr.renderPrayerRequestMessage('initial', 'Jane', {
        initial: 'Hi {name}, pray request?',
    });
    assert.strictEqual(msg, 'Hi Jane, pray request?');
});

test('renderPrayerRequestMessage falls back to "there" for an empty name', () => {
    const msg = pr.renderPrayerRequestMessage('initial', '', {
        initial: 'Hi {name}.',
    });
    assert.strictEqual(msg, 'Hi there.');
});

test('renderPrayerRequestMessage replaces every {name} occurrence', () => {
    const msg = pr.renderPrayerRequestMessage('thankyou', 'Sam', {
        thankyou: '{name}, thanks {name}.',
    });
    assert.strictEqual(msg, 'Sam, thanks Sam.');
});

test('renderPrayerRequestMessage uses built-in default when template absent', () => {
    const fromDefault = pr.renderPrayerRequestMessage('initial', 'Jane', {});
    assert.ok(fromDefault.includes('Jane'));
    assert.ok(!fromDefault.includes('{name}'));
    // Matches the canonical default for that kind.
    const direct = pr.renderPrayerRequestMessage(
        'initial', 'Jane', pr.DEFAULT_PRAYER_MESSAGES);
    assert.strictEqual(fromDefault, direct);
});

test('renderPrayerRequestMessage with no templates arg uses defaults', () => {
    const msg = pr.renderPrayerRequestMessage('reminder', 'Jane');
    assert.ok(msg.includes('Jane'));
    assert.ok(!msg.includes('{name}'));
});

test('DEFAULT_PRAYER_MESSAGES carries all three kinds with a {name} slot', () => {
    for (const kind of ['initial', 'reminder', 'thankyou']) {
        assert.ok(pr.DEFAULT_PRAYER_MESSAGES[kind].includes('{name}'), kind);
    }
});

// resolveTemplates merges saved config over the defaults per field, treating a
// blank/missing field as "use the default" so a half-filled config doc still
// renders complete messages.
test('resolveTemplates fills missing/blank fields from defaults', () => {
    const resolved = pr.resolveTemplates({ initial: 'Custom {name}', reminder: '   ' });
    assert.strictEqual(resolved.initial, 'Custom {name}');
    assert.strictEqual(resolved.reminder, pr.DEFAULT_PRAYER_MESSAGES.reminder);
    assert.strictEqual(resolved.thankyou, pr.DEFAULT_PRAYER_MESSAGES.thankyou);
});

test('resolveTemplates with null/undefined config returns the defaults', () => {
    assert.deepStrictEqual(pr.resolveTemplates(null), pr.DEFAULT_PRAYER_MESSAGES);
    assert.deepStrictEqual(pr.resolveTemplates(undefined), pr.DEFAULT_PRAYER_MESSAGES);
});

// ── firstNameOf ────────────────────────────────────────────────────────────
test('firstNameOf returns the first whitespace-delimited token', () => {
    assert.strictEqual(pr.firstNameOf('Jane Doe'), 'Jane');
    assert.strictEqual(pr.firstNameOf('  Sam  '), 'Sam');
    assert.strictEqual(pr.firstNameOf(''), '');
    assert.strictEqual(pr.firstNameOf(null), '');
});

// ── daysUntil ──────────────────────────────────────────────────────────────
test('daysUntil counts whole days, negative once the service has passed', () => {
    assert.strictEqual(pr.daysUntil('2026-06-28', '2026-06-23'), 5);
    assert.strictEqual(pr.daysUntil('2026-06-28', '2026-06-28'), 0);
    assert.strictEqual(pr.daysUntil('2026-06-28', '2026-06-30'), -2);
});

// ── Automatic decision (scheduler) ─────────────────────────────────────────
// prayerRequestAction is the hourly scheduler's per-subject decision: initial
// within 5 days, reminder at the 3-day mark (never the same church-local day the
// initial went out), gated by phone, unfilled request, the 8am–8pm window, and
// only for upcoming services.

const baseAuto = {
    daysUntilService: 5,
    localHour: 10,
    hasPhone: true,
    requestFilled: false,
    initialSentDate: null,
    reminderSent: false,
    today: '2026-06-23',
};

test('automatic: no phone → none', () => {
    assert.strictEqual(pr.prayerRequestAction({ ...baseAuto, hasPhone: false }), 'none');
});

test('automatic: already filled → none', () => {
    assert.strictEqual(pr.prayerRequestAction({ ...baseAuto, requestFilled: true }), 'none');
});

test('automatic: service already passed → none', () => {
    assert.strictEqual(pr.prayerRequestAction({ ...baseAuto, daysUntilService: -1 }), 'none');
});

test('automatic: outside the 8am–8pm window → none', () => {
    assert.strictEqual(pr.prayerRequestAction({ ...baseAuto, localHour: 7 }), 'none');
    assert.strictEqual(pr.prayerRequestAction({ ...baseAuto, localHour: 20 }), 'none');
});

test('automatic: not yet sent, within 5 days → initial', () => {
    assert.strictEqual(pr.prayerRequestAction({ ...baseAuto, daysUntilService: 5 }), 'initial');
});

test('automatic: not yet sent, more than 5 days out → none', () => {
    assert.strictEqual(pr.prayerRequestAction({ ...baseAuto, daysUntilService: 6 }), 'none');
});

test('automatic: initial sent earlier day, within 3 days → reminder', () => {
    assert.strictEqual(pr.prayerRequestAction({
        ...baseAuto, daysUntilService: 3, initialSentDate: '2026-06-20',
    }), 'reminder');
});

test('automatic: initial sent today → no same-day reminder', () => {
    assert.strictEqual(pr.prayerRequestAction({
        ...baseAuto, daysUntilService: 3, initialSentDate: '2026-06-23',
    }), 'none');
});

test('automatic: reminder already sent → none', () => {
    assert.strictEqual(pr.prayerRequestAction({
        ...baseAuto, daysUntilService: 2, initialSentDate: '2026-06-20', reminderSent: true,
    }), 'none');
});

// ── Manual decision (Send now button) ──────────────────────────────────────
// manualPrayerRequestKind bypasses the timing/quiet-hours guards (a human is
// choosing to send now) but keeps the hard guards: refuse with no phone or an
// already-filled request. Initial if none sent, reminder once it has, and a
// repeat click re-sends the reminder.

const baseManual = {
    hasPhone: true,
    requestFilled: false,
    initialSentDate: null,
    reminderSent: false,
};

test('manual: no phone → none (refuse)', () => {
    assert.strictEqual(pr.manualPrayerRequestKind({ ...baseManual, hasPhone: false }), 'none');
});

test('manual: already filled → none (refuse)', () => {
    assert.strictEqual(pr.manualPrayerRequestKind({ ...baseManual, requestFilled: true }), 'none');
});

test('manual: nothing sent yet → initial, ignoring timing', () => {
    assert.strictEqual(pr.manualPrayerRequestKind({ ...baseManual }), 'initial');
});

test('manual: initial already sent → reminder', () => {
    assert.strictEqual(pr.manualPrayerRequestKind({
        ...baseManual, initialSentDate: '2026-06-20',
    }), 'reminder');
});

test('manual: reminder already sent → reminder again (repeat nudge)', () => {
    assert.strictEqual(pr.manualPrayerRequestKind({
        ...baseManual, initialSentDate: '2026-06-20', reminderSent: true,
    }), 'reminder');
});

// ── Note shaping ───────────────────────────────────────────────────────────
test('buildPrayerRequestNote shapes a "Prayer Request" Shepherding Note', () => {
    const note = pr.buildPrayerRequestNote({
        personName: 'Jane Doe',
        serviceDate: '2026-06-28',
        requestText: '  Please pray for my mother.  ',
    });
    assert.strictEqual(note.type, 'Prayer Request');
    assert.ok(note.subject.includes('2026-06-28'));
    assert.strictEqual(note.content, 'Please pray for my mother.');
    // contentJson is a TipTap doc wrapping the text.
    assert.strictEqual(note.contentJson.type, 'doc');
    assert.strictEqual(
        note.contentJson.content[0].content[0].text, 'Please pray for my mother.');
});

// ── Elder digest decision ──────────────────────────────────────────────────
// The digest fires the moment all designated subjects are filled AND the fill
// that completed the set came by text reply. It never fires when the completing
// fill was manual (an elder in the system already sees it), nor on edits to an
// already-complete set.

const allFilled = [{ filled: true }, { filled: true }];

test('digest: text reply completes the pair → send', () => {
    assert.strictEqual(pr.elderDigestDecision({
        subjectStates: allFilled, changedSource: 'reply', wasCompleteBefore: false,
    }), true);
});

test('digest: manual fill completes the pair → no send', () => {
    assert.strictEqual(pr.elderDigestDecision({
        subjectStates: allFilled, changedSource: 'elder', wasCompleteBefore: false,
    }), false);
});

test('digest: pair already complete before this write → no send (edit)', () => {
    assert.strictEqual(pr.elderDigestDecision({
        subjectStates: allFilled, changedSource: 'reply', wasCompleteBefore: true,
    }), false);
});

test('digest: not all subjects filled yet → no send', () => {
    assert.strictEqual(pr.elderDigestDecision({
        subjectStates: [{ filled: true }, { filled: false }],
        changedSource: 'reply', wasCompleteBefore: false,
    }), false);
});

test('digest: a single-subject service fires when that one is texted', () => {
    assert.strictEqual(pr.elderDigestDecision({
        subjectStates: [{ filled: true }], changedSource: 'reply', wasCompleteBefore: false,
    }), true);
});

test('digest: no designated subjects → never', () => {
    assert.strictEqual(pr.elderDigestDecision({
        subjectStates: [], changedSource: 'reply', wasCompleteBefore: false,
    }), false);
});

// ── Elder digest rendering ─────────────────────────────────────────────────
test('formatServiceDate renders a friendly Sunday date', () => {
    assert.strictEqual(pr.formatServiceDate('2026-06-28'), 'Sunday, June 28, 2026');
});

test('renderElderDigest substitutes {date} and builds {requests} lines', () => {
    const msg = pr.renderElderDigest('Prayer requests for {date}:\n{requests}', {
        serviceDate: '2026-06-28',
        subjects: [
            { name: 'Jane Doe', request: 'Pray for my mom.' },
            { name: 'John Smith', request: 'Safe travels.' },
        ],
    });
    assert.strictEqual(msg,
        'Prayer requests for Sunday, June 28, 2026:\n' +
        'Jane Doe — Pray for my mom.\n' +
        'John Smith — Safe travels.');
});

test('renderElderDigest falls back to the default template', () => {
    const msg = pr.renderElderDigest(undefined, {
        serviceDate: '2026-06-28',
        subjects: [{ name: 'Jane Doe', request: 'Pray for my mom.' }],
    });
    assert.ok(msg.includes('Sunday, June 28, 2026'));
    assert.ok(msg.includes('Jane Doe — Pray for my mom.'));
    assert.ok(!msg.includes('{date}') && !msg.includes('{requests}'));
});

test('DEFAULT_PRAYER_MESSAGES.elderDigest carries {date} and {requests}', () => {
    assert.ok(pr.DEFAULT_PRAYER_MESSAGES.elderDigest.includes('{date}'));
    assert.ok(pr.DEFAULT_PRAYER_MESSAGES.elderDigest.includes('{requests}'));
});

test('resolveTemplates includes elderDigest (default and override)', () => {
    assert.strictEqual(
        pr.resolveTemplates({}).elderDigest, pr.DEFAULT_PRAYER_MESSAGES.elderDigest);
    assert.strictEqual(
        pr.resolveTemplates({ elderDigest: 'Custom {date} {requests}' }).elderDigest,
        'Custom {date} {requests}');
});
