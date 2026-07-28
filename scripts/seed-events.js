/**
 * @fileoverview Seed: make sure the locked Sunday Service Event series exists
 * (MS-29, ADR-0016 §4).
 *
 * An Event series is the recurring thing that carries Roles. The Sunday Service
 * is the one series that must always be there, locked, carrying every liturgical
 * Role — so the app opens onto a populated model instead of an empty one.
 *
 * ── What this does NOT seed ─────────────────────────────────────────────────
 *
 * Liturgical Roles are NOT written to `/roles`. They are code-defined
 * (ADR-0016 §1) and live in RolesCore.LITURGICAL_ROLES; storing copies would
 * create a second source of truth, and since `/roles` is editor-writable those
 * copies would be editable — exactly what "locked" is supposed to prevent.
 * `RolesCore.allRoles()` composes the code-defined liturgical Roles with the
 * stored Servant ones at read time.
 *
 * No default Servant Roles are seeded either. Authoring those is the Roles
 * Manager's job (MS-120) — inventing a kids/setup/coffee structure here would
 * put made-up data in front of the user on first open.
 *
 * ── Idempotent ──────────────────────────────────────────────────────────────
 *
 * This is a reconcile, not a write. It restores what must be true and leaves
 * alone what the user owns: Servant Roles they added to Sunday, the order they
 * put them in, and any name they gave the series. A second run reports "no
 * changes" and writes nothing.
 *
 * Run:  node scripts/seed-events.js [--dry-run]
 */

const admin = require('firebase-admin');
const path = require('path');
const EventsCore = require('../public/events-core.js');
const RolesCore = require('../public/roles-core.js');

const SERVICE_ACCOUNT_FILE = 'mosaic-hymn-database-firebase-adminsdk-fbsvc-8d55863f5a.json';
const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
const EVENTS_COLLECTION = 'events';

const DRY_RUN = process.argv.includes('--dry-run');

const serviceAccountPath = path.join(__dirname, '..', SERVICE_ACCOUNT_FILE);
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: FIREBASE_PROJECT_ID,
});

const db = admin.firestore();

async function run() {
    console.log('Seeding Event series' + (DRY_RUN ? ' (dry run)' : ''));

    const ref = db.collection(EVENTS_COLLECTION).doc(EventsCore.SUNDAY_SERVICE_ID);
    const snap = await ref.get();
    const stored = snap.exists ? snap.data() : null;

    const { series, changed, reason } = EventsCore.reconcileSundayService(
        stored, RolesCore.LITURGICAL_SLUGS
    );

    if (!changed) {
        console.log('No changes — the Sunday Service series is already correct.');
        console.log(`  Roles: ${series.roleSlugs.join(', ')}`);
        return;
    }

    console.log(`Change needed: ${reason}`);

    if (DRY_RUN) {
        console.log('Dry run: no writes made.');
        return;
    }

    await ref.set(series);
    console.log('Seed complete.');
    console.log(`  Roles: ${series.roleSlugs.join(', ')}`);
}

run()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
