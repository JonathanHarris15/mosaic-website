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

const WRITER_FIELDS = ['firedBy', 'trigger', 'writer', 'codePath', 'source'];

/**
 * @param {*} value
 * @return {?Date}
 */
function coerceDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value.toDate === 'function') {
        const date = value.toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    }
    if (typeof value === 'object' && typeof value.seconds === 'number') {
        const nanos = typeof value.nanoseconds === 'number' ? value.nanoseconds : 0;
        return new Date(value.seconds * 1000 + Math.floor(nanos / 1e6));
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}

/**
 * @param {*} value Firestore Timestamp, Date, or epoch seconds
 * @return {?string} YYYY-MM-DD HH:mm:ss in America/Chicago
 */
function formatCreatedAtChicago(value) {
    const date = coerceDate(value);
    if (!date) return null;
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        timeZoneName: 'short',
    }).formatToParts(date);
    const get = (type) => {
        const part = parts.find((item) => item.type === type);
        return part ? part.value : '';
    };
    return `${get('year')}-${get('month')}-${get('day')} ` +
        `${get('hour')}:${get('minute')}:${get('second')} ${get('timeZoneName')}`;
}

/**
 * Last four digits only. Anything shorter is fully masked.
 * @param {*} phone
 * @return {string}
 */
function maskPhoneLast4(phone) {
    const digits = String(phone == null ? '' : phone).replace(/\D/g, '');
    if (digits.length < 4) return digits ? '***' : '';
    return `***${digits.slice(-4)}`;
}

/**
 * @param {*} body
 * @return {boolean}
 */
function bodyContainsUrl(body) {
    return /(?:https?:\/\/|www\.)\S+/i.test(String(body == null ? '' : body));
}

/**
 * A writer name only when the row itself stores one. The send path does not.
 * @param {object} row
 * @return {?string}
 */
function recordedWriter(row) {
    const data = row || {};
    for (let i = 0; i < WRITER_FIELDS.length; i++) {
        const value = data[WRITER_FIELDS[i]];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

/**
 * One printable prayer-text row. The message body and the full phone stay out.
 * @param {object} row
 * @param {Object<string, string>} namesById people display names
 * @return {object}
 */
function describePrayerTextRow(row, namesById) {
    const data = row || {};
    const personId = data.personId || null;
    const names = namesById || {};
    const known = personId != null &&
        Object.prototype.hasOwnProperty.call(names, personId);
    return {
        id: data.id || null,
        createdAtChicago: formatCreatedAtChicago(data.createdAt),
        purpose: data.purpose || null,
        serviceDate: data.serviceDate || null,
        personId: personId,
        name: known ? (names[personId] || '') : '',
        phoneLast4: maskPhoneLast4(data.to),
        accepted: data.accepted === true,
        textId: data.textId ? String(data.textId) : null,
        bodyHasUrl: bodyContainsUrl(data.body),
        writer: recordedWriter(data),
    };
}

/**
 * How many people and Textbelt ids the list actually contains.
 * @param {Array<object>} listed describePrayerTextRow results
 * @return {object}
 */
function prayerTextListSummary(listed) {
    const rows = listed || [];
    const personIds = new Set();
    const textCounts = new Map();
    rows.forEach((row) => {
        if (row && row.personId) personIds.add(row.personId);
        if (row && row.textId) {
            textCounts.set(row.textId, (textCounts.get(row.textId) || 0) + 1);
        }
    });
    let rowsWithSharedTextId = 0;
    textCounts.forEach((count) => {
        if (count > 1) rowsWithSharedTextId += count;
    });
    return {
        rows: rows.length,
        distinctPersonIds: personIds.size,
        distinctTextIds: textCounts.size,
        rowsWithSharedTextId: rowsWithSharedTextId,
    };
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
    formatCreatedAtChicago,
    maskPhoneLast4,
    bodyContainsUrl,
    recordedWriter,
    describePrayerTextRow,
    prayerTextListSummary,
};
