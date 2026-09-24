// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/event-tell-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Event tell — when a told announcement fires, and who should hear it (MS-623).
//
// Expands a told plan into church-local send moments, resolves audience at send
// time, and classifies reachability. Nothing reads the database and nothing
// sends. The hourly job and the editor preview call this rather than restating
// the rules.
//
// Loaded as a classic <script> (window.EventTellCore) and exported for Node tests.

(function (global) {
    'use strict';

    const Ann = (typeof require !== 'undefined')
        ? require('./event-announcement-core.js')
        : global.EventAnnouncementCore;
    const Lines = (typeof require !== 'undefined')
        ? require('./printed-announcement-lines.js')
        : global.PrintedAnnouncementLines;

    const CHURCH_TIMEZONE = 'America/Chicago';
    const TICK_MS = 60 * 60 * 1000;
    const PURPOSE = 'event_announcement';
    const WORDING = 'tell';

    function trimmed(value) {
        return String(value == null ? '' : value).trim();
    }

    function isDate(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(trimmed(value));
    }

    function parseDate(str) {
        const parts = String(str || '').split('-').map(Number);
        return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
    }

    function formatDate(date) {
        return date.getFullYear() + '-' +
            String(date.getMonth() + 1).padStart(2, '0') + '-' +
            String(date.getDate()).padStart(2, '0');
    }

    function addDays(dateStr, n) {
        const d = parseDate(dateStr);
        d.setDate(d.getDate() + n);
        return formatDate(d);
    }

    function minutesOf(time) {
        const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed(time));
        if (!match) return null;
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        if (hour > 23 || minute > 59) return null;
        return hour * 60 + minute;
    }

    function churchNowParts(now) {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: CHURCH_TIMEZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).formatToParts(now || new Date());

        const get = (type) => parts.find((p) => p.type === type).value;
        const date = `${get('year')}-${get('month')}-${get('day')}`;
        let hour = parseInt(get('hour'), 10);
        if (hour === 24) hour = 0;
        const minute = parseInt(get('minute'), 10);
        return { date, hour, minute };
    }

    function compareMomentToParts(date, time, parts) {
        if (date < parts.date) return -1;
        if (date > parts.date) return 1;
        const momentMin = minutesOf(time);
        const nowMin = parts.hour * 60 + parts.minute;
        if (momentMin < nowMin) return -1;
        if (momentMin > nowMin) return 1;
        return 0;
    }

    function momentStillAhead(date, time, parts) {
        return compareMomentToParts(date, time, parts) > 0;
    }

    function momentOnOrBefore(date, time, parts) {
        return compareMomentToParts(date, time, parts) <= 0;
    }

    function momentAfter(date, time, parts) {
        return compareMomentToParts(date, time, parts) > 0;
    }

    function phoneOn(person) {
        const contact = person && person.contact;
        const phone = contact && contact.phone;
        return !!trimmed(phone);
    }

    function hasLinkedUser(person) {
        return !!(person && trimmed(person.userId));
    }

    function isReachable(person) {
        return phoneOn(person) || hasLinkedUser(person);
    }

    function carriesEvery(person, tagIds) {
        const tags = (person && person.tags) || [];
        return tagIds.every((id) => tags.indexOf(id) !== -1);
    }

    function matchesTellTags(person, tagIds) {
        if (!carriesEvery(person, tagIds)) return false;
        const inactiveChosen = tagIds.indexOf(Ann.INACTIVE_TAG_ID) !== -1;
        if (Ann.isInactiveMembership(person && person.membership) && !inactiveChosen) {
            return false;
        }
        return true;
    }

    function audienceAtSendTime(spec) {
        const input = spec || {};
        const tagIds = (input.tagIds || []).filter((id) => !!trimmed(id));
        if (!tagIds.length) return [];
        return (input.people || []).filter((person) => matchesTellTags(person, tagIds));
    }

    function previewTellAudience(spec) {
        const tagIds = Ann.tagsKept(spec || {});
        const inactiveChosen = tagIds.indexOf(Ann.INACTIVE_TAG_ID) !== -1;
        const hiding = new Set((spec.hidePeopleTagIds || []));
        const people = (spec.people || []).filter((person) => {
            if (!matchesTellTags(person, tagIds)) return false;
            if (person && person.hidden && !spec.viewerMaySeeHidden) return false;
            if ((person.tags || []).some((id) => hiding.has(id)) && !spec.viewerMaySeeHidden) {
                return false;
            }
            return true;
        });
        const reachable = [];
        const unreachable = [];
        people.forEach((person) => {
            const name = trimmed(person && person.name) || 'Someone';
            if (isReachable(person)) reachable.push(name);
            else unreachable.push(name);
        });
        reachable.sort((a, b) => String(a).localeCompare(String(b)));
        unreachable.sort((a, b) => String(a).localeCompare(String(b)));
        return { reachable, unreachable };
    }

    function oneOffMoments(goingOut, nowParts) {
        const moments = [];
        (goingOut.dates || []).forEach((when) => {
            const date = trimmed(when.date);
            const time = trimmed(when.time);
            if (!isDate(date) || minutesOf(time) == null) return;
            if (!momentStillAhead(date, time, nowParts)) return;
            moments.push({
                date,
                time,
                occurrenceDate: null,
            });
        });
        return moments;
    }

    function repeatingMoments(spec, nowParts) {
        const input = spec || {};
        const goingOut = input.goingOut || {};
        const daysBefore = goingOut.daysBefore;
        if (daysBefore == null || daysBefore < 0) return [];
        const time = trimmed(goingOut.time);
        if (minutesOf(time) == null) return [];

        const today = nowParts.date;
        const horizon = addDays(today, 400);
        const happened = Lines.datesTheEventHappens({
            seriesId: input.seriesId,
            rule: input.rule,
            stored: input.stored || [],
        }, today, horizon);

        const moments = [];
        happened.dates.forEach((occurrenceDate) => {
            const date = addDays(occurrenceDate, -daysBefore);
            if (!momentStillAhead(date, time, nowParts)) return;
            moments.push({
                date,
                time,
                occurrenceDate,
            });
        });
        return moments;
    }

    function upcomingTellMoments(spec) {
        const input = spec || {};
        const goingOut = input.goingOut;
        if (!goingOut || goingOut.way !== Ann.TOLD) return [];
        const nowParts = churchNowParts(input.now || new Date());
        if (input.eventKind === 'repeating') {
            return repeatingMoments(input, nowParts);
        }
        return oneOffMoments(goingOut, nowParts);
    }

    function momentsDueThisTick(moments, now, tickMs) {
        const tick = tickMs == null ? TICK_MS : tickMs;
        const nowParts = churchNowParts(now);
        const floorParts = churchNowParts(new Date(now.getTime() - tick));
        return (moments || []).filter((moment) => {
            const date = trimmed(moment.date);
            const time = trimmed(moment.time);
            if (!isDate(date) || minutesOf(time) == null) return false;
            return momentOnOrBefore(date, time, nowParts) &&
                momentAfter(date, time, floorParts);
        });
    }

    function ledgerId(announcementId, momentDate, momentTime, personId) {
        const safe = (value) => String(value || '').replace(/\//g, '_');
        return [
            safe(announcementId),
            safe(momentDate),
            safe(momentTime),
            safe(personId),
        ].join('_');
    }

    function eventPageUrl(baseUrl, occurrenceId) {
        const root = trimmed(baseUrl) || 'https://mosaicmethodist.org';
        const path = 'calendar-event.html?id=' + encodeURIComponent(occurrenceId);
        if (root.endsWith('/')) return root + path;
        return root + '/' + path;
    }

    function notifyRequest(args) {
        const input = args || {};
        return {
            personId: input.personId,
            purpose: PURPOSE,
            wording: WORDING,
            url: input.url,
            expectReply: false,
            values: {
                name: trimmed(input.firstName) || 'there',
                title: trimmed(input.title),
                prose: trimmed(input.prose),
                link: trimmed(input.url),
            },
        };
    }

    const EventTellCore = {
        CHURCH_TIMEZONE,
        TICK_MS,
        PURPOSE,
        WORDING,
        churchNowParts,
        upcomingTellMoments,
        momentsDueThisTick,
        audienceAtSendTime,
        previewTellAudience,
        isReachable,
        ledgerId,
        eventPageUrl,
        notifyRequest,
        compareMomentToParts,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = EventTellCore;
    }
    if (global) {
        global.EventTellCore = EventTellCore;
    }
})(typeof window !== 'undefined' ? window : null);
