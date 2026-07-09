/**
 * @fileoverview MS-90 — Member CSV seed (ADR-0012).
 *
 * One-shot import of the church member roster export (a Planning Center CSV:
 * `Person ID, Name, Status, Primary Phone Number, Anniversary, Birthday (without
 * year), Birthdate`). Everyone in this file is a member, so:
 *
 *   - Imports name, phone, and birthday only (the CSV carries nothing else we use;
 *     its `Status` column is *invitation* status, not membership, and is ignored).
 *   - Defaults every imported Person to the **Member** Membership Stage, which
 *     projects the Member tag via ShepherdingCore (MS-83).
 *   - Matches each row to an existing Person by normalized name: a single match
 *     UPDATES that Person (fills phone/birthday, sets the stage) rather than
 *     creating a duplicate; no match CREATES a new Person; multiple matches are
 *     FLAGGED for manual resolution, never auto-merged.
 *   - Stashes the CSV anniversary as a temporary `importedAnniversary` for later
 *     hand-building of Families (MS-88).
 *
 * No external / PCO id is tracked — name is the only match key, matching the
 * existing de-dup approach.
 *
 * The pure pieces (CSV parse, name normalization, row classification, Person
 * builder) are exported for unit tests; the Firestore side only runs when the
 * script is executed directly.
 *
 * Usage:
 *   node scripts/import-members.js            # dry run (default) — report only
 *   node scripts/import-members.js --commit   # apply
 */

const Core = require('../public/shepherding-core.js');

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

// Minimal CSV parse for this well-formed export (no quoted commas in the data).
// Returns an array of row objects keyed by header.
function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length);
    if (!lines.length) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
        const cells = line.split(',');
        const row = {};
        headers.forEach((h, i) => { row[h] = (cells[i] || '').trim(); });
        return row;
    });
}

// Case/space-insensitive name key for matching.
function normalizeName(name) {
    return (name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Convert a MM/DD/YYYY birthdate to YYYY-MM-DD (the app's date format); returns
// null for blanks or anything that doesn't parse.
function toIsoDate(mdY) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((mdY || '').trim());
    if (!m) return null;
    const [, mo, da, yr] = m;
    return `${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
}

// Classify each CSV row against the existing People by name:
//   { row, action: 'create' | 'update' | 'ambiguous', matchId }
function classifyRows(rows, existingPeople) {
    const byName = {};
    for (const p of (existingPeople || [])) {
        const key = normalizeName(p.name);
        (byName[key] || (byName[key] = [])).push(p);
    }
    return (rows || []).map(row => {
        const matches = byName[normalizeName(row.Name)] || [];
        if (matches.length === 0) return { row, action: 'create', matchId: null };
        if (matches.length === 1) return { row, action: 'update', matchId: matches[0].id };
        return { row, action: 'ambiguous', matchId: null };
    });
}

// Build the Person field set for a CSV row: name, phone, birthday, Member stage
// (with its projected tags), and the stashed anniversary. `existingTags` lets an
// update preserve any tags the Person already carries.
function buildPersonFromRow(row, existingTags) {
    const membership = { stage: 'member', inactive: false };
    const fields = {
        name: (row.Name || '').trim(),
        'contact.phone': (row['Primary Phone Number'] || '').trim(),
        'membership.stage': 'member',
        'membership.inactive': false,
        tags: Core.applyMembershipTags(existingTags || [], membership),
    };
    const birthday = toIsoDate(row.Birthdate);
    if (birthday) fields.birthday = birthday;
    const anniversary = (row.Anniversary || '').trim();
    if (anniversary) fields.importedAnniversary = anniversary;
    return fields;
}

module.exports = { parseCsv, normalizeName, toIsoDate, classifyRows, buildPersonFromRow };

// ── Firestore side (only when run directly) ──────────────────────────────────
if (require.main === module) {
    const admin = require('firebase-admin');
    const path = require('path');
    const fs = require('fs');

    const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
    const CSV_FILE = path.join(__dirname, '..', 'docs', 'mosaic-church-members-2026-07-08.csv');
    const COMMIT = process.argv.includes('--commit');

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

    (async () => {
        console.log(`\nMember CSV seed (ADR-0012) — ${COMMIT ? 'COMMIT' : 'DRY RUN (use --commit to apply)'}\n`);
        const rows = parseCsv(fs.readFileSync(CSV_FILE, 'utf8'));
        const peopleSnap = await db.collection('people').get();
        const existing = peopleSnap.docs.map(d => ({ id: d.id, name: (d.data().name || ''), tags: d.data().tags || [] }));
        const plan = classifyRows(rows, existing);

        let created = 0, updated = 0, flagged = 0;
        for (const item of plan) {
            if (item.action === 'ambiguous') {
                flagged++;
                console.log(`  FLAG (ambiguous name): ${item.row.Name} — multiple existing People match; resolve by hand`);
                continue;
            }
            const existingPerson = item.matchId ? existing.find(e => e.id === item.matchId) : null;
            const fields = buildPersonFromRow(item.row, existingPerson ? existingPerson.tags : []);
            if (item.action === 'create') {
                created++;
                console.log(`  ${COMMIT ? 'create' : 'would create'}: ${fields.name}`);
                if (COMMIT) {
                    await db.collection('people').add({
                        name: fields.name,
                        contact: { phone: fields['contact.phone'] },
                        membership: { stage: 'member', inactive: false },
                        tags: fields.tags,
                        birthday: fields.birthday || null,
                        importedAnniversary: fields.importedAnniversary || null,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                }
            } else {
                updated++;
                console.log(`  ${COMMIT ? 'update' : 'would update'}: ${fields.name} (${item.matchId})`);
                if (COMMIT) {
                    await db.collection('people').doc(item.matchId).update(Object.assign({}, fields, {
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    }));
                }
            }
        }
        console.log(`\nDone. ${COMMIT ? 'Created' : 'To create'}: ${created}, ${COMMIT ? 'updated' : 'to update'}: ${updated}, flagged: ${flagged}.`);
        if (!COMMIT) console.log('No changes were written. Re-run with --commit to apply.\n');
        process.exit(0);
    })().catch(err => { console.error('Import failed:', err); process.exit(1); });
}
