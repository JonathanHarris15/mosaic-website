/**
 * @fileoverview Copy sms_messages into notifications (MS-253, ADR-0036).
 *
 * Dry-run unless --commit is passed. Safe to run twice: a document that
 * already exists at the destination is skipped, ids and all, so the elder
 * digest marker and every textId lookup keep their identity.
 *
 * Does not delete the source. Leave sms_messages in place until a deployed
 * smsInbound has been seen to read notifications, then delete the old
 * collection by hand. Indexes for the new query are in firestore.indexes.json
 * and are NOT in the standing deploy set — create that index before the
 * renamed webhook is live, or the first reply query will fail.
 *
 * Usage:
 *   node scripts/migrate-sms-messages-to-notifications.js \
 *     --project mosaic-hymn-database --i-mean-prod
 *   node scripts/migrate-sms-messages-to-notifications.js \
 *     --project mosaic-hymn-database --i-mean-prod --commit
 */

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

const {
  SOURCE_COLLECTION,
  DEST_COLLECTION,
  planMigration,
} = require("../functions/notification-migration");

const FIREBASE_PROJECT_ID = "mosaic-hymn-database";

/**
 * Find the key by shape, not by name. A hardcoded filename breaks the day
 * the key is rotated.
 * @return {Object} the service account
 */
function resolveServiceAccount() {
  const root = path.join(__dirname, "..");
  const match = fs.readdirSync(root).find(
      (f) => f.startsWith("mosaic-hymn-database-firebase-adminsdk") &&
        f.endsWith(".json"),
  );
  if (!match) {
    throw new Error(
        "No mosaic-hymn-database-firebase-adminsdk-*.json found in project root.");
  }
  return require(path.join(root, match));
}

require("./firebase-project").requireProject(process.argv, {
  hardcoded: "mosaic-hymn-database",
});

admin.initializeApp({
  credential: admin.credential.cert(resolveServiceAccount()),
  projectId: FIREBASE_PROJECT_ID,
});

const db = admin.firestore();
const APPLY = process.argv.includes("--commit");

/**
 * Copy, or say what would be copied.
 * @return {Promise<void>}
 */
async function run() {
  const sourceSnap = await db.collection(SOURCE_COLLECTION).get();
  const destSnap = await db.collection(DEST_COLLECTION).get();
  const sourceDocs = sourceSnap.docs.map((doc) => ({
    id: doc.id,
    data: doc.data(),
  }));
  const plan = planMigration(sourceDocs, destSnap.docs.map((doc) => doc.id));

  console.log(
      `${APPLY ? "Copying" : "Would copy"} ${plan.copies.length} ` +
      `${SOURCE_COLLECTION} row(s) into ${DEST_COLLECTION}; ` +
      `${plan.skips.length} already there.`,
  );
  plan.copies.forEach((row) => {
    console.log(`  ${row.id}  channel=${row.data.channel}`);
  });

  if (!APPLY) {
    console.log("Dry run. Pass --commit to write. Nothing was changed.");
    return;
  }

  const CHUNK = 400;
  for (let i = 0; i < plan.copies.length; i += CHUNK) {
    const batch = db.batch();
    plan.copies.slice(i, i + CHUNK).forEach((row) => {
      batch.set(db.collection(DEST_COLLECTION).doc(row.id), row.data);
    });
    await batch.commit();
  }
  console.log(`Wrote ${plan.copies.length} notification row(s).`);
}

run().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
