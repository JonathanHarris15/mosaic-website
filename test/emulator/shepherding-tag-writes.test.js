const {describe, test, before, beforeEach} = require('node:test');
const assert = require('node:assert');

const H = require('./harness.js');
const Tags = require('../../functions/shepherding-tag-writes.js');
const Writes = require('../../functions/shepherding-writes.js');
const Read = require('../../functions/shepherding-read.js');
const Actor = require('../../functions/mcp-actor.js');

// The Shepherding Tag tools, against a real Firestore (MS-278).
//
// ⚠ WHY THESE EARN AN EMULATOR RATHER THAN A FAKE. A merge is the most
// destructive thing the MCP can do — it rewrites every carrier's `tags` array,
// re-points every Tag Change in every Pastoral Record, and deletes tag ids,
// with no undo. What has to be true of it is a claim about several documents
// changing together and about `array-contains` finding the right people; a
// hand-written fake would only prove the fake agrees with itself.
//
// ⚠ AND BECAUSE THE COLLECTION NAME IS A TRAP. A Shepherding Tag lives in
// `people_tags`. `shepherding_tags` exists in firestore.rules and nothing uses
// it, so reaching for the name that reads correctly returns an empty list and
// NO ERROR — every tool here would have quietly done nothing.

const UID = 'uid-elder-1';
const ELDER_PERSON = 'person-jono';
const A = 'person-sarah';
const B = 'person-tom';

const suite = H.skipReason
    ? (name) => test(name, {skip: H.skipReason}, () => {})
    : describe;

suite('the Shepherding Tag tools', () => {
    let db, actor;

    before(() => {
        db = H.connect();
        const admin = require('firebase-admin');
        require('../../functions/mcp-firestore.js').bind({
            FieldValue: admin.firestore.FieldValue,
            Timestamp: admin.firestore.Timestamp,
        });
    });

    beforeEach(async () => {
        await H.wipe();
        await H.seedPerson(db, ELDER_PERSON, {name: 'Jonathan Harris'});
        await H.seedPerson(db, A, {name: 'Sarah Bell'});
        await H.seedPerson(db, B, {name: 'Tom Reed'});
        await db.collection('users').doc(UID).set({
            personId: ELDER_PERSON, email: 'jono@example.com', permissionLevel: 'elder',
        });
        actor = await Actor.requireActor(db, UID);
    });

    /** A tag, as the Manage Tags page would write it. */
    async function seedTag(id, name, flags) {
        await db.collection('people_tags').doc(id).set(
            Object.assign({name, hidePeople: false, hiddenFromOthers: false}, flags || {}));
    }

    // ── The list, and the trap in the collection name ────────────────────

    test('the tags come back at all, which is the collection-name trap', async () => {
        await seedTag('red-flag', 'Red Flag');
        await seedTag('new-family', 'New Family');

        const listed = await Tags.listTags(db);
        assert.strictEqual(listed.count, 2);
        assert.deepStrictEqual(listed.tags.map((t) => t.name), ['New Family', 'Red Flag']);
    });

    test('both hiding flags come back, and they are different things', async () => {
        // `hidePeople` hides the PEOPLE carrying the tag; `hiddenFromOthers`
        // hides the tag's NAME. Confusing them is the classic mistake, so the
        // tool reports each separately rather than one "hidden".
        await seedTag('private', 'Private', {hiddenFromOthers: true});
        await seedTag('sensitive', 'Sensitive', {hidePeople: true});

        const byId = {};
        (await Tags.listTags(db)).tags.forEach((t) => {
            byId[t.tagId] = t;
        });

        assert.strictEqual(byId['private'].hiddenFromOthers, true);
        assert.strictEqual(byId['private'].hidePeople, false);
        assert.strictEqual(byId['sensitive'].hidePeople, true);
        assert.strictEqual(byId['sensitive'].hiddenFromOthers, false);
    });

    // ── Making and renaming ──────────────────────────────────────────────

    test('a new tag gets a stable id that is not its name', async () => {
        // ADR-0011: identity is the id, so a rename later moves nobody.
        const made = await Tags.createTag(db, {name: 'Needs a visit'});
        assert.ok(made.tagId);
        assert.notStrictEqual(made.tagId, 'Needs a visit');

        const stored = (await db.collection('people_tags').doc(made.tagId).get()).data();
        assert.strictEqual(stored.name, 'Needs a visit');
        assert.strictEqual(stored.hidePeople, false);
    });

    test('a duplicate name is refused, naming the tag that already has it', async () => {
        await seedTag('red-flag', 'Red Flag');
        await assert.rejects(
            () => Tags.createTag(db, {name: 'red flag'}), /already a tag/i);
    });

    test('a rename moves nobody — the whole point of a stable id', async () => {
        await seedTag('red-flag', 'Red Flag');
        await Writes.addTags(db, {personId: A, tagIds: ['red-flag'], actor});

        await Tags.renameTag(db, {tagId: 'red-flag', name: 'Urgent Care'});

        const person = (await db.collection('people').doc(A).get()).data();
        assert.deepStrictEqual(person.tags, ['red-flag'], 'the carrier still carries it');

        const stored = (await db.collection('people_tags').doc('red-flag').get()).data();
        assert.strictEqual(stored.name, 'Urgent Care');
    });

    test('a Membership Tag cannot be renamed or deleted', async () => {
        await assert.rejects(
            () => Tags.renameTag(db, {tagId: 'Member', name: 'Members'}),
            /Membership Track|Elder role/);
        await assert.rejects(
            () => Tags.deleteTag(db, {tagId: 'Member'}), /Membership Track|Elder role/);
    });

    // ── The merge ────────────────────────────────────────────────────────

    test('the preview says what a merge would destroy, and changes nothing', async () => {
        await seedTag('visit', 'Visit');
        await seedTag('needs-visit', 'Needs a visit');
        await Writes.addTags(db, {personId: A, tagIds: ['needs-visit'], actor});
        await Writes.addTags(db, {personId: B, tagIds: ['needs-visit'], actor});

        const plan = await Tags.previewMerge(db, {
            tagIds: ['needs-visit'], survivorTagId: 'visit',
        });

        assert.strictEqual(plan.survivor.name, 'Visit');
        assert.strictEqual(plan.peopleAffected, 2);
        assert.strictEqual(plan.merging[0].carriers, 2);
        assert.strictEqual(plan.reversible, false);
        assert.match(plan.note, /cannot be undone/i);

        // Nothing moved.
        assert.ok((await db.collection('people_tags').doc('needs-visit').get()).exists);
        const person = (await db.collection('people').doc(A).get()).data();
        assert.deepStrictEqual(person.tags, ['needs-visit']);
    });

    test('a merge moves the carriers and deletes the folded tag', async () => {
        await seedTag('visit', 'Visit');
        await seedTag('needs-visit', 'Needs a visit');
        await Writes.addTags(db, {personId: A, tagIds: ['needs-visit'], actor});
        await Writes.addTags(db, {personId: B, tagIds: ['needs-visit'], actor});

        const done = await Tags.mergeTags(db, {
            tagIds: ['needs-visit'], survivorTagId: 'visit',
        });

        assert.strictEqual(done.peopleMoved, 2);
        assert.deepStrictEqual(done.tagsDeleted, ['needs-visit']);

        for (const id of [A, B]) {
            const person = (await db.collection('people').doc(id).get()).data();
            assert.deepStrictEqual(person.tags, ['visit'], id);
        }
        assert.strictEqual(
            (await db.collection('people_tags').doc('needs-visit').get()).exists, false);
    });

    test('the survivor inherits the history, so it inherits the Tag Hold', async () => {
        // ADR-0011's real reason for re-pointing Tag Changes: deriveTagHolds
        // reads the earliest `added` of the run, so the survivor picks up the
        // longer hold rather than looking freshly applied.
        await seedTag('visit', 'Visit');
        await seedTag('needs-visit', 'Needs a visit');
        await Writes.addTags(db, {personId: A, tagIds: ['needs-visit'], actor});

        await Tags.mergeTags(db, {tagIds: ['needs-visit'], survivorTagId: 'visit'});

        const record = await Read.getPastoralRecord(db, {personId: A});
        const change = record.entries.find((e) => e.kind === 'tag_change');
        assert.strictEqual(change.tagId, 'visit');
        assert.match(change.summary, /Visit/);
    });

    test('somebody carrying both tags ends up with one, not a duplicate', async () => {
        await seedTag('visit', 'Visit');
        await seedTag('needs-visit', 'Needs a visit');
        await Writes.addTags(db, {personId: A, tagIds: ['visit', 'needs-visit'], actor});

        await Tags.mergeTags(db, {tagIds: ['needs-visit'], survivorTagId: 'visit'});

        const person = (await db.collection('people').doc(A).get()).data();
        assert.deepStrictEqual(person.tags, ['visit']);
    });

    test('a merge onto a tag that does not exist is refused before anything moves', async () => {
        await seedTag('needs-visit', 'Needs a visit');
        await Writes.addTags(db, {personId: A, tagIds: ['needs-visit'], actor});

        await assert.rejects(() => Tags.mergeTags(db, {
            tagIds: ['needs-visit'], survivorTagId: 'nothing',
        }), /No Shepherding Tag/);

        assert.ok((await db.collection('people_tags').doc('needs-visit').get()).exists);
    });

    // ── Deleting ─────────────────────────────────────────────────────────

    test('deleting takes the tag off everyone and says how many', async () => {
        await seedTag('red-flag', 'Red Flag');
        await Writes.addTags(db, {personId: A, tagIds: ['red-flag'], actor});
        await Writes.addTags(db, {personId: B, tagIds: ['red-flag'], actor});

        const gone = await Tags.deleteTag(db, {tagId: 'red-flag'});
        assert.strictEqual(gone.removedFrom, 2);

        for (const id of [A, B]) {
            const person = (await db.collection('people').doc(id).get()).data();
            assert.deepStrictEqual(person.tags, [], id);
        }
        assert.strictEqual(
            (await db.collection('people_tags').doc('red-flag').get()).exists, false);
    });

    test('deleting leaves the history alone — the tag really did apply', async () => {
        await seedTag('red-flag', 'Red Flag');
        await Writes.addTags(db, {personId: A, tagIds: ['red-flag'], actor});

        await Tags.deleteTag(db, {tagId: 'red-flag'});

        const record = await Read.getPastoralRecord(db, {personId: A});
        assert.strictEqual(record.count, 1, 'the Tag Change stays');
    });

    test('deleting a hiding tag re-settles who is hidden', async () => {
        // `shepherdingHidden` is denormalised onto the Person so the directory
        // can filter without reading every tag. Taking away the tag that set it
        // has to take away the flag, or somebody stays invisible for ever.
        await seedTag('sensitive', 'Sensitive', {hidePeople: true});
        await Writes.addTags(db, {personId: A, tagIds: ['sensitive'], actor});
        assert.strictEqual(
            (await db.collection('people').doc(A).get()).data().shepherdingHidden, true);

        await Tags.deleteTag(db, {tagId: 'sensitive'});

        assert.strictEqual(
            (await db.collection('people').doc(A).get()).data().shepherdingHidden, false);
    });

    // ── The person-write tools the first suite left over ─────────────────

    test('removing a tag logs the removal and clears the flag', async () => {
        await seedTag('sensitive', 'Sensitive', {hidePeople: true});
        await Writes.addTags(db, {personId: A, tagIds: ['sensitive'], actor});

        const off = await Writes.removeTags(db, {
            personId: A, tagIds: ['sensitive'], explanation: 'Settled.', actor,
        });
        assert.strictEqual(off.changed.length, 1);

        const person = (await db.collection('people').doc(A).get()).data();
        assert.deepStrictEqual(person.tags, []);
        assert.strictEqual(person.shepherdingHidden, false);

        const entry = (await db.collection('people').doc(A)
            .collection('shepherding_activity')
            .doc(off.changed[0].activityId).get()).data();
        assert.strictEqual(entry.action, 'removed');
        assert.strictEqual(entry.explanation, 'Settled.');
        assert.strictEqual(entry.writtenVia, 'mcp');
    });

    test('removing a tag nobody carries is skipped, not logged', async () => {
        await seedTag('red-flag', 'Red Flag');
        const off = await Writes.removeTags(db, {personId: A, tagIds: ['red-flag'], actor});
        assert.strictEqual(off.changed.length, 0);
        assert.match(off.skipped[0].why, /not carried/);
    });

    test('an Explanation can be put on a change after the fact', async () => {
        const {activityId} = await Writes.setStatus(db, {
            personId: A, urgency: 'urgent', importance: 'important', actor,
        });

        await Writes.explainChange(db, {
            personId: A, activityId, explanation: 'Agreed at the meeting.',
        });

        const entry = (await db.collection('people').doc(A)
            .collection('shepherding_activity').doc(activityId).get()).data();
        assert.strictEqual(entry.explanation, 'Agreed at the meeting.');
    });

    test('explaining an entry that is not there says which tool to use instead', async () => {
        await assert.rejects(() => Writes.explainChange(db, {
            personId: A, activityId: 'nope', explanation: 'x',
        }), /shep_edit_note/);
    });

    test('a note can be edited and deleted', async () => {
        const {noteId} = await Writes.writeNote(db, {
            personId: A, type: 'Elder Meeting', markdown: 'First go.', actor,
        });

        await Writes.editNote(db, {
            personId: A, noteId, subject: 'Reworded', markdown: '## Second go', actor,
        });

        const back = await Read.getNote(db, {personId: A, noteId});
        assert.strictEqual(back.subject, 'Reworded');
        assert.strictEqual(back.body, '## Second go');
        assert.strictEqual(back.noteType, 'Elder Meeting', 'untouched fields stay');

        const gone = await Writes.deleteNote(db, {personId: A, noteId});
        assert.strictEqual(gone.deleted.subject, 'Reworded');
        assert.strictEqual((await Read.listNotes(db, {personId: A})).count, 0);
    });

    test('a note belonging to a Person Panel is not deletable from here', async () => {
        // Deleting it would leave the panel in its Elder Document pointing at
        // nothing; the page has a whole conversation about which to keep.
        const Docs = require('../../functions/shepherding-doc-writes.js');
        const {documentId} = await Docs.createDocument(db, {title: 'Minutes', actor});
        const panel = await Docs.addPersonPanel(db, {
            documentId, personId: A, markdown: 'Discussed.', actor,
        });

        await assert.rejects(() => Writes.deleteNote(db, {
            personId: A, noteId: panel.noteId,
        }), /Person Panel/);
    });

    // ── The People list ──────────────────────────────────────────────────

    test('the People list filters on tags, any and all', async () => {
        await seedTag('red-flag', 'Red Flag');
        await seedTag('new-family', 'New Family');
        await Writes.addTags(db, {personId: A, tagIds: ['red-flag', 'new-family'], actor});
        await Writes.addTags(db, {personId: B, tagIds: ['red-flag'], actor});

        const any = await Read.listPeople(db, {
            tagIds: ['red-flag', 'new-family'], tagMode: 'any',
        });
        assert.strictEqual(any.count, 2);

        const all = await Read.listPeople(db, {
            tagIds: ['red-flag', 'new-family'], tagMode: 'all',
        });
        assert.strictEqual(all.count, 1);
        assert.strictEqual(all.people[0].personId, A);
    });

    test('the People list filters on the status zone', async () => {
        await Writes.setStatus(db, {
            personId: A, urgency: 'urgent', importance: 'important', actor,
        });

        const found = await Read.listPeople(db, {statusZones: ['urgent__important']});
        assert.strictEqual(found.count, 1);
        assert.strictEqual(found.people[0].personId, A);
    });

    test('inactive people are left out unless asked for', async () => {
        await Writes.setMembershipStage(db, {personId: B, inactive: true, actor});

        const normal = await Read.listPeople(db, {});
        assert.ok(!normal.people.some((p) => p.personId === B));

        const withThem = await Read.listPeople(db, {includeInactive: true});
        assert.ok(withThem.people.some((p) => p.personId === B));
    });

    test('the People list finds an elder\'s Care Group', async () => {
        await db.collection('people').doc(ELDER_PERSON).update({tags: ['Elder']});
        await Writes.setElderAssignment(db, {
            personId: A, elderPersonId: ELDER_PERSON, actor,
        });

        const group = await Read.listPeople(db, {assignedElderId: ELDER_PERSON});
        assert.strictEqual(group.count, 1);
        assert.strictEqual(group.people[0].personId, A);
    });
});
