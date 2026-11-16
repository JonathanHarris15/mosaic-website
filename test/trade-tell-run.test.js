/**
 * The Trade tell trigger and its hourly sweep (MS-824), run through the real
 * rules, the real Commitments wording and the real send path. Only the
 * network and Firestore are faked.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {tellParties, sweepHeldTells} = require('../functions/trade-tell-firestore.js');
const {tellPerson} = require('../functions/notification-send.js');
const tell = require('../functions/trade-tell.js');
const {churchDateParts} = require('../functions/notification-core.js');

const INSIDE = new Date('2026-09-15T15:00:00Z');
const NIGHT = new Date('2026-09-15T03:00:00Z');

/**
 * @param {Object<string, *>} [over]
 * @return {*}
 */
function trade(over) {
    return Object.assign({
        id: 't1', origin: 'invitation', state: 'invited',
        holderId: 'bob', counterpartyId: 'ann',
        assignment: {occurrenceId: 'o1', roleSlug: 'sound', slotId: 's1', date: '2026-09-20'},
        eventName: 'Sunday Service', roleName: 'Sound',
        offered: [], closedBy: null, closedBecause: null,
    }, over || {});
}

/** @param {Object<string, *>} [over] */
function world(over) {
    const o = over || {};
    let now = o.now || INSIDE;
    /** @type {Map<string, *>} */
    const records = new Map();
    /** @type {Object<string, *>} */
    const trades = {t1: trade(o.trade)};
    /** @type {Object<string, *>} */
    const people = Object.assign({
        bob: {uid: 'u-bob', phone: '+15550001', firstName: 'Bob'},
        ann: {uid: 'u-ann', phone: '+15550002', firstName: 'Ann'},
    }, o.people || {});
    /** @type {{push: Array<*>, text: Array<*>}} */
    const calls = {push: [], text: []};
    /** @type {*} */
    const notifierDeps = {
        now: () => now,
        loadPerson: async (/** @type {string} */ id) => people[id],
        loadTokens: async (/** @type {string} */ uid) => (uid ? [{id: 'd-' + uid, token: 'tok-' + uid}] : []),
        loadTemplates: async () => tell.templatesForSendPath(),
        sendPush: async (/** @type {*} */ m) => { calls.push.push(m); return {accepted: true}; },
        sendText: async (/** @type {*} */ m) => { calls.text.push(m); return {accepted: true, textId: 'x'}; },
        deleteToken: async () => {},
        writeLog: async () => {},
    };
    /** @type {*} */
    const deps = {
        churchNow: () => churchDateParts(now),
        now: () => now.toISOString(),
        origin: 'https://x.test',
        tellPerson,
        notifierDeps,
        loadPerson: notifierDeps.loadPerson,
        loadTrade: async (/** @type {string} */ id) => trades[id] || null,
        claimRecord: async (/** @type {string} */ id, /** @type {*} */ row) => {
            if (records.has(id)) return false;
            records.set(id, row);
            return true;
        },
        writeRecord: async (/** @type {string} */ id, /** @type {*} */ patch) => {
            records.set(id, Object.assign({}, records.get(id), patch));
        },
        loadHeldRecords: async () => Array.from(records.entries())
            .filter(([, r]) => r.status === 'held')
            .map(([id, r]) => Object.assign({id}, r)),
    };
    return {deps, calls, records, trades, setNow: (/** @type {Date} */ d) => { now = d; }};
}

test('an invitation pushes the invitee the line their Commitments row says', async () => {
    const w = world();
    await tellParties(w.deps, {tradeId: 't1', before: null, after: w.trades.t1});
    assert.equal(w.calls.push.length, 1);
    assert.equal(w.calls.push[0].token, 'tok-u-ann');
    assert.equal(w.calls.push[0].title, 'Bob asked you');
    assert.match(w.calls.push[0].body, /Sound/);
    assert.equal(w.calls.push[0].url, 'https://x.test/commitments.html');
    assert.equal(w.records.get('t1__invited__ann').status, 'sent');
});

test('a trigger that fires twice sends once', async () => {
    const w = world();
    await tellParties(w.deps, {tradeId: 't1', before: null, after: w.trades.t1});
    await tellParties(w.deps, {tradeId: 't1', before: null, after: w.trades.t1});
    assert.equal(w.calls.push.length, 1);
});

test('an invitee with no account is not told here', async () => {
    const w = world({people: {ann: {uid: null, phone: '+15550002', firstName: 'Ann'}}});
    await tellParties(w.deps, {tradeId: 't1', before: null, after: w.trades.t1});
    assert.equal(w.calls.push.length + w.calls.text.length, 0);
});

test('a refusal tells the holder, and not the one who refused', async () => {
    const w = world();
    const after = trade({state: 'refused', closedBy: 'ann'});
    w.trades.t1 = after;
    await tellParties(w.deps, {tradeId: 't1', before: trade(), after});
    assert.equal(w.calls.push.length, 1);
    assert.equal(w.calls.push[0].token, 'tok-u-bob');
    assert.equal(w.calls.push[0].title, 'Ann said no');
});

test('at night it is held; the sweep sends it in the morning if still true', async () => {
    const w = world({now: NIGHT});
    await tellParties(w.deps, {tradeId: 't1', before: null, after: w.trades.t1});
    assert.equal(w.calls.push.length, 0);
    assert.equal(w.records.get('t1__invited__ann').status, 'held');
    w.setNow(INSIDE);
    await sweepHeldTells(w.deps);
    await sweepHeldTells(w.deps);
    assert.equal(w.calls.push.length, 1);
    assert.equal(w.records.get('t1__invited__ann').status, 'sent');
});

test('a held message whose Trade has moved on is dropped, not sent', async () => {
    const w = world({now: NIGHT});
    await tellParties(w.deps, {tradeId: 't1', before: null, after: w.trades.t1});
    w.trades.t1 = trade({state: 'withdrawn', closedBy: 'bob'});
    w.setNow(INSIDE);
    await sweepHeldTells(w.deps);
    assert.equal(w.calls.push.length, 0);
    assert.equal(w.records.get('t1__invited__ann').status, 'dropped');
});

test('a throw in the send is caught and recorded', async () => {
    const w = world();
    w.deps.tellPerson = async () => { throw new Error('boom'); };
    await tellParties(w.deps, {tradeId: 't1', before: null, after: w.trades.t1});
    assert.equal(w.records.get('t1__invited__ann').status, 'failed');
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

test('a trigger on every Trade write tells the parties', () => {
    const fn = sliceBetween(index, 'exports.tellTradeParties', '\n);\n');
    assert.match(fn, /onDocumentWritten/);
    assert.match(fn, /trades\/\{tradeId\}/);
    assert.match(fn, /tellParties\(/);
    assert.match(fn, /secrets:\s*\[TEXTBELT_KEY\]/);
});

test('an hourly job sends what was held overnight', () => {
    const fn = sliceBetween(index, 'exports.sendHeldTradeTells', '\n);\n');
    assert.match(fn, /every 60 minutes/);
    assert.match(fn, /sweepHeldTells\(/);
});

test('the send path loads the Trade wording beside the others', () => {
    const deps = sliceBetween(index, 'function notifierDeps(db)', 'function tell(db, request)');
    assert.match(deps, /tradeTellTemplates\(\)/);
});
