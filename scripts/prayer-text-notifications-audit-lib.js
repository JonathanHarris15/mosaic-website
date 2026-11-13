// @ts-nocheck
/**
 * @fileoverview Classify pastoral-prayer text rows in notifications.
 */

const PRAYER_PURPOSES = new Set([
    'prayer_request',
    'prayer_request_thankyou',
]);

/**
 * @param {object} row
 * @return {boolean}
 */
function isPrayerTextRow(row) {
    const data = row || {};
    return data.direction === 'outbound' &&
        data.channel === 'text' &&
        PRAYER_PURPOSES.has(data.purpose);
}

/**
 * @param {object} row
 * @return {boolean}
 */
function isFailedTextbeltSend(row) {
    const data = row || {};
    if (!isPrayerTextRow(data)) return false;
    if (data.accepted === true && data.textId) return false;
    return data.accepted === false ||
        !!(data.providerError && String(data.providerError).trim());
}

/**
 * @param {string} msg
 * @return {string}
 */
function bucketProviderError(msg) {
    const s = String(msg || '').trim().toLowerCase();
    if (!s) return '(no providerError recorded)';
    if (s.includes('url') || s.includes('link') || s.includes('whitelist')) {
        return 'textbelt_url_or_whitelist';
    }
    if (s.includes('webhook') || s.includes('reply')) {
        return 'textbelt_reply_webhook';
    }
    if (s.includes('quota') || s.includes('credit')) {
        return 'textbelt_quota';
    }
    if (s.includes('invalid') && s.includes('key')) {
        return 'textbelt_invalid_key';
    }
    return 'textbelt_other';
}

/**
 * @param {Array<object>} rows
 * @return {object}
 */
function summarizePrayerTextFailures(rows) {
    const prayerRows = (rows || []).filter(isPrayerTextRow);
    const failures = prayerRows.filter(isFailedTextbeltSend);
    const buckets = {};
    failures.forEach((row) => {
        const key = bucketProviderError(row.providerError);
        buckets[key] = (buckets[key] || 0) + 1;
    });
    return {
        totalPrayerTextRows: prayerRows.length,
        failedRows: failures.length,
        acceptedRows: prayerRows.length - failures.length,
        buckets,
        samples: failures.slice(0, 8).map((r) => ({
            purpose: r.purpose,
            serviceDate: r.serviceDate || null,
            accepted: r.accepted,
            providerError: r.providerError || null,
        })),
    };
}

module.exports = {
    isPrayerTextRow,
    isFailedTextbeltSend,
    bucketProviderError,
    summarizePrayerTextFailures,
};
