/**
 * @fileoverview Write down the Households the app has only been guessing at.
 *
 * MS-319 shipped Households as a real collection, but almost nothing was in it.
 * To keep the foyer search from being empty on day one, the kiosk PROJECTED one
 * Household per Family and one per unattached Person. A projection is a guess
 * the app makes fresh on every page load: nothing points at it, an editor cannot
 * see it, the Relations Viewer cannot draw it, and two greeters typing the same
 * new family at the same time get two Households instead of one.
 *
 * This mints the guesses. Every projection becomes a real document, under the
 * PROJECTION'S OWN ID (`family:<id>` / `person:<id>`), which is what makes the
 * whole thing idempotent: run it twice and the second run rewrites the same
 * documents rather than minting a second set (ADR-0044).
 *
 * It never touches a Household that already exists — a greeter or an editor has
 * since had their say on it, and this script's guess is older than they are.
 *
 * Usage:
 *   node scripts/mint-households.js            # dry run (default)
 *   node scripts/mint-households.js --commit   # apply
 *   node scripts/mint-households.js --commit --families-only
 */

const HouseholdCore = require('../public/household-core.js');

// ── The pure part ────────────────────────────────────────────────────────────
// Given the directory as it stands, return the documents to write. Free of
// Firestore, so what counts as a Household is unit-tested rather than trusted.
//
//   [{ id, doc }]
//
// `familiesOnly` skips the singletons — one Person living alone is a Household
// of one, which is true but adds a document per visitor nobody has grouped yet.
function planHouseholdMints(people, families, stored, now, opts) {
    const options = opts || {};
    const projected = HouseholdCore.householdsFromDirectory(people, families, stored);
    return projected
        .filter(h => !h.stored)
        .filter(h => !(options.familiesOnly && h.id.indexOf('person:') === 0))
        .map(h => ({ id: h.id, doc: HouseholdCore.mintWrite(h, [], now).doc }));
}

module.exports = { planHouseholdMints };

// ── The runner ───────────────────────────────────────────────────────────────

if (require.main === module) {
    const admin = require('firebase-admin');
    const { serviceAccountPath } = require('./service-account.js');

    const COMMIT = process.argv.includes('--commit');
    const FAMILIES_ONLY = process.argv.includes('--families-only');

    admin.initializeApp({
        credential: admin.credential.cert(require(serviceAccountPath())),
        projectId: 'mosaic-hymn-database',
    });
    const db = admin.firestore();

    (async () => {
        const [peopleSnap, familySnap, houseSnap] = await Promise.all([
            db.collection('people').get(),
            db.collection('families').get(),
            db.collection('households').get(),
        ]);
        const toArr = snap => snap.docs.map(d => Object.assign({ id: d.id }, d.data()));

        const mints = planHouseholdMints(
            toArr(peopleSnap), toArr(familySnap), toArr(houseSnap),
            new Date().toISOString(),
            { familiesOnly: FAMILIES_ONLY }
        );

        console.log(`${houseSnap.size} Household(s) stored; ${mints.length} still only projected.\n`);

        // Firestore takes 500 writes to a batch; households are small but a
        // directory is not, so this walks in chunks rather than hoping.
        const SIZE = 400;
        for (let i = 0; i < mints.length; i += SIZE) {
            const chunk = mints.slice(i, i + SIZE);
            chunk.forEach((m) => {
                console.log(`${m.doc.name}  (${m.id})`);
                console.log(`  ${m.doc.members.length} member(s)`);
            });
            if (COMMIT) {
                const batch = db.batch();
                chunk.forEach((m) => batch.set(db.collection('households').doc(m.id), m.doc));
                await batch.commit();
                console.log(`✓ wrote ${chunk.length}\n`);
            }
        }

        if (!COMMIT) console.log('\nDry run. Re-run with --commit to apply.');
        process.exit(0);
    })().catch((e) => { console.error(e); process.exit(1); });
}
