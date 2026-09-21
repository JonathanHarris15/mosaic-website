// Event Announcement — what may be written on an event, and who would be told.
//
// An editor writes a title, a short piece of plain prose, and exactly one way
// of going out: printed in the Sunday service guide, or told to people who
// carry every chosen tag. This module accepts a draft or refuses it, and it
// answers who matches those tags today. Nothing is stored here, and nobody
// is told. The pages and the save path call this rather than restating the
// rules (MS-621, MS-630).
//
// Loaded as a classic <script> (window.EventAnnouncementCore) and exported
// for Node tests.

(function (global) {
    'use strict';

    const TITLE_MAX = 120;
    const PROSE_MAX = 2000;
    const INACTIVE_TAG_ID = 'Inactive';
    const WORDS = 'announcements';
    const PLANS = 'announcement_plans';

    // Church-local clock, the same window the prayer texts use: 8:00am
    // inclusive, 8:00pm exclusive. A time here is a clock face, not an
    // instant — America/Chicago is which clock, and the window is the hours.
    const OPEN_MINUTES = 8 * 60;
    const CLOSE_MINUTES = 20 * 60;

    const PRINTED = 'printed';
    const TOLD = 'told';

    function refusal(message) {
        return { ok: false, refusal: message };
    }

    function trimmed(value) {
        return String(value == null ? '' : value).trim();
    }

    // A whole number, or null. A fraction, a blank, and anything that is not
    // a number are not whole numbers. Numeric strings from a field are.
    function wholeNumber(value) {
        if (typeof value === 'boolean' || value == null) return null;
        if (typeof value === 'string' && value.trim() === '') return null;
        const n = typeof value === 'number' ? value : Number(String(value).trim());
        if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
        return n;
    }

    function minutesOf(time) {
        const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed(time));
        if (!match) return null;
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        if (hour > 23 || minute > 59) return null;
        return hour * 60 + minute;
    }

    function timeAllowed(time) {
        const minutes = minutesOf(time);
        return minutes != null && minutes >= OPEN_MINUTES && minutes < CLOSE_MINUTES;
    }

    function clockFace(time) {
        const minutes = minutesOf(time);
        const hour = Math.floor(minutes / 60);
        const minute = minutes % 60;
        return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
    }

    function isDate(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(trimmed(value));
    }

    function unique(ids) {
        const out = [];
        (ids || []).forEach(id => {
            const clean = trimmed(id);
            if (clean && out.indexOf(clean) === -1) out.push(clean);
        });
        return out;
    }

    // Tags already on the plan that this editor cannot see stay. The ones
    // they can see are whatever they left chosen. A printed announcement
    // never calls this — a print stores no tags.
    function tagsKept(draft) {
        const visible = new Set(unique(draft.visibleTagIds));
        const chosen = unique(draft.tagIds).filter(id => visible.has(id));
        const saved = unique(draft.savedTagIds);
        const keptPrivate = saved.filter(id => !visible.has(id));
        return chosen.concat(keptPrivate);
    }

    function acceptWords(draft) {
        const title = trimmed(draft.title);
        const prose = trimmed(draft.prose);
        if (!title) return refusal('An announcement needs a title.');
        if (!prose) return refusal('An announcement needs its prose.');
        if (title.length > TITLE_MAX) {
            return refusal('A title is at most 120 characters.');
        }
        if (prose.length > PROSE_MAX) {
            return refusal('Prose is at most 2,000 characters.');
        }
        return { title, prose };
    }

    function acceptPrinted(draft) {
        const weeks = wholeNumber(draft.weeks);
        if (weeks == null || weeks < 1) {
            return refusal('Printed weeks are a whole number of 1 or more.');
        }
        return { way: PRINTED, weeks };
    }

    const TIME_REFUSAL = 'A tell is from 8:00am up to but not including 8:00pm.';

    function acceptOneOffTell(draft) {
        // Days-before belongs to a repeating event. A one-off names dates.
        const slots = Array.isArray(draft.slots) ? draft.slots : [];
        if (!slots.length) {
            return refusal('A one-off tell needs at least one date.');
        }
        const seen = new Set();
        const kept = [];
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i] || {};
            const date = trimmed(slot.date);
            if (!isDate(date)) return refusal('A tell needs a real date.');
            if (seen.has(date)) return refusal('The same date cannot be told twice.');
            if (!timeAllowed(slot.time)) return refusal(TIME_REFUSAL);
            seen.add(date);
            kept.push({ date, time: clockFace(slot.time) });
        }
        return { way: TOLD, slots: kept };
    }

    function acceptRepeatingTell(draft) {
        const slots = Array.isArray(draft.slots) ? draft.slots : [];
        if (slots.length) {
            return refusal('A repeating event is not told on a calendar date.');
        }
        const daysBefore = wholeNumber(draft.daysBefore);
        if (daysBefore == null || daysBefore < 0) {
            return refusal('Days before each occurrence are a whole number, 0 or more.');
        }
        if (!timeAllowed(draft.time)) return refusal(TIME_REFUSAL);
        return { way: TOLD, daysBefore, time: clockFace(draft.time) };
    }

    function accept(draft) {
        const input = draft || {};
        const words = acceptWords(input);
        if (words.ok === false) return words;

        if (input.way !== PRINTED && input.way !== TOLD) {
            return refusal('An announcement is printed or told, not both.');
        }
        if (input.eventKind !== 'one-off' && input.eventKind !== 'repeating') {
            return refusal('An announcement belongs to a one-off or a repeating event.');
        }

        let plan;
        if (input.way === PRINTED) {
            plan = acceptPrinted(input);
        } else if (input.eventKind === 'repeating') {
            plan = acceptRepeatingTell(input);
        } else {
            plan = acceptOneOffTell(input);
        }
        if (plan.ok === false) return plan;

        const announcement = {
            title: words.title,
            prose: words.prose,
            way: plan.way,
        };
        if (plan.way === PRINTED) {
            announcement.weeks = plan.weeks;
        } else {
            const tagIds = tagsKept(input);
            if (!tagIds.length) {
                return refusal('A tell needs at least one tag. An empty filter is not everyone.');
            }
            announcement.tagIds = tagIds;
            if (plan.slots) announcement.slots = plan.slots;
            if (plan.daysBefore != null) {
                announcement.daysBefore = plan.daysBefore;
                announcement.time = plan.time;
            }
        }
        return { ok: true, announcement };
    }

    // The directory's membership test, restated so this module stays free of
    // the shepherding model. Inactive is `membership.inactive`, or the status
    // value that flag replaced. Same two questions ShepherdingCore asks.
    function isInactiveMembership(membership) {
        if (!membership) return false;
        return !!membership.inactive || membership.status === 'inactive';
    }

    function carriesEvery(person, tagIds) {
        const tags = (person && person.tags) || [];
        return tagIds.every(id => tags.indexOf(id) !== -1);
    }

    // Who matches today. The saved audience is the tag ids; this list is not
    // saved. Hidden people are omitted, and the result does not say how many.
    function whoWouldBeTold(spec) {
        const input = spec || {};
        const tagIds = unique(input.tagIds);
        if (!tagIds.length) return { names: [] };
        const inactiveChosen = tagIds.indexOf(INACTIVE_TAG_ID) !== -1;
        const names = (input.people || []).filter(person => {
            if (!carriesEvery(person, tagIds)) return false;
            if (isInactiveMembership(person && person.membership) && !inactiveChosen) return false;
            if (person && person.hidden && !input.viewerMaySeeHidden) return false;
            return true;
        }).map(person => person && person.name).filter(name => !!name);
        names.sort((a, b) => String(a).localeCompare(String(b)));
        return { names };
    }

    function tagsTheEditorMayPick(tags, options) {
        const maySee = !!(options && options.viewerMaySeeHiddenTags);
        return (tags || []).filter(tag => maySee || !(tag && tag.hiddenFromOthers));
    }

    function tagsAsShown(tagIds, visibleTags) {
        const byId = {};
        (visibleTags || []).forEach(tag => {
            if (tag && tag.id) byId[tag.id] = tag;
        });
        return unique(tagIds).map(id => {
            const tag = byId[id];
            if (!tag) return { id, name: 'Private', private: true };
            return { id, name: tag.name || 'Private', private: false };
        });
    }

    function whereAnnouncementsLive(place) {
        const kind = place && place.kind;
        if (kind === 'repeating') {
            return { on: 'series', writable: !place.onDate };
        }
        return { on: 'occurrence', writable: true };
    }

    function whatTheTabShows(spec) {
        const input = spec || {};
        const editor = !!input.isEditor;
        if (input.surface === 'date') {
            const seriesId = input.seriesId;
            return {
                editable: false,
                showsPlan: false,
                seriesHref: editor && seriesId
                    ? 'recurring-events.html?series=' + encodeURIComponent(seriesId) + '&tab=announcements'
                    : null,
            };
        }
        // Locked protects the liturgical Roles. It does not apply here, so a
        // locked series is not consulted.
        return {
            editable: editor,
            showsPlan: editor,
            seriesHref: null,
        };
    }

    function nextOrder(announcements) {
        const orders = (announcements || []).map(item => {
            const n = wholeNumber(item && item.order);
            return n == null ? 0 : n;
        });
        if (!orders.length) return 0;
        return Math.max.apply(null, orders) + 1;
    }

    function withoutAnnouncement(announcements, id) {
        return (announcements || []).filter(item => item && item.id !== id);
    }

    function recordsOf(announcement, order) {
        const item = announcement || {};
        const words = {
            title: item.title,
            prose: item.prose,
            order: order,
        };
        const plan = { way: item.way };
        if (item.way === PRINTED) {
            plan.weeks = item.weeks;
        } else {
            plan.tagIds = (item.tagIds || []).slice();
            if (item.slots) plan.slots = item.slots.map(slot => ({ date: slot.date, time: slot.time }));
            if (item.daysBefore != null) {
                plan.daysBefore = item.daysBefore;
                plan.time = item.time;
            }
        }
        return { words, plan };
    }

    // Join a stored pair back into the announcement an editor edits. With no
    // plan, only the words come back — that is what a member is allowed to see.
    function joined(id, words, plan) {
        const w = words || {};
        const announcement = {
            id: id,
            title: w.title || '',
            prose: w.prose || '',
            order: w.order,
        };
        if (!plan) return announcement;
        announcement.way = plan.way;
        if (plan.way === PRINTED) announcement.weeks = plan.weeks;
        if (plan.slots) announcement.slots = plan.slots;
        if (plan.daysBefore != null) announcement.daysBefore = plan.daysBefore;
        if (plan.time) announcement.time = plan.time;
        if (plan.tagIds) announcement.tagIds = plan.tagIds.slice();
        return announcement;
    }

    const EventAnnouncementCore = {
        TITLE_MAX,
        PROSE_MAX,
        INACTIVE_TAG_ID,
        WORDS,
        PLANS,
        PRINTED,
        TOLD,
        accept,
        tagsKept,
        whoWouldBeTold,
        tagsTheEditorMayPick,
        tagsAsShown,
        whereAnnouncementsLive,
        whatTheTabShows,
        nextOrder,
        withoutAnnouncement,
        recordsOf,
        joined,
        isInactiveMembership,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = EventAnnouncementCore;
    }
    if (global) {
        global.EventAnnouncementCore = EventAnnouncementCore;
    }
})(typeof window !== 'undefined' ? window : null);
