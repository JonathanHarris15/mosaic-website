const { test } = require('node:test');
const assert = require('node:assert');

const AutoAssign = require('../public/auto-assign-core.js');
const Fairness = require('../public/fairness-core.js');
const Roles = require('../public/roles-core.js');

// "Regularly the autodrafter puts people on the same event two weeks in a row.
// Especially when there is just a small allowlist for the role."
//
// ⚠ NOT a fairness bug. Recency is computed correctly and the loop carries its
// picks forward — `auto-assign-range.test.js` proves both. The fault is in the
// POOL, which is a performance guard that was quietly changing the answer.
//
// The solve does not judge the whole church. It ranks everybody by load, takes
// the least-loaded (spots + POOL_SLACK), and searches inside that slice; if no
// legal roster exists it widens by one and tries again, stopping at the first
// size that fills.
//
// For a Role only a few people may do, that stopping rule is the bug. The pool
// widens past every unusable person until it swallows the FIRST allowlisted one
// — and then stops, because one is enough to fill the place. The other people on
// the allowlist are never in the room. Recency never gets asked, because there
// is nothing to choose between. Whoever is lightest overall serves every week,
// and the two-week gap the Role is owed is never even considered.
//
// The rest of the church hides it: with a wide-open Role the pool holds plenty
// of eligible people and recency does its job, which is why this only shows up
// on the narrow ones.

const WINDOW = 12;
const SERIES = 'sunday_service';

const RANGE = [
    '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25',
    '2026-11-01', '2026-11-08',
];

const PAST = [
    '2026-09-27', '2026-09-20', '2026-09-13', '2026-09-06',
    '2026-08-30', '2026-08-23', '2026-08-16', '2026-08-09',
    '2026-08-02', '2026-07-26', '2026-07-19', '2026-07-12',
];

const person = (id, extra) => Object.assign({ id: id, name: id, tags: [] }, extra);
const either = n => ({ id: 's' + n, requirement: Roles.REQUIREMENTS.EITHER });

const role = (slug, slotCount, extra) => Object.assign({
    slug: slug,
    name: slug,
    family: Roles.FAMILIES.SERVANT,
    slots: Array.from({ length: slotCount }, (_, i) => either(i + 1)),
    restrictions: [],
    intensity: 1,
    allowsAnotherRole: false,
}, extra);

const serve = (personId, type, serviceDate) => ({
    personId: personId, type: type, serviceDate: serviceDate, seriesId: SERIES,
});

// The three who may run Kids. Everybody else in the church is a bystander who
// cannot — which is the whole point of an allowlist.
const KIDS = ['kim', 'kaya', 'kurt'];
const BYSTANDERS = Array.from({ length: 20 }, (_, i) => person('by' + i));
const EVERYONE = KIDS.map(id => person(id)).concat(BYSTANDERS);

const kidsRole = role('kids', 1, {
    restrictions: [{ kind: Roles.RESTRICTIONS.ALLOWLIST, personIds: KIDS }],
});

// Kaya and Kurt carry other work, so they sit further down the load ranking
// than Kim. Ordinary — some people do more than others — and it is exactly the
// shape that starves them of this Role.
const OTHER_WORK = []
    .concat(PAST.slice(0, 6).map(d => serve('kaya', 'coffee', d)))
    .concat(PAST.slice(0, 6).map(d => serve('kurt', 'setup', d)));

function options(over) {
    return Object.assign({
        dates: RANGE,
        pastDates: PAST,
        history: OTHER_WORK,
        existing: {},
        choice: AutoAssign.CHOICES.KEEP,
        roles: [kidsRole],
        people: EVERYONE,
        windowSize: WINDOW,
        seriesId: SERIES,
        solve: Fairness.solve,
        candidatesFor: Roles.candidatesFor,
        intensityOf: () => 1,
        liturgicalSlugs: [],
        liturgicalHoldersFor: () => [],
        relationships: [],
        groups: [],
    }, over || {});
}

const whoIsOn = result => result.dates.map(day => (day.seats[0] || {}).personId);

// ── The bug, as reported ─────────────────────────────────────────────────────

test('a Role with a small allowlist is not given to the same person every week', () => {
    const rota = whoIsOn(AutoAssign.draft(options()));

    assert.equal(rota.filter(Boolean).length, RANGE.length, 'a place went unfilled');

    const backToBack = rota.filter((id, i) => i > 0 && id === rota[i - 1]);
    assert.deepStrictEqual(backToBack, [],
        'the same person is on it two weeks running: ' + rota.join(' → '));
});

test('everyone on the allowlist gets a turn before anyone gets a third', () => {
    // Six dates, three people. Nobody should be on it three times while
    // somebody else has never been on it at all.
    const rota = whoIsOn(AutoAssign.draft(options()));
    const turns = {};
    rota.forEach(id => { turns[id] = (turns[id] || 0) + 1; });

    KIDS.forEach(id => {
        assert.ok(turns[id] >= 1, id + ' is on the allowlist and never served: ' + rota.join(' → '));
    });
    assert.ok(Math.max(...Object.values(turns)) <= 2,
        'the work is not spread across the allowlist: ' + rota.join(' → '));
});

test('a narrow Role still spreads when its people carry no other work', () => {
    // The control. Same Role, same allowlist, but nobody has other history —
    // so the three sort together and the pool reaches all of them. If this ever
    // fails, the fault is in recency rather than in the pool.
    const rota = whoIsOn(AutoAssign.draft(options({ history: [] })));
    assert.equal(new Set(rota).size, KIDS.length, rota.join(' → '));
});

// ── The same starvation, said with a tag ─────────────────────────────────────

test('a Role only a few are cleared for is not given to the same person every week', () => {
    // An allowlist is the sharpest case, not the only one. "Must be tagged
    // DBS-checked" is the same narrowness said another way, and the pool cannot
    // tell the two apart.
    const cleared = ['dee', 'dev', 'dot'];
    const people = cleared.map(id => person(id, { tags: ['dbs'] }))
        .concat(BYSTANDERS);
    const tagged = role('creche', 1, {
        restrictions: [{ kind: Roles.RESTRICTIONS.REQUIRE_TAG, tagId: 'dbs' }],
    });

    const rota = whoIsOn(AutoAssign.draft(options({
        roles: [tagged],
        people: people,
        history: []
            .concat(PAST.slice(0, 6).map(d => serve('dev', 'coffee', d)))
            .concat(PAST.slice(0, 6).map(d => serve('dot', 'setup', d))),
    })));

    const backToBack = rota.filter((id, i) => i > 0 && id === rota[i - 1]);
    assert.deepStrictEqual(backToBack, [],
        'the same person is on it two weeks running: ' + rota.join(' → '));
});

// ── What must not change ─────────────────────────────────────────────────────

test('a wide-open Role still draws from the least-loaded, not from everybody', () => {
    // The pool is a real guard and this is not a licence to widen it for its
    // own sake: somebody carrying nothing must still be preferred to somebody
    // carrying a term's worth.
    const busy = person('busy');
    const rota = whoIsOn(AutoAssign.draft(options({
        roles: [role('coffee', 1)],
        people: [busy].concat(BYSTANDERS),
        history: PAST.map(d => serve('busy', 'coffee', d)),
    })));

    assert.ok(rota.indexOf('busy') === -1,
        'the most heavily loaded person in the church was drafted anyway');
});

test('a Role nobody may fill still comes back empty, with a reason', () => {
    const result = AutoAssign.draft(options({
        roles: [role('kids', 1, {
            restrictions: [{ kind: Roles.RESTRICTIONS.ALLOWLIST, personIds: ['nobody-here'] }],
        })],
    }));

    result.dates.forEach(day => {
        assert.equal(day.seats.length, 0);
        assert.equal(day.gaps.length, 1, 'the empty place vanished instead of being reported');
    });
});

// ── The second half of the same bug ──────────────────────────────────────────
//
// Roles are solved one after another and each takes its people out of
// circulation, so whoever goes first gets first pick. In the editor's own order
// that meant a Role anybody can do spending one of the three people who may do
// the narrow one — costing the wide Role nothing and the narrow Role its whole
// choice. The same reported symptom, arriving a second way.

const wideRole = role('coffee', 3);

test('a Role anybody can do does not spend the people a narrow Role needs', () => {
    const three = ['kim', 'kaya', 'kurt'];
    const people = three.map(id => person(id))
        .concat(Array.from({ length: 12 }, (_, i) => person('any' + i)));

    // Coffee is listed FIRST, and needs three people out of fifteen. Kids needs
    // one, and only three people in the church may do it.
    const rota = AutoAssign.draft(options({
        roles: [wideRole, kidsRole],
        people: people,
        history: [],
    }));

    const kids = rota.dates.map(d => (d.seats.find(s => s.roleSlug === 'kids') || {}).personId);
    assert.equal(kids.filter(Boolean).length, RANGE.length,
        'Kids went unfilled because Coffee had taken its people: ' + kids.join(' → '));

    const backToBack = kids.filter((id, i) => i > 0 && id === kids[i - 1]);
    assert.deepStrictEqual(backToBack, [], 'Kids repeats: ' + kids.join(' → '));
});

test('the roster still reads in the editor\'s own Role order', () => {
    // Which Role picks first is an internal choice. A caller reading the roster
    // must not be able to tell it happened.
    const people = KIDS.map(id => person(id))
        .concat(Array.from({ length: 12 }, (_, i) => person('any' + i)));
    const rota = AutoAssign.draft(options({
        roles: [wideRole, kidsRole],
        people: people,
        history: [],
    }));

    rota.dates.forEach(day => {
        const order = day.seats.map(s => s.roleSlug);
        const sorted = order.slice().sort((a, b) => (
            ['coffee', 'kids'].indexOf(a) - ['coffee', 'kids'].indexOf(b)
        ));
        assert.deepStrictEqual(order, sorted, 'the seats came back in solve order');
    });
});

test('a Role that cannot be filled at all does not starve the ones that can', () => {
    // The scarcest Role here is impossible — nobody may do it. It must not
    // take priority in a way that leaves the fillable Roles worse off.
    const impossible = role('locked', 1, {
        restrictions: [{ kind: Roles.RESTRICTIONS.ALLOWLIST, personIds: ['nobody-here'] }],
    });
    const people = KIDS.map(id => person(id))
        .concat(Array.from({ length: 12 }, (_, i) => person('any' + i)));

    const rota = AutoAssign.draft(options({
        roles: [impossible, wideRole, kidsRole],
        people: people,
        history: [],
    }));

    rota.dates.forEach(day => {
        assert.equal(day.seats.filter(s => s.roleSlug === 'coffee').length, 3);
        assert.equal(day.seats.filter(s => s.roleSlug === 'kids').length, 1);
        assert.equal(day.gaps.length, 1);
        assert.equal(day.gaps[0].roleSlug, 'locked');
    });
});
