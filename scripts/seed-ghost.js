/**
 * @fileoverview Invent a congregation on the ghost, and nowhere else.
 *
 * The church's people, notes, and photos never come here, and nothing written
 * here is copied back. Every phone is a +1555 number, every email is
 * @example.test, and the logins use one test password that is not a church
 * secret. A second run writes the same document ids again.
 *
 * Refuses mosaic-hymn-database even when --i-mean-prod is present.
 *
 *   node scripts/seed-ghost.js --project mosaic-manager-ghost            # dry run
 *   node scripts/seed-ghost.js --project mosaic-manager-ghost --commit
 *
 * Logins (Email/Password), after --commit:
 *   ada.cole@example.test   elder
 *   ben.cole@example.test   member
 *   sam.reed@example.test   super_admin
 *   password: ghost-login-1
 */

const {PROD_PROJECT_ID} = require('./firebase-project');
const Household = require('../public/household-core.js');

const GHOST_PROJECT_ID = 'mosaic-manager-ghost';
const GHOST_PASSWORD = 'ghost-login-1';

const PEOPLE = [
    {
        id: 'ghost-ada-cole',
        name: 'Ada Cole',
        sex: 'female',
        kid: false,
        phone: '+15555550101',
        email: 'ada.cole@example.test',
        stage: 'member',
        tags: ['Member'],
        permissionLevel: 'elder',
    },
    {
        id: 'ghost-ben-cole',
        name: 'Ben Cole',
        sex: 'male',
        kid: false,
        phone: '+15555550102',
        email: 'ben.cole@example.test',
        stage: 'member',
        tags: ['Member'],
        permissionLevel: 'member',
    },
    {
        id: 'ghost-cora-cole',
        name: 'Cora Cole',
        sex: 'female',
        kid: true,
        phone: '+15555550103',
        email: 'cora.cole@example.test',
        stage: 'member',
        tags: ['Member'],
    },
    {
        id: 'ghost-drew-lane',
        name: 'Drew Lane',
        sex: 'male',
        kid: false,
        phone: '+15555550104',
        email: 'drew.lane@example.test',
        stage: 'visitor',
        tags: ['Visitor'],
    },
    {
        id: 'ghost-sam-reed',
        name: 'Sam Reed',
        sex: 'male',
        kid: false,
        phone: '+15555550105',
        email: 'sam.reed@example.test',
        stage: 'member',
        tags: ['Member'],
        permissionLevel: 'super_admin',
    },
];

function assertGhostTarget(projectId) {
    if (projectId === PROD_PROJECT_ID) {
        throw new Error(
            `Refusing to seed ${PROD_PROJECT_ID}. ` +
            'The church congregation is not invented here, even with --i-mean-prod.');
    }
    if (projectId !== GHOST_PROJECT_ID) {
        throw new Error(
            `Refusing to seed ${projectId}. ` +
            `This congregation belongs on ${GHOST_PROJECT_ID}.`);
    }
}

function personDoc(row, now, userId) {
    const doc = Household.personWrite({
        name: row.name,
        phone: row.phone,
        sex: row.sex,
        kid: row.kid,
    }, now);
    doc.contact.email = row.email;
    doc.membership = {stage: row.stage};
    doc.tags = row.tags.slice();
    if (row.permissionLevel) {
        doc.userId = userId || null;
        doc.accountRank = row.permissionLevel;
    }
    return doc;
}

function congregation(now, userIds) {
    const ids = userIds || {};
    const people = PEOPLE.map(row => ({
        id: row.id,
        doc: personDoc(row, now, ids[row.id]),
        account: row.permissionLevel ? {
            email: row.email,
            password: GHOST_PASSWORD,
            permissionLevel: row.permissionLevel,
            personId: row.id,
            displayName: row.name,
        } : null,
    }));
    const householdMembers = PEOPLE
        .filter(row => row.id.endsWith('-cole'))
        .map(row => ({personId: row.id, kid: row.kid, name: row.name}));
    return {
        people,
        household: {
            id: 'ghost-cole',
            doc: Household.householdWrite('The Cole Household', householdMembers, now),
        },
        family: {
            id: 'ghost-cole-family',
            doc: {
                husbandId: 'ghost-ben-cole',
                wifeId: 'ghost-ada-cole',
                childIds: ['ghost-cora-cole'],
            },
        },
    };
}

module.exports = {
    GHOST_PROJECT_ID,
    GHOST_PASSWORD,
    PEOPLE,
    assertGhostTarget,
    congregation,
};

if (require.main === module) {
    const admin = require('firebase-admin');
    const EventsCore = require('../public/events-core.js');
    const RolesCore = require('../public/roles-core.js');
    const {requireProject} = require('./firebase-project');
    const {serviceAccount} = require('./service-account.js');

    const projectId = requireProject(process.argv);
    assertGhostTarget(projectId);
    const commit = process.argv.includes('--commit');

    const plan = congregation(new Date().toISOString());
    console.log(`Ghost congregation on ${projectId}` + (commit ? '' : ' (dry run)'));
    for (const person of plan.people) {
        const account = person.account ? ` login ${person.account.permissionLevel}` : '';
        console.log(`  ${person.doc.name} <${person.doc.contact.email}>${account}`);
    }
    console.log(`  household ${plan.household.doc.name}`);
    console.log('  family Ben Cole + Ada Cole, child Cora Cole');
    if (!commit) {
        console.log('Dry run: no writes. Pass --commit to apply.');
        process.exit(0);
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount()),
        projectId,
    });
    const db = admin.firestore();
    const auth = admin.auth();

    (async () => {
        const userIds = {};
        for (const person of plan.people) {
            if (!person.account) continue;
            const account = person.account;
            let user;
            try {
                user = await auth.getUserByEmail(account.email);
            } catch (err) {
                if (err.code !== 'auth/user-not-found') throw err;
                user = await auth.createUser({
                    email: account.email,
                    password: account.password,
                    displayName: account.displayName,
                    emailVerified: true,
                });
                console.log(`  created login ${account.email}`);
            }
            userIds[person.id] = user.uid;
            await db.collection('users').doc(user.uid).set({
                email: account.email,
                permissionLevel: account.permissionLevel,
                role: account.permissionLevel,
                personId: account.personId,
            }, {merge: true});
        }

        const stamped = congregation(new Date().toISOString(), userIds);
        for (const person of stamped.people) {
            const ref = db.collection('people').doc(person.id);
            const existing = await ref.get();
            const doc = person.doc;
            if (existing.exists) delete doc.createdAt;
            await ref.set(doc, {merge: true});
        }
        const houseRef = db.collection('households').doc(stamped.household.id);
        const house = await houseRef.get();
        const houseDoc = stamped.household.doc;
        if (house.exists) delete houseDoc.createdAt;
        await houseRef.set(houseDoc, {merge: true});
        await db.collection('families').doc(stamped.family.id).set(stamped.family.doc, {merge: true});

        const sunday = db.collection('events').doc(EventsCore.SUNDAY_SERVICE_ID);
        const snap = await sunday.get();
        const {series, changed} = EventsCore.reconcileSundayService(
            snap.exists ? snap.data() : null,
            RolesCore.LITURGICAL_SLUGS);
        if (changed) await sunday.set(series);

        console.log('Ghost congregation written.');
    })().catch(err => {
        console.error(err.message || err);
        process.exit(1);
    });
}
