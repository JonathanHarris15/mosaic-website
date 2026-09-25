// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/notification-admin-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

/**
 * Pure helpers for the Push notifications admin tab. Flow steps mirror
 * notification-core.js and notification-send.js; the trigger registry is
 * derived from the live send paths on main (MS-189).
 */
(function (global) {
    'use strict';

    /** Days without a token refresh before the admin UI marks it stale. */
    const STALE_TOKEN_DAYS = 60;

    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    /**
     * Mask a device token for display. Never returns the full string.
     * @param {string} token
     * @return {string}
     */
    function maskPushToken(token) {
        const raw = typeof token === 'string' ? token.trim() : '';
        if (!raw) return '—';
        if (raw.length <= 6) return '…' + raw;
        return '…' + raw.slice(-6);
    }

    /**
     * Whether a token's updatedAt is older than the stale threshold.
     * @param {*} updatedAt Firestore Timestamp, Date, or ms number
     * @param {number} [nowMs]
     * @param {number} [staleDays]
     * @return {boolean}
     */
    function isStaleToken(updatedAt, nowMs, staleDays) {
        const days = typeof staleDays === 'number' ? staleDays : STALE_TOKEN_DAYS;
        const now = typeof nowMs === 'number' ? nowMs : Date.now();
        const ms = timestampToMs(updatedAt);
        if (ms == null) return true;
        return (now - ms) > days * MS_PER_DAY;
    }

    /**
     * @param {*} value
     * @return {?number}
     */
    function timestampToMs(value) {
        if (value == null) return null;
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (value.toDate && typeof value.toDate === 'function') {
            return value.toDate().getTime();
        }
        if (value instanceof Date) return value.getTime();
        return null;
    }

    /**
     * Church-local display string for a timestamp (America/Chicago).
     * @param {*} value
     * @param {string} [timeZone]
     * @return {string}
     */
    function formatChurchLocal(value, timeZone) {
        const ms = timestampToMs(value);
        if (ms == null) return '';
        const tz = timeZone || 'America/Chicago';
        return new Date(ms).toLocaleString('en-US', {
            timeZone: tz,
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });
    }

    /**
     * Visual flow for "how pushes are handled". Labels are UI copy; ids tie to
     * notification-core / notification-send behaviour.
     * @param {Object} constants from notification-core (timezone, window, codes)
     * @return {Array<Object>}
     */
    function buildSendFlow(constants) {
        const c = constants || {};
        const tz = c.CHURCH_TIMEZONE || 'America/Chicago';
        const open = c.WINDOW_OPEN_HOUR != null ? c.WINDOW_OPEN_HOUR : 8;
        const close = c.WINDOW_CLOSE_HOUR != null ? c.WINDOW_CLOSE_HOUR : 20;
        const dead = c.DEAD_TOKEN_CODES ? Array.from(c.DEAD_TOKEN_CODES) : [];
        return [
            {
                id: 'trigger',
                title: 'Trigger fires',
                detail: 'Scheduler, manual send, inbound reply, or admin test.',
            },
            {
                id: 'window',
                title: 'Send window',
                detail: open + ':00–' + close + ':00 church-local (' + tz + '). ' +
                    'Manual sends skip the window.',
            },
            {
                id: 'route',
                title: 'Route chosen',
                detail: 'Push when a live device token exists; otherwise text when ' +
                    'a phone exists; otherwise none. Reminders may escalate to the ' +
                    'other channel.',
            },
            {
                id: 'push',
                title: 'Push attempt',
                detail: 'FCM accepts or rejects each token. Dead codes (' +
                    dead.slice(0, 2).join(', ') + ', …) delete the token.',
            },
            {
                id: 'afterPush',
                title: 'After push',
                detail: 'Accepted → done. All dead + phone → text now. Retryable ' +
                    'error → stop (no text). No routes left → unreachable.',
            },
            {
                id: 'log',
                title: 'Log row',
                detail: 'One outbound row in notifications (channel, purpose, ' +
                    'accepted / unreachable). SMS rows keep textId for replies.',
            },
        ];
    }

    /**
     * Registry of notification types the site can send today.
     * @return {Array<Object>}
     */
    function notificationTriggers() {
        return [
            {
                id: 'prayer_initial_auto',
                purpose: 'prayer_request',
                wording: 'initial',
                label: 'Pastoral prayer — initial ask',
                trigger: 'sendPrayerRequestTexts (hourly)',
                channels: 'push or text',
                recipients: 'Pastoral-prayer subjects for upcoming services',
                killSwitch: 'app_config/prayer_request_sms.autoSendEnabled',
                window: '8am–8pm Central; ≤5 days before service',
                wordingSource: 'Prayer Request Messages (SMS + lock screen)',
                manual: false,
            },
            {
                id: 'prayer_reminder_auto',
                purpose: 'prayer_request',
                wording: 'reminder',
                label: 'Pastoral prayer — reminder',
                trigger: 'sendPrayerRequestTexts (hourly)',
                channels: 'push or text (escalates)',
                recipients: 'Subjects with empty request, ≤3 days out',
                killSwitch: 'app_config/prayer_request_sms.autoSendEnabled',
                window: '8am–8pm Central',
                wordingSource: 'Prayer Request Messages (SMS + lock screen)',
                manual: false,
            },
            {
                id: 'prayer_manual',
                purpose: 'prayer_request',
                wording: 'initial or reminder',
                label: 'Pastoral prayer — Send now',
                trigger: 'sendPrayerRequestNow (callable)',
                channels: 'push or text',
                recipients: 'One pastoral-prayer subject',
                killSwitch: 'none (human decision)',
                window: 'Manual bypasses quiet hours',
                wordingSource: 'Prayer Request Messages (SMS + lock screen)',
                manual: true,
            },
            {
                id: 'prayer_thankyou',
                purpose: 'prayer_request_thankyou',
                wording: 'thankyou',
                label: 'Prayer reply — thank-you',
                trigger: 'smsInbound → applyPrayerRequestReply',
                channels: 'text only',
                recipients: 'Person who texted their request',
                killSwitch: 'none',
                window: 'Immediate on inbound reply',
                wordingSource: 'Prayer Request Messages (thank-you SMS)',
                manual: false,
            },
            {
                id: 'elder_digest',
                purpose: 'elder_digest',
                wording: null,
                label: 'Elder digest',
                trigger: 'notifyEldersOnPrayerComplete (Firestore write)',
                channels: 'text only',
                recipients: 'Elder-tagged people',
                killSwitch: 'none',
                window: 'When all subjects filled via text reply',
                wordingSource: 'Prayer Request Messages (elder digest SMS)',
                manual: false,
            },
            {
                id: 'event_announcement',
                purpose: 'event_announcement',
                wording: 'tell',
                label: 'Event announcement tell',
                trigger: 'sendEventAnnouncementTells (hourly)',
                channels: 'push or text (when wired)',
                recipients: 'Audience on told announcement plan',
                killSwitch: 'none',
                window: 'Plan send moments (church-local)',
                wordingSource: 'Event announcement tells (admin wording)',
                manual: false,
                note: 'Scheduler runs; notifier wiring may still be partial.',
            },
            {
                id: 'sms_test',
                purpose: 'test',
                wording: null,
                label: 'SMS test',
                trigger: 'smsSendTest (admin callable)',
                channels: 'text only',
                recipients: 'Number the admin enters',
                killSwitch: 'none',
                window: 'Immediate',
                wordingSource: 'Admin-entered message or default test copy',
                manual: true,
            },
            {
                id: 'admin_push_test',
                purpose: 'admin_push_test',
                wording: null,
                label: 'Admin push test',
                trigger: 'adminSendSelfPushTest (admin callable)',
                channels: 'push only',
                recipients: 'Signed-in admin’s own devices',
                killSwitch: 'none',
                window: 'Immediate',
                wordingSource: 'Fixed admin test copy',
                manual: true,
            },
        ];
    }

    /**
     * Aggregate last-sent and 30-day counts from notification log rows.
     * @param {Array<Object>} rows raw notification docs
     * @param {number} [nowMs]
     * @return {Object<string, {lastSentMs: ?number, count30d: number}>}
     */
    function aggregatePurposeStats(rows, nowMs) {
        const now = typeof nowMs === 'number' ? nowMs : Date.now();
        const cutoff = now - 30 * MS_PER_DAY;
        const stats = {};
        (rows || []).forEach((row) => {
            const purpose = row.purpose;
            if (!purpose) return;
            const ms = timestampToMs(row.createdAt);
            if (!stats[purpose]) {
                stats[purpose] = {lastSentMs: null, count30d: 0};
            }
            if (ms != null) {
                if (stats[purpose].lastSentMs == null || ms > stats[purpose].lastSentMs) {
                    stats[purpose].lastSentMs = ms;
                }
                if (ms >= cutoff) stats[purpose].count30d += 1;
            }
        });
        return stats;
    }

    /**
     * Whether a log row should be highlighted as a failure in the admin UI.
     * @param {Object} row
     * @return {boolean}
     */
    function isFailedNotification(row) {
        if (!row) return false;
        if (row.unreachable) return true;
        if (row.channel === 'none') return true;
        return row.accepted === false;
    }

    const NotificationAdminCore = {
        STALE_TOKEN_DAYS,
        maskPushToken,
        isStaleToken,
        formatChurchLocal,
        buildSendFlow,
        notificationTriggers,
        aggregatePurposeStats,
        isFailedNotification,
        timestampToMs,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = NotificationAdminCore;
    }
    if (global) {
        global.NotificationAdminCore = NotificationAdminCore;
    }
})(typeof window !== 'undefined' ? window : null);
