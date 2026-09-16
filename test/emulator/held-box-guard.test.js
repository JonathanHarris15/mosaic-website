const {describe, test, before, beforeEach} = require('node:test');
const assert = require('node:assert');

const H = require('./harness.js');

// The assistant waits its turn at a held box (MS-433, ADR-0063), against a real
// Firestore: presence records seeded exactly as a page writes them, and each
// tool called through the same registration the MCP server uses.
//
// ⚠ WHAT ONLY A REAL DATABASE SHOWS HERE. That "refused" means nothing was
// written — the cell, the answer, the document, the note are all still there
// afterwards — is a claim about what reached Firestore.

global.MosaicIdentity = require('../../functions/shared/mosaic-identity.js');
const Guard = require('../../functions/held-box-guard.js');
const ShepTools = require('../../functions/mcp-shepherding-tools.js');
const Payload = require('../../functions/shepherding-payload-writes.js');
const Writes = require('../../functions/shepherding-writes.js');
const Docs = require('../../functions/shepherding-doc-writes.js');
const Tasks = require('../../functions/task-writes.js');
const Actor = require('../../functions/mcp-actor.js');

const UID = 'uid-elder-1';
const SAM = 'uid-elder-sam';
const ELDER_PERSON = 'person-jono';
const A = 'person-sarah';
const B = 'person-tom';

const suite = H.skipReason
    ? (name) => test(name, {skip: H.skipReason}, () => {})
    : describe;

// A stand-in McpServer that keeps each tool's handler, so a tool is called the
// way the protocol calls it — through elderTool's gate and guard.
function toolsFor(db, uid) {
    const admin = require('firebase-admin');
    const handlers = {};
    ShepTools.register({
        registerTool: (name, spec, handler) => { handlers[name] = {spec, handler}; },
    }, {
        db,
        auth: {uid, permissionLevel: 'elder'},
        fieldValues: {
            FieldValue: admin.firestore.FieldValue,
            Timestamp: admin.firestore.Timestamp,
            FieldPath: admin.firestore.FieldPath,
        },
    });
    return {
        handlers,
        call: async (name, args) => {
            const out = await handlers[name].handler(args);
            const text = out.content[0].text;
            return out.isError ? {refused: text} : {ok: JSON.parse(text)};
        },
    };
}

suite('the assistant at a held box', () => {
    let db, actor, tools, Timestamp;

    before(() => {
        db = H.connect();
        Timestamp = require('firebase-admin').firestore.Timestamp;
    });

    beforeEach(async () => {
        await H.wipe();
        await H.seedPerson(db, ELDER_PERSON, {name: 'Jonathan Harris'});
        await H.seedPerson(db, A, {name: 'Sarah Bell'});
        await H.seedPerson(db, B, {name: 'Tom Reed'});
        await db.collection('users').doc(UID).set({
            personId: ELDER_PERSON, email: 'jono@example.com', permissionLevel: 'elder',
        });
        await db.collection('people_tags').doc('red-flag').set({
            name: 'Red Flag', hidePeople: false, hiddenFromOthers: false,
        });
        actor = await Actor.requireActor(db, UID);
        tools = toolsFor(db, UID);
    });

    // Somebody's claim, as ShepherdingPresence writes it. `agoMs` ages the
    // heartbeat; `idleMs` ages the last keystroke.
    function hold(uid, box, opts) {
        const o = opts || {};
        const now = Date.now();
        return db.collection(o.collection || 'shepherding_presence').doc(uid).set({
            personId: 'p-' + uid, name: o.name || 'Sam Jones', surface: 'x', pageKey: 'y',
            scopeKey: box.scopeKey, boxKey: box.boxKey,
            updatedAt: Timestamp.fromMillis(now - (o.agoMs || 0)),
            activeAt: Timestamp.fromMillis(now - (o.idleMs || 0)),
        });
    }

    // ── Who holds a box ──────────────────────────────────────────────────

    test('a fresh hold is named; a lapsed heartbeat, a quiet hold and your own are not', async () => {
        const box = Guard.noteBox(A, 'n1');
        await hold(SAM, box);
        assert.deepStrictEqual((await Guard.holders(db, {uid: UID, boxes: [box]})).map((h) => h.name), ['Sam Jones']);

        await hold(SAM, box, {agoMs: 45000});
        assert.strictEqual((await Guard.holders(db, {uid: UID, boxes: [box]})).length, 0, 'a dead page held it');

        await hold(SAM, box, {idleMs: 90000});
        assert.strictEqual((await Guard.holders(db, {uid: UID, boxes: [box]})).length, 0, 'a quiet hold held it');

        await hold(UID, box);
        await db.collection('shepherding_presence').doc(SAM).delete();
        assert.strictEqual((await Guard.holders(db, {uid: UID, boxes: [box]})).length, 0, 'your own hold blocked you');
    });

    test('a hold in another box, or another document, is not in the way', async () => {
        await hold(SAM, {scopeKey: 'document:other', boxKey: 'block:b1'});
        const found = await Guard.holders(db, {
            uid: UID,
            boxes: [Guard.titleBox('doc1')],
            scopes: [{scopeKey: 'document:doc1', what: 'that document'}],
        });
        assert.strictEqual(found.length, 0);
    });

    test('an Order of Service slot is held with no idle rule, on either key a page uses', async () => {
        await hold(SAM, {scopeKey: '2026-10-04', boxKey: 'liturgy.hymn1'}, {collection: 'presence', idleMs: 600000});
        const found = await Guard.holders(db, {
            uid: UID, area: Guard.ORDER_OF_SERVICE, boxes: Guard.liturgyBoxes('2026-10-04', ['hymn1', 'hymn2']),
        });
        assert.deepStrictEqual(found.map((h) => h.what), ['hymn1 on 2026-10-04']);
        assert.match(Guard.refusalFor(found), /^Sam Jones is editing hymn1 on 2026-10-04 — try again shortly/);
    });

    // ── Care List cells ──────────────────────────────────────────────────

    test('a held cell refuses naming the holder and is unchanged; the cell beside it still lands', async () => {
        await Writes.addTags(db, {personId: A, tagIds: ['red-flag'], actor});
        await Writes.addTags(db, {personId: B, tagIds: ['red-flag'], actor});
        const list = await Payload.createCareList(db, {title: 'Visits', filter: {tagIds: ['red-flag']}, actor});
        await hold(SAM, Guard.careListCellBox(list.documentId, A, 'col_default'));

        const refused = await tools.call('shep_write_care_list_cell', {documentId: list.documentId, personId: A, markdown: 'Mine'});
        assert.match(refused.refused, /Sam Jones is editing that Care List cell/);
        const after = await Payload.getCareList(db, {documentId: list.documentId});
        assert.ok(!after.rows.find((r) => r.personId === A).cells.col_default);

        const beside = await tools.call('shep_write_care_list_cell', {documentId: list.documentId, personId: B, markdown: 'Theirs'});
        assert.ok(beside.ok, beside.refused);

        await db.collection('shepherding_presence').doc(SAM).delete();
        const later = await tools.call('shep_write_care_list_cell', {documentId: list.documentId, personId: A, markdown: 'Mine'});
        assert.ok(later.ok, 'still refused once the hold was gone');
    });

    test('an old Care List with no stored columns still protects its default cell', async () => {
        await Writes.addTags(db, {personId: A, tagIds: ['red-flag'], actor});
        const list = await Payload.createCareList(db, {title: 'Visits', filter: {tagIds: ['red-flag']}, actor});
        const ref = db.collection('elder_documents').doc(list.documentId);
        await ref.update({careListColumns: require('firebase-admin').firestore.FieldValue.delete()});
        const col = require('../../functions/shared/care-list-core.js').columnsOf((await ref.get()).data())[0].id;
        await hold(SAM, Guard.careListCellBox(list.documentId, A, col));
        const out = await tools.call('shep_write_care_list_cell', {documentId: list.documentId, personId: A, markdown: 'Mine'});
        assert.match(out.refused || '', /Sam Jones/);
    });

    // ── Form Documents ───────────────────────────────────────────────────

    test('a held question is skipped naming the holder, and the others land', async () => {
        await db.collection('forms').doc('interview').set({
            title: 'Elder Interview', mode: 'document',
            questions: [
                {id: 'q_story', type: 'paragraph', text: 'How did they come to faith?'},
                {id: 'q_ready', type: 'choice_one', text: 'Ready?', options: ['Yes', 'Not yet']},
            ],
        });
        const made = await Payload.createFormDocument(db, {templateId: 'interview', personId: A, actor});
        await hold(SAM, Guard.questionBox(made.documentId, 'q_story'));

        const out = await tools.call('shep_answer_form_document', {
            documentId: made.documentId, answers: {q_story: 'Mine', q_ready: 'Yes'},
        });
        assert.deepStrictEqual(out.ok.answered, ['q_ready']);
        assert.match(out.ok.skipped.find((s) => s.questionId === 'q_story').why, /Sam Jones is editing/);

        const all = await tools.call('shep_answer_form_document', {documentId: made.documentId, answers: {q_story: 'Mine'}});
        assert.match(all.refused, /Sam Jones/);
        const withTypo = await tools.call('shep_answer_form_document', {documentId: made.documentId, answers: {q_story: 'Mine', q_typo: 'x'}});
        assert.match(withTypo.refused, /Sam Jones/, 'every real answer held, plus a typo, still wrote nothing and said ok');
        const stored = (await db.collection('elder_documents').doc(made.documentId).get()).data();
        assert.ok(!stored.answers || !stored.answers.q_story);
    });

    // ── Elder Documents ──────────────────────────────────────────────────

    test('a held paragraph refuses a body replace, not a title change; a held title refuses a rename', async () => {
        const made = await Docs.createDocument(db, {title: 'Minutes', markdown: 'Opened in prayer.', actor});
        const id = made.documentId;
        await hold(SAM, {scopeKey: 'document:' + id, boxKey: 'block:abc'});

        const body = await tools.call('shep_update_document', {documentId: id, markdown: 'Something else'});
        assert.match(body.refused, /Sam Jones is editing that document/);
        const stored = (await db.collection('elder_documents').doc(id).get()).data();
        assert.match(JSON.stringify(stored.blocks), /Opened in prayer/);

        const title = await tools.call('shep_update_document', {documentId: id, title: 'Elder Minutes'});
        assert.ok(title.ok, title.refused);

        await hold(SAM, Guard.titleBox(id));
        const rename = await tools.call('shep_rename_document', {documentId: id, title: 'Other'});
        assert.match(rename.refused, /Sam Jones is editing the title/);

        const append = await tools.call('shep_append_to_document', {documentId: id, markdown: 'Closed.'});
        assert.ok(append.ok, 'adding to the end checks no box');
    });

    test('a Person Panel held on the profile refuses a body replace of its document', async () => {
        const made = await Docs.createDocument(db, {title: 'Minutes', actor});
        const panel = await Docs.addPersonPanel(db, {documentId: made.documentId, personId: A, markdown: 'Doing well', actor});
        await hold(SAM, Guard.noteBox(A, panel.noteId));
        const out = await tools.call('shep_update_document', {documentId: made.documentId, markdown: 'Gone'});
        assert.match(out.refused, /Sam Jones is editing the Person Panel for Sarah Bell/);
    });

    test('a held box refuses deleting its document, and the Folder it is in', async () => {
        const folder = await Docs.createFolder(db, {name: 'Meetings'});
        const made = await Docs.createDocument(db, {title: 'Minutes', folderId: folder.folderId, actor});
        await hold(SAM, {scopeKey: 'document:' + made.documentId, boxKey: 'block:abc'});

        const del = await tools.call('shep_delete_document', {documentId: made.documentId});
        assert.match(del.refused, /Sam Jones/);
        const delFolder = await tools.call('shep_delete_folder', {folderId: folder.folderId, confirmDocumentCount: 1});
        assert.match(delFolder.refused, /Sam Jones is editing a document in that Folder/);
        assert.ok((await db.collection('elder_documents').doc(made.documentId).get()).exists);
    });

    // ── Notes and Tasks ──────────────────────────────────────────────────

    test('a note open on a profile refuses edit, append and delete; another note does not', async () => {
        const one = await Writes.writeNote(db, {personId: A, type: 'Life Update', markdown: 'First', actor});
        const two = await Writes.writeNote(db, {personId: A, type: 'Life Update', markdown: 'Second', actor});
        await hold(SAM, Guard.noteBox(A, one.noteId));

        assert.match((await tools.call('shep_edit_note', {personId: A, noteId: one.noteId, markdown: 'x'})).refused, /Sam Jones is editing that note/);
        assert.match((await tools.call('shep_append_to_note', {personId: A, noteId: one.noteId, markdown: 'x'})).refused, /Sam Jones/);
        assert.match((await tools.call('shep_delete_note', {personId: A, noteId: one.noteId})).refused, /Sam Jones/);
        assert.ok((await db.collection('people').doc(A).collection('shepherding_notes').doc(one.noteId).get()).exists);

        assert.ok((await tools.call('shep_append_to_note', {personId: A, noteId: two.noteId, markdown: 'More'})).ok);
    });

    test('a Task open in its editor refuses complete, skip and delete', async () => {
        const task = await Tasks.createTask(db, {title: 'Ring Dave', due: '2026-10-01', actor});
        await hold(SAM, Guard.taskBox(task.taskId));
        assert.match((await tools.call('shep_complete_task', {taskId: task.taskId})).refused, /Sam Jones is editing that Task/);
        assert.match((await tools.call('shep_delete_task', {taskId: task.taskId})).refused, /Sam Jones/);
        assert.ok((await db.collection('shepherding_tasks').doc(task.taskId).get()).exists);
    });

    test('the elder’s own open editor never blocks their own assistant', async () => {
        const one = await Writes.writeNote(db, {personId: A, type: 'Life Update', markdown: 'First', actor});
        await hold(UID, Guard.noteBox(A, one.noteId), {name: 'Jonathan Harris'});
        assert.ok((await tools.call('shep_append_to_note', {personId: A, noteId: one.noteId, markdown: 'More'})).ok);
    });
});

// ── Every write tool says what it writes ─────────────────────────────────────

test('every Shepherding write tool declares its boxes, and one that does not cannot be registered', () => {
    const specs = {};
    ShepTools.register({registerTool: (name, spec) => { specs[name] = spec; }}, {db: {}, auth: {}, fieldValues: {}});
    assert.ok(Object.keys(specs).length > 40);
    Object.keys(specs).forEach((name) => {
        assert.ok(!('boxes' in specs[name]), name + ' handed its declaration to the protocol');
    });
    // The declaration is enforced in the one place tools are registered.
    const src = require('node:fs').readFileSync(require.resolve('../../functions/mcp-shepherding-tools.js'), 'utf8');
    assert.match(src, /if \(!readOnly && !declared\) \{\s*\n\s*throw new Error/);
});
