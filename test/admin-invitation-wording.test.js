// MS-249 / MS-525 — Admin settings: the Trade invitation text saves itself,
// beside the other message wording, and a blank one means the default.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (/** @type {string} */ f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const HTML = read('admin-dashboard.html');
const DEFAULT_TEXT = require('../functions/trade-invitation-text.js')
    .templatesForSendPath({}).text.invitation;

/** @param {{stored?: Object<string, *>}} [opts] */
function mount({ stored = {} } = {}) {
    /** @type {Array<*>} */
    const writes = [];
    /** @type {*} */
    let factory = null;
    /** @type {Array<*>} */
    const watchers = [];
    /** @type {*} */
    const ctx = {
        console: { error() {}, warn() {}, info() {}, log() {} },
        setTimeout, clearTimeout,
        firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
        document: { addEventListener: (/** @type {string} */ ev, /** @type {Function} */ fn) => { if (ev === 'alpine:init') fn(); } },
        Alpine: { data: (/** @type {string} */ name, /** @type {Function} */ fn) => { if (name === 'adminDashboard') factory = fn; } },
        db: {
            collection: (/** @type {string} */ c) => ({
                doc: (/** @type {string} */ id) => ({
                    get: async () => ({ exists: true, data: () => stored }),
                    set: async (/** @type {*} */ data, /** @type {*} */ opts) => {
                        writes.push({ path: c + '/' + id, data: JSON.parse(JSON.stringify(data)), merge: !!(opts && opts.merge) });
                    },
                }),
            }),
        },
    };
    ctx.window = ctx;
    ctx.MosaicLiveRead = { watch: (/** @type {*} */ ref, /** @type {*} */ onNext) => { watchers.push(onNext); return () => {}; } };
    vm.createContext(ctx);
    vm.runInContext(read('live-fields-core.js'), ctx);
    vm.runInContext(read('admin-dashboard.js'), ctx);
    const comp = factory();
    comp.currentUser = { uid: 'admin1' };
    comp.showToast = () => {};
    const push = (/** @type {*} */ data) => watchers.forEach((w) => w({ exists: true, data: () => data, metadata: { hasPendingWrites: false } }));
    return { comp, writes, push };
}

test('the page default is the server default', () => {
    const { comp } = mount();
    assert.strictEqual(comp.invitationWording.text, DEFAULT_TEXT);
});

test('a saved wording loads; a blank one shows the default', async () => {
    const a = mount({ stored: { tradeInvitationText: 'Can you do {role}? {link}' } });
    await a.comp.loadInvitationWording();
    assert.strictEqual(a.comp.invitationWording.text, 'Can you do {role}? {link}');
    const b = mount({ stored: { tradeInvitationText: '  ' } });
    await b.comp.loadInvitationWording();
    assert.strictEqual(b.comp.invitationWording.text, DEFAULT_TEXT);
});

test('blur saves the wording, trimmed and merged, and nothing else', async () => {
    const { comp, writes } = mount();
    await comp.loadInvitationWording();
    comp.editInvitationWording('text', '  {inviter} asked: {role}. {link} ');
    await comp.saveInvitationWording();
    assert.strictEqual(writes.length, 1);
    assert.deepStrictEqual(Object.keys(writes[0].data).sort(), ['tradeInvitationText', 'updatedAt', 'updatedBy']);
    assert.strictEqual(writes[0].data.tradeInvitationText, '{inviter} asked: {role}. {link}');
    assert.strictEqual(writes[0].merge, true);
});

test('another admin’s change lands here', async () => {
    const { comp, push } = mount();
    await comp.loadInvitationWording();
    push({ tradeInvitationText: 'From elsewhere {link}' });
    assert.strictEqual(comp.invitationWording.text, 'From elsewhere {link}');
});

test('the page has a live box naming the placeholders, loaded with the rest', () => {
    const at = HTML.indexOf('data-live-invitation="text"');
    assert.ok(at > 0);
    const tag = HTML.slice(HTML.lastIndexOf('<', at), at);
    assert.match(tag, /@input="editInvitationWording\('text'/);
    assert.match(tag, /@blur="saveInvitationWording\(\)"/);
    assert.match(tag, /@keydown\.escape="revertInvitationWording\('text'\)"/);
    for (const p of ['{name}', '{inviter}', '{role}', '{event}', '{date}', '{link}']) {
        assert.ok(HTML.includes(p), p);
    }
    assert.match(read('admin-dashboard.js'), /this\.loadInvitationWording\(\)/);
});
