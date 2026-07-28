// Relationship Core — the pure model for the elder-only Relationship graph
// (ADR-0012, MS-89; enriched by ADR-0014, MS-97).
//
// A Pairwise Relationship is a person-to-person edge `{ fromId, toId, typeId }`
// carrying a Relationship Type. Since MS-97 a Relationship Type is a structure
// with two axes rather than a name plus a `directional` flag:
//
//   • kind     — 'pairwise' (connects two Persons) or 'group' (a roster of many).
//                Immutable once the type is created.
//   • priority — Prioritized or Non-Prioritized. A Prioritized type names two
//                asymmetric roles; a Non-Prioritized type names one symmetric
//                label. `priority` is the enriched successor of `directional`.
//
// The 2x2 yields four stored label shapes:
//
//   pairwise + prioritized      -> { holderLabel, counterpartLabel }  (Discipler / Disciplee)
//   pairwise + non-prioritized  -> { label }                          (Friend)
//   group    + prioritized      -> { leaderLabel, memberLabel }       (Leader / Member)
//   group    + non-prioritized  -> { label }                          (Participant)
//
// When a type is Prioritized, `fromId` is the priority holder — the same
// convention the retired `directional` flag used, so existing edges need no
// rewrite. Rosters for Group-kind types live in RelationshipGroupCore.
//
// This module also owns the pure `directional` -> kind x priority migration, so
// the backfill script and its tests share one source of truth, and it reads
// legacy docs defensively (ADR-0014 s6) so the app works before the backfill runs.
//
// Surfaced only on the Shepherding Profile — never in the member-facing
// directory. Loaded as a classic <script> (window.RelationshipCore) and exported
// for Node tests.

(function (global) {
    'use strict';

    // ── The two axes ──────────────────────────────────────────────────────────

    const KINDS = { PAIRWISE: 'pairwise', GROUP: 'group' };
    const KIND_VALUES = [KINDS.PAIRWISE, KINDS.GROUP];

    // The role keys a type exposes, per kind x priority. A Prioritized type has
    // two asymmetric sides; a Non-Prioritized type has a single symmetric one.
    // Frozen: this is the shared role model, and it is exported.
    const SIDES = Object.freeze({
        pairwise: Object.freeze({
            prioritized: Object.freeze(['holder', 'counterpart']),
            symmetric: Object.freeze(['peer']),
        }),
        group: Object.freeze({
            prioritized: Object.freeze(['leader', 'member']),
            symmetric: Object.freeze(['member']),
        }),
    });

    // Which stored label field each side of a Prioritized type reads from.
    // (Non-Prioritized types collapse to the single symmetric `label`.)
    const SIDE_LABEL_FIELD = {
        holder: 'holderLabel',
        counterpart: 'counterpartLabel',
        leader: 'leaderLabel',
        member: 'memberLabel',
    };

    function isNonEmptyString(v) {
        return typeof v === 'string' && v.trim().length > 0;
    }

    // ── Reading legacy docs (ADR-0014 s6) ─────────────────────────────────────

    // A type doc predates MS-97 if it carries no `kind`.
    function needsMigration(doc) {
        return !!doc && typeof doc === 'object' && !KIND_VALUES.includes(doc.kind);
    }

    // Pure, idempotent mapping from a legacy type doc to the enriched shape.
    // Legacy docs are all pairwise and carry `{ name, directional }`:
    //
    //   directional: true  -> priority: true,  holderLabel = counterpartLabel = name
    //   directional: false -> priority: false, label = name
    //
    // Seeding both role labels from the one old name is lossy on purpose: there
    // was only ever one label to work with, and it stands in until an elder gives
    // the type real role names in the manager. The retired `directional` field is
    // dropped; the backfill removes it from Firestore with FieldValue.delete().
    function migrateTypeDoc(oldDoc) {
        if (!oldDoc || typeof oldDoc !== 'object') return oldDoc;
        if (!needsMigration(oldDoc)) return { ...oldDoc };

        const { directional, ...rest } = oldDoc;
        const name = oldDoc.name || '';
        if (directional === true) {
            return { ...rest, kind: KINDS.PAIRWISE, priority: true, holderLabel: name, counterpartLabel: name };
        }
        return { ...rest, kind: KINDS.PAIRWISE, priority: false, label: name };
    }

    // Every read path goes through this, so a not-yet-backfilled type behaves
    // exactly like a migrated one. An already-enriched type is returned as-is —
    // the read paths call this many times per edge, and copying each time would
    // allocate thousands of throwaway objects across a Relations Viewer render.
    function normalizeType(type) {
        if (!type || typeof type !== 'object') return type;
        return needsMigration(type) ? migrateTypeDoc(type) : type;
    }

    // ── Shared with Editors (MS-128) ──────────────────────────────────────────
    //
    // The Relationship graph is elder-only (ADR-0013, ADR-0014). Serving
    // restrictions ("no married couple in Kids") need an editor to see some of
    // it, so elders open the door one Relationship Type at a time.
    //
    // This is a disclosure boundary, so it fails closed: nothing is shared
    // unless the stored value is the boolean `true`. A truthy string out of a
    // form, a 1 out of a checkbox, or a missing field all read as NOT shared —
    // being loose here leaks who is being discipled and who is in which care
    // group to every editor account, and that cannot be undone.
    function isSharedWithEditors(type) {
        return !!type && type.sharedWithEditors === true;
    }

    // The Types an editor who is not an elder may see. The client must ALSO
    // constrain its Firestore query to shared Types: rules are evaluated per
    // returned document, so an unconstrained query fails outright rather than
    // returning fewer rows. This filter is the in-memory half of that pair.
    function sharedTypes(types) {
        return (types || []).filter(isSharedWithEditors);
    }

    // The doc as it should be STORED for its current kind x priority shape, with
    // the label fields the shape doesn't use stripped out. Editing a Prioritized
    // type down to Non-Prioritized otherwise leaves its old role labels lying in
    // the doc, ready to silently resurrect if it is ever flipped back.
    function canonicalType(def) {
        if (!def || typeof def !== 'object') return def;
        const t = normalizeType(def);
        const base = { ...t };
        delete base.holderLabel;
        delete base.counterpartLabel;
        delete base.leaderLabel;
        delete base.memberLabel;
        delete base.label;
        delete base.directional; // retired (ADR-0014 s1)

        // Always state the sharing decision (MS-128). A stored Type that leaves
        // this undefined would force the security rule to tell "absent" from
        // "false" — and a rule that has to make that distinction is a rule
        // waiting to be got wrong. Normalises DOWN to false, never up.
        base.sharedWithEditors = isSharedWithEditors(t);

        if (!t.priority) return { ...base, label: t.label || '' };
        if (t.kind === KINDS.GROUP) {
            return { ...base, leaderLabel: t.leaderLabel || '', memberLabel: t.memberLabel || '' };
        }
        return { ...base, holderLabel: t.holderLabel || '', counterpartLabel: t.counterpartLabel || '' };
    }

    // ── Introspection ─────────────────────────────────────────────────────────

    // The ordered role keys a type exposes: the two asymmetric sides when
    // Prioritized (holder before counterpart, leader before member), otherwise
    // the single symmetric side.
    function sidesForType(type) {
        const t = normalizeType(type);
        const shape = t && SIDES[t.kind];
        if (!shape) return [];
        return t.priority ? shape.prioritized.slice() : shape.symmetric.slice();
    }

    // The label a Person on `side` reads as. A Non-Prioritized type is symmetric,
    // so every side collapses to its single `label` and `side` is irrelevant.
    function labelForSide(type, side) {
        const t = normalizeType(type);
        if (!t) return '';
        if (!t.priority) return t.label || '';
        const field = SIDE_LABEL_FIELD[side];
        return (field && t[field]) || '';
    }

    // The opposite role. A Non-Prioritized type is symmetric, so a side is its
    // own opposite.
    function oppositeSide(type, side) {
        const t = normalizeType(type);
        if (!t || !t.priority) return side;
        const pair = SIDES[t.kind] && SIDES[t.kind].prioritized;
        if (!pair) return side;
        const i = pair.indexOf(side);
        return i === -1 ? side : pair[i === 0 ? 1 : 0];
    }

    // Which side holds priority — draws the arrowhead, or leads the group.
    // Null for a Non-Prioritized type: nobody holds priority.
    function priorityHolderSide(type) {
        const t = normalizeType(type);
        if (!t || !t.priority) return null;
        return t.kind === KINDS.GROUP ? 'leader' : 'holder';
    }

    // ── Rendering ─────────────────────────────────────────────────────────────

    // The oriented one-line reading of a Prioritized Pairwise Relationship. Reads
    // identically from either end — it describes the edge, not the viewer.
    //
    // When both role labels are the same string the type has not been given real
    // role names yet — that is exactly the state the backfill leaves a migrated
    // legacy type in (holderLabel = counterpartLabel = the old name, which was a
    // verb: "mentors"). Rendering that as "Alice (mentors) -> Bob (mentors)" is
    // strictly worse than what it replaced, so an un-differentiated type falls
    // back to reading as the verb phrase it has always been. Once an elder gives
    // the type distinct role labels, it reads with them.
    function orientedSentence(type, holderName, counterpartName) {
        const t = normalizeType(type);
        if (!t || !t.priority) return null;
        const holderSide = priorityHolderSide(t);
        const holderLabel = labelForSide(t, holderSide);
        const counterpartLabel = labelForSide(t, oppositeSide(t, holderSide));
        // A Prioritized type with a missing role label is malformed (validateType
        // rejects it), but a defensive read can still meet one. There is no
        // sentence to build from a blank role, so fall back to no sentence at all
        // and let the panel show the type name plus the other Person.
        if (!holderLabel || !counterpartLabel) return null;
        if (holderLabel === counterpartLabel) {
            return `${holderName} ${holderLabel} ${counterpartName}`;
        }
        return `${holderName} (${holderLabel}) → ${counterpartName} (${counterpartLabel})`;
    }

    // Every edge touching a Person (as either end).
    function edgesForPerson(relationships, personId) {
        if (!personId) return [];
        return (relationships || []).filter(r => r.fromId === personId || r.toId === personId);
    }

    // How a Pairwise Relationship reads on `viewerId`'s profile:
    //
    //   { otherId, typeName, prioritized, viewerSide, viewerLabel,
    //     otherSide, otherLabel, sentence, directional }
    //
    // A Prioritized type carries an oriented `sentence` (identical on both ends);
    // a Non-Prioritized one has `sentence: null` and the UI shows `typeName` plus
    // the other Person. `nameOf(id)` resolves a display name.
    //
    // `directional` is a deprecated alias of `prioritized`, kept only so the
    // not-yet-reworked profile panels (shepherding-profile.html, mobile
    // screens-shepherd.js) keep rendering during rollout. Remove it once MS-104
    // and MS-106 have moved those surfaces onto `prioritized`.
    function describeRelationship(edge, type, viewerId, nameOf) {
        if (!edge) return null;
        // The viewer must actually be one end of the edge, or every side and label
        // below is a guess. Callers reach here through edgesForPerson, so this only
        // fires on a stale personId (say, after a merge) — better to say nothing
        // than to label an uninvolved Person as the Disciplee.
        const viewerIsHolder = edge.fromId === viewerId;
        if (!viewerIsHolder && edge.toId !== viewerId) return null;

        const t = normalizeType(type) || { name: '(type)', kind: KINDS.PAIRWISE, priority: false, label: '(type)' };
        const otherId = viewerIsHolder ? edge.toId : edge.fromId;
        const name = nameOf || (id => id);

        const prioritized = !!t.priority;
        const viewerSide = prioritized ? (viewerIsHolder ? 'holder' : 'counterpart') : 'peer';
        const otherSide = oppositeSide(t, viewerSide);

        return {
            otherId,
            typeName: t.name,
            prioritized,
            directional: prioritized, // deprecated alias — see above
            viewerSide,
            viewerLabel: labelForSide(t, viewerSide),
            otherSide,
            otherLabel: labelForSide(t, otherSide),
            sentence: prioritized
                ? orientedSentence(t, name(edge.fromId), name(edge.toId))
                : null,
        };
    }

    // ── Validation ────────────────────────────────────────────────────────────

    // Validate a Relationship Type definition against its kind x priority shape.
    // Returns { valid, errors }.
    function validateType(def) {
        if (!def || typeof def !== 'object') {
            return { valid: false, errors: ['type definition is missing'] };
        }
        const errors = [];

        if (!isNonEmptyString(def.name)) errors.push('name is required');
        if (!KIND_VALUES.includes(def.kind)) {
            errors.push(`kind must be one of ${KIND_VALUES.join(', ')}`);
        }
        if (typeof def.priority !== 'boolean') errors.push('priority must be a boolean');

        // Rejected rather than coerced: a truthy string silently becoming `true`
        // is how a disclosure boundary opens by accident (MS-128).
        if (def.sharedWithEditors !== undefined && typeof def.sharedWithEditors !== 'boolean') {
            errors.push('sharedWithEditors must be a boolean');
        }

        if (def.priority === true) {
            if (def.kind === KINDS.PAIRWISE) {
                if (!isNonEmptyString(def.holderLabel)) errors.push('a Prioritized Pairwise type requires a Holder Label');
                if (!isNonEmptyString(def.counterpartLabel)) errors.push('a Prioritized Pairwise type requires a Counterpart Label');
            } else if (def.kind === KINDS.GROUP) {
                if (!isNonEmptyString(def.leaderLabel)) errors.push('a Prioritized Group type requires a Leader Label');
                if (!isNonEmptyString(def.memberLabel)) errors.push('a Prioritized Group type requires a Member Label');
            }
        } else if (def.priority === false) {
            if (!isNonEmptyString(def.label)) errors.push('a Non-Prioritized type requires a Label');
        }

        return { valid: errors.length === 0, errors };
    }

    // Guard an edit to an existing type. Priority and labels are freely editable;
    // `kind` is not — flipping it would orphan every instance (ADR-0014 s1).
    function validateEdit(existing, next) {
        const errors = [];
        if (existing && next && next.kind != null && next.kind !== existing.kind) {
            errors.push('kind is immutable once a type is created');
        }
        const shape = validateType({ ...existing, ...next });
        return { valid: errors.length === 0 && shape.valid, errors: errors.concat(shape.errors) };
    }

    // Find a reusable Relationship Type by case-insensitive name, or null if it's
    // genuinely new.
    function findTypeByName(types, name) {
        const n = (name || '').trim().toLowerCase();
        if (!n) return null;
        return (types || []).find(t => (t.name || '').toLowerCase() === n) || null;
    }

    const RelationshipCore = {
        KINDS,
        KIND_VALUES,
        SIDES,
        // reading
        edgesForPerson,
        describeRelationship,
        findTypeByName,
        // the kind x priority model
        sidesForType,
        labelForSide,
        oppositeSide,
        priorityHolderSide,
        orientedSentence,
        // sharing with editors (MS-128)
        isSharedWithEditors,
        sharedTypes,
        // validation
        validateType,
        validateEdit,
        canonicalType,
        // migration
        needsMigration,
        migrateTypeDoc,
        normalizeType,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = RelationshipCore;
    }
    if (global) {
        global.RelationshipCore = RelationshipCore;
    }
})(typeof window !== 'undefined' ? window : null);
