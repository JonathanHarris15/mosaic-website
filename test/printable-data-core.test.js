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
    assert.equal(Data.formatDate('2026-09-06', 'monthDay'), 'Sep 6', 'the designed schedule\'s date');
    assert.equal(Data.formatDate('2026-09-06', 'short'), '6 Sep', 'day then month, as some schedules print it');
    assert.equal(Data.formatDate('2026-09-06', 'weekday'), 'Sunday');
    assert.equal(Data.formatDate('not a date'), 'not a date');
});

test('a count of Sundays is counted in Sundays, not added up in days', () => {
    const five = { mode: 'weeks', count: 5, start: { mode: 'this' } };
    assert.deepEqual(Data.resolveRange(five, TODAY), { from: '2026-09-06', to: '2026-10-10' });
    assert.deepEqual(Data.resolveRange(five, '2026-09-06'), { from: '2026-09-06', to: '2026-10-10' }, 'on a Sunday, this Sunday is today');
    assert.deepEqual(Data.resolveRange(five, '2026-10-01'), { from: '2026-10-04', to: '2026-11-07' }, 'it moves with today');
    assert.deepEqual(Data.resolveRange({ mode: 'weeks', count: 2, start: { mode: 'next' } }, TODAY), { from: '2026-09-13', to: '2026-09-26' });
    assert.deepEqual(Data.resolveRange({ mode: 'weeks', count: 1, start: { mode: 'date', date: '2026-10-01' } }, TODAY), { from: '2026-10-04', to: '2026-10-10' }, 'a date starts from its Sunday');
    assert.deepEqual(Data.resolveRange({ mode: 'weeks', count: 'lots' }, TODAY), { from: '2026-09-06', to: '2026-09-12' }, 'no usable count is one week from this Sunday');
    assert.equal(Data.resolveRange({ mode: 'weeks', count: 500 }, TODAY).to, Data.addDays('2026-09-06', 52 * 7 - 1), 'a year at most');
});

test('a count of Sundays or weeks reads back in words', () => {
    assert.equal(Data.describeRange({ mode: 'weeks', count: 5, start: { mode: 'this' } }, 'Sundays'), 'for the 5 Sundays from this Sunday');
    assert.equal(Data.describeRange({ mode: 'weeks', count: 1, start: { mode: 'next' } }, 'Sundays'), 'for next Sunday');
    assert.equal(Data.describeRange({ mode: 'weeks', count: 4, start: { mode: 'this' } }), 'in the 4 weeks from this Sunday');
    assert.equal(Data.describeRange({ mode: 'weeks', count: 1, start: { mode: 'date', date: '2026-10-01' } }), 'in the week from the Sunday of 1 October 2026');
    assert.equal(Data.describeRange({ mode: 'count', count: 6 }), 'the next 6 dates');
    assert.equal(Data.describeRange({ mode: 'count', count: 1 }), 'the next date');
});

test('switching a range to another way of counting starts from something sensible', () => {
    const sundaysRange = Data.sourceByKey('sundays').params.find(p => p.key === 'range');
    const eventsRange = Data.sourceByKey('event_dates').params.find(p => p.key === 'range');
    assert.equal(sundaysRange.unit, 'Sundays');
    assert.equal(eventsRange.unit, 'weeks');
    assert.deepEqual(Data.rangeForMode(sundaysRange, 'weeks'), { mode: 'weeks', count: 5, start: { mode: 'this' } });
    assert.deepEqual(Data.rangeForMode(eventsRange, 'weeks'), { mode: 'weeks', count: 4, start: { mode: 'this' } });
    assert.deepEqual(Data.rangeForMode(eventsRange, 'relative'), { mode: 'relative', fromDays: 0, toDays: 14 });
    assert.deepEqual(Data.rangeForMode(eventsRange, 'count'), { mode: 'count', count: 6 });
    assert.deepEqual(Data.rangeForMode(sundaysRange, 'static'), { mode: 'static', from: '', to: '' });
    const a = Data.rangeForMode(sundaysRange, 'weeks');
    a.start.mode = 'next';
    assert.equal(sundaysRange.default.start.mode, 'this', 'the catalog default is not shared out by reference');
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

// A family with children — PEOPLE() stays childless so the existing
// household tests keep reading "Dan Baker, Anna Baker".
const FAMILY_WITH_KIDS = () => ({
    people: [
        { id: 'a', name: 'Anna Baker', tags: ['Member'], contact: { email: 'a@x' }, membership: { stage: 'member' } },
        { id: 'd', name: 'Dan Baker', tags: ['Member'], membership: { stage: 'member' } },
        { id: 'e', name: 'Eve Baker', tags: ['Member'], photoUrl: 'e.jpg', membership: { stage: 'member' } },
        { id: 'f', name: 'Finn Baker', tags: ['Member'], membership: { stage: 'member' } },
        { id: 'b', name: 'Ben Carter', tags: ['Visitor'], membership: { stage: 'visitor' } },
    ],
    families: [{ id: 'fam1', husbandId: 'd', wifeId: 'a', childIds: ['e', 'f'] }],
});

test('children of a household are a related list of that household, not a top-level list', () => {
    const kids = Data.sourceByKey('household_children');
    assert.ok(kids, 'the catalog names the children of a household');
    assert.equal(kids.of, 'households');
    assert.equal(kids.shape, 'list');
    assert.equal(kids.minLevel, 'member');
    const memberLists = Data.listSourcesFor('member').map(s => s.key);
    assert.ok(memberLists.includes('households'));
    assert.ok(!memberLists.includes('household_children'), 'without a parent household the picker does not offer the related list');
    const ofHouse = Data.listSourcesFor('member', 'households').map(s => s.key);
    assert.ok(ofHouse.includes('household_children'));
    assert.ok(ofHouse.indexOf('household_children') < ofHouse.indexOf('households'), 'of this household comes first');
    assert.deepEqual(Data.relatedSourcesFor('households', 'member').map(s => s.key), ['household_children']);
    assert.ok(Data.needsFor('household_children', {}, TODAY).people);
    assert.ok(Data.needsFor('household_children', {}, TODAY).families);
});

test('households can be kept to those with children', () => {
    const any = Data.resolve('households', { membership: 'everyone' }, FAMILY_WITH_KIDS(), { today: TODAY, level: 'member' });
    assert.ok(any.rows.some(r => r.name === 'The Carter household'));
    const withKids = Data.resolve('households', { membership: 'everyone', hasChildren: 'yes' }, FAMILY_WITH_KIDS(), { today: TODAY, level: 'member' });
    assert.deepEqual(withKids.rows.map(r => r.name), ['The Baker household']);
    const none = Data.resolve('households', { membership: 'everyone', hasChildren: 'no' }, FAMILY_WITH_KIDS(), { today: TODAY, level: 'member' });
    assert.deepEqual(none.rows.map(r => r.name), ['The Carter household']);
    const spec = Data.querySpecsFor('households', 'member').find(s => s.key === 'hasChildren');
    assert.ok(spec, 'the query builder offers the filter');
});

test('households can be kept to those with a non-member child', () => {
    const data = {
        people: [
            { id: 'a', name: 'Anna Baker', tags: ['Member'], membership: { stage: 'member' } },
            { id: 'd', name: 'Dan Baker', tags: ['Member'], membership: { stage: 'member' } },
            { id: 'e', name: 'Eve Baker', tags: ['Member'], membership: { stage: 'member' } },
            { id: 'p', name: 'Pat Cole', tags: ['Member'], membership: { stage: 'member' } },
            { id: 'q', name: 'Quin Cole', tags: ['Visitor'], membership: { stage: 'visitor' } },
            { id: 'b', name: 'Ben Carter', tags: ['Visitor'], membership: { stage: 'visitor' } },
        ],
        families: [
            { id: 'fam1', husbandId: 'd', wifeId: 'a', childIds: ['e'] },
            { id: 'fam2', husbandId: 'p', wifeId: null, childIds: ['q'] },
        ],
    };
    const spec = Data.querySpecsFor('households', 'member').find(s => s.key === 'childMembership');
    assert.ok(spec, 'the query builder offers whose children');
    const withKids = Data.resolve('households', { membership: 'everyone', hasChildren: 'yes' }, data, { today: TODAY, level: 'member' });
    assert.deepEqual(withKids.rows.map(r => r.name), ['The Baker household', 'The Cole household']);
    const nonMemberKids = Data.resolve('households', {
        membership: 'everyone', hasChildren: 'yes', childMembership: 'non_members',
    }, data, { today: TODAY, level: 'member' });
    assert.deepEqual(nonMemberKids.rows.map(r => r.name), ['The Cole household']);
    const memberKids = Data.resolve('households', {
        membership: 'everyone', hasChildren: 'yes', childMembership: 'members',
    }, data, { today: TODAY, level: 'member' });
    assert.deepEqual(memberKids.rows.map(r => r.name), ['The Baker household']);
});

test('a related children list is of one household, and without a parent it flattens every home', () => {
    const data = FAMILY_WITH_KIDS();
    const homes = Data.resolve('households', { membership: 'everyone' }, data, { today: TODAY, level: 'member' });
    const baker = homes.rows.find(r => r.name === 'The Baker household');
    const carter = homes.rows.find(r => r.name === 'The Carter household');
    const ofBaker = Data.resolve('household_children', {}, data, { today: TODAY, level: 'member', parent: baker });
    assert.deepEqual(ofBaker.rows.map(r => r.name), ['Eve Baker', 'Finn Baker']);
    assert.equal(ofBaker.rows[0].photo, 'e.jpg');
    const ofCarter = Data.resolve('household_children', {}, data, { today: TODAY, level: 'member', parent: carter });
    assert.equal(ofCarter.rows.length, 0);
    const flat = Data.resolve('household_children', {}, data, { today: TODAY, level: 'member' });
    assert.deepEqual(flat.rows.map(r => r.name), ['Eve Baker', 'Finn Baker']);
});

test('children of a household can be kept to members or to non-members', () => {
    const data = {
        people: [
            { id: 'a', name: 'Anna Baker', tags: ['Member'], membership: { stage: 'member' } },
            { id: 'd', name: 'Dan Baker', tags: ['Member'], membership: { stage: 'member' } },
            { id: 'e', name: 'Eve Baker', tags: ['Member'], membership: { stage: 'member' } },
            { id: 'g', name: 'Gia Baker', tags: ['Visitor'], membership: { stage: 'visitor' } },
        ],
        families: [{ id: 'fam1', husbandId: 'd', wifeId: 'a', childIds: ['e', 'g'] }],
    };
    const baker = Data.resolve('households', { membership: 'everyone' }, data, { today: TODAY, level: 'member' })
        .rows.find(r => r.name === 'The Baker household');
    const spec = Data.querySpecsFor('household_children', 'member').find(s => s.key === 'membership');
    assert.ok(spec, 'the query builder offers who the children are');
    assert.deepEqual(spec.options.map(o => o.value), ['members', 'non_members', 'everyone']);
    const kids = Data.resolve('household_children', {}, data, { today: TODAY, level: 'member', parent: baker });
    assert.deepEqual(kids.rows.map(r => r.name), ['Eve Baker', 'Gia Baker'], 'the default is every child');
    const members = Data.resolve('household_children', { membership: 'members' }, data, { today: TODAY, level: 'member', parent: baker });
    assert.deepEqual(members.rows.map(r => r.name), ['Eve Baker']);
    const notMembers = Data.resolve('household_children', { membership: 'non_members' }, data, { today: TODAY, level: 'member', parent: baker });
    assert.deepEqual(notMembers.rows.map(r => r.name), ['Gia Baker']);
});

test('the query a level may build is only the sources and filters they may read', () => {
    const member = Data.querySpecsFor('people', 'member').map(s => s.key);
    const editor = Data.querySpecsFor('people', 'editor').map(s => s.key);
    const elder = Data.querySpecsFor('people', 'elder').map(s => s.key);
    assert.ok(member.includes('membership') && member.includes('sort'));
    assert.ok(!member.includes('stage') && !member.includes('includeInactive'));
    assert.ok(!editor.includes('stage') && !editor.includes('includeInactive'), 'inactive people and the Track are not an editor\'s to query');
    assert.ok(elder.includes('stage') && elder.includes('includeInactive'));
    assert.equal(Data.mayQuery('member', 'form_answers'), false);
    assert.equal(Data.mayQuery('editor', 'form_answers'), true);
    assert.equal(Data.mayQuery('member', 'people'), true);
    const editorPeople = Data.sourcesFor('editor').find(s => s.key === 'people');
    assert.ok(!editorPeople.filters.some(f => f.key === 'stage'), 'the drawer never lists a filter above the viewer');
});

test('a stored query still runs when the viewer could not have built it', () => {
    const visitors = Data.resolve('people', { membership: 'everyone', stage: 'visitor' }, PEOPLE(), { today: TODAY, level: 'member' });
    assert.deepEqual(visitors.rows.map(x => x.name), ['Ben Carter']);
    assert.equal('stage' in visitors.rows[0], false, 'the Track field is still stripped from the row');
    const inactive = Data.resolve('people', { membership: 'everyone', includeInactive: true }, PEOPLE(), { today: TODAY, level: 'member' });
    assert.ok(inactive.rows.some(x => x.name === 'Cara Abbott'));
});

test('a field above the viewer never leaves the resolver, whoever wired it', () => {
    const asEditor = Data.resolve('people', {}, PEOPLE(), { today: TODAY, level: 'editor' });
    const asMember = Data.resolve('people', {}, PEOPLE(), { today: TODAY, level: 'member' });
    assert.equal(asEditor.rows[0].stage, 'Member');
    assert.equal('stage' in asMember.rows[0], false, 'the Membership Track is pastoral, not congregational');
    assert.equal(asMember.rows[0].membership, 'Member', 'the congregational fact still reads');
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
    assert.equal(row.hymnEnd2, '', 'a hymn the Sunday has dropped does not print');
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

test('the hymns of a Sunday return every sheet-music page, in slot then page order', () => {
    const r = Data.resolve('sunday_hymns', {}, SUNDAYS(), { today: TODAY });
    assert.deepEqual(r.rows.map(x => x.name), ['Amazing Grace', 'Amazing Grace', 'A Literal Hymn']);
    assert.deepEqual(r.rows.map(x => x.image), ['ag1.png', 'ag2.png', '']);
    assert.deepEqual(r.rows.map(x => x.page), [1, 2, 1]);
    assert.equal(r.rows[0].pageCount, 2);
    assert.equal(r.rows[0].attribution, 'Newton');
    assert.equal(r.rows[0]._id, 'preparatoryHymn~0');
    assert.equal(r.rows[1]._id, 'preparatoryHymn~1');
    assert.match(r.warnings[0], /A Literal Hymn.*no sheet music/);
});

test('the hymns of a Sunday can be kept to one hymn, so its pages can sit on a page of their own', () => {
    const spec = Data.querySpecsFor('sunday_hymns', 'viewer').find(s => s.key === 'slot');
    assert.ok(spec, 'the query builder offers which hymn');
    assert.equal(spec.default, '', 'every hymn unless asked');
    assert.deepEqual(spec.options.map(o => o.value), [''].concat(Data.HYMN_SLOTS));
    const prep = Data.resolve('sunday_hymns', { slot: 'preparatoryHymn' }, SUNDAYS(), { today: TODAY });
    assert.deepEqual(prep.rows.map(x => x.image), ['ag1.png', 'ag2.png']);
    assert.deepEqual(prep.rows.map(x => x.number), [1, 2]);
    assert.deepEqual(prep.warnings, [], 'another hymn\'s missing music is not this list\'s warning');
    const dropped = Data.resolve('sunday_hymns', { slot: 'hymnEnd2' }, SUNDAYS(), { today: TODAY });
    assert.equal(dropped.rows.length, 0, 'a hymn the Sunday has dropped has no pages');
    assert.match(dropped.warnings[0], /final hymn/i);
    assert.equal(Data.describeParams('sunday_hymns', { slot: 'hymnEnd1' }), 'this Sunday · closing hymn');
});

test('a hymn with empty or missing page assets skips them and does not invent images', () => {
    const data = SUNDAYS();
    data.hymns.h1.versions[0].pages = ['ag1.png', '', { url: '  ' }, { src: 'ag3.png' }, null];
    const r = Data.resolve('sunday_hymns', {}, data, { today: TODAY });
    const grace = r.rows.filter(x => x.name === 'Amazing Grace');
    assert.deepEqual(grace.map(x => x.image), ['ag1.png', 'ag3.png']);
    assert.equal(grace.length, 2);
    grace.forEach(row => assert.ok(row.image, 'no invented placeholder'));
    assert.deepEqual(Data.hymnSheetPages({ versions: [{ pages: ['', null, { url: '' }] }] }), []);
    assert.deepEqual(Data.hymnSheetPages(null), []);
});

test('Sunday booklet text resolves from typedContent and does not leak across Sundays', () => {
    const data = SUNDAYS();
    data.services['2026-09-06'].typedContent = {
        pastoralPrayer: { nation: 'Kenya', capital: 'Nairobi' },
        mosaicKids: { lessonTitle: 'The Lost Sheep', lessonVerse: 'Luke 15' },
        announcements: [{ title: 'Picnic', content: 'Bring a plate' }],
    };
    data.services['2026-09-13'].typedContent = {
        pastoralPrayer: { nation: 'Japan' },
        mosaicKids: { lessonTitle: 'Jonah' },
        announcements: [{ title: 'Choir practice', content: 'Thursday' }],
    };
    const a = Data.resolve('sunday_typed', { when: { mode: 'this' } }, data, { today: TODAY });
    const b = Data.resolve('sunday_typed', { when: { mode: 'next' } }, data, { today: TODAY });
    assert.equal(a.rows[0].prayerNation, 'Kenya');
    assert.equal(a.rows[0].kidsLessonTitle, 'The Lost Sheep');
    assert.match(a.rows[0].announcements, /Picnic/);
    assert.equal(b.rows[0].prayerNation, 'Japan');
    assert.equal(b.rows[0].kidsLessonTitle, 'Jonah');
    assert.ok(!String(b.rows[0].announcements).includes('Picnic'));
    assert.ok(!String(a.rows[0].announcements).includes('Choir'));
    assert.ok(!String(b.rows[0].prayerNation).includes('Kenya'));
});

test('printed event announcements follow the typed ones and are not written onto the Sunday', () => {
    const data = SUNDAYS();
    const date = '2026-09-06';
    data.services[date].typedContent = {
        announcements: [{ title: 'Picnic', content: 'Bring a plate' }],
    };
    const before = JSON.parse(JSON.stringify(data.services[date].typedContent));
    data.printedEventsBySunday = {};
    data.printedEventsBySunday[date] = [
        {
            id: 'hall',
            name: 'Hall work day',
            visibility: 'public',
            startTime: '09:00',
            occurrence: { id: 'hall', date: '2026-09-12', name: 'Hall work day' },
            announcements: [{
                id: 'work', title: 'Work day', prose: 'Bring gloves\nand a hat',
                way: 'printed', weeks: 1, order: 0,
            }],
        },
        {
            id: 'members',
            name: 'Members meeting',
            visibility: 'member',
            occurrence: { id: 'members', date: '2026-09-10' },
            announcements: [{
                id: 'mm', title: 'Members only', prose: 'Stay after',
                way: 'printed', weeks: 1, order: 0,
            }],
        },
        {
            id: 'elders',
            name: 'Session',
            visibility: 'elder',
            occurrence: { id: 'elders', date: '2026-09-10' },
            announcements: [{
                id: 'session', title: 'Session', prose: 'Closed',
                way: 'printed', weeks: 1, order: 0,
            }],
        },
        {
            id: 'told-event',
            name: 'Public picnic',
            visibility: 'public',
            occurrence: { id: 'told-event', date: '2026-09-12' },
            announcements: [{
                id: 'told', title: 'Choir', prose: 'Practice',
                way: 'told', tags: ['choir'],
            }],
        },
        {
            id: 'sunday_service',
            seriesId: 'sunday_service',
            name: 'Sunday Service',
            visibility: 'member',
            rule: { freq: 'weekly', weekday: 0, startDate: '2023-01-01', time: '10:30' },
            startTime: '10:30',
            stored: [],
            announcements: [{
                id: 'lunch', title: 'Lunch', prose: 'After church',
                way: 'printed', weeks: 1, order: 0,
            }],
        },
    ];
    const resolved = Data.resolve('sunday_typed', {}, data, { today: TODAY, level: 'editor' });
    const text = resolved.rows[0].announcements;
    assert.match(text, /^Picnic\nBring a plate/);
    assert.match(text, /Lunch\nAfter church/);
    assert.match(text, /Work day\nBring gloves\nand a hat/);
    assert.ok(text.indexOf('Lunch') < text.indexOf('Work day'));
    assert.equal(resolved.rows[0].announcementCount, 3);
    assert.ok(!text.includes('Members only'));
    assert.ok(!text.includes('Session'));
    assert.ok(!text.includes('Choir'));
    assert.deepEqual(data.services[date].typedContent, before);

    data.printedEventsBySunday[date][0].announcements[0].title = 'Work morning';
    const edited = Data.resolve('sunday_typed', {}, data, { today: TODAY, level: 'editor' });
    assert.match(edited.rows[0].announcements, /Work morning/);
    assert.ok(!edited.rows[0].announcements.includes('Work day'));
    assert.deepEqual(data.services[date].typedContent, before);

    data.printedEventsBySunday[date][0].announcements = [];
    const removed = Data.resolve('sunday_typed', {}, data, { today: TODAY, level: 'editor' });
    assert.ok(!removed.rows[0].announcements.includes('Work morning'));
    assert.match(removed.rows[0].announcements, /Picnic/);
    assert.match(removed.rows[0].announcements, /Lunch/);
    assert.deepEqual(data.services[date].typedContent, before);
});

test('announcements of a Sunday are an iterable list — typed first, then printed event lines', () => {
    const source = Data.sourceByKey('sunday_announcements');
    assert.ok(source, 'the catalog has one row per announcement');
    assert.equal(source.shape, 'list');
    assert.equal(source.minLevel, 'viewer');
    assert.ok(Data.listSourcesFor('viewer').some(x => x.key === 'sunday_announcements'));
    const data = SUNDAYS();
    const date = '2026-09-06';
    data.services[date].typedContent = {
        announcements: [{ title: 'Picnic', content: 'Bring a plate' }],
    };
    data.printedEventsBySunday = {};
    data.printedEventsBySunday[date] = [{
        id: 'hall',
        name: 'Hall work day',
        visibility: 'public',
        occurrence: { id: 'hall', date: '2026-09-12' },
        announcements: [{
            id: 'work', title: 'Work day', prose: 'Bring gloves',
            way: 'printed', weeks: 1, order: 0,
        }],
    }];
    const r = Data.resolve('sunday_announcements', {}, data, { today: TODAY });
    assert.deepEqual(r.rows.map(x => x.title), ['Picnic', 'Work day']);
    assert.deepEqual(r.rows.map(x => x.content), ['Bring a plate', 'Bring gloves']);
    assert.deepEqual(r.rows.map(x => x.number), [1, 2]);
    assert.equal(r.rows[1].text, 'Work day\nBring gloves');
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(Data.needsFor('sunday_announcements', {}, TODAY), {
        services: [date],
        printedAnnouncements: [date],
    });
    const empty = Data.resolve('sunday_announcements', {}, { services: {} }, { today: TODAY });
    assert.equal(empty.rows.length, 0);
    assert.match(empty.warnings[0], /Nothing is planned yet/);
});

test('a Printable bound to Sunday booklet text reads the typed fields', () => {
    const Render = require('../public/printable-render-core.js');
    const Core = require('../public/printable-core.js');
    const data = SUNDAYS();
    data.services['2026-09-06'].typedContent = {
        pastoralPrayer: { nation: 'Kenya' },
        mosaicKids: { lessonTitle: 'The Lost Sheep' },
        announcements: [{ title: 'Picnic', content: 'Park' }],
    };
    const resolved = Data.resolve('sunday_typed', {}, data, { today: TODAY });
    const t = Core.buildTemplate({ paper: 'letter', dpi: 96 });
    const page = Core.buildPage(t, { id: 'pg', nodes: [
        { id: 'nation', tag: 'p', text: 'Country', bind: { text: { scope: 'global', source: 'sunday_typed', field: 'prayerNation' } } },
        { id: 'kids', tag: 'p', text: 'Lesson', bind: { text: { scope: 'global', source: 'sunday_typed', field: 'kidsLessonTitle' } } },
        { id: 'ann', tag: 'p', text: 'News', bind: { text: { scope: 'global', source: 'sunday_typed', field: 'announcements' } } },
    ] });
    const r = Render.expandPage(page, {
        rowsFor: () => null,
        valueFor: (bind) => {
            const v = resolved.rows[0][bind.field];
            return v ? { ok: true, value: v } : { ok: false, why: 'empty' };
        },
    });
    assert.equal(r.nodes[0].text, 'Kenya');
    assert.equal(r.nodes[1].text, 'The Lost Sheep');
    assert.match(r.nodes[2].text, /Picnic/);
});

test('bound text that has line breaks keeps them, as the old guide did', () => {
    const Render = require('../public/printable-render-core.js');
    const Core = require('../public/printable-core.js');
    const t = Core.buildTemplate({ paper: 'letter', dpi: 96 });
    const page = Core.buildPage(t, { id: 'pg', nodes: [
        { id: 'ann', tag: 'p', text: 'News', bind: { text: { scope: 'item', field: 'text' } } },
        { id: 'one', tag: 'p', text: 'One line', bind: { text: { scope: 'item', field: 'title' } } },
    ] });
    const r = Render.expandPage(page, {
        rowsFor: () => null,
        valueFor: (bind) => {
            if (bind.field === 'text') return { ok: true, value: 'Work day\nBring gloves' };
            return { ok: true, value: 'Picnic' };
        },
    });
    assert.equal(r.nodes[0].style['white-space'], 'pre-line');
    assert.equal(r.nodes[1].style && r.nodes[1].style['white-space'], undefined);
});

test('Sundays in a range make a preaching schedule', () => {
    const r = Data.resolve('sundays', { range: { mode: 'relative', fromDays: 0, toDays: 14 } }, SUNDAYS(), { today: TODAY });
    assert.deepEqual(r.rows.map(x => x.theme), ['Grace', 'Hope']);
    assert.equal(r.rows[1].sermon, 'John 3');
});

// ── Sundays, counted ─────────────────────────────────────────────────────────
//
// The old Service Guide printed the next five Sundays — date, preacher,
// sermon text, TBA where nobody was down yet. A Sunday exists whether or not
// anybody has written it (ServiceDatesCore), so the list walks the calendar
// and fills each Sunday from whatever is planned.

test('Sundays start as a preaching schedule: five from this Sunday, planned or not, TBA where nobody is down', () => {
    assert.deepEqual(Data.defaultParams('sundays').range, { mode: 'weeks', count: 5, start: { mode: 'this' } });
    const r = Data.resolve('sundays', {}, SUNDAYS(), { today: TODAY });
    assert.deepEqual(r.rows.map(x => x.shortDate), ['Sep 6', 'Sep 13', 'Sep 20', 'Sep 27', 'Oct 4']);
    assert.deepEqual(r.rows.map(x => x.dateShort), ['6 Sep', '13 Sep', '20 Sep', '27 Sep', '4 Oct']);
    assert.deepEqual(r.rows.map(x => x.preacher), ['Pastor Sam', 'TBA', 'TBA', 'TBA', 'TBA']);
    assert.deepEqual(r.rows.map(x => x.sermon), ['Romans 8', 'John 3', 'TBA', 'TBA', 'TBA']);
    assert.equal(r.rows[2].date, 'Sunday 20 September 2026');
    assert.equal(r.rows[2]._id, '2026-09-20');
    assert.deepEqual(r.warnings, [], 'a Sunday nobody has planned yet is not a failure');
    assert.deepEqual(Data.needsFor('sundays', {}, TODAY), { serviceRange: { from: '2026-09-06', to: '2026-10-10' } });
});

test('what is not planned yet reads as whatever the query says, or stays blank', () => {
    const said = Data.resolve('sundays', { notPlanned: 'To be announced' }, SUNDAYS(), { today: TODAY });
    assert.equal(said.rows[1].preacher, 'To be announced');
    assert.equal(said.rows[1].theme, 'Hope', 'what is planned is never covered over');
    const blank = Data.resolve('sundays', { notPlanned: '' }, SUNDAYS(), { today: TODAY });
    assert.equal(blank.rows[1].preacher, '', 'blank leaves the stand-in to show, as before');
    assert.equal(blank.rows[2].sermon, '');
});

test('the date, a baptism and a dropped hymn are never "to be announced"', () => {
    const data = SUNDAYS();
    data.services['2026-09-06'].removedHymns = ['hymnEnd2', 'hymnMid2'];
    const r = Data.resolve('sundays', {}, data, { today: TODAY });
    const first = r.rows[0];
    assert.equal(first.baptism, '', 'a Sunday without a baptism has no baptism to announce');
    assert.equal(first.hymnMid2, '', 'a hymn the Sunday has dropped is not coming later');
    assert.equal(first.hymnEnd2, '', 'nor does it print the name it had before it was dropped, as the old guide did not');
    assert.equal(first.hymnMid1, 'TBA', 'a hymn still to be chosen is');
    assert.equal(first.serviceLeader, 'Lee');
    assert.equal(first.prayerMale, 'Tom');
    assert.equal(first.prayerFemale, 'TBA');
    assert.equal(r.rows[4].date, 'Sunday 4 October 2026');
    assert.equal(r.rows[4].shortDate, 'Oct 4');
    assert.equal(r.rows[4].dateShort, '4 Oct', 'a date is never TBA — only the text fields can be');
});

test('Sundays can be kept to those already planned, as the old guide did', () => {
    const r = Data.resolve('sundays', { which: 'planned' }, SUNDAYS(), { today: TODAY });
    assert.deepEqual(r.rows.map(x => x.shortDate), ['Sep 6', 'Sep 13']);
    const none = Data.resolve('sundays', { which: 'planned' }, { services: {} }, { today: TODAY });
    assert.equal(none.rows.length, 0);
    assert.deepEqual(none.warnings, ['Nothing is planned yet for the 5 Sundays from this Sunday.']);
});

test('a service planned on another day is on the schedule too, as it was on the old guide', () => {
    const data = SUNDAYS();
    data.services['2026-09-25'] = { preacher: 'Guest Gil', liturgy: { sermon: 'Luke 2' } };
    const r = Data.resolve('sundays', {}, data, { today: TODAY });
    assert.deepEqual(r.rows.map(x => x.shortDate), ['Sep 6', 'Sep 13', 'Sep 20', 'Sep 25', 'Sep 27', 'Oct 4']);
    assert.equal(r.rows[3].date, 'Friday 25 September 2026');
    assert.equal(r.rows[3].preacher, 'Guest Gil');
    const planned = Data.resolve('sundays', { which: 'planned' }, data, { today: TODAY });
    assert.deepEqual(planned.rows.map(x => x.shortDate), ['Sep 6', 'Sep 13', 'Sep 25']);
});

test('a range with no Sunday in it says so', () => {
    const r = Data.resolve('sundays', { range: { mode: 'static', from: '2026-09-07', to: '2026-09-12' } }, SUNDAYS(), { today: TODAY });
    assert.equal(r.rows.length, 0);
    assert.deepEqual(r.warnings, ['There is no Sunday from 7 September 2026 to 12 September 2026.']);
});

test('an older service with its sermon kept outside the liturgy still reads it', () => {
    const r = Data.resolve('sundays', {}, { services: { '2026-09-06': { preacher: { id: 'p9', name: 'Pastor Sam' }, sermon: 'Psalm 23' } } }, { today: TODAY });
    assert.equal(r.rows[0].sermon, 'Psalm 23', 'the old guide read it there as well');
    assert.equal(r.rows[0].preacher, 'Pastor Sam', 'a preacher stored as a person reads as their name');
});

test('one Sunday from this Sunday reads the same as the single Sunday', () => {
    const one = Data.resolve('sundays', { range: { mode: 'weeks', count: 1, start: { mode: 'this' } }, notPlanned: '' }, SUNDAYS(), { today: TODAY });
    const single = Data.resolve('sunday', { when: { mode: 'this' } }, SUNDAYS(), { today: TODAY });
    assert.equal(one.rows.length, 1);
    assert.deepEqual(Data.sourceByKey('sundays').fields.map(f => f.key), Data.sourceByKey('sunday').fields.map(f => f.key), 'a Sunday row is one shape');
    Data.sourceByKey('sunday').fields.forEach(f => assert.equal(one.rows[0][f.key], single.rows[0][f.key], f.key));
    assert.equal(single.rows[0].shortDate, 'Sep 6');
});

test('the query builder offers how many Sundays, which ones, and what an unplanned one reads as', () => {
    const specs = Data.querySpecsFor('sundays', 'editor');
    assert.deepEqual(specs.map(s => s.key), ['range', 'which', 'notPlanned']);
    assert.equal(specs.find(s => s.key === 'notPlanned').default, 'TBA');
    assert.ok(specs.find(s => s.key === 'notPlanned').placeholder, 'an empty box says what empty means');
    assert.deepEqual(Data.querySpecsFor('sundays', 'viewer').map(s => s.key), ['range', 'which', 'notPlanned'], 'nothing here sits above a viewer');
    assert.equal(Data.describeParams('sundays', {}), 'for the 5 Sundays from this Sunday');
    assert.equal(Data.describeParams('sundays', { which: 'planned', notPlanned: 'TBC' }),
        'for the 5 Sundays from this Sunday · only Sundays already planned · not planned yet reads as "TBC"');
});

test('a stored Sundays query from before still reads its own dates', () => {
    const r = Data.resolve('sundays', { range: { mode: 'relative', fromDays: 0, toDays: 21 } }, SUNDAYS(), { today: TODAY });
    assert.deepEqual(r.rows.map(x => x.shortDate), ['Sep 6', 'Sep 13', 'Sep 20'], 'every Sunday in the window gets its row');
    const fixed = Data.resolve('sundays', { range: { mode: 'static', from: '2026-09-01', to: '2026-09-14' } }, SUNDAYS(), { today: '2027-01-01' });
    assert.deepEqual(fixed.rows.map(x => x.theme), ['Grace', 'Hope']);
});

test('a range of years does not become a runaway list', () => {
    const r = Data.resolve('sundays', { range: { mode: 'static', from: '2000-01-01', to: '2099-12-31' } }, { services: {} }, { today: TODAY });
    assert.ok(r.rows.length <= 520);
    assert.match(r.warnings[0], /Only the first 520 Sundays/);
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

test('event dates can be the weeks from a Sunday, with a short date and the day to print', () => {
    const range = { mode: 'weeks', count: 2, start: { mode: 'this' } };
    const r = Data.resolve('event_dates', { range: range }, EVENTS(), { today: TODAY });
    assert.deepEqual(r.rows.map(x => x.name), ['Bible study', 'Members\' meeting']);
    assert.deepEqual(r.rows.map(x => x.shortDate), ['Sep 8', 'Sep 10']);
    assert.deepEqual(r.rows.map(x => x.weekday), ['Tuesday', 'Thursday']);
    assert.deepEqual(Data.needsFor('event_dates', { range: range }, TODAY).occurrenceRange, { from: '2026-09-06', to: '2026-09-19' });
    assert.equal(Data.describeParams('event_dates', { range: range }), 'in the 2 weeks from this Sunday');
    const later = Data.resolve('event_dates', { range: { mode: 'weeks', count: 1, start: { mode: 'next' } } }, EVENTS(), { today: TODAY });
    assert.equal(later.rows.length, 0);
    assert.deepEqual(later.warnings, ['Nothing is on in the week from next Sunday.']);
});

test('event dates can be the next few dates, without counting days', () => {
    const fortnight = Data.resolve('event_dates', { range: { mode: 'relative', fromDays: 0, toDays: 14 }, seriesId: 'bs' }, EVENTS(), { today: TODAY });
    assert.deepEqual(fortnight.rows.map(x => x._id), ['bs_2026-09-08'], 'fourteen days misses the second study');
    const r = Data.resolve('event_dates', { range: { mode: 'count', count: 2 }, seriesId: 'bs' }, EVENTS(), { today: TODAY });
    assert.deepEqual(r.rows.map(x => x._id), ['bs_2026-09-08', 'bs_2026-10-20']);
    const data = EVENTS();
    data.occurrences.push({ id: 'bs_2028-01-04', seriesId: 'bs', date: '2028-01-04' });
    const bounded = Data.resolve('event_dates', { range: { mode: 'count', count: 3 }, seriesId: 'bs' }, data, { today: TODAY });
    assert.deepEqual(bounded.rows.map(x => x._id), ['bs_2026-09-08', 'bs_2026-10-20'], 'a count query stays inside the window the store fetched');
    assert.match(bounded.warnings.join(' '), /Only 2 dates/);
    const needs = Data.needsFor('event_dates', { range: { mode: 'count', count: 2 } }, TODAY);
    assert.equal(needs.occurrenceRange.from, TODAY);
    assert.ok(needs.occurrenceRange.to >= '2026-10-20');
    assert.equal(Data.describeParams('event_dates', { range: { mode: 'count', count: 2 } }), 'the next 2 dates');
    assert.equal(Data.describeParams('event_dates', { range: { mode: 'count', count: 1 } }), 'the next date');
});

test('event dates can say who is down for a role on each date — a rota — to an editor', () => {
    const data = EVENTS();
    data.occurrences.push(
        { id: 'mm_2026-10-08', seriesId: 'mm', date: '2026-10-08', assignments: [{ personId: 'p1', roleSlug: 'sermonette', state: 'pending' }] },
        { id: 'mm_2026-10-22', seriesId: 'mm', date: '2026-10-22', assignments: [{ personId: 'p2', roleSlug: 'sermonette', state: 'declined' }] },
    );
    const q = { range: { mode: 'weeks', count: 8, start: { mode: 'this' } }, seriesId: 'mm', roleSlug: 'sermonette' };
    const r = Data.resolve('event_dates', q, data, { today: TODAY, level: 'editor' });
    assert.deepEqual(r.rows.map(x => x.shortDate), ['Sep 10', 'Oct 8', 'Oct 22']);
    assert.deepEqual(r.rows.map(x => x.holder), ['Confirmed Connie', 'Pending Pete', ''],
        'whoever has confirmed, else whoever was asked; somebody who declined is not down');
    assert.deepEqual(r.warnings, ['Pending Pete has not confirmed Sermonette on 8 October 2026 yet.']);
    assert.equal(Data.resolve('event_dates', { range: q.range, seriesId: 'mm' }, data, { today: TODAY, level: 'editor' }).rows[0].holder, '', 'no role chosen, nobody named');

    const member = Data.resolve('event_dates', q, data, { today: TODAY, level: 'member' });
    assert.equal(member.rows.length, 3, 'a member still reads the dates');
    assert.equal(member.rows[0].holder, undefined, 'but never a roster, even through a wire an editor made');
    assert.deepEqual(member.warnings, [], 'nor a roster in words: who has not confirmed is an editor\'s to know');
    assert.deepEqual(Data.querySpecsFor('event_dates', 'member').map(s => s.key), ['range', 'seriesId']);
    assert.deepEqual(Data.querySpecsFor('event_dates', 'editor').map(s => s.key), ['range', 'seriesId', 'roleSlug']);
    assert.equal(Data.sourcesFor('member').find(s => s.key === 'event_dates').fields.some(f => f.key === 'holder'), false);

    const needs = Data.needsFor('event_dates', q, TODAY);
    assert.equal(needs.rosters, 'mm');
    assert.equal(needs.roles, true);
    assert.equal(needs.people, true);
    assert.equal(Data.needsFor('event_dates', { range: q.range }, TODAY).rosters, undefined, 'no role, no roster read');
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
    assert.deepEqual(Data.needsFor('sunday_typed', {}, TODAY).services, ['2026-09-06']);
    assert.deepEqual(Data.needsFor('sunday_typed', {}, TODAY).printedAnnouncements, ['2026-09-06']);
    assert.equal(Data.needsFor('people', {}, TODAY).people, true);
});

test('params read back as a sentence for the element panel', () => {
    assert.equal(Data.describeParams('people', { membership: 'non_members', tag: 'Choir' }), 'non-members · with the tag "Choir"');
    assert.equal(Data.describeParams('sunday', { when: { mode: 'next' } }), 'next Sunday');
    assert.match(Data.describeParams('event_dates', {}), /from today to 14 days from now/);
});
