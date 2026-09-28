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
                const level = account.permissionLevel;
                const Access = accessCore();
                return ['member', 'editor', 'elder', 'admin', 'super_admin'].includes(level)
                    || (Access && Access.readsAsElder(account));
            },
        },
        {
            key: 'service-analytics', domId: 'service-analytics-card', href: 'analytics.html', symbol: 'monitoring',
            label: 'Service Analytics', desc: 'Who has served, how often, and when they last did.',
            visible: function (account) {
                const Access = accessCore();
                return Access && Access.readsAsEditor(account);
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
                return ['admin', 'super_admin'].includes(account.permissionLevel);
            },
        },
    ]);

    const DRAWER_HREFS = new Set(
        BASE_TILES.concat(GATED_TILES).map(function (t) { return t.href; })
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
        return {
            permissionLevel: user.permissionLevel || user.role || 'viewer',
            pastoralAssistant: user.pastoralAssistant === true,
        };
    }

    /** Tiles this account may see, in the dashboard's default arrangement. */
    function visibleTiles(account) {
        const tiles = BASE_TILES.map(function (t) {
            return { key: t.key, href: t.href, symbol: t.symbol, label: t.label };
        });
        GATED_TILES.forEach(function (def) {
            if (!def.visible(account)) return;
            const tile = {
                key: def.key, href: def.href, symbol: def.symbol, label: def.label,
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
        normalizePage,
        accountOf,
        visibleTiles,
        applyOrder,
        orderedTiles,
        isDrawerDestination,
        classifyPage,
        tileForPage,
        createNavCardElement,
        injectGatedCards,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = DashboardNav;
    if (global) global.DashboardNav = DashboardNav;
}(typeof window !== 'undefined' ? window : null));
