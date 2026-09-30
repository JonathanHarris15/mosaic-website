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

test('automatic: a device token and no phone → initial', () => {
    assert.strictEqual(pr.prayerRequestAction({
        ...baseAuto, hasPhone: false, hasDeviceToken: true,
    }), 'initial');
});

test('automatic: no phone and no token → none', () => {
    assert.strictEqual(pr.prayerRequestAction({
        ...baseAuto, hasPhone: false, hasDeviceToken: false,
    }), 'none');
});

test('manual: a device token and no phone → initial', () => {
    assert.strictEqual(pr.manualPrayerRequestKind({
        ...baseManual, hasPhone: false, hasDeviceToken: true,
    }), 'initial');
});

test('reminder escalates; the first ask does not', () => {
    assert.deepStrictEqual(pr.prayerNotifyRequest('initial'), {
        purpose: 'prayer_request', wording: 'initial', escalate: false,
    });
    assert.deepStrictEqual(pr.prayerNotifyRequest('reminder'), {
        purpose: 'prayer_request', wording: 'reminder', escalate: true,
    });
    assert.strictEqual(pr.prayerNotifyRequest('none'), null);
});

test('prayerAskUrl keeps a passed link and mints nothing', () => {
    assert.strictEqual(
        pr.prayerAskUrl(' https://example.com/a/tok '),
        'https://example.com/a/tok');
    assert.strictEqual(pr.prayerAskUrl(''), null);
    assert.strictEqual(pr.prayerAskUrl(null), null);
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

// ── MS-511: may this person answer on the page? ────────────────────────────

const SERVICE = '2026-06-28';
const TODAY_IN_WINDOW = '2026-06-23';
const liturgyFor = (maleId, femaleId) => ({
    prayerMale: { id: maleId || null, name: '' },
    prayerFemale: { id: femaleId || null, name: '' },
});

const baseMayAnswer = {
    personId: 'p-jane',
    serviceDate: SERVICE,
    todayDate: TODAY_IN_WINDOW,
    liturgy: liturgyFor('p-jane', 'p-john'),
    viaAnswerLink: false,
    initialSentDate: null,
};

test('mayAnswer: still a subject, in the window → yes', () => {
    assert.strictEqual(pr.mayAnswerPrayerRequest({
        ...baseMayAnswer,
        viaAnswerLink: true,
    }), true);
});

test('mayAnswer: no longer on the service → no', () => {
    assert.strictEqual(pr.mayAnswerPrayerRequest({
        ...baseMayAnswer,
        liturgy: liturgyFor('p-other', 'p-john'),
        viaAnswerLink: true,
    }), false);
});

test('mayAnswer: after the service date church-local → no', () => {
    assert.strictEqual(pr.mayAnswerPrayerRequest({
        ...baseMayAnswer,
        todayDate: '2026-06-29',
        viaAnswerLink: true,
    }), false);
});

test('mayAnswer: on the service date itself → still yes', () => {
    assert.strictEqual(pr.mayAnswerPrayerRequest({
        ...baseMayAnswer,
        todayDate: SERVICE,
        viaAnswerLink: true,
    }), true);
});

test('mayAnswer: signed-in before five days and no text yet → no', () => {
    assert.strictEqual(pr.mayAnswerPrayerRequest({
        ...baseMayAnswer,
        todayDate: '2026-06-22',
        viaAnswerLink: false,
    }), false);
});

test('mayAnswer: signed-in within five days → yes', () => {
    assert.strictEqual(pr.mayAnswerPrayerRequest({
        ...baseMayAnswer,
        viaAnswerLink: false,
        todayDate: '2026-06-24',
    }), true);
});

test('mayAnswer: signed-in early once a text has gone → yes', () => {
    assert.strictEqual(pr.mayAnswerPrayerRequest({
        ...baseMayAnswer,
        viaAnswerLink: false,
        todayDate: '2026-06-20',
        initialSentDate: '2026-06-20',
    }), true);
});

// ── MS-511: what the answer page shows ───────────────────────────────────────

const PRIVACY = pr.PRAYER_ANSWER_PRIVACY_LINE;

test('page view: empty request offers the box and the privacy line', () => {
    const view = pr.prayerAnswerPageView({
        firstName: 'Jane Doe',
        serviceDate: SERVICE,
        prayerRequest: null,
    });
    assert.strictEqual(view.firstName, 'Jane');
    assert.strictEqual(view.serviceDateLabel, 'Sunday, June 28, 2026');
    assert.strictEqual(view.privacyLine, PRIVACY);
    assert.strictEqual(view.showAnswerBox, true);
    assert.strictEqual(view.existingAnswer, null);
    assert.strictEqual(view.eldersAlreadyHaveIt, false);
});

test('page view: a texted reply shows the subject their own words', () => {
    const view = pr.prayerAnswerPageView({
        firstName: 'Jane',
        serviceDate: SERVICE,
        prayerRequest: {
            prayerRequest: 'Please pray for my mother.',
            prayerRequestSource: 'reply',
        },
    });
    assert.strictEqual(view.existingAnswer, 'Please pray for my mother.');
    assert.strictEqual(view.showAnswerBox, true);
});

test('page view: a form answer is shown the same way as a reply', () => {
    const view = pr.prayerAnswerPageView({
        firstName: 'Jane',
        serviceDate: SERVICE,
        prayerRequest: {
            prayerRequest: 'Safe travels.',
            prayerRequestSource: 'form',
        },
    });
    assert.strictEqual(view.existingAnswer, 'Safe travels.');
    assert.strictEqual(view.showAnswerBox, true);
});

test('page view: elder-typed never returns the elder words', () => {
    const view = pr.prayerAnswerPageView({
        firstName: 'Jane',
        serviceDate: SERVICE,
        prayerRequest: {
            prayerRequest: 'Confidential elder wording.',
            prayerRequestSource: 'elder',
        },
    });
    assert.strictEqual(view.eldersAlreadyHaveIt, true);
    assert.strictEqual(view.showAnswerBox, false);
    assert.strictEqual(view.existingAnswer, null);
    const json = JSON.stringify(view);
    assert.ok(!json.includes('Confidential'));
    assert.ok(!json.includes('elder wording'));
});

// ── MS-511: note decision on save ────────────────────────────────────────────

test('note decision: first save generates one note', () => {
    assert.deepStrictEqual(pr.prayerRequestNoteDecision({
        hadRequestBefore: false,
        noteId: null,
        noteText: null,
        noteGeneratedText: null,
    }), { action: 'create' });
});

test('note decision: later change updates an untouched generated note', () => {
    assert.deepStrictEqual(pr.prayerRequestNoteDecision({
        hadRequestBefore: true,
        noteId: 'note-1',
        noteText: 'Original generated text.',
        noteGeneratedText: 'Original generated text.',
    }), { action: 'update' });
});

test('note decision: elder-edited note is left alone', () => {
    assert.deepStrictEqual(pr.prayerRequestNoteDecision({
        hadRequestBefore: true,
        noteId: 'note-1',
        noteText: 'An elder reworded this.',
        noteGeneratedText: 'Original generated text.',
    }), { action: 'leave' });
});

test('note decision: deleted note is not recreated', () => {
    assert.deepStrictEqual(pr.prayerRequestNoteDecision({
        hadRequestBefore: true,
        noteId: 'note-1',
        noteText: null,
        noteGeneratedText: 'Original generated text.',
    }), { action: 'leave' });
});

// ── MS-511: elder digest accepts form ────────────────────────────────────────

test('digest: a form answer completes the pair → send', () => {
    assert.strictEqual(pr.elderDigestDecision({
        subjectStates: allFilled, changedSource: 'form', wasCompleteBefore: false,
    }), true);
});

// ── MS-511: {link} in prayer texts ───────────────────────────────────────────

test('DEFAULT_PRAYER_MESSAGES initial and reminder carry {link}', () => {
    assert.ok(pr.DEFAULT_PRAYER_MESSAGES.initial.includes('{link}'));
    assert.ok(pr.DEFAULT_PRAYER_MESSAGES.reminder.includes('{link}'));
});

test('renderPrayerRequestMessage substitutes {link} when sending', () => {
    const url = 'https://mosaic-hymn-database.web.app/a/tok';
    const msg = pr.renderPrayerRequestMessage('initial', 'Jane', {
        initial: 'Hi {name}. Answer: {link}',
    }, url);
    assert.strictEqual(msg, 'Hi Jane. Answer: ' + url);
});

test('templatesWithAnswerLink adds a {link} slot when a saved template omitted it', () => {
    const withSlot = pr.templatesWithAnswerLink({
        initial: 'Custom {name} only.',
        reminder: 'Ready {name}: {link}',
        thankyou: 'Thanks {name}.',
    });
    assert.strictEqual(withSlot.initial, 'Custom {name} only.\n{link}');
    assert.strictEqual(withSlot.reminder, 'Ready {name}: {link}');
    assert.strictEqual(withSlot.thankyou, 'Thanks {name}.');
});

test('ensureAnswerLinkInTemplate appends the link when {link} is missing', () => {
    const url = 'https://mosaic-hymn-database.web.app/a/tok';
    const withSlot = pr.ensureAnswerLinkInTemplate('Hi {name}, reply here: {link}', url);
    assert.ok(withSlot.includes('{link}'));
    const appended = pr.ensureAnswerLinkInTemplate('Custom wording only.', url);
    assert.strictEqual(appended, 'Custom wording only.\n' + url);
    const rendered = pr.renderPrayerRequestMessage('initial', 'Sam', {
        initial: appended,
    }, url);
    assert.ok(rendered.endsWith(url));
    assert.ok(!rendered.includes('{link}'));
});
