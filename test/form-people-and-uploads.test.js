const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-390 — answering with a person or a file, and reading it back.
//
// ⚠ The finding that shaped this: the fill-in page has NO FIRESTORE AT ALL.
// That is ADR-0051, and it is the whole reason a stranger can answer a form
// safely. So a Directory Person picker cannot read the directory — the list
// arrives through the same closed door as the questions, already narrowed by
// each question's scope.
//
// That turned out to be the stronger design as well as the only workable one:
// people a scope excludes are never sent, so a tag's membership cannot be read
// out of a network response by somebody who was only shown a search box.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const fp = require('../functions/forms-public.js');
const FormsCore = require('../public/forms-core.js');
const ANSWER_JS = read('public', 'form-answer.js');
const BUILDER_JS = read('public', 'form.js');
const BUILDER_HTML = read('public', 'form.html');
const CONTROLS = require('../public/form-question-markup.js').QUESTION_CONTROLS;

const directory = () => [
    { id: 'p1', name: 'Rebecca Hall', isMember: true, tagIds: ['worship'] },
    { id: 'p2', name: 'Sam Okoro', isMember: true, tagIds: ['elders'] },
    { id: 'p3', name: 'Casey New', isMember: false, tagIds: [] },
];

const withPicker = (scope, tagId) => FormsCore.buildFormTemplate({
    rung: 'member',
    questions: [{
        id: 'who', type: 'person', text: 'Who referred you?',
        people: { scope: scope, tagId: tagId },
    }],
});

// ── The list is narrowed on the server ───────────────────────────────────────

test('everyone means everyone', () => {
    const choices = fp.pickerChoices(withPicker('everyone'), directory());
    assert.deepEqual(choices.who.map(p => p.id), ['p1', 'p2', 'p3']);
});

test('a members scope leaves out the people who are not', () => {
    const choices = fp.pickerChoices(withPicker('member'), directory());
    assert.deepEqual(choices.who.map(p => p.id), ['p1', 'p2']);
});

test('a non-members scope is the other half', () => {
    const choices = fp.pickerChoices(withPicker('non_member'), directory());
    assert.deepEqual(choices.who.map(p => p.id), ['p3']);
});

test('a tag scope offers only its carriers', () => {
    const choices = fp.pickerChoices(withPicker('tag', 'worship'), directory());
    assert.deepEqual(choices.who.map(p => p.id), ['p1']);
});

test('nobody outside the scope is sent at all', () => {
    // The point of filtering on the server. If the whole directory were sent
    // and narrowed in the browser, a tag's membership would sit in a network
    // response for anybody who opened the form.
    const choices = fp.pickerChoices(withPicker('tag', 'elders'), directory());
    assert.strictEqual(JSON.stringify(choices).includes('Rebecca'), false,
        'somebody outside the scope was sent to the browser');
    assert.strictEqual(JSON.stringify(choices).includes('Casey'), false);
});

test('only an id and a name leave the server', () => {
    const choices = fp.pickerChoices(withPicker('everyone'), directory());
    assert.deepEqual(Object.keys(choices.who[0]).sort(), ['id', 'name'],
        'something other than a name and an id about a Person reached a form');
});

test('a form with no picker sends no people', () => {
    const plain = FormsCore.buildFormTemplate({
        rung: 'member', questions: [{ id: 'q1', type: 'short_text', text: 'Name' }],
    });
    assert.deepEqual(fp.pickerChoices(plain, directory()), {});
});

test('a retired picker is not served either', () => {
    const form = FormsCore.buildFormTemplate({
        rung: 'member',
        questions: [{ id: 'who', type: 'person', text: 'Who?', retired: true }],
    });
    assert.deepEqual(fp.pickerChoices(form, directory()), {});
});

// ── The page never reaches for the database ──────────────────────────────────

test('the fill-in page still touches no Firestore', () => {
    // The line that would undo ADR-0051. It has never had a Firestore handle
    // and must not grow one to make a picker work.
    assert.ok(!ANSWER_JS.includes("db.collection("),
        'the page a stranger answers on now reads Firestore directly');
    assert.match(ANSWER_JS, /pickerPeople/, 'the picker list is not coming from the server');
});

test('the page searches within what it was given, and does not re-scope', () => {
    // Re-applying the scope in the browser would imply the browser had the
    // people it was meant to exclude.
    const fn = ANSWER_JS.match(/personChoices\(q\) \{[\s\S]*?\n            \},/);
    assert.ok(fn, 'personChoices has gone missing');
    assert.ok(!fn[0].includes('isMember'),
        'the page is filtering by membership, which means it was sent everybody');
    assert.ok(!fn[0].includes('tagIds'),
        'the page is filtering by tag, which means it was sent the tag\'s carriers');
});

// ── Picking somebody ─────────────────────────────────────────────────────────

test('a picked person is stored as an id and a name', () => {
    // The id joins up with the directory; the name keeps the Response readable
    // after a rename or a removal, like a Form Document's question snapshot.
    const fn = BUILDER_JS.includes('pickPerson') || ANSWER_JS.includes('pickPerson');
    assert.ok(fn, 'nothing records a picked person');
    assert.match(ANSWER_JS, /personId: person\.id, name: person\.name/);
});

test('the picker shows who was picked, with a way to change it', () => {
    assert.match(CONTROLS, /answers\[q\.id\] && answers\[q\.id\]\.personId/);
    assert.match(CONTROLS, /Change<\/button>/,
        'a picker that hides its own answer is one people re-pick to check');
});

// ── Choosing a file ──────────────────────────────────────────────────────────

test('an image question asks for the camera on a phone', () => {
    assert.match(CONTROLS, /:capture="q\.type === 'image' \? 'environment' : undefined"/);
    assert.match(CONTROLS, /:accept="q\.type === 'image' \? 'image\/\*' : undefined"/,
        'a file question should take any type; only the image one narrows');
});

test('a file too big is refused before the upload starts', () => {
    // Checked on the page as a courtesy so nobody waits through an upload to be
    // told no. The function checks it again, because on a public form this page
    // is one we do not control.
    const fn = ANSWER_JS.match(/onFileChosen\(q, ev\) \{[\s\S]*?\n            \},/);
    assert.ok(fn, 'onFileChosen has gone missing');
    assert.match(fn[0], /FormsCore\.uploadFault\(file\)/);
    assert.match(fn[0], /this\.fileFaults\[q\.id\] = fault/);
});

test('the bytes ride with the submission rather than going up on their own', () => {
    // A file and the answer it belongs to are accepted or refused together.
    assert.match(ANSWER_JS, /files: this\.files/);
});

// ── The builder ──────────────────────────────────────────────────────────────

test('the builder offers a scope, and only offerable tags', () => {
    assert.match(BUILDER_HTML, /x-model="q\.people\.scope"/);
    assert.match(BUILDER_JS, /get scopeTags\(\)[\s\S]*?offerableTags/,
        'the tag list is not filtered through the model');
});

test('public is refused while a picker is on the form, with the reason shown', () => {
    assert.match(BUILDER_HTML, /:disabled="r === 'public' && !publicCheck\.ok"/);
    assert.match(BUILDER_HTML, /x-text="publicCheck\.why"/,
        'a greyed button with no reason is one people work around');
});

test('adding a picker to a public form moves the rung and says so', () => {
    const fn = BUILDER_JS.match(/onTypeChange\(q\) \{[\s\S]*?\n        \},/);
    assert.ok(fn, 'onTypeChange has gone missing');
    assert.match(fn[0], /Moved to Members/);
});

// ── Reading it back ──────────────────────────────────────────────────────────

test('an upload is opened by fetching it, never by a link', () => {
    const fn = BUILDER_JS.match(/async openUpload\(entry\) \{[\s\S]*?\n        \},/);
    assert.ok(fn, 'openUpload has gone missing');
    assert.match(fn[0], /getBlob\(\)/, 'the bytes should be fetched as the reader');
    assert.ok(!fn[0].includes('getDownloadURL'),
        'one forwarded link would make an editors-only file public for ever');
    assert.match(fn[0], /revokeObjectURL/,
        'the temporary blob URL is never cleaned up');
});

test('the Responses tab lists people and files rather than tallying them', () => {
    assert.match(BUILDER_HTML, /row\.entries/,
        'the Responses tab does not read the entries the model returns for these');
    assert.match(BUILDER_HTML, /openUpload\(e\)/);
});
