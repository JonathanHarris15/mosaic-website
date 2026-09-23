/**
 * @fileoverview Plan the sms_messages → notifications copy (MS-253).
 *
 * Pure: the script that talks to Firestore asks this what to write. A row
 * that already exists at the destination is left alone, so a second run
 * changes nothing. Existing rows are texts — that was the only channel.
 */

/** The collection ADR-0009 wrote. The migration is the last reader of it. */
const SOURCE_COLLECTION = "sms_messages";

/** The collection ADR-0036 reads. */
const DEST_COLLECTION = "notifications";

/**
 * A source row, with a channel. A row that already names one keeps it.
 * @param {Object} data the sms_messages document
 * @return {Object} the notifications document
 */
function rowWithChannel(data) {
  const row = Object.assign({}, data || {});
  if (!row.channel) row.channel = "text";
  return row;
}

/**
 * Which source documents still need copying.
 * @param {Array<{id: string, data: Object}>} sourceDocs
 * @param {Array<string>} destIds document ids already in notifications
 * @return {{copies: Array<{id: string, data: Object}>, skips: Array<string>}}
 */
function planMigration(sourceDocs, destIds) {
  const have = new Set(destIds || []);
  const copies = [];
  const skips = [];
  for (const doc of sourceDocs || []) {
    if (!doc || !doc.id) continue;
    if (have.has(doc.id)) {
      skips.push(doc.id);
      continue;
    }
    copies.push({id: doc.id, data: rowWithChannel(doc.data)});
  }
  return {copies, skips};
}

module.exports = {
  SOURCE_COLLECTION,
  DEST_COLLECTION,
  rowWithChannel,
  planMigration,
};
