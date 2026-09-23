/**
 * Where a tapped notification goes.
 *
 * The send path puts a URL on the push. This turns that URL into a shell
 * route, or into a same-site path when the shell has no route for it (the
 * Answer link, once MS-247 mints one). It never mints a link of its own.
 */
(function (global) {
    'use strict';

    var TOKEN_ID_KEY = 'mosaicDeviceTokenId';

    // A file the shell already knows how to open. Anything else that is still
    // a site path is handed back as href so a later page can exist without
    // this list being rewritten first.
    var FILE_ROUTES = {
        '': 'home',
        'mobile.html': 'home',
        'index.html': 'home',
        'peoples-page.html': 'people',
        'profile.html': 'profile',
        'calendar.html': 'events',
        'service-builder.html': 'serviceBuilder',
        'manager.html': 'hymnManager',
        'roles-manager.html': 'rolesManager',
        'forms.html': 'forms',
        'shepherding-tasks.html': 'shepherdTasks',
    };

    function paramsFrom(search, file) {
        var params = {};
        var query;
        try {
            query = new URLSearchParams(search || '');
        } catch (e) {
            return params;
        }
        if (file === 'service-builder.html') {
            var date = query.get('date');
            if (date) params.date = date;
        }
        if (file === 'manager.html') {
            var edit = query.get('edit');
            if (edit) params.edit = edit;
        }
        return params;
    }

    function home() {
        return {route: 'home', params: {}};
    }

    /**
     * @param {string} raw the URL from the push, or empty
     * @return {{route?: string, params?: Object, href?: string}}
     */
    function routeFromNotificationUrl(raw) {
        if (typeof raw !== 'string' || !raw.trim()) return home();
        var path = raw.trim();
        var search = '';
        if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
            var parsed;
            try {
                parsed = new URL(path);
            } catch (e) {
                return home();
            }
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return home();
            }
            if (parsed.hash && parsed.hash.indexOf('#/') === 0) {
                var namedFromHash = parsed.hash.slice(2).split('?')[0].split('/')[0];
                if (namedFromHash) return {route: namedFromHash, params: {}};
            }
            path = parsed.pathname || '/';
            search = parsed.search || '';
        }
        var hashAt = path.indexOf('#');
        var hash = '';
        if (hashAt !== -1) {
            hash = path.slice(hashAt);
            path = path.slice(0, hashAt);
        }
        var q = path.indexOf('?');
        if (q !== -1) {
            search = path.slice(q);
            path = path.slice(0, q);
        }
        if (hash.indexOf('#/') === 0) {
            var named = hash.slice(2).split('?')[0].split('/')[0];
            if (named) return {route: named, params: {}};
        }
        var file = path.split('/').filter(Boolean).pop() || '';
        if (Object.prototype.hasOwnProperty.call(FILE_ROUTES, file)) {
            return {route: FILE_ROUTES[file], params: paramsFrom(search, file)};
        }
        if (path.charAt(0) === '/' && path.length > 1 && path.indexOf('//') !== 0) {
            return {href: path + search};
        }
        return home();
    }

    /**
     * One document id per install, so a refreshed token updates the same
     * document and sign-out deletes that document.
     * @param {{getItem: function, setItem: function}} storage
     * @param {function(): string} mint
     * @return {string}
     */
    function stableDeviceTokenId(storage, mint) {
        var existing = storage.getItem(TOKEN_ID_KEY);
        if (existing) return existing;
        var id = mint();
        storage.setItem(TOKEN_ID_KEY, id);
        return id;
    }

    var api = {
        TOKEN_ID_KEY: TOKEN_ID_KEY,
        routeFromNotificationUrl: routeFromNotificationUrl,
        stableDeviceTokenId: stableDeviceTokenId,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) global.MosaicNotificationOpen = api;
})(typeof window !== 'undefined' ? window : null);
