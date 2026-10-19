/**
 * @fileoverview MS-693 — add `resources.edit` to saved permission maps.
 *
 * ⚠ WHY A NEW KEY NEEDS A BACKFILL AT ALL. ADR-0082: once a permission map
 * has been saved on users/{uid}, that map is the whole answer, and a level
 * name does not override it. So the day `resources.edit` joins the catalog,
 * every account holding a saved map answers `false` to it — including the
 * editors the Resources library was built for, who would watch the page load
 * read-only and have no idea why. The presets carry the key from this release
 * on; this script carries it to the maps already written.
 *
 * It is deliberately narrow, the same shape MS-725 took for
 * `calendar.events.edit`. An account is touched only when its saved map is
 * EXACTLY its own builtin preset but for this one key — so a custom level, a
 * hand-tweaked map somebody meant, a legacy account with no map at all, and a
 * map that already has the key are every one of them skips. Somebody who has
 * deliberately narrowed an editor does not get it widened back by a script.
 *
 * Usage:
 *   node scripts/backfill-resources-edit-key.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/backfill-resources-edit-key.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 *   node scripts/backfill-resources-edit-key.js \
 *       --project mosaic-hymn-database --i-mean-prod \
 *       --revert docs/ops/ms-693-resources-edit-key-before-<stamp>.json
 *   ...same --revert... --commit
 *
 * Dry run is the default. `--commit` against the church project also needs
 * `--i-mean-prod`. Snapshots land in docs/ops/.
 */

const fs = require('fs');
const path = require('path');

const Catalog = require('../public/permission-catalog.js');
const Levels = require('../public/account-levels-core.js');

const KEY = 'resources.edit';
const FIELD = 'permissions.' + KEY;

function committing(argv) {
    return argv.includes('--commit');
}

function flagValue(argv, name) {
    const at = argv.indexOf(name);
    if (at < 0) return null;
    const value = argv[at + 1];
    if (!value || value.startsWith('--')) return null;
    return value;
}

function willWrite(argv) {
    return committing(argv) && argv.includes('--i-mean-prod');
}

function allowedProject(argv) {
    return require('./firebase-project').requireProject(argv, {
        hardcoded: 'mosaic-hymn-database',
    });
}

function hasSavedMap(user) {
    return !!(user && user.permissions && typeof user.permissions === 'object');
}

/**
 * True when `perms` matches `expected` on every catalog key but this one.
 * @param {object} perms the stored map
 * @param {object} expected the preset the account claims to be
 * @return {boolean} whether the only difference is `resources.edit`
 */
function equalsPresetExceptKey(perms, expected) {
    if (!perms || !expected) return false;
    for (const k of Catalog.PERMISSION_KEYS) {
        if (k === KEY) continue;
        if ((perms[k] === true) !== (expected[k] === true)) return false;
    }
    return true;
}

/**
 * What to write on one user, or null to leave them alone.
 *
 * Unlike MS-725 this is not editor-only: `resources.edit` is in the editor
 * operational bundle, so admin, elder, Pastoral Assistant and super admin all
 * carry it too, and all of them would otherwise be locked out of a library
 * their own rung is supposed to fill.
 *
 * @param {object} user users/{uid} data
 * @param {Function} [presetFor] buildPresetPermissions (injected in tests)
 * @return {?{field: string, preset: string, before: boolean, after: true}}
 */
function planForUser(user, presetFor) {
    const build = presetFor || Levels.buildPresetPermissions;
    if (!hasSavedMap(user)) return null;

    // The account level id, not the level NAME. A name is a label somebody
    // can retype; the id is what the Account Level the map came from is
    // called, and an account on a custom level has no preset to compare to.
    const preset = Levels.presetKeyFromAccountLevelId(user.accountLevelId);
    if (!preset) return null;

    const expected = build(preset);
    if (expected[KEY] !== true) return null;
    if (user.permissions[KEY] === true) return null;
    if (!equalsPresetExceptKey(user.permissions, expected)) return null;

    return {
        field: FIELD,
        preset: preset,
        before: user.permissions[KEY] === true,
        after: true,
    };
}

function initials(name, email) {
    const src = (name || '').trim();
    if (src) return src.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 3);
    const local = (email || '').split('@')[0];
    return local ? local.slice(0, 2).toUpperCase() : '??';
}

function stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Firestore treats dots in an update key as path separators. `resources.edit`
 * is ONE field name, so the string path `permissions.resources.edit` would
 * nest `{ resources: { edit } }` beside the real flat key and the gate would
 * still read false. FieldPath keeps the key intact.
 * @param {*} firestore the admin.firestore namespace
 * @return {*} a FieldPath
 */
function permissionFieldPath(firestore) {
    return new firestore.FieldPath('permissions', KEY);
}

function snapshotPath(kind, at) {
    return path.join(
        __dirname, '..', 'docs', 'ops',
        `ms-693-resources-edit-key-${kind}-${at}.json`);
}

function loadRevert(file) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || !Array.isArray(data.accounts)) {
        throw new Error('Revert file has no accounts[].');
    }
    if (data.key && data.key !== KEY) {
        throw new Error(`Revert file is for ${data.key}, not ${KEY}.`);
    }
    return data;
}

module.exports = {
    KEY,
    FIELD,
    committing,
    willWrite,
    allowedProject,
    planForUser,
    equalsPresetExceptKey,
    permissionFieldPath,
    initials,
};

if (require.main === module) {
    (async () => {
        const projectId = allowedProject(process.argv);
        const COMMIT = willWrite(process.argv);
        if (committing(process.argv) && !COMMIT) {
            throw new Error('--commit against the church also needs --i-mean-prod.');
        }
        const revertFile = flagValue(process.argv, '--revert');

        const admin = require('firebase-admin');
        admin.initializeApp({
            credential: admin.credential.applicationDefault(),
            projectId,
        });
        const db = admin.firestore();

        const rows = [];
        if (revertFile) {
            const snap = loadRevert(revertFile);
            for (const acct of snap.accounts) {
                const doc = await db.collection('users').doc(acct.uid).get();
                if (!doc.exists) {
                    throw new Error(`Revert target users/${acct.uid} is gone.`);
                }
                const data = doc.data() || {};
                rows.push({
                    uid: acct.uid,
                    initials: initials(data.name || data.displayName, data.email),
                    permissionLevel: data.permissionLevel || data.role || null,
                    accountLevelId: data.accountLevelId || null,
                    field: FIELD,
                    before: !!(data.permissions && data.permissions[KEY] === true),
                    after: acct.before === true,
                    value: acct.before === true,
                });
            }
        } else {
            const users = await db.collection('users').get();
            for (const doc of users.docs) {
                const data = doc.data() || {};
                const plan = planForUser(data);
                if (!plan) continue;
                rows.push({
                    uid: doc.id,
                    initials: initials(data.name || data.displayName, data.email),
                    permissionLevel: data.permissionLevel || data.role || null,
                    accountLevelId: data.accountLevelId || null,
                    field: plan.field,
                    before: plan.before,
                    after: plan.after,
                    value: plan.after,
                });
            }
        }

        const mode = revertFile ? 'REVERT' : 'BACKFILL';
        console.log(`${COMMIT ? 'COMMIT' : 'DRY RUN'} ${mode} — ${projectId}`);
        console.log(`accounts: ${rows.length}`);
        for (const row of rows) {
            console.log(
                `  ${row.initials} ${row.uid.slice(0, 8)}…  ${row.field}: ` +
                `${JSON.stringify(row.before)} -> ${JSON.stringify(row.after)}`);
        }

        if (!rows.length) {
            console.log('Nothing to write.');
            return;
        }

        const at = stamp();
        const beforePath = snapshotPath('before', at);
        const afterPath = snapshotPath('after', at);
        const payload = (kind) => ({
            ticket: 'MS-693',
            project: projectId,
            at,
            mode,
            key: KEY,
            field: FIELD,
            kind,
            accounts: rows.map((r) => ({
                uid: r.uid,
                permissionLevel: r.permissionLevel,
                accountLevelId: r.accountLevelId,
                field: r.field,
                before: r.before,
                after: r.after,
            })),
        });
        fs.mkdirSync(path.dirname(beforePath), {recursive: true});
        fs.writeFileSync(beforePath, JSON.stringify(payload('before'), null, 2) + '\n');
        fs.writeFileSync(afterPath, JSON.stringify(payload('after'), null, 2) + '\n');
        console.log(`before: ${path.relative(path.join(__dirname, '..'), beforePath)}`);
        console.log(`after:  ${path.relative(path.join(__dirname, '..'), afterPath)}`);

        if (!COMMIT) {
            console.log('No writes. Re-run with --i-mean-prod --commit to apply.');
            return;
        }

        const batch = db.batch();
        const fieldPath = permissionFieldPath(admin.firestore);
        for (const row of rows) {
            batch.update(db.collection('users').doc(row.uid), fieldPath, row.value);
        }
        await batch.commit();
        console.log(`Wrote ${rows.length} user(s).`);
        const root = path.join(__dirname, '..');
        console.log(
            'Revert: node scripts/backfill-resources-edit-key.js ' +
            `--project ${projectId} --i-mean-prod --revert ${path.relative(root, beforePath)} --commit`);
    })().catch((e) => {
        console.error(e.message || e);
        process.exit(1);
    });
}
