/**
 * @fileoverview Paying one Sunday's liturgical involvement (MS-815).
 *
 * The nightly convertServiceInvolvement job used to do this inline, with
 * `batch.update` on each Person's counter. `update` fails on a document that
 * does not exist, so one Person deleted after being put on the booklet failed
 * that Sunday's whole batch, nothing caught it, and every Sunday after it in
 * the run went unpaid. The flag stayed set, so the same thing happened every
 * night after.
 *
 * Now: People that no longer exist are skipped (no serve record, no counter,
 * no Person doc brought back to life), the rest are credited, and the run
 * catches per Sunday so one bad Sunday is logged and the rest still convert.
 */

const ac = require("./assignment-conversion");
const si = require("./service-involvement");

/**
 * Pay one Service's records, if any are owed.
 *
 * @param {Object} db Admin Firestore.
 * @param {Object} doc The `services/{date}` snapshot.
 * @param {string} today The church's today, YYYY-MM-DD.
 * @param {Object} FieldValue admin.firestore.FieldValue.
 * @return {Promise<{written: number, skipped: string[], converted: boolean}>}
 *   Records written, Person ids skipped because they no longer exist, and
 *   whether the Service was settled.
 */
async function payService(db, doc, today, FieldValue) {
  const records = si.conversion(doc.data(), doc.id, today);
  if (!records.length) {
    // Nobody to credit, but the date has passed and the debt is settled,
    // otherwise an empty Sunday is re-read every night forever.
    if (doc.id < today) {
      await doc.ref.set({[si.DEFERRED_FLAG]: false}, {merge: true});
    }
    return {written: 0, skipped: [], converted: false};
  }

  const ids = [...new Set(records.map((r) => r.personId))];
  const refs = ids.map((id) => db.collection("people").doc(id));
  const snaps = await db.getAll(...refs);
  const alive = new Set(snaps.filter((s) => s.exists).map((s) => s.id));
  const skipped = ids.filter((id) => !alive.has(id));

  const batch = db.batch();
  // `totalInvolvements` is a counter the People page and Analytics both sort
  // by. Counted per person first, because one person can hold two Roles on
  // the same Sunday.
  const gained = new Map();
  let written = 0;

  records.forEach((record) => {
    if (!alive.has(record.personId)) return;
    const ref = db.collection("people").doc(record.personId)
        .collection("involvement").doc(record.id);
    batch.set(ref, {
      serviceDate: record.serviceDate,
      type: record.type,
      seriesId: ac.SUNDAY_SERVICE_ID,
      metadata: record.metadata || null,
      convertedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    gained.set(record.personId, (gained.get(record.personId) || 0) + 1);
    written += 1;
  });

  gained.forEach((count, personId) => {
    batch.update(db.collection("people").doc(personId), {
      totalInvolvements: FieldValue.increment(count),
    });
  });

  // Cleared in the same batch as the writes, so a crash between the two
  // cannot leave a Sunday paid twice or not at all.
  batch.set(doc.ref, {[si.DEFERRED_FLAG]: false}, {merge: true});
  await batch.commit();
  return {written, skipped, converted: true};
}

/**
 * Pay every Service in `docs`, one at a time, never letting one stop the rest.
 *
 * @param {Object} db Admin Firestore.
 * @param {Object[]} docs The flagged `services/{date}` snapshots.
 * @param {string} today The church's today.
 * @param {Object} FieldValue admin.firestore.FieldValue.
 * @param {function(string): void} log Where to say what happened.
 * @return {Promise<{written: number, converted: number, failed: string[]}>}
 */
async function payAll(db, docs, today, FieldValue, log) {
  let written = 0;
  let converted = 0;
  const failed = [];
  for (const doc of docs) {
    try {
      const r = await payService(db, doc, today, FieldValue);
      written += r.written;
      if (r.converted) converted += 1;
      if (r.skipped.length) {
        log(`convertServiceInvolvement: ${doc.id} names ` +
            `${r.skipped.length} Person(s) that no longer exist; skipped.`);
      }
    } catch (err) {
      failed.push(doc.id);
      log(`convertServiceInvolvement: ${doc.id} failed: ` +
          `${err && err.message}`);
    }
  }
  return {written, converted, failed};
}

module.exports = {payService, payAll};
