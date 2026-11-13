// Replica of calendar-event.js `get candidates()` (lines ~1348-1460): candidatesFor + per-candidate
// people.find, groups.find(inGroup), serveHistory.filter. Re-runs on every picker keystroke (query is read inside the getter).
const G = require('./gen.js'); const { Roles, Fairness } = G;
/** @typedef {import('./gen.js').Role} Role */
/** @typedef {import('./gen.js').Candidate} Candidate */
/** @typedef {import('./gen.js').Person} Person */
for (const n of [1000, 5000, 10000]) {
  const c = G.church({ n, seed: 42 });
  const def = /** @type {Role} */ (c.roles.find(r => r.slug === 'role4')); const slot = { id: 's9', requirement: 'either' };
  const ctx = { people: c.people, relationships: c.relationships, groups: c.groups, assigned: [{ slotId: 's1', personId: 'p5' }], assignedElsewhere: [], crossRoleRules: c.crossRoleRules, awayPersonIds: c.awayByDate[c.dates[0]] };
  const t0 = process.hrtime.bigint();
  /** @type {Candidate[]} */
  const judged = Roles.candidatesFor(def, slot, ctx);
  const t1 = process.hrtime.bigint();
  const recency = Fairness.recencyOf(c.history, c.pastDates, def.slug);
  const rows = judged.map(x => {
    const person = /** @type {Person} */ (c.people.find(p => p.id === x.personId) || {});
    const g = c.groups.find(group => Roles.inGroup(group, x.personId));
    const other = c.history.filter(r => r.personId === x.personId && r.type !== def.slug).length;
    return { name: person.name, g: g && g.name, other, rec: recency[x.personId] };
  }).filter(r => r.name.toLowerCase().indexOf('pers') !== -1);
  const t2 = process.hrtime.bigint();
  console.log('n', n, 'candidatesFor', (Number(t1 - t0) / 1e6).toFixed(0) + 'ms', 'decorate', (Number(t2 - t1) / 1e6).toFixed(0) + 'ms', 'total per keystroke', (Number(t2 - t0) / 1e6).toFixed(0) + 'ms', rows.length);
}
