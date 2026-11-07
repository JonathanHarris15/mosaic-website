// K people each confirm THEIR OWN place on one Event at the same moment. No logical conflict.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const H = require(__dirname + '/../../test/emulator/harness.js');
const writes = require(__dirname + '/../../functions/assignment-writes.js');
const K = Number(process.argv[2] || 20);
(async () => {
  const db = H.connect(); await H.wipe();
  const people = Array.from({ length: K }, (_, i) => 'p' + i);
  await Promise.all(people.map(id => H.seedPerson(db, id)));
  await H.seedRole(db, { slug: 'team', name: 'team', slots: people.map((_, i) => ({ id: 's' + i, requirement: 'either' })), restrictions: [] });
  await H.seedOccurrence(db, { id: 'o', date: '2026-03-14', visibility: 'member',
    roster: people.map((p, i) => ({ roleSlug: 'team', slotId: 's' + i, personId: p, state: 'pending', stateSetBy: null, stateSetAt: null })) });
  const t0 = Date.now();
  const res = await Promise.all(people.map((p, i) => writes.answer(db, { personId: p, roleSlug: 'team', slotId: 's' + i, occurrenceId: 'o', state: 'confirmed', today: '2026-03-01', now: H.now() }).catch(e => ({ ok: false, code: 'threw ' + e.message }))));
  const ok = res.filter(r => r.ok).length;
  const rows = await H.rosterOf(db, 'o');
  console.log(JSON.stringify({ K, ok, failed: K - ok, ms: Date.now() - t0, codes: [...new Set(res.filter(r => !r.ok).map(r => r.code))], confirmedInDb: rows.filter(r => r.state === 'confirmed').length }));
  process.exit(0);
})();
