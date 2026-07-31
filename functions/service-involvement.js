/**
 * @fileoverview Pure logic for turning a Sunday's liturgical Roles into
 * Involvement records once the date has passed (MS-160, ADR-0018 §1). No
 * Firebase I/O — index.js reads Firestore and performs the writes. Same split
 * as assignment-conversion.js, and the browser's
 * public/service-involvement-core.js is the same rules for the editor. A test
 * holds the two together.
 *
 * WHY THIS EXISTS SEPARATELY FROM assignment-conversion.js
 *
 * A Sunday's liturgical Roles are NOT Assignments. They are denormalised fields
 * on `services/{date}` that the printed Service Guide reads, and ADR-0018 §2
 * keeps them that way — giving them Assignments too would put two sources of
 * truth for who is preaching on one document, and the loser is the booklet on a
 * Sunday morning. So they need their own conversion, reading those fields.
 *
 * LITURGY CONVERTS UNCONDITIONALLY
 *
 * A Servant Role's Assignment converts only when Confirmed, because somebody
 * had to say yes. Liturgy has no such state: there is no Pending or Confirmed on
 * `preacherId`. Being on the printed booklet IS the commitment a state would
 * otherwise record — the guide went out with their name on it.
 *
 * The alternative was to treat liturgy holders like Pending assignments and
 * raise a "did they serve?" question every week. Rejected: that is a question
 * about the preacher, every Sunday, for a role that almost never changes, which
 * is how a prompt stops being read. Mistakes are corrected with the manual
 * Involvement add/delete the People's Directory already has.
 *
 * WHY A FLAG AND NOT A DATE WINDOW
 *
 * Every Sunday saved before this shipped already has its Involvement, written
 * the old way under an auto-generated id. Converting those again would not
 * overwrite — it would add a SECOND record beside each one, which is precisely
 * the double-count this work exists to remove.
 *
 * So a Service says for itself whether its records are still owed. The editor
 * stamps `involvementDeferred` when it declines to write for a future date, and
 * this job converts only Services carrying it, clearing it as it goes. A Sunday
 * that was already written is never touched, because it never carries the flag.
 */

/**
 * Field → Role slug, in the SAVED shape `services/{date}` uses. Mirrors
 * public/service-involvement-core.js; a test holds the two lists together.
 *
 * `prayerPraiseId` and `prayerConfessionId` share the `prayer` slug — one Role,
 * two places in the service — so metadata tells them apart. Without it, the
 * Sunday one person leads both prayers writes one record instead of two.
 *
 * `elements` and `other` are serving and are included, but they are NOT
 * liturgical Roles and are deliberately absent from RolesCore.LITURGICAL_SLUGS.
 *
 * Pastoral prayer is absent entirely: it records being prayed FOR, not serving.
 * It drives lastPastoralPrayerDate for the prayer rotation, and fairness never
 * reads it, so its timing is left exactly as it is.
 */
const SERVING_FIELDS = Object.freeze([
  {idField: "serviceLeaderId", slug: "service_leader"},
  {idField: "musicLeaderId", slug: "worship_leader"},
  {idField: "preacherId", slug: "preacher"},
  {idField: "sermonetteId", slug: "sermonette"},
  {idField: "prayerPraiseId", slug: "prayer", metadata: {prayer_type: "praise"}},
  {idField: "prayerConfessionId", slug: "prayer",
    metadata: {prayer_type: "confession"}},
  {idField: "elementsId", slug: "elements"},
  {idField: "otherId", slug: "other"},
  {idField: "musicHelpers", slug: "worship_helper", list: true},
]);

/** The Service field the editor stamps when it defers writing. */
const DEFERRED_FLAG = "involvementDeferred";

const isDateStr = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Everyone who served at this Service, once per Role they held. A name with no
 * id is a visiting speaker typed in by hand — there is no Person to credit, so
 * there is nothing to write.
 * @param {Object} service The stored `services/{date}` document.
 * @return {Array<{personId: string, type: string, metadata: ?Object}>}
 */
function servingInvolvement(service) {
  const doc = service || {};
  const records = [];

  SERVING_FIELDS.forEach((f) => {
    const ids = f.list ?
      (Array.isArray(doc[f.idField]) ? doc[f.idField] : []).map((h) => h && h.id) :
      [doc[f.idField]];

    ids.filter(Boolean).forEach((personId) => {
      const record = {personId: personId, type: f.slug};
      if (f.metadata) record.metadata = Object.assign({}, f.metadata);
      records.push(record);
    });
  });

  return records;
}

/**
 * The id a record is written under. Deterministic, so running the job twice
 * writes one record rather than two.
 *
 * The person is NOT part of the key: the record lives at
 * `people/{personId}/involvement/{id}`, so the person is already the path. Two
 * Music Helpers therefore share an id under different people, which is correct
 * — they are two documents.
 * @param {string} date YYYY-MM-DD
 * @param {{type?: string, metadata?: Object}} record
 * @return {?string}
 */
function involvementId(date, record) {
  if (!isDateStr(date) || !record || !record.type) return null;
  const parts = [date, record.type];
  const prayerType = record.metadata && record.metadata.prayer_type;
  if (prayerType) parts.push(prayerType);
  return parts.join("_");
}

/**
 * The records owed by a Service whose date has passed, each stamped with its id.
 * Returns nothing for a date still ahead — that is the whole timing rule.
 * @param {Object} service The stored `services/{date}` document.
 * @param {string} date YYYY-MM-DD
 * @param {string} today YYYY-MM-DD, church-local
 * @return {Array<Object>}
 */
function conversion(service, date, today) {
  if (!isDateStr(date) || !isDateStr(today) || !(date < today)) return [];
  return servingInvolvement(service).map((r) => Object.assign({
    id: involvementId(date, r),
    serviceDate: date,
  }, r));
}

module.exports = {
  SERVING_FIELDS,
  DEFERRED_FLAG,
  servingInvolvement,
  involvementId,
  conversion,
};
