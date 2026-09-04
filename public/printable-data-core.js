// Printable Data Core — everything the website can tell a Printable, and how
// each of those things is read out of plain data.
//
// The **catalog** is the list of **sources** the data drawer offers, grouped
// by where in the app they come from (People, Sunday, Events, Forms). A
// source is either a **single** (one row — this Sunday, who holds a role) or
// a **list** (many rows — the directory, the next fortnight's events). Every
// source declares its **fields** (what a row carries, each with a kind: text,
// image, date, number), its **params** (what has to be chosen before it can
// be read — which Sunday, which event, which form) and its **filters**, and
// the lowest Permission Level that may read it.
//
// ⚠ THE CATALOG IS THE PERMISSION BOUNDARY'S FIRST HALF. Nothing elder-only
// is in it at all — not a Shepherding Note, not a Prayer Request, not a
// relationship — so the drawer cannot offer what the rules would refuse. The
// second half is `firestore.rules`, which still refuses a read this module
// merely omits. `sourcesFor(level)` is what the drawer draws from.
//
// The **resolvers** turn what the store fetched (plain records) into rows of
// field values. They are pure: they take today's date as an argument, never
// read the clock, never touch Firestore, and return the same rows for the
// same data. That is what makes "live data" testable — the store fetches,
// this decides.
//
// Optional neighbours (ADR-0045): ShepherdingCore for the membership label and
// HouseholdCore for household grouping are used when loaded and replaced by a
// plain fallback when not, so this module runs on its own under Node.

(function (global) {
    'use strict';

    const LEVELS = ['viewer', 'member', 'editor', 'admin', 'elder', 'super_admin'];

    function levelRank(level) {
        const i = LEVELS.indexOf(level);
        return i < 0 ? -1 : i;
    }

    function mayRead(level, minLevel) {
        return levelRank(level) >= levelRank(minLevel);
    }

    // ── Dates ────────────────────────────────────────────────────────────────
    //
    // Local time, never UTC (the date-utils rule, restated to stay
    // dependency-free).

    function isDateStr(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

    function parseDate(str) {
        const [y, m, d] = String(str).split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    function toDateStr(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + d;
    }

    function addDays(dateStr, n) {
        const d = parseDate(dateStr);
        d.setDate(d.getDate() + n);
        return toDateStr(d);
    }

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // "Sunday 14 June 2026" — how a date reads on paper.
    function formatDate(dateStr, style) {
        if (!isDateStr(dateStr)) return String(dateStr || '');
        const d = parseDate(dateStr);
        if (style === 'short') return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3);
        if (style === 'medium') return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
        return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    }

    // The Sunday on or after a date.
    function sundayOnOrAfter(dateStr) {
        const d = parseDate(dateStr);
        const delta = (7 - d.getDay()) % 7;
        return addDays(dateStr, delta);
    }

    // Which Sunday a `when` names. "This Sunday" is the one coming (today, if
    // today is a Sunday); "next Sunday" is the one after that; a date is that
    // date's Sunday.
    function resolveWhen(when, today) {
        const w = when || {};
        if (w.mode === 'date' && isDateStr(w.date)) return sundayOnOrAfter(w.date);
        const thisSunday = sundayOnOrAfter(today);
        if (w.mode === 'next') return addDays(thisSunday, 7);
        if (w.mode === 'last') return addDays(thisSunday, -7);
        return thisSunday;
    }

    // A date range, static (two dates) or relative (days from today, so the
    // same Printable shows a different fortnight when it is opened next
    // month). Always ordered, never backwards.
    function resolveRange(range, today) {
        const r = range || {};
        let from, to;
        if (r.mode === 'static' && isDateStr(r.from) && isDateStr(r.to)) {
            from = r.from; to = r.to;
        } else {
            const a = Number.isFinite(Number(r.fromDays)) ? Number(r.fromDays) : 0;
            const b = Number.isFinite(Number(r.toDays)) ? Number(r.toDays) : 14;
            from = addDays(today, a); to = addDays(today, b);
        }
        if (from > to) { const t = from; from = to; to = t; }
        return { from: from, to: to };
    }

    function describeRange(range) {
        const r = range || {};
        if (r.mode === 'static') return 'from ' + formatDate(r.from, 'medium') + ' to ' + formatDate(r.to, 'medium');
        const a = Number(r.fromDays) || 0, b = Number.isFinite(Number(r.toDays)) ? Number(r.toDays) : 14;
        const say = n => n === 0 ? 'today' : n > 0 ? n + ' day' + (n === 1 ? '' : 's') + ' from now' : (-n) + ' day' + (n === -1 ? '' : 's') + ' ago';
        return 'from ' + say(a) + ' to ' + say(b);
    }

    // ── The catalog ──────────────────────────────────────────────────────────

    const WHEN_PARAM = { key: 'when', label: 'Which Sunday', kind: 'when', default: { mode: 'this' } };
    const RANGE_PARAM = { key: 'range', label: 'Dates', kind: 'range', default: { mode: 'relative', fromDays: 0, toDays: 14 } };

    const LITURGY_ORDER = ['baptism', 'preparatoryHymn', 'callToWorship', 'hymn1', 'hymn2', 'callToConfession',
        'assuranceOfPardon', 'hymnMid1', 'hymnMid2', 'scriptureReading', 'prayerMale', 'prayerFemale', 'sermon',
        'hymnEnd1', 'hymnEnd2', 'benediction'];
    const LITURGY_LABELS = {
        baptism: 'Baptism', preparatoryHymn: 'Preparatory hymn', callToWorship: 'Call to worship', hymn1: 'Hymn',
        hymn2: 'Hymn', callToConfession: 'Call to confession', assuranceOfPardon: 'Assurance of pardon',
        hymnMid1: 'Hymn', hymnMid2: 'Hymn', scriptureReading: 'Scripture reading', prayerMale: 'Prayer',
        prayerFemale: 'Prayer', sermon: 'Sermon', hymnEnd1: 'Hymn', hymnEnd2: 'Hymn', benediction: 'Benediction',
    };
    const HYMN_SLOTS = ['preparatoryHymn', 'hymn1', 'hymn2', 'hymnMid1', 'hymnMid2', 'hymnEnd1', 'hymnEnd2'];
    const HYMN_SLOT_LABELS = {
        preparatoryHymn: 'Preparatory hymn', hymn1: 'First hymn', hymn2: 'Second hymn', hymnMid1: 'Third hymn',
        hymnMid2: 'Fourth hymn', hymnEnd1: 'Closing hymn', hymnEnd2: 'Final hymn',
    };

    const SOURCES = [
        {
            key: 'people', region: 'People', label: 'People in the directory', shape: 'list', minLevel: 'member',
            blurb: 'One row per person. Filter to members, non-members or everyone.',
            fields: [
                { key: 'name', label: 'Full name', kind: 'text' },
                { key: 'firstName', label: 'First name', kind: 'text' },
                { key: 'lastName', label: 'Last name', kind: 'text' },
                { key: 'photo', label: 'Photo', kind: 'image' },
                { key: 'email', label: 'Email', kind: 'text' },
                { key: 'phone', label: 'Phone', kind: 'text' },
                { key: 'address', label: 'Address', kind: 'text' },
                { key: 'birthday', label: 'Birthday', kind: 'date' },
                { key: 'membership', label: 'Membership', kind: 'text' },
                { key: 'stage', label: 'Membership stage', kind: 'text', minLevel: 'editor' },
                { key: 'tags', label: 'Tags', kind: 'text' },
                { key: 'household', label: 'Household', kind: 'text' },
            ],
            filters: [
                { key: 'membership', label: 'Who', kind: 'choice', default: 'members', options: [
                    { value: 'members', label: 'Members' }, { value: 'non_members', label: 'Non-members' }, { value: 'everyone', label: 'Everyone' },
                ] },
                { key: 'tag', label: 'With the tag', kind: 'text', default: '' },
                { key: 'includeInactive', label: 'Include inactive people', kind: 'bool', default: false },
                { key: 'sort', label: 'Sort by', kind: 'choice', default: 'last', options: [
                    { value: 'last', label: 'Last name' }, { value: 'first', label: 'First name' },
                ] },
            ],
        },
        {
            key: 'households', region: 'People', label: 'Households', shape: 'list', minLevel: 'member',
            blurb: 'One row per household — a family, or a person on their own.',
            fields: [
                { key: 'name', label: 'Household name', kind: 'text' },
                { key: 'members', label: 'Who is in it', kind: 'text' },
                { key: 'address', label: 'Address', kind: 'text' },
                { key: 'phone', label: 'Phone', kind: 'text' },
                { key: 'email', label: 'Email', kind: 'text' },
                { key: 'photo', label: 'Photo (first member)', kind: 'image' },
            ],
            filters: [
                { key: 'membership', label: 'Who', kind: 'choice', default: 'members', options: [
                    { value: 'members', label: 'Households with a member' }, { value: 'everyone', label: 'Everyone' },
                ] },
                { key: 'includeInactive', label: 'Include inactive people', kind: 'bool', default: false },
            ],
        },
        {
            key: 'sunday', region: 'Sunday', label: 'A Sunday', shape: 'single', minLevel: 'viewer',
            blurb: 'This Sunday, next Sunday, or a date — its theme, verse, people and every slot in the order of service.',
            params: [WHEN_PARAM],
            fields: [
                { key: 'date', label: 'Date', kind: 'date' },
                { key: 'theme', label: 'Theme', kind: 'text' },
                { key: 'keyVerse', label: 'Key verse', kind: 'text' },
                { key: 'preacher', label: 'Preacher', kind: 'text' },
                { key: 'serviceLeader', label: 'Service leader', kind: 'text' },
                { key: 'musicLeader', label: 'Music leader', kind: 'text' },
                { key: 'prayerMale', label: 'Prayer (man)', kind: 'text' },
                { key: 'prayerFemale', label: 'Prayer (woman)', kind: 'text' },
                { key: 'callToWorship', label: 'Call to worship', kind: 'text' },
                { key: 'callToConfession', label: 'Call to confession', kind: 'text' },
                { key: 'assuranceOfPardon', label: 'Assurance of pardon', kind: 'text' },
                { key: 'scriptureReading', label: 'Scripture reading', kind: 'text' },
                { key: 'sermon', label: 'Sermon passage', kind: 'text' },
                { key: 'benediction', label: 'Benediction', kind: 'text' },
                { key: 'preparatoryHymn', label: 'Preparatory hymn', kind: 'text' },
                { key: 'hymn1', label: 'First hymn', kind: 'text' },
                { key: 'hymn2', label: 'Second hymn', kind: 'text' },
                { key: 'hymnMid1', label: 'Third hymn', kind: 'text' },
                { key: 'hymnMid2', label: 'Fourth hymn', kind: 'text' },
                { key: 'hymnEnd1', label: 'Closing hymn', kind: 'text' },
                { key: 'hymnEnd2', label: 'Final hymn', kind: 'text' },
                { key: 'baptism', label: 'Baptism candidates', kind: 'text' },
            ],
        },
        {
            key: 'sunday_rows', region: 'Sunday', label: 'Order of service, as rows', shape: 'list', minLevel: 'viewer',
            blurb: 'One row per slot in service order, with its label and what is planned. Empty slots are left out.',
            params: [WHEN_PARAM],
            fields: [
                { key: 'label', label: 'Slot', kind: 'text' },
                { key: 'value', label: 'What is planned', kind: 'text' },
                { key: 'number', label: 'Row number', kind: 'number' },
            ],
        },
        {
            key: 'sunday_hymns', region: 'Sunday', label: 'Hymns of a Sunday', shape: 'list', minLevel: 'viewer',
            blurb: 'One row per hymn, with its sheet music where the hymn is in the hymn book.',
            params: [WHEN_PARAM],
            fields: [
                { key: 'name', label: 'Hymn name', kind: 'text' },
                { key: 'slot', label: 'Where it comes', kind: 'text' },
                { key: 'image', label: 'Sheet music (first page)', kind: 'image' },
                { key: 'attribution', label: 'Attribution', kind: 'text' },
            ],
        },
        {
            key: 'sundays', region: 'Sunday', label: 'Sundays in a range', shape: 'list', minLevel: 'viewer',
            blurb: 'A preaching schedule: one row per Sunday between two dates.',
            params: [RANGE_PARAM],
            fields: [
                { key: 'date', label: 'Date', kind: 'date' },
                { key: 'theme', label: 'Theme', kind: 'text' },
                { key: 'preacher', label: 'Preacher', kind: 'text' },
                { key: 'sermon', label: 'Sermon passage', kind: 'text' },
            ],
        },
        {
            key: 'event_dates', region: 'Events', label: 'Event dates in a range', shape: 'list', minLevel: 'viewer',
            blurb: 'One row per date something is on, between two dates. Cancelled dates are left out.',
            params: [RANGE_PARAM, { key: 'seriesId', label: 'Only this event', kind: 'series', default: '' }],
            fields: [
                { key: 'name', label: 'Event', kind: 'text' },
                { key: 'date', label: 'Date', kind: 'date' },
                { key: 'time', label: 'Time', kind: 'text' },
                { key: 'location', label: 'Where', kind: 'text' },
                { key: 'description', label: 'About the event', kind: 'text' },
                { key: 'dateNote', label: 'About this date', kind: 'text' },
            ],
        },
        {
            key: 'role_holder', region: 'Events', label: 'Who holds a role', shape: 'single', minLevel: 'editor',
            blurb: 'Who is down for a role on the next date of an event — the person giving the sermonette at the members\' meeting.',
            params: [
                { key: 'seriesId', label: 'Event', kind: 'series', default: '' },
                { key: 'roleSlug', label: 'Role', kind: 'role', default: '' },
                { key: 'when', label: 'Which date', kind: 'when-event', default: { mode: 'next' } },
            ],
            fields: [
                { key: 'name', label: 'Who', kind: 'text' },
                { key: 'date', label: 'On', kind: 'date' },
                { key: 'role', label: 'Role', kind: 'text' },
                { key: 'event', label: 'Event', kind: 'text' },
            ],
        },
        {
            key: 'form_answers', region: 'Forms', label: 'Answers to a form', shape: 'list', minLevel: 'editor',
            blurb: 'One row per answer somebody gave, with a field per question — a sign-up sheet.',
            params: [{ key: 'formId', label: 'Form', kind: 'form', default: '' }],
            fields: [
                { key: 'personName', label: 'Who answered', kind: 'text' },
                { key: 'submittedAt', label: 'Answered on', kind: 'date' },
                { key: 'number', label: 'Row number', kind: 'number' },
            ],
            dynamicFields: true,
        },
    ];

    function sourceByKey(key) {
        return SOURCES.find(s => s.key === key) || null;
    }

    // What one Permission Level may see: the sources at or below their rank,
    // each with only the fields at or below it. A member's drawer is a strict
    // subset of an editor's, by construction.
    function sourcesFor(level) {
        return SOURCES
            .filter(s => mayRead(level, s.minLevel))
            .map(s => Object.assign({}, s, { fields: s.fields.filter(f => !f.minLevel || mayRead(level, f.minLevel)) }));
    }

    // The fields a source offers for a given choice of params — most are
    // fixed, a form's are one per question. `options.forms` carries the forms
    // the store loaded.
    function fieldsFor(source, params, options) {
        const s = typeof source === 'string' ? sourceByKey(source) : source;
        if (!s) return [];
        const base = s.fields.slice();
        if (s.key === 'form_answers') {
            const form = ((options && options.forms) || []).find(f => f.id === (params && params.formId));
            (form ? form.questions || [] : []).forEach(q => {
                if (!q || q.type === 'section') return;
                base.push({ key: 'q_' + q.id, label: q.text || 'Question', kind: q.type === 'image' ? 'image' : q.type === 'date' ? 'date' : q.type === 'number' || q.type === 'scale' ? 'number' : 'text', question: true });
            });
        }
        return base;
    }

    function defaultParams(source) {
        const s = typeof source === 'string' ? sourceByKey(source) : source;
        const out = {};
        ((s && s.params) || []).forEach(p => { out[p.key] = clone(p.default); });
        ((s && s.filters) || []).forEach(f => { out[f.key] = clone(f.default); });
        return out;
    }

    function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

    // Which kinds of field may be dropped on which kind of element.
    function accepts(nodeKind, fieldKind) {
        if (nodeKind === 'image') return fieldKind === 'image';
        if (nodeKind === 'text') return fieldKind === 'text' || fieldKind === 'date' || fieldKind === 'number';
        return false;
    }

    // Which property a field feeds on an element.
    function propFor(fieldKind) {
        return fieldKind === 'image' ? 'src' : 'text';
    }

    function fieldLabel(sourceKey, fieldKey, options) {
        const s = sourceByKey(sourceKey);
        if (!s) return fieldKey;
        const f = fieldsFor(s, (options && options.params) || {}, options).find(x => x.key === fieldKey);
        return s.label + ' › ' + (f ? f.label : fieldKey);
    }

    // ── People ───────────────────────────────────────────────────────────────

    function firstName(name) { return String(name || '').trim().split(/\s+/)[0] || ''; }
    function lastName(name) { const p = String(name || '').trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : ''; }

    function isInactive(person) {
        const m = (person && person.membership) || {};
        return !!m.inactive || m.status === 'inactive';
    }

    function isMember(person) {
        return ((person && person.tags) || []).indexOf('Member') !== -1;
    }

    const STAGE_LABEL = {
        visitor: 'Visitor', regular_attender: 'Regular attender', prospective_member: 'Prospective member',
        member: 'Member', moving_membership: 'Moving membership', previous_member: 'Previous member',
    };

    function membershipLabel(person, canEdit) {
        const SC = global && global.ShepherdingCore;
        if (SC && typeof SC.directoryMembershipLabel === 'function') {
            return SC.directoryMembershipLabel(person && person.membership, canEdit);
        }
        return isMember(person) ? 'Member' : 'Non-member';
    }

    function stageLabel(person) {
        const m = (person && person.membership) || {};
        if (isInactive(person)) return 'Inactive';
        return STAGE_LABEL[m.stage] || (isMember(person) ? 'Member' : 'Not on the track');
    }

    function passesMembership(person, who) {
        if (who === 'everyone') return true;
        if (who === 'non_members') return !isMember(person);
        return isMember(person);
    }

    function hasTag(person, tag) {
        const want = String(tag || '').trim().toLowerCase();
        if (!want) return true;
        return ((person && person.tags) || []).some(t => String(t).toLowerCase() === want);
    }

    function comparePeople(sort) {
        return (a, b) => {
            const ka = sort === 'first' ? firstName(a.name) + ' ' + lastName(a.name) : lastName(a.name) + ' ' + firstName(a.name);
            const kb = sort === 'first' ? firstName(b.name) + ' ' + lastName(b.name) : lastName(b.name) + ' ' + firstName(b.name);
            return ka.localeCompare(kb) || String(a.name || '').localeCompare(String(b.name || ''));
        };
    }

    // Households, the way the foyer groups people: HouseholdCore when it is
    // loaded; families then singletons when it is not.
    function householdsOf(data) {
        const HC = global && global.HouseholdCore;
        const people = data.people || [];
        if (HC && typeof HC.householdsFromDirectory === 'function') {
            return HC.householdsFromDirectory(people, data.families || [], data.households || []);
        }
        const byId = {};
        people.forEach(p => { if (p && p.id) byId[p.id] = p; });
        const seated = {};
        const out = [];
        (data.families || []).forEach(f => {
            const ids = [f.husbandId, f.wifeId].concat(f.childIds || []).filter(id => id && byId[id] && !seated[id]);
            if (!ids.length) return;
            ids.forEach(id => { seated[id] = true; });
            const members = ids.map(id => ({ personId: id, name: byId[id].name || '', kid: !!byId[id].kid }));
            out.push({ id: 'family:' + f.id, name: householdName(members), members: members });
        });
        people.forEach(p => {
            if (!p || !p.id || seated[p.id]) return;
            out.push({ id: 'person:' + p.id, name: householdName([{ personId: p.id, name: p.name || '' }]), members: [{ personId: p.id, name: p.name || '', kid: !!p.kid }] });
        });
        return out;
    }

    function householdName(members) {
        const last = lastName(members[0] && members[0].name) || firstName(members[0] && members[0].name);
        return last ? 'The ' + last + ' household' : 'Household';
    }

    function personRow(person, ctx, householdByPerson) {
        const c = (person && person.contact) || {};
        return {
            _id: person.id,
            name: person.name || '',
            firstName: firstName(person.name),
            lastName: lastName(person.name),
            photo: person.photoUrl || '',
            email: c.email || person.email || '',
            phone: c.phone || person.phone || '',
            address: c.address || person.address || '',
            birthday: person.birthday ? formatDate(person.birthday, 'medium') : '',
            membership: membershipLabel(person, false),
            stage: stageLabel(person),
            tags: (person.tags || []).join(', '),
            household: (householdByPerson && householdByPerson[person.id]) || '',
        };
    }

    function resolvePeople(params, data, ctx) {
        const p = Object.assign(defaultParams('people'), params || {});
        const homes = householdsOf(data);
        const householdByPerson = {};
        homes.forEach(h => (h.members || []).forEach(m => { householdByPerson[m.personId] = h.name; }));
        const rows = (data.people || [])
            .filter(person => person && person.name)
            .filter(person => p.includeInactive || !isInactive(person))
            .filter(person => passesMembership(person, p.membership))
            .filter(person => hasTag(person, p.tag))
            .sort(comparePeople(p.sort))
            .map(person => personRow(person, ctx, householdByPerson));
        const warnings = [];
        if (!rows.length) warnings.push('No people match — ' + (p.tag ? 'nobody carries the tag "' + p.tag + '"' : 'the directory has nobody in that group') + '.');
        return { rows: rows, warnings: warnings };
    }

    function resolveHouseholds(params, data, ctx) {
        const p = Object.assign(defaultParams('households'), params || {});
        const byId = {};
        (data.people || []).forEach(x => { if (x && x.id) byId[x.id] = x; });
        const rows = householdsOf(data)
            .map(h => {
                const members = (h.members || []).map(m => byId[m.personId]).filter(Boolean)
                    .filter(person => p.includeInactive || !isInactive(person));
                if (!members.length) return null;
                if (p.membership === 'members' && !members.some(isMember)) return null;
                const first = members[0];
                const c = (first && first.contact) || {};
                return {
                    _id: h.id,
                    name: h.name || householdName(members.map(m => ({ name: m.name }))),
                    members: members.map(m => m.name).join(', '),
                    address: c.address || '',
                    phone: c.phone || '',
                    email: c.email || '',
                    photo: first.photoUrl || '',
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.name.localeCompare(b.name));
        return { rows: rows, warnings: rows.length ? [] : ['No households match.'] };
    }

    // ── Sundays ──────────────────────────────────────────────────────────────

    // Folds legacy dotted field names ('liturgy.sermon') back into nested
    // values — the ADR-0034 trap. A nested value wins over a dotted one.
    function normaliseService(raw) {
        const data = {};
        Object.keys(raw || {}).forEach(k => { if (k.indexOf('.') < 0) data[k] = raw[k]; });
        Object.keys(raw || {}).forEach(k => {
            if (k.indexOf('.') < 0) return;
            const parts = k.split('.');
            let obj = data;
            for (let i = 0; i < parts.length - 1; i++) {
                if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] === null) obj[parts[i]] = {};
                obj = obj[parts[i]];
            }
            const leaf = parts[parts.length - 1];
            if (!obj[leaf]) obj[leaf] = raw[k];
        });
        return data;
    }

    function slotText(value) {
        if (value == null) return '';
        if (Array.isArray(value)) return value.map(v => (v && v.name) || (typeof v === 'string' ? v : '')).filter(Boolean).join(', ');
        if (typeof value === 'object') return value.name || '';
        return String(value);
    }

    function serviceAt(data, date) {
        const raw = (data.services || {})[date];
        return raw ? normaliseService(raw) : null;
    }

    function resolveSunday(params, data, ctx) {
        const p = Object.assign(defaultParams('sunday'), params || {});
        const date = resolveWhen(p.when, ctx.today);
        const s = serviceAt(data, date);
        const warnings = [];
        if (!s) warnings.push('Nothing is planned yet for ' + formatDate(date) + '.');
        const lit = (s && s.liturgy) || {};
        const row = {
            _id: date,
            date: formatDate(date),
            theme: (s && s.theme) || '',
            keyVerse: (s && s.keyVerse) || '',
            preacher: (s && s.preacher) || '',
            serviceLeader: (s && s.serviceLeader) || '',
            musicLeader: (s && s.musicLeader) || '',
            prayerMale: slotText(lit.prayerMale),
            prayerFemale: slotText(lit.prayerFemale),
            callToWorship: slotText(lit.callToWorship),
            callToConfession: slotText(lit.callToConfession),
            assuranceOfPardon: slotText(lit.assuranceOfPardon),
            scriptureReading: slotText(lit.scriptureReading),
            sermon: slotText(lit.sermon),
            benediction: slotText(lit.benediction),
            baptism: slotText(lit.baptism),
        };
        HYMN_SLOTS.forEach(k => { row[k] = slotText(lit[k]); });
        return { rows: [row], warnings: warnings, date: date };
    }

    function resolveSundayRows(params, data, ctx) {
        const p = Object.assign(defaultParams('sunday_rows'), params || {});
        const date = resolveWhen(p.when, ctx.today);
        const s = serviceAt(data, date);
        if (!s) return { rows: [], warnings: ['Nothing is planned yet for ' + formatDate(date) + '.'], date: date };
        const lit = s.liturgy || {};
        const removed = Array.isArray(s.removedHymns) ? s.removedHymns : [];
        const rows = [];
        LITURGY_ORDER.forEach(key => {
            if (removed.indexOf(key) !== -1) return;
            if (key === 'baptism' && !s.hasBaptism) return;
            const value = slotText(lit[key]);
            if (!value) return;
            let label = LITURGY_LABELS[key];
            if (key === 'scriptureReading' && lit.prayerLabel) label = 'Scripture reading / ' + lit.prayerLabel;
            rows.push({ _id: key, label: label, value: value, number: rows.length + 1 });
        });
        return { rows: rows, warnings: rows.length ? [] : ['The order of service for ' + formatDate(date) + ' is empty.'], date: date };
    }

    function resolveSundayHymns(params, data, ctx) {
        const p = Object.assign(defaultParams('sunday_hymns'), params || {});
        const date = resolveWhen(p.when, ctx.today);
        const s = serviceAt(data, date);
        if (!s) return { rows: [], warnings: ['Nothing is planned yet for ' + formatDate(date) + '.'], date: date };
        const lit = s.liturgy || {};
        const removed = Array.isArray(s.removedHymns) ? s.removedHymns : [];
        const rows = [];
        const warnings = [];
        HYMN_SLOTS.forEach(slot => {
            if (removed.indexOf(slot) !== -1) return;
            const h = lit[slot];
            if (!h || !h.name) return;
            const hymn = h.id ? (data.hymns || {})[h.id] : null;
            const pages = (hymn && hymn.versions && hymn.versions[0] && hymn.versions[0].pages) || [];
            if (!hymn) warnings.push('"' + h.name + '" is not in the hymn book, so it has no sheet music.');
            rows.push({
                _id: slot,
                name: (hymn && hymn.hymn_name) || h.name,
                slot: HYMN_SLOT_LABELS[slot] || slot,
                image: pages[0] || '',
                attribution: (hymn && hymn.attribution) || '',
                number: rows.length + 1,
            });
        });
        return { rows: rows, warnings: warnings, date: date };
    }

    function resolveSundays(params, data, ctx) {
        const p = Object.assign(defaultParams('sundays'), params || {});
        const r = resolveRange(p.range, ctx.today);
        const rows = Object.keys(data.services || {})
            .filter(d => d >= r.from && d <= r.to)
            .sort()
            .map(d => {
                const s = normaliseService(data.services[d]);
                return { _id: d, date: formatDate(s.date || d), theme: s.theme || '', preacher: s.preacher || '', sermon: slotText((s.liturgy || {}).sermon) };
            });
        return { rows: rows, warnings: rows.length ? [] : ['No Sundays are planned ' + describeRange(p.range) + '.'], range: r };
    }

    // ── Events ───────────────────────────────────────────────────────────────

    function seriesById(data) {
        const out = {};
        (data.series || []).forEach(s => { if (s && s.id) out[s.id] = s; });
        return out;
    }

    function occurrenceTime(o, series) {
        if (o.seriesId) return (series && series.recurrence && series.recurrence.time) || (series && series.time) || o.time || '';
        return o.time || '';
    }

    function niceTime(t) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
        if (!m) return String(t || '');
        let h = Number(m[1]);
        const suffix = h >= 12 ? 'pm' : 'am';
        h = h % 12 || 12;
        return h + ':' + m[2] + ' ' + suffix;
    }

    function isNotHappening(o) { return o.cancelled === true || !!o.movedTo; }

    function resolveEventDates(params, data, ctx) {
        const p = Object.assign(defaultParams('event_dates'), params || {});
        const r = resolveRange(p.range, ctx.today);
        const bySeries = seriesById(data);
        const rows = (data.occurrences || [])
            .filter(o => o && o.date >= r.from && o.date <= r.to)
            .filter(o => !isNotHappening(o))
            .filter(o => !p.seriesId || o.seriesId === p.seriesId)
            .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
            .map(o => {
                const series = bySeries[o.seriesId] || null;
                return {
                    _id: o.id || (o.seriesId + '_' + o.date),
                    name: (series && series.name) || o.name || '',
                    date: formatDate(o.date),
                    time: niceTime(occurrenceTime(o, series)),
                    location: o.location || (series && series.location) || '',
                    description: o.seriesId ? ((series && series.description) || '') : (o.description || ''),
                    dateNote: o.seriesId ? (o.description || '') : '',
                };
            });
        return { rows: rows, warnings: rows.length ? [] : ['Nothing is on ' + describeRange(p.range) + '.'], range: r };
    }

    function roleLabel(slug, data) {
        const role = (data.roles || []).find(x => x && (x.slug === slug || x.id === slug));
        if (role && role.name) return role.name;
        return String(slug || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    function personName(id, data) {
        const p = (data.people || []).find(x => x && x.id === id);
        return (p && p.name) || '';
    }

    function resolveRoleHolder(params, data, ctx) {
        const p = Object.assign(defaultParams('role_holder'), params || {});
        const bySeries = seriesById(data);
        const series = bySeries[p.seriesId] || null;
        const eventName = (series && series.name) || '';
        const roleName = roleLabel(p.roleSlug, data);
        const empty = (date, why) => ({ rows: [{ _id: date || '', name: '', date: date ? formatDate(date) : '', role: roleName, event: eventName }], warnings: [why] });
        if (!p.seriesId || !p.roleSlug) return empty('', 'Choose an event and a role.');
        const w = p.when || {};
        const from = (w.mode === 'date' && isDateStr(w.date)) ? w.date : ctx.today;
        const dates = (data.occurrences || [])
            .filter(o => o && o.seriesId === p.seriesId && o.date >= from && !isNotHappening(o))
            .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        if (!dates.length) return empty('', 'No date of ' + (eventName || 'that event') + ' is coming up from ' + formatDate(from, 'medium') + '.');
        const occ = dates[0];
        const held = (occ.assignments || []).filter(a => a && a.roleSlug === p.roleSlug && a.state !== 'declined');
        const pick = held.find(a => a.state === 'confirmed') || held[0];
        if (!pick) return empty(occ.date, 'Nobody is down for ' + roleName + ' at ' + (eventName || 'that event') + ' on ' + formatDate(occ.date, 'medium') + '.');
        const name = pick.personName || personName(pick.personId, data) || '';
        if (!name) return empty(occ.date, 'The person down for ' + roleName + ' on ' + formatDate(occ.date, 'medium') + ' is not in the directory.');
        return { rows: [{ _id: occ.date, name: name, date: formatDate(occ.date), role: roleName, event: eventName }], warnings: pick.state === 'confirmed' ? [] : [name + ' has not confirmed ' + roleName + ' on ' + formatDate(occ.date, 'medium') + ' yet.'] };
    }

    // ── Forms ────────────────────────────────────────────────────────────────

    function answerText(value) {
        if (value == null) return '';
        if (Array.isArray(value)) return value.map(answerText).filter(Boolean).join(', ');
        if (typeof value === 'object') return value.name || value.fileName || value.url || '';
        return String(value);
    }

    function answerImage(value) {
        if (!value || typeof value !== 'object') return '';
        return value.url || value.dataUrl || '';
    }

    function resolveFormAnswers(params, data, ctx) {
        const p = Object.assign(defaultParams('form_answers'), params || {});
        const form = (data.forms || []).find(f => f && f.id === p.formId);
        if (!form) return { rows: [], warnings: [p.formId ? 'That form no longer exists.' : 'Choose a form.'] };
        const questions = (form.questions || []).filter(q => q && q.type !== 'section');
        const rows = (data.responses || [])
            .filter(r => r && r.formId === form.id)
            .map((r, i) => {
                const row = { _id: r.id || String(i), personName: r.personName || '', submittedAt: r.submittedAt ? formatDate(String(r.submittedAt).slice(0, 10), 'medium') : '', number: i + 1 };
                questions.forEach(q => {
                    const v = (r.answers || {})[q.id];
                    row['q_' + q.id] = q.type === 'image' ? answerImage(v) : answerText(v);
                });
                return row;
            });
        return { rows: rows, warnings: rows.length ? [] : ['Nobody has answered "' + form.title + '" yet.'] };
    }

    // ── One door ─────────────────────────────────────────────────────────────

    const RESOLVERS = {
        people: resolvePeople,
        households: resolveHouseholds,
        sunday: resolveSunday,
        sunday_rows: resolveSundayRows,
        sunday_hymns: resolveSundayHymns,
        sundays: resolveSundays,
        event_dates: resolveEventDates,
        role_holder: resolveRoleHolder,
        form_answers: resolveFormAnswers,
    };

    // Rows for a source, for this viewer. A source above the viewer's level
    // resolves to nothing and says why — the rules would have refused the
    // read anyway; this is the drawer saying so in words.
    function resolve(sourceKey, params, data, ctx) {
        const c = Object.assign({ today: toDateStr(new Date()), level: 'viewer' }, ctx || {});
        const source = sourceByKey(sourceKey);
        if (!source) return { rows: [], warnings: ['"' + sourceKey + '" is not something the drawer knows.'] };
        if (!mayRead(c.level, source.minLevel)) {
            return { rows: [], warnings: [source.label + ' is not visible to you.'] };
        }
        const out = RESOLVERS[sourceKey](params, data || {}, c);
        // A field above the viewer's level is not in their drawer, and it is
        // not in their rows either — a wire an editor made must not read it
        // out for a member on the view-only page.
        const hidden = source.fields.filter(f => f.minLevel && !mayRead(c.level, f.minLevel)).map(f => f.key);
        if (hidden.length) {
            out.rows = out.rows.map(row => { const r = Object.assign({}, row); hidden.forEach(k => { delete r[k]; }); return r; });
        }
        return out;
    }

    // What the store must fetch to answer a source: the collections, and for
    // dated sources the window, so a directory does not load every event.
    function needsFor(sourceKey, params, today) {
        const p = Object.assign(defaultParams(sourceKey), params || {});
        const t = today || toDateStr(new Date());
        switch (sourceKey) {
            case 'people': return { people: true, families: true, households: true };
            case 'households': return { people: true, families: true, households: true };
            case 'sunday': case 'sunday_rows': return { services: [resolveWhen(p.when, t)] };
            case 'sunday_hymns': return { services: [resolveWhen(p.when, t)], hymns: true };
            case 'sundays': return { serviceRange: resolveRange(p.range, t) };
            case 'event_dates': return { series: true, occurrenceRange: resolveRange(p.range, t) };
            case 'role_holder': {
                const w = p.when || {};
                const from = (w.mode === 'date' && isDateStr(w.date)) ? w.date : t;
                return { series: true, roles: true, people: true, occurrenceRange: { from: from, to: addDays(from, 120) }, rosters: p.seriesId || true };
            }
            case 'form_answers': return { forms: true, responses: p.formId || true };
            default: return {};
        }
    }

    // A one-line description of a source's params, for the element panel.
    function describeParams(sourceKey, params, options) {
        const s = sourceByKey(sourceKey);
        const p = Object.assign(defaultParams(sourceKey), params || {});
        if (!s) return '';
        const bits = [];
        (s.params || []).forEach(param => {
            const v = p[param.key];
            if (param.kind === 'when') bits.push(v && v.mode === 'next' ? 'next Sunday' : v && v.mode === 'last' ? 'last Sunday' : v && v.mode === 'date' ? 'the Sunday of ' + formatDate(v.date, 'medium') : 'this Sunday');
            else if (param.kind === 'when-event') bits.push(v && v.mode === 'date' ? 'the first date on or after ' + formatDate(v.date, 'medium') : 'the next date');
            else if (param.kind === 'range') bits.push(describeRange(v));
            else if (param.kind === 'series') { const sr = ((options && options.series) || []).find(x => x.id === v); if (sr) bits.push(sr.name); }
            else if (param.kind === 'role') { if (v) bits.push(roleLabel(v, { roles: (options && options.roles) || [] })); }
            else if (param.kind === 'form') { const f = ((options && options.forms) || []).find(x => x.id === v); if (f) bits.push('"' + f.title + '"'); }
        });
        (s.filters || []).forEach(f => {
            const v = p[f.key];
            if (f.kind === 'choice') { const o = (f.options || []).find(x => x.value === v); if (o && v !== f.default) bits.push(o.label.toLowerCase()); }
            else if (f.kind === 'text' && v) bits.push(f.label.toLowerCase() + ' "' + v + '"');
            else if (f.kind === 'bool' && v) bits.push(f.label.toLowerCase());
        });
        return bits.join(' · ');
    }

    const PrintableDataCore = {
        LEVELS,
        SOURCES,
        LITURGY_ORDER,
        LITURGY_LABELS,
        HYMN_SLOTS,
        levelRank,
        mayRead,
        isDateStr,
        toDateStr,
        addDays,
        formatDate,
        sundayOnOrAfter,
        resolveWhen,
        resolveRange,
        describeRange,
        sourceByKey,
        sourcesFor,
        fieldsFor,
        defaultParams,
        accepts,
        propFor,
        fieldLabel,
        normaliseService,
        resolve,
        needsFor,
        describeParams,
        roleLabel,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableDataCore;
    }
    if (global) {
        global.PrintableDataCore = PrintableDataCore;
    }
})(typeof window !== 'undefined' ? window : null);
