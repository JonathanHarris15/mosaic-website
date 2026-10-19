const { test } = require('node:test');
const assert = require('node:assert/strict');

const Core = require('../public/resources-core.js');
const Filing = require('../public/filing-core.js');

// MS-693 — the pure model behind the Resources library (ADR-0083).

// ── Names and paths ─────────────────────────────────────────────────────────

test('a name is trimmed, collapsed, and never empty', () => {
    assert.equal(Core.normaliseName('  Romans   8  '), 'Romans 8');
    assert.equal(Core.normaliseName(''), 'Untitled');
    assert.equal(Core.normaliseName(null), 'Untitled');
    assert.equal(Core.normaliseName('x'.repeat(500)).length, Core.MAX_NAME_LENGTH);
});

test('a storage path is built from the id, not from anything a person typed', () => {
    const path = Core.storagePathFor('abc123', '../../etc/passwd');
    assert.ok(path.startsWith('resources/abc123/'));
    assert.doesNotMatch(path, /\.\.\//);
    assert.equal(path.indexOf('/', 'resources/abc123/'.length), -1,
        'a slash past the prefix would file the bytes under a different id');
});

test('a file name with nothing usable in it still produces a path', () => {
    assert.equal(Core.storagePathFor('abc', '///'), 'resources/abc/file');
    assert.equal(Core.storagePathFor('abc', ''), 'resources/abc/file');
});

test('renaming does not move the bytes', () => {
    // The record's storagePath is the truth. Nothing recomputes it from the
    // name, which is why this is worth a test rather than a comment.
    const built = Core.buildFileResource({
        name: 'Romans 8.docx',
        storagePath: Core.storagePathFor('r1', 'Romans 8.docx'),
    });
    const renamed = Core.buildFileResource(
        Object.assign({}, built, { name: 'Romans 8 — final.docx' }));
    assert.equal(renamed.storagePath, built.storagePath);
});

// ── What may be put on the shelf ────────────────────────────────────────────

test('a file over the cap is refused, with the cap in the words', () => {
    assert.equal(Core.validateUploadFile({ name: 'a.pdf', size: 10 }).ok, true);
    assert.equal(Core.validateUploadFile({ name: 'a.pdf', size: Core.MAX_FILE_BYTES }).ok, true);
    const tooBig = Core.validateUploadFile({ name: 'a.pdf', size: Core.MAX_FILE_BYTES + 1 });
    assert.equal(tooBig.ok, false);
    assert.match(tooBig.error, /25 MB/);
    assert.equal(Core.validateUploadFile(null).ok, false);
});

test('any file type is accepted — the cap is the only refusal', () => {
    for (const name of ['a.docx', 'a.pdf', 'a.png', 'a.key', 'a.zip', 'notes']) {
        assert.equal(Core.validateUploadFile({ name, size: 10 }).ok, true, name);
    }
});

test('a link must be http(s), so a row cannot carry a script', () => {
    assert.equal(Core.validateLinkUrl('https://docs.google.com/document/d/1').ok, true);
    assert.equal(Core.validateLinkUrl('http://example.org/x').ok, true);
    assert.equal(Core.validateLinkUrl('  https://example.org/x  ').url, 'https://example.org/x');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'docs.google.com', '']) {
        assert.equal(Core.validateLinkUrl(bad).ok, false, bad);
    }
});

test('a link entry is a link and never a copy', () => {
    const link = Core.buildLinkResource({ name: 'Membership packet', url: 'https://docs.google.com/d/1' });
    assert.equal(link.kind, Core.KIND_LINK);
    assert.equal(link.storagePath, null);
    assert.equal(link.size, 0);
});

// ── How a row reads ─────────────────────────────────────────────────────────

test('the type is read from the content type, and from the extension behind it', () => {
    assert.equal(Core.typeOf({ kind: 'file', name: 'a.pdf' }), 'pdf');
    assert.equal(Core.typeOf({ kind: 'file', name: 'a', contentType: 'application/pdf' }), 'pdf');
    assert.equal(Core.typeOf({ kind: 'file', name: 'a.docx' }), 'doc');
    assert.equal(Core.typeOf({ kind: 'file', name: 'a.PNG' }), 'image');
    assert.equal(Core.typeOf({ kind: 'file', name: 'a.xlsx' }), 'sheet');
    assert.equal(Core.typeOf({ kind: 'file', name: 'notes' }), 'other');
    assert.equal(Core.typeOf({ kind: 'link', name: 'a.pdf' }), 'link',
        'a link to a PDF is still a link — we do not own it');
});

test('the line under the name says the type and the size', () => {
    assert.equal(Core.metaFor({ kind: 'file', name: 'a.pdf', size: 215040 }), 'PDF · 210 KB');
    assert.equal(Core.metaFor({ kind: 'link', name: 'Packet' }), 'Link');
    assert.equal(Core.metaFor({ isFolder: true, name: 'Studies' }), 'Folder');
    assert.equal(Core.metaFor({ kind: 'file', name: 'a.pdf' }), 'PDF',
        'an older record with no size says the type rather than "0 B"');
});

test('each kind of row gets its own glyph', () => {
    assert.equal(Core.iconFor({ isFolder: true }), 'folder');
    assert.equal(Core.iconFor({ kind: 'link' }), 'link');
    assert.equal(Core.iconFor({ kind: 'file', name: 'a.pdf' }), 'picture_as_pdf');
    assert.equal(Core.iconFor({ kind: 'file', name: 'a.docx' }), 'description');
});

test('search is over the name, case-blind, and empty matches everything', () => {
    assert.equal(Core.matchesSearch({ name: 'Romans 8 study' }, 'romans'), true);
    assert.equal(Core.matchesSearch({ name: 'Romans 8 study' }, '8 STU'), true);
    assert.equal(Core.matchesSearch({ name: 'Romans 8 study' }, 'galatians'), false);
    assert.equal(Core.matchesSearch({ name: 'Romans' }, '  '), true);
});

// ── Pins ────────────────────────────────────────────────────────────────────

const pinned = (...ranks) => ranks.map((pinRank, i) => ({
    id: 'r' + i, kind: 'file', name: 'Row ' + i, pinRank,
}));

test('carrying a rank is what being pinned means', () => {
    assert.equal(Core.isPinned({ pinRank: 1000 }), true);
    assert.equal(Core.isPinned({ pinRank: 0 }), true, 'zero is a rank');
    assert.equal(Core.isPinned({ pinRank: null }), false);
    assert.equal(Core.isPinned({}), false);
});

test('the Pinned card is rank order, ties broken on the name', () => {
    const items = [
        { id: 'c', name: 'Carol', pinRank: 2000 },
        { id: 'a', name: 'Alice', pinRank: 1000 },
        { id: 'z', name: 'Zed' },
        { id: 'b', name: 'Bob', pinRank: 1000 },
    ];
    assert.deepEqual(Core.pinnedOrder(items).map(p => p.id), ['a', 'b', 'c']);
});

test('a new pin goes to the bottom of the card', () => {
    assert.equal(Core.nextPinRank([]), Core.PIN_STEP);
    assert.equal(Core.nextPinRank(pinned(1000, 2000)), 3000);
});

test('a drop between two rows writes ONE record, at the midpoint', () => {
    const items = pinned(1000, 2000, 3000);
    const plan = Core.planPinMove(items, { id: 'r2' }, 0);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.writes, [{ id: 'r2', isFolder: false, pinRank: 0 }]);

    const middle = Core.planPinMove(items, { id: 'r0' }, 1);
    assert.deepEqual(middle.writes, [{ id: 'r0', isFolder: false, pinRank: 2500 }]);
});

test('a move onto its own position writes nothing', () => {
    const plan = Core.planPinMove(pinned(1000, 2000, 3000), { id: 'r1' }, 1);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.writes, []);
});

test('moving something that is not pinned is refused, not guessed at', () => {
    const plan = Core.planPinMove(pinned(1000), { id: 'nope' }, 0);
    assert.equal(plan.ok, false);
    assert.match(plan.why, /not pinned/);
});

test('a folder and a file sit in one order, and a write says which it is', () => {
    const items = [
        { id: 'f1', kind: 'folder', name: 'Studies', pinRank: 1000 },
        { id: 'r1', kind: 'file', name: 'Packet.pdf', pinRank: 2000 },
    ];
    assert.deepEqual(Core.pinnedOrder(items).map(p => p.id), ['f1', 'r1']);
    const plan = Core.planPinMove(items, { id: 'f1', isFolder: true }, 1);
    assert.deepEqual(plan.writes, [{ id: 'f1', isFolder: true, pinRank: 3000 }]);
});

test('the whole list is renumbered only once the midpoints have closed up', () => {
    const items = pinned(1000, 1000.001, 2000);
    const plan = Core.planPinMove(items, { id: 'r2' }, 1);
    assert.equal(plan.ok, true);
    assert.equal(plan.writes.length, 3, 'a gap under MIN_PIN_GAP renumbers rather than halving again');
    assert.deepEqual(plan.writes.map(w => w.pinRank), [1000, 2000, 3000]);
    assert.deepEqual(plan.writes.map(w => w.id), ['r0', 'r2', 'r1']);
});

test('halving between the same two rows survives far more drops than anyone makes', () => {
    let items = pinned(1000, 2000);
    let renumbered = 0;
    for (let i = 0; i < 30; i += 1) {
        items.push({ id: 'x' + i, kind: 'file', name: 'X' + i, pinRank: Core.nextPinRank(items) });
        const plan = Core.planPinMove(items, { id: 'x' + i }, 1);
        if (plan.writes.length > 1) renumbered += 1;
        const byId = new Map(items.map(it => [it.id, it]));
        for (const w of plan.writes) byId.get(w.id).pinRank = w.pinRank;
        items = [...byId.values()];
    }
    assert.ok(renumbered <= 2, 'renumbered ' + renumbered + ' times in 30 drops');
    assert.equal(new Set(Core.pinnedOrder(items).map(p => p.id)).size, 32);
});

test('a nudge is the same move, said as one step', () => {
    const items = pinned(1000, 2000, 3000);
    assert.deepEqual(Core.planPinNudge(items, { id: 'r2' }, -1).writes,
        [{ id: 'r2', isFolder: false, pinRank: 1500 }]);
    assert.equal(Core.planPinNudge(items, { id: 'r0' }, -1).ok, false);
    assert.equal(Core.planPinNudge(items, { id: 'r2' }, 1).ok, false);
});

// ── Filing is FilingCore's, not a second copy ───────────────────────────────

test('a folder is a FilingCore folder, with a rank on top', () => {
    const folder = Core.buildFolder({ name: '  Studies ', parentId: null, pinRank: 1000 });
    assert.equal(folder.name, 'Studies');
    assert.equal(folder.parentId, null);
    assert.equal(folder.pinRank, 1000);
    assert.equal(Core.buildFolder({ name: 'x' }).pinRank, null);
});

test('the tree walks are FilingCore\'s, so a deleted folder drops to the root', () => {
    const folders = [{ id: 'f1', name: 'Studies', parentId: null }];
    const items = [
        { id: 'r1', name: 'Romans', folderId: 'f1' },
        { id: 'r2', name: 'Orphan', folderId: 'gone' },
    ];
    assert.deepEqual(Filing.itemsIn(items, 'f1').map(i => i.id), ['r1']);
    assert.deepEqual(Filing.itemsIn(items, null, folders).map(i => i.id), ['r2']);
});
