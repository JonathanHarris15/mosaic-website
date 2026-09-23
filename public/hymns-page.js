// The Hymns page (MS-666). One list, one hymn, one form.
//
// Browsing is for anyone who can open the app. Changing the book is for the
// roles that may write a hymn — the same gate the rules already enforce, asked
// here so a Pastoral Assistant is not offered a button the rules will refuse.
//
// Creating and editing are a form: nothing is written until Save, and Cancel
// drops the draft, including a crop that was never uploaded. Starring on the
// reading view is the page saving itself. Which version prints is HymnVersions,
// not a second copy of that rule.

(function (global) {
    'use strict';

    var HymnVersions = (typeof require !== 'undefined')
        ? require('./hymn-versions.js')
        : global.HymnVersions;
    var AccessCore = (typeof require !== 'undefined')
        ? require('./access-core.js')
        : global.AccessCore;

    function canEditHymnBook(account) {
        return AccessCore.writesAsEditor(account);
    }

    function hymnText(hymn) {
        var tags = hymn && Array.isArray(hymn.tags) ? hymn.tags : [];
        return [
            hymn && hymn.hymn_name,
            hymn && hymn.music_writer,
            hymn && hymn.lyrics_writer,
            hymn && hymn.attribution,
        ].concat(tags).filter(Boolean).join(' ').toLowerCase();
    }

    // Title, both writers, the attribution, and the tags. A tag filter is AND.
    function hymnMatches(hymn, query, selectedTags) {
        var q = String(query || '').trim().toLowerCase();
        if (q && hymnText(hymn).indexOf(q) === -1) return false;
        var need = Array.isArray(selectedTags) ? selectedTags : [];
        if (!need.length) return true;
        var has = hymn && Array.isArray(hymn.tags) ? hymn.tags : [];
        return need.every(function (tag) { return has.indexOf(tag) !== -1; });
    }

    function queryOf(pairs) {
        var params = new URLSearchParams();
        pairs.forEach(function (pair) {
            if (pair[1] != null && pair[1] !== '') params.set(pair[0], pair[1]);
        });
        var q = params.toString();
        return q ? '?' + q : '';
    }

    // Bookmarks of the old directory, the old details page, and the old editor.
    function legacyHref(pathname, search) {
        var file = String(pathname || '').split('/').pop();
        var params = new URLSearchParams(search || '');
        var pairs = [];
        if (params.get('shell')) pairs.push(['shell', params.get('shell')]);
        if (file === 'hymn-details.html') {
            var id = params.get('id') || params.get('hymn');
            if (id) pairs.push(['hymn', id]);
        } else if (file === 'manager.html') {
            if (params.get('edit')) pairs.push(['edit', params.get('edit')]);
            else if (params.get('new') || params.get('name')) {
                pairs.push(['new', '1']);
                if (params.get('name')) pairs.push(['name', params.get('name')]);
            }
        }
        return 'hymns.html' + queryOf(pairs);
    }

    // How the page opens. `shell` is chrome, not a view.
    function openState(search) {
        var params = new URLSearchParams(search || '');
        if (params.get('edit')) {
            return { view: 'form', creating: false, hymnId: params.get('edit'), name: '' };
        }
        if (params.get('new')) {
            return { view: 'form', creating: true, hymnId: null, name: params.get('name') || '' };
        }
        var id = params.get('hymn') || params.get('id');
        if (id) return { view: 'hymn', creating: false, hymnId: id, name: '' };
        return { view: 'list', creating: false, hymnId: null, name: '' };
    }

    function homeHref(shell) {
        return shell === 'mobile' ? 'mobile.html#/home' : 'index.html';
    }

    // Old phone routes, once the shell sends them here.
    function phoneShellHref(route, params) {
        params = params || {};
        if (route === 'hymnDetails') {
            var hymn = params.hymn;
            var id = (hymn && hymn.id) || params.id || '';
            return 'hymns.html?hymn=' + encodeURIComponent(id) + '&shell=mobile';
        }
        if (route === 'hymnManager') {
            if (params.edit) {
                return 'hymns.html?edit=' + encodeURIComponent(params.edit) + '&shell=mobile';
            }
            return 'hymns.html?new=1&shell=mobile';
        }
        return 'hymns.html?shell=mobile';
    }

    function blankDraft(name) {
        return {
            hymn_name: name || '',
            music_writer: '',
            lyrics_writer: '',
            attribution: '',
            tags: [],
            versions: [],
        };
    }

    function draftFromHymn(hymn, idFactory) {
        var nextId = idFactory || function (kind, n) { return kind + '-' + n; };
        var n = 0;
        var versions = ((hymn && hymn.versions) || []).map(function (version) {
            return {
                id: nextId('version', n++),
                name: version.name || '',
                default: version.default === true,
                pages: (version.pages || []).map(function (url) {
                    return { id: nextId('page', n++), url: url, file: null };
                }),
            };
        });
        return {
            hymn_name: (hymn && hymn.hymn_name) || '',
            music_writer: (hymn && hymn.music_writer) || '',
            lyrics_writer: (hymn && hymn.lyrics_writer) || '',
            attribution: (hymn && hymn.attribution) || '',
            tags: hymn && Array.isArray(hymn.tags) ? hymn.tags.slice() : [],
            versions: HymnVersions.ensureDefault(versions),
        };
    }

    // What Save writes onto the hymn. Client ids and unsaved blob previews
    // stay off the document. The first version is the default when none is starred.
    function catalogVersions(formVersions) {
        var bare = (formVersions || []).map(function (version) {
            var pages = (version.pages || []).map(function (page) {
                return typeof page === 'string' ? page : (page && page.url);
            }).filter(function (url) {
                return !!url && String(url).indexOf('blob:') !== 0;
            });
            var next = { name: version.name || '', pages: pages };
            if (version.default === true) next.default = true;
            return next;
        });
        return HymnVersions.ensureDefault(bare);
    }

    function duplicateTitle(hymns, name, creating) {
        if (!creating) return false;
        var wanted = String(name || '');
        return (hymns || []).some(function (hymn) { return hymn.hymn_name === wanted; });
    }

    function newTags(known, tags) {
        var have = known || [];
        return (tags || []).filter(function (tag) { return have.indexOf(tag) === -1; });
    }

    function addFormVersion(versions, version) {
        return HymnVersions.addVersion(versions, version || { name: '', pages: [] });
    }

    function removeFormVersion(versions, index) {
        return HymnVersions.removeVersion(versions, index);
    }

    function starVersions(versions, index) {
        return HymnVersions.star(versions, index);
    }

    function versionPrints(hymn, index) {
        var versions = hymn && hymn.versions;
        if (!versions || !versions.length || index < 0 || index >= versions.length) return false;
        return versions[index] === HymnVersions.defaultVersion(hymn);
    }

    function sheetPages(version) {
        return HymnVersions.pagesOf(version);
    }

    function sheetFileName(hymnName, versionName, pageNumber) {
        function slug(value) {
            return String(value || 'hymn').replace(/[^a-z0-9]/gi, '_').toLowerCase();
        }
        return slug(hymnName) + '_' + slug(versionName) + '_page_' + pageNumber + '.png';
    }

    // A crop or a chosen file that Save has not uploaded. Cancel drops these.
    function unsavedSheetPages(draft) {
        var found = [];
        ((draft && draft.versions) || []).forEach(function (version) {
            (version.pages || []).forEach(function (page) {
                if (!page || typeof page === 'string') return;
                if (page.file || (page.url && String(page.url).indexOf('blob:') === 0)) found.push(page);
            });
        });
        return found;
    }

    var HymnsPage = {
        canEditHymnBook: canEditHymnBook,
        hymnMatches: hymnMatches,
        legacyHref: legacyHref,
        openState: openState,
        homeHref: homeHref,
        phoneShellHref: phoneShellHref,
        blankDraft: blankDraft,
        draftFromHymn: draftFromHymn,
        catalogVersions: catalogVersions,
        duplicateTitle: duplicateTitle,
        newTags: newTags,
        addFormVersion: addFormVersion,
        removeFormVersion: removeFormVersion,
        starVersions: starVersions,
        versionPrints: versionPrints,
        sheetPages: sheetPages,
        sheetFileName: sheetFileName,
        unsavedSheetPages: unsavedSheetPages,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = HymnsPage;
    if (global) global.HymnsPage = HymnsPage;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
