// MS-721 — Admin settings: event announcement wording saves itself (ADR 0081).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const HTML = read('admin-dashboard.html');

function mount({ stored = {}, fail = false } = {}) {
    const writes = [];
    const toasts = [];
    let watcher = null;
    let factory = null;
    const ctx = {
        console: { error(...a) { if (process.env.DBG) console.log(...a); }, warn() {}, info() {}, log() {} },
        setTimeout, clearTimeout,
        firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
        document: { addEventListener: (ev, fn) => { if (ev === 'alpine:init') fn(); } },
        Alpine: { data: (name, fn) => { if (name === 'adminDashboard') factory = fn; } },
        db: {
            collection: (c) => ({
                doc: (id) => ({
                    _path: c + '/' + id,
                    get: async () => ({ exists: true, data: () => stored }),
                    set: async (data, opts) => {
                        if (fail) throw new Error('offline');
                        writes.push({ path: c + '/' + id, data: JSON.stringify(data), merge: !!(opts && opts.merge) });
                    },
                }),
            }),
        },
    };
    ctx.window = ctx;
    ctx.MosaicLiveRead = { watch: (ref, onNext) => { watcher = onNext; return () => {}; } };
    vm.createContext(ctx);
    vm.runInContext(read('live-fields-core.js'), ctx);
    vm.runInContext(read('admin-dashboard.js'), ctx);
    const comp = factory();
    comp.currentUser = { uid: 'admin1' };
    comp.showToast = (m, kind) => toasts.push(kind || 'ok');
    return { comp, writes, toasts, push: (data, pending) => watcher({ exists: true, data: () => data, metadata: { hasPendingWrites: !!pending } }) };
}

test('loaded wording starts a live controller; blur saves only the changed field, trimmed, merged', async () => {
    const { comp, writes } = mount({ stored: { eventAnnouncementText: 'Hi {title}' } });
    await comp.loadEventAnnouncementWording();
    assert.ok(comp.wordingLive);
    assert.strictEqual(comp.eventAnnouncementWording.text, 'Hi {title}');
    comp.editWording('pushTitle', '  New: {title} ');
    assert.strictEqual(comp.wordingChip, 'unsaved');
    await comp.saveEventAnnouncementWording();
    assert.strictEqual(writes.length, 1);
    const w = JSON.parse(writes[0].data);
    assert.strictEqual(writes[0].path, 'app_config/prayer_request_sms');
    assert.strictEqual(writes[0].merge, true);
    assert.strictEqual(w.pushEventAnnouncementTitle, 'New: {title}');
    assert.ok(!('eventAnnouncementText' in w), 'untouched field not written');
    assert.strictEqual(w.updatedBy, 'admin1');
    assert.strictEqual(comp.wordingChip, 'saved');
});

test('typing alone saves after the debounce', async () => {
    const { comp, writes } = mount();
    await comp.loadEventAnnouncementWording();
    comp.editWording('pushBody', '{prose}!');
    await new Promise(r => setTimeout(r, 1700));
    assert.strictEqual(writes.length, 1);
});

test('Escape reverts a field that has not saved', async () => {
    const { comp, writes } = mount();
    await comp.loadEventAnnouncementWording();
    comp.editWording('text', 'oops');
    comp.revertWording('text');
    assert.strictEqual(comp.eventAnnouncementWording.text, '{title}\n\n{prose}\n{link}');
    await comp.saveEventAnnouncementWording();
    assert.strictEqual(writes.length, 0);
});

test('a failed save says Not saved and keeps the change', async () => {
    const { comp, toasts } = mount({ fail: true });
    await comp.loadEventAnnouncementWording();
    comp.editWording('text', 'kept');
    await comp.saveEventAnnouncementWording();
    assert.strictEqual(comp.wordingChip, 'failed');
    assert.strictEqual(comp.wordingChipText, 'Not saved');
    assert.strictEqual(comp.eventAnnouncementWording.text, 'kept');
    assert.strictEqual(toasts[0], 'error');
});

test('another admin\'s change lands in untouched fields only', async () => {
    const { comp, push } = mount();
    await comp.loadEventAnnouncementWording();
    comp.editWording('pushTitle', 'mine');
    push({ eventAnnouncementText: 'theirs', pushEventAnnouncementTitle: 'theirs too' });
    assert.strictEqual(comp.eventAnnouncementWording.text, 'theirs');
    assert.strictEqual(comp.eventAnnouncementWording.pushTitle, 'mine');
});

test('Reset to defaults saves the defaults', async () => {
    const { comp, writes } = mount({ stored: { eventAnnouncementText: 'custom' } });
    await comp.loadEventAnnouncementWording();
    comp.resetEventAnnouncementWording();
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(JSON.parse(writes[0].data).eventAnnouncementText, '{title}\n\n{prose}\n{link}');
});

test('the wording boxes save on blur, revert on Escape; no Save button; chip and Retry', () => {
    for (const f of ['text', 'pushTitle', 'pushBody']) {
        const at = HTML.indexOf(`data-live-wording="${f}"`);
        assert.ok(at > 0, f);
        const tag = HTML.slice(HTML.lastIndexOf('<', at), at);
        assert.match(tag, new RegExp(`@input="editWording\\('${f}'`));
        assert.match(tag, /@blur="saveEventAnnouncementWording\(\)"/);
        assert.match(tag, new RegExp(`@keydown\\.escape="revertWording\\('${f}'\\)"`));
        assert.ok(!/x-model/.test(tag));
    }
    assert.ok(!/Save wording/.test(HTML));
    assert.match(HTML, /data-live-chip[^>]*x-text="wordingChipText"/);
    assert.match(HTML, /data-live-retry[^>]*wordingLive\.retry\(\)/);
    const lf = HTML.indexOf('src="live-fields-core.js"');
    assert.ok(HTML.indexOf('src="live-read.js"') > 0 && lf > 0 && lf < HTML.indexOf('src="admin-dashboard.js"'));
});
