/**
 * @fileoverview MS-776 access diff.
 *
 * Compares, for one users/{uid} document, the access each live resolver
 * grants today with the access a single canonical resolver would grant.
 * The canonical resolver reads only accountLevelId and permissions.
 * role, permissionLevel, and pastoralAssistant grant nothing.
 *
 * Canonical map:
 *   1. A saved permissions object is the whole answer (ADR 0082).
 *      system.super_admin means every catalog key, which is what Storage
 *      hasPermissionAccount and the super-admin preset already do.
 *   2. Otherwise a builtin accountLevelId contributes that preset's map.
 *   3. Otherwise the account has no doors. A permissions field that is
 *      present but not a map counts as a saved map of no keys, so the
 *      old ladder stays off, matching the rules.
 *
 * This module does not talk to Firestore. scripts/access-diff.js reads
 * prod and prints the report. It never writes.
 */

'use strict';

const Levels = require('../public/account-levels-core.js');
const Access = require('../public/access-core.js');
const Catalog = require('../public/permission-catalog.js');
const Events = require('../public/events-occurrence-core.js');
const Kiosk = require('../public/kiosk-core.js');

/** Write doors editsWith / editsWithAccount name in the rules. */
const WRITE_KEYS = Object.freeze([
    'hymns.edit',
    'roles.manager.edit',
    'calendar.events.edit',
    'services.builder.edit',
    'calendar.away.edit',
    'printables.edit',
    'resources.edit',
    'directory.edit_identity',
]);

const EDITOR_LEVELS = Object.freeze([
    'editor', 'admin', 'elder', 'super_admin', 'pastoral_assistant',
]);
const MEMBER_LEVELS = Object.freeze([
    'member', 'editor', 'admin', 'elder', 'super_admin', 'pastoral_assistant',
]);
const ELDER_LEVELS = Object.freeze(['elder', 'super_admin']);
const ADMIN_LEVELS = Object.freeze(['admin', 'super_admin']);
const SEE_RUNGS = Object.freeze(['member', 'participant', 'editor', 'elder']);

/**
 * Catalog key → Firestore cap that already decides that key.
 * null: the key is not a door (sign-in, public, world-readable hymns).
 * A client key the rules already refuse is noted, not treated as a loss
 * of access the account can use.
 * @type {Record<string, string|null>}
 */
const KEY_PAIR = {
    'core.sign_in': null,
    'visibility.rung.public': null,
    'visibility.rung.member': 'see.member',
    'visibility.rung.participant': 'see.participant',
    'visibility.rung.editor': 'see.editor',
    'visibility.rung.elder': 'see.elder',
    'visibility.lift_hidden_tags': 'readsAsElder',
    'directory.view': 'isMember',
    'directory.edit_identity': 'write.directory.edit_identity',
    'directory.edit_identity.assistant': 'isEditor',
    'directory.resolve_requests': 'isEditor',
    'shep.dashboard.view': 'readsAsElder',
    'shep.profile.view': 'readsAsElder',
    'shep.notes.view': 'readsAsElder',
    'shep.documents.view': 'readsAsElder',
    'shep.tasks.view': 'readsAsElder',
    'shep.care_lists.view': 'readsAsElder',
    'shep.relationships.view': 'readsAsElder',
    'shep.forms.view': 'readsAsElder',
    'shep.presence.view': 'readsAsElder',
    'shep.notes.write': 'writesTheRecord',
    'shep.documents.write': 'writesTheRecord',
    'shep.tasks.write': 'writesTheRecord',
    'shep.care_lists.write': 'writesTheRecord',
    'shep.forms.write': 'writesTheRecord',
    'shep.panels.write': 'writesTheRecord',
    'shep.tags.manage': 'canDecide',
    'shep.status.manage': 'canDecide',
    'shep.views.manage': 'canDecide',
    'shep.relationships.manage': 'canDecide',
    'shep.elder_assignment.set': 'canDecide',
    'shep.membership_stage.set': 'canDecide',
    'shep.explain_changes': 'canDecide',
    'shep.prayer.send': 'canDecide',
    'shep.forms.lock_elder': 'canDecide',
    'shep.guidance.lock': 'canDecide',
    'shep.count_as_elder': 'countsAsElder',
    'shep.elder_assignment.be_assignee': 'countsAsElder',
    'calendar.view': 'see.member',
    'calendar.events.edit': 'write.calendar.events.edit',
    'calendar.away.view': 'isMember',
    'calendar.away.edit': 'write.calendar.away.edit',
    'services.builder.view': 'isEditor',
    'services.builder.edit': 'write.services.builder.edit',
    'services.week_shift': 'readsAsElder',
    'services.guidance.view': 'isEditor',
    'hymns.view': null,
    'hymns.edit': 'write.hymns.edit',
    'printables.view': 'readsAsEditor',
    'printables.edit': 'write.printables.edit',
    'roles.manager.view': 'isEditor',
    'roles.manager.edit': 'write.roles.manager.edit',
    'resources.edit': 'write.resources.edit',
    'analytics.view': 'readsAsElder',
    'admin.dashboard.access': 'admin.dashboard.access',
    'admin.sms.manage': 'isAdmin',
    'admin.push.manage': 'isAdmin',
    'admin.accounts.view': 'isAdmin',
    'admin.accounts.provision': 'isAdmin',
    'admin.accounts.assign_level': 'isAdmin',
    'admin.levels.manage': 'isAdmin',
    'admin.mcp.view': 'isEditor',
    'system.kiosk': 'isKiosk',
    'system.super_admin': 'isAdmin',
};

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
 * @param {string} key
 * @returns {boolean}
 */
function hasField(user, key) {
    return Object.prototype.hasOwnProperty.call(asRecord(user), key);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
    return typeof value === 'string' ? value : '';
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>|null}
 */
function asMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return /** @type {Record<string, unknown>} */ (value);
}

/**
 * permissions is "in use" when the field exists, even if the value is not a map.
 * That matches ('permissions' in data) in the rules: the ladder fallback is off.
 * @param {unknown} user
 * @returns {{present: boolean, map: Record<string, unknown>|null}}
 */
function storedMap(user) {
    if (!hasField(user, 'permissions')) return {present: false, map: null};
    return {present: true, map: asMap(asRecord(user).permissions)};
}

/**
 * firestore.rules permissionLevel(): the field if present, else role.
 * @param {unknown} user
 * @returns {string}
 */
function storedLevel(user) {
    const doc = asRecord(user);
    if (hasField(user, 'permissionLevel')) return asString(doc.permissionLevel);
    return asString(doc.role);
}

/**
 * @param {unknown} user
 * @returns {boolean}
 */
function pastoralFlag(user) {
    return asRecord(user).pastoralAssistant === true;
}

/**
 * @param {string} level
 * @returns {boolean}
 */
function isPastoralLevel(level) {
    return level === 'pastoral_assistant';
}

/**
 * Storage higherBuiltinRung, copied so a change to storage.rules has to
 * update this mirror on purpose. Admin outranks editor here. The client
 * preset rank treats those two as equal.
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function storageHigher(a, b) {
    return a === 'super_admin' || b === 'super_admin' ? 'super_admin'
        : a === 'elder' || b === 'elder' ? 'elder'
        : a === 'pastoral_assistant' || b === 'pastoral_assistant' ? 'pastoral_assistant'
        : a === 'admin' || b === 'admin' ? 'admin'
        : a === 'editor' || b === 'editor' ? 'editor'
        : a === 'member' || b === 'member' ? 'member'
        : a === 'kiosk' || b === 'kiosk' ? 'kiosk'
        : a === 'viewer' || b === 'viewer' ? 'viewer'
        : '';
}

/**
 * storage.rules rungFromPermissionMap. Kiosk is tested first, then super admin.
 * @param {Record<string, unknown>|null} perms
 * @returns {string}
 */
function storageRungFromMap(perms) {
    if (!perms) return '';
    return perms['system.kiosk'] === true ? 'kiosk'
        : perms['system.super_admin'] === true ? 'super_admin'
        : perms['shep.count_as_elder'] === true ? 'elder'
        : perms['visibility.lift_hidden_tags'] === true ? 'pastoral_assistant'
        : perms['admin.dashboard.access'] === true ? 'admin'
        : (perms['directory.edit_identity'] === true
            || perms['services.builder.edit'] === true
            || perms['printables.edit'] === true) ? 'editor'
        : perms['directory.view'] === true ? 'member'
        : '';
}

/**
 * storage.rules permissionLevelAccount, given the user document.
 * @param {unknown} user
 * @returns {string}
 */
function storagePermissionLevel(user) {
    const doc = asRecord(user);
    const stored = storedLevel(user);
    const fromId = Levels.presetKeyFromAccountLevelId(asString(doc.accountLevelId)) || '';
    const packed = storedMap(user);
    const fromMap = packed.present ? storageRungFromMap(packed.map) : '';
    return storageHigher(storageHigher(fromId, stored), fromMap);
}

/**
 * @param {Record<string, boolean>} doors
 * @param {Record<string, boolean>} map
 */
function addWriteDoors(doors, map) {
    for (const key of WRITE_KEYS) {
        doors['write.' + key] = map[key] === true;
    }
}

/**
 * @param {Record<string, boolean>} doors
 * @param {boolean} isMember
 * @param {boolean} readsAsEditor
 * @param {boolean} readsAsElder
 */
function addRuleSees(doors, isMember, readsAsEditor, readsAsElder) {
    doors['see.member'] = isMember || readsAsEditor;
    doors['see.participant'] = readsAsEditor;
    doors['see.editor'] = readsAsEditor;
    doors['see.elder'] = readsAsElder;
}

/**
 * @param {unknown} rank
 * @returns {Record<string, boolean>}
 */
function seesForRank(rank) {
    /** @type {Record<string, boolean>} */
    const doors = {};
    const label = typeof rank === 'string' ? rank : '';
    for (const rung of SEE_RUNGS) {
        doors['see.' + rung] = Events.canSee(
            label,
            {visibility: rung, seriesId: 'not_sunday'},
            null,
        ) === true;
    }
    return doors;
}

/**
 * What firestore.rules would allow this signed-in account, assuming the
 * user document exists.
 * @param {unknown} user
 * @returns {Record<string, boolean>}
 */
function firestoreDoors(user) {
    const level = storedLevel(user);
    const pa = isPastoralLevel(level) || pastoralFlag(user);
    const isEditor = EDITOR_LEVELS.includes(level) || pa;
    const isAdmin = ADMIN_LEVELS.includes(level);
    const isMember = MEMBER_LEVELS.includes(level) || pa;
    const isElder = ELDER_LEVELS.includes(level);
    const isKiosk = level === 'kiosk';
    const packed = storedMap(user);
    const map = packed.map;
    const usesMap = packed.present;
    /**
     * @param {string} key
     * @returns {boolean}
     */
    const has = (key) => !!(usesMap && map && map[key] === true);
    /**
     * @param {string} key
     * @returns {boolean}
     */
    const editsWith = (key) => has(key) || (!usesMap && isEditor);
    const readsAsElder = has('visibility.lift_hidden_tags') || pa || (!usesMap && isElder);
    const readsAsEditor = has('directory.edit_identity') || has('printables.edit')
        || pa || (!usesMap && isEditor);
    const writesTheRecord = has('shep.notes.write') || pa || (!usesMap && isElder);
    const canDecide = has('shep.tags.manage') || pa || (!usesMap && isElder);
    const countsAsElder = has('shep.count_as_elder') || (!usesMap && isElder);

    /** @type {Record<string, boolean>} */
    const doors = {
        isAdmin,
        isEditor,
        isMember,
        isElder,
        isKiosk,
        isPastoralAssistant: pa,
        readsAsElder,
        readsAsEditor,
        writesTheRecord,
        canDecide,
        countsAsElder,
        presenceRead: readsAsEditor || has('services.builder.edit'),
        'admin.dashboard.access': has('admin.dashboard.access') || (!usesMap && isAdmin),
    };
    for (const key of WRITE_KEYS) doors['write.' + key] = editsWith(key);
    addRuleSees(doors, isMember, readsAsEditor, readsAsElder);
    return doors;
}

/**
 * What storage.rules would allow this account. Visibility uses levelOf
 * (permissionLevel, else role) plus the pastoralAssistant flag, not the
 * higher permissionLevelAccount rung. Write doors use editsWithAccount.
 * @param {unknown} user
 * @returns {Record<string, boolean>}
 */
function storageDoors(user) {
    const level = storedLevel(user);
    const paFlag = pastoralFlag(user);
    const rung = storagePermissionLevel(user);
    const pa = rung === 'pastoral_assistant' || paFlag;
    const isEditor = EDITOR_LEVELS.includes(rung) || pa;
    const isElder = ELDER_LEVELS.includes(rung);
    const isMember = MEMBER_LEVELS.includes(rung) || pa;
    const packed = storedMap(user);
    const usesMap = packed.present;
    const superAdmin = !!(usesMap && packed.map && packed.map['system.super_admin'] === true);
    /**
     * @param {string} key
     * @returns {boolean}
     */
    const has = (key) => superAdmin || !!(usesMap && packed.map && packed.map[key] === true);
    const memberish = MEMBER_LEVELS.includes(level) || paFlag;
    const editorish = EDITOR_LEVELS.includes(level) || paFlag;
    const elderish = ELDER_LEVELS.includes(level) || isPastoralLevel(level) || paFlag;

    /** @type {Record<string, boolean>} */
    const doors = {
        isEditor,
        isMember,
        isElder,
        isPastoralAssistant: pa,
        readsAsElder: isElder || pa,
        readsAsEditor: isEditor || pa,
        canDecide: isElder || pa,
        'see.member': memberish,
        'see.participant': editorish,
        'see.editor': editorish,
        'see.elder': elderish,
    };
    for (const key of WRITE_KEYS) {
        doors['write.' + key] = has(key) || (!usesMap && isEditor);
    }
    return doors;
}

/**
 * The session auth.js withResolvedLevel hands a page, restated so the diff
 * can run in Node. Pages then read permissionLevel off this object.
 * @param {unknown} user
 * @returns {Record<string, unknown>}
 */
function resolveSession(user) {
    const doc = asRecord(user);
    const account = Levels.normalizeAccount(doc);
    const permissions = Levels.effectivePermissions(doc);
    return Object.assign({}, doc, Levels.storedMarkers(doc), {
        permissionLevel: account.permissionLevel,
        role: account.permissionLevel,
        permissions: permissions,
    });
}

/**
 * What the client and the MCP grant. MCP calls AccessCore on the stored
 * document and then writes with the Admin SDK, so those gates are real
 * doors, not just buttons. Pages also branch on the resolved rung string.
 * A door is open if either path opens it.
 * @param {unknown} user
 * @returns {Record<string, boolean>}
 */
function clientDoors(user) {
    const rung = asString(Levels.canonicalPermissionLevel(asRecord(user)));
    const session = resolveSession(user);
    const pa = Access.isPastoralAssistant(user) === true || rung === 'pastoral_assistant';
    const isEditor = EDITOR_LEVELS.includes(rung)
        || Access.writesAsEditor(user) === true
        || pa;
    const isAdmin = ADMIN_LEVELS.includes(rung) || Access.accessesAdminDashboard(user) === true;
    const isMember = MEMBER_LEVELS.includes(rung)
        || Access.readsAsMember(user) === true
        || Access.canViewDirectory(user) === true
        || pa;
    const isElder = ELDER_LEVELS.includes(rung) || Access.isAnElder(user) === true;
    const isKiosk = Kiosk.isKioskAccount(user) === true
        || Kiosk.isKioskAccount(session) === true;
    const readsAsElder = Access.readsAsElder(user) === true || isElder;
    const readsAsEditor = Access.readsAsEditor(user) === true || isEditor;
    const writesTheRecord = Access.writesTheRecord(user) === true || (isElder && !pa);
    const canDecide = Access.canDecide(user) === true || (isElder && rung !== 'admin');
    const countsAsElder = Access.isAnElder(user) === true || (ELDER_LEVELS.includes(rung));

    /** @type {Record<string, boolean>} */
    const doors = {
        isAdmin,
        isEditor,
        isMember,
        isElder,
        isKiosk,
        isPastoralAssistant: pa,
        readsAsElder,
        readsAsEditor,
        writesTheRecord,
        canDecide,
        countsAsElder,
        presenceRead: readsAsEditor || Access.hasPermission(user, 'services.builder.edit') === true,
        'admin.dashboard.access': Access.hasPermission(user, 'admin.dashboard.access') === true || isAdmin,
    };
    const legacyLadder = !storedMap(user).present;
    for (const key of WRITE_KEYS) {
        doors['write.' + key] = Access.writesWith(user, key) === true || (isEditor && legacyLadder);
    }
    const fromAccess = seesForRankObject(user);
    const fromRung = seesForRank(rung);
    for (const rungName of SEE_RUNGS) {
        const cap = 'see.' + rungName;
        doors[cap] = fromAccess[cap] === true || fromRung[cap] === true;
    }
    const effective = Levels.effectivePermissions(asRecord(user));
    for (const key of Catalog.PERMISSION_KEYS) {
        doors['key.' + key] = effective[key] === true;
    }
    return doors;
}

/**
 * eventRungsFor on the account object, which is what the calendar uses
 * when AccessCore is loaded. seesForRank is the string fallback.
 * @param {unknown} user
 * @returns {Record<string, boolean>}
 */
function seesForRankObject(user) {
    const rungs = Access.eventRungsFor(user);
    const list = Array.isArray(rungs) ? rungs : [];
    /** @type {Record<string, boolean>} */
    const doors = {};
    for (const rung of SEE_RUNGS) doors['see.' + rung] = list.indexOf(rung) !== -1;
    return doors;
}

/**
 * functions/trade-writes.js rankOf: permissionLevel, else role. The flag
 * is not read. Visibility is EventsOccurrenceCore.canSee on that string.
 * @param {unknown} user
 * @returns {Record<string, boolean>}
 */
function rankOfDoors(user) {
    const doc = asRecord(user);
    const rank = asString(doc.permissionLevel) || asString(doc.role) || '';
    return seesForRank(rank);
}

/**
 * publicForm's rank: rankOf, then the pastoralAssistant flag promotes the
 * caller to pastoral_assistant unless they are already elder, super admin,
 * or a pastoral assistant.
 * @param {unknown} user
 * @returns {Record<string, boolean>}
 */
function formRankDoors(user) {
    const doc = asRecord(user);
    let rank = asString(doc.permissionLevel) || asString(doc.role) || '';
    if (pastoralFlag(user) && !ELDER_LEVELS.includes(rank) && rank !== 'pastoral_assistant') {
        rank = 'pastoral_assistant';
    }
    return seesForRank(rank);
}

/**
 * The map the canonical resolver reads. See the file header.
 * @param {unknown} user
 * @returns {Record<string, boolean>}
 */
function canonicalMap(user) {
    const packed = storedMap(user);
    if (packed.present) {
        const source = /** @type {Record<string, unknown>} */ (packed.map || {});
        if (source['system.super_admin'] === true) return Catalog.allOn();
        const out = /** @type {Record<string, boolean>} */ (Catalog.emptyPermissions());
        for (const key of Catalog.PERMISSION_KEYS) {
            if (source[key] === true) out[key] = true;
        }
        return out;
    }
    const preset = Levels.presetKeyFromAccountLevelId(asString(asRecord(user).accountLevelId));
    if (preset) return Levels.buildPresetPermissions(preset);
    return Catalog.emptyPermissions();
}

/**
 * Rank label derived from the canonical map. Super admin wins over the
 * kiosk key that allOn() also sets, so a super admin is not a kiosk.
 * @param {Record<string, boolean>} map
 * @returns {string}
 */
function canonicalRank(map) {
    if (map['system.super_admin'] === true) return 'super_admin';
    return Levels.levelMatchingPermissions(map);
}

/**
 * Doors the one resolver would open. No role, permissionLevel, or flag.
 * @param {unknown} user
 * @returns {Record<string, boolean>}
 */
function canonicalDoors(user) {
    const map = canonicalMap(user);
    const rank = canonicalRank(map);
    const pa = rank === 'pastoral_assistant';
    const isAdmin = rank === 'admin' || rank === 'super_admin' || map['admin.dashboard.access'] === true;
    const isElder = map['shep.count_as_elder'] === true;
    const isEditor = EDITOR_LEVELS.includes(rank)
        || map['directory.edit_identity'] === true
        || map['printables.edit'] === true
        || map['services.builder.edit'] === true
        || map['roles.manager.edit'] === true
        || map['hymns.edit'] === true;
    const isMember = MEMBER_LEVELS.includes(rank)
        || map['directory.view'] === true
        || map['visibility.rung.member'] === true
        || isEditor;
    const readsAsElder = map['visibility.lift_hidden_tags'] === true || pa;
    const readsAsEditor = map['directory.edit_identity'] === true
        || map['printables.edit'] === true
        || pa
        || isEditor;
    const writesTheRecord = map['shep.notes.write'] === true || pa;
    const canDecide = map['shep.tags.manage'] === true || pa;
    const countsAsElder = map['shep.count_as_elder'] === true;

    /** @type {Record<string, boolean>} */
    const doors = {
        isAdmin,
        isEditor,
        isMember,
        isElder,
        isKiosk: rank === 'kiosk',
        isPastoralAssistant: pa,
        readsAsElder,
        readsAsEditor,
        writesTheRecord,
        canDecide,
        countsAsElder,
        presenceRead: readsAsEditor || map['services.builder.edit'] === true,
        'admin.dashboard.access': map['admin.dashboard.access'] === true || rank === 'super_admin',
    };
    addWriteDoors(doors, map);
    addRuleSees(doors, isMember, readsAsEditor, readsAsElder);
    if (map['visibility.rung.member'] === true) doors['see.member'] = true;
    if (map['visibility.rung.participant'] === true) doors['see.participant'] = true;
    if (map['visibility.rung.editor'] === true) doors['see.editor'] = true;
    if (map['visibility.rung.elder'] === true) doors['see.elder'] = true;
    for (const key of Catalog.PERMISSION_KEYS) {
        doors['key.' + key] = map[key] === true;
    }
    return doors;
}

/**
 * @param {string} cap
 * @param {Record<string, boolean>} firestore
 * @returns {boolean}
 */
function clientKeyBlocks(cap, firestore) {
    if (!cap.startsWith('key.')) return true;
    const key = cap.slice(4);
    if (!Object.prototype.hasOwnProperty.call(KEY_PAIR, key)) return true;
    const pair = KEY_PAIR[key];
    if (pair === null) return false;
    return firestore[pair] === true;
}

/**
 * @param {string} resolver
 * @param {Record<string, boolean>} current
 * @param {Record<string, boolean>} canonical
 * @param {Record<string, boolean>} firestore
 * @param {boolean} alwaysBlock
 * @returns {{resolver: string, blocking: string[], noted: string[], gains: string[]}}
 */
function compareResolver(resolver, current, canonical, firestore, alwaysBlock) {
    /** @type {string[]} */
    const blocking = [];
    /** @type {string[]} */
    const noted = [];
    /** @type {string[]} */
    const gains = [];
    for (const cap of Object.keys(current).sort()) {
        const now = current[cap] === true;
        const next = canonical[cap] === true;
        if (now && !next) {
            const blocks = alwaysBlock || clientKeyBlocks(cap, firestore);
            (blocks ? blocking : noted).push(cap);
        } else if (!now && next) {
            gains.push(cap);
        }
    }
    return {resolver, blocking, noted, gains};
}

/**
 * @param {unknown} user
 * @returns {{permissionLevel: string, role: string, accountLevelId: string, pastoralAssistant: boolean, hasMap: boolean, trueKeys: number, nestedMap: boolean}}
 */
function shapeOf(user) {
    const doc = asRecord(user);
    const packed = storedMap(user);
    const map = packed.map || {};
    const trueKeys = Object.keys(map).filter((key) => map[key] === true).length;
    const nestedMap = Object.keys(map).some((key) => {
        const value = map[key];
        return !!value && typeof value === 'object';
    });
    return {
        permissionLevel: hasField(user, 'permissionLevel') ? asString(doc.permissionLevel) : '',
        role: hasField(user, 'role') ? asString(doc.role) : '',
        accountLevelId: asString(doc.accountLevelId),
        pastoralAssistant: pastoralFlag(user),
        hasMap: packed.present,
        trueKeys,
        nestedMap,
    };
}

/**
 * Keys a level document would grant that the canonical map does not.
 * Informational: the rules do not read account_levels today.
 * @param {unknown} user
 * @param {unknown} levelDoc
 * @returns {string[]}
 */
function levelDocWider(user, levelDoc) {
    const levelMap = asMap(asRecord(levelDoc).permissions);
    if (!levelMap) return [];
    const mine = canonicalMap(user);
    /** @type {string[]} */
    const extra = [];
    for (const key of Catalog.PERMISSION_KEYS) {
        if (levelMap[key] === true && mine[key] !== true) extra.push(key);
    }
    return extra;
}

/**
 * @typedef {Object} ResolverDiff
 * @property {string} resolver
 * @property {string[]} blocking
 * @property {string[]} noted
 * @property {string[]} gains
 */

/**
 * @typedef {Object} AccountDiff
 * @property {ReturnType<typeof shapeOf>} shape
 * @property {Record<string, string>} ranks
 * @property {ResolverDiff[]} resolvers
 * @property {string[]} blocking
 * @property {string[]} noted
 * @property {string[]} gains
 */

/**
 * @param {unknown} user
 * @returns {AccountDiff}
 */
function diffAccount(user) {
    const firestore = firestoreDoors(user);
    const storage = storageDoors(user);
    const client = clientDoors(user);
    const rankOf = rankOfDoors(user);
    const formRank = formRankDoors(user);
    const canonical = canonicalDoors(user);
    const resolvers = [
        compareResolver('firestore', firestore, canonical, firestore, true),
        compareResolver('storage', storage, canonical, firestore, true),
        compareResolver('rankOf', rankOf, canonical, firestore, true),
        compareResolver('formRank', formRank, canonical, firestore, true),
        compareResolver('client', client, canonical, firestore, false),
    ];
    /** @type {string[]} */
    const blocking = [];
    /** @type {string[]} */
    const noted = [];
    /** @type {string[]} */
    const gains = [];
    for (const part of resolvers) {
        for (const cap of part.blocking) blocking.push(part.resolver + ' ' + cap);
        for (const cap of part.noted) noted.push(part.resolver + ' ' + cap);
        for (const cap of part.gains) gains.push(part.resolver + ' ' + cap);
    }
    const doc = asRecord(user);
    return {
        shape: shapeOf(user),
        ranks: {
            firestore: storedLevel(user),
            storage: storagePermissionLevel(user),
            client: asString(Levels.canonicalPermissionLevel(doc)),
            rankOf: asString(doc.permissionLevel) || asString(doc.role),
            formRank: formRankLabel(user),
            canonical: canonicalRank(canonicalMap(user)),
        },
        resolvers,
        blocking,
        noted,
        gains,
    };
}

/**
 * @param {unknown} user
 * @returns {string}
 */
function formRankLabel(user) {
    const doc = asRecord(user);
    let rank = asString(doc.permissionLevel) || asString(doc.role);
    if (pastoralFlag(user) && !ELDER_LEVELS.includes(rank) && rank !== 'pastoral_assistant') {
        rank = 'pastoral_assistant';
    }
    return rank;
}

/**
 * @param {string} uid
 * @returns {string}
 */
function uidPrefix(uid) {
    const raw = asString(uid);
    return raw ? raw.slice(0, 8) : '(none)';
}

/**
 * @typedef {Object} ReportedAccount
 * @property {string} uidPrefix
 * @property {ReturnType<typeof shapeOf>} shape
 * @property {Record<string, string>} ranks
 * @property {string[]} blocking
 * @property {string[]} noted
 * @property {string[]} gains
 * @property {string[]} levelDocWider
 */

/**
 * @typedef {Object} RosterRow
 * @property {string} uidPrefix
 * @property {string} line
 */

/**
 * @typedef {Object} DiffReport
 * @property {number} users
 * @property {number} blockingUsers
 * @property {number} blockingLosses
 * @property {number} notedLosses
 * @property {number} gains
 * @property {boolean} blocking
 * @property {ReportedAccount[]} changed
 * @property {number} unchanged
 * @property {RosterRow[]} roster
 */

/**
 * @param {AccountDiff} diff
 * @returns {string}
 */
function headline(diff) {
    const from = diff.ranks.firestore || diff.ranks.rankOf || 'viewer';
    const to = diff.ranks.canonical || 'viewer';
    if (diff.blocking.length) return 'LOSES ' + from + ' → ' + to;
    if (diff.gains.length) return 'GAINS only (' + from + ' → ' + to + ')';
    if (diff.noted.length) return 'noted only';
    return 'unchanged';
}

/**
 * @param {AccountDiff} diff
 * @param {string} prefix
 * @returns {string}
 */
function rosterLine(diff, prefix) {
    return 'uid:' + prefix + '  ' + headline(diff) + '  ' + formatShape(diff.shape);
}

/**
 * @param {Array<{uid: string, user: unknown, levelDoc?: unknown}>} rows
 * @returns {DiffReport}
 */
function report(rows) {
    /** @type {ReportedAccount[]} */
    const changed = [];
    /** @type {RosterRow[]} */
    const roster = [];
    let unchanged = 0;
    let blockingLosses = 0;
    let notedLosses = 0;
    let gains = 0;
    let blockingUsers = 0;
    for (const row of rows) {
        const diff = diffAccount(row.user);
        const wider = levelDocWider(row.user, row.levelDoc);
        const prefix = uidPrefix(row.uid);
        blockingLosses += diff.blocking.length;
        notedLosses += diff.noted.length;
        gains += diff.gains.length;
        if (diff.blocking.length) blockingUsers += 1;
        roster.push({uidPrefix: prefix, line: rosterLine(diff, prefix)});
        if (!diff.blocking.length && !diff.noted.length && !diff.gains.length && !wider.length) {
            unchanged += 1;
            continue;
        }
        changed.push({
            uidPrefix: prefix,
            shape: diff.shape,
            ranks: diff.ranks,
            blocking: diff.blocking,
            noted: diff.noted,
            gains: diff.gains,
            levelDocWider: wider,
        });
    }
    changed.sort((a, b) => a.uidPrefix.localeCompare(b.uidPrefix));
    roster.sort((a, b) => a.uidPrefix.localeCompare(b.uidPrefix));
    return {
        users: rows.length,
        blockingUsers,
        blockingLosses,
        notedLosses,
        gains,
        blocking: blockingUsers > 0,
        changed,
        unchanged,
        roster,
    };
}

/**
 * @param {ReturnType<typeof shapeOf>} shape
 * @returns {string}
 */
function formatShape(shape) {
    return [
        'permissionLevel=' + (shape.permissionLevel || '(absent)'),
        'role=' + (shape.role || '(absent)'),
        'accountLevelId=' + (shape.accountLevelId || '(absent)'),
        'pastoralAssistant=' + String(shape.pastoralAssistant),
        'map=' + String(shape.hasMap),
        'trueKeys=' + String(shape.trueKeys),
        shape.nestedMap ? 'nestedMap=yes' : '',
    ].filter(Boolean).join(' ');
}

/**
 * @param {DiffReport} result
 * @returns {string}
 */
function formatText(result) {
    const lines = [];
    lines.push('MS-776 access diff (read-only)');
    lines.push('canonical resolver: accountLevelId + permissions; role, permissionLevel, and pastoralAssistant grant nothing');
    lines.push('users: ' + result.users);
    lines.push('unchanged: ' + result.unchanged);
    lines.push('blocking users: ' + result.blockingUsers);
    lines.push('blocking losses: ' + result.blockingLosses);
    lines.push('noted client losses (rules already refuse): ' + result.notedLosses);
    lines.push('gains: ' + result.gains);
    lines.push('ship the cutover: ' + (result.blocking ? 'NO — at least one account would lose a door a resolver opens today' : 'YES — no blocking loss'));
    lines.push('');
    lines.push('Roster');
    for (const row of result.roster) lines.push(row.line);
    for (const row of result.changed) {
        lines.push('');
        lines.push('--- uid:' + row.uidPrefix + (row.blocking.length ? ' BLOCKING' : '') + ' ---');
        lines.push(formatShape(row.shape));
        const rankBits = Object.keys(row.ranks).map((name) => name + '=' + (row.ranks[name] || '(none)'));
        lines.push('ranks: ' + rankBits.join(' '));
        if (row.blocking.length) lines.push('loses: ' + row.blocking.join(', '));
        if (row.gains.length) lines.push('gains: ' + row.gains.join(', '));
        if (row.noted.length) lines.push('noted: ' + row.noted.join(', '));
        if (row.levelDocWider.length) {
            lines.push('level doc wider than canonical map: ' + row.levelDocWider.join(', '));
        }
    }
    if (!result.changed.length) {
        lines.push('');
        lines.push('No account gains or loses a door.');
    }
    lines.push('');
    return lines.join('\n');
}

module.exports = {
    KEY_PAIR,
    storedLevel,
    storagePermissionLevel,
    canonicalDoors,
    firestoreDoors,
    storageDoors,
    diffAccount,
    report,
    formatText,
};
