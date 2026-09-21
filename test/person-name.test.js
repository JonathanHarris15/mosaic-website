const { test } = require('node:test');
const assert = require('node:assert');

const Name = require('../public/person-name.js');

// A name is entered as a first name, a last name, and an optional suffix.
// The full name is those parts in that order. The last name is what a
// Household is called after. A suffix never is. (ADR 0067, MS-609)

test('Jonathan / Harris / Jr. is the full name Jonathan Harris Jr.', () => {
    const entered = Name.enteredName({
        firstName: 'Jonathan',
        lastName: 'Harris',
        suffix: 'Jr.',
    });
    assert.strictEqual(entered.fault, '');
    assert.strictEqual(entered.empty, false);
    assert.strictEqual(entered.name, 'Jonathan Harris Jr.');
    assert.deepStrictEqual(entered.parts, {
        firstName: 'Jonathan',
        lastName: 'Harris',
        suffix: 'Jr.',
        noLastName: false,
    });
});

test('a suffix may be empty, and the full name skips that blank', () => {
    const entered = Name.enteredName({ firstName: 'Ada', lastName: 'Cole', suffix: '   ' });
    assert.strictEqual(entered.name, 'Ada Cole');
    assert.strictEqual(entered.parts.suffix, '');
});

test('whitespace-only parts are empty, and a spare row is ignored', () => {
    const entered = Name.enteredName({ firstName: '  ', lastName: ' ', suffix: '' });
    assert.strictEqual(entered.empty, true);
    assert.strictEqual(entered.fault, '');
    assert.strictEqual(entered.name, '');
    assert.strictEqual(entered.parts, null);
});

test('a new person with no first name is refused', () => {
    const lastOnly = Name.enteredName({ firstName: '', lastName: 'Harris', suffix: '' });
    assert.strictEqual(lastOnly.empty, false);
    assert.strictEqual(lastOnly.fault, 'A new person needs a first name.');
    const suffixOnly = Name.enteredName({ firstName: '', lastName: '', suffix: 'Jr.' });
    assert.strictEqual(suffixOnly.fault, 'A new person needs a first name.');
});

test('a new person with no last name is refused unless they have no last name', () => {
    const missing = Name.enteredName({ firstName: 'Ada', lastName: '  ', suffix: '' });
    assert.strictEqual(missing.fault, 'A new person needs a last name, or mark that they have none.');
    const passed = Name.enteredName({ firstName: 'Ada', lastName: '', suffix: '', noLastName: true });
    assert.strictEqual(passed.fault, '');
    assert.strictEqual(passed.name, 'Ada');
    assert.strictEqual(passed.parts.noLastName, true);
    assert.strictEqual(passed.parts.lastName, '');
});

test('a person marked no last name keeps a suffix and does not gain a surname', () => {
    const entered = Name.enteredName({
        firstName: 'Ada',
        lastName: 'Harris',
        suffix: 'Jr.',
        noLastName: true,
    });
    assert.strictEqual(entered.name, 'Ada Jr.');
    assert.strictEqual(entered.parts.lastName, '');
    assert.strictEqual(entered.parts.noLastName, true);
});

test('Jonathan / Harris / Jr. suggests The Harris Household, not The Jr. Household', () => {
    const name = Name.householdName([{
        firstName: 'Jonathan',
        lastName: 'Harris',
        suffix: 'Jr.',
        kid: false,
    }]);
    assert.strictEqual(name, 'The Harris Household');
});

test('the first adult\'s last name wins over a child\'s', () => {
    const name = Name.householdName([
        { firstName: 'Sam', lastName: 'Nguyen', kid: true },
        { firstName: 'Ada', lastName: 'Harris', kid: false },
    ]);
    assert.strictEqual(name, 'The Harris Household');
});

test('a household of only children takes the first child\'s last name', () => {
    const name = Name.householdName([
        { firstName: 'Sam', lastName: 'Nguyen', kid: true },
        { firstName: 'Jo', lastName: 'Harris', kid: true },
    ]);
    assert.strictEqual(name, 'The Nguyen Household');
});

test('an adult with no last name does not block a later last name', () => {
    const name = Name.householdName([
        { firstName: 'Ada', noLastName: true, kid: false },
        { firstName: 'Sam', lastName: 'Harris', kid: true },
    ]);
    assert.strictEqual(name, 'The Harris Household');
});

test('nobody with a last name suggests A Household, and a mononym is not a surname', () => {
    const name = Name.householdName([
        { firstName: 'Ada', noLastName: true, kid: false },
    ]);
    assert.strictEqual(name, 'A Household');
});

test('a person who only has a full name still suggests from its last word', () => {
    const name = Name.householdName([
        { name: 'Jonathan Harris Jr.', kid: false },
    ]);
    assert.strictEqual(name, 'The Jr. Household');
});

test('a remembered last name wins over the last word of the full name', () => {
    const name = Name.householdName([
        {
            name: 'Jonathan Harris Jr.',
            lastName: 'Harris',
            noLastName: false,
            kid: false,
        },
    ]);
    assert.strictEqual(name, 'The Harris Household');
});

test('a household name the greeter already changed is left alone', () => {
    const kept = Name.householdNameForDraft(
        [
            { firstName: 'Jonathan', lastName: 'Harris', suffix: 'Jr.', kid: false },
            { firstName: 'Ruth', lastName: 'Nguyen', kid: false },
        ],
        'The Okafor Household',
        'The Harris Household'
    );
    assert.strictEqual(kept.name, 'The Okafor Household');
    assert.strictEqual(kept.suggestion, 'The Harris Household');
});

test('a household name still equal to the suggestion follows the next last name', () => {
    const next = Name.householdNameForDraft(
        [{ firstName: 'Ruth', lastName: 'Nguyen', kid: false }],
        'The Harris Household',
        'The Harris Household'
    );
    assert.strictEqual(next.name, 'The Nguyen Household');
    assert.strictEqual(next.suggestion, 'The Nguyen Household');
});

test('adding people does not produce a new household name', () => {
    const kept = Name.householdNameForDraft(
        [{ firstName: 'Ruth', lastName: 'Nguyen', kid: false }],
        'The Harris Household',
        'The Harris Household',
        { adding: true }
    );
    assert.strictEqual(kept.name, 'The Harris Household');
});

test('saving an unsplit person with the blanks empty leaves the full name and writes no parts', () => {
    const saved = Name.saveExisting(
        { name: 'Jonathan Harris Jr.' },
        { firstName: '', lastName: '', suffix: '', noLastName: false }
    );
    assert.strictEqual(saved.fault, '');
    assert.strictEqual(saved.name, 'Jonathan Harris Jr.');
    assert.strictEqual(saved.writeParts, false);
});

test('filling Jonathan / Harris / Jr. replaces the full name and remembers the parts', () => {
    const saved = Name.saveExisting(
        { name: 'Jonathan Harris Jr.' },
        { firstName: 'Jonathan', lastName: 'Harris', suffix: 'Jr.' }
    );
    assert.strictEqual(saved.fault, '');
    assert.strictEqual(saved.name, 'Jonathan Harris Jr.');
    assert.strictEqual(saved.writeParts, true);
    assert.deepStrictEqual(saved.nameParts, {
        firstName: 'Jonathan',
        lastName: 'Harris',
        suffix: 'Jr.',
        noLastName: false,
    });
});

test('reopening a person whose name was never split shows the three blanks empty', () => {
    assert.deepStrictEqual(Name.blanksFor({ name: 'Jonathan Harris Jr.' }), {
        firstName: '',
        lastName: '',
        suffix: '',
        noLastName: false,
    });
});

test('reopening a person entered in parts shows those three blanks', () => {
    assert.deepStrictEqual(Name.blanksFor({
        name: 'Jonathan Harris Jr.',
        nameParts: { firstName: 'Jonathan', lastName: 'Harris', suffix: 'Jr.', noLastName: false },
    }), {
        firstName: 'Jonathan',
        lastName: 'Harris',
        suffix: 'Jr.',
        noLastName: false,
    });
});

test('a new directory person needs a first name and a last name unless they have none', () => {
    assert.strictEqual(Name.fieldsForNewPerson({ firstName: '', lastName: '' }).fault,
        'A new person needs a first name.');
    assert.strictEqual(
        Name.fieldsForNewPerson({ firstName: 'Ada', lastName: '' }).fault,
        'A new person needs a last name, or mark that they have none.'
    );
    const fields = Name.fieldsForNewPerson({ firstName: 'Ada', noLastName: true });
    assert.strictEqual(fields.fault, '');
    assert.strictEqual(fields.name, 'Ada');
    assert.strictEqual(fields.nameParts.noLastName, true);
    assert.strictEqual(fields.firstName, undefined);
    assert.strictEqual(fields.lastName, undefined);
});
