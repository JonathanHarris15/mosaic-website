// Commitments Core — everything a Person is down for (MS-20).
//
// A **Commitment** is the member's word for their own Assignment: what you are
// down for on the dates ahead, whatever state each one is in. This assembles the
// list the Commitments page answers on.
//
// ⚠ IT COMES FROM TWO PLACES STORED NOTHING ALIKE.
//
// An **Assignment** lives on an Event occurrence, in one of three states, and is
// the thing a member confirms or declines. A **liturgical Role** — preaching,
// leading the service, leading the music — is a plain FIELD on services/{date}
// and carries no state at all (ADR-0018 §2). That is deliberate: those fields
// are what the printed booklet reads, and giving them Assignments too would put
// two sources of truth for who is preaching on one document.
//
// So the liturgy cannot be answered, and this marks it `answerable: false`
// rather than letting the page work out why. Being on the booklet IS the
// commitment (ADR-0019) — there is nothing left to confirm.
//
// ⚠ ANYTHING PAST IS DROPPED. A serve you have already done must not sit in a
// list of things still to do. `calendar-view.js` already drops it for the same
// reason, and the Calendar's "You in {month}" card reads this module so the card
// and the page cannot disagree about the same Sunday.
//
// Loaded as a classic <script> (window.CommitmentsCore) and exported for Node.

(function (global) {
    'use strict';

    const Core = (typeof require !== 'undefined')
        ? require('./events-occurrence-core.js')
        : global.EventsOccurrenceCore;

    // Is this date behind us? Dates are YYYY-MM-DD throughout, so they compare
    // as strings. TODAY IS NOT PAST — a thing this evening has not happened yet,
    // and dropping it would take somebody's Commitment off the page on the
    // morning they most need to see it.
    function isPast(date, today) {
        return !!(date && today) && date < today;
    }

    function row(spec) {
        return {
            date: spec.date,
            occurrenceId: spec.occurrenceId || null,
            eventName: spec.eventName || 'Event',
            roleSlug: spec.roleSlug || null,
            slotId: spec.slotId || null,
            label: spec.label || null,
            state: spec.state || null,
            stateLabel: spec.stateLabel || null,
            tone: spec.tone || null,
            answerable: spec.answerable === true,
            // Whether a declined place is kept off the open cover list
            // (MS-213). Carried through because the screen offers the toggle,
            // and without it every declined row would draw as "on the list"
            // whatever the truth was.
            quiet: spec.quiet === true,
        };
    }

    // ── The question ─────────────────────────────────────────────────────────
    //
    //   personId    — whose Commitments. No id, no answer: this must never fall
    //                 back to everybody's.
    //   occurrences — Event occurrences the caller has already read, each with
    //                 its `assignments`.
    //   services    — the services/{date} documents, for the liturgy.
    //   today       — YYYY-MM-DD.
    function commitmentsFor(spec) {
        const s = spec || {};
        const personId = s.personId;
        if (!personId) return [];

        const today = s.today;
        const out = [];

        (s.occurrences || []).forEach(o => {
            if (!o) return;
            if (o.isPast === true || isPast(o.date, today)) return;

            ((o.assignments) || []).forEach(a => {
                if (!a || a.personId !== personId) return;
                out.push(row({
                    date: o.date,
                    occurrenceId: o.id,
                    eventName: o.name || o.seriesName || 'Event',
                    roleSlug: a.roleSlug,
                    slotId: a.slotId,
                    label: a.label || null,
                    state: Core.stateOf(a),
                    stateLabel: Core.stateLabel(a, { asOwner: true }),
                    tone: Core.stateTone(a),
                    answerable: true,
                    quiet: a.quiet === true,
                }));
            });
        });

        (s.services || []).forEach(service => {
            if (!service) return;
            if (isPast(service.date, today)) return;

            // A NAME with no id is not a person. A visiting speaker typed in by
            // hand belongs to nobody, so nobody is down for it.
            Core.liturgicalHolders(service).forEach(held => {
                if (held.personId !== personId) return;
                out.push(row({
                    date: service.date,
                    occurrenceId: service.id || null,
                    eventName: 'Sunday Service',
                    roleSlug: held.roleSlug,
                    answerable: false,
                }));
            });
        });

        return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }

    const CommitmentsCore = {
        commitmentsFor,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = CommitmentsCore;
    } else {
        global.CommitmentsCore = CommitmentsCore;
    }
}(typeof window !== 'undefined' ? window : globalThis));
