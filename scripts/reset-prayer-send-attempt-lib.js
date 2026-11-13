/**
 * @fileoverview Pure helpers for reset-prayer-send-attempt.js (prod ops).
 */

/**
 * @param {string} raw comma-separated person ids
 * @return {string[]}
 */
function parsePersonIds(raw) {
    if (!raw || !String(raw).trim()) {
        throw new Error('Pass --ids with one or more comma-separated person ids.');
    }
    const ids = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length) {
        throw new Error('Pass --ids with one or more comma-separated person ids.');
    }
    const seen = new Set();
    for (const id of ids) {
        if (seen.has(id)) {
            throw new Error(`Duplicate person id in --ids: ${id}`);
        }
        seen.add(id);
    }
    return ids;
}

/**
 * @param {string} serviceDate YYYY-MM-DD
 * @return {void}
 */
function assertServiceDate(serviceDate) {
    if (!serviceDate || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
        throw new Error('Pass --service-date YYYY-MM-DD.');
    }
}

/**
 * @param {string} serviceDate
 * @param {string[]} personIds
 * @return {Array<{personId: string, path: string}>}
 */
function planClears(serviceDate, personIds) {
    return personIds.map((personId) => ({
        personId,
        path: `people/${personId}/prayer_requests/${serviceDate}`,
    }));
}

module.exports = {
    parsePersonIds,
    assertServiceDate,
    planClears,
};
