const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const Roles = require('../public/roles-core.js');

// Role descriptions (MS-222).
//
// A Role's name is a label — "Setup", "Kids Helper" — and a label is not an
// answer to "what am I meant to do?". The description is that answer, written
// once by an editor on the Role and read by whoever is down for it.
//
// One field of plain prose, deliberately. The moment it has structure it wants
// a screen of its own, and the thing worth having is the sentence the Role's
// organiser would say if you asked them in the corridor.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const coffee = extra => Object.assign({
    name: 'Coffee', slug: 'coffee', family: Roles.FAMILIES.SERVANT,
    slots: [{ id: 's1', requirement: Roles.REQUIREMENTS.EITHER }],
    restrictions: [],
}, extra || {});

// ── Reading one ──────────────────────────────────────────────────────────────

test('a description is whatever the editor wrote', () => {
    assert.equal(
        Roles.descriptionOf(coffee({ description: 'Urns on by 9:15.' })),
        'Urns on by 9:15.'
    );
});

test('absent and empty read the same, so no screen has to tell them apart', () => {
    // A row asking "is there a description" must get one answer, not three.
    assert.equal(Roles.descriptionOf(coffee()), null);
    assert.equal(Roles.descriptionOf(coffee({ description: '' })), null);
    assert.equal(Roles.descriptionOf(coffee({ description: '   \n  ' })), null);
    assert.equal(Roles.descriptionOf(null), null);
    assert.equal(Roles.descriptionOf(undefined), null);
});

test('a description is trimmed, so trailing space is never rendered', () => {
    assert.equal(Roles.descriptionOf(coffee({ description: '  Urns on.  ' })), 'Urns on.');
});

test('a description that is not a string is no description', () => {
    // /roles is editor-writable by hand, so a number or an object can arrive.
    [42, {}, [], true].forEach(junk => {
        assert.equal(Roles.descriptionOf(coffee({ description: junk })), null);
    });
});

// ── Writing one ──────────────────────────────────────────────────────────────

test('a new Role starts with an empty description, not an absent one', () => {
    // Written explicitly so the form has something to bind to, the same reason
    // intensity and exclusivity are.
    assert.equal(Roles.newDefinition('Setup').description, '');
});

test('a Role with no description is still valid', () => {
    assert.equal(Roles.validateDefinition(coffee()).valid, true);
    assert.equal(Roles.validateDefinition(coffee({ description: '' })).valid, true);
});

test('a description longer than the cap is refused', () => {
    // ⚠ THE CAP IS IN THE MODEL, not in the textarea. A Role is editable
    // through /roles by hand, and a wall of text would run down every
    // Commitments row that shows it.
    const long = 'x'.repeat(Roles.MAX_DESCRIPTION + 1);
    const verdict = Roles.validateDefinition(coffee({ description: long }));
    assert.equal(verdict.valid, false);
    assert.match(verdict.errors.join(' '), /at most/i);

    const atCap = 'x'.repeat(Roles.MAX_DESCRIPTION);
    assert.equal(Roles.validateDefinition(coffee({ description: atCap })).valid, true);
});

test('the cap counts what would be stored, not what was typed', () => {
    // Trailing whitespace is trimmed before it is written, so it must not be
    // what pushes a description over.
    const padded = '  ' + 'x'.repeat(Roles.MAX_DESCRIPTION) + '   ';
    assert.equal(Roles.validateDefinition(coffee({ description: padded })).valid, true);
});

// ── Where it is written, and where it is read ────────────────────────────────

test('the Roles Manager offers the field, capped by the model\'s own number', () => {
    const js = read('public', 'roles-manager.js');
    const html = read('public', 'roles-manager.html');

    assert.match(html, /x-model="draft\.description"/, 'the Role editor has no description field');
    assert.match(html, /:maxlength="descriptionLimit"/, 'the box is not capped');
    assert.match(js, /RolesCore\.MAX_DESCRIPTION/,
        'the page invented its own cap instead of reading the model\'s');
});

test('a member reads it beside the date they are down for', () => {
    const js = read('public', 'commitments.js');
    const html = read('public', 'commitments.html');

    assert.match(js, /descriptionFor\(r\.roleSlug\)/, 'the row carries no description');
    assert.match(js, /RolesCore\.descriptionOf/,
        'the page decides for itself what counts as a description');
    assert.match(html, /x-text="row\.description"/, 'nothing renders it');
    assert.match(html, /x-show="row\.description"/,
        'a Role with nothing written would leave an empty line');
});

test('a Role with no definition simply has none', () => {
    // A one-off Role is a label and some people, with no definition to carry a
    // description — which is the whole point of a one-off (ADR-0018 §4).
    assert.equal(Roles.descriptionOf(Roles.roleBySlug('one_off', [])), null);
});

test('a liturgical Role has none either, and that is not a gap to fill', () => {
    // ⚠ They are code-defined and have no editable definition at all
    // (ADR-0016). Giving them a description would mean giving them a stored
    // definition, which is the thing that decision refuses.
    Roles.LITURGICAL_SLUGS.forEach(slug => {
        assert.equal(Roles.descriptionOf(Roles.roleBySlug(slug, [])), null);
    });
});
