const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PersonPicker = require('../public/person-picker.js');

// The shared Person Picker — one way to choose somebody, instead of the bare
// <select> here and type-ahead there that the app had grown.
//
// Two halves are worth pinning. The MIXIN is pure and can simply be driven. The
// MARKUP is a string, and there is no DOM in this suite, so it is checked as a
// string — which is enough to catch the two ways it actually breaks: a host's
// label carrying an apostrophe into an Alpine expression, and the contract with
// the host component drifting.

// ── The behaviour ────────────────────────────────────────────────────────────

const PEOPLE = [
    { id: 'a', name: 'John Piper' },
    { id: 'b', name: 'Sam Crites' },
    { id: 'c', name: 'Keegan Meyn' },
];

// A host component, folded together the way the docstring says to.
function host(over) {
    return Object.defineProperties(Object.assign({
        people: PEOPLE,
        chosen: '',
        get ppPeople() { return this.people; },
        get ppSelectedId() { return this.chosen; },
        ppSelect(person) { this.chosen = person ? person.id : ''; },
        $nextTick(fn) { fn(); },
        $refs: {},
    }, over || {}), Object.getOwnPropertyDescriptors(PersonPicker.mixin()));
}

test('the mixin leaves the host half of the contract alone', () => {
    const m = PersonPicker.mixin();
    ['ppPeople', 'ppSelectedId', 'ppSelect'].forEach((key) => {
        assert.ok(!(key in m),
            `the mixin defines ${key}, so it would win over the host's own`);
    });
});

test('composing keeps the host getters live rather than freezing them', () => {
    const h = host();
    h.people = [{ id: 'z', name: 'Somebody Else' }];
    assert.deepStrictEqual(h.ppOptions.map(p => p.name), ['Somebody Else'],
        'spread would have frozen the list at its page-load value');
});

test('typing narrows the list', () => {
    const h = host();
    h.pp.query = 'crit';
    assert.deepStrictEqual(h.ppOptions.map(p => p.id), ['b']);
});

test('choosing tells the host, and the trigger says who it is', () => {
    const h = host();
    h.ppChoose(PEOPLE[0]);
    assert.strictEqual(h.chosen, 'a');
    assert.strictEqual(h.ppSelectedName, 'John Piper');
    assert.strictEqual(h.ppInitials(h.ppSelectedName), 'JP');
    assert.strictEqual(h.pp.open, false, 'choosing closes it');
});

test('nobody is a choice, not a blank', () => {
    const h = host({ chosen: 'a' });
    h.ppChoose(null);
    assert.strictEqual(h.chosen, '');
    assert.strictEqual(h.ppSelectedName, '');
});

test('a chosen person who has left the directory still reads as chosen', () => {
    const h = host({ chosen: 'gone' });
    assert.strictEqual(h.ppSelectedName, 'Someone',
        'drawing it as empty would look like nobody was ever chosen');
});

test('the keyboard walks the list and wraps', () => {
    const h = host();
    h.ppMove(-1);
    assert.strictEqual(h.pp.index, PEOPLE.length - 1);
    h.ppMove(1);
    assert.strictEqual(h.pp.index, 0);
    h.ppChooseHighlighted();
    assert.strictEqual(h.chosen, 'a');
});

test('enter on an empty list chooses nothing rather than throwing', () => {
    const h = host({ people: [] });
    h.ppChooseHighlighted();
    assert.strictEqual(h.chosen, '');
});

test('a host that forgets its half gets an empty picker, not a broken page', () => {
    const bare = Object.defineProperties({}, Object.getOwnPropertyDescriptors(PersonPicker.mixin()));
    assert.deepStrictEqual(bare.ppOptions, []);
    assert.strictEqual(bare.ppSelectedName, '');
    assert.doesNotThrow(() => bare.ppChoose(PEOPLE[0]));
});

// ── The markup ───────────────────────────────────────────────────────────────

test("a label's apostrophe cannot break the expression it lands in", () => {
    const html = PersonPicker.markup({
        label: "Who it's for", hint: '', empty: "Nobody in part'cular", allowNobody: true,
    });
    assert.match(html, /x-text="ppSelectedName \|\| 'Nobody in part\\'cular'"/,
        'the empty text goes into an Alpine expression and has to be escaped for it');
    assert.match(html, /Who it's for/);
});

test('a label cannot inject markup of its own', () => {
    const html = PersonPicker.markup({ label: '<script>x</script>', empty: 'None' });
    assert.doesNotMatch(html, /<script>x<\/script>/);
    assert.match(html, /&lt;script&gt;/);
});

test('a required picker offers no way to choose nobody', () => {
    const optional = PersonPicker.markup({ empty: 'Nobody in particular', allowNobody: true });
    const required = PersonPicker.markup({ empty: 'Choose someone…', allowNobody: false });
    assert.match(optional, /ppChoose\(null\)/);
    assert.doesNotMatch(required, /ppChoose\(null\)/);
});

// ── The pages that mount it ──────────────────────────────────────────────────
//
// ⚠ THE SCRIPT TAG IS THE WHOLE THING. The markup is injected at load, so a page
// carrying a placeholder and no <script> renders a blank gap where the picker
// should be — and nothing throws to say so.

const PUBLIC = path.join(__dirname, '..', 'public');

test('every page with a placeholder loads the picker', () => {
    const pages = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html'));
    const hosts = pages.filter(f => fs.readFileSync(path.join(PUBLIC, f), 'utf8').includes('data-person-picker'));
    assert.ok(hosts.length, 'nothing mounts the picker');
    hosts.forEach((file) => {
        const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
        assert.match(html, /<script src="person-picker\.js"><\/script>/,
            `${file} has a picker placeholder but never loads person-picker.js`);
        assert.ok(html.indexOf('data-person-picker') < html.indexOf('src="person-picker.js"'),
            `${file} loads the picker before its placeholder exists, so nothing is filled in`);
    });
});

test('the injector reaches inside a template, because a tab is one', () => {
    const source = fs.readFileSync(path.join(PUBLIC, 'person-picker.js'), 'utf8');
    assert.match(source, /querySelectorAll\('template'\)/,
        'Alpine x-if is a <template>, and its children are invisible to a plain query');
    assert.match(source, /t\.content/);
});
