/**
 * @fileoverview MS-94 — seed Elder Assignments (ADR-0013).
 *
 * One-shot, idempotent seed that gives every current member a default assigned
 * elder. With a single elder in the church right now (Sam Crites), every Person
 * carrying the "Member" tag is pointed at him: `shepherding.assignedElderId` =
 * the elder's Person id. Sets only the field (no Pastoral Record entry — this is
 * a silent default, like the Membership Track migration); idempotent: skips a
 * Person who already has an assignment, and never assigns the elder to himself.
 *
 * The elder is resolved from the data, not hard-coded: Persons linked to an
 * `elder`-role User, unioned with Persons carrying the projected "Elder" tag.
 * The script requires EXACTLY ONE elder (prints who) so it can't silently assign
 * everyone to the wrong person; pass --elder <personId> to override if needed.
 *
 * Usage:
 *   node scripts/seed-elder-assignments.js            # dry run (default)
 *   node scripts/seed-elder-assignments.js --commit   # apply
 *   node scripts/seed-elder-assignments.js --elder <personId> --commit
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
const COMMIT = process.argv.includes('--commit');
const ELDER_TAG = 'Elder';
const MEMBER_TAG = 'member'; // matched case-insensitively

function argValue(flag) {
    const i = process.argv.indexOf(flag);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function resolveServiceAccount() {
    const root = path.join(__dirname, '..');
    const match = fs.readdirSync(root).find(
        f => f.startsWith('mosaic-hymn-database-firebase-adminsdk') && f.endsWith('.json')
    );
    if (!match) throw new Error('No mosaic-hymn-database-firebase-adminsdk-*.json found in project root.');
    return require(path.join(root, match));
}

admin.initializeApp({ credential: admin.credential.cert(resolveServiceAccount()), projectId: FIREBASE_PROJECT_ID });
const db = admin.firestore();

function hasMemberTag(tags) {
    return (tags || []).some(t => typeof t === 'string' && t.toLowerCase() === MEMBER_TAG);
}

async function resolveElderPersonId(peopleById) {
    const override = argValue('--elder');
    if (override) {
        const p = peopleById[override];
        console.log(`Using --elder override: ${override}${p ? ` (${p.name || 'unnamed'})` : ' (NOT FOUND in people!)'}`);
        return override;
    }
    const elderIds = new Set();
    // (a) Persons linked to an elder-role User.
    const usersSnap = await db.collection('users').get();
    usersSnap.docs.forEach(d => {
        const u = d.data() || {};
        if (u.role === 'elder' && u.personId) elderIds.add(u.personId);
    });
    // (b) Persons carrying the projected Elder tag.
    Object.keys(peopleById).forEach(id => {
        if ((peopleById[id].tags || []).indexOf(ELDER_TAG) !== -1) elderIds.add(id);
    });

    const ids = [...elderIds];
    console.log(`Found ${ids.length} elder(s): ${ids.map(id => `${(peopleById[id] && peopleById[id].name) || '?'} [${id}]`).join(', ') || '(none)'}`);
    if (ids.length === 0) throw new Error('No elder found (no elder-role User link and no Elder tag). Pass --elder <personId>.');
    if (ids.length > 1) throw new Error('More than one elder found — pass --elder <personId> to choose which to default to.');
    return ids[0];
}

async function run() {
    console.log(`\nSeed Elder Assignments (ADR-0013) — ${COMMIT ? 'COMMIT' : 'DRY RUN (use --commit to apply)'}\n`);

    const peopleSnap = await db.collection('people').get();
    const peopleById = {};
    peopleSnap.docs.forEach(d => { peopleById[d.id] = d.data() || {}; });

    const elderId = await resolveElderPersonId(peopleById);
    const elderName = (peopleById[elderId] && peopleById[elderId].name) || elderId;
    console.log(`\nDefaulting every Member-tagged person to elder: ${elderName} [${elderId}]\n`);

    let assigned = 0, alreadySet = 0, notMember = 0, skippedElder = 0;
    for (const doc of peopleSnap.docs) {
        const data = peopleById[doc.id];
        if (doc.id === elderId) { skippedElder++; continue; }
        if (!hasMemberTag(data.tags)) { notMember++; continue; }
        const current = data.shepherding && data.shepherding.assignedElderId;
        if (current) { alreadySet++; continue; }

        assigned++;
        console.log(`  ${COMMIT ? 'assign' : 'would assign'} ${data.name || doc.id} → ${elderName}`);
        if (COMMIT) {
            await doc.ref.update({
                'shepherding.assignedElderId': elderId,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
    }

    console.log(`\nDone. ${COMMIT ? 'Assigned' : 'Would assign'}: ${assigned}. Already set: ${alreadySet}. Not a member: ${notMember}. Elder skipped: ${skippedElder}.`);
    if (!COMMIT) console.log('No changes were written. Re-run with --commit to apply.\n');
    process.exit(0);
}

run().catch(err => { console.error('Seed failed:', err); process.exit(1); });
