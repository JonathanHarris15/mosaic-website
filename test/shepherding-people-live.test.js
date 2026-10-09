// MS-721 — Shepherding People: tag names save themselves, lists are live,
// Add Person asks directory.edit_identity (ADR 0081).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const HTML = read('shepherding-people.html');
const PEOPLE = read('shepherding-people.js');

function mountTags({ canDecide = true, failWrites = false } = {}) {
    const writes = [];
    const toasts = [];
    const ctx = {
        console: { error() {}, warn() {}, info() {}, log() {} },
        setTimeout, clearTimeout,
        window: {},
        ShepherdingCore: { isProjectedTagId: (id) => id === 'member' },
        db: {
            collection: () => ({
                doc: (id) => ({
                    update: async (data) => {
                        if (failWrites) throw Object.assign(new Error('offline'), { code: 'unavailable' });
                        writes.push({ id, data: JSON.stringify(data) });
                    },
                }),
            }),
        },
    };
    vm.createContext(ctx);
    vm.runInContext(read('live-fields-core.js'), ctx);
    if (!ctx.LiveFields && ctx.window.LiveFields) ctx.LiveFields = ctx.window.LiveFields;
    ctx.self = ctx;
    vm.runInContext(read('shepherding-tags.js'), ctx);
    const comp = ctx.window.withTagManager({
        canDecide,
        shepherdingTags: [
            { id: 't1', name: 'Newcomer' },
            { id: 't2', name: 'Prayer' },
            { id: 'member', name: 'Member', locked: true },
        ],
        showToast: (m, kind) => toasts.push(kind || 'ok'),
    });
    return { comp, writes, toasts, ctx };
}

test('live-fields-core is reachable in the test realm', () => {
    const { ctx } = mountTags();
    assert.ok(ctx.LiveFields, 'LiveFields global missing');
});

test('Enter saves the trimmed tag name and closes the box', async () => {
    const { comp, writes } = mountTags();
    comp.startRenameTag(comp.shepherdingTags[0]);
    comp.editTagName('  First Visit ');
    await comp.renameTag('t1');
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].data, JSON.stringify({ name: 'First Visit' }));
    assert.strictEqual(comp.editingTagId, null);
    assert.ok(comp.shepherdingTags.some(t => t.name === 'First Visit'));
});

test('typing alone saves after the debounce', async () => {
    const { comp, writes } = mountTags();
    comp.startRenameTag(comp.shepherdingTags[0]);
    comp.editTagName('Visitor');
    assert.strictEqual(comp.tagChip, 'unsaved');
    await new Promise(r => setTimeout(r, 1700));
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(comp.tagChip, 'saved');
});

test('an empty or duplicate name does not save and says why', async () => {
    const { comp, writes } = mountTags();
    comp.startRenameTag(comp.shepherdingTags[0]);
    comp.editTagName('   ');
    await comp.renameTag('t1');
    assert.strictEqual(writes.length, 0);
    assert.strictEqual(comp.editingTagId, 't1');
    assert.match(comp.tagFault, /needs a name/);
    comp.editTagName('prayer');
    await comp.renameTag('t1');
    assert.strictEqual(writes.length, 0);
    assert.match(comp.tagFault, /already exists/);
});

test('Escape puts the stored name back and writes nothing', async () => {
    const { comp, writes } = mountTags();
    comp.startRenameTag(comp.shepherdingTags[0]);
    comp.editTagName('Oops');
    comp.cancelRenameTag();
    await new Promise(r => setTimeout(r, 1700));
    assert.strictEqual(writes.length, 0);
    assert.strictEqual(comp.editingTagId, null);
    assert.strictEqual(comp.tagLive, null);
});

test('a failed save says Not saved and keeps the box open', async () => {
    const { comp, writes, toasts } = mountTags({ failWrites: true });
    comp.startRenameTag(comp.shepherdingTags[0]);
    comp.editTagName('Visitor');
    await comp.renameTag('t1');
    assert.strictEqual(writes.length, 0);
    assert.strictEqual(comp.tagChip, 'failed');
    assert.strictEqual(comp.tagChipLabel(), 'Not saved');
    assert.strictEqual(comp.editingTagId, 't1');
    assert.strictEqual(toasts[0], 'error');
});

test('without shep.tags.manage (canDecide) nothing opens; projected tags stay locked', () => {
    const { comp } = mountTags({ canDecide: false });
    comp.startRenameTag(comp.shepherdingTags[0]);
    assert.strictEqual(comp.editingTagId, null);
    const elder = mountTags();
    elder.comp.startRenameTag(elder.comp.shepherdingTags[2]);
    assert.strictEqual(elder.comp.editingTagId, null);
});

test('the rename box saves on blur and Enter, reverts on Escape, and has a chip and Retry', () => {
    const box = HTML.slice(HTML.indexOf('data-live-tag-name') - 400, HTML.indexOf('data-live-tag-name'));
    assert.match(box, /@blur="renameTag\(tag\.id\)"/);
    assert.match(box, /@keydown\.enter\.prevent="renameTag\(tag\.id\)"/);
    assert.match(box, /@keydown\.escape="cancelRenameTag\(\)"/);
    assert.match(box, /:value="editingTagName"/);
    assert.match(HTML, /data-live-chip[^>]*x-text="tagChipLabel\(\)"/);
    assert.match(HTML, /data-live-retry/);
    assert.ok(!/title="Save name"/.test(HTML), 'the check-mark Save button is gone');
});

test('the page loads live-read and live-fields-core before the tag manager', () => {
    const lr = HTML.indexOf('src="live-read.js"');
    const lf = HTML.indexOf('src="live-fields-core.js"');
    const tags = HTML.indexOf('src="shepherding-tags.js"');
    assert.ok(lr > 0 && lf > 0 && lr < tags && lf < tags);
});

test('people, tags, and saved views are watched live, quietly', () => {
    const w = PEOPLE.slice(PEOPLE.indexOf('watchLists() {'), PEOPLE.indexOf('adoptTagRename(snap) {'));
    for (const c of ['people', 'people_tags', 'shepherding_views']) {
        assert.match(w, new RegExp(`Live\\.watch\\(db\\.collection\\('${c}'\\)`), c + ' not watched');
    }
    assert.match(w, /onError: \(\) => \{\}/);
    assert.match(PEOPLE, /this\.watchLists\(\);/);
});

test('Add Person shows only with directory.edit_identity, through AccessCore', () => {
    assert.match(PEOPLE, /canAddPerson = AccessCore\.hasPermission\([^)]*'directory\.edit_identity'\)/);
    assert.match(PEOPLE, /canAddPerson: false,/);
    assert.match(HTML, /x-show="canAddPerson" @click="showAddPersonModal = true"/);
});
