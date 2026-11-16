/**
 * The Trade invitation text core (MS-249, MS-524): whether to text somebody
 * with no account who was asked to take a place, what they see when they
 * open the link, and the wording. Plain data in; no Firebase, no clock.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const inv = require('../functions/trade-invitation-text.js');

const TODAY = '2026-09-15';

/**
 * @param {Object<string, *>} [over]
 * @return {*}
 */
function trade(over) {
    return Object.assign({
        id: 't1',
        origin: 'invitation',
        state: 'invited',
        holderId: 'holder',
        counterpartyId: 'invitee',
        assignment: {occurrenceId: 'sunday_service_2026-09-20', roleSlug: 'sound',
            slotId: 's1', date: '2026-09-20'},
        eventName: 'Sunday Service',
        roleName: 'Sound',
        closedBy: null,
        closedBecause: null,
    }, over || {});
}

/**
 * @param {Object<string, *>} [over]
 * @return {*}
 */
function decide(over) {
    return inv.textDecision(Object.assign({
        trade: trade(),
        inviteeHasLinkedUser: false,
        inviteeHasPhone: true,
        localHour: 10,
        today: TODAY,
    }, over || {}));
}

// ── Whether to text ─────────────────────────────────────────────────────────

test('an unlinked invitee with a phone, inside 8am–8pm, is texted now', () => {
    assert.equal(decide(), 'send');
});

test('an invitee with an account is not texted: they answer on Commitments', () => {
    assert.equal(decide({inviteeHasLinkedUser: true}), 'none');
});

test('an unlinked invitee with no phone cannot be texted', () => {
    assert.equal(decide({inviteeHasPhone: false}), 'unreachable');
});

test('outside 8am–8pm the text is held for the morning', () => {
    assert.equal(decide({localHour: 7}), 'held');
    assert.equal(decide({localHour: 20}), 'held');
    assert.equal(decide({localHour: 8}), 'send');
    assert.equal(decide({localHour: 19}), 'send');
});

test('a Trade no longer waiting on the invitee is not texted', () => {
    assert.equal(decide({trade: trade({state: 'withdrawn'})}), 'none');
    assert.equal(decide({trade: trade({state: 'settled'})}), 'none');
    assert.equal(decide({trade: trade({state: 'refused'})}), 'none');
    assert.equal(decide({trade: trade({state: 'offered'})}), 'none');
    assert.equal(decide({trade: trade({counterpartyId: 'somebody-else'}),
        inviteeId: 'invitee'}), 'none');
});

test('a Trade whose date has passed is not texted', () => {
    const past = trade({assignment: Object.assign({}, trade().assignment, {date: '2026-09-14'})});
    assert.equal(decide({trade: past}), 'none');
});

test('an uninvited offer is never texted: only an invitation asks somebody', () => {
    assert.equal(decide({trade: trade({origin: 'offer', state: 'offered'})}), 'none');
});

test('the link expires with the Assignment’s date', () => {
    assert.equal(inv.linkEndDate(trade()), '2026-09-20');
});

// ── What the invitee sees ───────────────────────────────────────────────────

const VIEW_KEYS = ['status', 'inviterFirstName', 'eventName', 'roleName', 'dateLabel', 'canAnswer'];

/**
 * @param {*} t
 * @param {string} [today]
 * @return {*}
 */
function view(t, today) {
    return inv.inviteeView(t, {
        inviteeId: 'invitee',
        inviterFirstName: 'Bob',
        today: today || TODAY,
    });
}

test('waiting on you: first name, Event, Role and date, and both answers', () => {
    const v = view(trade());
    assert.deepEqual(Object.keys(v).sort(), VIEW_KEYS.slice().sort());
    assert.equal(v.status, 'waiting');
    assert.equal(v.inviterFirstName, 'Bob');
    assert.equal(v.eventName, 'Sunday Service');
    assert.equal(v.roleName, 'Sound');
    assert.equal(v.dateLabel, 'Sunday 20 September');
    assert.deepEqual(v.canAnswer, ['take', 'refuse']);
});

test('you took it: settled while you were the one asked', () => {
    const v = view(trade({state: 'settled', closedBy: 'invitee'}));
    assert.equal(v.status, 'took');
    assert.deepEqual(v.canAnswer, []);
});

test('you said no: refused, and you were who ended it', () => {
    const v = view(trade({state: 'refused', closedBy: 'invitee'}));
    assert.equal(v.status, 'refused');
    assert.deepEqual(v.canAnswer, []);
});

test('ended: withdrawn, sorted out elsewhere, filled by an editor, or the date passed', () => {
    for (const t of [
        trade({state: 'withdrawn', closedBy: 'holder'}),
        trade({state: 'refused', closedBy: null, closedBecause: 'filledByEditor'}),
        trade({state: 'refused', closedBy: null, closedBecause: 'settledElsewhere'}),
        trade({state: 'settled', closedBy: 'holder', counterpartyId: 'somebody-else'}),
    ]) {
        const v = view(t);
        assert.equal(v.status, 'ended', JSON.stringify(t));
        assert.deepEqual(v.canAnswer, []);
    }
    assert.equal(view(trade(), '2026-09-21').status, 'ended');
});

test('the view never carries the roster, a surname, contact details or other invitees', () => {
    const t = trade({
        holderName: 'Bob Smith', holderPhone: '+15550000', partyIds: ['holder', 'invitee'],
        offered: [{occurrenceId: 'x'}], roster: [{personId: 'z'}],
    });
    const v = view(t);
    assert.deepEqual(Object.keys(v).sort(), VIEW_KEYS.slice().sort());
    assert.doesNotMatch(JSON.stringify(v), /Smith|5550000|holder|offered|roster/);
});

test('a Role with no stored name reads by its slug, not as nothing', () => {
    const v = view(trade({roleName: null}));
    assert.equal(v.roleName, 'sound');
});

// ── Wording ─────────────────────────────────────────────────────────────────

const VALUES = {inviter: 'Bob', role: 'Sound', event: 'Sunday Service', date: 'Sunday 20 September'};

test('the default wording names who asked, the Role, the Event, the date and the link', () => {
    const t = inv.templatesForSendPath({});
    assert.equal(t.text.invitation,
        'Hi {name}, {inviter} from Mosaic Church asked if you could take their place: ' +
        '{role} at {event} on {date}. Tap to answer: {link}');
    assert.deepEqual(inv.requestValues(trade(), {inviterFirstName: 'Bob'}), VALUES);
});

test('a saved wording replaces the default; a blank one falls back', () => {
    assert.equal(inv.templatesForSendPath({tradeInvitationText: 'Yo {name}: {role}? {link}'}).text.invitation,
        'Yo {name}: {role}? {link}');
    assert.equal(inv.templatesForSendPath({tradeInvitationText: '   '}).text.invitation,
        inv.templatesForSendPath({}).text.invitation);
});

test('a saved wording with no {link} still sends the link, on its own line', () => {
    assert.equal(inv.templatesForSendPath({tradeInvitationText: 'Can you do {role}?'}).text.invitation,
        'Can you do {role}?\n{link}');
});

test('the send request names a Person, a purpose and the link, and wants no reply', () => {
    const req = inv.notifyRequest(trade(), {
        inviteeId: 'invitee', inviterFirstName: 'Bob', url: 'https://x.test/a/tok',
    });
    assert.equal(req.personId, 'invitee');
    assert.equal(req.purpose, 'trade_invitation');
    assert.equal(req.wording, 'invitation');
    assert.equal(req.url, 'https://x.test/a/tok');
    assert.equal(req.expectReply, false);
    assert.equal(req.values.role, 'Sound');
    assert.equal(req.channel, undefined);
});

test('the text status written on the Trade is one of four, from what the send path said', () => {
    assert.equal(inv.statusFromSend({accepted: true, channel: 'text'}), 'sent');
    assert.equal(inv.statusFromSend({skipped: 'window'}), 'held');
    assert.equal(inv.statusFromSend({accepted: false, unreachable: true}), 'unreachable');
    assert.equal(inv.statusFromSend({accepted: false, channel: 'text'}), 'failed');
    assert.equal(inv.statusFromSend(null), 'failed');
});
