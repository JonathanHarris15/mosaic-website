/**
 * @fileoverview MS-725 — add `calendar.events.edit` to saved Editor maps.
 *
 * Helm option A. The Editor preset now carries that key, but a map already
 * saved on users/{uid} is what firestore.rules reads. This script finds
 * accounts whose saved map equals the Editor preset except for that one key,
 * whose stored level is `editor` and whose `accountLevelId` is
 * `level_editor`, and writes only `permissions.calendar.events.edit: true`.
 *
 * Every other account is left alone. A custom level, a tweaked Editor map,
 * a legacy account with no map, and an Editor map that already has the key
 * are all skips.
 *
 * Usage:
 *   node scripts/backfill-editor-calendar-key.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/backfill-editor-calendar-key.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 *   node scripts/backfill-editor-calendar-key.js \
 *       --project mosaic-hymn-database --i-mean-prod \
 *       --revert docs/ops/ms-725-editor-calendar-key-before-<stamp>.json
 *   ...same --revert... --commit
 *
 * Dry run is the default. `--commit` against the church project also needs
 * `--i-mean-prod`. Snapshots land in docs/ops/.
 */

const fs = require('fs');
const path = require('path');

const Catalog = require('../public/permission-catalog.js');
const Levels = require('../public/account-levels-core.js');

const KEY = 'calendar.events.edit';
const FIELD = 'permissions.' + KEY;
const EDITOR_LEVEL_ID = Levels.accountLevelIdForPreset(Levels.PRESET_EDITOR);

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

function storedLevel(user) {
    if (!user || typeof user !== 'object') return null;
    return ('permissionLevel' in user) ? user.permissionLevel : user.role;
}

function hasSavedMap(user) {
    return !!(user && user.permissions && typeof user.permissions === 'object');
}

/**
 * True when `perms` matches the current Editor preset on every catalog key
 * except `calendar.events.edit`.
 * @param {object} perms stored map
 * @param {object} expected buildPresetPermissions('editor')
 * @return {boolean}
 */
function equalsEditorPresetExceptCalendarKey(perms, expected) {
    if (!perms || !expected) return false;
    for (const k of Catalog.PERMISSION_KEYS) {
        if (k === KEY) continue;
        if ((perms[k] === true) !== (expected[k] === true)) return false;
    }
    return true;
}

/**
 * What to write on one user, or null to leave them alone.
 * @param {object} user users/{uid} data
 * @param {object} [expected] Editor preset (injected in tests)
 * @return {?{field: string, before: boolean, after: true}}
 */
function planForUser(user, expected) {
    const preset = expected || Levels.buildPresetPermissions(Levels.PRESET_EDITOR);
    if (!hasSavedMap(user)) return null;
    if (storedLevel(user) !== 'editor') return null;
    if (user.accountLevelId !== EDITOR_LEVEL_ID) return null;
    if (!equalsEditorPresetExceptCalendarKey(user.permissions, preset)) return null;
    if (user.permissions[KEY] === true) return null;
    return {
        field: FIELD,
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
 * Firestore treats dots in update keys as path separators. The catalog key
 * `calendar.events.edit` is one field name, so a string path
 * `permissions.calendar.events.edit` would nest `{ calendar: { events:
 * { edit } } }` beside the real flat key. FieldPath keeps the key intact.
 * @param {*} firestore the admin.firestore namespace
 * @return {*} a FieldPath
 */
function permissionFieldPath(firestore) {
    return new firestore.FieldPath('permissions', KEY);
}

function snapshotPath(kind, at) {
    return path.join(
        __dirname, '..', 'docs', 'ops',
        `ms-725-editor-calendar-key-${kind}-${at}.json`);
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
    EDITOR_LEVEL_ID,
    committing,
    willWrite,
    allowedProject,
    planForUser,
    equalsEditorPresetExceptCalendarKey,
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
            const expected = Levels.buildPresetPermissions(Levels.PRESET_EDITOR);
            const users = await db.collection('users').get();
            for (const doc of users.docs) {
                const data = doc.data() || {};
                const plan = planForUser(data, expected);
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
            ticket: 'MS-725',
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
            'Revert: node scripts/backfill-editor-calendar-key.js ' +
            `--project ${projectId} --i-mean-prod --revert ${path.relative(root, beforePath)} --commit`);
    })().catch((e) => {
        console.error(e.message || e);
        process.exit(1);
    });
}
