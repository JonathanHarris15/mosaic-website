/**
 * Texting a Trade invitee with no account (MS-249, MS-525), run through the
 * real invitation rules and the real send path. Only the network and
 * Firestore are faked.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {tellInvitee, sweepHeldInvitations} =
    require('../functions/trade-invitation-send.js');
const {tellPerson} = require('../functions/notification-send.js');
const inv = require('../functions/trade-invitation-text.js');
const {churchDateParts} = require('../functions/notification-core.js');

// 15:00 UTC is 10:00 in Chicago; 03:00 UTC is 22:00 the night before.
const INSIDE = new Date('2026-09-15T15:00:00Z');
const NIGHT = new Date('2026-09-15T03:00:00Z');

/** @param {Object<string, *>} [over] */
function world(over) {
    const o = over || {};
    let now = o.now || INSIDE;
    /** @type {Object<string, *>} */
    const trades = {
        t1: Object.assign({
            id: 't1', origin: 'invitation', state: 'invited',
            holderId: 'holder', counterpartyId: 'invitee',
            assignment: {occurrenceId: 'sunday_service_2026-09-20', roleSlug: 'sound',
                slotId: 's1', date: '2026-09-20'},
            eventName: 'Sunday Service', roleName: 'Sound',
        }, o.trade || {}),
    };
    /** @type {Object<string, *>} */
    const people = Object.assign({
        holder: {uid: 'u-holder', phone: '+15550001', firstName: 'Bob', fullName: 'Bob Stone'},
        invitee: {uid: null, phone: '+15550002', firstName: 'Ann'},
    }, o.people || {});
    /** @type {{text: Array<*>, push: Array<*>, logs: Array<*>, links: Array<*>, status: Array<*>}} */
    const calls = {text: [], push: [], logs: [], links: [], status: []};
    /** @type {*} */
    const notifierDeps = {
        now: () => now,
        loadPerson: async (/** @type {string} */ id) => people[id],
        loadTokens: async () => [],
        loadTemplates: async () => inv.templatesForSendPath({}),
        sendPush: async (/** @type {*} */ m) => { calls.push.push(m); return {accepted: true}; },
        sendText: o.sendText || (async (/** @type {*} */ m) => {
            calls.text.push(m); return {accepted: true, textId: 'tb1'};
        }),
        deleteToken: async () => {},
        writeLog: async (/** @type {*} */ row) => { calls.logs.push(row); },
    };
    /** @type {*} */
    const deps = {
        churchNow: () => churchDateParts(now),
        tellPerson,
        notifierDeps,
        loadTrade: async (/** @type {string} */ id) => trades[id] || null,
        loadPerson: notifierDeps.loadPerson,
        mintLink: async (/** @type {*} */ args) => {
            calls.links.push(args);
            return 'https://x.test/a/TOKEN' + calls.links.length;
        },
        writeStatus: async (/** @type {string} */ id, /** @type {*} */ status) => {
            calls.status.push({id, status});
            trades[id].invitationText = status;
        },
        loadHeldTradeIds: async () => Object.keys(trades).filter((id) =>
            trades[id].invitationText && trades[id].invitationText.status === 'held'),
    };
    return {deps, calls, trades, setNow: (/** @type {Date} */ d) => { now = d; }};
}

test('an in-window invite to somebody with no account texts them one Answer link', async () => {
    const w = world();
    await tellInvitee(w.deps, 't1');
    assert.equal(w.calls.text.length, 1);
    assert.equal(w.calls.text[0].to, '+15550002');
    assert.equal(w.calls.text[0].body,
        'Bob Stone has asked you to trade service roles with them. ' +
        'See the trade here: https://x.test/a/TOKEN1');
    assert.equal(w.calls.text[0].expectReply, false);
    assert.deepEqual(w.calls.links[0], {personId: 'invitee', tradeId: 't1', endDate: '2026-09-20'});
    assert.equal(w.trades.t1.invitationText.status, 'sent');
    assert.equal(w.calls.logs.length, 1);
    assert.equal(w.calls.logs[0].purpose, 'trade_invitation');
});

test('an invitee with an account is not texted and nothing is written', async () => {
    const w = world({people: {invitee: {uid: 'u-inv', phone: '+15550002', firstName: 'Ann'}}});
    await tellInvitee(w.deps, 't1');
    assert.equal(w.calls.text.length + w.calls.push.length, 0);
    assert.equal(w.calls.status.length, 0);
});

test('an invitee with no phone is marked unreachable and not texted', async () => {
    const w = world({people: {invitee: {uid: null, phone: '', firstName: 'Ann'}}});
    await tellInvitee(w.deps, 't1');
    assert.equal(w.calls.text.length, 0);
    assert.equal(w.trades.t1.invitationText.status, 'unreachable');
});

test('an invite at night is held; the sweep sends it once in the morning', async () => {
    const w = world({now: NIGHT});
    await tellInvitee(w.deps, 't1');
    assert.equal(w.calls.text.length, 0);
    assert.equal(w.trades.t1.invitationText.status, 'held');
    assert.equal(w.calls.links.length, 0, 'no link minted for a held text');

    w.setNow(INSIDE);
    await sweepHeldInvitations(w.deps);
    await sweepHeldInvitations(w.deps);
    assert.equal(w.calls.text.length, 1);
    assert.equal(w.trades.t1.invitationText.status, 'sent');
});

test('the sweep skips a held invitation whose Trade has since ended, and stops looking at it', async () => {
    const w = world({now: NIGHT});
    await tellInvitee(w.deps, 't1');
    w.trades.t1.state = 'withdrawn';
    w.setNow(INSIDE);
    await sweepHeldInvitations(w.deps);
    assert.equal(w.calls.text.length, 0);
    assert.equal(w.trades.t1.invitationText, null);
});

test('a Textbelt failure marks the invitation failed and throws nothing', async () => {
    const w = world({sendText: async () => ({accepted: false, error: 'out of credit'})});
    await tellInvitee(w.deps, 't1');
    assert.equal(w.trades.t1.invitationText.status, 'failed');
});

test('a throw anywhere in the send is caught, so the invitation still stands', async () => {
    const w = world();
    w.deps.mintLink = async () => { throw new Error('boom'); };
    await tellInvitee(w.deps, 't1');
    assert.equal(w.trades.t1.invitationText.status, 'failed');
    assert.equal(w.trades.t1.state, 'invited');
});

test('a Trade that has gone is a quiet no-op', async () => {
    const w = world();
    await tellInvitee(w.deps, 'nope');
    assert.equal(w.calls.status.length, 0);
});

test('the status carries the time, and nothing about the token or the phone', async () => {
    const w = world();
    await tellInvitee(w.deps, 't1');
    const s = w.trades.t1.invitationText;
    assert.deepEqual(Object.keys(s).sort(), ['at', 'status']);
    assert.doesNotMatch(JSON.stringify(s), /TOKEN|5550002/);
});

// index.js wiring, read as source.
const fs = require('fs');
const path = require('path');
const index = fs.readFileSync(path.join(__dirname, '../functions/index.js'), 'utf8');

/**
 * @param {string} src
 * @param {string} startMark
 * @param {string} endMark
 * @return {string}
 */
function sliceBetween(src, startMark, endMark) {
    const start = src.indexOf(startMark);
    assert.ok(start !== -1, startMark);
    const end = src.indexOf(endMark, start + startMark.length);
    assert.ok(end !== -1, endMark);
    return src.slice(start, end);
}

test('inviteToTrade texts the invitee after the Trade is written, and a failure there cannot fail it', () => {
    const call = sliceBetween(index, 'exports.inviteToTrade', 'exports.withdrawTrade');
    assert.match(call, /secrets:\s*\[TEXTBELT_KEY\]/);
    assert.match(call, /tellInvitee\(/);
    assert.match(call, /try\s*\{[\s\S]*tellInvitee[\s\S]*\}\s*catch/);
});

test('an hourly job sweeps held invitation texts', () => {
    const job = sliceBetween(index, 'exports.sendHeldTradeInvitations', '\n);\n');
    assert.match(job, /every 60 minutes/);
    assert.match(job, /sweepHeldInvitations/);
    assert.match(job, /secrets:\s*\[TEXTBELT_KEY\]/);
});

test('the send path loads the invitation wording beside the others', () => {
    const deps = sliceBetween(index, 'function notifierDeps(db)', 'function tell(db, request)');
    assert.match(deps, /invitationTemplates\(loaded\.raw\)/);
});
