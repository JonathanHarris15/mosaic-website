#!/usr/bin/env node
/**
 * MS-776 — additive account-level backfill.
 *
 * For a users/{uid} document that has neither accountLevelId nor a
 * permissions field, write the builtin account level and that preset's
 * permissions map. The rung is permissionLevel when that field is present,
 * otherwise role. Kiosk is a builtin rung.
 *
 * Accounts that already have an accountLevelId or a permissions field are
 * left alone. That includes a saved map whose stored string is still member.
 * role, permissionLevel, and pastoralAssistant are never written.
 *
 * A second run is a no-op: the first write supplies the two fields, and the
 * next pass skips the document.
 *
 *   node scripts/ms-776-backfill-account-levels.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/ms-776-backfill-account-levels.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 *
 * Dry run is the default. The public log uses an 8-character uid prefix.
 * Emails are not read. --commit against the church project also needs
 * --i-mean-prod. The cutover that stops reading the ladder is a later change.
 */

'use strict';

const Levels = require('../public/account-levels-core.js');

/**
 * @typedef {Object} BackfillPlan
 * @property {string} preset
 * @property {'permissionLevel'|'role'} source
 * @property {string} accountLevelId
 * @property {Record<string, boolean>} permissions
 */

/**
 * @typedef {Object} WriteEntry
 * @property {string} uid
 * @property {string} prefix
 * @property {'write'} action
 * @property {BackfillPlan} plan
 */

/**
 * @typedef {Object} SkipEntry
 * @property {string} uid
 * @property {string} prefix
 * @property {'skip'} action
 * @property {string} reason
 */

/**
 * @param {unknown} user
 * @returns {Record<string, unknown>}
 */
function asRecord(user) {
    if (!user || typeof user !== 'object' || Array.isArray(user)) return {};
    return /** @type {Record<string, unknown>} */ (user);
}

/**
 * @param {unknown} user
 * @returns {boolean}
 */
function hasAccountLevelId(user) {
    const value = asRecord(user).accountLevelId;
    return typeof value === 'string' && value !== '';
}

/**
 * The field existing is the map, including a non-object value. Writing over
 * it would replace a saved answer. Absence is the only "no map".
 * @param {unknown} user
 * @returns {boolean}
 */
function hasPermissionsField(user) {
    return Object.prototype.hasOwnProperty.call(asRecord(user), 'permissions');
}

/**
 * permissionLevel when the key is present, otherwise role. An empty
 * permissionLevel does not fall through. That matches firestore.rules.
 * @param {unknown} user
 * @returns {{source: 'permissionLevel'|'role', value: string}|null}
 */
function readLadder(user) {
    const doc = asRecord(user);
    if (Object.prototype.hasOwnProperty.call(doc, 'permissionLevel')) {
        const value = doc.permissionLevel;
        return {
            source: 'permissionLevel',
            value: typeof value === 'string' ? value : '',
        };
    }
    if (Object.prototype.hasOwnProperty.call(doc, 'role')) {
        const value = doc.role;
        return {
            source: 'role',
            value: typeof value === 'string' ? value : '',
        };
    }
    return null;
}

/**
 * @param {string} preset
 * @returns {Record<string, boolean>}
 */
function copyPreset(preset) {
    const source = /** @type {Record<string, unknown>} */ (
        Levels.buildPresetPermissions(preset));
    /** @type {Record<string, boolean>} */
    const out = {};
    for (const key of Object.keys(source)) {
        out[key] = source[key] === true;
    }
    return out;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isBuiltinRung(value) {
    return Levels.BUILTIN_PRESET_KEYS.indexOf(value) !== -1;
}

/**
 * Why this user is not a write, or '' when planForUser would write.
 * @param {unknown} user
 * @returns {string}
 */
function skipReason(user) {
    /** @type {string[]} */
    const present = [];
    if (hasAccountLevelId(user)) present.push('accountLevelId');
    if (hasPermissionsField(user)) present.push('permissions');
    if (present.length) return 'has ' + present.join(' and ');
    const ladder = readLadder(user);
    if (!ladder) return 'no permissionLevel or role';
    if (!isBuiltinRung(ladder.value)) return 'not a builtin rung';
    return '';
}

/**
 * The write for one user, or null to leave them alone.
 * @param {unknown} user
 * @returns {BackfillPlan|null}
 */
function planForUser(user) {
    if (skipReason(user)) return null;
    const ladder = readLadder(user);
    if (!ladder || !isBuiltinRung(ladder.value)) return null;
    const preset = ladder.value;
    return {
        preset,
        source: ladder.source,
        accountLevelId: Levels.accountLevelIdForPreset(preset),
        permissions: copyPreset(preset),
    };
}

/**
 * Fields this script is allowed to send to Firestore.
 * @param {BackfillPlan} plan
 * @returns {{accountLevelId: string, permissions: Record<string, boolean>}}
 */
function writePayload(plan) {
    return {
        accountLevelId: plan.accountLevelId,
        permissions: plan.permissions,
    };
}

/**
 * @param {unknown} user
 * @returns {{action: 'write', plan: BackfillPlan}|{action: 'skip', reason: string}}
 */
function classify(user) {
    const plan = planForUser(user);
    if (plan) return {action: 'write', plan};
    return {action: 'skip', reason: skipReason(user)};
}

/**
 * @param {string} uid
 * @returns {string}
 */
function uidPrefix(uid) {
    return String(uid || '').slice(0, 8);
}

/**
 * @param {Array<{uid: string, user: unknown}>} rows
 * @returns {Array<WriteEntry|SkipEntry>}
 */
function planUsers(rows) {
    /** @type {Array<WriteEntry|SkipEntry>} */
    const entries = rows.map((row) => {
        const decision = classify(row.user);
        const base = {uid: row.uid, prefix: uidPrefix(row.uid)};
        if (decision.action === 'write') {
            return {uid: base.uid, prefix: base.prefix, action: 'write', plan: decision.plan};
        }
        return {uid: base.uid, prefix: base.prefix, action: 'skip', reason: decision.reason};
    });
    entries.sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
    return entries;
}

/**
 * @param {BackfillPlan} plan
 * @returns {number}
 */
function trueKeyCount(plan) {
    return Object.keys(plan.permissions).filter((key) => plan.permissions[key] === true).length;
}

/**
 * @param {Array<WriteEntry|SkipEntry>} entries
 * @param {'dry-run'|'commit'} mode
 * @returns {string}
 */
function formatReport(entries, mode) {
    const writes = entries.filter((entry) => entry.action === 'write');
    const lines = [
        'MS-776 account-level backfill',
        'mode=' + mode,
        'writes=' + writes.length,
        'skips=' + (entries.length - writes.length),
        '',
    ];
    for (const entry of entries) {
        if (entry.action === 'write') {
            lines.push(
                'uid:' + entry.prefix
                + '  from=' + entry.plan.source + ':' + entry.plan.preset
                + '  accountLevelId=' + entry.plan.accountLevelId
                + '  permissions=' + entry.plan.preset + ' preset ('
                + trueKeyCount(entry.plan) + ' true keys)'
                + '  untouched=role,permissionLevel,pastoralAssistant');
        } else {
            lines.push('uid:' + entry.prefix + '  skip  ' + entry.reason);
        }
    }
    if (!writes.length) {
        lines.push('Nothing to write.');
    } else if (mode === 'dry-run') {
        lines.push('No writes. Re-run with --i-mean-prod --commit to apply.');
    }
    return lines.join('\n');
}

/**
 * @param {string[]} argv
 * @returns {boolean}
 */
function willWrite(argv) {
    return argv.includes('--commit') && argv.includes('--i-mean-prod');
}

/**
 * Hide a full uid if a Firestore error echoes the document path.
 * @param {string} message
 * @param {string} uid
 * @returns {string}
 */
function redactUid(message, uid) {
    if (!uid) return message;
    return message.split(uid).join(uidPrefix(uid));
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {Array<WriteEntry|SkipEntry>} entries
 * @returns {Promise<{wrote: number, skippedAtCommit: number}>}
 */
async function commitEntries(db, entries) {
    let wrote = 0;
    let skippedAtCommit = 0;
    for (const entry of entries) {
        if (entry.action !== 'write') continue;
        const ref = db.collection('users').doc(entry.uid);
        try {
            const did = await db.runTransaction(async (tx) => {
                const fresh = await tx.get(ref);
                if (!fresh.exists) return false;
                const plan = planForUser(fresh.data() || {});
                if (!plan) return false;
                tx.update(ref, writePayload(plan));
                return true;
            });
            if (did) wrote += 1;
            else skippedAtCommit += 1;
        } catch (err) {
            const message = err && /** @type {Error} */ (err).message
                ? String(/** @type {Error} */ (err).message)
                : String(err);
            throw new Error(
                'write failed for uid:' + entry.prefix + ' (' + redactUid(message, entry.uid) + ')',
                {cause: err});
        }
    }
    return {wrote, skippedAtCommit};
}

/**
 * @param {string[]} argv
 * @returns {Promise<void>}
 */
async function main(argv) {
    const {requireProject} = require('./firebase-project');
    const projectId = requireProject(argv, {hardcoded: 'mosaic-hymn-database'});
    if (argv.includes('--commit') && !willWrite(argv)) {
        throw new Error('--commit against the church also needs --i-mean-prod.');
    }
    const commit = willWrite(argv);
    const admin = require('firebase-admin');
    const credPath = require('./service-account').serviceAccountPath();
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(require(credPath)),
            projectId,
        });
    }
    const db = admin.firestore();
    const snap = await db.collection('users').get();
    const entries = planUsers(snap.docs.map((doc) => ({
        uid: doc.id,
        user: doc.data() || {},
    })));
    console.log(formatReport(entries, commit ? 'commit' : 'dry-run'));
    if (!commit) return;
    const result = await commitEntries(db, entries);
    console.log('wrote=' + result.wrote);
    console.log('skipped at commit=' + result.skippedAtCommit);
}

module.exports = {
    planForUser,
    writePayload,
    classify,
    planUsers,
    formatReport,
    willWrite,
};

if (require.main === module) {
    main(process.argv).catch((err) => {
        console.error(err && err.message ? err.message : err);
        process.exit(1);
    });
}
