// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/cover-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Cover Core — may this Person take on an Assignment somebody else declined?
// (MS-20, ADR-0030)
//
// One question, one answer, one sentence of reason. Every surface renders what
// this returns and decides nothing itself.
//
// ⚠ THE RULES ALREADY EXIST. THEIR AUDIENCE IS WHAT CHANGED.
//
// `RolesCore.candidatesFor` already judges a Person against a slot and already
// returns a reason. But ADR-0021 made those reasons ADVICE: they warn, they
// never refuse, because the editor authored the rules and overruling yourself is
// your own business. A member picking their own place is not that person, and
// nobody reviews what they pick — so for them the same reason is a wall
// (ADR-0030 §1). That is the only difference, and it is one flag, not a second
// rule set. Two rule sets would drift.
//
// Three rules, in this order, and the order is load-bearing:
//
//   1. VISIBILITY — absolute, asked FIRST, and never bypassed by the editor
//      flag. Taking an Assignment writes you into `participantIds`, which is
//      what grants sight of the Event, so a member who could take a place they
//      cannot see would be handing themselves the elders' diary (ADR-0030 §4).
//      Asked first for a second reason: somebody refused at the rung must not be
//      told the Role wanted a woman. They should learn nothing about it at all.
//
//   2. THE ROLE'S OWN RULES — refuse a member, advise an editor.
//
//   3. YOUR OWN AWAY — a warning, and you go through. ADR-0023 makes Away
//      absolute to the machine because it is a fact a Person asserted about
//      their own life, and a program overriding it is disbelief rather than
//      judgement. When the person overruling it IS that person, there is nothing
//      to disbelieve: they are changing their mind (ADR-0030 §3).
//
// Loaded as a classic <script> (window.CoverCore) and exported for Node tests.

(function (global) {
    'use strict';

    const Roles = (typeof require !== 'undefined')
        ? require('./roles-core.js')
        : global.RolesCore;
    const Occurrences = (typeof require !== 'undefined')
        ? require('./events-occurrence-core.js')
        : global.EventsOccurrenceCore;

    // The one reason this module owns. Everything else it reports is a
    // `RolesCore.REASONS` value passed straight through, so a caller has one
    // vocabulary to render rather than a translation layer.
    const REASONS = Object.freeze({
        NOT_VISIBLE: 'notVisible',
    });

    // Rules about who may be SEEN never bend — not for an editor, not for
    // anybody (ADR-0021 §1). Everything else in `RolesCore.REASONS` is a rule
    // about the roster, and those are the ones the editor flag softens.
    const ABSOLUTE = Object.freeze([Roles.REASONS.INACTIVE]);

    // A one-off Role is a label and some people: no definition, no slots, no
    // restrictions and no eligibility checking (ADR-0018 §4). Judging one still
    // has to run the two absolute rules, so rather than branching around
    // `candidatesFor` we hand it a definition that can only ever return those.
    const ONE_OFF_DEF = Object.freeze({
        id: null,
        name: 'One-off',
        slots: [{ id: 'one_off', requirement: Roles.REQUIREMENTS.EITHER }],
        restrictions: [],
    });
    const ONE_OFF_SLOT = Object.freeze({
        id: 'one_off', requirement: Roles.REQUIREMENTS.EITHER,
    });

    // Ask RolesCore about exactly one Person. `candidatesFor` judges a whole
    // list; narrowing the list to one is cheaper than duplicating the rules.
    function reasonFor(def, slot, person, context) {
        const results = Roles.candidatesFor(def, slot, Object.assign({}, context, {
            people: [person],
        }));
        const verdict = results[0];
        return (verdict && !verdict.eligible) ? verdict : null;
    }

    // ── The question ─────────────────────────────────────────────────────────
    //
    //   rank       — the asker's Permission Level.
    //   person     — their Person record.
    //   occurrence — the Event occurrence the Assignment sits on.
    //   roleDef    — the Role definition, or null for a one-off Role.
    //   slot       — the slot being taken, or null for a one-off Role.
    //   context    — as `RolesCore.candidatesFor` takes it, plus `awayPersonIds`
    //                for THIS date.
    //   asEditor   — soften the roster rules to advice. Rules about who may be
    //                seen are unaffected.
    //
    // Returns { permitted, reason, warning, detail }:
    //   reason  — why they may not, or null.
    //   warning — what they should know but may proceed past, or null.
    //   detail  — the rest of the RolesCore reason object (tagId, groupName,
    //             conflictsWith…) so a surface can name the actual clash.
    function verdictFor(spec) {
        const s = spec || {};
        const person = s.person || {};
        const context = s.context || {};

        const refused = (reason, detail) => ({
            permitted: false, reason: reason, warning: null, detail: detail || null,
        });
        const allowed = (warning, detail) => ({
            permitted: true, reason: null, warning: warning || null, detail: detail || null,
        });

        // 1. The rung, first and absolutely. Fails closed — `canSee` already
        //    refuses an occurrence with no visibility or an unrecognised one.
        if (!Occurrences.canSee(s.rank, s.occurrence, person.id)) {
            return refused(REASONS.NOT_VISIBLE);
        }

        const isOneOff = !s.roleDef;
        const def = isOneOff ? ONE_OFF_DEF : s.roleDef;
        const slot = isOneOff ? ONE_OFF_SLOT : s.slot;
        // A one-off has no roster to clash with, so the two list-shaped inputs
        // are dropped rather than being asked to mean something here.
        const ctx = isOneOff
            ? Object.assign({}, context, { assigned: [], assignedElsewhere: [] })
            : context;

        const blocked = reasonFor(def, slot, person, ctx);
        if (!blocked) return allowed();

        if (ABSOLUTE.indexOf(blocked.reason) !== -1) {
            return refused(blocked.reason, rest(blocked));
        }

        // 2. Their own Away — but only if it is the WHOLE story.
        //
        // ⚠ `ineligibilityFor` returns the FIRST reason and checks Away second,
        // right after Inactive. So a man who is also away, judged against a slot
        // wanting a woman, comes back as `away`. Waving that through on the
        // strength of the Away rule would seat him in a place the Role refuses.
        // Asking again without their Away is what separates "away, and otherwise
        // fine" from "away, and also ineligible".
        if (blocked.reason === Roles.REASONS.AWAY) {
            const alsoBlocked = reasonFor(def, slot, person, Object.assign({}, ctx, {
                awayPersonIds: (ctx.awayPersonIds || []).filter(id => id !== person.id),
            }));
            if (!alsoBlocked) return allowed(Roles.REASONS.AWAY);
            if (ABSOLUTE.indexOf(alsoBlocked.reason) !== -1) {
                return refused(alsoBlocked.reason, rest(alsoBlocked));
            }
            return s.asEditor
                ? allowed(alsoBlocked.reason, rest(alsoBlocked))
                : refused(alsoBlocked.reason, rest(alsoBlocked));
        }

        // 3. A rule about the roster. The editor is overruling themselves and
        //    may; the member is overruling the church and may not.
        return s.asEditor
            ? allowed(blocked.reason, rest(blocked))
            : refused(blocked.reason, rest(blocked));
    }

    // Everything the reason carried beyond its name — the tag, the group, the
    // person they clash with — so a surface can say which rather than that.
    function rest(blocked) {
        const detail = Object.assign({}, blocked);
        delete detail.reason;
        delete detail.personId;
        delete detail.eligible;
        return Object.keys(detail).length ? detail : null;
    }

    const CoverCore = {
        REASONS,
        verdictFor,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = CoverCore;
    } else {
        global.CoverCore = CoverCore;
    }
}(typeof window !== 'undefined' ? window : globalThis));
