// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/hymn-versions.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Which version of a hymn prints (ADR 0073, MS-664).
//
// A hymn keeps its versions in the order an editor arranged them. That order
// is how a person reads the hymn. Which one prints is a different fact: the
// version marked default, otherwise the first, otherwise nothing. Starring
// must not reorder the list, and a version added later must not take the star.
//
// Pure. No Firestore, no DOM. Every reader that used to take the first
// version asks here, so a printable and the music PDF cannot disagree.

(function (global) {
    'use strict';

    function versionsOf(hymnOrList) {
        if (Array.isArray(hymnOrList)) return hymnOrList;
        const versions = hymnOrList && hymnOrList.versions;
        return Array.isArray(versions) ? versions : [];
    }

    function isDefault(version) {
        return !!(version && version.default === true);
    }

    function copy(version) {
        return Object.assign({}, version || {});
    }

    function withExactlyOne(versions, index) {
        return versions.map(function (version, i) {
            const next = copy(version);
            if (i === index) next.default = true;
            else delete next.default;
            return next;
        });
    }

    // The version that prints. Null when the hymn has none.
    function defaultVersion(hymn) {
        const versions = versionsOf(hymn);
        if (!versions.length) return null;
        for (let i = 0; i < versions.length; i++) {
            if (isDefault(versions[i])) return versions[i];
        }
        return versions[0];
    }

    // A stored page is a url, or an older object that carried one. A blank
    // slot is not a page.
    function pageUrl(page) {
        if (page == null) return '';
        if (typeof page === 'string') return page.trim();
        if (typeof page === 'object') return String(page.url || page.src || '').trim();
        return '';
    }

    // Sheet pages of the version that prints, in that version's order.
    // Blank slots are dropped here so a guide and a printable cannot disagree
    // about whether an empty string is a page.
    function defaultPages(hymn) {
        const version = defaultVersion(hymn);
        const pages = version && version.pages;
        if (!Array.isArray(pages)) return [];
        return pages.map(pageUrl).filter(function (url) { return !!url; });
    }

    // Star one version. The list stays in the order it was given.
    function star(versions, index) {
        const list = versionsOf(versions).map(copy);
        if (index < 0 || index >= list.length) return list;
        return withExactlyOne(list, index);
    }

    // A new version joins the end. The first version of a hymn is the default.
    // A later one is not, until somebody stars it.
    function addVersion(versions, version) {
        const list = versionsOf(versions).map(copy);
        const next = copy(version);
        delete next.default;
        if (!list.length) next.default = true;
        if (!Array.isArray(next.pages)) next.pages = [];
        list.push(next);
        return list;
    }

    // Drop one version. If it was the default, the version that follows it
    // becomes the default; if it was the last, the first of what remains does.
    function removeVersion(versions, index) {
        const source = versionsOf(versions);
        const list = source.filter(function (_, i) { return i !== index; }).map(copy);
        if (!list.length) return [];
        const marked = list.findIndex(isDefault);
        if (marked >= 0) return withExactlyOne(list, marked);
        const promote = index < list.length ? index : 0;
        return withExactlyOne(list, promote);
    }

    // A hymn being saved with versions and no star gets its first version
    // marked, so the reading page and the print agree after the first save.
    // An existing star is kept. Order is not touched.
    function ensureDefault(versions) {
        const list = versionsOf(versions);
        if (!list.length) return [];
        const marked = list.findIndex(isDefault);
        return withExactlyOne(list, marked < 0 ? 0 : marked);
    }

    const HymnVersions = {
        isDefault: isDefault,
        defaultVersion: defaultVersion,
        defaultPages: defaultPages,
        star: star,
        addVersion: addVersion,
        removeVersion: removeVersion,
        ensureDefault: ensureDefault,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = HymnVersions;
    }
    if (global) {
        global.HymnVersions = HymnVersions;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
