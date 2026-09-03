const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-383 — one implementation of a question, drawn on two surfaces.
//
// A stranger answering a public form and an elder filling in a Form Document
// are looking at the same questions. A date is a date control on both; a
// multiple choice shows every option with the chosen one marked on both.
//
// ⚠ The usual way to share "how something looks" here is a `*-view.js` that
// returns data for each page to render (trades-view.js). That is right when the
// decisions are hard and the markup is trivial. This is the other way round —
// the decision is a switch on a type, and the MARKUP is where the detail lives:
// the wrapping scale row, the 44px targets, the option that shows it was
// picked. A view model would have left all of that written twice, which is the
// duplication this sub-task exists to remove.
//
// So the markup is the shared thing, and these tests pin that it stays shared.

const ROOT = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, 'public', name), 'utf8').replace(/\r\n/g, '\n');

const Markup = require('../public/form-question-markup.js');
const FormsCore = require('../public/forms-core.js');
const ANSWER = read('form-answer.html');

// ── Every question that asks something has something to ask with ─────────────

test('every live question type has a control in the shared markup', () => {
    FormsCore.QUESTION_TYPES.filter(t => t.live && FormsCore.asksSomething(t.id)).forEach(t => {
        assert.ok(Markup.QUESTION_CONTROLS.includes("q.type === '" + t.id + "'"),
            t.id + ' is live but has nothing to answer it with');
    });
});

test('a section heading has no control, because it asks nothing', () => {
    assert.ok(!Markup.QUESTION_CONTROLS.includes("q.type === 'section'"),
        'a heading collects no answer, so it needs no input');
});

test('the types that are not live yet have no control either', () => {
    // They are named in the picker and greyed. A control here would be a
    // half-built question type that looks finished. MS-388 lit image, file and
    // person; payment alone is left, and it is MS-364.
    ['payment'].forEach(id => {
        assert.ok(!Markup.QUESTION_CONTROLS.includes("q.type === '" + id + "'"),
            id + ' has a control before its ticket has been built');
    });
});

test('a multiple choice draws every option, and says which was picked', () => {
    // The thing that makes a filled-in form readable as a record: you can see
    // what was asked, not only what was answered.
    assert.match(Markup.QUESTION_CONTROLS, /x-for="opt in \(q\.options \|\| \[\]\)"/);
    assert.match(Markup.QUESTION_CONTROLS, /m-option--picked/);
});

test('the scale draws its ends and its points', () => {
    assert.match(Markup.QUESTION_CONTROLS, /scalePoints\(q\)/);
    assert.match(Markup.QUESTION_CONTROLS, /minLabel/);
    assert.match(Markup.QUESTION_CONTROLS, /maxLabel/);
});

// ── It is genuinely shared, not copied ───────────────────────────────────────

test('the fill-in page mounts the shared controls instead of holding its own', () => {
    assert.match(ANSWER, /data-form-question/, 'the fill-in page has no mount point');
    assert.match(ANSWER, /form-question-markup\.js/, 'the fill-in page does not load the shared markup');

    // The controls must not ALSO be inline. If they are, the two copies will
    // drift and this whole sub-task bought nothing.
    ['choice_many', 'dropdown', 'number', 'scale', 'date', 'time'].forEach(type => {
        assert.ok(!ANSWER.includes("q.type === '" + type + "'"),
            'the fill-in page still has its own ' + type + ' control');
    });
});

test('the markup is mounted before Alpine, or it is never seen', () => {
    // Alpine walks the DOM once at startup. Markup injected afterwards gets no
    // bindings and no error — a question with no control and nothing to say why.
    const mountAt = ANSWER.indexOf('FormQuestionMarkup.mount()');
    const alpineAt = ANSWER.indexOf('alpine-3.15.12.min.js');
    assert.ok(mountAt !== -1, 'nothing mounts the shared markup');
    assert.ok(mountAt < alpineAt, 'the markup is mounted after Alpine has already walked the DOM');
});

test('the fill-in page provides everything the markup asks of a host', () => {
    // The markup binds to these four. A page that mounts it and does not own
    // them renders a question that silently does nothing.
    const page = read('form-answer.js');
    assert.match(page, /saidBefore\(q, opt\)/, 'saidBefore is owed and missing');
    assert.match(page, /scalePoints\(q\)/, 'scalePoints is owed and missing');
    assert.match(page, /answers:/, 'answers is owed and missing');
});

// ── Mounting ─────────────────────────────────────────────────────────────────

test('mounting fills every slot on the page, and reports how many', () => {
    const slots = [{ innerHTML: '' }, { innerHTML: '' }];
    const fakeDoc = { querySelectorAll: () => ({ forEach: (fn) => slots.forEach(fn) }) };
    const filled = Markup.mount(fakeDoc);
    assert.strictEqual(filled, 2);
    slots.forEach(slot => {
        assert.ok(slot.innerHTML.includes("q.type === 'date'"), 'a slot was left empty');
    });
});

test('mounting into nothing is not an error', () => {
    // A page that loads the module without a slot is odd, not broken.
    const fakeDoc = { querySelectorAll: () => ({ forEach: () => {} }) };
    assert.strictEqual(Markup.mount(fakeDoc), 0);
});
