// Concurrent fuzz of answer/take against the emulator. Checks invariants after.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const H = require(__dirname + '/../../test/emulator/harness.js');
const writes = require(__dirname + '/../../functions/assignment-writes.js');
const TODAY = '2026-03-01';
const OCC = 'occ-fuzz';
const ROLES = ['ushers', 'coffee', 'sound'];
const SLOTS = ['s1', 's2', 's3'];
const N = Number(process.argv[2] || 40);
const OPS = Number(process.argv[3] || 300);
const people = Array.from({ length: N }, (_, i) => 'p' + i);
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = a => a[Math.floor(rnd() * a.length)];

(async () => {
  const db = H.connect();
  await H.wipe();
  await Promise.all(people.map(id => Promise.all([H.seedPerson(db, id),
    db.collection('users').doc('uid-' + id).set({ personId: id, accountLevelId: 'level_member' })])));
  await Promise.all(ROLES.map(slug => H.seedRole(db, { slug, name: slug,
    slots: SLOTS.map(id => ({ id, requirement: 'either' })), restrictions: [] })));
  const roster = [];
  let k = 0;
  for (const r of ROLES) for (const s of SLOTS) roster.push({ roleSlug: r, slotId: s, personId: people[k++], state: 'pending', stateSetBy: null, stateSetAt: null });
  await H.seedOccurrence(db, { id: OCC, date: '2026-03-14', visibility: 'member', roster });

  const counts = {};
  const t0 = Date.now();
  const ops = Array.from({ length: OPS }, async () => {
    const roleSlug = pick(ROLES), slotId = pick(SLOTS);
    const kind = rnd() < 0.5 ? 'answer' : 'take';
    let res;
    try {
      if (kind === 'answer') {
        // the current holder (whoever we think it is) answers — read without a tx, like a phone that loaded earlier
        const rows = await H.rosterOf(db, OCC);
        const held = rows.find(r => r.roleSlug === roleSlug && r.slotId === slotId);
        res = await writes.answer(db, { personId: held ? held.personId : pick(people), roleSlug, slotId, occurrenceId: OCC,
          state: rnd() < 0.6 ? 'declined' : 'confirmed', quiet: rnd() < 0.2, today: TODAY, now: H.now() });
      } else {
        res = await writes.take(db, { personId: pick(people), rank: 'member', roleSlug, slotId, occurrenceId: OCC, today: TODAY, now: H.now() });
      }
    } catch (e) { res = { ok: false, code: 'THREW:' + (e.code || '') + ':' + String(e.message).slice(0, 80) }; }
    const key = kind + ':' + (res.ok ? 'ok' : res.code);
    counts[key] = (counts[key] || 0) + 1;
  });
  await Promise.all(ops);
  const ms = Date.now() - t0;

  // invariants
  const rows = await H.rosterOf(db, OCC);
  const occ = await H.occurrenceOf(db, OCC);
  const cover = (await db.collection('cover').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
  const problems = [];
  for (const r of ROLES) for (const s of SLOTS) {
    const n = rows.filter(x => x.roleSlug === r && x.slotId === s).length;
    if (n !== 1) problems.push(`slot ${r}/${s} has ${n} rows`);
  }
  const ids = [...new Set(rows.map(r => r.personId))].sort();
  const pid = [...(occ.participantIds || [])].sort();
  if (JSON.stringify(ids) !== JSON.stringify(pid)) problems.push('participantIds drift: ' + JSON.stringify({ roster: ids, stamped: pid }));
  const declined = rows.some(r => r.state === 'declined');
  if (occ.needsAttention !== declined) problems.push(`needsAttention ${occ.needsAttention} vs roster declined ${declined}`);
  for (const r of rows) {
    const cid = [OCC, r.roleSlug, r.slotId].join('__');
    const has = cover.some(c => c.id === cid);
    const should = r.state === 'declined' && r.quiet !== true;
    if (has !== should) problems.push(`cover ${cid}: has=${has} should=${should} (state ${r.state}, quiet ${r.quiet})`);
  }
  const byPerson = {};
  rows.forEach(r => { byPerson[r.personId] = (byPerson[r.personId] || 0) + 1; });
  Object.entries(byPerson).filter(([, n]) => n > 1).forEach(([p, n]) => problems.push(`${p} holds ${n} exclusive places on one Event`));
  console.log(JSON.stringify({ N, OPS, ms, counts, problems }, null, 1));
  process.exit(0);
})();
