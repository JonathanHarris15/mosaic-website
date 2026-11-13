// Away Core — the pure model for the days a Person has said they will not be
// here (MS-188).
//
// An Away is a stretch of WHOLE DAYS. Absence is physical: somebody in Spain on
// the 14th is in Spain for everything on the 14th, so this model has no times,
// no half-days and no per-Event answers. Saying no to one Event is declining an
// Assignment, which is a different act with a different name.
//
// Four things it knows:
//
//   1. Stretches, and how they combine. A Person may hold several. Two that
//      overlap — or merely touch, the 10th–14th beside the 15th–20th — are ONE
//      stretch and are merged on the way in. Otherwise a fortnight entered as
//      three overlapping guesses reads as three separate absences, and the list
//      that is supposed to answer "have I told them about August" stops being
//      readable.
//
//   2. Whether somebody is away on a date. The whole point: one predicate the
//      picker, the fairness solve and auto-assign all ask.
//
//   3. The clash. Places this Person already holds inside a stretch they are
//      entering. This model REPORTS them and changes nothing — an Away never
//      writes to an Assignment. Said before the rota is made it is prevention;
//      said after, the place stays theirs to hand on, and the roster reports
//      itself with a Warning that is derived on read and so clears by itself.
//
//   4. Painting. The screen marks DAYS — a tap marks or clears one, a drag marks
//      or clears a run — and this turns that into the stretches that are
//      stored. The person never sees a stretch; downstream (the picker, the
//      solve, auto-assign) never sees anything else.
//
//   5. The words. Every string on the screen lives here rather than in the page,
//      so the phone and the desktop cannot drift apart. Never "unavailable", "blackout" or "absence" — it is
//      Away, and where a person authored it, it is attributed to them.
//
// AWAY IS NOT THE DRAFT'S "OUT". Auto-assign lets an editor leave somebody out
// of a stretch of a draft; that is a drafting move, it dies with the draft, and
// it says nothing about the person. This is a fact about a Person's diary.
//
// Deliberately self-contained — like every other *-core module here, it requires
// nothing and returns new objects rather than mutating its inputs.
//
// Loaded as a classic <script> (window.AwayCore) and exported for Node tests.

(function (global) {
    'use strict';

    // ── Dates ────────────────────────────────────────────────────────────────
    //
    // `YYYY-MM-DD` strings throughout, which sort and compare as dates for free
    // and never carry a timezone into a question that has nothing to do with
    // one. Restated here rather than imported from date-utils.js, to keep this
    // module dependency-free like its neighbours.

    const DAY_MS = 86400000;

    function isoOf(year, monthIndex, day) {
        return year + '-' +
            String(monthIndex + 1).padStart(2, '0') + '-' +
            String(day).padStart(2, '0');
    }

    function toUTC(iso) {
        const parts = String(iso || '').split('-');
        return Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    }

    function addDays(iso, n) {
        const d = new Date(toUTC(iso) + n * DAY_MS);
        return isoOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }

    // Inclusive, so a single day is 1 rather than 0. A person saying "I'm away
    // Saturday" means one day, and a screen that answers "0 days" is wrong in a
    // way that makes the whole feature look broken.
    function spanDays(start, end) {
        if (!start || !end) return 0;
        return Math.round((toUTC(end) - toUTC(start)) / DAY_MS) + 1;
    }

    // ── Stretches ────────────────────────────────────────────────────────────

    // Start before end, whatever order they were given in. A drag can run
    // backwards and it should simply mean what it looks like.
    function normalise(stretch) {
        if (!stretch || !stretch.start || !stretch.end) return null;
        const a = stretch.start <= stretch.end ? stretch.start : stretch.end;
        const b = stretch.start <= stretch.end ? stretch.end : stretch.start;
        return Object.assign({}, stretch, { start: a, end: b });
    }

    // Overlapping OR touching. The 10th–14th and the 15th–20th are one absence
    // with a seam in it, and leaving the seam in means the list grows a row
    // every time somebody extends a holiday.
    function joins(a, b) {
        return a.start <= addDays(b.end, 1) && b.start <= addDays(a.end, 1);
    }

    // Add one stretch to a list, swallowing everything it joins. Returns a new
    // list, sorted, and the surviving stretch keeps the NEW author — the person
    // extending their holiday is the one making the current claim.
    function addStretch(stretches, stretch) {
        const fresh = normalise(stretch);
        if (!fresh) return (stretches || []).slice();

        const kept = [];
        let merged = fresh;
        (stretches || []).forEach(existing => {
            const one = normalise(existing);
            if (!one) return;
            if (joins(merged, one)) {
                merged = Object.assign({}, merged, {
                    start: one.start < merged.start ? one.start : merged.start,
                    end: one.end > merged.end ? one.end : merged.end,
                    // Ids of everything it absorbed, so the store knows what to
                    // delete rather than leaving orphans behind the merge.
                    absorbed: (merged.absorbed || []).concat(one.id ? [one.id] : []),
                });
            } else {
                kept.push(one);
            }
        });

        return kept.concat([merged]).sort((x, y) => (x.start < y.start ? -1 : 1));
    }

    // THE predicate. Everything downstream — the picker, the fairness solve,
    // auto-assign — asks this and nothing else.
    function isAwayOn(stretches, date) {
        if (!date) return false;
        return (stretches || []).some(s => s && date >= s.start && date <= s.end);
    }

    function stretchOn(stretches, date) {
        if (!date) return null;
        return (stretches || []).find(s => s && date >= s.start && date <= s.end) || null;
    }

    // Upcoming means "has not finished yet" — a holiday you are in the middle of
    // is not past. Splitting on `end` rather than `start` is what stops today's
    // absence dropping off the screen while you are still in it.
    function upcoming(stretches, today) {
        return (stretches || []).filter(s => s && s.end >= today)
            .sort((a, b) => (a.start < b.start ? -1 : 1));
    }

    function past(stretches, today) {
        return (stretches || []).filter(s => s && s.end < today)
            .sort((a, b) => (a.start > b.start ? -1 : 1));
    }

    // ── The clash ────────────────────────────────────────────────────────────
    //
    // Places this Person holds inside the stretch. A place is whatever the store
    // hands over: a date, a Role name, and the Event it belongs to. This model
    // never touches an Assignment — an Away is a fact about a diary, not an
    // answer about an Event.

    function clashesIn(places, start, end) {
        if (!start || !end || end < start) return [];
        return (places || [])
            .filter(p => p && p.date >= start && p.date <= end)
            .sort((a, b) => (a.date < b.date ? -1 : 1));
    }

    // Every place that falls inside ANY of these stretches — what is on record
    // as well as whatever is being chosen right now.
    //
    // ⚠ NOT ONLY THE RANGE IN HAND. A place you are serving on a day you already
    // said you were away is still your problem tomorrow, and a screen that
    // mentions it only while you happen to be mid-selection is a screen that
    // helps you forget it. The obligation is standing, so the telling is too.
    function conflictsIn(places, stretches) {
        return (places || [])
            .filter(p => p && p.date && isAwayOn(stretches, p.date))
            .sort((a, b) => (a.date < b.date ? -1 : 1));
    }

    function clashCount(places, stretch) {
        const one = normalise(stretch);
        return one ? clashesIn(places, one.start, one.end).length : 0;
    }

    // ── Painting days ────────────────────────────────────────────────────────
    //
    // The grid IS the input, on every size, and it works in days. A tap on a day
    // that is not away marks it; a tap on one that is clears it. A drag does the
    // same to every day it crosses, and WHICH it does is settled by the day it
    // started on — start on a clear day and the drag marks, start on an away day
    // and it clears. That is how a paint tool behaves, and it means one gesture
    // never does both.
    //
    // There is no "add" step and no list of ranges to manage. The calendar is
    // the record: what is coloured is what is stored.
    //
    // Underneath, the days are still kept as stretches, because every reader of
    // Away (the picker, the solve, auto-assign, the Firestore query) asks
    // "which stretches overlap this window", and none of that should move. So a
    // paint is turned into stretch writes here:
    //
    //   - MARKING joins the run to whatever it touches (addStretch above), and
    //     the joined stretch carries the person marking — they are making the
    //     current claim. Marking days that are ALL already away inside one
    //     stretch changes nothing, and so re-attributes nothing.
    //   - CLEARING trims or splits whatever it cuts. What is left keeps its
    //     ORIGINAL author: taking a day out of Sarah's fortnight is not anybody
    //     claiming the rest of it on her behalf.
    //
    // Returns the new list AND the writes that get there, so the store and the
    // page's instant redraw are the same computation. A write with `id: null`
    // is a new document.

    function authorFields(author) {
        const who = author || {};
        return {
            authorPersonId: who.personId || null,
            authorUid: who.uid || null,
            authorName: who.name || null,
        };
    }

    function paintDays(stretches, from, to, on, author) {
        const list = (stretches || []).map(normalise).filter(Boolean);
        const range = normalise({ start: from, end: to || from });
        if (!range) return { stretches: list, set: [], remove: [] };

        if (on) {
            if (list.some(s => s.start <= range.start && s.end >= range.end)) {
                return { stretches: list, set: [], remove: [] };
            }
            const merged = addStretch(list, Object.assign({ start: range.start, end: range.end }, authorFields(author)));
            const written = merged.find(s => !s.id || (s.absorbed && s.absorbed.length));
            const absorbed = written.absorbed || [];
            // Re-use one of the documents it swallowed rather than deleting them
            // all and minting a new one.
            const fresh = Object.assign({}, written, { id: absorbed[0] || null });
            delete fresh.absorbed;
            return {
                stretches: merged.map(s => (s === written ? fresh : s)),
                set: [fresh],
                remove: absorbed.slice(1),
            };
        }

        const kept = [];
        const set = [];
        const remove = [];
        list.forEach(s => {
            if (s.end < range.start || s.start > range.end) { kept.push(s); return; }
            const left = s.start < range.start ? Object.assign({}, s, { end: addDays(range.start, -1) }) : null;
            // The left piece keeps the document; with no left piece, the right
            // one does.
            const right = s.end > range.end
                ? Object.assign({}, s, { id: left ? null : s.id, start: addDays(range.end, 1) })
                : null;
            if (left) { kept.push(left); set.push(left); }
            if (right) { kept.push(right); set.push(right); }
            if (!left && !right && s.id) remove.push(s.id);
        });
        kept.sort((x, y) => (x.start < y.start ? -1 : 1));
        return { stretches: kept, set: set, remove: remove };
    }

    // How many days from today on are marked — what the screen says instead of
    // reading ranges back.
    function daysAhead(stretches, today) {
        return (stretches || []).reduce((n, s) => {
            if (!s || !s.end || s.end < today) return n;
            const start = s.start > today ? s.start : today;
            return n + spanDays(start, s.end);
        }, 0);
    }

    // ── The words ────────────────────────────────────────────────────────────
    //
    // On the screen and in this module only. Never "unavailable", "blackout" or
    // "absence": the word is Away.

    const MONTHS = Object.freeze([
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
    ]);

    const WEEKDAYS = Object.freeze(['S', 'M', 'T', 'W', 'T', 'F', 'S']);

    // Small counts read better as words in a sentence a person is meant to
    // absorb rather than parse. Past ten it is a number again.
    const WORDS = Object.freeze([
        'No', 'One', 'Two', 'Three', 'Four', 'Five',
        'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    ]);

    function inWords(n) {
        return n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
    }

    function longDate(iso) {
        if (!iso) return '';
        const d = new Date(toUTC(iso));
        const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()];
        return weekday + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
    }

    function midDate(iso) {
        if (!iso) return '';
        const d = new Date(toUTC(iso));
        return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()].slice(0, 3);
    }

    function monthLabel(year, monthIndex) {
        return MONTHS[monthIndex] + ' ' + year;
    }

    // What the grid is asking for right now.
    function prompt(drag) {
        if (!drag) return "Tap a day you're away, or drag across several";
        return drag.on ? 'Marking these days away' : 'Clearing these days';
    }

    // What is on the calendar, or what the drag in hand is about to do to it.
    // A sentence, never a list of ranges — this screen is closer to colouring
    // in the calendar on the fridge than to filing for leave.
    function sentence(stretches, today, drag) {
        if (drag) {
            const range = normalise({ start: drag.from, end: drag.to || drag.from });
            const n = spanDays(range.start, range.end);
            const what = n === 1
                ? longDate(range.start)
                : longDate(range.start) + ' to ' + longDate(range.end) + ' — ' + n + ' days';
            return what + (drag.on ? ', away.' : ', cleared.');
        }
        const ahead = daysAhead(stretches, today);
        if (!ahead) return 'No days marked yet.';
        return (ahead === 1 ? 'One day' : inWords(ahead) + ' days') + ' marked from today on. Tap one to clear it.';
    }

    // Not a warning that something went wrong. The moment the person learns they
    // have something to do — and it has to read the same whether they just chose
    // the days or chose them a fortnight ago, because it covers both.
    function conflictHeading(n) {
        return n === 1
            ? "One place of yours falls on a day you're away."
            : inWords(n) + " places of yours fall on days you're away.";
    }

    // ── How an editor reads it ───────────────────────────────────────────────
    //
    // Away is shown in the picker like any other reason and the person stays
    // placeable — but it is the only reason a PERSON authored, so it carries
    // their name. Every other reason is a rule the church wrote, and overruling
    // a rule is judgement; overruling "Sarah said she's away" should feel like
    // what it is.
    //
    // `subject` is the person who is away. `author` is whoever entered it, and
    // when nobody recorded an author the safe reading is the person's own — an
    // unattributed claim must never be put in an editor's mouth.

    function awayNote(stretch, subject, author) {
        const name = firstName(subject) || 'They';
        if (!stretch || !stretch.authorPersonId || stretch.authorPersonId === (subject && subject.id)) {
            return name + ' said ' + pronounFor(subject) + " away";
        }
        return (firstName(author) || 'An editor') + ' marked ' + name + ' away';
    }

    function firstName(person) {
        return String((person && person.name) || '').trim().split(/\s+/)[0] || '';
    }

    // No pronoun is stored on a Person and none is guessed from a name, so the
    // sentence is built to work without one.
    function pronounFor() {
        return "they're";
    }

    // ── The grid ─────────────────────────────────────────────────────────────
    //
    // One month of cells, each carrying everything the view needs to draw it and
    // nothing it has to work out for itself. The same computation feeds the
    // desktop's two months and the phone's one, so they cannot disagree about
    // what a day looks like.
    //
    // `stretches` is what to draw — with a drag in hand, the page passes the
    // list as it WILL be, so the calendar answers the finger as it moves.
    // `drag` only marks which days that drag is touching.

    function monthGrid(year, monthIndex, options) {
        const o = options || {};
        const stretches = o.stretches || [];
        const places = o.places || [];
        const today = o.today || null;
        const drag = o.drag ? normalise({ start: o.drag.from, end: o.drag.to || o.drag.from }) : null;
        const dragTone = o.drag ? (o.drag.on ? 'on' : 'off') : null;

        const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
        const total = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
        const rows = Math.ceil((firstWeekday + total) / 7);

        const cells = [];
        for (let i = 0; i < rows * 7; i++) {
            const dayNumber = i - firstWeekday + 1;
            const inMonth = dayNumber >= 1 && dayNumber <= total;
            const iso = inMonth ? isoOf(year, monthIndex, dayNumber) : null;
            const weekday = i % 7;

            const away = !!iso && isAwayOn(stretches, iso);
            const pending = !!iso && !!drag && iso >= drag.start && iso <= drag.end ? dragTone : null;
            const place = iso ? places.find(p => p && p.date === iso) || null : null;

            // A run of away days draws as one block. It breaks at the end of a
            // week row as well as at a clear day, because the next day is on
            // the line below.
            const runStart = away && (weekday === 0 || dayNumber === 1 || !isAwayOn(stretches, addDays(iso, -1)));
            const runEnd = away && (weekday === 6 || dayNumber === total || !isAwayOn(stretches, addDays(iso, 1)));

            cells.push({
                iso: iso,
                day: inMonth ? dayNumber : '',
                inMonth: inMonth,
                away: away,
                pending: pending,
                runStart: runStart,
                runEnd: runEnd,
                isToday: !!iso && iso === today,
                // A day that has gone. Away is a thing you say BEFORE
                // (ADR-0023 §4), so these are drawn faded and cannot be tapped
                // — the rail starts at this month, so its first days are
                // always behind you.
                past: !!iso && !!today && iso < today,
                // A place you hold turns amber on a day you are away — the same
                // dot, saying "this one is now your problem".
                place: place,
                dotTone: place ? (away ? 'warning' : 'sand') : null,
                title: place ? place.role + ' · ' + place.event : '',
            });
        }

        return { year: year, monthIndex: monthIndex, label: monthLabel(year, monthIndex), cells: cells };
    }

    // A run of months from an anchor, which is how both sizes page: the desktop
    // shows two and steps a month at a time, the phone runs several on.
    function monthsFrom(year, monthIndex, count, options) {
        const out = [];
        for (let i = 0; i < count; i++) {
            const m = ((monthIndex + i) % 12 + 12) % 12;
            const y = year + Math.floor((monthIndex + i) / 12);
            out.push(monthGrid(y, m, options));
        }
        return out;
    }

    const AwayCore = {
        // dates
        isoOf,
        addDays,
        spanDays,
        // stretches
        normalise,
        joins,
        addStretch,
        isAwayOn,
        stretchOn,
        upcoming,
        past,
        // clash
        clashesIn,
        conflictsIn,
        clashCount,
        // painting
        paintDays,
        daysAhead,
        // words
        MONTHS,
        WEEKDAYS,
        inWords,
        longDate,
        midDate,
        monthLabel,
        prompt,
        sentence,
        conflictHeading,
        awayNote,
        // grid
        monthGrid,
        monthsFrom,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AwayCore;
    } else {
        global.AwayCore = AwayCore;
    }
}(typeof window !== 'undefined' ? window : globalThis));
