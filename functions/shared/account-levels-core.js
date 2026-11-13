// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/account-levels-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Account levels — presets over the permission catalog (MS-695, ADR-0077).

(function (global) {
    'use strict';

    const Catalog = (typeof require !== 'undefined')
        ? require('./permission-catalog.js')
        : global.PermissionCatalog;

    const PRESET_SUPER_ADMIN = 'super_admin';
    const PRESET_ELDER = 'elder';
    const PRESET_PASTORAL_ASSISTANT = 'pastoral_assistant';
    const PRESET_EDITOR = 'editor';
    const PRESET_MEMBER = 'member';
    const PRESET_VIEWER = 'viewer';
    const PRESET_ADMIN = 'admin';
    const PRESET_KIOSK = 'kiosk';

    const BUILTIN_PRESET_KEYS = Object.freeze([
        PRESET_SUPER_ADMIN,
        PRESET_ELDER,
        PRESET_PASTORAL_ASSISTANT,
        PRESET_EDITOR,
        PRESET_MEMBER,
        PRESET_VIEWER,
        PRESET_ADMIN,
        PRESET_KIOSK,
    ]);

    /** Stable Firestore ids for built-in levels. */
    const BUILTIN_LEVEL_IDS = Object.freeze({
        [PRESET_SUPER_ADMIN]: 'level_super_admin',
        [PRESET_ELDER]: 'level_elder',
        [PRESET_PASTORAL_ASSISTANT]: 'level_pastoral_assistant',
        [PRESET_EDITOR]: 'level_editor',
        [PRESET_MEMBER]: 'level_member',
        [PRESET_VIEWER]: 'level_viewer',
        [PRESET_ADMIN]: 'level_admin',
        [PRESET_KIOSK]: 'level_kiosk',
    });

    const PRESET_FROM_LEVEL_ID = Object.freeze(Object.fromEntries(
        Object.entries(BUILTIN_LEVEL_IDS).map(([preset, id]) => [id, preset]),
    ));

    const DISPLAY_NAMES = Object.freeze({
        [PRESET_SUPER_ADMIN]: 'Super admin',
        [PRESET_ELDER]: 'Elder',
        [PRESET_PASTORAL_ASSISTANT]: 'Pastoral Assistant',
        [PRESET_EDITOR]: 'Editor',
        [PRESET_MEMBER]: 'Member',
        [PRESET_VIEWER]: 'Viewer',
        [PRESET_ADMIN]: 'Admin',
        [PRESET_KIOSK]: 'Kiosk',
    });

    /** Keys that cannot be toggled on system presets (PA, kiosk, super admin). */
    const LOCKED_KEYS_BY_PRESET = Object.freeze({
        [PRESET_PASTORAL_ASSISTANT]: Object.freeze([
            'shep.count_as_elder',
            'shep.elder_assignment.be_assignee',
        ]),
        [PRESET_KIOSK]: Object.freeze(['system.kiosk']),
        [PRESET_SUPER_ADMIN]: Object.freeze(['system.super_admin']),
    });

    function enable(map, keys) {
        keys.forEach(k => { map[k] = true; });
        return map;
    }

    function visibilityRungs(map, rungs) {
        if (rungs.includes('public')) map['visibility.rung.public'] = true;
        if (rungs.includes('member')) map['visibility.rung.member'] = true;
        if (rungs.includes('participant')) map['visibility.rung.participant'] = true;
        if (rungs.includes('editor')) map['visibility.rung.editor'] = true;
        if (rungs.includes('elder')) map['visibility.rung.elder'] = true;
        return map;
    }

    function editorOperationalBundle(map) {
        enable(map, Catalog.EDITOR_SURFACE_KEYS);
        map['directory.view'] = true;
        map['directory.resolve_requests'] = true;
        map['admin.mcp.view'] = true;
        return map;
    }

    function shepElderSoftware(map, includeCountAsElder) {
        enable(map, Catalog.SHEP_READ_KEYS);
        enable(map, Catalog.SHEP_RECORD_KEYS);
        enable(map, Catalog.SHEP_DECIDE_KEYS);
        map['analytics.view'] = true;
        map['services.week_shift'] = true;
        map['calendar.events.edit'] = true;
        if (includeCountAsElder) {
            map['shep.count_as_elder'] = true;
            map['shep.elder_assignment.be_assignee'] = true;
        }
        return map;
    }

    function buildPresetPermissions(presetKey) {
        const map = Catalog.emptyPermissions();
        map['core.sign_in'] = true;

        if (presetKey === PRESET_KIOSK) {
            map['system.kiosk'] = true;
            visibilityRungs(map, ['public']);
            return map;
        }

        if (presetKey === PRESET_VIEWER) {
            visibilityRungs(map, ['public']);
            return map;
        }

        if (presetKey === PRESET_MEMBER) {
            visibilityRungs(map, ['public', 'member']);
            map['directory.view'] = true;
            return map;
        }

        if (presetKey === PRESET_EDITOR) {
            visibilityRungs(map, ['public', 'member', 'participant', 'editor']);
            editorOperationalBundle(map);
            return map;
        }

        if (presetKey === PRESET_ADMIN) {
            visibilityRungs(map, ['public', 'member', 'participant', 'editor']);
            editorOperationalBundle(map);
            enable(map, Catalog.ADMIN_KEYS);
            return map;
        }

        if (presetKey === PRESET_ELDER) {
            visibilityRungs(map, ['public', 'member', 'participant', 'editor', 'elder']);
            map['visibility.lift_hidden_tags'] = true;
            editorOperationalBundle(map);
            shepElderSoftware(map, true);
            return map;
        }

        if (presetKey === PRESET_PASTORAL_ASSISTANT) {
            visibilityRungs(map, ['public', 'member', 'participant', 'editor', 'elder']);
            map['visibility.lift_hidden_tags'] = true;
            editorOperationalBundle(map);
            shepElderSoftware(map, false);
            map['shep.count_as_elder'] = false;
            map['shep.elder_assignment.be_assignee'] = false;
            return map;
        }

        if (presetKey === PRESET_SUPER_ADMIN) {
            const all = Catalog.allOn();
            all['system.super_admin'] = true;
            return all;
        }

        return map;
    }

    const BUILTIN_LEVELS = Object.freeze(BUILTIN_PRESET_KEYS.map(presetKey => ({
        id: BUILTIN_LEVEL_IDS[presetKey],
        name: DISPLAY_NAMES[presetKey],
        presetKey,
        system: true,
        permissions: buildPresetPermissions(presetKey),
        lockedKeys: LOCKED_KEYS_BY_PRESET[presetKey] || [],
    })));

    /**
     * The permission level a map actually grants. Kiosk is tested before
     * super admin here; accessRank() checks super admin first, because
     * allOn() also sets system.kiosk.
     * @param {object} perms
     * @return {string}
     */
    function levelMatchingPermissions(perms) {
        if (!perms) return PRESET_VIEWER;
        if (perms['system.kiosk'] === true) return PRESET_KIOSK;
        if (perms['system.super_admin'] === true) return PRESET_SUPER_ADMIN;
        if (perms['shep.count_as_elder'] === true) return PRESET_ELDER;
        // Elder's software access, without being counted as an elder.
        if (perms['visibility.lift_hidden_tags'] === true) return PRESET_PASTORAL_ASSISTANT;
        if (perms['admin.dashboard.access'] === true) return PRESET_ADMIN;
        if (perms['directory.edit_identity'] === true
            || perms['services.builder.edit'] === true
            || perms['printables.edit'] === true) {
            return PRESET_EDITOR;
        }
        if (perms['directory.view'] === true) return PRESET_MEMBER;
        return PRESET_VIEWER;
    }

    /**
     * The map an account opens. A saved `permissions` field is the whole
     * answer: `system.super_admin: true` is every catalog key, and a field
     * that is present but not a map is a saved map of no keys. Otherwise a
     * builtin accountLevelId contributes that preset. Anything else opens
     * nothing. role, permissionLevel, and pastoralAssistant are not read.
     * @param {object|string|null} user
     * @return {object}
     */
    function accessMap(user) {
        // A rank label is that builtin preset. It is not a read of a stored
        // permissionLevel or role: those fields are ignored on an object.
        if (typeof user === 'string') {
            if (PRESET_FROM_LEVEL_ID[user]) return buildPresetPermissions(PRESET_FROM_LEVEL_ID[user]);
            if (BUILTIN_LEVEL_IDS[user]) return buildPresetPermissions(user);
            return Catalog.emptyPermissions();
        }
        if (!user || typeof user !== 'object') return Catalog.emptyPermissions();
        if (Object.prototype.hasOwnProperty.call(user, 'permissions')) {
            const raw = user.permissions;
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                return Catalog.emptyPermissions();
            }
            if (raw['system.super_admin'] === true) return Catalog.allOn();
            const out = Catalog.emptyPermissions();
            Catalog.PERMISSION_KEYS.forEach(k => {
                if (raw[k] === true) out[k] = true;
            });
            return out;
        }
        const preset = presetKeyFromAccountLevelId(user.accountLevelId);
        if (preset) return buildPresetPermissions(preset);
        return Catalog.emptyPermissions();
    }

    /**
     * Rank label derived from accessMap. Super admin wins over the kiosk key
     * allOn() also sets, so a super admin is not a kiosk. A string is not an
     * account and resolves to viewer.
     * @param {object|string|null} user
     * @return {string}
     */
    function accessRank(user) {
        const map = accessMap(user);
        if (map['system.super_admin'] === true) return PRESET_SUPER_ADMIN;
        return levelMatchingPermissions(map);
    }

    function canonicalPermissionLevel(user) {
        return accessRank(user);
    }

    function accountLevelIdForPreset(presetKey) {
        return BUILTIN_LEVEL_IDS[presetKey] || BUILTIN_LEVEL_IDS[PRESET_VIEWER];
    }

    function presetKeyFromAccountLevelId(accountLevelId) {
        return PRESET_FROM_LEVEL_ID[accountLevelId] || null;
    }

    function normalizeAccount(value) {
        const permissions = accessMap(value);
        const permissionLevel = accessRank(value);
        let accountLevelId = null;
        if (typeof value === 'string') {
            accountLevelId = BUILTIN_LEVEL_IDS[value]
                || (PRESET_FROM_LEVEL_ID[value] ? value : null);
        } else if (value && typeof value === 'object' && value.accountLevelId) {
            accountLevelId = value.accountLevelId;
        }
        return {
            accountLevelId,
            permissions,
            permissionLevel,
            pastoralAssistant: permissionLevel === PRESET_PASTORAL_ASSISTANT,
        };
    }

    function effectivePermissions(account) {
        return accessMap(account);
    }

    function hasPermission(account, key) {
        return accessMap(account)[key] === true;
    }

    function permissionsForLevelDoc(levelDoc) {
        if (!levelDoc) return Catalog.emptyPermissions();
        if (levelDoc.presetKey && !levelDoc.custom) {
            return buildPresetPermissions(levelDoc.presetKey);
        }
        const base = Catalog.emptyPermissions();
        if (levelDoc.permissions) {
            Catalog.PERMISSION_KEYS.forEach(k => {
                base[k] = levelDoc.permissions[k] === true;
            });
        }
        return base;
    }

    function userWriteFromLevel(levelId, levelDoc) {
        // A builtin id is that rung even when the stored level doc says
        // otherwise (presetKey left as `member`, or `custom: true` on a seed).
        const fromId = presetKeyFromAccountLevelId(levelId);
        const docPreset = levelDoc && levelDoc.presetKey;
        const custom = !!(levelDoc && levelDoc.custom) && !fromId;
        const presetKey = fromId || docPreset;
        const permissions = custom
            ? permissionsForLevelDoc(levelDoc)
            : buildPresetPermissions(presetKey || PRESET_VIEWER);
        return {
            accountLevelId: levelId,
            permissions,
        };
    }

    function seedBuiltinLevelDocs() {
        return BUILTIN_LEVELS.map(level => ({
            id: level.id,
            data: {
                name: level.name,
                presetKey: level.presetKey,
                system: true,
                custom: false,
                permissions: level.permissions,
                lockedKeys: level.lockedKeys,
            },
        }));
    }

    function clonePresetAsCustom(sourcePresetKey, newName) {
        const perms = buildPresetPermissions(sourcePresetKey);
        return {
            name: newName,
            presetKey: sourcePresetKey,
            system: false,
            custom: true,
            permissions: perms,
            lockedKeys: [],
        };
    }

    const AccountLevelsCore = {
        PRESET_SUPER_ADMIN,
        PRESET_ELDER,
        PRESET_PASTORAL_ASSISTANT,
        PRESET_EDITOR,
        PRESET_MEMBER,
        PRESET_VIEWER,
        PRESET_ADMIN,
        PRESET_KIOSK,
        BUILTIN_PRESET_KEYS,
        BUILTIN_LEVEL_IDS,
        BUILTIN_LEVELS,
        DISPLAY_NAMES,
        LOCKED_KEYS_BY_PRESET,
        buildPresetPermissions,
        accountLevelIdForPreset,
        presetKeyFromAccountLevelId,
        levelMatchingPermissions,
        accessMap,
        accessRank,
        canonicalPermissionLevel,
        normalizeAccount,
        effectivePermissions,
        hasPermission,
        permissionsForLevelDoc,
        userWriteFromLevel,
        seedBuiltinLevelDocs,
        clonePresetAsCustom,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AccountLevelsCore;
    }
    if (global) {
        global.AccountLevelsCore = AccountLevelsCore;
    }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
