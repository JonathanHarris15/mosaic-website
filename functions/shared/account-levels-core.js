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

    function presetKeyFromPermissionLevel(level) {
        if (!level) return PRESET_VIEWER;
        if (BUILTIN_PRESET_KEYS.includes(level)) return level;
        return PRESET_VIEWER;
    }

    function accountLevelIdForPreset(presetKey) {
        return BUILTIN_LEVEL_IDS[presetKey] || BUILTIN_LEVEL_IDS[PRESET_VIEWER];
    }

    function presetKeyFromAccountLevelId(accountLevelId) {
        return PRESET_FROM_LEVEL_ID[accountLevelId] || null;
    }

    /**
     * Legacy users → account level id + denormalized permissions.
     * @param {object} user users/{uid} data
     * @return {{accountLevelId: string, permissions: object, permissionLevel: string, pastoralAssistant: boolean}}
     */
    function migrateLegacyUser(user) {
        const level = (user && (user.permissionLevel || user.role)) || PRESET_VIEWER;
        const grant = user && user.pastoralAssistant === true;
        const presetKey = presetKeyFromPermissionLevel(level);
        const accountLevelId = user && user.accountLevelId
            ? user.accountLevelId
            : accountLevelIdForPreset(presetKey);
        const permissions = user && user.permissions
            ? Object.assign(Catalog.emptyPermissions(), user.permissions)
            : buildPresetPermissions(presetKey);
        return {
            accountLevelId,
            permissions,
            permissionLevel: level,
            pastoralAssistant: grant,
        };
    }

    function normalizeAccount(value) {
        if (!value || typeof value !== 'object') {
            const level = typeof value === 'string' ? value : null;
            return migrateLegacyUser({ permissionLevel: level });
        }
        if (value.permissions && typeof value.permissions === 'object') {
            return {
                accountLevelId: value.accountLevelId || accountLevelIdForPreset(
                    presetKeyFromPermissionLevel(value.permissionLevel || value.role)),
                permissions: Object.assign(Catalog.emptyPermissions(), value.permissions),
                permissionLevel: value.permissionLevel || value.role || PRESET_VIEWER,
                pastoralAssistant: value.pastoralAssistant === true,
            };
        }
        return migrateLegacyUser(value);
    }

    function effectivePermissions(account) {
        const norm = normalizeAccount(account);
        if (norm.pastoralAssistant) {
            const baseLevel = norm.permissionLevel || PRESET_VIEWER;
            if (baseLevel === PRESET_ELDER || baseLevel === PRESET_SUPER_ADMIN) {
                return norm.permissions;
            }
            const grant = buildPresetPermissions(PRESET_PASTORAL_ASSISTANT);
            const merged = Object.assign({}, norm.permissions);
            Catalog.PERMISSION_KEYS.forEach(k => {
                if (grant[k]) merged[k] = true;
            });
            merged['shep.count_as_elder'] = false;
            merged['shep.elder_assignment.be_assignee'] = false;
            return merged;
        }
        if (norm.permissions['system.super_admin']) {
            return Catalog.allOn();
        }
        return norm.permissions;
    }

    function hasPermission(account, key) {
        const perms = effectivePermissions(account);
        return perms[key] === true;
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
        const presetKey = levelDoc && levelDoc.presetKey
            ? levelDoc.presetKey
            : presetKeyFromAccountLevelId(levelId);
        const permissions = permissionsForLevelDoc(levelDoc || { presetKey });
        const permissionLevel = presetKey || PRESET_VIEWER;
        return {
            accountLevelId: levelId,
            permissions,
            permissionLevel,
            role: permissionLevel,
            pastoralAssistant: false,
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
        presetKeyFromPermissionLevel,
        migrateLegacyUser,
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
