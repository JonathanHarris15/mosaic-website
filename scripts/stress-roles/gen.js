// Synthetic church generator for the Roles / Fairness benchmark.
const REPO = require('path').join(__dirname, '../../public/');
const Roles = require(REPO + 'roles-core.js');
const Fairness = require(REPO + 'fairness-core.js');
const AutoAssign = require(REPO + 'auto-assign-core.js');
const Family = require(REPO + 'family-core.js');

/**
 * @typedef {object} Person
 * @property {string} id
 * @property {string} name
 * @property {string} sex 'male' or 'female'
 * @property {string[]} tags
 * @property {{ inactive?: boolean }} membership
 */
/**
 * @typedef {object} Family
 * @property {string} id
 * @property {string} [husbandId]
 * @property {string} [wifeId]
 * @property {string[]} [childIds]
 */
/**
 * @typedef {object} Group
 * @property {string} id
 * @property {string} typeId
 * @property {string} [name]
 * @property {?string} [leaderId]
 * @property {string[]} memberIds
 */
/**
 * @typedef {object} Relationship
 * @property {string | undefined} fromId
 * @property {string} toId
 * @property {string} typeId
 */
/**
 * @typedef {object} Slot
 * @property {string} id
 * @property {string} requirement
 */
/**
 * @typedef {object} Restriction
 * @property {string} kind
 * @property {string} [tagId]
 * @property {string} [typeId]
 * @property {string[]} [personIds]
 * @property {string[]} [roleSlugs]
 */
/**
 * @typedef {object} Role
 * @property {string} slug
 * @property {string} name
 * @property {string} family
 * @property {Slot[]} slots
 * @property {Restriction[]} restrictions
 * @property {number} intensity
 * @property {boolean} [allowsAnotherRole]
 */
/**
 * @typedef {object} HistoryRecord
 * @property {string} personId
 * @property {string} type the Role slug
 * @property {string} serviceDate YYYY-MM-DD
 * @property {string} [seriesId]
 */
/**
 * @typedef {object} Seat
 * @property {string} roleSlug
 * @property {string} slotId
 * @property {string} personId
 * @property {boolean} [held]
 */
/**
 * @typedef {object} DraftDay
 * @property {Seat[]} [seats]
 * @property {Seat[]} [filled]
 */
/**
 * @typedef {object} ChurchOptions
 * @property {number} n how many people
 * @property {number} [seed]
 * @property {boolean} [unfillable] add a Role nobody can fill
 * @property {boolean} [crossSame] add a cross-role sameGroup rule
 */
/**
 * @typedef {object} AuditOptions
 * @property {string[]} [away]
 * @property {string[]} [liturgical]
 * @property {Role[]} [roles]
 * @property {Person[]} [people]
 */
/**
 * @typedef {object} Gap
 * @property {string} roleSlug
 * @property {string} slotId
 * @property {string} reason
 */
/**
 * @typedef {object} SolveResult what Fairness.solve returns
 * @property {Seat[]} filled
 * @property {Gap[]} unfilled
 * @property {number} widened
 * @property {boolean} [allSpent]
 * @property {Array<{ personId: string, load: number }>} pool
 */
/**
 * @typedef {object} Candidate one row of Roles.candidatesFor
 * @property {string} personId
 * @property {boolean} eligible
 * @property {?string} reason
 */
/**
 * @typedef {object} DraftResult what AutoAssign.draft returns
 * @property {Array<{ date: string, seats: Seat[], skipped?: boolean }>} dates
 */
/** @typedef {ReturnType<typeof church>} Church */
/** @typedef {(def: Role, slot: Slot, context: object) => any} CandidatesFor */

// Deterministic PRNG (mulberry32).
/**
 * @param {number} seed
 * @returns {() => number}
 */
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * @param {string} startIso YYYY-MM-DD
 * @param {number} count
 * @param {number} step days between dates
 * @returns {string[]}
 */
function sundays(startIso, count, step) {
    /** @type {string[]} */
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
/** @param {ChurchOptions} opts */
function church(opts) {
    const n = opts.n;
    const rand = rng(opts.seed || 1);
    /**
     * @template T
     * @param {T[]} arr
     * @returns {T}
     */
    const pick = arr => arr[Math.floor(rand() * arr.length)];

    /** @type {Person[]} */
    const people = [];
    for (let i = 0; i < n; i++) {
        /** @type {string[]} */
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
    /** @type {Family[]} */
    const families = [];
    let i = 0, fam = 0;
    while (i < n) {
        const size = 1 + Math.floor(rand() * 5);
        const members = people.slice(i, i + size).map(p => p.id);
        i += size;
        /** @type {Family} */
        const f = { id: 'f' + (fam++) };
        if (members.length >= 2 && rand() < 0.75) {
            f.husbandId = members[0]; f.wifeId = members[1];
            f.childIds = members.slice(2);
        } else {
            f.husbandId = members[0]; f.childIds = members.slice(1);
        }
        families.push(f);
    }
    /** @type {Group[]} */
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
    /** @type {Relationship[]} */
    const relationships = [];
    families.forEach(f => {
        if (f.husbandId && f.wifeId) relationships.push({ fromId: f.husbandId, toId: f.wifeId, typeId: 'spouse' });
        (f.childIds || []).forEach(c => relationships.push({ fromId: f.husbandId, toId: c, typeId: 'parent' }));
    });
    for (let k = 0; k < n * 0.1; k++) {
        relationships.push({ fromId: pick(people).id, toId: pick(people).id, typeId: 'mentor' });
    }

    // ~30 Servant Roles.
    /** @type {Array<() => Restriction[]>} */
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
    /** @type {Role[]} */
    const roles = [];
    for (let r = 0; r < 30; r++) {
        const count = 1 + Math.floor(rand() * 4);
        /** @type {Slot[]} */
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

    /** @type {Restriction[]} */
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
    /** @type {HistoryRecord[]} */
    const history = [];
    pastAsc.forEach(date => {
        roles.forEach(role => role.slots.forEach(() => {
            history.push({ personId: pick(people).id, type: role.slug, serviceDate: date, seriesId: 'sunday_service' });
        }));
        history.push({ personId: pick(people).id, type: 'preacher', serviceDate: date, seriesId: 'sunday_service' });
    });

    // Away: ~5% of people away for a 3-week stretch inside the draft range.
    /** @type {Object<string, string[]>} */
    const awayByDate = {};
    dates.forEach(d => { awayByDate[d] = []; });
    people.forEach(p => {
        if (rand() >= 0.05) return;
        const start = Math.floor(rand() * dates.length);
        for (let k = start; k < Math.min(dates.length, start + 3); k++) awayByDate[dates[k]].push(p.id);
    });

    /** @type {Object<string, number>} */
    const intensityBySlug = {};
    roles.forEach(r => { intensityBySlug[r.slug] = r.intensity; });

    return { people, roles, groups, relationships, families, crossRoleRules, history, pastDates, dates, awayByDate, intensityBySlug };
}

/**
 * @param {Church} c
 * @param {Object<string, *>} [over] options to override
 */
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
        intensityOf: /** @param {HistoryRecord} rec */ rec => (c.intensityBySlug[rec.type] !== undefined ? c.intensityBySlug[rec.type] : 1),
        nudges: {},
        outOn: () => [],
        awayOn: /** @param {string} d */ d => c.awayByDate[d] || [],
        liturgicalSlugs: Roles.LITURGICAL_SLUGS,
        liturgicalHoldersFor: () => ['p0'],
        relationships: c.relationships,
        groups: c.groups,
    }, over || {});
}

/**
 * @param {Church} c
 * @param {?string} [date] defaults to the first draft date
 * @param {Object<string, *>} [over] options to override
 */
function solveOptions(c, date, over) {
    return Object.assign({
        seriesId: 'sunday_service',
        date: date || c.dates[0],
        roles: c.roles,
        people: c.people,
        history: c.history,
        occurrenceDates: c.pastDates,
        windowSize: 12,
        intensityOf: /** @param {HistoryRecord} rec */ rec => (c.intensityBySlug[rec.type] !== undefined ? c.intensityBySlug[rec.type] : 1),
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
/**
 * @param {Church} c
 * @param {DraftDay} day
 * @param {AuditOptions} [opts]
 * @returns {string[]}
 */
function audit(c, day, opts) {
    /** @type {AuditOptions} */
    const o = opts || {};
    /** @type {string[]} */
    const problems = [];
    const away = new Set((o.away) || []);
    const lit = new Set(o.liturgical || []);
    const seats = day.seats || day.filled || [];
    /** @type {Object<string, Seat[]>} */
    const byRole = {};
    /** @type {Object<string, Role>} */
    const defs = {}; (o.roles || c.roles).forEach(r => { defs[r.slug] = r; });
    /** @type {Object<string, Seat[]>} */
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
    w.forEach(/** @param {{ reason: string, personId: string, roleSlug: string, slotId: string }} x */ x => problems.push('warning ' + x.reason + ' ' + x.personId + ' ' + x.roleSlug + '/' + x.slotId));
    return problems;
}

module.exports = { Roles, Fairness, AutoAssign, Family, church, draftOptions, solveOptions, audit, rng };
