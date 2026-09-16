// MS-499 — an Elder Document as a set of Blocks, and back, without losing a word.
//
// An Elder Document's Note Body used to be one stored value, written back whole
// on every autosave, so two elders in two different paragraphs overwrote each
// other. Every block-level node — a heading, a paragraph, a list item, a table
// cell's paragraph, a Person Panel — is now its own Block record under the
// document's `blocks` map, keyed by a lasting id, placed by its PARENT and a
// fractional ORDER KEY. A save writes only the blocks that changed.
//
// These tests pin the storage shape, which every reader and writer shares.

const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/document-body-core.js');

// A minter that counts, so ids are predictable.
function counter(prefix = 'b') {
    let n = 0;
    return () => prefix + (++n);
}

const text = (t, marks) => Object.assign({ type: 'text', text: t }, marks ? { marks } : {});
const para = (...content) => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });
const doc = (...content) => ({ type: 'doc', content });

// A Note Body shaped like real minutes: every kind of thing an elder writes.
function realBody() {
    return doc(
        { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [text('Elder meeting')] },
        para(text('Opened in '), text('prayer', [{ type: 'bold' }]), { type: 'hardBreak' }, text('by Sam.')),
        { type: 'bulletList', content: [
            { type: 'listItem', content: [
                para(text('Visits')),
                { type: 'bulletList', content: [
                    { type: 'listItem', content: [para(text('The Smiths'))] },
                    { type: 'listItem', content: [para(text('Mrs Reed'), text(' (hospital)', [{ type: 'highlight', attrs: { color: '#fef08a' } }]))] },
                ] },
            ] },
            { type: 'listItem', content: [para(text('Membership'))] },
        ] },
        { type: 'orderedList', attrs: { start: 1 }, content: [
            { type: 'listItem', content: [para(text('First'))] },
        ] },
        { type: 'blockquote', content: [para(text('Be shepherds of God’s flock.'))] },
        { type: 'table', content: [
            { type: 'tableRow', content: [
                { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [para(text('Name'))] },
                { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: [120] }, content: [para(text('Needs'))] },
            ] },
            { type: 'tableRow', content: [
                { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [para(text('Bob'))] },
                { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [para()] },
            ] },
        ] },
        { type: 'image', attrs: { src: 'data:image/png;base64,AAAA', alt: 'Sketch', title: null } },
        { type: 'horizontalRule' },
        para(
            text('See '),
            { type: 'mention', attrs: { id: '{"kind":"person","id":"p1"}', label: 'Bob Smith' } },
            text(' and '),
            text('the notes', [{ type: 'link', attrs: { href: 'https://example.org', target: '_blank' } }]),
        ),
        { type: 'personPanel', attrs: {
            personId: 'p1', noteId: 'n1', personName: 'Bob Smith', noteType: 'Elder Meeting',
            bodySnapshot: JSON.stringify(doc(para(text('Doing better.')))),
        } },
        { type: 'codeBlock', attrs: { language: null }, content: [text('x = 1')] },
    );
}

// ── Order keys ───────────────────────────────────────────────────────────────

test('an order key between two keys sorts between them', () => {
    const cases = [[null, null], [null, 'i'], ['i', null], ['a', 'b'], ['a', 'a1'], ['az', 'b'], ['i', 'i1'], ['0i', '1']];
    cases.forEach(([a, b]) => {
        const k = Core.orderKeyBetween(a, b);
        if (a !== null) assert.ok(a < k, `${a} < ${k}`);
        if (b !== null) assert.ok(k < b, `${k} < ${b}`);
        assert.ok(!k.endsWith('0'), `${k} ends in 0, which the next key could not be put before`);
    });
});

test('inserting again and again at one spot keeps making valid, ordered keys', () => {
    let low = 'a', high = 'b';
    const made = [];
    for (let i = 0; i < 200; i++) {
        const k = Core.orderKeyBetween(low, high);
        assert.ok(low < k && k < high);
        made.push(k);
        high = k; // always just after `low`
    }
    let prev = 'a';
    for (let i = 0; i < 200; i++) {
        const k = Core.orderKeyBetween(prev, 'b');
        assert.ok(prev < k && k < 'b');
        prev = k;
    }
});

test('a whole body gets short, evenly spaced keys', () => {
    const keys = Core.orderKeys(500);
    assert.strictEqual(keys.length, 500);
    for (let i = 1; i < keys.length; i++) assert.ok(keys[i - 1] < keys[i]);
    assert.ok(keys.every(k => k.length <= 3), 'keys for 500 blocks should stay short');
    assert.ok(keys.every(k => !k.endsWith('0')));
});

// ── A body as Blocks, and back ───────────────────────────────────────────────

test('a real body round-trips to the same Note Body, ids aside', () => {
    const body = realBody();
    const blocks = Core.blocksOfBody(body, counter());
    const back = Core.bodyOfBlocks(blocks);
    assert.ok(Core.sameBodyIgnoringIds(back, body), 'the round trip changed the document');
    assert.deepStrictEqual(Core.stripBlockIds(back), Core.stripBlockIds(body));
});

test('every block-level node is its own Block, text blocks carry their inline content', () => {
    const blocks = Core.blocksOfBody(doc(
        { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('One'))] }] },
    ), counter());
    const byType = Object.values(blocks).reduce((m, b) => { (m[b.type] = m[b.type] || []).push(b); return m; }, {});
    assert.strictEqual(byType.bulletList.length, 1);
    assert.strictEqual(byType.listItem.length, 1);
    assert.strictEqual(byType.paragraph.length, 1);
    assert.deepStrictEqual(byType.paragraph[0].content, [text('One')]);
    assert.strictEqual(byType.listItem[0].content, undefined, 'a container carries no content of its own');
    const listId = Object.keys(blocks).find(id => blocks[id].type === 'bulletList');
    const itemId = Object.keys(blocks).find(id => blocks[id].type === 'listItem');
    assert.strictEqual(blocks[listId].parent, null);
    assert.strictEqual(blocks[itemId].parent, listId);
    assert.strictEqual(byType.paragraph[0].parent, itemId);
});

test('ids already on nodes are kept, missing ones minted, and a duplicate re-minted', () => {
    const body = doc(
        { type: 'paragraph', attrs: { blockId: 'keep1' }, content: [text('a')] },
        { type: 'paragraph', content: [text('b')] },
        { type: 'paragraph', attrs: { blockId: 'keep1' }, content: [text('c')] },
    );
    const blocks = Core.blocksOfBody(body, counter('n'));
    const ids = Object.keys(blocks).sort();
    assert.deepStrictEqual(ids, ['keep1', 'n1', 'n2']);
    assert.deepStrictEqual(blocks.keep1.content, [text('a')], 'the first holder of an id keeps it');
    const rebuilt = Core.bodyOfBlocks(blocks);
    assert.deepStrictEqual(rebuilt.content.map(n => n.attrs.blockId), ['keep1', 'n1', 'n2']);
});

test('the id is written onto every rebuilt block, and nothing else of the attrs moves', () => {
    const body = doc({ type: 'heading', attrs: { level: 3, blockId: 'h1' }, content: [text('Hi')] });
    const blocks = Core.blocksOfBody(body, counter());
    assert.deepStrictEqual(blocks.h1.attrs, { level: 3 }, 'the id is the key, not an attribute');
    assert.deepStrictEqual(Core.bodyOfBlocks(blocks).content[0].attrs, { level: 3, blockId: 'h1' });
});

test('a minted id is a letter then letters and digits, safe in a field path', () => {
    for (let i = 0; i < 50; i++) assert.match(Core.newBlockId(), /^[a-z][a-z0-9]{9}$/);
});

test('an empty set of Blocks is one empty paragraph', () => {
    const body = Core.bodyOfBlocks({});
    assert.strictEqual(body.content.length, 1);
    assert.strictEqual(body.content[0].type, 'paragraph');
});

// ── A stored document ────────────────────────────────────────────────────────

test('a record with blocks reads from them; a legacy record reads its contentJson as before', () => {
    const body = realBody();
    assert.ok(Core.sameBodyIgnoringIds(Core.bodyOfRecord({ blocks: Core.blocksOfBody(body, counter()) }), body));
    assert.deepStrictEqual(Core.bodyOfRecord({ contentJson: body }), body);
    assert.deepStrictEqual(Core.bodyOfRecord({}), Core.emptyBody());
    assert.strictEqual(Core.hasBlocks({ blocks: {} }), true);
    assert.strictEqual(Core.hasBlocks({ contentJson: body }), false);
});

test('converting a legacy record checks that nothing was lost', () => {
    const out = Core.convertLegacy({ contentJson: realBody() }, counter());
    assert.strictEqual(out.ok, true);
    assert.ok(Core.sameBodyIgnoringIds(Core.bodyOfBlocks(out.blocks), realBody()));
});

// ── Forgiving rebuild ────────────────────────────────────────────────────────

test('blocks with the same order key both survive, ordered by id', () => {
    const blocks = {
        zz: { type: 'paragraph', parent: null, order: 'i', content: [text('second')] },
        aa: { type: 'paragraph', parent: null, order: 'i', content: [text('first')] },
    };
    const body = Core.bodyOfBlocks(blocks);
    assert.deepStrictEqual(body.content.map(n => n.content[0].text), ['first', 'second']);
});

test('a block whose parent has gone is kept, wrapped so the document stays valid', () => {
    const blocks = {
        p1: { type: 'paragraph', parent: null, order: 'i', content: [text('Top')] },
        li: { type: 'listItem', parent: 'deletedList', order: 'i' },
        lp: { type: 'paragraph', parent: 'li', order: 'i', content: [text('Orphaned item')] },
        cell: { type: 'tableCell', parent: 'deletedRow', order: 'i', attrs: { colspan: 1, rowspan: 1, colwidth: null } },
        cp: { type: 'paragraph', parent: 'cell', order: 'i', content: [text('Orphaned cell')] },
        lost: { type: 'paragraph', parent: 'nowhere', order: 'a', content: [text('Lost paragraph')] },
    };
    const body = Core.bodyOfBlocks(blocks);
    const words = Core.plainText(body);
    ['Top', 'Orphaned item', 'Orphaned cell', 'Lost paragraph'].forEach(w => assert.ok(words.includes(w), w + ' was dropped'));
    assert.strictEqual(body.content[0].content[0].text, 'Top', 'orphans go at the end');
    assert.ok(body.content.some(n => n.type === 'bulletList' && n.content[0].type === 'listItem'), 'an orphaned list item is not wrapped in a list');
    assert.ok(!body.content.some(n => n.type === 'tableCell'), 'an orphaned cell was left bare at the top');
});

test('a loop of parents does not lose the blocks in it', () => {
    const blocks = {
        a: { type: 'blockquote', parent: 'b', order: 'i' },
        b: { type: 'blockquote', parent: 'a', order: 'i' },
        p: { type: 'paragraph', parent: 'a', order: 'i', content: [text('In a loop')] },
    };
    assert.match(Core.plainText(Core.bodyOfBlocks(blocks)), /In a loop/);
});

test('a container left with nothing in it is still valid', () => {
    const blocks = { li: { type: 'listItem', parent: 'ul', order: 'i' }, ul: { type: 'bulletList', parent: null, order: 'i' } };
    const body = Core.bodyOfBlocks(blocks);
    assert.deepStrictEqual(Core.stripBlockIds(body), doc({ type: 'bulletList', content: [{ type: 'listItem', content: [para()] }] }));
});

// ── What changed ─────────────────────────────────────────────────────────────

function edit(body, fn) {
    const copy = JSON.parse(JSON.stringify(body));
    fn(copy);
    return copy;
}

test('an edit, an insert, a delete and a move each write only what they touch', () => {
    const saved = Core.blocksOfBody(realBody(), counter());
    const body = Core.bodyOfBlocks(saved);

    const typed = edit(body, d => { d.content[1].content[0].text = 'Opened in silent '; });
    const c1 = Core.changedBlocks(saved, Core.blocksOfBody(typed, counter('x'), saved));
    assert.deepStrictEqual(Object.keys(c1.write), [body.content[1].attrs.blockId]);
    assert.deepStrictEqual(c1.remove, []);

    const inserted = edit(body, d => { d.content.splice(2, 0, para(text('New thought'))); });
    const c2 = Core.changedBlocks(saved, Core.blocksOfBody(inserted, counter('x'), saved));
    assert.deepStrictEqual(Object.keys(c2.write), ['x1']);
    assert.ok(c2.write.x1.order > saved[body.content[1].attrs.blockId].order);
    assert.ok(c2.write.x1.order < saved[body.content[2].attrs.blockId].order);

    const deleted = edit(body, d => { d.content.splice(1, 1); });
    const c3 = Core.changedBlocks(saved, Core.blocksOfBody(deleted, counter('x'), saved));
    assert.deepStrictEqual(Object.keys(c3.write), []);
    assert.deepStrictEqual(c3.remove, [body.content[1].attrs.blockId]);

    const moved = edit(body, d => { const [h] = d.content.splice(0, 1); d.content.push(h); });
    const c4 = Core.changedBlocks(saved, Core.blocksOfBody(moved, counter('x'), saved));
    assert.deepStrictEqual(Object.keys(c4.write), [body.content[0].attrs.blockId], 'a move rewrites only the block that moved');
});

test('a body rebuilt from Blocks and turned back into Blocks, keeping their order keys, changes nothing', () => {
    const saved = Core.blocksOfBody(realBody(), counter());
    const again = Core.blocksOfBody(Core.bodyOfBlocks(saved), counter('x'), saved);
    assert.deepStrictEqual(Core.changedBlocks(saved, again), { write: {}, remove: [] });
});

test('splitting a paragraph writes the new half and the shortened first half', () => {
    const saved = Core.blocksOfBody(doc(para(text('One two'))), counter());
    const id = Object.keys(saved)[0];
    const split = doc(
        { type: 'paragraph', attrs: { blockId: id }, content: [text('One')] },
        para(text('two')),
    );
    const c = Core.changedBlocks(saved, Core.blocksOfBody(split, counter('x'), saved));
    assert.deepStrictEqual(Object.keys(c.write).sort(), [id, 'x1'].sort());
});

test('two editors’ changes to different blocks, saved in either order, give one document', () => {
    const start = Core.blocksOfBody(realBody(), counter());
    const body = Core.bodyOfBlocks(start);
    const annBody = edit(body, d => { d.content[1].content[0].text = 'Ann was here. '; });
    const bobBody = edit(body, d => { d.content.push(para(text('Bob added this'))); d.content[0].content[0].text = 'Elders'; });
    const ann = Core.changedBlocks(start, Core.blocksOfBody(annBody, counter('a'), start));
    const bob = Core.changedBlocks(start, Core.blocksOfBody(bobBody, counter('b'), start));

    const annPaths = Object.keys(ann.write).concat(ann.remove);
    const bobPaths = Object.keys(bob.write).concat(bob.remove);
    assert.strictEqual(annPaths.filter(p => bobPaths.includes(p)).length, 0, 'the two saves share a block');

    const applyChange = (blocks, c) => {
        const out = Object.assign({}, blocks, c.write);
        c.remove.forEach(id => delete out[id]);
        return out;
    };
    const annFirst = applyChange(applyChange(start, ann), bob);
    const bobFirst = applyChange(applyChange(start, bob), ann);
    assert.deepStrictEqual(Core.bodyOfBlocks(annFirst), Core.bodyOfBlocks(bobFirst));
    const words = Core.plainText(Core.bodyOfBlocks(annFirst));
    assert.ok(words.includes('Ann was here') && words.includes('Bob added this') && words.includes('Elders'));
});

// ── Taking in somebody else's blocks ─────────────────────────────────────────

test('a block this page has not touched takes the new text, and is not then saved back', () => {
    const stored = Core.blocksOfBody(realBody(), counter());
    const s = Core.createBlocksSession(stored);
    const onScreen = Core.blocksOfBody(Core.bodyOfBlocks(stored), counter('x'), stored);
    s.mounted(onScreen);

    const target = Object.keys(stored).find(id => stored[id].type === 'codeBlock');
    const theirs = Object.assign({}, stored, { [target]: Object.assign({}, stored[target], { content: [text('x = 2')] }) });
    const out = s.adopt(theirs, onScreen, {});
    assert.deepStrictEqual(out.set, [target]);
    assert.deepStrictEqual(out.remove, []);
    assert.deepStrictEqual(out.blocks[target].content, [text('x = 2')]);

    // The page puts it on screen, then reports what the editor made of it.
    const after = Object.assign({}, onScreen, { [target]: theirs[target] });
    s.adopted(after, out);
    assert.deepStrictEqual(s.takeSave(after), { write: {}, remove: [] });
});

test('a block this page has changed and not saved is never adopted over', () => {
    const stored = Core.blocksOfBody(realBody(), counter());
    const s = Core.createBlocksSession(stored);
    const onScreen = Core.blocksOfBody(Core.bodyOfBlocks(stored), counter('x'), stored);
    s.mounted(onScreen);
    const target = Object.keys(stored).find(id => stored[id].type === 'codeBlock');
    const mine = Object.assign({}, onScreen, { [target]: Object.assign({}, onScreen[target], { content: [text('mine')] }) });
    const theirs = Object.assign({}, stored, { [target]: Object.assign({}, stored[target], { content: [text('theirs')] }) });
    const out = s.adopt(theirs, mine, {});
    assert.deepStrictEqual(out.set, []);
    assert.deepStrictEqual(out.blocks[target].content, [text('mine')]);
    assert.deepStrictEqual(Object.keys(s.takeSave(mine).write), [target]);
});

test('blocks added and removed by somebody else arrive, and the ones in this page’s box are kept', () => {
    const stored = Core.blocksOfBody(doc(para(text('A')), para(text('B'))), counter());
    const [a, b] = Object.keys(stored);
    const s = Core.createBlocksSession(stored);
    s.mounted(stored);
    const theirs = Object.assign({}, stored, { c: { type: 'paragraph', parent: null, order: Core.orderKeyBetween(stored[b].order, null), content: [text('C')] } });
    delete theirs[a];
    const out = s.adopt(theirs, stored, { holding: b });
    assert.deepStrictEqual(out.set, ['c']);
    assert.deepStrictEqual(out.remove, [a]);
    assert.deepStrictEqual(Core.plainText(Core.bodyOfBlocks(out.blocks)), 'B C');

    const theirsAgain = Object.assign({}, theirs, { [b]: Object.assign({}, stored[b], { content: [text('B by somebody else')] }) });
    const kept = s.adopt(theirsAgain, stored, { holding: b });
    assert.deepStrictEqual(kept.set, [], 'the block under this page’s own hold was rewritten');
});

test('a failed save puts the stored copy back, so the blocks are unsaved again', () => {
    const stored = Core.blocksOfBody(doc(para(text('A'))), counter());
    const id = Object.keys(stored)[0];
    const s = Core.createBlocksSession(stored);
    s.mounted(stored);
    const typed = { [id]: Object.assign({}, stored[id], { content: [text('AB')] }) };
    const save = s.takeSave(typed);
    assert.deepStrictEqual(Object.keys(save.write), [id]);
    assert.deepStrictEqual(s.takeSave(typed), { write: {}, remove: [] });
    s.saveFailed(save);
    assert.deepStrictEqual(Object.keys(s.takeSave(typed).write), [id]);
});

// ── Boxes ────────────────────────────────────────────────────────────────────

test('the box of a block is the heading, paragraph, list item, cell or panel it belongs to', () => {
    const blocks = Core.blocksOfBody(realBody(), counter());
    const body = Core.bodyOfBlocks(blocks);
    const idOf = node => node.attrs.blockId;
    const [heading, opening, bullets, , quote, table, image, rule, mentions, panel, code] = body.content;
    assert.strictEqual(Core.boxOfBlock(blocks, idOf(heading)), idOf(heading));
    assert.strictEqual(Core.boxOfBlock(blocks, idOf(opening)), idOf(opening));
    assert.strictEqual(Core.boxOfBlock(blocks, idOf(code)), idOf(code));
    assert.strictEqual(Core.boxOfBlock(blocks, idOf(mentions)), idOf(mentions));

    const visits = bullets.content[0];
    assert.strictEqual(Core.boxOfBlock(blocks, idOf(visits.content[0])), idOf(visits), 'a list item’s paragraph is the item’s box');
    const nested = visits.content[1].content[0];
    assert.strictEqual(Core.boxOfBlock(blocks, idOf(nested.content[0])), idOf(nested), 'a nested item is its own box, not its parent’s');
    assert.strictEqual(Core.boxOfBlock(blocks, idOf(bullets)), null, 'a list is structure');

    const quoted = quote.content[0];
    assert.strictEqual(Core.boxOfBlock(blocks, idOf(quoted)), idOf(quoted));
    assert.strictEqual(Core.boxOfBlock(blocks, idOf(quote)), null);

    const headerCell = table.content[0].content[0];
    assert.strictEqual(Core.boxOfBlock(blocks, idOf(headerCell.content[0])), idOf(headerCell));
    const emptyCell = table.content[1].content[1];
    assert.strictEqual(Core.boxOfBlock(blocks, idOf(emptyCell)), idOf(emptyCell));
    assert.strictEqual(Core.boxOfBlock(blocks, idOf(table)), null);
    assert.strictEqual(Core.boxOfBlock(blocks, idOf(table.content[0])), null, 'a row is structure');

    assert.strictEqual(Core.boxOfBlock(blocks, idOf(panel)), idOf(panel));
    assert.strictEqual(Core.boxOfBlock(blocks, idOf(image)), null);
    assert.strictEqual(Core.boxOfBlock(blocks, idOf(rule)), null);
});

// ── Appending, and an orphaned Person Panel ──────────────────────────────────

test('appended content lands after the last top-level block, as new blocks only', () => {
    const stored = Core.blocksOfBody(doc(para(text('Minutes')), { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('x'))] }] }), counter());
    const out = Core.appendBlocks(stored, doc(para(text('Added by the assistant'))), counter('n'));
    assert.deepStrictEqual(out.remove, []);
    assert.deepStrictEqual(Object.keys(out.write), ['n1']);
    const body = Core.bodyOfBlocks(Object.assign({}, stored, out.write));
    assert.strictEqual(Core.plainText(body), 'Minutes x Added by the assistant');
});

test('appending to a document that is one empty paragraph replaces that paragraph', () => {
    const stored = Core.blocksOfBody(Core.emptyBody(), counter());
    const out = Core.appendBlocks(stored, doc(para(text('First words'))), counter('n'));
    assert.deepStrictEqual(out.remove, Object.keys(stored));
    const after = Object.assign({}, stored, out.write);
    out.remove.forEach(id => delete after[id]);
    assert.strictEqual(Core.plainText(Core.bodyOfBlocks(after)), 'First words');
});

test('an orphaned Person Panel is replaced the same way by everybody who does it', () => {
    const stored = Core.blocksOfBody(doc(para(text('Before')), { type: 'personPanel', attrs: {
        // A panel's snapshot is stored as a JSON string, as the editors write it.
        personId: 'p1', noteId: 'n1', personName: 'Bob', noteType: 'Elder Meeting', bodySnapshot: JSON.stringify(doc(para(text('Doing better.')))),
    } }, para(text('After'))), counter());
    const panelId = Object.keys(stored).find(id => stored[id].type === 'personPanel');
    const one = Core.orphanPanelReplacement(stored, panelId);
    const two = Core.orphanPanelReplacement(stored, panelId);
    assert.deepStrictEqual(one, two, 'two pages doing it at once would write different records');
    assert.deepStrictEqual(one.remove, [panelId]);
    const after = Object.assign({}, stored, one.write);
    one.remove.forEach(id => delete after[id]);
    assert.strictEqual(Core.plainText(Core.bodyOfBlocks(after)), 'Before Bob — Elder Meeting Doing better. After');
});

// ── Ids inside the editor (MS-500) ───────────────────────────────────────────

test('a block without an id gets one, and ids already unique are left alone', () => {
    const changes = Core.resolveBlockIds([
        { key: 0, id: 'a' }, { key: 5, id: null }, { key: 9, id: 'b' },
    ], {}, counter('n'));
    assert.deepStrictEqual(changes, [{ key: 5, id: 'n1' }]);
});

test('when a change leaves two blocks with one id, the block that was already there keeps it', () => {
    // Pasting a copy of block "a" ABOVE the original: the original moved from
    // 0 to 7, and the copy now sits at 0.
    const changes = Core.resolveBlockIds([
        { key: 0, id: 'a' }, { key: 7, id: 'a' },
    ], { a: 7 }, counter('n'));
    assert.deepStrictEqual(changes, [{ key: 0, id: 'n1' }]);
});

test('with no record of where an id was, the first block holding it keeps it', () => {
    const changes = Core.resolveBlockIds([
        { key: 0, id: 'a' }, { key: 4, id: 'a' }, { key: 8, id: 'a' },
    ], {}, counter('n'));
    assert.deepStrictEqual(changes, [{ key: 4, id: 'n1' }, { key: 8, id: 'n2' }]);
});

test('a minted id never repeats one already in the document', () => {
    let n = 0;
    const mint = () => ['a', 'a', 'b', 'c'][n++];
    const changes = Core.resolveBlockIds([{ key: 0, id: 'a' }, { key: 3, id: 'b' }, { key: 6, id: null }], {}, mint);
    assert.deepStrictEqual(changes, [{ key: 6, id: 'c' }]);
});
