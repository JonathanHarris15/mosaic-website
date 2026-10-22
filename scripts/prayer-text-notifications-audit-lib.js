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
 * Which writer left this document, inferred from the fields each writer sets.
 * The send path stores `wording`. recordOutbound stores `kind` and does not.
 * @param {object} row
 * @return {?string}
 */
function logCopyOf(row) {
    const data = row || {};
    const hasWording = Object.prototype.hasOwnProperty.call(data, 'wording');
    const hasKind = Object.prototype.hasOwnProperty.call(data, 'kind');
    if (hasWording && hasKind) return 'send-path+recordOutbound';
    if (hasWording) return 'send-path';
    if (hasKind) return 'recordOutbound';
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
        wording: typeof data.wording === 'string' && data.wording.trim() ?
            data.wording.trim() : null,
        logCopy: logCopyOf(data),
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

/** The Oct 20 date on the 2026-10-25 card (notice day 5). */
const OCT20_SCHEDULED = '2026-10-20';

/**
 * @param {?string} createdAtChicago
 * @return {?string} YYYY-MM-DD
 */
function churchDayFromChicago(createdAtChicago) {
    const text = String(createdAtChicago || '');
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

/**
 * Calendar subtraction for YYYY-MM-DD notice dates. Not a clock conversion.
 * @param {?string} isoDate
 * @param {number} days
 * @return {?string}
 */
function dateMinusDays(isoDate, days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) return null;
    const n = Number(days);
    if (!Number.isFinite(n)) return null;
    const parts = isoDate.split('-').map((part) => Number(part));
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    date.setUTCDate(date.getUTCDate() - n);
    return date.toISOString().slice(0, 10);
}

/**
 * One Textbelt accept. Rows that share a textId are copies of that accept.
 * @param {Array<object>} listed
 * @return {Array<object>}
 */
function acceptedPrayerSends(listed) {
    const groups = new Map();
    (listed || []).forEach((row) => {
        if (!row || row.purpose !== 'prayer_request' || row.accepted !== true) return;
        if (!row.textId) return;
        if (!groups.has(row.textId)) groups.set(row.textId, []);
        groups.get(row.textId).push(row);
    });
    return [...groups.entries()].map(([textId, rows]) => {
        const createdDays = [...new Set(rows
            .map((row) => churchDayFromChicago(row.createdAtChicago))
            .filter(Boolean))].sort();
        const wording = rows.map((row) => row.wording).find((value) => value) || null;
        const name = rows.map((row) => row.name).find((value) => value) || '';
        return {
            textId: textId,
            personId: rows[0].personId || null,
            name: name,
            serviceDate: rows[0].serviceDate || null,
            createdOn: createdDays[0] || null,
            createdDays: createdDays,
            copies: rows.length,
            wording: wording,
            logCopies: rows.map((row) => row.logCopy),
        };
    });
}

/**
 * @param {Array<object>} sends
 * @return {Array<object>}
 */
function peopleTextedTwice(sends) {
    const byPerson = new Map();
    sends.forEach((send) => {
        if (!send.personId) return;
        if (!byPerson.has(send.personId)) byPerson.set(send.personId, []);
        byPerson.get(send.personId).push(send);
    });
    const hits = [];
    byPerson.forEach((list, personId) => {
        if (list.length < 2) return;
        hits.push({
            personId: personId,
            name: list[0].name || '',
            textIds: list.map((send) => send.textId),
        });
    });
    return hits;
}

/**
 * Two different text ids for one person on one church day: the hourly tick
 * sent again, or Send Now did. Copies of one text id are not a resend.
 * @param {Array<object>} sends
 * @return {Array<object>}
 */
function sameDayExtraSends(sends) {
    const hits = [];
    const byPerson = new Map();
    sends.forEach((send) => {
        if (!send.personId) return;
        const days = send.createdDays && send.createdDays.length ?
            send.createdDays : (send.createdOn ? [send.createdOn] : []);
        days.forEach((day) => {
            const key = send.personId + '|' + day;
            if (!byPerson.has(key)) byPerson.set(key, []);
            byPerson.get(key).push(send);
        });
    });
    byPerson.forEach((list, key) => {
        if (list.length < 2) return;
        hits.push({
            personId: list[0].personId,
            name: list[0].name || '',
            createdOn: key.slice(key.lastIndexOf('|') + 1),
            textIds: list.map((send) => send.textId),
        });
    });
    return hits;
}

/**
 * A textId that exists on 2026-10-20 and again on a later createdAt.
 * @param {Array<object>} listed
 * @return {Array<string>}
 */
function oct20TextIdsLoggedAgain(listed) {
    const daysByText = new Map();
    (listed || []).forEach((row) => {
        if (!row || !row.textId) return;
        const day = churchDayFromChicago(row.createdAtChicago);
        if (!day) return;
        if (!daysByText.has(row.textId)) daysByText.set(row.textId, new Set());
        daysByText.get(row.textId).add(day);
    });
    const hits = [];
    daysByText.forEach((days, textId) => {
        if (!days.has(OCT20_SCHEDULED)) return;
        const later = [...days].some((day) => day > OCT20_SCHEDULED);
        if (later) hits.push(textId);
    });
    return hits;
}

/**
 * sentDays that fall on 2026-10-20, with a notification created after that.
 * @param {Array<object>} requests
 * @param {Array<object>} sends
 * @return {Array<object>}
 */
function oct20SlotSentLater(requests, sends) {
    const notes = [];
    (requests || []).forEach((req) => {
        if (!req || req.missing) return;
        const days = Array.isArray(req.sentDays) ? req.sentDays : [];
        days.forEach((day) => {
            const scheduled = dateMinusDays(req.serviceDate, day);
            if (scheduled !== OCT20_SCHEDULED) return;
            const later = sends.filter((send) => {
                if (send.personId !== req.personId) return false;
                if (send.serviceDate !== req.serviceDate) return false;
                const days = send.createdDays && send.createdDays.length ?
                    send.createdDays : (send.createdOn ? [send.createdOn] : []);
                return days.some((day) => day > OCT20_SCHEDULED);
            });
            if (!later.length) return;
            const loggedOn = [...new Set(later.flatMap((send) => {
                const days = send.createdDays && send.createdDays.length ?
                    send.createdDays : (send.createdOn ? [send.createdOn] : []);
                return days.filter((one) => one > OCT20_SCHEDULED);
            }))].sort();
            notes.push({
                personId: req.personId,
                serviceDate: req.serviceDate,
                noticeDay: Number(day),
                scheduledOn: OCT20_SCHEDULED,
                loggedOn: loggedOn,
                initialSentDate: req.initialSentDate || null,
            });
        });
    });
    return notes;
}

/**
 * @param {Array<object>} requests
 * @return {{happened: ?boolean, detail: string}}
 */
function manualSendNowCheck(requests) {
    const docs = (requests || []).filter((req) => req && !req.missing);
    if (!docs.length) {
        return {
            happened: null,
            detail: 'Send Now is not stored on the notification. No prayer ' +
                'request doc was read, so this cannot be told from the log row.',
        };
    }
    const manual = [];
    const scheduler = [];
    docs.forEach((req) => {
        const sentDays = Array.isArray(req.sentDays) ? req.sentDays : [];
        const who = req.personId || '(unknown person)';
        const sameDayReminder = !!(req.reminderSent && req.initialSentDate &&
            req.reminderSentDate && req.initialSentDate === req.reminderSentDate);
        if (sameDayReminder) {
            manual.push(who + ': initial and reminder are both ' +
                req.initialSentDate + '. Send Now sends that reminder the ' +
                'same day. The hourly tick does not.');
            return;
        }
        if (req.initialSentDate && !sentDays.length && !req.reminderSent) {
            manual.push(who + ': initialSentDate is ' + req.initialSentDate +
                ' and sentDays is empty. The scheduler writes the notice ' +
                'day into sentDays. Send Now does not.');
            return;
        }
        if (sentDays.length && !req.reminderSent) {
            scheduler.push(who + ': sentDays ' + JSON.stringify(sentDays) +
                ' is the scheduler stamp. reminderSent is false, so Send ' +
                'Now was not pressed after that initial.');
            return;
        }
        if (req.reminderSent && req.reminderSentDate && req.initialSentDate &&
                req.reminderSentDate !== req.initialSentDate) {
            scheduler.push(who + ': reminder on ' + req.reminderSentDate +
                ' is a later church day than the initial ' +
                req.initialSentDate + ', which is the hourly reminder.');
        }
    });
    if (manual.length) {
        return {happened: true, detail: manual.join(' ')};
    }
    if (scheduler.length) {
        return {happened: false, detail: scheduler.join(' ')};
    }
    return {
        happened: false,
        detail: 'The request docs do not show a Send Now stamp.',
    };
}

/**
 * Answers the four questions about accepted prayer_request rows.
 * `requests` are people/{id}/prayer_requests/{serviceDate} reads.
 * A missing doc is `{missing: true}` and is not treated as Send Now.
 * @param {Array<object>} listed describePrayerTextRow results
 * @param {Array<object>} [requests]
 * @return {object}
 */
function explainPrayerTextRows(listed, requests) {
    const sends = acceptedPrayerSends(listed);
    const twice = peopleTextedTwice(sends);
    const resent = sameDayExtraSends(sends);
    const replayed = oct20TextIdsLoggedAgain(listed);
    const slotLater = oct20SlotSentLater(requests, sends);
    const manual = manualSendNowCheck(requests);

    let oct20Detail;
    if (replayed.length) {
        oct20Detail = 'textId ' + replayed.join(', ') +
            ' was created on 2026-10-20 and again later.';
    } else if (slotLater.length) {
        oct20Detail = slotLater.map((note) =>
            (note.personId || '(unknown person)') + ': sentDays includes ' +
            note.noticeDay + ', the notice day scheduled for 2026-10-20 on ' +
            'service ' + note.serviceDate + '. The notification was created ' +
            'on ' + note.loggedOn.join(', ') + '. That is a new send of the ' +
            'still-unsent Oct 20 slot, not a second copy of an Oct 20 log row.'
        ).join(' ');
    } else {
        const created = [...new Set(sends.map((send) => send.createdOn).filter(Boolean))];
        oct20Detail = 'No textId is on both an 2026-10-20 row and a later row. ' +
            'Accepted sends in this list were created on ' +
            (created.join(', ') || '(no accepted send)') + '.';
    }

    let twiceDetail = 'Each person has one textId. Extra rows are copies of that send.';
    if (twice.length) {
        twiceDetail = twice.map((hit) =>
            (hit.name || hit.personId) + ' has textIds ' + hit.textIds.join(', ')
        ).join(' ');
    }

    let resentDetail = 'No person has two textIds on the same church day.';
    if (resent.length) {
        resentDetail = resent.map((hit) =>
            (hit.name || hit.personId) + ' has textIds ' + hit.textIds.join(', ') +
            ' on ' + hit.createdOn
        ).join(' ');
    }

    return {
        acceptedSends: sends,
        checks: {
            samePersonTextedTwice: {happened: twice.length > 0, detail: twiceDetail},
            resendTickResent: {happened: resent.length > 0, detail: resentDetail},
            oct20SendLoggedAgain: {happened: replayed.length > 0, detail: oct20Detail},
            manualSendNow: manual,
        },
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
    explainPrayerTextRows,
    dateMinusDays,
};
