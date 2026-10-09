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
        // A dropdown used to write the account-level id (`level_pastoral_assistant`)
        // into permissionLevel. That string is not a rung, so member-sync treated
        // it as below member and put the account back to Member.
        const fromId = presetKeyFromAccountLevelId(level);
        if (fromId) return fromId;
        return PRESET_VIEWER;
    }

    // How much software access a builtin rung carries. Admin is operational,
    // not pastoral, so it sits with editor. Pastoral Assistant sits above
    // editor and below elder: same doors as an elder, not counted as one.
    const PRESET_RANK = Object.freeze({
        [PRESET_VIEWER]: 0,
        [PRESET_KIOSK]: 0,
        [PRESET_MEMBER]: 1,
        [PRESET_EDITOR]: 2,
        [PRESET_ADMIN]: 2,
        [PRESET_PASTORAL_ASSISTANT]: 3,
        [PRESET_ELDER]: 4,
        [PRESET_SUPER_ADMIN]: 5,
    });

    function higherBuiltin(a, b) {
        const ra = PRESET_RANK[a];
        const rb = PRESET_RANK[b];
        if (ra == null) return b || PRESET_VIEWER;
        if (rb == null) return a;
        return rb > ra ? b : a;
    }

    /**
     * The permission level a map actually grants. Used so a custom level, or a
     * denormalized map left behind after permissionLevel was overwritten, is
     * not labeled Member when it opens an elder's doors.
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
     * The rung an account should be treated as. A builtin accountLevelId wins
     * over a stale permissionLevel of `member`. A permissions map that grants
     * an elder's doors wins over a permissionLevel member-sync wrote back.
     * @param {object|string|null} user
     * @return {string}
     */
    function canonicalPermissionLevel(user) {
        if (!user || typeof user !== 'object') {
            return presetKeyFromPermissionLevel(typeof user === 'string' ? user : null);
        }
        const fromId = presetKeyFromAccountLevelId(user.accountLevelId);
        const fromLevel = presetKeyFromPermissionLevel(user.permissionLevel || user.role);
        if (fromId) return higherBuiltin(fromId, fromLevel);
        if (user.permissions && typeof user.permissions === 'object') {
            return higherBuiltin(fromLevel, levelMatchingPermissions(user.permissions));
        }
        return fromLevel || PRESET_VIEWER;
    }

    // ── What the STORED users/{uid} document says (MS-725, ADR 0082) ────────
    //
    // firestore.rules can only read the document. It cannot run
    // normalizeAccount(), cannot recompute a builtin rung's preset, and cannot
    // overlay the Pastoral Assistant grant. So a UI gate that claims to mirror
    // a rule has to be able to ask the same two narrower questions these two
    // answer — and has to keep being able to ask them after auth.js has
    // replaced `permissions` with the effective map and `permissionLevel` with
    // the canonical rung.
    //
    // Whoever does that replacing carries the answers forward as
    // `savedPermissions` and `storedLevel`. A raw document has neither, and
    // falls through to its own fields, which on a raw document are the stored
    // ones. Reading these off an already-resolved object is therefore the same
    // as reading them off the document it came from.

    /**
     * The permission map an admin SAVED on the account, or null.
     *
     * Present exactly when the account has been through Admin → Accounts:
     * assignUserAccountLevel() writes userWriteFromLevel()'s map every time.
     * A legacy account that predates MS-695 has none, however editor-ish its
     * level string.
     *
     * @param {object|string|null} value users/{uid}, or an object resolved from it
     * @return {?object} the saved map, or null
     */
    function savedPermissionMap(value) {
        if (!value || typeof value !== 'object') return null;
        if ('savedPermissions' in value) {
            const saved = value.savedPermissions;
            return (saved && typeof saved === 'object') ? saved : null;
        }
        return (value.permissions && typeof value.permissions === 'object')
            ? value.permissions
            : null;
    }

    /**
     * The permissionLevel string as stored, with the legacy `role` behind it —
     * what the rules' own permissionLevel() helper reads. NOT the canonical
     * rung canonicalPermissionLevel() works out.
     * @param {object|string|null} value users/{uid}, or an object resolved from it
     * @return {?string} the stored level
     */
    function storedPermissionLevel(value) {
        if (!value || typeof value !== 'object') {
            return typeof value === 'string' ? value : null;
        }
        if ('storedLevel' in value) return value.storedLevel || null;
        return ('permissionLevel' in value)
            ? (value.permissionLevel || null)
            : (value.role || null);
    }

    /**
     * The pair to carry forward when `permissions` and `permissionLevel` are
     * about to be rewritten with resolved values.
     * @param {object|string|null} value the stored document
     * @return {{savedPermissions: ?object, storedLevel: ?string}} the markers
     */
    function storedMarkers(value) {
        return {
            savedPermissions: savedPermissionMap(value),
            storedLevel: storedPermissionLevel(value),
        };
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
        let base;
        if (!value || typeof value !== 'object') {
            const level = typeof value === 'string' ? value : null;
            base = migrateLegacyUser({ permissionLevel: level });
        } else if (value.permissions && typeof value.permissions === 'object') {
            base = {
                accountLevelId: value.accountLevelId || null,
                permissions: Object.assign(Catalog.emptyPermissions(), value.permissions),
                permissionLevel: value.permissionLevel || value.role || PRESET_VIEWER,
                pastoralAssistant: value.pastoralAssistant === true,
            };
        } else {
            base = migrateLegacyUser(value);
        }
        // Resolve from the assignment and the map, not from a permissionLevel
        // member-sync may have written back to "member".
        const permissionLevel = canonicalPermissionLevel({
            permissionLevel: base.permissionLevel,
            accountLevelId: value && value.accountLevelId,
            permissions: base.permissions,
        });
        if (!base.accountLevelId && permissionLevel) {
            base.accountLevelId = accountLevelIdForPreset(permissionLevel);
        }
        base.permissionLevel = permissionLevel;
        return base;
    }

    function effectivePermissions(account) {
        const norm = normalizeAccount(account);
        const custom = !!(norm.accountLevelId
            && !presetKeyFromAccountLevelId(norm.accountLevelId));
        let perms;
        if (!custom && BUILTIN_PRESET_KEYS.includes(norm.permissionLevel)) {
            // A builtin rung's doors come from the preset. A stale denormalized
            // map (the Member map left on someone moved to Pastoral Assistant)
            // must not take those doors away.
            perms = buildPresetPermissions(norm.permissionLevel);
        } else if (norm.permissions && norm.permissions['system.super_admin']) {
            perms = Catalog.allOn();
        } else {
            perms = norm.permissions;
        }
        if (norm.pastoralAssistant
            && norm.permissionLevel !== PRESET_ELDER
            && norm.permissionLevel !== PRESET_SUPER_ADMIN
            && norm.permissionLevel !== PRESET_PASTORAL_ASSISTANT) {
            const grant = buildPresetPermissions(PRESET_PASTORAL_ASSISTANT);
            const merged = Object.assign({}, perms);
            Catalog.PERMISSION_KEYS.forEach(k => {
                if (grant[k]) merged[k] = true;
            });
            merged['shep.count_as_elder'] = false;
            merged['shep.elder_assignment.be_assignee'] = false;
            return merged;
        }
        return perms;
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
        // A builtin id is that rung even when the stored level doc says
        // otherwise (presetKey left as `member`, or `custom: true` on a seed).
        const fromId = presetKeyFromAccountLevelId(levelId);
        const docPreset = levelDoc && levelDoc.presetKey;
        const custom = !!(levelDoc && levelDoc.custom) && !fromId;
        const presetKey = fromId || docPreset;
        const permissions = custom
            ? permissionsForLevelDoc(levelDoc)
            : buildPresetPermissions(presetKey || PRESET_VIEWER);
        const permissionLevel = fromId
            || levelMatchingPermissions(permissions)
            || presetKey
            || PRESET_VIEWER;
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
        levelMatchingPermissions,
        canonicalPermissionLevel,
        savedPermissionMap,
        storedPermissionLevel,
        storedMarkers,
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
