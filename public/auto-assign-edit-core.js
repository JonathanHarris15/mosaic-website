// Auto-assign Edit Core — moving people around a draft (MS-180).
//
// The solve produces a starting point; this is what the editor does to it. A
// draft is proposed, not committed, so every move here is a change to an
// in-memory object and nothing else — no Assignment moves until accept.
//
// ── Why displacing is a first-class outcome ──────────────────────────────────
//
// Dropping somebody onto an occupied place is the common case, not the edge
// one: the editor knows who they want and is not going to clear the place
// first. So the person already there has to GO somewhere, and quietly deleting
// them is the failure — they were on the rota a second ago, and if they vanish
// the editor has to reconstruct from memory who they just lost.
//
// They go to the displaced rail, still attached to their date, waiting to be
// put back. An emptied place and a displaced person are different things and
// both have to be visible.
//
// ── What a hand-placed seat is ───────────────────────────────────────────────
//
// Not held, and not in any state. `held` means "this was already on the
// calendar when we started"; a seat the editor just made was not. And moving
// somebody who had CONFIRMED one Role into a different one does not carry
// their yes across — they never agreed to the new job (ADR-0018 §5).
//
// Loaded as a classic <script> (window.AutoAssignEditCore) and exported for Node.

(function (global) {
    'use strict';

    const keyOf = place => String(place.roleSlug) + '|' + String(place.slotId);

    const sameSeat = (seat, place) => (
        seat.roleSlug === place.roleSlug && String(seat.slotId) === String(place.slotId)
    );

    function dayAt(draft, date) {
        return ((draft && draft.dates) || []).filter(d => d && d.date === date)[0] || null;
    }

    // Replace one day in the range, leaving every other object identical, so
    // Alpine only redraws what actually moved.
    function withDay(draft, date, next) {
        return Object.assign({}, draft, {
            dates: draft.dates.map(day => (day.date === date ? next : day)),
        });
    }

    function withSeats(day, seats) {
        return Object.assign({}, day, { seats: seats });
    }

    // ── Taking somebody out ──────────────────────────────────────────────────

    // Clear a place. Returns the draft and whoever was in it — the caller
    // decides whether that person is displaced or simply gone.
    function clear(draft, place) {
        const day = dayAt(draft, place.date);
        if (!day) return { draft: draft, removed: null };

        const removed = (day.seats || []).filter(seat => sameSeat(seat, place))[0] || null;
        if (!removed) return { draft: draft, removed: null };

        return {
            draft: withDay(draft, place.date, withSeats(
                day, day.seats.filter(seat => !sameSeat(seat, place))
            )),
            removed: { personId: removed.personId, date: place.date },
        };
    }

    // ── Putting somebody in ──────────────────────────────────────────────────

    // Move a person into a place. `from` is where they came from, when they came
    // from the grid rather than the directory or the rail.
    //
    // Returns the new draft and whoever was knocked out of the target, which is
    // never nobody-in-particular: a displaced person is a thing the screen has
    // to show, not a side effect to swallow.
    function place(draft, move) {
        const m = move || {};
        if (!m.personId || !m.to || !m.to.date) return { draft: draft, displaced: null };

        // Onto the place they are already in: nothing happened. Said explicitly
        // because the general path would clear the seat and re-add it, which
        // would quietly strip a Confirmed state off somebody who never moved.
        if (m.from && m.from.date === m.to.date && keyOf(m.from) === keyOf(m.to)) {
            return { draft: draft, displaced: null };
        }

        let next = draft;

        // Out of the old place first, so a move WITHIN one date cannot leave a
        // copy behind — and so a swap onto the seat they just left works.
        if (m.from && m.from.date) {
            next = clear(next, m.from).draft;
        }

        const target = clear(next, m.to);
        next = target.draft;

        // ⚠ ONE PERSON, ONE PLACE PER ROLE, PER DATE. Without this, dragging
        // somebody onto a second place in the SAME Role leaves them in both and
        // the rota asks one person to be in two spots at once.
        const day = dayAt(next, m.to.date);
        if (!day) return { draft: draft, displaced: null };
        const seats = (day.seats || []).filter(seat => !(
            seat.personId === m.personId && seat.roleSlug === m.to.roleSlug
        ));

        seats.push({
            roleSlug: m.to.roleSlug,
            slotId: m.to.slotId,
            personId: m.personId,
            oneOffId: m.to.oneOffId || null,
            metadata: m.to.oneOffId ? { oneOffId: m.to.oneOffId } : null,
            // A seat the editor just made was not on the calendar when we
            // started, and carries no answer from the person in it.
            held: false,
            state: null,
            recency: null,
        });

        return {
            draft: withDay(next, m.to.date, withSeats(day, seats)),
            // Somebody knocked out by their own move is not displaced — they
            // are just where they went.
            displaced: (target.removed && target.removed.personId !== m.personId)
                ? target.removed
                : null,
        };
    }

    // ── The displaced rail ───────────────────────────────────────────────────

    // Nobody appears on the rail twice for the same date: two moves that both
    // knock out the same person are one person waiting to be placed.
    function addDisplaced(rail, person) {
        if (!person || !person.personId) return rail || [];
        const already = (rail || []).some(d => (
            d.personId === person.personId && d.date === person.date
        ));
        return already ? rail.slice() : (rail || []).concat([person]);
    }

    function removeDisplaced(rail, person) {
        if (!person) return rail || [];
        return (rail || []).filter(d => !(
            d.personId === person.personId && d.date === person.date
        ));
    }

    const AutoAssignEditCore = {
        clear,
        place,
        addDisplaced,
        removeDisplaced,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AutoAssignEditCore;
    }
    if (global) {
        global.AutoAssignEditCore = AutoAssignEditCore;
    }
})(typeof window !== 'undefined' ? window : null);
