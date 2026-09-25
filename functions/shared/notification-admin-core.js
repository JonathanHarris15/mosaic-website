// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/notification-admin-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

/**
 * What an admin is shown about Notifications: how a push is handled, what
 * Mosaic sends, what actually went out, and which devices are still
 * listening.
 *
 * Pure — no Firestore, no DOM, and no clock of its own. Every function takes
 * the instant it should reason from.
 *
 * ⚠ THE SEND PATH'S CONSTANTS ARE PASSED IN, NEVER RESTATED. The window
 * hours, the church timezone and the dead-token codes arrive from
 * functions/notification-core.js through the overview callable, because a
 * second copy of the window hours is a diagram that starts lying the day
 * somebody moves one. test/notification-admin-core.test.js pins that the picture
 * this module draws is the picture notification-send.js actually walks.
 */
(function (global) {
    'use strict';

    /** Characters of a Device token an admin may see. Never the whole thing. */
    var MASK_KEEP = 6;

    /** A Device token not rewritten in this long is worth a second look. */
    var TOKEN_AGING_DAYS = 14;

    /** …and this long means the app has almost certainly stopped launching. */
    var TOKEN_STALE_DAYS = 45;

    /** The purpose the self-test push is logged under. Nothing else uses it. */
    var TEST_PUSH_PURPOSE = 'admin_test_push';

    var DAY_MS = 24 * 60 * 60 * 1000;

    var PLATFORM_LABELS = {
        ios: 'iPhone / iPad',
        android: 'Android',
        web: 'Web',
        unknown: 'Unknown device',
    };

    var CHANNEL_LABELS = {
        push: 'Push',
        text: 'Text',
        none: 'Nothing sent',
    };

    var STATUS_LABELS = {
        delivered: 'Accepted',
        failed: 'Not accepted',
        unreachable: 'Unreachable',
        recorded: 'Recorded',
    };

    /* ── time ───────────────────────────────────────────────────────────── */

    /**
     * A Date out of whatever a Firestore read, a callable payload or a test
     * handed over: a Timestamp, an ISO string, epoch millis, or a Date.
     * @param {*} value
     * @return {?Date}
     */
    function toDate(value) {
        if (value === null || value === undefined || value === '') return null;
        if (value instanceof Date) {
            return isNaN(value.getTime()) ? null : value;
        }
        if (typeof value.toDate === 'function') {
            try {
                return toDate(value.toDate());
            } catch (e) {
                return null;
            }
        }
        if (typeof value === 'number') {
            return isNaN(value) ? null : new Date(value);
        }
        if (typeof value === 'string') {
            var parsed = new Date(value);
            return isNaN(parsed.getTime()) ? null : parsed;
        }
        if (typeof value.seconds === 'number') {
            var nanos = typeof value.nanoseconds === 'number' ?
                value.nanoseconds : 0;
            return new Date(value.seconds * 1000 + Math.floor(nanos / 1e6));
        }
        return null;
    }

    /**
     * Whole and part days between then and now. Negative ages clamp to zero:
     * a clock skew is not a fresh device and it is not a stale one either.
     * @param {*} value
     * @param {*} now
     * @return {?number}
     */
    function ageInDays(value, now) {
        var then = toDate(value);
        var at = toDate(now) || new Date();
        if (!then) return null;
        return Math.max(0, (at.getTime() - then.getTime()) / DAY_MS);
    }

    /**
     * The clock the church keeps, for a reader who is not in it.
     * @param {*} value
     * @param {string} timezone
     * @return {string} e.g. "Fri 25 Sep, 2:14 PM"
     */
    function churchLocalLabel(value, timezone) {
        var when = toDate(value);
        if (!when) return '';
        try {
            return when.toLocaleString('en-US', {
                timeZone: timezone || undefined,
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
            });
        } catch (e) {
            return when.toISOString();
        }
    }

    /**
     * "3 days ago" / "just now". Relative time is what an admin actually
     * reads a device list with; the exact stamp is the tooltip.
     * @param {*} value
     * @param {*} now
     * @return {string}
     */
    function agoLabel(value, now) {
        var days = ageInDays(value, now);
        if (days === null) return 'never';
        if (days < 1 / 24) return 'just now';
        if (days < 1) {
            var hours = Math.max(1, Math.round(days * 24));
            return hours + (hours === 1 ? ' hour ago' : ' hours ago');
        }
        var whole = Math.round(days);
        return whole + (whole === 1 ? ' day ago' : ' days ago');
    }

    /**
     * A church-local hour as somebody would say it out loud.
     * @param {number} hour 0-23
     * @return {string}
     */
    function hourLabel(hour) {
        if (typeof hour !== 'number' || isNaN(hour)) return '?';
        var h = ((Math.floor(hour) % 24) + 24) % 24;
        var suffix = h < 12 ? 'am' : 'pm';
        var twelve = h % 12 === 0 ? 12 : h % 12;
        return twelve + suffix;
    }

    /* ── Device tokens ──────────────────────────────────────────────────── */

    /**
     * A Device token an admin may look at. At most the last few characters,
     * and never more than half of a short one — enough to tell two devices
     * apart on screen, useless to anybody who wants to message that phone.
     * @param {string} token
     * @return {string}
     */
    function maskToken(token) {
        var raw = typeof token === 'string' ? token : '';
        if (!raw) return '';
        var keep = Math.min(MASK_KEEP, Math.floor(raw.length / 2));
        if (keep < 1) return '…';
        return '…' + raw.slice(-keep);
    }

    /**
     * How a Device token is doing. The phone rewrites its token on every
     * launch that has permission, so age is a proxy for "is this app still
     * being opened" rather than for the token's own validity.
     * @param {Object} args updatedAt and now
     * @return {'fresh'|'aging'|'stale'|'unknown'}
     */
    function tokenState(args) {
        var a = args || {};
        var days = ageInDays(a.updatedAt, a.now);
        if (days === null) return 'unknown';
        if (days >= TOKEN_STALE_DAYS) return 'stale';
        if (days >= TOKEN_AGING_DAYS) return 'aging';
        return 'fresh';
    }

    /**
     * One row of the device list. The full token goes in and does not come
     * out — this is the only shape the browser is ever handed.
     * @param {Object} doc id, platform, token, updatedAt
     * @param {*} now
     * @return {Object}
     */
    function describeDevice(doc, now) {
        var d = doc || {};
        var platform = typeof d.platform === 'string' && d.platform ?
            d.platform : 'unknown';
        var state = tokenState({updatedAt: d.updatedAt, now: now});
        var seen = toDate(d.updatedAt);
        return {
            id: d.id || '',
            platform: platform,
            platformLabel: PLATFORM_LABELS[platform] || PLATFORM_LABELS.unknown,
            masked: maskToken(d.token),
            lastSeen: seen ? seen.toISOString() : null,
            lastSeenAgo: agoLabel(d.updatedAt, now),
            ageDays: ageInDays(d.updatedAt, now),
            state: state,
            stale: state === 'stale',
        };
    }

    /**
     * The one-line count above the device list.
     * @param {Array<Object>} people each with a devices array
     * @return {Object}
     */
    function summariseDevices(people) {
        var rows = Array.isArray(people) ? people : [];
        var summary = {
            people: rows.length,
            devices: 0,
            stale: 0,
            failing: 0,
            byPlatform: {},
        };
        rows.forEach(function (person) {
            if (person && person.failing) summary.failing += 1;
            (person && person.devices || []).forEach(function (device) {
                summary.devices += 1;
                if (device.stale) summary.stale += 1;
                var key = device.platform || 'unknown';
                summary.byPlatform[key] = (summary.byPlatform[key] || 0) + 1;
            });
        });
        return summary;
    }

    /* ── the log ────────────────────────────────────────────────────────── */

    /**
     * What one logged Notification says happened. `recorded` is the honest
     * answer for a row that names no outcome — the elder-digest lock, for
     * instance, which exists to stop a second digest rather than to report a
     * send.
     * @param {Object} row
     * @return {'delivered'|'failed'|'unreachable'|'recorded'}
     */
    function rowStatus(row) {
        var r = row || {};
        if (r.unreachable === true) return 'unreachable';
        if (r.accepted === true) return 'delivered';
        if (r.accepted === false) return 'failed';
        return 'recorded';
    }

    /**
     * Whether a logged Notification is one an admin should look twice at.
     * @param {Object} row
     * @return {boolean}
     */
    function isProblem(row) {
        var status = rowStatus(row);
        return status === 'failed' || status === 'unreachable';
    }

    /**
     * The row as the browser sees it: a status, a channel, a church-local
     * stamp, and whatever wording the channel carried. No phone number is
     * hidden here — an admin already reads the directory — but the full
     * Device token is never part of a log row in the first place.
     * @param {Object} row
     * @param {Object} args now, timezone, and a personId → name lookup
     * @return {Object}
     */
    function describeLogRow(row, args) {
        var r = row || {};
        var a = args || {};
        var names = a.names || {};
        var status = rowStatus(r);
        var typeId = typeIdFor(r);
        var type = typeById(typeId);
        return {
            id: r.id || '',
            status: status,
            statusLabel: STATUS_LABELS[status],
            problem: status === 'failed' || status === 'unreachable',
            channel: r.channel || 'none',
            channelLabel: CHANNEL_LABELS[r.channel] || CHANNEL_LABELS.none,
            purpose: r.purpose || '',
            wording: r.wording || '',
            typeId: typeId,
            typeName: type ? type.name : (r.purpose || 'Unrecognised'),
            personId: r.personId || null,
            // The self-test push is the one send addressed to a User rather
            // than a Person, so it is the one row that can name nobody.
            toUid: r.toUid || null,
            personName: (r.personId && names[r.personId]) || '',
            serviceDate: r.serviceDate || null,
            title: r.title || '',
            body: r.body || '',
            to: r.to || '',
            url: r.url || '',
            textId: r.textId || null,
            createdAt: toDate(r.createdAt) ?
                toDate(r.createdAt).toISOString() : null,
            when: churchLocalLabel(r.createdAt, a.timezone),
            whenAgo: agoLabel(r.createdAt, a.now),
        };
    }

    /**
     * Whether a described row survives the filter bar. An empty filter
     * matches everything; `problem` folds failed and unreachable together,
     * because "show me what went wrong" is one question.
     * @param {Object} row a describeLogRow result
     * @param {Object} filters channel, status, typeId, search
     * @return {boolean}
     */
    function matchesFilter(row, filters) {
        var r = row || {};
        var f = filters || {};
        if (f.channel && r.channel !== f.channel) return false;
        if (f.typeId && r.typeId !== f.typeId) return false;
        if (f.status) {
            if (f.status === 'problem') {
                if (!r.problem) return false;
            } else if (r.status !== f.status) {
                return false;
            }
        }
        if (f.search) {
            var needle = String(f.search).trim().toLowerCase();
            if (needle) {
                var hay = [
                    r.personName, r.title, r.body, r.to, r.purpose, r.typeName,
                ].join(' ').toLowerCase();
                if (hay.indexOf(needle) === -1) return false;
            }
        }
        return true;
    }

    /* ── paging ─────────────────────────────────────────────────────────── */

    /**
     * A page cursor the browser can hold and hand back. Seconds and nanos,
     * so two Notifications written in the same millisecond cannot push each
     * other off the end of a page.
     * @param {Object} timestamp seconds and nanoseconds
     * @return {string}
     */
    function formatCursor(timestamp) {
        var t = timestamp || {};
        if (typeof t.seconds !== 'number' || isNaN(t.seconds)) return '';
        var nanos = typeof t.nanoseconds === 'number' && !isNaN(t.nanoseconds) ?
            Math.floor(t.nanoseconds) : 0;
        return String(Math.floor(t.seconds)) + '.' + String(nanos);
    }

    /**
     * The other half. Anything that is not a cursor we wrote reads as no
     * cursor at all, which starts the list at the top rather than throwing.
     * @param {string} value
     * @return {?{seconds: number, nanoseconds: number}}
     */
    function parseCursor(value) {
        if (typeof value !== 'string' || !/^\d+\.\d+$/.test(value)) return null;
        var parts = value.split('.');
        return {
            seconds: parseInt(parts[0], 10),
            nanoseconds: parseInt(parts[1], 10),
        };
    }

    /* ── what Mosaic sends ──────────────────────────────────────────────── */

    /**
     * Every kind of Notification the church sends, programmatic or manual.
     *
     * This is the list Jonathan reads to answer "what can this site send
     * without me?". It is hand-written because the answer is not derivable —
     * a purpose string in the log does not know what fires it or who gets
     * it — but it is not free-floating either: the tests assert every
     * `purpose` written anywhere in functions/ has a row here, and that
     * every `firedBy` names something functions/index.js actually exports.
     */
    var NOTIFICATION_TYPES = [
        {
            id: 'prayer_ask_initial',
            name: 'Pastoral prayer ask',
            purpose: 'prayer_request',
            wording: 'initial',
            channels: ['push', 'text'],
            audience: 'The two pastoral-prayer subjects named on a Sunday',
            firedBy: [
                {
                    kind: 'schedule',
                    name: 'sendPrayerRequestTexts',
                    how: 'Hourly. Asks five days out, once, when the ' +
                        'Prayer Request is still empty.',
                },
                {
                    kind: 'manual',
                    name: 'sendPrayerRequestNow',
                    how: 'Service Builder → Send Prayer Request Now. An ' +
                        'elder, a super admin, or a Pastoral Assistant.',
                },
            ],
            killSwitch: 'Automatic sending (this page). The manual button ' +
                'ignores the switch.',
            window: 'church-unless-manual',
            wordingSource: 'Prayer Request Messages → Initial request, and ' +
                'its lock screen',
            live: true,
        },
        {
            id: 'prayer_ask_reminder',
            name: 'Pastoral prayer re-ask',
            purpose: 'prayer_request',
            wording: 'reminder',
            channels: ['push', 'text'],
            audience: 'A subject three days out whose request is still empty',
            firedBy: [
                {
                    kind: 'schedule',
                    name: 'sendPrayerRequestTexts',
                    how: 'Hourly. Three days out, once, and only after an ' +
                        'initial ask went unanswered.',
                },
                {
                    kind: 'manual',
                    name: 'sendPrayerRequestNow',
                    how: 'The same button, pressed again after the initial.',
                },
            ],
            killSwitch: 'Automatic sending (this page). The manual button ' +
                'ignores the switch.',
            window: 'church-unless-manual',
            wordingSource: 'Prayer Request Messages → Reminder, and its ' +
                'lock screen',
            escalates: true,
            live: true,
        },
        {
            id: 'prayer_thankyou',
            name: 'Prayer thank-you',
            purpose: 'prayer_request_thankyou',
            wording: null,
            channels: ['text'],
            audience: 'The subject who just replied with their request',
            firedBy: [
                {
                    kind: 'webhook',
                    name: 'smsInbound',
                    how: 'The moment a texted reply fills a Prayer Request.',
                },
            ],
            killSwitch: 'None. It answers a person who just wrote in.',
            window: 'none',
            wordingSource: 'Prayer Request Messages → Thank-you reply',
            live: true,
            note: 'Text only. It replies to a text, so it has never asked ' +
                'the send path for a channel.',
        },
        {
            id: 'elder_digest',
            name: 'Elder digest',
            purpose: 'elder_digest',
            wording: null,
            channels: ['text'],
            audience: 'Everyone carrying the Elder tag who has a phone',
            firedBy: [
                {
                    kind: 'trigger',
                    name: 'notifyEldersOnPrayerComplete',
                    how: 'When a texted reply completes every Prayer ' +
                        'Request for a Sunday. Once per service.',
                },
            ],
            killSwitch: 'None. Independent of Automatic sending.',
            window: 'none',
            wordingSource: 'Prayer Request Messages → Elder digest',
            live: true,
            note: 'Text only, and one row per elder plus a lock row named ' +
                'elder_digest_<date> that stops a second digest.',
        },
        {
            id: 'event_announcement',
            name: 'Event announcement tell',
            purpose: 'event_announcement',
            wording: null,
            channels: ['push', 'text'],
            audience: 'The people an Event announcement names',
            firedBy: [
                {
                    kind: 'schedule',
                    name: 'sendEventAnnouncementTells',
                    how: 'Hourly, when an announcement reaches its tell ' +
                        'date.',
                },
            ],
            killSwitch: 'Per announcement, on the Event.',
            window: 'church',
            wordingSource: 'Event announcement tells (this page)',
            live: false,
            note: 'Not wired to the send path yet (MS-623). The tick runs ' +
                'and records nothing.',
        },
        {
            id: 'sms_test',
            name: 'SMS test',
            purpose: 'test',
            wording: null,
            channels: ['text'],
            audience: 'Whatever number an admin types on this page',
            firedBy: [
                {
                    kind: 'manual',
                    name: 'smsSendTest',
                    how: 'System tools → Test & Debug. Spends one Textbelt ' +
                        'credit.',
                },
            ],
            killSwitch: 'None. A human presses it.',
            window: 'none',
            wordingSource: 'Typed at the moment of sending',
            live: true,
        },
        {
            id: 'admin_test_push',
            name: 'Test push to myself',
            purpose: TEST_PUSH_PURPOSE,
            wording: null,
            channels: ['push'],
            audience: 'Only the signed-in admin\u2019s own devices',
            firedBy: [
                {
                    kind: 'manual',
                    name: 'notificationTestPush',
                    how: 'Push notifications → Devices. The server reads ' +
                        'the caller\u2019s own uid and ignores anything the ' +
                        'browser names.',
                },
            ],
            killSwitch: 'None. It can only reach the person pressing it.',
            window: 'bypassed',
            wordingSource: 'Fixed wording, so a test cannot be mistaken for ' +
                'a real ask',
            live: true,
        },
    ];

    /**
     * @param {string} id
     * @return {?Object}
     */
    function typeById(id) {
        for (var i = 0; i < NOTIFICATION_TYPES.length; i += 1) {
            if (NOTIFICATION_TYPES[i].id === id) return NOTIFICATION_TYPES[i];
        }
        return null;
    }

    /**
     * Which registry row a logged Notification belongs to. Two rows can share
     * a purpose (the ask and the re-ask), so the wording decides between
     * them; a purpose with no wording split matches on purpose alone.
     * @param {Object} row
     * @return {?string}
     */
    function typeIdFor(row) {
        var r = row || {};
        var candidates = NOTIFICATION_TYPES.filter(function (type) {
            return type.purpose === r.purpose;
        });
        if (!candidates.length) return null;
        var exact = candidates.filter(function (type) {
            return type.wording && type.wording === r.wording;
        })[0];
        if (exact) return exact.id;
        var loose = candidates.filter(function (type) {
            return !type.wording;
        })[0];
        return loose ? loose.id : candidates[0].id;
    }

    /**
     * Last-sent and recent counts per registry row, plus anything in the log
     * the registry does not know about — which is the signal that a sender
     * shipped without this page learning its name.
     * @param {Array<Object>} rows raw log rows
     * @param {*} now
     * @return {{byType: Object, unmatched: Array<Object>}}
     */
    function summariseTypes(rows, now) {
        var at = (toDate(now) || new Date()).getTime();
        var byType = {};
        var unmatched = {};
        NOTIFICATION_TYPES.forEach(function (type) {
            byType[type.id] = {
                sent7: 0, sent30: 0, problems30: 0,
                lastSentAt: null, lastStatus: null,
            };
        });
        (Array.isArray(rows) ? rows : []).forEach(function (row) {
            var id = typeIdFor(row);
            if (!id) {
                var key = (row && row.purpose) || '(no purpose)';
                unmatched[key] = (unmatched[key] || 0) + 1;
                return;
            }
            var bucket = byType[id];
            var when = toDate(row && row.createdAt);
            var ageDays = when ? (at - when.getTime()) / DAY_MS : null;
            if (ageDays !== null && ageDays <= 30) {
                bucket.sent30 += 1;
                if (ageDays <= 7) bucket.sent7 += 1;
                if (isProblem(row)) bucket.problems30 += 1;
            }
            if (when && (!bucket.lastSentAt ||
                    when.getTime() > new Date(bucket.lastSentAt).getTime())) {
                bucket.lastSentAt = when.toISOString();
                bucket.lastStatus = rowStatus(row);
            }
        });
        return {
            byType: byType,
            unmatched: Object.keys(unmatched).map(function (purpose) {
                return {purpose: purpose, count: unmatched[purpose]};
            }),
        };
    }

    /**
     * The registry with nothing filled in — what the page falls back to when
     * the overview callable cannot be reached.
     *
     * ⚠ NOTHING IS GUESSED. The counts and the send window are read off the
     * server, so offline they come back null rather than plausible: a "7 / 30
     * days" of zero would read as "nothing has been sent", which is a
     * different and worse answer than "we could not look". The page renders
     * a dash and says why.
     *
     * @return {Array<Object>}
     */
    function offlineTypes() {
        return NOTIFICATION_TYPES.map(function (type) {
            var copy = {};
            Object.keys(type).forEach(function (key) {
                copy[key] = type[key];
            });
            copy.windowLabel = null;
            copy.stats = null;
            return copy;
        });
    }

    /**
     * The send window in words, for one registry row.
     * @param {string} token the row's window field
     * @param {Object} constants openHour, closeHour, timezone
     * @return {string}
     */
    function windowLabel(token, constants) {
        var c = constants || {};
        var hours = hourLabel(c.openHour) + '–' + hourLabel(c.closeHour) +
            ' ' + (c.timezone || '');
        if (token === 'church') return hours.trim();
        if (token === 'church-unless-manual') {
            return hours.trim() + ', unless a person sends it now';
        }
        if (token === 'bypassed') return 'Goes the moment it is asked for';
        return 'No window — it goes when the trigger fires';
    }

    /* ── how a push is handled ──────────────────────────────────────────── */

    /**
     * The picture of the send path, drawn from the send path's own numbers.
     *
     * Every step here is a branch notification-send.js actually takes:
     * shouldSendNow, chooseRoute, isDeadToken, afterPushAttempt. Nothing is
     * decorative, and nothing is hard-coded — pass the constants in.
     *
     * @param {Object} constants openHour, closeHour, timezone, deadCodes
     * @return {Object} window, deadCodes, and the ordered steps
     */
    function buildPushFlow(constants) {
        var c = constants || {};
        var deadCodes = Array.isArray(c.deadCodes) ? c.deadCodes.slice() : [];
        var hours = hourLabel(c.openHour) + '–' + hourLabel(c.closeHour);
        return {
            window: {
                openHour: c.openHour,
                closeHour: c.closeHour,
                timezone: c.timezone || '',
                label: hours + ' ' + (c.timezone || ''),
            },
            deadCodes: deadCodes,
            steps: [
                {
                    id: 'trigger',
                    kind: 'start',
                    icon: 'bolt',
                    title: 'Something asks for a Person to be told',
                    detail: 'A schedule, a Firestore trigger or a button ' +
                        'calls tellPerson with who, what, and where it ' +
                        'leads. None of them names a channel.',
                    branches: [],
                },
                {
                    id: 'window',
                    kind: 'decision',
                    icon: 'schedule',
                    title: 'Is it inside the church\u2019s hours?',
                    detail: hours + ' ' + (c.timezone || '') +
                        '. A manual send says so and skips the check.',
                    branches: [
                        {
                            label: 'Outside',
                            tone: 'stop',
                            outcome: 'Nothing is sent, and nothing is ' +
                                'logged. The next hourly tick asks again.',
                        },
                        {
                            label: 'Inside, or manual',
                            tone: 'go',
                            outcome: 'Carry on.',
                        },
                    ],
                },
                {
                    id: 'route',
                    kind: 'decision',
                    icon: 'smartphone',
                    title: 'Does their Linked User hold a Device token?',
                    detail: 'Push if a live token exists, a text if not. A ' +
                        're-ask escalates deliberately to the other route ' +
                        'from the one that already went.',
                    branches: [
                        {
                            label: 'A token',
                            tone: 'go',
                            outcome: 'Push to every live token that User ' +
                                'holds.',
                        },
                        {
                            label: 'No token, a phone',
                            tone: 'warn',
                            outcome: 'Text through Textbelt now. One row, ' +
                                'channel text.',
                        },
                        {
                            label: 'Neither',
                            tone: 'stop',
                            outcome: 'Unreachable. One row, channel none — ' +
                                'and an editor is told so on the record.',
                        },
                    ],
                },
                {
                    id: 'provider',
                    kind: 'decision',
                    icon: 'cloud_upload',
                    title: 'What did the push provider say?',
                    detail: 'Accepted means the provider took it — never ' +
                        'that a human saw it. Nothing pretends otherwise.',
                    codes: deadCodes,
                    branches: [
                        {
                            label: 'Accepted',
                            tone: 'go',
                            outcome: 'Done. The send is finished and we do ' +
                                'not ask again. One row, accepted.',
                        },
                        {
                            label: 'Dead token',
                            tone: 'warn',
                            outcome: 'Delete that token, then text if they ' +
                                'have a phone — otherwise unreachable.',
                        },
                        {
                            label: 'Any other error',
                            tone: 'stop',
                            outcome: 'Keep the token, do not text. One row, ' +
                                'not accepted. It may work later.',
                        },
                    ],
                },
                {
                    id: 'log',
                    kind: 'end',
                    icon: 'receipt_long',
                    title: 'One row in notifications',
                    detail: 'Every attempt that was not skipped for the ' +
                        'window writes exactly one row: who, which channel, ' +
                        'what for, and whether the provider took it. That ' +
                        'log is the Sent history below.',
                    branches: [],
                },
            ],
        };
    }

    var api = {
        MASK_KEEP: MASK_KEEP,
        TOKEN_AGING_DAYS: TOKEN_AGING_DAYS,
        TOKEN_STALE_DAYS: TOKEN_STALE_DAYS,
        TEST_PUSH_PURPOSE: TEST_PUSH_PURPOSE,
        PLATFORM_LABELS: PLATFORM_LABELS,
        CHANNEL_LABELS: CHANNEL_LABELS,
        STATUS_LABELS: STATUS_LABELS,
        NOTIFICATION_TYPES: NOTIFICATION_TYPES,
        toDate: toDate,
        ageInDays: ageInDays,
        agoLabel: agoLabel,
        hourLabel: hourLabel,
        churchLocalLabel: churchLocalLabel,
        maskToken: maskToken,
        tokenState: tokenState,
        describeDevice: describeDevice,
        summariseDevices: summariseDevices,
        rowStatus: rowStatus,
        isProblem: isProblem,
        describeLogRow: describeLogRow,
        matchesFilter: matchesFilter,
        formatCursor: formatCursor,
        parseCursor: parseCursor,
        typeById: typeById,
        typeIdFor: typeIdFor,
        summariseTypes: summariseTypes,
        offlineTypes: offlineTypes,
        windowLabel: windowLabel,
        buildPushFlow: buildPushFlow,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) global.NotificationAdminCore = api;
})(typeof window !== 'undefined' ? window : null);
