// Calendar View — the pure display layer for the Calendar and Event detail
// pages (MS-99).
//
// Formatting only. Nothing here reads Firestore, holds state, or decides
// anything about the domain — `events-occurrence-core.js` owns the model and
// `events-store.js` owns the database. This is the layer that turns those into
// the words and shapes the design asks for.
//
// It exists as its own module for one reason: every one of these is a sentence
// a person reads, and a sentence in a template is a sentence nobody tests. The
// picker's block reasons in particular are the whole point of that screen — an
// editor must be able to see who was passed over AND why — so they are pinned
// here rather than assembled inline.
//
// Loaded as a classic <script> (window.CalendarView) and exported for Node tests.

(function (global) {
    'use strict';

    const Core = (typeof require !== 'undefined')
        ? require('./events-occurrence-core.js')
        : global.EventsOccurrenceCore;
    const Roles = (typeof require !== 'undefined')
        ? require('./roles-core.js')
        : global.RolesCore;

    // ── Small shared formatting ──────────────────────────────────────────────

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    function parseDate(str) {
        const p = String(str || '').split('-').map(Number);
        return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
    }

    function formatDate(d) {
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    // 1–2 letters for an avatar. Same rule as the shepherding modules.
    function initials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    // "7:00 pm" from "19:00". Lower-case meridiem, because the design's copy is
    // unhurried rather than shouty.
    function formatTime(hhmm) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
        if (!m) return '';
        const hour = Number(m[1]);
        const meridiem = hour < 12 ? 'am' : 'pm';
        const display = hour % 12 === 0 ? 12 : hour % 12;
        return display + ':' + m[2] + ' ' + meridiem;
    }

    // "15 July" — the form the recurrence sentences read in.
    function formatDayMonth(dateStr) {
        const d = parseDate(dateStr);
        return d.getDate() + ' ' + MONTHS[d.getMonth()];
    }

    function weekdayName(dateStr) {
        return DAYS[parseDate(dateStr).getDay()];
    }

    // ── The visibility ladder, in plain words ────────────────────────────────
    //
    // Five rungs an editor has to tell apart at a glance, without reading
    // documentation. So each carries a name, a Material Symbol, and a sentence
    // saying who actually sees it — not a label alone.

    const VISIBILITY = Object.freeze({
        public: {
            label: 'Anyone', icon: 'public',
            who: 'Anyone at all, signed in or not. Use this for things you would put on a poster.',
        },
        member: {
            label: 'Members', icon: 'groups',
            who: 'Everyone who has an account here. Not the open internet.',
        },
        participant: {
            label: 'Only those serving', icon: 'assignment_ind',
            who: 'Only the people given a Role at this event — plus editors and elders.',
        },
        editor: {
            label: 'Editors', icon: 'edit_note',
            who: 'Editors, admins and elders. Members will not see it at all.',
        },
        elder: {
            label: 'Elders', icon: 'shield',
            who: 'Elders and super admins only.',
        },
    });

    const rung = level => VISIBILITY[level] || null;

    function visibilityLabel(level) {
        const r = rung(level);
        return r ? r.label : 'Not set';
    }

    function visibilityIcon(level) {
        const r = rung(level);
        // An unset rung is readable by nobody, so it reads as locked rather than
        // as anything reassuring.
        return r ? r.icon : 'lock';
    }

    function visibilityWho(level) {
        const r = rung(level);
        return r ? r.who : 'Nobody can see this until you choose who it is for.';
    }

    // The ladder in order, ready to render as rows.
    function visibilityLadder() {
        return Core.VISIBILITY_ORDER.map(level => ({
            level: level,
            label: visibilityLabel(level),
            icon: visibilityIcon(level),
            who: visibilityWho(level),
        }));
    }

    // Whether the roster toggle means anything at this rung. At Anyone and
    // Members everybody can see the Event anyway, so hiding the roster from
    // "participants" hides it from nobody — the design drops the control to 45%
    // and explains rather than silently doing nothing.
    function rosterToggleApplies(level) {
        return level === 'participant' || level === 'editor' || level === 'elder';
    }

    // ── The colour an Event shows up as ──────────────────────────────────────
    //
    // A closed palette, not a colour picker. Two reasons, and the second is the
    // real one:
    //
    //   1. A free colour lets somebody pick something that cannot be read.
    //   2. Red is SPOKEN FOR. A chip in the error red means "somebody declined
    //      and this needs sorting" — it is the end of an escalation that runs
    //      through four surfaces. If an editor can paint an ordinary event that
    //      red, the loudest signal on the calendar stops meaning anything.
    //
    // So there is no red here, and needs-attention keeps overriding whatever was
    // chosen (see `chipBar` on the Calendar page). Colour decorates; it never
    // carries a meaning the app depends on.
    //
    // `tint` is the soft background the swatch uses when it is the chosen one —
    // never the chip background, which stays a surface so the label stays legible.

    const EVENT_COLOURS = [
        { slug: 'steel',  name: 'Steel',  bar: '#5D94A9', tint: '#D7E7EC' },
        { slug: 'ocean',  name: 'Ocean',  bar: '#3E6181', tint: '#CFE0F1' },
        { slug: 'navy',   name: 'Navy',   bar: '#182F57', tint: '#D5DCE9' },
        { slug: 'green',  name: 'Green',  bar: '#4B8A6B', tint: '#D6E7DE' },
        { slug: 'gold',   name: 'Gold',   bar: '#B89B6A', tint: '#EFE6D5' },
        { slug: 'amber',  name: 'Amber',  bar: '#B8862E', tint: '#F0E2C6' },
        { slug: 'plum',   name: 'Plum',   bar: '#7A5578', tint: '#E7DAE6' },
        { slug: 'rose',   name: 'Rose',   bar: '#B0697C', tint: '#F0DBE0' },
    ];

    // Steel, because that is what every event on this calendar already looks
    // like. Nothing has a colour stored on it yet, so the fallback IS the
    // current appearance — change it and the whole church's calendar restyles
    // itself overnight for no reason anybody asked for.
    const DEFAULT_COLOUR = 'steel';

    // Sundays already draw in ocean. Same argument — leaving it alone is the
    // only way nobody's calendar changes under them. It is still only a default:
    // the Sunday Service's colour can be changed like any other, because a
    // colour is decoration and there is no safety reason to settle it the way
    // its visibility and its liturgy are settled.
    const SUNDAY_COLOUR = 'ocean';

    // The error red, restated so a chip can use it without importing Tailwind. A
    // test holds it to the theme token — if they drift, "needs sorting" stops
    // matching the red used everywhere else it appears.
    const ATTENTION_COLOUR = '#A8463E';

    function colourFor(slug) {
        return EVENT_COLOURS.find(c => c.slug === slug)
            || EVENT_COLOURS.find(c => c.slug === DEFAULT_COLOUR);
    }

    // A recurring Event keeps its colour on the SERIES, so every date matches and
    // changing it changes them all at once. A one-off Event has no series — its
    // occurrence is the whole Event — so it carries its own.
    function colourOf(occurrence) {
        const o = occurrence || {};
        const chosen = o.colour || o.seriesColour;
        if (chosen) return colourFor(chosen);
        const sunday = o.seriesId === Core.SUNDAY_SERVICE_ID;
        return colourFor(sunday ? SUNDAY_COLOUR : DEFAULT_COLOUR);
    }

    // ── The recurrence sentence ──────────────────────────────────────────────
    //
    // The "Reads as" line: the whole pattern as one sentence, so an editor
    // checks their intent in English rather than by reading a form back to
    // themselves.

    function recurrenceSentence(rule) {
        if (!rule || !rule.startDate) return '';

        const weekday = DAYS[
            Number.isInteger(rule.weekday) ? rule.weekday : parseDate(rule.startDate).getDay()
        ];
        const at = rule.time ? ' at ' + formatTime(rule.time) : '';

        let pattern;
        if (!rule.freq || rule.freq === Core.FREQ.ONCE) {
            // A one-off has no pattern to carry on, so it ends here — appending
            // "until further notice" to a single date would be nonsense.
            return 'Once, on ' + weekday + ' ' + formatDayMonth(rule.startDate) + at + '.';
        } else if (rule.freq === Core.FREQ.WEEKLY) {
            pattern = 'Every ' + weekday;
        } else if (rule.freq === Core.FREQ.FORTNIGHTLY) {
            pattern = 'Every other ' + weekday;
        } else if (rule.freq === Core.FREQ.MONTHLY) {
            const nth = ['first', 'second', 'third', 'fourth', 'fifth'][
                Math.floor((parseDate(rule.startDate).getDate() - 1) / 7)
            ];
            pattern = 'The ' + nth + ' ' + weekday + ' of the month';
        } else {
            return '';
        }

        const ends = rule.ends || {};
        let tail = ', until further notice.';
        if (ends.kind === Core.ENDS.ON_DATE && ends.date) {
            tail = ', until ' + formatDayMonth(ends.date) + '.';
        } else if (ends.kind === Core.ENDS.AFTER_COUNT && ends.count) {
            tail = ', ' + ends.count + ' times.';
        }

        return pattern + at + tail;
    }

    // The next few dates, as the small chips under the "Reads as" sentence.
    function nextDates(rule, from, howMany) {
        if (!rule || !rule.startDate) return [];
        const start = from || rule.startDate;
        // A generous window, then take the first few — cheaper than iterating
        // the rule twice, and a monthly pattern needs the room.
        const d = parseDate(start);
        d.setFullYear(d.getFullYear() + 2);
        return Core.datesBetween(rule, start, formatDate(d)).slice(0, howMany || 6);
    }

    // ── The month grid ───────────────────────────────────────────────────────
    //
    // Sunday-start, with the leading and trailing days of the neighbouring
    // months filling the corners so the grid is always whole rows.

    function monthGrid(month, occurrences, today) {
        const [year, mon] = String(month || '').split('-').map(Number);
        if (!year || !mon) return [];

        const first = new Date(year, mon - 1, 1);
        const start = new Date(year, mon - 1, 1 - first.getDay());

        // However many whole weeks the month spans. The design shows five, which
        // is the common case — but a month that starts late genuinely needs six,
        // and truncating would hide real dates from the one screen whose job is
        // showing them.
        const daysInMonth = new Date(year, mon, 0).getDate();
        const rows = Math.ceil((first.getDay() + daysInMonth) / 7);

        const byDate = new Map();
        (occurrences || []).forEach(o => {
            if (!o || !o.date) return;
            if (!byDate.has(o.date)) byDate.set(o.date, []);
            byDate.get(o.date).push(o);
        });

        const cells = [];
        for (let i = 0; i < rows * 7; i++) {
            const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            const date = formatDate(d);
            const events = byDate.get(date) || [];
            cells.push({
                date: date,
                day: d.getDate(),
                inMonth: d.getMonth() === mon - 1,
                isToday: date === today,
                events: events,
                // One glyph in the corner, driven from the same switch as every
                // other surface, so they cannot disagree about what needs sorting.
                needsAttention: events.some(o => Core.needsAttention(o)),
            });
        }
        return cells;
    }

    // The same occurrences grouped by the week they fall in — the List view, and
    // the phone's agenda.
    function weekGroups(occurrences, today) {
        const groups = [];
        const index = new Map();

        (occurrences || []).slice()
            .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
            .forEach(o => {
                const d = parseDate(o.date);
                const weekStart = formatDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()));
                if (!index.has(weekStart)) {
                    const group = { weekStart: weekStart, label: 'Week of ' + formatDayMonth(weekStart), events: [] };
                    index.set(weekStart, group);
                    groups.push(group);
                }
                index.get(weekStart).events.push(o);
            });

        // "— this week" is the only relative wording, and only on the one group
        // it is true of.
        if (today) {
            const t = parseDate(today);
            const thisWeek = formatDate(new Date(t.getFullYear(), t.getMonth(), t.getDate() - t.getDay()));
            groups.forEach(g => {
                if (g.weekStart === thisWeek) g.label += ' — this week';
            });
        }
        return groups;
    }

    // ── The picker's reasons ─────────────────────────────────────────────────
    //
    // MUST RETURN A REASON, NEVER A BOOLEAN. The whole point of the picker is
    // that an editor can see who was passed over and WHY, rather than wondering
    // where somebody went. A boolean here would turn the screen back into a
    // silent omission with extra steps.
    //
    // Returns null when the person may fill the slot.
    //
    // The rules themselves already live in RolesCore.candidatesFor — this only
    // puts the reason it gives into words a person reads.

    function nameOf(people, personId) {
        const person = (people || []).find(p => p && p.id === personId);
        return (person && person.name) || 'someone';
    }

    function blockReason(candidate, context) {
        if (!candidate || candidate.eligible) return null;
        const ctx = context || {};
        const R = Roles.REASONS;

        switch (candidate.reason) {
            case R.INACTIVE:
                return 'No longer active';

            case R.ALREADY_ASSIGNED: {
                // Name the Roles they are already down for. "Already serving
                // here" alone leaves the editor hunting for where.
                const elsewhere = (ctx.otherRoles || []).filter(Boolean);
                return elsewhere.length
                    ? 'Already serving here — ' + listSentence(elsewhere)
                    : 'Already serving here';
            }

            case R.SEX_MISMATCH:
                return ctx.requirement === Roles.REQUIREMENTS.FEMALE
                    ? 'This place needs a woman'
                    : 'This place needs a man';

            case R.SEX_UNKNOWN:
                return 'We do not have their sex on file, and this place asks for one';

            case R.MISSING_REQUIRED_TAG:
                return 'Not in the ' + (ctx.tagName || 'required') + ' group';

            case R.EXCLUDED_BY_TAG:
                return 'The ' + (ctx.tagName || 'rule') + ' tag rules them out of this Role';

            case R.RELATIONSHIP_CONFLICT:
                return 'Married to ' + nameOf(ctx.people, candidate.conflictsWith) +
                    ', who is already in this Role';

            case R.SAME_GROUP_CONFLICT:
                return 'In the same ' + (candidate.groupName || 'group') + ' as ' +
                    nameOf(ctx.people, candidate.conflictsWith) + ', who is already in this Role';

            case R.NOT_IN_REQUIRED_GROUP:
                return 'Not in the ' + (ctx.groupName || 'required') + ' group';

            default:
                // A rule we do not have words for still gets a reason. Never an
                // empty subtitle, and never a silent omission.
                return 'Cannot take this place';
        }
    }

    // "Setup and Sound" / "Setup, Sound and Kids Ministry".
    function listSentence(items) {
        const list = (items || []).filter(Boolean);
        if (!list.length) return '';
        if (list.length === 1) return list[0];
        return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
    }

    // The fairness note an eligible person shows in the same slot the reason
    // would occupy — which is also where an auto-assign suggestion will sit
    // later, so no relayout is needed then.
    function fairnessNote(candidate, context) {
        const ctx = context || {};
        const parts = [];
        if (ctx.groupName) parts.push(ctx.groupName + ' group');
        if (ctx.lastServed) parts.push('last served ' + ctx.lastServed);
        else if (ctx.lastServed === null) parts.push('has not served this Role yet');
        return parts.join(' · ');
    }

    // ── Changing a pattern: the consequence, in words ────────────────────────
    //
    // A question in gold, not an error in red. Nothing is pre-decided except a
    // default of Move, and every line says exactly what will happen.

    const countOf = occurrence => ((occurrence && occurrence.assignments) || []).length;

    function plural(n, word) {
        return n + ' ' + word + (n === 1 ? '' : 's');
    }

    function orphanOutcome(occurrence, choice) {
        const n = countOf(occurrence);
        if (choice === 'delete') {
            return n
                ? 'This one goes, and so do its ' + plural(n, 'assignment') + '.'
                : 'This one goes.';
        }
        return n
            ? 'This one moves onto the new pattern, and its ' + plural(n, 'assignment') + ' come with it.'
            : 'This one moves onto the new pattern.';
    }

    // The footer sentence, recomputed from the choices as they are made.
    function orphanSummary(orphans, choices) {
        const decisions = choices || {};
        let moving = 0;
        let going = 0;
        let lost = 0;

        (orphans || []).forEach(o => {
            if (decisions[o.date] === 'delete') {
                going++;
                lost += countOf(o);
            } else {
                moving++;
            }
        });

        if (!moving && !going) return 'Nothing to decide.';
        if (!going) return plural(moving, 'date') + ' moving. Nothing is lost.';

        const head = moving
            ? moving + ' moving, ' + going + ' going'
            : plural(going, 'date') + ' going';
        return lost
            ? head + ' — which loses ' + plural(lost, 'assignment') + '.'
            : head + '.';
    }

    // ── The past-event question ──────────────────────────────────────────────

    // "Four people were never confirmed. Did they serve?" Small words for small
    // numbers, because this is scaffolding and must not read like an alarm.
    const WORDS = ['nobody', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

    function unconfirmedPrompt(occurrence) {
        const n = Core.unconfirmedCount(occurrence);
        // Zero renders nothing. A prompt that appears when there is nothing to
        // ask is a nag.
        if (!n) return null;
        const who = n <= 10 ? WORDS[n] : String(n);
        return who + (n === 1 ? ' person was' : ' people were') + ' never confirmed. Did they serve?';
    }

    // The footer of the tick-list, recomputed as the editor ticks.
    function serveTickSummary(questions, ticks) {
        const total = (questions || []).length;
        const served = (questions || []).filter(q => (ticks || {})[q.personId]).length;
        const open = total - served;

        if (!total) return '';
        if (!served) return 'Nothing recorded. All ' + total + ' stay unanswered, for good.';
        if (!open) return 'All ' + plural(total, 'serve') + ' recorded.';
        return plural(served, 'serve') + ' recorded. ' + open + ' stay unanswered, for good.';
    }

    // ── The "You in July" summary ────────────────────────────────────────────
    //
    // Derived from the events themselves and sorted by date. Never a second
    // list — a parallel list is a list that goes stale.

    function myCommitments(occurrences, personId) {
        if (!personId) return [];
        const mine = [];
        (occurrences || []).forEach(o => {
            ((o && o.assignments) || []).forEach(a => {
                if (a.personId !== personId) return;
                mine.push({
                    date: o.date,
                    occurrenceId: o.id,
                    eventName: o.name || o.seriesName || 'Event',
                    roleLabel: a.label || a.roleSlug,
                    state: a.state || Core.STATES.PENDING,
                    stateLabel: Core.stateLabel(a),
                    tone: Core.stateTone(a),
                });
            });
        });
        return mine.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }

    // The EB Garamond sentence at the top of the rail: what you are down for,
    // and how many are still waiting on your yes.
    function myCommitmentsSentence(commitments, monthLabel) {
        const list = commitments || [];
        if (!list.length) {
            return 'Nothing on for you' + (monthLabel ? ' in ' + monthLabel : '') + '.';
        }

        const names = list.map(c => c.roleLabel);
        const head = list.length === 1
            ? 'One thing — ' + names[0] + '.'
            : plural(list.length, 'thing') + ' — ' + listSentence(names) + '.';

        const waiting = list.filter(c => c.state === Core.STATES.PENDING).length;
        if (!waiting) return head;
        return head + ' ' + (waiting === 1
            ? '1 is still waiting on your yes.'
            : waiting + ' are still waiting on your yes.');
    }

    // ── Needs sorting ────────────────────────────────────────────────────────
    //
    // One row per open problem, in plain sentences. Both kinds come from the
    // same place so the rail cannot disagree with the calendar cells.

    function needsSorting(occurrences, people) {
        const rows = [];
        (occurrences || []).forEach(o => {
            ((o && o.assignments) || []).forEach(a => {
                if ((a.state || Core.STATES.PENDING) !== Core.STATES.DECLINED) return;
                rows.push({
                    date: o.date,
                    occurrenceId: o.id,
                    icon: 'error',
                    sentence: nameOf(people, a.personId) + ' declined ' +
                        (a.label || a.roleSlug) + '. The place still needs someone.',
                });
            });

            const unconfirmed = Core.unconfirmedCount(o);
            // Only once the date has passed is silence a question. Before then
            // it is simply nobody having answered yet, which is normal.
            if (unconfirmed && o.isPast) {
                rows.push({
                    date: o.date,
                    occurrenceId: o.id,
                    icon: 'help',
                    sentence: unconfirmedPrompt(o),
                });
            }
        });
        return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }

    const CalendarView = {
        // small formatting
        initials,
        formatTime,
        formatDayMonth,
        weekdayName,
        listSentence,
        // visibility
        VISIBILITY,
        visibilityLabel,
        visibilityIcon,
        visibilityWho,
        visibilityLadder,
        rosterToggleApplies,
        // colour
        EVENT_COLOURS,
        DEFAULT_COLOUR,
        SUNDAY_COLOUR,
        ATTENTION_COLOUR,
        colourFor,
        colourOf,
        // recurrence
        recurrenceSentence,
        nextDates,
        // layout
        monthGrid,
        weekGroups,
        // the picker
        blockReason,
        fairnessNote,
        // changing a pattern
        orphanOutcome,
        orphanSummary,
        // the past-event question
        unconfirmedPrompt,
        serveTickSummary,
        // the rail
        myCommitments,
        myCommitmentsSentence,
        needsSorting,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = CalendarView;
    }
    if (global) {
        global.CalendarView = CalendarView;
    }
})(typeof window !== 'undefined' ? window : null);
