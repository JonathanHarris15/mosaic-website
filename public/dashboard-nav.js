// The dashboard's tile list — the one answer to "which top-level pages exist,
// who may see them, and in what order?" (MS-697).
//
// The desktop drawer mirrors this list; it does not maintain a second copy of
// the gates. The same hrefs classify drawer destinations (hamburger) versus
// everything else (back arrow).

(function (global) {
    'use strict';

    function accessCore() {
        if (typeof window === 'undefined' && typeof require === 'function') {
            return require('./access-core.js');
        }
        return global.AccessCore;
    }

    /** @typedef {{ key: string, href: string, symbol: string, label: string }} Tile */

    // ⚠ STORED KEYS — renaming scrambles every saved dashboardCardOrder.
    const BASE_TILES = Object.freeze([
        {
            key: 'hymn-directory', href: 'hymns.html', symbol: 'menu_book', label: 'Hymns',
        },
        {
            key: 'calendar', href: 'calendar.html', symbol: 'event', label: 'Calendar',
        },
        {
            key: 'service-calendar', href: 'service-calendar.html', symbol: 'church', label: 'Services',
        },
    ]);

    const GATED_TILES = Object.freeze([
        {
            key: 'directory', domId: 'directory-card', href: 'peoples-page.html', symbol: 'groups',
            label: 'Membership Directory', desc: 'Who is in the congregation, and how to reach them.',
            insertAfter: 'hymn-directory',
            visible: function (account) {
                const Access = accessCore();
                return !!(Access && Access.readsAsMember(account));
            },
        },
        {
            key: 'resources', domId: 'resources-card', href: 'resources.html', symbol: 'folder_open',
            label: 'Resources', desc: 'Studies, manuscripts, and church files',
            insertAfter: 'directory',
            visible: function (account) {
                const Access = accessCore();
                return !!(Access && Access.readsAsMember(account));
            },
        },
        {
            key: 'mcp-manager', domId: 'mcp-manager-card', href: 'mcp-manager.html', symbol: 'smart_toy',
            label: 'MCP Manager', desc: 'Guide the assistant, and see what it can do.',
            visible: function (account) {
                const Access = accessCore();
                return Access && Access.readsAsEditor(account);
            },
        },
        {
            key: 'roles-manager', domId: 'roles-manager-card', href: 'roles-manager.html', symbol: 'volunteer_activism',
            label: 'Roles Manager', desc: 'Set up serving roles and who may fill them.',
            visible: function (account) {
                const Access = accessCore();
                return Access && Access.readsAsEditor(account);
            },
        },
        {
            key: 'forms', domId: 'forms-card', href: 'forms.html', symbol: 'ballot',
            label: 'Forms & Registrations', desc: 'Build a sign-up, and read what came back.',
            visible: function (account) {
                const Access = accessCore();
                return Access && Access.readsAsEditor(account);
            },
        },
        {
            key: 'printables', domId: 'printables-card', href: 'printables.html', symbol: 'print',
            label: 'Printables', desc: 'Lay out a handout from live church data.',
            visible: function (account) {
                const Access = accessCore();
                return Access && Access.readsAsEditor(account);
            },
        },
        {
            key: 'shepherding', domId: 'shepherding-card', href: 'shepherding-dashboard.html', symbol: 'shield_person',
            label: 'Shepherd Dashboard', desc: 'Elder tools, and the care the church owes people.',
            visible: function (account) {
                const Access = accessCore();
                return Access && Access.readsAsElder(account);
            },
        },
        {
            key: 'admin-dashboard', domId: 'admin-dashboard-card', href: 'admin-dashboard.html',
            symbol: 'admin_panel_settings',
            label: 'Admin Dashboard', desc: 'SMS and the system tools behind the app.',
            visible: function (account) {
                const Access = accessCore();
                return !!(Access && Access.accessesAdminDashboard(account));
            },
        },
    ]);

    const DRAWER_HREFS = new Set(
        BASE_TILES.concat(GATED_TILES)
            .filter(function (t) { return t.drawer !== false; })
            .map(function (t) { return t.href; })
    );
    DRAWER_HREFS.add('index.html');

    const PARENT_BY_PAGE = Object.freeze({
        'away.html': { href: 'calendar.html', label: 'Calendar' },
        'auto-assign.html': { href: 'calendar.html', label: 'Calendar' },
        'calendar-event.html': { href: 'calendar.html', label: 'Calendar' },
        'commitments.html': { href: 'calendar.html', label: 'Calendar' },
        'cover.html': { href: 'calendar.html', label: 'Calendar' },
        'event-document.html': { href: 'calendar.html', label: 'Calendar' },
        'recurring-events.html': { href: 'calendar.html', label: 'Calendar' },
        'form.html': { href: 'forms.html', label: 'Forms & Registrations' },
        'login.html': { href: 'index.html', label: 'Home' },
        'privacy.html': { href: 'index.html', label: 'Home' },
        'profile.html': { href: 'index.html', label: 'Home' },
        'printable-editor.html': { href: 'printables.html', label: 'Printables' },
        'printable-view.html': { href: 'printables.html', label: 'Printables' },
        'service-builder.html': { href: 'service-calendar.html', label: 'Services' },
        'service-guide.html': { href: 'service-calendar.html', label: 'Services' },
        'service-guide-editor.html': { href: 'service-calendar.html', label: 'Services' },
        'service-guide-manager.html': { href: 'service-calendar.html', label: 'Services' },
        'shepherding-care-list.html': { href: 'shepherding-documents.html', label: 'Documents' },
        'shepherding-document.html': { href: 'shepherding-documents.html', label: 'Documents' },
        'shepherding-documents.html': { href: 'shepherding-dashboard.html', label: 'Shepherd Dashboard' },
        'shepherding-form-document.html': { href: 'shepherding-documents.html', label: 'Documents' },
        'shepherding-people.html': { href: 'shepherding-dashboard.html', label: 'Shepherd Dashboard' },
        'shepherding-profile.html': { href: 'shepherding-people.html', label: 'People' },
        'shepherding-tags.html': { href: 'shepherding-dashboard.html', label: 'Shepherd Dashboard' },
        'shepherding-tasks.html': { href: 'shepherding-dashboard.html', label: 'Shepherd Dashboard' },
    });

    function normalizePage(hrefOrPath) {
        const raw = String(hrefOrPath || '').split('?')[0].split('#')[0];
        const parts = raw.split('/').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : 'index.html';
    }

    function accountOf(user) {
        if (!user) {
            return { permissionLevel: 'viewer', pastoralAssistant: false };
        }
        const Access = accessCore();
        if (Access && Access.accountOf) {
            return Access.accountOf(user);
        }
        return { permissionLevel: 'viewer', pastoralAssistant: false };
    }

    /** Tiles this account may see, in the dashboard's default arrangement. */
    function visibleTiles(account) {
        const tiles = BASE_TILES.map(function (t) {
            return { key: t.key, href: t.href, symbol: t.symbol, label: t.label, drawer: t.drawer !== false };
        });
        GATED_TILES.forEach(function (def) {
            if (!def.visible(account)) return;
            const tile = {
                key: def.key, href: def.href, symbol: def.symbol, label: def.label,
                drawer: def.drawer !== false,
            };
            if (def.insertAfter) {
                const at = tiles.findIndex(function (t) { return t.key === def.insertAfter; });
                if (at >= 0) tiles.splice(at + 1, 0, tile);
                else tiles.push(tile);
            } else {
                tiles.push(tile);
            }
        });
        return tiles;
    }

    function applyOrder(tiles, savedOrder) {
        const order = Array.isArray(savedOrder) ? savedOrder : [];
        const byKey = new Map(tiles.map(function (t) { return [t.key, t]; }));
        // Stale keys (e.g. retired `service-analytics` on home) are ignored.
        const ordered = order.map(function (key) { return byKey.get(key); }).filter(Boolean);
        const placed = new Set(ordered.map(function (t) { return t.key; }));
        tiles.forEach(function (t) {
            if (!placed.has(t.key)) ordered.push(t);
        });
        return ordered;
    }

    function orderedTiles(account, savedOrder) {
        return applyOrder(visibleTiles(account), savedOrder);
    }

    // What the desktop drawer lists. The dashboard shows every tile; the
    // drawer shows the standing destinations, and a tile that opted out
    // (MS-693) is reached from the dashboard and left by its back arrow.
    // Keeping both off one list is what stops a page appearing in the drawer
    // while classifyPage() hands it a back arrow.
    function drawerTiles(account, savedOrder) {
        return orderedTiles(account, savedOrder)
            .filter(function (t) { return t.drawer !== false; });
    }

    function isDrawerDestination(page) {
        return DRAWER_HREFS.has(normalizePage(page));
    }

    /**
     * @returns {{ mode: 'drawer'|'back', back?: { href: string, label: string } }}
     */
    function classifyPage(page) {
        const name = normalizePage(page);
        if (name === 'index.html' || isDrawerDestination(name)) {
            return { mode: 'drawer' };
        }
        const parent = PARENT_BY_PAGE[name];
        if (parent) {
            return { mode: 'back', back: parent };
        }
        return {
            mode: 'back',
            back: { href: 'index.html', label: 'Home', fallbackHistory: true },
        };
    }

    function tileForPage(page) {
        const name = normalizePage(page);
        return BASE_TILES.concat(GATED_TILES).find(function (t) { return t.href === name; });
    }

    /** Build one dashboard <a> tile — the shape lives in the NavCard component. */
    function createNavCardElement(def) {
        const card = document.createElement('a');
        if (def.domId) card.id = def.domId;
        card.dataset.cardKey = def.key;
        card.href = def.href;
        card.className = 'm-nav-card m-nav-card--dense';
        const title = def.label;
        const desc = def.desc || '';
        card.innerHTML = `
                <span class="m-medallion" aria-hidden="true">
                    <span class="material-symbols-outlined">${def.symbol}</span>
                </span>
                <span class="m-nav-card__body">
                    <h2 class="m-nav-card__title">${title}</h2>
                    <p class="m-nav-card__desc">${desc}</p>
                </span>`;
        return card;
    }

    /** Inject gated cards the account has unlocked — same gates as visibleTiles. */
    const MOBILE_HOME = Object.freeze({
        key: 'home', label: 'Home', icon: 'house', symbol: 'home', route: 'home',
    });

    // Lucide icon + in-app route for each drawer tile. The phone drawer and the
    // shell drawer read these; the hrefs and gates live on the tiles above.
    const MOBILE_META = Object.freeze({
        'hymn-directory': { icon: 'book-open', route: 'hymnDirectory' },
        calendar: { icon: 'calendar-days', route: 'events' },
        'service-calendar': { icon: 'church', route: 'calendar' },
        directory: { icon: 'users', route: 'people' },
        resources: { icon: 'folder-open', route: 'resources' },
        shepherding: { icon: 'shield', route: 'shepherd' },
        'mcp-manager': { icon: 'bot', route: 'mcpManager' },
        'roles-manager': { icon: 'hand-heart', route: 'rolesManager' },
        forms: { icon: 'clipboard-list', route: 'forms' },
        printables: { icon: 'printer', route: 'printables' },
        'admin-dashboard': { icon: 'settings-2', route: 'admin' },
    });

    const MOBILE_SHELL_PAGES = Object.freeze({
        profile: 'profile.html',
        events: 'calendar.html',
        rolesManager: 'roles-manager.html',
        forms: 'forms.html',
        admin: 'admin-dashboard.html',
        shepherdTasks: 'shepherding-tasks.html',
        hymnDirectory: 'hymns.html',
        resources: 'resources.html',
        printables: 'printables.html',
        mcpManager: 'mcp-manager.html',
    });

    function levelsCore() {
        if (typeof window === 'undefined' && typeof require === 'function') {
            return require('./account-levels-core.js');
        }
        return global.AccountLevelsCore;
    }

    function tileByKey(key) {
        return BASE_TILES.concat(GATED_TILES).find(function (t) { return t.key === key; });
    }

    /** Normalize mobile `canSee` callers (string rank, account object, flags). */
    function normalizeDrawerUser(user) {
        if (!user) return null;
        if (typeof user === 'string') {
            const Levels = levelsCore();
            const id = Levels && Levels.BUILTIN_LEVEL_IDS[user];
            if (id) return accountOf(Levels.userWriteFromLevel(id));
            return accountOf({
                permissionLevel: user,
                pastoralAssistant: user === 'pastoral_assistant',
            });
        }
        return accountOf(user);
    }

    function canSeeDrawerKey(key, user) {
        if (key === 'home') return true;
        const def = tileByKey(key);
        if (!def) return false;
        if (!def.visible) return true;
        if (!user) return false;
        return def.visible(normalizeDrawerUser(user));
    }

    function catalogAccountSeeAll() {
        const Levels = levelsCore();
        if (Levels && Levels.BUILTIN_LEVEL_IDS.super_admin) {
            return accountOf(Levels.userWriteFromLevel(Levels.BUILTIN_LEVEL_IDS.super_admin));
        }
        return accountOf({ permissionLevel: 'super_admin' });
    }

    function mobileDrawerDestinations() {
        const tiles = drawerTiles(catalogAccountSeeAll(), null);
        return [MOBILE_HOME].concat(tiles.map(function (t) {
            const meta = MOBILE_META[t.key];
            if (!meta) {
                throw new Error('MOBILE_META missing drawer tile: ' + t.key);
            }
            return {
                key: t.key,
                label: t.label,
                icon: meta.icon,
                symbol: t.symbol,
                route: meta.route,
            };
        }));
    }

    function mobileRouteHref(route) {
        if (MOBILE_SHELL_PAGES[route]) {
            return MOBILE_SHELL_PAGES[route] + '?shell=mobile';
        }
        return 'mobile.html#/' + route;
    }

    function injectGatedCards(grid, account) {
        if (!grid || !account) return;
        GATED_TILES.forEach(function (def) {
            if (!def.visible(account)) return;
            if (def.domId && document.getElementById(def.domId)) return;
            const card = createNavCardElement(def);
            if (def.insertAfter) {
                const anchor = grid.querySelector('[data-card-key="' + def.insertAfter + '"]');
                if (anchor && anchor.nextSibling) {
                    grid.insertBefore(card, anchor.nextSibling);
                } else if (anchor) {
                    grid.appendChild(card);
                } else {
                    grid.insertBefore(card, grid.children[1] || null);
                }
            } else {
                grid.appendChild(card);
            }
        });
    }

    const DashboardNav = {
        BASE_TILES,
        GATED_TILES,
        DRAWER_HREFS,
        PARENT_BY_PAGE,
        MOBILE_HOME,
        MOBILE_META,
        MOBILE_SHELL_PAGES,
        normalizePage,
        accountOf,
        visibleTiles,
        applyOrder,
        orderedTiles,
        drawerTiles,
        isDrawerDestination,
        classifyPage,
        tileForPage,
        normalizeDrawerUser,
        canSeeDrawerKey,
        mobileDrawerDestinations,
        mobileRouteHref,
        createNavCardElement,
        injectGatedCards,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = DashboardNav;
    if (global) global.DashboardNav = DashboardNav;
}(typeof window !== 'undefined' ? window : null));
