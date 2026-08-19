// MS-245 — Assigned: who is down to WRITE this Sunday's order of service.
//
// A small badge at the leading edge of each row in the Planning view. Click it,
// pick somebody, and their face sits beside the date so the room can see who
// took which Sunday.
//
// ⚠ The thing this file exists to protect is that Assigned is NOT a Role and
// NOT an Involvement. Everywhere else on the Service Calendar, putting a person
// on a Sunday means they served: it writes an involvement record and moves
// their number in the fairness engine. Volunteering to fill in a planning row
// is not serving. Route it through the same save and whoever takes the most
// Sundays looks over-used and stops being asked — the exact opposite of what
// the feature is for.
//
// It is also deliberately short-lived. Per-element authorship (who actually
// chose each hymn) will replace it, which is why the field is `assignedWriter`
// rather than the vaguer `assignedTo`: the two must be able to coexist without
// either being mistaken for the other.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const SRC = fs.readFileSync(path.join(PUBLIC, 'service-calendar.js'), 'utf8');
const HTML = fs.readFileSync(path.join(PUBLIC, 'service-calendar.html'), 'utf8');

function load() {
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout() { return 0; }, clearTimeout() {}, setInterval() {}, clearInterval() {},
        Promise, Date, Object, Array, Math, String, Number, JSON, Set, Map, RegExp,
        encodeURIComponent, URLSearchParams, Boolean, Error,
        module: { exports: {} },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.location = { search: '', href: '' };
    sandbox.localStorage = { getItem: () => null, setItem() {} };
    sandbox.auth = { onAuthStateChanged() {}, currentUser: null };
    sandbox.document = {
        addEventListener() {}, getElementById() { return null; },
        querySelector() { return null; }, querySelectorAll() { return []; },
        createElement: () => ({ classList: { add() {} }, style: {}, textContent: '', innerHTML: '' }),
        body: { classList: { contains: () => false } },
    };
    sandbox.DateUtils = require('../public/date-utils.js');
    sandbox.HymnRegistry = require('../public/hymn-registry.js');
    sandbox.PersonPhotoCore = require('../public/person-photo-core.js');
    sandbox.UsageStats = require('../public/usage-stats-store.js');

    vm.createContext(sandbox);
    vm.runInContext(SRC, sandbox, { filename: 'service-calendar.js' });
    return Object.assign(sandbox, sandbox.module.exports);
}

// ── It must never look like serving ───────────────────────────────────────

test('Assigned leaves the person save before any involvement is written', () => {
    // If this guard is ever removed, being down to write five Sundays credits
    // somebody with five services they did not lead, and the fairness engine
    // quietly stops offering them anything.
    const guard = SRC.indexOf(`this.selectorField === ASSIGNED_FIELD`);
    const firstInvolvement = SRC.indexOf(`collection('involvement')`);

    assert.ok(guard > -1, 'the early return is gone');
    assert.ok(firstInvolvement > -1, 'expected the involvement write to still exist');
    assert.ok(guard < firstInvolvement,
        'the Assigned guard must come BEFORE anything that writes an involvement');
});

test('the Assigned save writes one field and touches nothing else', () => {
    const body = SRC.slice(SRC.indexOf('async saveAssignedWriter()'),
                           SRC.indexOf('getRoleName(field) {'));

    assert.match(body, /\[ASSIGNED_FIELD\]: value/, 'it should write the field');
    assert.ok(!/involvement/.test(body), 'no involvement record');
    assert.ok(!/totalInvolvements/.test(body), 'no involvement count');
    assert.ok(!/HISTORY_COLLECTION/.test(body), 'no pastoral prayer history');
    assert.ok(!/recomputeLastPrayerDate/.test(body), 'no prayer rotation');
    assert.ok(!/collection\('people'\)/.test(body), 'the Person record is not touched at all');
});

test('the field is named for what it is, so the real thing can land beside it', () => {
    const sb = load();
    assert.strictEqual(sb.ASSIGNED_FIELD, 'assignedWriter');
});

test('clearing the assignment writes null rather than a half-empty person', () => {
    const body = SRC.slice(SRC.indexOf('async saveAssignedWriter()'),
                           SRC.indexOf('getRoleName(field) {'));
    assert.match(body, /this\.selectedPersonRef\.id\s*\?[\s\S]{0,120}:\s*null/);
});

// ── The badge ─────────────────────────────────────────────────────────────

test('an unassigned Sunday invites somebody rather than showing a gap', () => {
    const sb = load();
    const html = sb.assignedBadgeHtml(null, null);
    assert.match(html, /person_add/);
});

test("an assigned person shows their photo", () => {
    const sb = load();
    const html = sb.assignedBadgeHtml(
        { id: 'p-1', name: 'Bill Smith' },
        { id: 'p-1', photoUrl: 'https://example.test/bill.jpg', photoCrop: { x: 50, y: 40, zoom: 1.2 } });

    assert.match(html, /<img src="https:\/\/example\.test\/bill\.jpg"/);
    assert.match(html, /object-position/, 'the stored crop should be applied');
});

test('their first name sits under the photo', () => {
    const sb = load();
    const html = sb.assignedBadgeHtml({ id: 'p-1', name: 'Bill Smith' }, null);
    assert.match(html, /assigned-name">Bill</);
});

test('someone with no photo shows their initials, not an empty circle', () => {
    const sb = load();
    const html = sb.assignedBadgeHtml({ id: 'p-1', name: 'Bill Smith' }, { id: 'p-1' });
    assert.match(html, /m-avatar/);
    assert.match(html, />BS</);
});

test('a person the directory has not loaded yet still shows', () => {
    // Hiding them would read as "nobody is assigned" and get the Sunday
    // assigned twice.
    const sb = load();
    const html = sb.assignedBadgeHtml({ id: 'p-99', name: 'Ann Lee' }, undefined);
    assert.match(html, />AL</);
    assert.match(html, /assigned-name">Ann</);
});

test('a one-word name does not break the badge', () => {
    const sb = load();
    const html = sb.assignedBadgeHtml({ id: 'p-1', name: 'Prince' }, null);
    assert.match(html, />P</);
    assert.match(html, /assigned-name">Prince</);
});

test('a name with a quote in it cannot break out into markup', () => {
    // The name goes into a title attribute as well as the body, so quotes
    // matter here in a way they do not for ordinary cell text.
    const sb = load();
    const html = sb.assignedBadgeHtml({ id: 'p-1', name: `O'Ne"il <script>` }, null);
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('"il'));
});

test('escaping covers quotes, because these values go into attributes', () => {
    const sb = load();
    assert.strictEqual(sb.escapeHtml(`a"b'c<d>e&f`), 'a&quot;b&#39;c&lt;d&gt;e&amp;f');
    assert.strictEqual(sb.escapeHtml(null), '');
});

test('a first name is taken off the front, however messy the spacing', () => {
    const sb = load();
    assert.strictEqual(sb.firstNameOf('  Bill   Smith '), 'Bill');
    assert.strictEqual(sb.firstNameOf(''), '');
    assert.strictEqual(sb.firstNameOf(null), '');
});

// ── Where it lives ────────────────────────────────────────────────────────

test('the badge appears only in the Planning view', () => {
    assert.match(SRC, /assigned-btn planning-only/);
    assert.match(HTML, /\.planning-only \{ display: none; \}/);
    assert.match(HTML, /\.planning-mode \.planning-only \{ display: flex; \}/);
});

test('it sits at the leading edge of the row, before the date', () => {
    const dateCell = SRC.slice(SRC.indexOf('sticky-col-left">'), SRC.indexOf('sermon-cell'));
    assert.ok(dateCell.indexOf('assigned-btn') < dateCell.indexOf('toLocaleDateString'),
        'the badge should come before the date, not after it');
});

test('the badge opens the ordinary person search', () => {
    assert.match(SRC, /window\.openPersonSelector\(dateKey, ASSIGNED_FIELD/);
});

test('the picker says what it is asking for', () => {
    // "Person" as a heading tells nobody which question they are answering.
    assert.match(SRC, /'assignedWriter': 'Assigned to write this Sunday'/);
});

test('hovering gives the whole name, since only the first fits', () => {
    assert.match(SRC, /is writing this Sunday/);
});

test('the faces are drawn again once the directory arrives', () => {
    // The table is on screen well before the people are; without this the
    // badges would sit as initials until something else redrew them.
    const fetchBody = SRC.slice(SRC.indexOf('async fetchPeopleRegistry()'),
                                SRC.indexOf('async fetchPeopleRegistry()') + 900);
    assert.match(fetchBody, /peopleById\[p\.id\] = p/);
    assert.match(fetchBody, /injectServiceData\(serviceDataMap\)/);
});

test('the Assigned picker does not report when people were last prayed for', () => {
    // That line answers "who has waited longest to be prayed for". Asking who
    // is down to WRITE a Sunday is a different question, and a date under
    // every name is noise to read past. isPastoralPrayerField is what tells
    // the two apart now (usage-stats-store.js), and it is false for
    // assignedWriter — not a serving role, so usageLabelFor reads it as
    // untracked and shows nothing either.
    assert.match(HTML, /x-if="!p\.isNew && isPastoralPrayerField"/);
    const sb = load();
    const picker = sb.personPicker({ name: '', id: null }, { selectorField: sb.ASSIGNED_FIELD });
    assert.strictEqual(picker.isPastoralPrayerField, false);
    assert.strictEqual(picker.usageLabelFor({ id: 'p-1' }), '');
});

test('the pastoral prayer pickers keep it, because there it is the point', () => {
    const sb = load();
    const parent = { selectorField: 'prayerMale' };
    const picker = sb.personPicker({ name: '', id: null }, parent);
    assert.strictEqual(picker.isPastoralPrayerField, true);
    parent.selectorField = 'prayerFemale';
    assert.strictEqual(picker.isPastoralPrayerField, true);
    parent.selectorField = sb.ASSIGNED_FIELD;
    assert.strictEqual(picker.isPastoralPrayerField, false);
});

test('a viewer sees who is assigned but is not invited to change it', () => {
    // An empty badge is an offer. Offering a button that does nothing when
    // pressed is worse than offering nothing.
    const body = SRC.slice(SRC.indexOf("el.querySelector('.assigned-btn')"),
                           SRC.indexOf('PLANNING_COLUMNS.forEach'));
    assert.match(body, /!canEdit && !assigned/);
    assert.match(body, /if \(canEdit\) \{[\s\S]{0,80}assignedBtn\.onclick/,
        'only an editor gets the click');
});
