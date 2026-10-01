const {describe, test, before} = require('node:test');
const assert = require('node:assert');

const Actor = require('../functions/mcp-actor.js');
const Read = require('../functions/shepherding-read.js');
const Writes = require('../functions/shepherding-writes.js');
const Payload = require('../functions/shepherding-payload-writes.js');
const FormsCore = require('../functions/shared/forms-core.js');

// Directory details and the form person picker, without the emulator.
//
// The protocol tests prove the tools are offered to an editor. These prove
// what a write actually stores: contact lives under `contact`, a Pastoral
// Assistant cannot set sex, and a person question stores {personId, name}
// rather than the name they typed.

const DELETE = {marker: 'delete'};
const NOW = {marker: 'now'};

function memoryDb(seed) {
    const store = JSON.parse(JSON.stringify(seed || {}));
    function ref(collection, id) {
        return {
            get: async () => {
                const bucket = store[collection] || {};
                const data = bucket[id];
                return {exists: data != null, data: () => data};
            },
            update: async (payload) => {
                if (!store[collection]) store[collection] = {};
                store[collection][id] = Object.assign({}, store[collection][id], payload);
            },
            set: async (payload) => {
                if (!store[collection]) store[collection] = {};
                store[collection][id] = payload;
            },
        };
    }
    return {
        store,
        collection(name) {
            return {
                doc: (id) => ref(name, id),
                get: async () => ({
                    docs: Object.entries(store[name] || {}).map(([id, data]) => ({
                        id,
                        data: () => data,
                    })),
                }),
            };
        },
        runTransaction: async (fn) => fn({
            get: (r) => r.get(),
            set: (r, data) => r.set(data),
        }),
    };
}

const EDITOR = {permissionLevel: 'editor'};
const PA = {permissionLevel: 'member', pastoralAssistant: true};
const MEMBER = {permissionLevel: 'member'};
const ACTOR = {uid: 'uid-1', name: 'Ada Editor', personId: 'person-ada'};

describe('directory details an assistant may change', () => {
    before(() => {
        require('../functions/mcp-firestore.js').bind({
            FieldValue: {
                serverTimestamp: () => NOW,
                delete: () => DELETE,
            },
        });
    });

    function dbWithSarah() {
        return memoryDb({
            people: {
                'person-sarah': {
                    name: 'Sarah Chen',
                    nameParts: {firstName: 'Sarah', lastName: 'Chen'},
                    contact: {email: 'sarah@example.com', phone: '555-0100', address: '1 Oak'},
                    birthday: '1990-04-02',
                    sex: 'female',
                    tags: ['Member'],
                },
            },
            people_tags: {},
        });
    }

    test('a phone change leaves the address and the name alone', async () => {
        const db = dbWithSarah();
        const result = await Writes.updatePersonDetails(db, {
            personId: 'person-sarah',
            phone: ' 555-0199 ',
            actor: ACTOR,
            account: EDITOR,
        });
        assert.equal(result.ok, true);
        assert.deepEqual(result.updated, ['phone']);
        assert.equal(result.phone, '555-0199');
        assert.equal(result.address, '1 Oak');
        assert.equal(result.email, 'sarah@example.com');
        assert.equal(result.name, 'Sarah Chen');
        const stored = db.store.people['person-sarah'];
        assert.equal(stored['contact.phone'], '555-0199');
        assert.equal(stored.contact.address, '1 Oak');
        assert.equal(stored.updatedByName, 'Ada Editor');
        assert.equal(stored.nameParts.firstName, 'Sarah');
    });

    test('an empty phone clears only the phone', async () => {
        const db = dbWithSarah();
        const result = await Writes.updatePersonDetails(db, {
            personId: 'person-sarah', phone: '', actor: ACTOR, account: EDITOR,
        });
        assert.equal(result.phone, null);
        assert.equal(db.store.people['person-sarah']['contact.phone'], '');
        assert.equal(result.address, '1 Oak');
    });

    test('a changed name clears remembered parts and does not invent a split', async () => {
        const db = dbWithSarah();
        await Writes.updatePersonDetails(db, {
            personId: 'person-sarah', name: 'Sarah C. Chen', actor: ACTOR, account: EDITOR,
        });
        const stored = db.store.people['person-sarah'];
        assert.equal(stored.name, 'Sarah C. Chen');
        assert.equal(stored.nameParts, DELETE);
    });

    test('saving the same name leaves remembered parts alone', async () => {
        const db = dbWithSarah();
        await Writes.updatePersonDetails(db, {
            personId: 'person-sarah', name: 'Sarah Chen', actor: ACTOR, account: EDITOR,
        });
        assert.equal(db.store.people['person-sarah'].nameParts.firstName, 'Sarah');
    });

    test('a blank name is refused and does not block a phone that came with it', async () => {
        const db = dbWithSarah();
        const result = await Writes.updatePersonDetails(db, {
            personId: 'person-sarah', name: '   ', phone: '555', actor: ACTOR, account: EDITOR,
        });
        assert.equal(result.ok, true);
        assert.deepEqual(result.updated, ['phone']);
        assert.equal(result.refused[0].field, 'name');
        assert.equal(db.store.people['person-sarah'].name, 'Sarah Chen');
    });

    test('a Pastoral Assistant may set a phone and sex, the same as an editor', async () => {
        const db = dbWithSarah();
        const result = await Writes.updatePersonDetails(db, {
            personId: 'person-sarah',
            phone: '555-0177',
            sex: 'male',
            kid: true,
            actor: ACTOR,
            account: PA,
        });
        assert.equal(result.ok, true);
        assert.deepEqual(result.updated.sort(), ['kid', 'phone', 'sex']);
        assert.deepEqual(result.refused, []);
        assert.equal(db.store.people['person-sarah'].sex, 'male');
        assert.equal(db.store.people['person-sarah'].kid, true);
    });

    test('sex alone, from a Pastoral Assistant, is an editorial write', async () => {
        const db = dbWithSarah();
        const result = await Writes.updatePersonDetails(db, {
            personId: 'person-sarah', sex: 'male', actor: ACTOR, account: PA,
        });
        assert.equal(result.ok, true);
        assert.deepEqual(result.updated, ['sex']);
        assert.equal(db.store.people['person-sarah'].sex, 'male');
    });

    test('an editor may set sex and the kid mark', async () => {
        const db = dbWithSarah();
        const result = await Writes.updatePersonDetails(db, {
            personId: 'person-sarah', sex: 'female', kid: true, actor: ACTOR, account: EDITOR,
        });
        assert.deepEqual(result.updated.sort(), ['kid', 'sex']);
        assert.equal(result.kid, true);
        assert.equal(db.store.people['person-sarah'].kid, true);
    });

    test('a birthday that is not a date is refused', async () => {
        const db = dbWithSarah();
        const result = await Writes.updatePersonDetails(db, {
            personId: 'person-sarah', birthday: 'April 2', actor: ACTOR, account: EDITOR,
        });
        assert.equal(result.ok, false);
        assert.match(result.refused[0].why, /date/);
        assert.equal(db.store.people['person-sarah'].birthday, '1990-04-02');
    });

    test('a member cannot edit somebody\'s directory details', async () => {
        const db = dbWithSarah();
        await assert.rejects(
            () => Writes.updatePersonDetails(db, {
                personId: 'person-sarah', phone: '1', actor: ACTOR, account: MEMBER,
            }),
            (e) => /editor/.test(e.message) && e.code === 'shepherding-refused',
        );
    });

    test('finding somebody by the phone on their contact works', async () => {
        const db = dbWithSarah();
        const byPhone = await Read.findPerson(db, {query: '555-0100'});
        assert.equal(byPhone.count, 1);
        assert.equal(byPhone.matches[0].personId, 'person-sarah');
        assert.equal(byPhone.matches[0].phone, '555-0100');
        assert.equal(byPhone.matches[0].address, '1 Oak');
        assert.ok(byPhone.matches[0].tags, 'an elder\'s search still names tags');
    });

    test('an editor\'s search has contact and no shepherding tags', async () => {
        const db = dbWithSarah();
        const found = await Read.findPerson(db, {
            query: 'Sarah', includeShepherding: false,
        });
        const row = found.matches[0];
        assert.equal(row.email, 'sarah@example.com');
        assert.equal(row.phone, '555-0100');
        assert.equal(row.tags, undefined);
        assert.equal(row.shepherdingStatus, undefined);
    });
});

describe('a form\'s person picker, answered by an assistant', () => {
    before(() => {
        require('../functions/mcp-firestore.js').bind({
            FieldValue: {
                serverTimestamp: () => NOW,
                delete: () => DELETE,
            },
        });
    });

    function formDb() {
        return memoryDb({
            people: {
                'person-sarah': {name: 'Sarah Chen', tags: ['Member'], membership: {stage: 'member'}},
                'person-tom': {name: 'Tom Hale', tags: [], membership: {stage: 'visitor'}},
            },
            elder_documents: {
                interview: {
                    docType: 'form',
                    shepherdingDoc: true,
                    ownerPersonId: 'person-sarah',
                    questions: [
                        {id: FormsCore.SUBJECT_QUESTION_ID, type: 'person', text: 'Who is this for?', required: true},
                        {id: 'q_who', type: 'person', text: 'Who invited them?', people: {scope: 'member', tagId: null}},
                        {id: 'q_story', type: 'paragraph', text: 'Their story'},
                        {id: 'q_file', type: 'file', text: 'A scan'},
                    ],
                    answers: {
                        [FormsCore.SUBJECT_QUESTION_ID]: {personId: 'person-sarah', name: 'Sarah Chen'},
                    },
                },
            },
            elder_document_structure: {
                'person_person-sarah': {children: [{type: 'document', id: 'interview'}]},
                'person_person-tom': {children: []},
            },
        });
    }

    test('a person id is stored as an id and the directory\'s name', async () => {
        const db = formDb();
        const result = await Payload.answerFormDocument(db, {
            documentId: 'interview',
            answers: {
                q_who: {personId: 'person-sarah'},
                q_story: 'Came at university.',
                q_file: 'a scan',
                q_named: 'Sarah Chen',
            },
            actor: ACTOR,
        });
        assert.ok(result.answered.includes('q_who'));
        assert.ok(result.answered.includes('q_story'));
        assert.ok(!result.answered.includes('q_file'));
        const stored = db.store.elder_documents.interview.answers;
        assert.deepEqual(stored.q_who, {personId: 'person-sarah', name: 'Sarah Chen'});
        assert.equal(stored.q_story, 'Came at university.');
        const skipped = {};
        result.skipped.forEach((s) => {
            skipped[s.questionId] = s.why;
        });
        assert.match(skipped.q_file, /upload/);
        assert.match(skipped.q_named, /does not ask/);
    });

    test('a name is not an answer, and a bare id is', async () => {
        const db = formDb();
        const named = await Payload.answerFormDocument(db, {
            documentId: 'interview',
            answers: {q_who: 'Sarah Chen'},
            actor: ACTOR,
        });
        assert.deepEqual(named.answered, []);
        assert.match(named.skipped[0].why, /person id/);
        assert.equal(db.store.elder_documents.interview.answers.q_who, undefined);

        const bare = await Payload.answerFormDocument(db, {
            documentId: 'interview',
            answers: {q_who: 'person-sarah'},
            actor: ACTOR,
        });
        assert.deepEqual(bare.answered, ['q_who']);
        assert.equal(
            db.store.elder_documents.interview.answers.q_who.name,
            'Sarah Chen',
        );
    });

    test('someone outside the question\'s scope is skipped', async () => {
        const db = formDb();
        const result = await Payload.answerFormDocument(db, {
            documentId: 'interview',
            answers: {q_who: {personId: 'person-tom'}},
            actor: ACTOR,
        });
        assert.deepEqual(result.answered, []);
        assert.match(result.skipped[0].why, /member/);
    });

    test('changing the subject files the document on that person', async () => {
        const db = formDb();
        const result = await Payload.answerFormDocument(db, {
            documentId: 'interview',
            answers: {
                [FormsCore.SUBJECT_QUESTION_ID]: {personId: 'person-tom'},
            },
            actor: ACTOR,
        });
        assert.equal(result.ownerPersonId, 'person-tom');
        const doc = db.store.elder_documents.interview;
        assert.equal(doc.ownerPersonId, 'person-tom');
        assert.equal(doc.answers[FormsCore.SUBJECT_QUESTION_ID].name, 'Tom Hale');
        const from = db.store.elder_document_structure['person_person-sarah'].children;
        const to = db.store.elder_document_structure['person_person-tom'].children;
        assert.equal(from.some((c) => c.id === 'interview'), false);
        assert.equal(to.some((c) => c.id === 'interview'), true);
    });
});

// Actor is required so a future edit that drops the gate is visible beside
// the write tests, not only in the actor suite.
test('the directory gate is the one shep_update_person is classified under', () => {
    assert.equal(Actor.gateFor('shep_update_person'), Actor.DIRECTORY);
    assert.equal(Actor.gateFor('shep_guidance'), Actor.DIRECTORY);
});
