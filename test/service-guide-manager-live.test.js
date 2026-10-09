// MS-721 — Service Guide manager: Page Templates, Style Presets and Guide
// Templates save themselves (ADR 0081); the gate asks AccessCore.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Access = require('../public/access-core.js');
const Levels = require('../public/account-levels-core.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const HTML = read('service-guide-manager.html');
const SRC = read('service-guide-manager.js');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function mount({ fail = false } = {}) {
    const calls = [];
    let watcher = null;
    const ctx = {
        console: { error() {}, warn() {}, info() {}, log() {} },
        setTimeout, clearTimeout, requestAnimationFrame: (f) => f(),
        document: { getElementById: () => null, fonts: null },
        AccessCore: { writesAsEditor: () => true, hasPermission: () => true },
        GuideEngine: {
            validatePageHtml: (html) => ({ ok: !/<bogus/.test(html), problems: /<bogus/.test(html) ? ['bogus'] : [], entryFields: [] }),
            expandPage: () => [],
        },
        GuideStore: {
            patchGuideDoc: async (db, kind, id, patch) => { if (fail) throw new Error('offline'); calls.push(['patch', kind, id, JSON.stringify(patch)]); },
            savePageTemplate: async (db, doc) => { calls.push(['createPage', doc.name]); return 'new_page'; },
            saveStylePreset: async (db, doc) => { calls.push(['createPreset', doc.name]); return 'new_preset'; },
            saveGuideTemplate: async (db, doc) => { calls.push(['createTemplate', doc.name, JSON.stringify(doc.pages)]); return 'new_tpl'; },
            setDefaultGuideTemplate: async (db, id) => { calls.push(['default', id]); },
        },
        db: { collection: (c) => ({ doc: (id) => ({ path: c + '/' + id }) }) },
        MosaicLiveRead: { watch: (ref, fn) => { watcher = fn; return () => {}; } },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(read('live-fields-core.js'), ctx);
    vm.runInContext(SRC, ctx);
    const comp = vm.runInContext('guideManager()', ctx);
    comp.$nextTick = (f) => f && f();
    comp.pageTemplates = [{ id: 'p1', name: 'Cover', html: '<div></div>', css: '', stylePresetId: '', emitsPages: 'single', isFiller: false }];
    comp.stylePresets = [{ id: 's1', name: 'Classic', css: 'a{}' }];
    comp.guideTemplates = [
        { id: 'g1', name: 'Default', isDefault: true, numberStartPage: 2, pages: [{ pageTemplateId: 'p1', role: 'filler', params: {} }] },
        { id: 'g2', name: 'Easter', isDefault: false, numberStartPage: 2, pages: [{ pageTemplateId: 'p1', role: 'filler', params: {} }] },
    ];
    return { comp, calls, push: (data, pending) => watcher({ exists: true, data: () => data, metadata: { hasPendingWrites: !!pending } }) };
}

test('a Page Template name saves on the debounce; its CSS does not', async () => {
    const { comp, calls } = mount();
    comp.editPage(comp.pageTemplates[0]);
    comp.editingPage.name = 'Front Cover';
    comp.editingPage.css = 'h1{color:red}';
    comp.syncLive('page');
    assert.strictEqual(comp.liveChip.page, 'unsaved');
    await wait(1700);
    assert.strictEqual(calls.length, 1, 'only the simple field went on the timer');
    assert.deepStrictEqual(calls[0].slice(0, 3), ['patch', 'pageTemplates', 'p1']);
    assert.strictEqual(calls[0][3], JSON.stringify({ name: 'Front Cover' }));
    assert.strictEqual(comp.liveChip.page, 'unsaved', 'the CSS is still waiting');
});

test('MS-721 lead call: page HTML / CSS save on blur or close only, never mid-typing', async () => {
    const { comp, calls } = mount();
    comp.editPage(comp.pageTemplates[0]);
    comp.editingPage.html = '<div>half';
    comp.syncLive('page');
    await wait(1700);
    assert.strictEqual(calls.length, 0, 'half-typed markup did not leave');
    comp.editingPage.html = '<div>whole</div>';
    await comp.savePage(); // focusout
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0][3], JSON.stringify({ html: '<div>whole</div>' }));
    assert.strictEqual(comp.liveChip.page, 'saved');
    comp.editingPage.css = 'p{}';
    comp.syncLive('page');
    comp.closePage(); // close flushes
    await wait(10);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[1][3], JSON.stringify({ css: 'p{}' }));
});

test('a Style Preset CSS waits for blur too', async () => {
    const { comp, calls } = mount();
    comp.editPreset(comp.stylePresets[0]);
    comp.editingPreset.css = 'a{color:blue}';
    comp.syncLive('preset');
    await wait(1700);
    assert.strictEqual(calls.length, 0);
    await comp.savePreset();
    assert.strictEqual(calls.length, 1);
});

test('a new item saved by both halves at once is created only once', async () => {
    const { comp, calls } = mount();
    comp.newPreset();
    comp.editingPreset.name = 'Advent';
    comp.editingPreset.css = 'x{}';
    await comp.savePreset();
    assert.strictEqual(calls.filter(c => c[0] === 'createPreset').length, 1);
});

test('a page with validation problems waits until "Save anyway"', async () => {
    const { comp, calls } = mount();
    comp.editPage(comp.pageTemplates[0]);
    comp.editingPage.html = '<bogus></bogus>';
    await comp.savePage();
    assert.strictEqual(calls.length, 0);
    assert.match(comp.liveFaults.page.html, /validation problems/);
    await comp.savePageAnyway();
    assert.strictEqual(calls.length, 1);
});

test('an empty name never saves; Escape puts the stored one back', async () => {
    const { comp, calls } = mount();
    comp.editPreset(comp.stylePresets[0]);
    comp.editingPreset.name = '  ';
    await comp.savePreset();
    assert.strictEqual(calls.length, 0);
    assert.match(comp.liveFaultText('preset'), /name/);
    comp.revertLive('preset', 'name');
    assert.strictEqual(comp.editingPreset.name, 'Classic');
    await comp.savePreset();
    assert.strictEqual(calls.length, 0);
});

test('a new Style Preset is created on its first save, then patched', async () => {
    const { comp, calls } = mount();
    comp.newPreset();
    comp.editingPreset.css = 'p{}';
    await comp.savePreset();
    assert.strictEqual(calls[0][0], 'createPreset');
    assert.strictEqual(comp.editingPreset.id, 'new_preset');
    assert.ok(comp.stylePresets.some(s => s.id === 'new_preset'));
    comp.editingPreset.name = 'Lent';
    await comp.savePreset();
    assert.deepStrictEqual(calls[1].slice(0, 3), ['patch', 'stylePresets', 'new_preset']);
});

test('a Guide Template needs exactly one filler and keeps its church default', async () => {
    const { comp, calls } = mount();
    comp.editTemplate(comp.guideTemplates[0]);
    comp.editingTemplate.pages[0].role = 'normal';
    await comp.saveTemplate();
    assert.strictEqual(calls.length, 0);
    assert.match(comp.liveFaultText('template'), /exactly one page/);
    comp.editingTemplate.pages[0].role = 'filler';
    comp.editingTemplate.isDefault = false;
    await comp.saveTemplate();
    assert.strictEqual(calls.length, 0);
    assert.match(comp.liveFaultText('template'), /church default is required/);
});

test('placements save without their client-only row ids; making default runs the batch', async () => {
    const { comp, calls } = mount();
    comp.editTemplate(comp.guideTemplates[1]);
    comp.addTemplatePage();
    comp.editingTemplate.isDefault = true;
    await comp.saveTemplate();
    const patch = JSON.parse(calls[0][3]);
    assert.strictEqual(patch.pages.length, 2);
    assert.ok(!('_uid' in patch.pages[1]));
    assert.strictEqual(patch.isDefault, true);
    assert.deepStrictEqual(calls[1], ['default', 'g2']);
});

test('a failed save says Not saved and keeps the change', async () => {
    const { comp } = mount({ fail: true });
    comp.editPreset(comp.stylePresets[0]);
    comp.editingPreset.css = 'b{}';
    await comp.savePreset();
    assert.strictEqual(comp.liveChip.preset, 'failed');
    assert.strictEqual(comp.liveChipText('preset'), 'Not saved');
    assert.strictEqual(comp.editingPreset.css, 'b{}');
});

test('another editor\'s change lands in fields you have not touched', async () => {
    const { comp, push } = mount();
    comp.editPreset(comp.stylePresets[0]);
    comp.editingPreset.name = 'Mine';
    comp.syncLive('preset');
    push({ name: 'Theirs', css: 'i{}' });
    assert.strictEqual(comp.editingPreset.name, 'Mine');
    assert.strictEqual(comp.editingPreset.css, 'i{}');
});

test('closing saves what is waiting; deleting the open item throws it away', async () => {
    const { comp, calls } = mount();
    comp.editPreset(comp.stylePresets[0]);
    comp.editingPreset.css = 'q{}';
    comp.closePreset();
    await wait(10);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(comp.live.preset, null);
});

test('the gate asks AccessCore for services.builder.edit, never a level list', () => {
    assert.ok(!/\['editor', 'elder', 'admin', 'super_admin'\]\.includes/.test(SRC));
    assert.match(SRC, /AccessCore\.writesAsEditor\(who\) && AccessCore\.hasPermission\(who, 'services\.builder\.edit'\)/);
    const user = (preset) => Levels.userWriteFromLevel(Levels.accountLevelIdForPreset(preset));
    const gate = (who) => Access.writesAsEditor(who) && Access.hasPermission(who, 'services.builder.edit');
    for (const p of ['editor', 'elder', 'admin', 'super_admin']) assert.strictEqual(gate(user(p)), true, p);
    for (const p of ['member', 'viewer']) assert.strictEqual(gate(user(p)), false, p);
});

test('no Save buttons; chips, Retry, Save anyway, and the modules are on the page', () => {
    assert.ok(!/@click="(savePage|savePreset|saveTemplate)\(\)"><span class="material-symbols-outlined[^"]*">save/.test(HTML));
    assert.ok(!/>save<\/span> Save/.test(HTML));
    for (const k of ['page', 'preset', 'template']) {
        assert.match(HTML, new RegExp(`data-live-chip="${k}"`));
        assert.match(HTML, new RegExp(`data-live-retry="${k}"`));
        assert.match(HTML, new RegExp(`@keydown\\.escape="revertLive\\('${k}', 'name'\\)"`));
    }
    assert.match(HTML, /@click="savePageAnyway\(\)"/);
    const at = (f) => HTML.indexOf(`src="${f}"`);
    for (const f of ['access-core.js', 'live-read.js', 'live-fields-core.js']) {
        assert.ok(at(f) > 0 && at(f) < at('service-guide-manager.js'), f);
    }
});
