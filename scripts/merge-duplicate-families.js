/**
 * @fileoverview One-shot repair — one couple, one household.
 *
 * A Person is a spouse in at most one Family (ADR-0012). Until the fix in
 * `planAddFamilyRelation`, naming a child's parents when that child had no
 * family of origin minted a BRAND NEW Family every time, even when the parent
 * was already married into one. So a couple who added five children by walking
 * each child's card ended up recorded six times over — one Family per child,
 * plus their marriage — and the Relations Viewer drew a spouse link for each.
 *
 * This gathers the Families back together. Two Families belong to the same
 * household when they share a spouse, so the merge is the transitive closure of
 * that: keep one doc, union the children into it, delete the rest. Nothing else
 * points at a Family by id — the serving-group rules name the TYPE ("family",
 * "marriage"), never a document — so deleting the duplicates costs nothing.
 *
 * It refuses to guess. A component holding two different wives (or husbands) is
 * a real disagreement about who is married to whom, so it is reported and left
 * alone for a human.
 *
 * Idempotent: run it again and every household is already single.
 *
 * Usage:
 *   node scripts/merge-duplicate-families.js            # dry run (default)
 *   node scripts/merge-duplicate-families.js --commit   # apply
 */

// ── The pure part ────────────────────────────────────────────────────────────
// Given the families as they stand, return the merges to make. Kept free of
// Firestore so the household arithmetic is unit-tested rather than trusted.
//
//   { merges: [{ keepId, dropIds, changes }], conflicts: [{ familyIds, reason }] }
//
// `changes` is the field patch for the surviving doc, and carries only what
// actually differs from it.

const SEATS = ['husbandId', 'wifeId'];

// Families sharing a spouse are the same household. Union-find over the spouse
// seats gives the transitive closure — F1 and F3 join through F2 even when they
// share nobody directly.
function householdComponents(families) {
    const parent = {};
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

    families.forEach((f) => { parent[f.id] = f.id; });
    const seenAt = {};   // spouse personId → the first family id they were seen in
    families.forEach((f) => {
        SEATS.forEach((seat) => {
            const personId = f[seat];
            if (!personId) return;
            if (seenAt[personId]) union(f.id, seenAt[personId]);
            else seenAt[personId] = f.id;
        });
    });

    const byRoot = new Map();
    families.forEach((f) => {
        const root = find(f.id);
        if (!byRoot.has(root)) byRoot.set(root, []);
        byRoot.get(root).push(f);
    });
    return [...byRoot.values()];
}

// The doc to keep: the one carrying the anniversary (the fact hardest to
// recover), then the fullest, then the lowest id so a rerun picks the same one.
function pickSurvivor(component) {
    return component.slice().sort((a, b) => {
        const score = (f) => (f.anniversary ? 100 : 0) + (f.childIds || []).length +
            SEATS.filter((s) => f[s]).length;
        return score(b) - score(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    })[0];
}

function planFamilyMerges(families) {
    const merges = [];
    const conflicts = [];

    householdComponents(families || []).forEach((component) => {
        if (component.length < 2) return;

        // Two different people in the same seat is a disagreement, not a duplicate.
        const clash = SEATS.find((seat) => {
            const held = [...new Set(component.map((f) => f[seat]).filter(Boolean))];
            return held.length > 1;
        });
        if (clash) {
            conflicts.push({
                familyIds: component.map((f) => f.id),
                reason: `two different people sit in ${clash} across these Families`,
            });
            return;
        }

        const keep = pickSurvivor(component);
        const changes = {};
        SEATS.forEach((seat) => {
            const held = component.map((f) => f[seat]).find(Boolean) || null;
            if (held && keep[seat] !== held) changes[seat] = held;
        });

        const children = [];
        component.forEach((f) => (f.childIds || []).forEach((id) => {
            if (children.indexOf(id) === -1) children.push(id);
        }));
        const kept = keep.childIds || [];
        if (children.length !== kept.length || children.some((id, i) => id !== kept[i])) {
            changes.childIds = children;
        }

        const anniversary = component.map((f) => f.anniversary).find(Boolean) || null;
        if (anniversary && !keep.anniversary) changes.anniversary = anniversary;

        merges.push({
            keepId: keep.id,
            dropIds: component.filter((f) => f.id !== keep.id).map((f) => f.id),
            changes,
        });
    });

    return { merges, conflicts };
}

module.exports = { planFamilyMerges, householdComponents, pickSurvivor };

// ── The runner ───────────────────────────────────────────────────────────────

if (require.main === module) {
    const admin = require('firebase-admin');
    const { serviceAccountPath } = require('./service-account.js');

    const COMMIT = process.argv.includes('--commit');

    admin.initializeApp({
        credential: admin.credential.cert(require(serviceAccountPath())),
        projectId: 'mosaic-hymn-database',
    });
    const db = admin.firestore();

    (async () => {
        const [peopleSnap, familySnap] = await Promise.all([
            db.collection('people').get(),
            db.collection('families').get(),
        ]);
        const name = {};
        peopleSnap.forEach((d) => { name[d.id] = (d.data() || {}).name || d.id; });
        const who = (id) => (id ? (name[id] || id) : '—');

        const families = familySnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
        const byId = {};
        families.forEach((f) => { byId[f.id] = f; });

        const { merges, conflicts } = planFamilyMerges(families);

        console.log(`${families.length} Families; ${merges.length} household(s) recorded more than once.\n`);

        for (const m of merges) {
            const keep = byId[m.keepId];
            const changes = m.changes;
            console.log(`${who(changes.husbandId || keep.husbandId)} + ${who(changes.wifeId || keep.wifeId)}`);
            console.log(`  keep   ${m.keepId}`);
            console.log(`  drop   ${m.dropIds.join(', ')}`);
            if (changes.childIds) {
                console.log(`  children  ${(keep.childIds || []).map(who).join(', ') || '—'}` +
                    `  →  ${changes.childIds.map(who).join(', ')}`);
            }
            if (changes.anniversary) console.log(`  anniversary  ${changes.anniversary}`);

            if (COMMIT) {
                const batch = db.batch();
                if (Object.keys(changes).length) {
                    batch.update(db.collection('families').doc(m.keepId), changes);
                }
                m.dropIds.forEach((id) => batch.delete(db.collection('families').doc(id)));
                await batch.commit();
                console.log('  ✓ merged');
            }
            console.log('');
        }

        conflicts.forEach((c) => {
            console.log(`⚠ left alone — ${c.reason}`);
            console.log(`  ${c.familyIds.join(', ')}\n`);
        });

        if (!COMMIT) console.log('Dry run. Re-run with --commit to apply.');
        process.exit(0);
    })().catch((e) => { console.error(e); process.exit(1); });
}
