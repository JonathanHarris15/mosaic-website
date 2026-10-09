// MS-721 — Relations viewer: an existing Relationship Type saves itself
// (ADR 0081). A new Type is still created on purpose.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const HTML = read('relations-viewer.html');
const DELETE = { __delete: true };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const DISCIPLESHIP = { name: 'Discipleship', kind: 'pairwise', priority: true, holderLabel: 'Discipler', counterpartLabel: 'Disciplee' };

function mount({ fail = false, confirmAnswer = true, edges = {} } = {}) {
    const store = { relationship_types: { t1: { ...DISCIPLESHIP } }, relationships: { ...edges }, relationship_groups: {}, people: {} };
    const updates = [];
    let watcher = null;
    const coll = (name) => ({
        get: async () => ({ docs: Object.entries(store[name] || {}).map(([id, d]) => ({ id, data: () => d })) }),
        orderBy: () => coll(name),
        where: (f, op, v) => ({ get: async () => ({ docs: Object.entries(store[name] || {}).filter(([, d]) => d[f] === v).map(([id, d]) => ({ id, data: () => d })) }) }),
        doc: (id) => ({
            _p: [name, id],
            update: async (w) => {
                if (fail) throw new Error('offline');
                updates.push({ name, id, w });
                const cur = store[name][id] || {};
                Object.keys(w).forEach(k => { if (w[k] === DELETE) delete cur[k]; else cur[k] = w[k]; });
                store[name][id] = cur;
            },
        }),
    });
    const ctx = {
        console: { error() {}, warn() {}, info() {}, log() {} },
        setTimeout, clearTimeout,
        confirm: () => confirmAnswer,
        firebase: { firestore: { FieldValue: { delete: () => DELETE } } },
        db: {
            collection: coll,
            batch: () => { const ops = []; return { update: (ref, w) => ops.push([ref, w]), commit: async () => { for (const [ref, w] of ops) { store[ref._p[0]][ref._p[1]] = { ...store[ref._p[0]][ref._p[1]], ...w }; } } }; },
        },
        MosaicLiveRead: { watch: (ref, fn) => { watcher = fn; return () => {}; } },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    for (const f of ['live-fields-core.js', 'relationship-core.js', 'relationship-group-core.js', 'shepherding-relationships.js']) vm.runInContext(read(f), ctx);
    const tab = vm.runInContext('window.withRelationshipsTab({ canDecide: true })', ctx);
    tab.toasts = [];
    tab.showToast = (m, t = 'ok') => tab.toasts.push(t);
    return { tab, store, updates, push: (d) => watcher({ exists: true, data: () => d, metadata: { hasPendingWrites: false } }) };
}

test('renaming an open Type autosaves only the name', async () => {
    const { tab, updates } = mount();
    await tab.loadRelationshipsTab();
    tab.startEditType(tab.relTypes[0]);
    tab.typeForm.name = 'Mentoring';
    tab.syncLiveType();
    assert.strictEqual(tab.typeChip, 'unsaved');
    await wait(1700);
    assert.strictEqual(updates.length, 1);
    assert.strictEqual(JSON.stringify(updates[0].w), JSON.stringify({ name: 'Mentoring' }));
    assert.strictEqual(tab.typeChip, 'saved');
    assert.strictEqual(tab.relTypes[0].name, 'Mentoring');
});

test('going Symmetric deletes the stale role labels in the same update', async () => {
    const { tab, store } = mount();
    await tab.loadRelationshipsTab();
    tab.startEditType(tab.relTypes[0]);
    tab.typeForm.priority = false;
    tab.typeForm.label = 'Peer';
    await tab.saveTypeNow();
    const t = store.relationship_types.t1;
    assert.strictEqual(t.label, 'Peer');
    assert.strictEqual(t.priority, false);
    assert.ok(!('holderLabel' in t) && !('counterpartLabel' in t));
});

test('an incomplete shape waits and says why', async () => {
    const { tab, updates } = mount();
    await tab.loadRelationshipsTab();
    tab.startEditType(tab.relTypes[0]);
    tab.typeForm.counterpartLabel = '';
    await tab.saveTypeNow();
    assert.strictEqual(updates.length, 0);
    assert.match(tab.typeFault, /counterpart/i);
});

test('Escape puts the stored name back', async () => {
    const { tab, updates } = mount();
    await tab.loadRelationshipsTab();
    tab.startEditType(tab.relTypes[0]);
    tab.typeForm.name = 'Oops';
    tab.revertType('name');
    assert.strictEqual(tab.typeForm.name, 'Discipleship');
    await tab.saveTypeNow();
    assert.strictEqual(updates.length, 0);
});

test('sharing outward asks first; yes saves and re-projects the edges', async () => {
    const no = mount({ confirmAnswer: false });
    await no.tab.loadRelationshipsTab();
    no.tab.startEditType(no.tab.relTypes[0]);
    assert.strictEqual(no.tab.setTypeSharing(true), false);
    assert.strictEqual(no.tab.typeForm.sharedWithEditors, false);

    const yes = mount({ edges: { e1: { fromId: 'a', toId: 'b', typeId: 't1' } } });
    await yes.tab.loadRelationshipsTab();
    yes.tab.startEditType(yes.tab.relTypes[0]);
    assert.strictEqual(yes.tab.setTypeSharing(true), true);
    await yes.tab.saveTypeNow();
    assert.strictEqual(yes.store.relationship_types.t1.sharedWithEditors, true);
    assert.strictEqual(yes.store.relationships.e1.sharedWithEditors, true, 'the edge follows its Type');
});

test('a failed save says Not saved and keeps the change', async () => {
    const { tab } = mount({ fail: true });
    await tab.loadRelationshipsTab();
    tab.startEditType(tab.relTypes[0]);
    tab.typeForm.name = 'Kept';
    await tab.saveTypeNow();
    assert.strictEqual(tab.typeChip, 'failed');
    assert.strictEqual(tab.typeChipText, 'Not saved');
    assert.strictEqual(tab.typeForm.name, 'Kept');
    assert.strictEqual(tab.toasts[0], 'error');
});

test('another elder\'s change lands where you have not typed', async () => {
    const { tab, push } = mount();
    await tab.loadRelationshipsTab();
    tab.startEditType(tab.relTypes[0]);
    tab.typeForm.name = 'Mine';
    tab.syncLiveType();
    push({ ...DISCIPLESHIP, name: 'Theirs', holderLabel: 'Mentor' });
    assert.strictEqual(tab.typeForm.name, 'Mine');
    assert.strictEqual(tab.typeForm.holderLabel, 'Mentor');
});

test('Done saves what is waiting and closes; without canDecide nothing opens', async () => {
    const { tab, store } = mount();
    await tab.loadRelationshipsTab();
    tab.startEditType(tab.relTypes[0]);
    tab.typeForm.holderLabel = 'Mentor';
    await tab.saveType();
    assert.strictEqual(store.relationship_types.t1.holderLabel, 'Mentor');
    assert.strictEqual(tab.showTypeForm, false);
    assert.strictEqual(tab.typeLive, null);
    tab.canDecide = false;
    tab.startEditType(tab.relTypes[0]);
    assert.strictEqual(tab.typeLive, null);
});

test('the form: chip, Retry, Escape on the name, Done, sharing asks; modules loaded', () => {
    assert.match(HTML, /x-show="showTypeForm" @focusout="editingTypeId && saveTypeNow\(\)"/);
    assert.match(HTML, /@keydown\.escape="revertType\('name'\)"/);
    assert.match(HTML, /data-live-chip[^>]*x-text="typeChipText"/);
    assert.match(HTML, /data-live-retry/);
    assert.match(HTML, /editingTypeId \? 'Done' : 'Create type'/);
    assert.ok(!/Save changes/.test(HTML));
    assert.match(HTML, /@change="if \(!setTypeSharing\(\$event\.target\.checked\)\)/);
    const at = (f) => HTML.indexOf(`src="${f}"`);
    assert.ok(at('live-read.js') > 0 && at('live-fields-core.js') > 0 && at('live-fields-core.js') < at('shepherding-relationships.js'));
});
