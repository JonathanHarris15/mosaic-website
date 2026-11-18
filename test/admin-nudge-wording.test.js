// MS-248 / MS-441 — Admin settings: nudge wording saves itself, beside the
// event announcement wording, and a switch turns nudging on and off.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (/** @type {string} */ f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const HTML = read('admin-dashboard.html');
const core = require('../functions/assignment-nudge.js');
const serverWording = core.templatesForSendPath({});
const DEFAULT_TEXT = serverWording.text.nudge;
const DEFAULT_PUSH = serverWording.push.nudge;

/** @param {{stored?: Object<string, *>, fail?: boolean}} [opts] */
function mount({ stored = {}, fail = false } = {}) {
    /** @type {Array<*>} */
    const writes = [];
    /** @type {Array<*>} */
    const toasts = [];
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
                        if (fail) throw new Error('offline');
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
    comp.showToast = (/** @type {string} */ m, /** @type {string} */ kind) => toasts.push(kind || 'ok');
    const push = (/** @type {*} */ data) => watchers.forEach((w) => w({ exists: true, data: () => data, metadata: { hasPendingWrites: false } }));
    return { comp, writes, toasts, push };
}

test('the page defaults are the server defaults, so a blank field means the same thing on both', () => {
    const { comp } = mount();
    assert.strictEqual(comp.nudgeWording.text, DEFAULT_TEXT);
    assert.strictEqual(comp.nudgeWording.pushTitle, DEFAULT_PUSH.title);
    assert.strictEqual(comp.nudgeWording.pushBody, DEFAULT_PUSH.body);
});

test('nudging reads as off when nothing is saved', async () => {
    const { comp } = mount({ stored: {} });
    await comp.loadNudgeSettings();
    assert.strictEqual(comp.nudgeEnabled, false);
});

test('saved wording and the switch load from the shared config', async () => {
    const { comp } = mount({ stored: { nudgeEnabled: true, reminderNudgeText: 'Hey {name}: {places} {link}' } });
    await comp.loadNudgeSettings();
    assert.strictEqual(comp.nudgeEnabled, true);
    assert.strictEqual(comp.nudgeWording.text, 'Hey {name}: {places} {link}');
    assert.strictEqual(comp.nudgeWording.pushTitle, DEFAULT_PUSH.title);
});

test('blur saves only the changed nudge field, trimmed and merged', async () => {
    const { comp, writes } = mount();
    await comp.loadNudgeSettings();
    comp.editNudgeWording('pushTitle', '  Still on? ');
    await comp.saveNudgeWording();
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].path, 'app_config/prayer_request_sms');
    assert.strictEqual(writes[0].merge, true);
    assert.strictEqual(writes[0].data.reminderNudgePushTitle, 'Still on?');
    assert.ok(!('reminderNudgeText' in writes[0].data));
    assert.strictEqual(writes[0].data.updatedBy, 'admin1');
});

test('the switch saves at once, merged, and says so', async () => {
    const { comp, writes, toasts } = mount();
    await comp.loadNudgeSettings();
    await comp.setNudgeEnabled(true);
    assert.strictEqual(comp.nudgeEnabled, true);
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].data.nudgeEnabled, true);
    assert.strictEqual(writes[0].merge, true);
    assert.ok(toasts.length >= 1);
});

test('a switch that fails to save flips back', async () => {
    const { comp } = mount({ fail: true });
    await comp.loadNudgeSettings();
    await comp.setNudgeEnabled(true);
    assert.strictEqual(comp.nudgeEnabled, false);
});

test('another admin flipping the switch shows up here', async () => {
    const { comp, push } = mount();
    await comp.loadNudgeSettings();
    push({ nudgeEnabled: true });
    assert.strictEqual(comp.nudgeEnabled, true);
});

test('editing nudge wording leaves event announcement wording alone', async () => {
    const { comp, writes } = mount();
    await comp.loadEventAnnouncementWording();
    await comp.loadNudgeSettings();
    comp.editNudgeWording('text', 'X {places} {link}');
    await comp.saveNudgeWording();
    assert.strictEqual(writes.length, 1);
    assert.deepStrictEqual(Object.keys(writes[0].data).sort(), ['reminderNudgeText', 'updatedAt', 'updatedBy']);
});

test('Reset to defaults saves the defaults', async () => {
    const { comp, writes } = mount({ stored: { reminderNudgeText: 'custom' } });
    await comp.loadNudgeSettings();
    comp.resetNudgeWording();
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].data.reminderNudgeText, DEFAULT_TEXT);
});

test('the page has both switches and three live boxes naming {date} and {days}', () => {
    assert.match(HTML, /data-nudge-switch[^>]*@change="setNudgeEnabled\(\$event\.target\.checked\)"/);
    assert.match(HTML, /data-push-switch[^>]*@change="setPushEnabled\(\$event\.target\.checked\)"/);
    assert.match(HTML, /\{date\}/);
    assert.match(HTML, /\{days\}/);
    for (const f of ['text', 'pushTitle', 'pushBody']) {
        const at = HTML.indexOf(`data-live-nudge="${f}"`);
        assert.ok(at > 0, f);
        const tag = HTML.slice(HTML.lastIndexOf('<', at), at);
        assert.match(tag, new RegExp(`@input="editNudgeWording\\('${f}'`));
        assert.match(tag, /@blur="saveNudgeWording\(\)"/);
        assert.match(tag, new RegExp(`@keydown\\.escape="revertNudgeWording\\('${f}'\\)"`));
    }
    assert.match(HTML, /x-text="nudgeChipText"/);
});

test('the page loads the nudge settings when it loads the other wording', () => {
    const js = read('admin-dashboard.js');
    assert.match(js, /this\.loadNudgeSettings\(\)/);
});
