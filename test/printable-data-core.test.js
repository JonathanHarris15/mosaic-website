const { test } = require('node:test');
const assert = require('node:assert');

// MS-396 / MS-399 — what the data drawer offers, and how each source reads
// out of plain records.
//
// Two things are pinned above all. The catalog is the first half of the
// permission boundary: a member's drawer is a strict subset of an editor's,
// and nothing elder-only is in it at all. And the resolvers are pure over
// today's date, so "this Sunday" and "the next fortnight" can be tested on a
// fixed calendar.

const Data = require('../public/printable-data-core.js');

const TODAY = '2026-09-03'; // a Thursday

// ── The catalog ──────────────────────────────────────────────────────────────

test('a member sees a strict subset of what an editor sees, and nothing elder-only exists', () => {
    const member = Data.sourcesFor('member');
    const editor = Data.sourcesFor('editor');
    const mKeys = member.map(s => s.key);
    const eKeys = editor.map(s => s.key);
    mKeys.forEach(k => assert.ok(eKeys.includes(k)));
    assert.ok(eKeys.length > mKeys.length, 'an editor gets more than a member');
    assert.ok(!mKeys.includes('role_holder'), 'a roster is not a member\'s to read');
    assert.ok(!mKeys.includes('form_answers'));
    const memberPeople = member.find(s => s.key === 'people').fields.map(f => f.key);
    const editorPeople = editor.find(s => s.key === 'people').fields.map(f => f.key);
    assert.ok(!memberPeople.includes('stage'), 'the Membership Track is pastoral, not congregational');
    assert.ok(editorPeople.includes('stage'));
    Data.SOURCES.forEach(s => assert.ok(!['elder', 'super_admin'].includes(s.minLevel), s.key + ' is elder-only and must not be in the catalog'));
    const text = JSON.stringify(Data.SOURCES).toLowerCase();
    ['shepherding', 'prayer_request', 'pastoral', 'relationship'].forEach(w => assert.ok(!text.includes(w), 'the catalog mentions ' + w));
});

test('every source declares fields with a kind, and every param a default', () => {
    Data.SOURCES.forEach(s => {
        assert.ok(s.fields.length, s.key + ' has no fields');
        s.fields.forEach(f => assert.ok(['text', 'image', 'date', 'number'].includes(f.kind), s.key + '.' + f.key + ' has kind ' + f.kind));
        (s.params || []).forEach(p => assert.ok('default' in p, s.key + ' param ' + p.key + ' has no default'));
        assert.ok(['list', 'single'].includes(s.shape));
    });
});

test('a field lands on the right kind of element and nowhere else', () => {
    assert.equal(Data.accepts('text', 'text'), true);
    assert.equal(Data.accepts('text', 'date'), true);
    assert.equal(Data.accepts('text', 'image'), false);
    assert.equal(Data.accepts('image', 'image'), true);
    assert.equal(Data.accepts('image', 'text'), false);
    assert.equal(Data.accepts('box', 'text'), false);
    assert.equal(Data.propFor('image'), 'src');
    assert.equal(Data.propFor('text'), 'text');
});

test('a form\'s fields are one per question, and a heading asks nothing', () => {
    const forms = [{ id: 'f1', title: 'Camp', questions: [
        { id: 'q1', type: 'short_text', text: 'Name' }, { id: 'q2', type: 'section', text: 'Food' },
        { id: 'q3', type: 'number', text: 'How many' }, { id: 'q4', type: 'image', text: 'A photo' },
    ] }];
    const fields = Data.fieldsFor('form_answers', { formId: 'f1' }, { forms: forms });
    const keys = fields.map(f => f.key);
    assert.ok(keys.includes('q_q1') && keys.includes('q_q3') && keys.includes('q_q4'));
    assert.ok(!keys.includes('q_q2'), 'a section heading is not a field');
    assert.equal(fields.find(f => f.key === 'q_q3').kind, 'number');
    assert.equal(fields.find(f => f.key === 'q_q4').kind, 'image');
});

// ── Dates ────────────────────────────────────────────────────────────────────

test('"this Sunday" is the one coming, "next" the one after, and a date is its own Sunday', () => {
    assert.equal(Data.resolveWhen({ mode: 'this' }, TODAY), '2026-09-06');
    assert.equal(Data.resolveWhen({ mode: 'this' }, '2026-09-06'), '2026-09-06', 'today, if today is a Sunday');
    assert.equal(Data.resolveWhen({ mode: 'next' }, TODAY), '2026-09-13');
    assert.equal(Data.resolveWhen({ mode: 'date', date: '2026-08-19' }, TODAY), '2026-08-23');
});

test('a relative range moves with today; a static one does not; a backwards one is put right', () => {
    assert.deepEqual(Data.resolveRange({ mode: 'relative', fromDays: 0, toDays: 14 }, TODAY), { from: '2026-09-03', to: '2026-09-17' });
    assert.deepEqual(Data.resolveRange({ mode: 'relative', fromDays: 0, toDays: 14 }, '2026-10-01'), { from: '2026-10-01', to: '2026-10-15' });
    assert.deepEqual(Data.resolveRange({ mode: 'static', from: '2026-08-19', to: '2026-08-31' }, '2027-01-01'), { from: '2026-08-19', to: '2026-08-31' });
    assert.deepEqual(Data.resolveRange({ mode: 'static', from: '2026-08-31', to: '2026-08-19' }, TODAY), { from: '2026-08-19', to: '2026-08-31' });
});

test('a date reads on paper as words', () => {
    assert.equal(Data.formatDate('2026-09-06'), 'Sunday 6 September 2026');
    assert.equal(Data.formatDate('2026-09-06', 'medium'), '6 September 2026');
    assert.equal(Data.formatDate('not a date'), 'not a date');
});

// ── People ───────────────────────────────────────────────────────────────────

const PEOPLE = () => ({
    people: [
        { id: 'a', name: 'Anna Baker', tags: ['Member'], contact: { email: 'a@x', phone: '1' }, photoUrl: 'a.jpg', membership: { stage: 'member' } },
        { id: 'b', name: 'Ben Carter', tags: ['Visitor', 'Choir'], contact: {}, membership: { stage: 'visitor' } },
        { id: 'c', name: 'Cara Abbott', tags: ['Member'], membership: { stage: 'member', inactive: true } },
        { id: 'd', name: 'Dan Baker', tags: ['Member', 'Choir'], membership: { stage: 'moving_membership' }, birthday: '1990-02-14' },
    ],
    families: [{ id: 'fam1', husbandId: 'd', wifeId: 'a', childIds: [] }],
});

test('the directory filters to members, leaves inactive people out, and sorts by last name', () => {
    const r = Data.resolve('people', {}, PEOPLE(), { today: TODAY, level: 'editor' });
    assert.deepEqual(r.rows.map(x => x.name), ['Anna Baker', 'Dan Baker'], 'Cara is inactive and Ben is a visitor');
    assert.equal(r.warnings.length, 0);
});

test('non-members, a tag, inactive people and first-name sort are all filters', () => {
    const non = Data.resolve('people', { membership: 'non_members' }, PEOPLE(), { today: TODAY, level: 'editor' });
    assert.deepEqual(non.rows.map(x => x.name), ['Ben Carter']);
    const choir = Data.resolve('people', { membership: 'everyone', tag: 'choir' }, PEOPLE(), { today: TODAY, level: 'editor' });
    assert.deepEqual(choir.rows.map(x => x.name), ['Dan Baker', 'Ben Carter'].sort((a, b) => a.split(' ')[1].localeCompare(b.split(' ')[1])));
    const all = Data.resolve('people', { membership: 'everyone', includeInactive: true, sort: 'first' }, PEOPLE(), { today: TODAY, level: 'editor' });
    assert.deepEqual(all.rows.map(x => x.firstName), ['Anna', 'Ben', 'Cara', 'Dan']);
});

test('a person row carries the fields the drawer promises', () => {
    const r = Data.resolve('people', {}, PEOPLE(), { today: TODAY, level: 'editor' });
    const anna = r.rows[0];
    assert.equal(anna.firstName, 'Anna');
    assert.equal(anna.lastName, 'Baker');
    assert.equal(anna.photo, 'a.jpg');
    assert.equal(anna.email, 'a@x');
    assert.equal(anna.membership, 'Member');
    assert.equal(anna.stage, 'Member');
    assert.equal(anna.household, 'The Baker household', 'a family is a household');
    const dan = r.rows[1];
    assert.equal(dan.birthday, '14 February 1990');
    assert.equal(dan.stage, 'Moving membership');
    assert.equal(dan.tags, 'Member, Choir');
});

test('an empty list says so rather than looking like a failure', () => {
    const r = Data.resolve('people', { tag: 'Bell ringers' }, PEOPLE(), { today: TODAY, level: 'editor' });
    assert.equal(r.rows.length, 0);
    assert.match(r.warnings[0], /Bell ringers/);
});

test('households group a family and seat a lone person on their own', () => {
    const r = Data.resolve('households', { membership: 'everyone' }, PEOPLE(), { today: TODAY, level: 'member' });
    const names = r.rows.map(x => x.name);
    assert.ok(names.includes('The Baker household'));
    assert.ok(names.includes('The Carter household'));
    assert.equal(r.rows.find(x => x.name === 'The Baker household').members, 'Dan Baker, Anna Baker');
});

test('a source above the viewer resolves to nothing and says why', () => {
    const r = Data.resolve('role_holder', { seriesId: 's', roleSlug: 'x' }, {}, { today: TODAY, level: 'member' });
    assert.equal(r.rows.length, 0);
    assert.match(r.warnings[0], /not visible to you/);
});

// ── Sundays ──────────────────────────────────────────────────────────────────

const SUNDAYS = () => ({
    services: {
        '2026-09-06': {
            theme: 'Grace', keyVerse: 'Eph 2:8', preacher: 'Pastor Sam', serviceLeader: 'Lee', musicLeader: 'Mo',
            hasBaptism: false, removedHymns: ['hymnEnd2'],
            liturgy: {
                preparatoryHymn: { id: 'h1', name: 'Amazing Grace' }, callToWorship: 'Psalm 100',
                hymn1: { id: null, name: 'A Literal Hymn' }, sermon: 'Romans 8', hymnEnd2: { id: 'h2', name: 'Doxology' },
                prayerMale: 'Tom',
            },
        },
        // The ADR-0034 trap: a dotted key written by an old save.
        '2026-09-13': { theme: 'Hope', 'liturgy.sermon': 'John 3', 'liturgy.hymn1': { id: 'h2', name: 'Doxology' } },
    },
    hymns: {
        h1: { hymn_name: 'Amazing Grace', attribution: 'Newton', versions: [{ pages: ['ag1.png', 'ag2.png'] }] },
        h2: { hymn_name: 'Doxology', versions: [{ pages: ['dox.png'] }] },
    },
});

test('a Sunday resolves its people, theme and every slot for this Sunday', () => {
    const r = Data.resolve('sunday', { when: { mode: 'this' } }, SUNDAYS(), { today: TODAY });
    const row = r.rows[0];
    assert.equal(row.date, 'Sunday 6 September 2026');
    assert.equal(row.theme, 'Grace');
    assert.equal(row.preacher, 'Pastor Sam');
    assert.equal(row.preparatoryHymn, 'Amazing Grace');
    assert.equal(row.hymn1, 'A Literal Hymn');
    assert.equal(row.sermon, 'Romans 8');
    assert.equal(row.prayerMale, 'Tom');
    assert.equal(r.warnings.length, 0);
});

test('a Sunday nobody has planned is an answer with a warning, not an error', () => {
    const r = Data.resolve('sunday', { when: { mode: 'date', date: '2026-12-25' } }, SUNDAYS(), { today: TODAY });
    assert.equal(r.rows[0].theme, '');
    assert.match(r.warnings[0], /Nothing is planned yet for Sunday 27 December 2026/);
});

test('dotted liturgy keys on an old record are folded back before reading', () => {
    const r = Data.resolve('sunday', { when: { mode: 'next' } }, SUNDAYS(), { today: TODAY });
    assert.equal(r.rows[0].sermon, 'John 3');
    assert.equal(r.rows[0].hymn1, 'Doxology');
});

test('order of service rows come in service order, skip empty slots and removed hymns', () => {
    const r = Data.resolve('sunday_rows', {}, SUNDAYS(), { today: TODAY });
    assert.deepEqual(r.rows.map(x => x.label), ['Preparatory hymn', 'Call to worship', 'Hymn', 'Prayer', 'Sermon']);
    assert.deepEqual(r.rows.map(x => x.value), ['Amazing Grace', 'Psalm 100', 'A Literal Hymn', 'Tom', 'Romans 8']);
    assert.equal(r.rows[0].number, 1);
});

test('the hymns of a Sunday carry their first sheet image, and a literal hymn warns', () => {
    const r = Data.resolve('sunday_hymns', {}, SUNDAYS(), { today: TODAY });
    assert.deepEqual(r.rows.map(x => x.name), ['Amazing Grace', 'A Literal Hymn']);
    assert.equal(r.rows[0].image, 'ag1.png');
    assert.equal(r.rows[0].attribution, 'Newton');
    assert.equal(r.rows[1].image, '');
    assert.match(r.warnings[0], /A Literal Hymn.*no sheet music/);
});

test('Sundays in a range make a preaching schedule', () => {
    const r = Data.resolve('sundays', { range: { mode: 'relative', fromDays: 0, toDays: 14 } }, SUNDAYS(), { today: TODAY });
    assert.deepEqual(r.rows.map(x => x.theme), ['Grace', 'Hope']);
    assert.equal(r.rows[1].sermon, 'John 3');
});

// ── Events ───────────────────────────────────────────────────────────────────

const EVENTS = () => ({
    series: [
        { id: 'mm', name: 'Members\' meeting', location: 'The hall', description: 'Business and a sermonette.', recurrence: { time: '19:30' } },
        { id: 'bs', name: 'Bible study', recurrence: { time: '10:00' } },
    ],
    occurrences: [
        { id: 'mm_2026-09-10', seriesId: 'mm', date: '2026-09-10', description: 'Bring the tables.', assignments: [
            { personId: 'p1', roleSlug: 'sermonette', state: 'pending' }, { personId: 'p2', roleSlug: 'sermonette', state: 'confirmed' },
        ] },
        { id: 'mm_2026-09-24', seriesId: 'mm', date: '2026-09-24', cancelled: true },
        { id: 'bs_2026-09-08', seriesId: 'bs', date: '2026-09-08', location: 'Room 2' },
        { id: 'bs_2026-10-20', seriesId: 'bs', date: '2026-10-20' },
    ],
    roles: [{ id: 'r1', slug: 'sermonette', name: 'Sermonette' }],
    people: [{ id: 'p1', name: 'Pending Pete' }, { id: 'p2', name: 'Confirmed Connie' }],
});

test('event dates in a range list what is on, skip cancelled dates, and read time and place through', () => {
    const r = Data.resolve('event_dates', { range: { mode: 'relative', fromDays: 0, toDays: 30 } }, EVENTS(), { today: TODAY });
    assert.deepEqual(r.rows.map(x => x.name), ['Bible study', 'Members\' meeting']);
    assert.equal(r.rows[0].location, 'Room 2', 'a date\'s own place wins');
    assert.equal(r.rows[0].time, '10:00 am');
    assert.equal(r.rows[1].time, '7:30 pm', 'a series\' time lives on its rule');
    assert.equal(r.rows[1].location, 'The hall');
    assert.equal(r.rows[1].description, 'Business and a sermonette.');
    assert.equal(r.rows[1].dateNote, 'Bring the tables.');
    assert.equal(r.rows[1].date, 'Thursday 10 September 2026');
});

test('event dates can be narrowed to one event', () => {
    const r = Data.resolve('event_dates', { range: { mode: 'relative', fromDays: 0, toDays: 60 }, seriesId: 'bs' }, EVENTS(), { today: TODAY });
    assert.deepEqual(r.rows.map(x => x.date), ['Tuesday 8 September 2026', 'Tuesday 20 October 2026']);
});

test('the role holder is the confirmed person on the next date, falling back to a pending one', () => {
    const r = Data.resolve('role_holder', { seriesId: 'mm', roleSlug: 'sermonette' }, EVENTS(), { today: TODAY, level: 'editor' });
    assert.equal(r.rows[0].name, 'Confirmed Connie');
    assert.equal(r.rows[0].date, 'Thursday 10 September 2026');
    assert.equal(r.rows[0].role, 'Sermonette');
    assert.equal(r.rows[0].event, 'Members\' meeting');
    assert.equal(r.warnings.length, 0);
});

test('nobody holding the role gives a fallback and a warning naming event, role and date', () => {
    const data = EVENTS();
    data.occurrences[0].assignments = [];
    const r = Data.resolve('role_holder', { seriesId: 'mm', roleSlug: 'sermonette' }, data, { today: TODAY, level: 'editor' });
    assert.equal(r.rows[0].name, '');
    assert.match(r.warnings[0], /Nobody is down for Sermonette at Members' meeting on 10 September 2026/);
});

test('a role holder on a date skips cancelled dates and can start from a chosen date', () => {
    const r = Data.resolve('role_holder', { seriesId: 'mm', roleSlug: 'sermonette', when: { mode: 'date', date: '2026-09-20' } }, EVENTS(), { today: TODAY, level: 'editor' });
    assert.equal(r.rows[0].name, '');
    assert.match(r.warnings[0], /No date of Members' meeting is coming up from 20 September 2026/);
});

// ── Forms ────────────────────────────────────────────────────────────────────

test('form answers make one row per response with a field per question', () => {
    const data = {
        forms: [{ id: 'f1', title: 'Camp', questions: [{ id: 'q1', type: 'short_text', text: 'Name' }, { id: 'q2', type: 'choice_many', text: 'Days' }, { id: 'q3', type: 'person', text: 'Parent' }] }],
        responses: [
            { id: 'r1', formId: 'f1', personName: 'Anna', submittedAt: '2026-09-01T10:00:00Z', answers: { q1: 'Anna B', q2: ['Mon', 'Tue'], q3: { personId: 'x', name: 'Dan Baker' } } },
            { id: 'r2', formId: 'other', answers: {} },
        ],
    };
    const r = Data.resolve('form_answers', { formId: 'f1' }, data, { today: TODAY, level: 'editor' });
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].q_q1, 'Anna B');
    assert.equal(r.rows[0].q_q2, 'Mon, Tue');
    assert.equal(r.rows[0].q_q3, 'Dan Baker');
    assert.equal(r.rows[0].personName, 'Anna');
    assert.equal(r.rows[0].submittedAt, '1 September 2026');
});

// ── What the store must fetch ────────────────────────────────────────────────

test('a dated source asks the store for a window, not the whole collection', () => {
    const n = Data.needsFor('event_dates', { range: { mode: 'relative', fromDays: 0, toDays: 7 } }, TODAY);
    assert.deepEqual(n.occurrenceRange, { from: '2026-09-03', to: '2026-09-10' });
    assert.equal(n.series, true);
    assert.deepEqual(Data.needsFor('sunday', {}, TODAY).services, ['2026-09-06']);
    assert.equal(Data.needsFor('people', {}, TODAY).people, true);
});

test('params read back as a sentence for the element panel', () => {
    assert.equal(Data.describeParams('people', { membership: 'non_members', tag: 'Choir' }), 'non-members · with the tag "Choir"');
    assert.equal(Data.describeParams('sunday', { when: { mode: 'next' } }), 'next Sunday');
    assert.match(Data.describeParams('event_dates', {}), /from today to 14 days from now/);
});
