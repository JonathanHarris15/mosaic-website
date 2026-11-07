// Adversarial inputs against roles-core / fairness-core / auto-assign-core.
// Usage: node adversarial.js
const G = require('./gen.js');
const { Roles, Fairness, AutoAssign } = G;
const Events = require(__dirname + '/../../public/events-core.js');
const Q = Roles.REQUIREMENTS, R = Roles.RESTRICTIONS;

const PAST = ['2026-10-25', '2026-10-18', '2026-10-11', '2026-10-04', '2026-09-27', '2026-09-20',
    '2026-09-13', '2026-09-06', '2026-08-30', '2026-08-23', '2026-08-16', '2026-08-09'];
const person = (id, x) => Object.assign({ id, name: id, tags: [], sex: 'male', membership: {} }, x);
const role = (slug, slots, x) => Object.assign({ slug, name: slug, family: 'servant', slots, restrictions: [], intensity: 1 }, x);
const slot = (id, requirement) => ({ id, requirement: requirement || Q.EITHER });

function solve(over) {
    const deadline = Date.now() + 10000;
    const guard = (d, sl, x) => { if (Date.now() > deadline) throw new Error('HANG: >10 s, aborted'); return Roles.candidatesFor(d, sl, x); };
    return Fairness.solve(Object.assign({
        seriesId: 'sunday_service', date: '2026-11-01', roles: [], people: [], history: [],
        occurrenceDates: PAST, windowSize: 12, intensityOf: () => 1,
        liturgicalSlugs: Roles.LITURGICAL_SLUGS, liturgicalHolders: [], relationships: [], groups: [],
        candidatesFor: guard, crossRoleRules: [], awayPersonIds: [],
    }, over));
}
const timed = (name, fn) => {
    const t = process.hrtime.bigint();
    let out, err;
    try { out = fn(); } catch (e) { err = e; }
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    console.log('\n## ' + name + '  [' + ms.toFixed(1) + ' ms]' + (err ? '  THREW: ' + err.message : ''));
    return out;
};
const ids = r => r.filled.map(f => f.roleSlug + '/' + f.slotId + '=' + f.personId).join(' ');

// 1. Duplicate person ids with different facts.
timed('duplicate person id, differing sex (female copy first)', () => {
    const people = [person('dup', { sex: 'female' }), person('dup', { sex: 'male' }), person('x', { sex: 'female' })];
    const r = solve({ roles: [role('door', [slot('s1', Q.MALE)])], people });
    console.log('filled:', ids(r), '| unfilled:', r.unfilled.map(u => u.reason).join(','));
    const picker = Roles.candidatesFor(role('door', [slot('s1', Q.MALE)]), slot('s1', Q.MALE), { people });
    console.log('picker rows:', picker.map(p => p.personId + ':' + p.eligible).join(' '));
    return r;
});
timed('duplicate person id, differing sex (male copy first)', () => {
    const people = [person('dup', { sex: 'male' }), person('dup', { sex: 'female' })];
    const r = solve({ roles: [role('door', [slot('s1', Q.MALE)])], people });
    console.log('filled:', ids(r), '| unfilled:', r.unfilled.map(u => u.reason).join(','),
        '(solver uses last copy via byId; picker says first copy eligible)');
});

// 2. Duplicate slot ids in one Role (authoring refuses it, but the solve does not defend).
timed('duplicate slot ids in one role', () => {
    const def = role('kids', [slot('s1'), slot('s1')], { restrictions: [{ kind: R.NOT_TOGETHER, typeId: 'spouse' }] });
    const people = [person('a'), person('b')];
    const r = solve({ roles: [def], people, relationships: [{ fromId: 'a', toId: 'b', typeId: 'spouse' }] });
    console.log('filled:', ids(r), '| unfilled:', r.unfilled.length);
    const dupPerson = r.filled.length === 2 && r.filled[0].personId === r.filled[1].personId;
    console.log(dupPerson ? 'BUG: same person seated twice in one role' : 'couple seated?', !dupPerson && r.filled.length === 2 ? 'BUG: married couple seated together' : '');
});

// 3. Person in 500 groups (sameGroup and notSameGroup).
timed('candidatesFor, 1000 people, one person in 500 house groups, notSameGroup seated', () => {
    const people = Array.from({ length: 1000 }, (_, i) => person('p' + i));
    const groups = Array.from({ length: 500 }, (_, g) => ({ id: 'g' + g, typeId: 'hg', name: 'g', memberIds: ['p0', 'p' + (1 + g)] }));
    const def = role('r', [slot('s1'), slot('s2')], { restrictions: [{ kind: R.NOT_SAME_GROUP, typeId: 'hg' }] });
    const out = Roles.candidatesFor(def, slot('s2'), { people, groups, assigned: [{ slotId: 's1', personId: 'p0' }] });
    console.log('eligible', out.filter(o => o.eligible).length, 'of', out.length);
});

// 4. Role with 50 slots.
// (50-slot notSameGroup case moved to bigslots.js — it hangs)
timed('solve: one role with 50 slots where only 49 can be filled (unary), 300 people', () => {
    const people = Array.from({ length: 300 }, (_, i) => person('p' + i, { sex: i < 49 ? 'female' : 'male' }));
    const def = role('big', Array.from({ length: 50 }, (_, i) => slot('s' + (i + 1), Q.FEMALE)));
    const r = solve({ roles: [def], people });
    console.log('filled', r.filled.length, 'unfilled', r.unfilled.length, 'widened', r.widened);
});

// 5. Allowlist of 5,000 ids, 10,000 people.
timed('candidatesFor: allowlist of 5,000 ids over 10,000 people', () => {
    const people = Array.from({ length: 10000 }, (_, i) => person('p' + i));
    const def = role('comm', [slot('s1')], { restrictions: [{ kind: R.ALLOWLIST, personIds: people.slice(0, 5000).map(p => p.id) }] });
    const out = Roles.candidatesFor(def, slot('s1'), { people });
    console.log('eligible', out.filter(o => o.eligible).length);
});

// 6. Empty / missing slots.
timed('solve: role with empty slots array', () => {
    const r = solve({ roles: [role('none', [])], people: [person('a')] });
    console.log('filled', r.filled.length, 'unfilled', r.unfilled.length);
});
timed('solve: role with slots undefined', () => {
    const r = solve({ roles: [role('none', undefined)], people: [person('a')] });
    console.log('filled', r.filled.length, 'unfilled', r.unfilled.length);
});
timed('candidatesFor with slot undefined (picker race: slot removed while open)', () => {
    Roles.candidatesFor(role('x', [slot('s1')]), undefined, { people: [person('a')] });
});
timed('solve: slot with requirement typo "Male"', () => {
    const r = solve({ roles: [role('x', [slot('s1', 'Male')])], people: [person('a', { sex: 'male' })] });
    console.log('filled', r.filled.length, 'unfilled reason', r.unfilled.map(u => u.reason).join(','));
});

// 7. NaN / negative / huge intensity reaching the solve directly.
for (const v of [NaN, -5, 1e308, Infinity]) {
    timed('solve: intensityOf returns ' + v, () => {
        const people = ['a', 'b', 'c', 'd'].map(id => person(id));
        const history = [{ personId: 'a', type: 'coffee', serviceDate: PAST[0] }, { personId: 'a', type: 'coffee', serviceDate: PAST[1] }];
        const r = solve({ roles: [role('coffee', [slot('s1')])], people, history, intensityOf: () => v });
        console.log('filled', ids(r), 'pool order', r.pool.map(p => p.personId + ':' + p.load).join(' '));
    });
}
timed('Events.roleIntensity sanitises bad stored intensity', () => {
    console.log(['NaN', -5, 1e308, '3', null].map(v => String(v) + '->' + Events.roleIntensity({}, 'coffee', { definition: { intensity: v === 'NaN' ? NaN : v } })).join('  '));
});

// 8. Unicode / very long names and ids.
timed('solve: 1 MB person id and unicode names, 200 people', () => {
    const people = Array.from({ length: 200 }, (_, i) => person((i === 0 ? 'x'.repeat(1 << 20) : '') + 'p' + i + '\u{1F600}́', { name: '‮evil\u0000' + i }));
    const r = solve({ roles: [role('coffee', [slot('s1'), slot('s2')])], people });
    console.log('filled', r.filled.length);
});

// 9. Self and cyclic relationships, leader also in memberIds, same id twice in memberIds.
timed('self/cyclic relationships and odd groups', () => {
    const people = ['a', 'b', 'c'].map(id => person(id));
    const rels = [{ fromId: 'a', toId: 'a', typeId: 'spouse' }, { fromId: 'a', toId: 'b', typeId: 'spouse' }, { fromId: 'b', toId: 'c', typeId: 'spouse' }, { fromId: 'c', toId: 'a', typeId: 'spouse' }];
    const groups = [{ id: 'g', typeId: 'hg', leaderId: 'a', memberIds: ['a', 'a', 'b'] }];
    const r = solve({ roles: [role('k', [slot('s1'), slot('s2')], { restrictions: [{ kind: R.NOT_TOGETHER, typeId: 'spouse' }] }),
        role('h', [slot('s1'), slot('s2')], { restrictions: [{ kind: R.SAME_GROUP, typeId: 'hg' }] })], people, relationships: rels, groups });
    console.log('filled', ids(r), '| unfilled', r.unfilled.map(u => u.roleSlug + ':' + u.reason).join(','));
});

// 10. Cross-role SAME_GROUP: jointly feasible, but roles are solved one at a time.
timed('cross-role sameGroup: feasible roster exists, solver leaves gaps', () => {
    const people = ['a1', 'a2', 'a3', 'a4', 'b1', 'b2'].map(id => person(id));
    const groups = [{ id: 'A', typeId: 'hg', name: 'A', memberIds: ['a1', 'a2', 'a3', 'a4'] },
        { id: 'B1', typeId: 'hg', name: 'B1', memberIds: ['b1'] }, { id: 'B2', typeId: 'hg', name: 'B2', memberIds: ['b2'] }];
    // The a's did "lead" recently, so b1/b2 are fresher for it.
    const history = ['a1', 'a2', 'a3', 'a4'].map(p => ({ personId: p, type: 'lead', serviceDate: PAST[0] }));
    const r = solve({
        roles: [role('lead', [slot('s1'), slot('s2')]), role('help', [slot('s1'), slot('s2')])],
        people, groups, history,
        crossRoleRules: [{ kind: R.SAME_GROUP, typeId: 'hg', roleSlugs: ['lead', 'help'] }],
    });
    console.log('filled', ids(r), '| unfilled', r.unfilled.map(u => u.roleSlug + '/' + u.slotId + ':' + u.reason).join(','));
    console.log('a feasible full roster: lead={a1,a2} help={a3,a4}');
});

// 11. Auto-assign KEEP retains a Pending seat for someone Away that date.
timed('auto-assign KEEP: pending seat held for a person who is Away', () => {
    const people = ['a', 'b', 'c'].map(id => person(id));
    const d = ['2026-11-08'];
    const out = AutoAssign.draft({
        dates: d, pastDates: PAST, history: [], existing: { '2026-11-08': [{ roleSlug: 'coffee', slotId: 's1', personId: 'a', state: 'pending' }] },
        choice: 'keep', roles: [role('coffee', [slot('s1'), slot('s2')])], people, windowSize: 12, seriesId: 'sunday_service',
        solve: Fairness.solve, candidatesFor: Roles.candidatesFor, intensityOf: () => 1, liturgicalSlugs: [],
        liturgicalHoldersFor: () => [], relationships: [], groups: [], awayOn: () => ['a'], outOn: () => [],
    });
    console.log('seats', out.dates[0].seats.map(s => s.slotId + '=' + s.personId + (s.held ? '(held)' : '')).join(' '));
});

// 12. Slot id re-issue after removing the highest slot.
timed('slot ids re-issued after removing the highest one', () => {
    let def = role('x', [slot('s1', Q.MALE), slot('s2', Q.MALE), slot('s3', Q.MALE)]);
    def = Roles.removeSlot(def, 's3');
    def = Roles.addSlot(def, Q.FEMALE);
    console.log('slots now', def.slots.map(s => s.id + ':' + s.requirement).join(' '),
        def.slots.some(s => s.id === 's3') ? '<- s3 RE-ISSUED (an Assignment pointing at old s3 now sits in a female slot)' : '');
});

// 13. A liturgical holder passed as an object rather than id.
timed('liturgicalHolders given as {personId} objects instead of ids', () => {
    const people = ['a', 'b'].map(id => person(id));
    const r = solve({ roles: [role('coffee', [slot('s1')])], people, liturgicalHolders: [{ personId: 'a' }] , history: [{personId:'b', type:'coffee', serviceDate: PAST[0]}]});
    console.log('filled', ids(r), '(a is preaching; seated?)');
});
