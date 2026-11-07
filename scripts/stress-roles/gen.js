// Synthetic church generator for the Roles / Fairness benchmark.
const REPO = require('path').join(__dirname, '../../public/');
const Roles = require(REPO + 'roles-core.js');
const Fairness = require(REPO + 'fairness-core.js');
const AutoAssign = require(REPO + 'auto-assign-core.js');
const Family = require(REPO + 'family-core.js');

// Deterministic PRNG (mulberry32).
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function sundays(startIso, count, step) {
    const out = [];
    const d = new Date(startIso + 'T00:00:00Z');
    for (let i = 0; i < count; i++) {
        out.push(new Date(d.getTime() + i * step * 86400000).toISOString().slice(0, 10));
    }
    return out;
}

const TAGS = Array.from({ length: 20 }, (_, i) => 'tag' + i);
const R = Roles.RESTRICTIONS;
const Q = Roles.REQUIREMENTS;

// opts: { n, seed, unfillable }
function church(opts) {
    const n = opts.n;
    const rand = rng(opts.seed || 1);
    const pick = arr => arr[Math.floor(rand() * arr.length)];

    const people = [];
    for (let i = 0; i < n; i++) {
        const tags = [];
        // tag0 is a "member" tag carried by ~60%; others sparse.
        if (rand() < 0.6) tags.push('tag0');
        if (rand() < 0.3) tags.push('tag1');      // e.g. "background checked"
        if (rand() < 0.05) tags.push('tag2');     // e.g. "under discipline"
        for (let k = 0; k < 2; k++) if (rand() < 0.2) tags.push(pick(TAGS));
        people.push({
            id: 'p' + i,
            name: 'Person ' + i,
            sex: rand() < 0.5 ? 'male' : 'female',
            tags: Array.from(new Set(tags)),
            membership: { inactive: false },
        });
    }

    // Families: walk people in order, form households of 1-5. ~30% of people
    // married (i.e. ~15% of n couples).
    const families = [];
    let i = 0, fam = 0;
    while (i < n) {
        const size = 1 + Math.floor(rand() * 5);
        const members = people.slice(i, i + size).map(p => p.id);
        i += size;
        const f = { id: 'f' + (fam++) };
        if (members.length >= 2 && rand() < 0.75) {
            f.husbandId = members[0]; f.wifeId = members[1];
            f.childIds = members.slice(2);
        } else {
            f.husbandId = members[0]; f.childIds = members.slice(1);
        }
        families.push(f);
    }
    const groups = Family.servingGroups(families, people);

    // House groups of ~12, with a leader not in memberIds.
    const shuffled = people.map(p => p.id).sort(() => rand() - 0.5);
    for (let g = 0; g * 12 < shuffled.length; g++) {
        const chunk = shuffled.slice(g * 12, g * 12 + 12);
        groups.push({
            id: 'hg' + g, typeId: 'house_group', name: 'House group ' + g,
            leaderId: chunk[0], memberIds: chunk.slice(1),
        });
    }

    // Pairwise relationships (marriage edges + some "mentor" edges).
    const relationships = [];
    families.forEach(f => {
        if (f.husbandId && f.wifeId) relationships.push({ fromId: f.husbandId, toId: f.wifeId, typeId: 'spouse' });
        (f.childIds || []).forEach(c => relationships.push({ fromId: f.husbandId, toId: c, typeId: 'parent' }));
    });
    for (let k = 0; k < n * 0.1; k++) {
        relationships.push({ fromId: pick(people).id, toId: pick(people).id, typeId: 'mentor' });
    }

    // ~30 Servant Roles.
    const roleKinds = [
        () => [],
        () => [{ kind: R.REQUIRE_TAG, tagId: 'tag1' }],
        () => [{ kind: R.EXCLUDE_TAG, tagId: 'tag2' }],
        () => [{ kind: R.NOT_TOGETHER, typeId: 'spouse' }],
        () => [{ kind: R.NOT_SAME_GROUP, typeId: 'family' }],
        () => [{ kind: R.SAME_GROUP, typeId: 'house_group' }],
        () => [{ kind: R.ALLOWLIST, personIds: Array.from({ length: 40 }, () => pick(people).id) }],
        () => [{ kind: R.REQUIRE_TAG, tagId: 'tag0' }, { kind: R.NOT_SAME_GROUP, typeId: 'marriage' }],
    ];
    const roles = [];
    for (let r = 0; r < 30; r++) {
        const count = 1 + Math.floor(rand() * 4);
        const slots = [];
        for (let s = 0; s < count; s++) {
            const x = rand();
            slots.push({ id: 's' + (s + 1), requirement: x < 0.7 ? Q.EITHER : (x < 0.85 ? Q.MALE : Q.FEMALE) });
        }
        roles.push({
            slug: 'role' + r, name: 'Role ' + r, family: Roles.FAMILIES.SERVANT,
            slots: slots, restrictions: roleKinds[r % roleKinds.length](),
            intensity: [1, 1, 1.25, 2, 4][r % 5],
            allowsAnotherRole: r % 7 === 0,
        });
    }
    if (opts.unfillable) {
        // A realistic misconfiguration: a Role wanting a tag nobody carries.
        roles.push({
            slug: 'roleX', name: 'Unfillable', family: Roles.FAMILIES.SERVANT,
            slots: [{ id: 's1', requirement: Q.EITHER }],
            restrictions: [{ kind: R.REQUIRE_TAG, tagId: 'nobody-has-this' }],
            intensity: 1,
        });
    }

    const crossRoleRules = [
        { kind: R.NOT_SAME_GROUP, typeId: 'marriage', roleSlugs: ['role1', 'role2'] },
    ];
    if (opts.crossSame) crossRoleRules.push({ kind: R.SAME_GROUP, typeId: 'house_group', roleSlugs: ['role3', 'role4'] });

    // Past 12 occurrences (most recent first) and 10 to draft (ascending).
    const pastAsc = sundays('2026-08-16', 12, 7);
    const pastDates = pastAsc.slice().reverse();
    const dates = sundays('2026-11-08', 10, 7);

    // History: every past date fully staffed from random people, plus some
    // older noise outside the window.
    const history = [];
    pastAsc.forEach(date => {
        roles.forEach(role => role.slots.forEach(() => {
            history.push({ personId: pick(people).id, type: role.slug, serviceDate: date, seriesId: 'sunday_service' });
        }));
        history.push({ personId: pick(people).id, type: 'preacher', serviceDate: date, seriesId: 'sunday_service' });
    });

    // Away: ~5% of people away for a 3-week stretch inside the draft range.
    const awayByDate = {};
    dates.forEach(d => { awayByDate[d] = []; });
    people.forEach(p => {
        if (rand() >= 0.05) return;
        const start = Math.floor(rand() * dates.length);
        for (let k = start; k < Math.min(dates.length, start + 3); k++) awayByDate[dates[k]].push(p.id);
    });

    const intensityBySlug = {};
    roles.forEach(r => { intensityBySlug[r.slug] = r.intensity; });

    return { people, roles, groups, relationships, families, crossRoleRules, history, pastDates, dates, awayByDate, intensityBySlug };
}

function draftOptions(c, over) {
    return Object.assign({
        dates: c.dates,
        pastDates: c.pastDates,
        history: c.history,
        existing: {},
        choice: AutoAssign.CHOICES.KEEP,
        roles: c.roles,
        people: c.people,
        windowSize: 12,
        seriesId: 'sunday_service',
        solve: Fairness.solve,
        candidatesFor: Roles.candidatesFor,
        crossRoleRules: c.crossRoleRules,
        intensityOf: rec => (c.intensityBySlug[rec.type] !== undefined ? c.intensityBySlug[rec.type] : 1),
        nudges: {},
        outOn: () => [],
        awayOn: d => c.awayByDate[d] || [],
        liturgicalSlugs: Roles.LITURGICAL_SLUGS,
        liturgicalHoldersFor: () => ['p0'],
        relationships: c.relationships,
        groups: c.groups,
    }, over || {});
}

function solveOptions(c, date, over) {
    return Object.assign({
        seriesId: 'sunday_service',
        date: date || c.dates[0],
        roles: c.roles,
        people: c.people,
        history: c.history,
        occurrenceDates: c.pastDates,
        windowSize: 12,
        intensityOf: rec => (c.intensityBySlug[rec.type] !== undefined ? c.intensityBySlug[rec.type] : 1),
        liturgicalSlugs: Roles.LITURGICAL_SLUGS,
        liturgicalHolders: ['p0'],
        relationships: c.relationships,
        groups: c.groups,
        crossRoleRules: c.crossRoleRules,
        awayPersonIds: c.awayByDate[date || c.dates[0]] || [],
        candidatesFor: Roles.candidatesFor,
    }, over || {});
}

// Independent roster checker: does a draft day break any hard rule?
function audit(c, day, opts) {
    const o = opts || {};
    const problems = [];
    const away = new Set((o.away) || []);
    const lit = new Set(o.liturgical || []);
    const seats = day.seats || day.filled || [];
    const byRole = {};
    const defs = {}; (o.roles || c.roles).forEach(r => { defs[r.slug] = r; });
    const perPerson = {};
    seats.forEach(s => {
        (byRole[s.roleSlug] || (byRole[s.roleSlug] = [])).push(s);
        (perPerson[s.personId] || (perPerson[s.personId] = [])).push(s);
        if (s.held) return;
        if (away.has(s.personId)) problems.push('away seated: ' + s.personId + ' in ' + s.roleSlug);
        if (lit.has(s.personId)) problems.push('liturgical holder seated: ' + s.personId);
    });
    Object.keys(perPerson).forEach(pid => {
        const list = perPerson[pid];
        if (list.length > 2) problems.push(pid + ' holds ' + list.length + ' seats');
        if (list.length === 2 && list.some(s => !(defs[s.roleSlug] || {}).allowsAnotherRole)) {
            problems.push(pid + ' holds exclusive role plus another: ' + list.map(s => s.roleSlug).join(','));
        }
    });
    // Rule check via warningsFor (the app's own roster judge).
    const w = Roles.warningsFor(seats.map(s => ({ roleSlug: s.roleSlug, slotId: s.slotId, personId: s.personId })), {
        roles: o.roles || c.roles, people: o.people || c.people, relationships: c.relationships, groups: c.groups,
        crossRoleRules: c.crossRoleRules, awayPersonIds: o.away || [],
        liturgicalHolders: (o.liturgical || []).map(id => ({ personId: id, roleSlug: 'preacher' })),
    });
    w.forEach(x => problems.push('warning ' + x.reason + ' ' + x.personId + ' ' + x.roleSlug + '/' + x.slotId));
    return problems;
}

module.exports = { Roles, Fairness, AutoAssign, Family, church, draftOptions, solveOptions, audit, rng };
