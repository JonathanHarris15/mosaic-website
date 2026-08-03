// Auto-assign Grid Core — turning a draft into the thing on screen (MS-179).
//
// The draft that `auto-assign-core` returns is shaped for the SOLVE: a list of
// dates, each holding a flat list of filled seats and a flat list of gaps. The
// screen needs the transpose of that — Roles down the side, dates across the
// top, and every place present whether or not anybody is in it.
//
// ⚠ AN EMPTY PLACE HAS TO EXIST IN THE GRID. The solve returns gaps in a list
// beside the seats, so a naive render of `seats` draws a Role needing three
// people as a cell with two cards and no hint that a third was ever wanted.
// Rebuilding each cell from the Role's OWN slots — then hanging whoever the
// solve seated onto them — is what makes an unfilled place visible, which is
// the entire point of drafting ahead rather than discovering it on a Sunday.
//
// ── Three kinds of row, and why ──────────────────────────────────────────────
//
//   Liturgy      read-only, at the top. Not fillable here — it is set in the
//                order of service (ADR-0018 §2) — but shown, because holding
//                one of those jobs is WHY somebody is missing from every row
//                below, and an absence with no reason reads as a bug.
//   Managed      the body. One row per Role the series carries.
//   One-off      below a divider. A one-off belongs to exactly one date, so its
//                row is fillable in one column and not-applicable in the rest.
//                Never auto-filled — the solve has no definition to reason
//                about, so it never sees them.
//
// ── What this module refuses to know ─────────────────────────────────────────
//
// Names, wording, and every number that came out of the serve log. Load,
// recency and warnings all arrive as injected lookups, the same way the solve
// does elsewhere in this feature. It arranges; it does not judge and it does
// not phrase.
//
// Loaded as a classic <script> (window.AutoAssignGridCore) and exported for Node.

(function (global) {
    'use strict';

    const MALE = 'male';
    const FEMALE = 'female';

    // What a place asks for, in the words the editor reads. `either` is the
    // common case and says "Anyone" rather than staying silent, because a blank
    // where the other two carry a word reads as missing data.
    function wantsOf(requirement) {
        if (requirement === MALE) return 'A man';
        if (requirement === FEMALE) return 'A woman';
        return 'Anyone';
    }

    // Two letters at most, from the first and last word of the name. A stand-in
    // until real photographs land, so the card's shape never changes when they
    // do.
    function initialsOf(name) {
        const words = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!words.length) return '?';
        const first = words[0][0];
        const last = words.length > 1 ? words[words.length - 1][0] : '';
        return (first + last).toUpperCase();
    }

    // How long since this person last held THIS Role, in occurrences.
    //
    // `recency` is capped at the window by fairness-core, and a person who has
    // never held the Role reads the same as one who held it before the window
    // opened — deliberately, and the wording has to be honest about that rather
    // than claiming a precise number it does not have.
    function recencyLabel(recency, windowSize) {
        if (recency === null || recency === undefined) return '';
        if (recency <= 0) return 'Last time';
        if (windowSize && recency >= windowSize) return 'Not this season';
        return recency + ' ago';
    }

    const slotsOf = role => (role && Array.isArray(role.slots) ? role.slots : []);

    // ── One person, on one place ─────────────────────────────────────────────

    function cardFor(seat, o, date, roleSlug) {
        const personId = seat.personId;
        const name = o.nameOf(personId);
        const load = o.loadAt(date, personId);
        const budget = o.windowSize;
        const warning = o.warningAt(date, roleSlug, seat.slotId);

        // The seat carries its own recency when the solve placed it. A HELD
        // seat does not — the search fills in around those and never scores
        // them — so the lookup is what stops a hand-made pick from being the
        // one card on the grid with no history on it.
        const recency = (seat.recency === null || seat.recency === undefined)
            ? o.recencyAt(date, roleSlug, personId)
            : seat.recency;

        return {
            personId: personId,
            name: name,
            initials: initialsOf(name),
            load: load,
            budget: budget,
            // Over budget is a fact about the SEASON, not about this place, so
            // it is on the card in every cell that person appears in.
            spent: budget > 0 && load >= budget,
            recency: recency,
            recencyLabel: recencyLabel(recency, budget),
            held: !!seat.held,
            state: seat.state || null,
            warning: warning
                ? o.reasonText(warning, { date: date, roleSlug: roleSlug, slotId: seat.slotId })
                : null,
        };
    }

    // ── One Role's cell, on one date ─────────────────────────────────────────

    function cellFor(role, day, o) {
        const date = day.date;
        const seated = {};
        (day.seats || []).forEach(seat => {
            if (seat && seat.roleSlug === role.slug) seated[seat.slotId] = seat;
        });
        const gaps = {};
        (day.gaps || []).forEach(gap => {
            if (gap && gap.roleSlug === role.slug) gaps[gap.slotId] = gap;
        });

        const places = slotsOf(role).map(slot => {
            const seat = seated[slot.id];
            const gap = gaps[slot.id];
            return {
                roleSlug: role.slug,
                slotId: slot.id,
                requirement: slot.requirement || null,
                wants: wantsOf(slot.requirement),
                filled: !!seat,
                card: seat ? cardFor(seat, o, date, role.slug) : null,
                // Only when the solve TRIED and could not. A place left empty
                // on a date the editor asked to be left alone was never
                // attempted, and inventing a reason for it would be a lie.
                // The reason belongs to the SLOT that could not be filled, so
                // the slot goes with it — "this place needs a woman" cannot be
                // phrased from the reason alone.
                reason: (!seat && gap && gap.detail)
                    ? o.reasonText(gap.detail, {
                        date: date, roleSlug: role.slug, slotId: slot.id,
                    })
                    : null,
            };
        });

        return { date: date, skipped: !!day.skipped, applicable: true, places: places };
    }

    // ── The rows ─────────────────────────────────────────────────────────────

    function liturgyRow(o) {
        const cells = o.dates.map(day => ({
            date: day.date,
            skipped: !!day.skipped,
            applicable: true,
            holders: (o.liturgicalAt(day.date) || [])
                .filter(h => h && h.personId)
                .map(h => ({
                    personId: h.personId,
                    name: o.nameOf(h.personId),
                    initials: initialsOf(o.nameOf(h.personId)),
                    roleSlug: h.roleSlug || null,
                    roleName: h.roleSlug ? o.roleNameOf(h.roleSlug) : '',
                })),
        }));

        return {
            kind: 'liturgy',
            key: 'liturgy',
            name: 'Liturgy',
            readOnly: true,
            allowsAnotherRole: false,
            cells: cells,
            // Nothing to draw if the series has no liturgy at all — a midweek
            // Event has no preacher, and an empty read-only row is furniture.
            occupied: cells.some(cell => cell.holders.length > 0),
        };
    }

    function roleRows(o) {
        return (o.roles || []).map(role => ({
            kind: 'role',
            key: 'role:' + role.slug,
            slug: role.slug,
            name: o.roleNameOf(role.slug),
            readOnly: false,
            // Marked on the row header so the same face appearing twice in one
            // column reads as allowed rather than as a bug.
            allowsAnotherRole: role.allowsAnotherRole === true,
            placeCount: slotsOf(role).length,
            cells: o.dates.map(day => cellFor(role, day, o)),
        }));
    }

    // A one-off Role belongs to exactly ONE date. Its row is fillable there and
    // reads as not-applicable everywhere else — rather than being left blank,
    // which would look like an empty place somebody forgot to fill.
    function oneOffRows(o) {
        const rows = [];

        o.dates.forEach(day => {
            (o.oneOffsAt(day.date) || []).forEach(job => {
                if (!job || !job.id) return;
                const people = (o.oneOffPeopleAt(day.date) || [])
                    .filter(a => a && a.oneOffId === job.id && a.personId);

                rows.push({
                    kind: 'oneOff',
                    key: 'oneOff:' + day.date + ':' + job.id,
                    id: job.id,
                    date: day.date,
                    slug: job.id,
                    name: job.label || 'One-off job',
                    readOnly: false,
                    allowsAnotherRole: job.allowsAnotherRole === true,
                    // No fixed count: an open-ended list the editor adds to.
                    placeCount: null,
                    cells: o.dates.map(other => ({
                        date: other.date,
                        skipped: !!other.skipped,
                        applicable: other.date === day.date,
                        places: other.date === day.date
                            ? people.map(a => ({
                                roleSlug: job.id,
                                slotId: null,
                                oneOffId: job.id,
                                requirement: null,
                                wants: 'Anyone',
                                filled: true,
                                card: cardFor({
                                    personId: a.personId,
                                    slotId: null,
                                    held: true,
                                    state: a.state || null,
                                    recency: null,
                                }, o, day.date, job.id),
                                reason: null,
                            }))
                            : [],
                    })),
                });
            });
        });

        return rows;
    }

    // ── The range strip ──────────────────────────────────────────────────────
    //
    // One tick per date, each carrying three counts. This is what buys back the
    // overview the rich cards cost: the cards are worth reading and only four
    // or five dates fit at once, so without this the editor cannot tell whether
    // the trouble is on the date in front of them or six columns away.

    function columns(o, rows) {
        return o.dates.map((day, index) => {
            let empty = 0;
            let problems = 0;
            const spent = {};

            rows.forEach(row => {
                if (row.kind === 'liturgy') return;
                const cell = row.cells[index];
                if (!cell || !cell.applicable) return;
                cell.places.forEach(place => {
                    if (!place.filled) { empty++; return; }
                    if (place.card.warning) problems++;
                    if (place.card.spent) spent[place.card.personId] = true;
                });
            });

            return {
                date: day.date,
                index: index,
                label: o.labelOf(day.date),
                skipped: !!day.skipped,
                empty: empty,
                // Counted per PERSON, not per place: somebody over budget who
                // is down for two jobs is one tired person, not two.
                spent: Object.keys(spent).length,
                problems: problems,
            };
        });
    }

    function gridFrom(options) {
        const o = options || {};
        if (!Array.isArray(o.dates)) {
            throw new Error('AutoAssignGridCore needs options.dates — the drafted days.');
        }

        const liturgy = liturgyRow(o);
        const managed = roleRows(o);
        const oneOffs = oneOffRows(o);
        const rows = (liturgy.occupied ? [liturgy] : []).concat(managed, oneOffs);

        return {
            rows: rows,
            liturgy: liturgy,
            roleRows: managed,
            oneOffRows: oneOffs,
            columns: columns(o, rows),
        };
    }

    // ── Scrolling by dragging to the edge ────────────────────────────────────
    //
    // A drag holds the pointer captive, so the editor cannot reach for the
    // scrollbar or the range strip with the hand that is already full. Without
    // this, moving somebody from the first date to the last means dropping them
    // somewhere in between, scrolling, and picking them up again.
    //
    // ⚠ THE RECT IS THE VISIBLE BOX, NOT THE SCROLLING ELEMENT. The grid's
    // scroller is deliberately taller than what you can see — that is how its
    // own horizontal scrollbar is hidden — so measuring the scroller would put
    // the bottom edge 18px below the screen, where the pointer can never go.
    //
    // Speed ramps with how close to the edge you are, rather than switching on:
    // one speed is either too slow to cross a long range or too fast to stop on
    // a column. Zero outside the box entirely, so hovering the panel or the
    // displaced rail does not drive the grid.

    const EDGE_ZONE = 56;       // px from the edge where it starts to pull
    const EDGE_MAX = 22;        // px per frame at the very edge

    function axisPull(at, low, high, zone, max) {
        if (at < low || at > high) return 0;
        if (high - low <= zone * 2) return 0;   // no room to have edges at all
        if (at < low + zone) return -Math.ceil(((low + zone - at) / zone) * max);
        if (at > high - zone) return Math.ceil(((at - (high - zone)) / zone) * max);
        return 0;
    }

    function edgeScroll(rect, point, options) {
        if (!rect || !point) return { x: 0, y: 0 };
        const o = options || {};
        const zone = o.zone || EDGE_ZONE;
        const max = o.max || EDGE_MAX;

        return {
            x: axisPull(point.x, rect.left, rect.right, zone, max),
            y: axisPull(point.y, rect.top, rect.bottom, zone, max),
        };
    }

    const AutoAssignGridCore = {
        // words
        wantsOf,
        initialsOf,
        recencyLabel,
        // the grid
        gridFrom,
        // dragging to the edge
        EDGE_ZONE,
        EDGE_MAX,
        edgeScroll,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AutoAssignGridCore;
    }
    if (global) {
        global.AutoAssignGridCore = AutoAssignGridCore;
    }
})(typeof window !== 'undefined' ? window : null);
