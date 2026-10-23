// Normalise hymn sheet pages to url strings (MS-802).
(function (global) {
    'use strict';

    function pageUrlFromLegacy(page) {
        if (page == null) return '';
        if (typeof page === 'string') return page.trim();
        if (typeof page === 'object') return String(page.url || page.src || '').trim();
        return '';
    }

    /**
     * @param {any} hymn
     * @return {{changed: boolean, versions: any[]}|null}
     */
    function planHymnPageShapes(hymn) {
        const versions = hymn && hymn.versions;
        if (!Array.isArray(versions)) return null;
        let changed = false;
        const nextVersions = versions.map((version) => {
            const pages = version && version.pages;
            if (!Array.isArray(pages)) return version;
            const nextPages = pages.map((page) => {
                const url = pageUrlFromLegacy(page);
                if (!url) return '';
                if (typeof page === 'string' && page.trim() === url) return page;
                changed = true;
                return url;
            }).filter((p) => p !== '');
            if (nextPages.length !== pages.length) changed = true;
            return Object.assign({}, version, { pages: nextPages });
        });
        return { changed, versions: nextVersions };
    }

    const HymnPageShapeCore = { pageUrlFromLegacy, planHymnPageShapes };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = HymnPageShapeCore;
    }
    if (global) {
        global.HymnPageShapeCore = HymnPageShapeCore;
    }
})(typeof window !== 'undefined' ? window : null);
