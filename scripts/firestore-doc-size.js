/**
 * Estimate a Firestore document's stored size.
 *
 * The formula is the standard-edition calculation in
 * https://firebase.google.com/docs/firestore/storage-size
 * A map value is 32 bytes plus its fields (the document formula without a
 * document name). An array is the sum of its values. Strings are UTF-8
 * bytes plus 1. The server limit is 1,048,576. Callers that write should
 * stay under that, because this estimate can be short by the map overhead
 * it does not see on a type it does not recognise.
 */

const LIMIT_BYTES = 1048576;
// 64 KiB under the server limit. A short estimate still does not get rejected.
const WRITE_CEILING_BYTES = LIMIT_BYTES - 65536;

/** @param {string} value @return {number} */
function stringSize(value) {
    return Buffer.byteLength(String(value), 'utf8') + 1;
}

/** @param {string[]} segments @return {number} */
function documentNameSize(segments) {
    let size = 16;
    (segments || []).forEach(segment => { size += stringSize(segment); });
    return size;
}

/** @param {any} value @return {boolean} */
function isTimestamp(value) {
    if (value instanceof Date) return true;
    if (!value || typeof value !== 'object') return false;
    if (typeof value.toDate === 'function' && typeof value.seconds === 'number') return true;
    return typeof value._seconds === 'number' && typeof value._nanoseconds === 'number';
}

/** @param {any} value @return {boolean} */
function isReference(value) {
    return !!(value && typeof value === 'object' && typeof value.path === 'string'
        && value.firestore && typeof value.id === 'string');
}

/** @param {any} value @return {boolean} */
function isGeoPoint(value) {
    return !!(value && typeof value === 'object'
        && typeof value.latitude === 'number' && typeof value.longitude === 'number'
        && typeof value.constructor === 'function'
        && value.constructor.name === 'GeoPoint');
}

/** @param {any} value @return {number} */
function valueSize(value) {
    if (value === null || value === undefined) return 1;
    if (typeof value === 'string') return stringSize(value);
    if (typeof value === 'boolean') return 1;
    if (typeof value === 'number') return 8;
    if (typeof value === 'bigint') return 8;
    if (isTimestamp(value)) return 8;
    if (isGeoPoint(value)) return 16;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value.length;
    if (value instanceof Uint8Array) return value.byteLength;
    if (isReference(value)) return documentNameSize(value.path.split('/').filter(Boolean));
    if (Array.isArray(value)) {
        let size = 0;
        value.forEach(item => { size += valueSize(item); });
        return size;
    }
    if (typeof value === 'object') return mapSize(value);
    return 1;
}

/** @param {any} value @return {number} */
function mapSize(value) {
    let size = 32;
    if (!value || typeof value !== 'object') return size;
    Object.keys(value).forEach(key => {
        if (value[key] === undefined) return;
        size += stringSize(key) + valueSize(value[key]);
    });
    return size;
}

/**
 * @param {string[]} pathSegments collection id, document id, ...
 * @param {any} fields
 * @return {number}
 */
function documentSize(pathSegments, fields) {
    // mapSize's 32 is the document's own 32 bytes. The name is extra.
    return documentNameSize(pathSegments) + mapSize(fields);
}

module.exports = {
    LIMIT_BYTES,
    WRITE_CEILING_BYTES,
    documentSize,
};
