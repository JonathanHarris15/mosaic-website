const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-403 — adding somebody to the directory from a form's person picker.
//
// The card gathers and tidies; it never writes. Two pages mount it and they
// reach the directory through genuinely different doors — the elder's Form
// Document writes `people` as a signed-in elder, the fill-in page has no
// Firestore at all (ADR-0051) and goes through the one callable it may call.
// So what is pinned here is that the card stays a gatherer: it hands details
// to whatever door its host gave it, and it does the right thing with a door
// that refuses.

const Card = require('../public/new-person-card.js');
const ROOT = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, 'public', name), 'utf8').replace(/\r\n/g, '\n');

// A host: the two members the card is owed, and a record of what it was asked.
function host(create) {
    const picked = [];
    const page = Object.assign(Card.state(), {
        createPerson: create,
        pickPerson(q, person) { picked.push({ q: q, person: person }); },
    });
    return { page, picked };
}

// ── What goes to the door ────────────────────────────────────────────────────

test('what was typed is trimmed, and a contact is three keys even when it is empty', () => {
    const d = Card.tidy({ name: '  Jane Example ', email: ' j@e.org ' });
    assert.equal(d.name, 'Jane Example');
    assert.equal(d.email, 'j@e.org');
    assert.deepEqual(Object.keys(d).sort(), ['address', 'birthday', 'email', 'name', 'phone', 'sex']);
});

test('a sex the card never offers is dropped rather than sent on', () => {
    assert.equal(Card.tidy({ name: 'A', sex: 'other' }).sex, '');
    assert.equal(Card.tidy({ name: 'A', sex: 'female' }).sex, 'female');
});

test('a name is the only thing the card refuses on its own', () => {
    assert.equal(Card.whatIsWrong({ name: '' }), 'They need a name.');
    assert.equal(Card.whatIsWrong(Card.tidy({ name: 'Jane' })), '');
    assert.match(Card.whatIsWrong({ name: 'Jane', birthday: 'May' }), /not a date/);
});

// ── Filling it in ────────────────────────────────────────────────────────────

test('it opens on the name already typed into the picker, so nobody types it twice', () => {
    const { page } = host(async () => ({ id: 'p1', name: 'Jane' }));
    page.openNewPerson({ id: 'q1' }, '  Jane Example  ');
    assert.equal(page.newPerson.open, true);
    assert.equal(page.newPerson.name, 'Jane Example');
    assert.deepEqual(page.newPerson.question, { id: 'q1' });
});

test('adding them answers the question they were added from, and shuts the card', async () => {
    const asked = [];
    const { page, picked } = host(async (details) => {
        asked.push(details);
        return { id: 'p9', name: details.name };
    });
    page.openNewPerson({ id: 'q1' }, 'Jane Example');
    page.newPerson.phone = ' 555 1234 ';
    await page.saveNewPerson();

    assert.equal(asked.length, 1);
    assert.equal(asked[0].name, 'Jane Example');
    assert.equal(asked[0].phone, '555 1234', 'the door was handed untidied fields');
    assert.equal(page.newPerson.open, false, 'the card stayed open after it worked');
    assert.deepEqual(picked, [{ q: { id: 'q1' }, person: { id: 'p9', name: 'Jane Example' } }]);
});

test('a door that refuses leaves the card open with what they typed and the reason', async () => {
    const { page, picked } = host(async () => { throw new Error('Only an editor can add somebody.'); });
    page.openNewPerson({ id: 'q1' }, 'Jane Example');
    page.newPerson.email = 'j@e.org';
    await page.saveNewPerson();

    assert.equal(page.newPerson.open, true, 'the card threw away what they had typed');
    assert.equal(page.newPerson.email, 'j@e.org');
    assert.equal(page.newPerson.busy, false, 'the Add button would still be dead');
    assert.equal(page.newPerson.problem, 'Only an editor can add somebody.');
    assert.deepEqual(picked, [], 'a refused add still answered the question');
});

test('a blank name never reaches the door', async () => {
    let knocked = 0;
    const { page } = host(async () => { knocked += 1; return { id: 'p1', name: '' }; });
    page.openNewPerson({ id: 'q1' }, '   ');
    await page.saveNewPerson();
    assert.equal(knocked, 0);
    assert.equal(page.newPerson.problem, 'They need a name.');
    assert.equal(page.newPerson.open, true);
});

test('a door that answers with nothing is a failure, not a silent success', async () => {
    const { page, picked } = host(async () => null);
    page.openNewPerson({ id: 'q1' }, 'Jane');
    await page.saveNewPerson();
    assert.equal(page.newPerson.open, true);
    assert.deepEqual(picked, []);
});

test('Cancel while it is saving does nothing, so an add cannot be half undone', () => {
    const { page } = host(async () => ({ id: 'p1', name: 'Jane' }));
    page.openNewPerson({ id: 'q1' }, 'Jane');
    page.newPerson.busy = true;
    page.closeNewPerson();
    assert.equal(page.newPerson.open, true);
});

// ── Mounted, and styled ──────────────────────────────────────────────────────

test('both pages that draw a question leave a slot for the card and fill it', () => {
    ['form-answer.html', 'shepherding-form-document.html'].forEach(page => {
        const html = read(page);
        assert.ok(html.includes('data-new-person-card'), page + ' has no slot for the card');
        assert.ok(html.includes('NewPersonCard.mount()'), page + ' never fills it');
        assert.ok(html.includes('new-person-card.js'), page + ' never loads it');
        assert.ok(html.includes('form-question.css'), page + ' draws the picker unstyled');
    });
});

test('the card is drawn from the fields, not from a stylesheet nobody wrote', () => {
    const css = read('form-question.css');
    ['np-veil', 'np-card', 'np-f', 'fa-person__drop', 'fa-person__opt--new'].forEach(cls => {
        assert.ok(css.includes('.' + cls), 'no styles for .' + cls);
    });
});
