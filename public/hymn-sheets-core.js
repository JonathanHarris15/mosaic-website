// Hymn sheet bytes in Firebase Storage (MS-769).
//
// Sheets used to live at the bucket root under the hymn's display name, which
// made a catch-all Storage rule the only way to reach them. New uploads go
// under hymn-sheets/{hymn_name}/…; migrate-hymn-sheets-prefix.js moves legacy
// objects and rewrites Firestore download URLs.

(function (global) {
    'use strict';

    const PREFIX = 'hymn-sheets';

    // Top-level Storage prefixes — a legacy root object must not be mistaken for
    // a hymn folder when scanning the bucket.
    const RESERVED_ROOT_PREFIXES = Object.freeze([
        'people_photos',
        'event_attachments',
        'form_uploads',
        'form_uploads_elder',
        'printable_assets',
        'sunday_typed',
        'resources',
        'guide-assets',
        PREFIX,
    ]);

    function isReservedRootPrefix(segment) {
        return RESERVED_ROOT_PREFIXES.indexOf(String(segment || '')) !== -1;
    }

    function storageFolderFor(hymnName) {
        const name = String(hymnName || '').trim();
        if (!name) throw new Error('A hymn name is required for the storage folder.');
        return PREFIX + '/' + name;
    }

    function storagePathFor(hymnName, fileName) {
        const folder = storageFolderFor(hymnName);
        const leaf = String(fileName || '').replace(/^\/+/, '');
        if (!leaf) throw new Error('A file name is required.');
        return folder + '/' + leaf;
    }

    function isUnderHymnSheetsPrefix(storagePath) {
        const p = String(storagePath || '');
        return p === PREFIX || p.startsWith(PREFIX + '/');
    }

    /**
     * Decode the object path from a Firebase Storage download URL, or return
     * null when the string is not one.
     * @param {string} url
     * @return {?string}
     */
    function pathFromDownloadUrl(url) {
        const raw = String(url || '').trim();
        if (!raw) return null;
        const m = raw.match(/\/o\/([^?]+)/);
        if (!m) return null;
        try {
            return decodeURIComponent(m[1]);
        } catch (e) {
            return null;
        }
    }

    /**
     * Legacy root layout: {hymn_name}/{file} with no reserved prefix on the
     * first segment.
     * @param {string} storagePath
     * @return {boolean}
     */
    function isLegacyRootHymnPath(storagePath) {
        const p = String(storagePath || '');
        if (!p || p.indexOf('/') === -1) return false;
        if (isUnderHymnSheetsPrefix(p)) return false;
        const first = p.split('/')[0];
        return !isReservedRootPrefix(first);
    }

    function destinationPathForLegacy(storagePath) {
        const p = String(storagePath || '');
        if (!isLegacyRootHymnPath(p)) return null;
        return PREFIX + '/' + p;
    }

    /**
     * Build the tokenized download URL the browser stores on hymns/{id}.
     * @param {string} bucketName
     * @param {string} objectPath
     * @param {string} token
     * @return {string}
     */
    function downloadUrlFor(bucketName, objectPath, token) {
        const encoded = encodeURIComponent(objectPath).replace(/%2F/g, '%2F');
        return 'https://firebasestorage.googleapis.com/v0/b/' + bucketName +
            '/o/' + encoded + '?alt=media&token=' + token;
    }

    const api = {
        PREFIX,
        RESERVED_ROOT_PREFIXES,
        isReservedRootPrefix,
        storageFolderFor,
        storagePathFor,
        isUnderHymnSheetsPrefix,
        pathFromDownloadUrl,
        isLegacyRootHymnPath,
        destinationPathForLegacy,
        downloadUrlFor,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.HymnSheetsCore = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : window));
