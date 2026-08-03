/**
 * @fileoverview Seed the two Group Types a serving rule most often needs:
 * **Family** and **Marriage**.
 *
 * A Role's "no two people from the same ___" rule is built from Relationship
 * Types that are (a) of kind `group` and (b) shared with editors. Until now the
 * only one that existed was Book Study, so the rule could say "no two from the
 * same Book Study" and nothing else — which is not the rule any church actually
 * wants to write. Family and Marriage are.
 *
 * ⚠ NOT A REPLACEMENT FOR THE `families` COLLECTION. That is the Membership
 * Directory's household record (ADR-0012) and is a different thing: it says who
 * lives together, and it is maintained alongside People. This is a Relationship
 * Group Type, whose groups are rostered by hand in Manage Tags and
 * Relationships. Creating the type does not populate it — a rule naming Family
 * has nothing to bite on until somebody makes Family groups.
 *
 * Both are Non-Prioritized: nobody leads a marriage, and for the purpose of
 * keeping a rota spread out nobody leads a family either.
 *
 * Idempotent, matched on name: a second run reports "already there" and writes
 * nothing.
 *
 * Run:  node scripts/seed-group-relationship-types.js [--dry-run]
 */

const admin = require('firebase-admin');
const Relationship = require('../public/relationship-core.js');

const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
const COLLECTION = 'relationship_types';

const DRY_RUN = process.argv.includes('--dry-run');

const { serviceAccount } = require('./service-account.js');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount()),
    projectId: FIREBASE_PROJECT_ID,
});

const db = admin.firestore();

const TYPES = [
    {
        kind: 'group',
        name: 'Family',
        priority: false,
        label: 'Family Member',
        sharedWithEditors: true,
    },
    {
        kind: 'group',
        name: 'Marriage',
        priority: false,
        label: 'Spouse',
        sharedWithEditors: true,
    },
];

async function run() {
    console.log('Seeding Group relationship types' + (DRY_RUN ? ' (dry run)' : ''));

    const snap = await db.collection(COLLECTION).get();
    const byName = {};
    snap.docs.forEach(doc => {
        const name = (doc.data() || {}).name;
        if (name) byName[String(name).toLowerCase()] = doc;
    });

    for (const type of TYPES) {
        // Validated against the shared model rather than trusted, so a seed can
        // never write a type the manager would refuse to edit.
        const errors = Relationship.validateType(type);
        if (errors.length) {
            console.error(`  ✖ ${type.name}: ${errors.join('; ')}`);
            process.exitCode = 1;
            continue;
        }

        const already = byName[type.name.toLowerCase()];
        if (already) {
            const kind = (already.data() || {}).kind;
            console.log(`  · ${type.name} already exists (${already.id}, kind: ${kind})`);
            continue;
        }

        if (DRY_RUN) {
            console.log(`  + ${type.name} would be created`);
            continue;
        }

        const ref = await db.collection(COLLECTION).add(type);
        console.log(`  + ${type.name} created (${ref.id})`);
    }

    console.log('Done.');
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
