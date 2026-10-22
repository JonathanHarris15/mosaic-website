// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/service-dotted-keys-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Fold legacy dotted service field names into nested objects (ADR-0034).
//
// Older saves used set({ merge }) with paths like 'liturgy.sermon', which
// Firestore stored as a top-level field NAME containing a dot. One normalizer
// for every reader and for prod migration (MS-781).
(function (global) {
    'use strict';

    /**
     * @param {Record<string, unknown>|null|undefined} raw
     * @return {Record<string, unknown>}
     */
    function normalizeServiceDoc(raw) {
        const data = {};
        for (const [key, val] of Object.entries(raw || {})) {
            if (!key.includes('.')) {
                data[key] = (val && typeof val === 'object' && !Array.isArray(val))
                    ? Object.assign({}, val)
                    : val;
            }
        }
        for (const [key, val] of Object.entries(raw || {})) {
            if (!key.includes('.')) continue;
            const parts = key.split('.');
            let obj = data;
            for (let i = 0; i < parts.length - 1; i++) {
                if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] === null) {
                    obj[parts[i]] = {};
                }
                obj = obj[parts[i]];
            }
            const leaf = parts[parts.length - 1];
            if (!(leaf in obj)) obj[leaf] = val;
        }
        return data;
    }

    /**
     * @param {Record<string, unknown>|null|undefined} raw
     * @return {string[]}
     */
    function dottedTopLevelKeys(raw) {
        return Object.keys(raw || {}).filter((key) => key.includes('.'));
    }

    /**
     * Service document for readers after MS-781: nested fields only. Top-level
     * keys that contain a dot are ignored (migrate-service-dotted-keys.js).
     *
     * @param {Record<string, unknown>|null|undefined} raw
     * @return {Record<string, unknown>}
     */
    function readServiceDoc(raw) {
        const data = {};
        for (const [key, val] of Object.entries(raw || {})) {
            if (!key.includes('.')) {
                data[key] = (val && typeof val === 'object' && !Array.isArray(val))
                    ? Object.assign({}, val)
                    : val;
            }
        }
        return data;
    }

    /**
     * @param {Record<string, unknown>|null|undefined} raw
     * @return {{ dottedKeys: string[], next: Record<string, unknown> }|null}
     */
    function planDottedKeyRewrite(raw) {
        const dottedKeys = dottedTopLevelKeys(raw);
        if (!dottedKeys.length) return null;
        return { dottedKeys, next: normalizeServiceDoc(raw) };
    }

    const ServiceDottedKeysCore = {
        normalizeServiceDoc,
        readServiceDoc,
        dottedTopLevelKeys,
        planDottedKeyRewrite,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ServiceDottedKeysCore;
    } else {
        global.ServiceDottedKeysCore = ServiceDottedKeysCore;
    }
}(typeof window !== 'undefined' ? window : globalThis));
