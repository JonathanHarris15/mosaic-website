// Roles Core — the pure model for Roles (ADR-0016, MS-13).
//
// All serving participation is a Role, recorded as Involvement. Roles come in
// two families:
//
//   • liturgical — preacher, service leader, worship leader… Code-defined and
//                  LOCKED: undeletable, uneditable, and still wired into the
//                  Service entity and the Service Guide. They have no editable
//                  definition. (The registry lands in MS-25.)
//   • servant    — kids, setup/teardown, coffee, sound… Authored by an editor
//                  in the Roles Manager as a Role Definition.
//
// A Role Definition is name + ordered slots + restriction rules (MS-24). Each
// slot requires male, female, or either; needing three people means three
// slots. The slot — not a count beside a sex rule — is the unit of assignment,
// so a specific person can be pinned to a specific slot.
//
// Slot ids are stable and never re-issued. An assignment points at a slot id,
// so recycling one would silently inherit the previous slot's person.
//
// Loaded as a classic <script> (window.RolesCore) and exported for Node tests.

(function (global) {
    'use strict';

    // ── The two families ──────────────────────────────────────────────────────

    const FAMILIES = Object.freeze({
        LITURGICAL: 'liturgical',
        SERVANT: 'servant',
    });

    // ── What a slot requires of the person filling it ─────────────────────────

    const REQUIREMENTS = Object.freeze({
        MALE: 'male',
        FEMALE: 'female',
        EITHER: 'either',
    });

    const REQUIREMENT_VALUES = Object.freeze([
        REQUIREMENTS.MALE,
        REQUIREMENTS.FEMALE,
        REQUIREMENTS.EITHER,
    ]);

    function isRequirement(value) {
        return REQUIREMENT_VALUES.indexOf(value) !== -1;
    }

    // ── The locked, code-defined liturgical Roles ─────────────────────────────
    //
    // These six are the `type` values the app already writes as Involvement.
    // They stay locked (ADR-0016 §1, Option A): unifying the CONCEPT of a Role
    // costs nothing, but making these editable data would mean rebuilding the
    // Service entity and the Service Guide component system — destabilising the
    // artefact that has to print correctly every Sunday.
    //
    // The names are user-facing strings the guide and calendar already render.
    // Changing one here silently changes the printed booklet.
    const LITURGICAL_ROLES = Object.freeze([
        { slug: 'service_leader', name: 'Service Leader' },
        { slug: 'preacher', name: 'Preacher' },
        { slug: 'worship_leader', name: 'Music Leader' },
        { slug: 'worship_helper', name: 'Music Helper' },
        { slug: 'sermonette', name: 'Sermonette' },
        { slug: 'prayer', name: 'Prayer' },
    ].map(role => Object.freeze(Object.assign({}, role, {
        family: FAMILIES.LITURGICAL,
        locked: true,
    }))));

    const LITURGICAL_SLUGS = Object.freeze(LITURGICAL_ROLES.map(r => r.slug));

    // A Role is locked when it is one of the code-defined liturgical ones. Locked
    // Roles have no editable definition — no slots, no restrictions — because
    // they are assigned through the Service entity, as they always have been.
    function isLocked(role) {
        return !!role && (role.locked === true || role.family === FAMILIES.LITURGICAL);
    }

    function assertEditable(role) {
        if (isLocked(role)) {
            throw new Error(
                'Role "' + ((role && role.name) || '?') + '" is locked: liturgical Roles are ' +
                'code-defined and cannot be edited.'
            );
        }
    }

    function assertDeletable(role) {
        if (isLocked(role)) {
            throw new Error(
                'Role "' + ((role && role.name) || '?') + '" is locked: liturgical Roles are ' +
                'always present and cannot be deleted.'
            );
        }
    }

    // Involvement records a Role by slug, so a Servant Role needs one too. It is
    // derived from the name ONCE, at creation, and then stored — renaming the
    // Role afterwards must not change the slug, or every Involvement record
    // already written under the old one would be orphaned.
    function slugify(name) {
        return String(name || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    const slugOf = def => (def && def.slug) || slugify(def && def.name);

    // Every Role that exists, both families, liturgical first. This is the single
    // list the Roles Manager and the Roles tab render — the whole point of
    // Option A is that the user sees one roles list, not two.
    function allRoles(servantDefinitions) {
        const servant = (servantDefinitions || []).map(def => {
            const slug = slugOf(def);
            if (LITURGICAL_SLUGS.indexOf(slug) !== -1) {
                throw new Error(
                    'Servant Role "' + def.name + '" would take the liturgical slug "' + slug +
                    '", which would mix its Involvement history with the liturgical Role\'s.'
                );
            }
            return Object.assign({}, def, { slug: slug, family: FAMILIES.SERVANT, locked: false });
        });
        return LITURGICAL_ROLES.concat(servant);
    }

    function roleBySlug(slug, servantDefinitions) {
        return allRoles(servantDefinitions).find(role => role.slug === slug) || null;
    }

    // ── Slot identity ─────────────────────────────────────────────────────────

    // Slot ids are `s<n>`. The next one is one past the highest `n` ever used in
    // this definition — not `slots.length + 1`, which would re-issue the id of a
    // removed middle slot and hand its assignments to a brand-new slot.
    function nextSlotId(def) {
        const highest = (def && def.slots ? def.slots : []).reduce((max, slot) => {
            const n = parseInt(String(slot && slot.id).replace(/^s/, ''), 10);
            return Number.isFinite(n) && n > max ? n : max;
        }, 0);
        return 's' + (highest + 1);
    }

    // ── Reading a definition ──────────────────────────────────────────────────

    const slotsOf = def => (def && Array.isArray(def.slots) ? def.slots : []);

    // The ordered slot ids — the order an editor authored, which the Roles tab
    // renders and auto-assign fills in turn.
    function slotOrder(def) {
        return slotsOf(def).map(slot => slot.id);
    }

    // How many people this Role needs: one per slot.
    function slotCount(def) {
        return slotsOf(def).length;
    }

    // ── Building a definition ─────────────────────────────────────────────────

    // A fresh Servant Role Definition: named, with a single either-slot so it is
    // valid the moment it is created and the editor can narrow it from there.
    function newDefinition(name) {
        return {
            name: name,
            slug: slugify(name),
            family: FAMILIES.SERVANT,
            slots: [{ id: 's1', requirement: REQUIREMENTS.EITHER }],
            restrictions: [],
        };
    }

    // Every mutator returns a new definition; none touches its input, so a UI can
    // hold the previous value for cancel/undo. Each refuses a locked Role: the
    // guard lives here, in the model, so a UI that forgets to hide the edit
    // controls still cannot rewrite a liturgical Role.
    function withSlots(def, slots) {
        return Object.assign({}, def, { slots: slots });
    }

    function addSlot(def, requirement) {
        assertEditable(def);
        if (!isRequirement(requirement)) {
            throw new Error('Unknown slot requirement: ' + requirement);
        }
        return withSlots(def, slotsOf(def).concat([
            { id: nextSlotId(def), requirement: requirement },
        ]));
    }

    function removeSlot(def, slotId) {
        assertEditable(def);
        return withSlots(def, slotsOf(def).filter(slot => slot.id !== slotId));
    }

    function setSlotRequirement(def, slotId, requirement) {
        assertEditable(def);
        if (!isRequirement(requirement)) {
            throw new Error('Unknown slot requirement: ' + requirement);
        }
        return withSlots(def, slotsOf(def).map(slot => (
            slot.id === slotId ? Object.assign({}, slot, { requirement: requirement }) : slot
        )));
    }

    // Move the slot at `from` to sit at `to`. Identity and requirement travel
    // with the slot — reordering re-sequences, it never rewrites a slot.
    function reorderSlots(def, from, to) {
        assertEditable(def);
        const slots = slotsOf(def);
        const inRange = i => Number.isInteger(i) && i >= 0 && i < slots.length;
        if (!inRange(from) || !inRange(to) || from === to) return withSlots(def, slots.slice());

        const next = slots.slice();
        next.splice(to, 0, next.splice(from, 1)[0]);
        return withSlots(def, next);
    }

    // ── Restrictions: who may fill a slot ─────────────────────────────────────
    //
    // Rules are written against data that already exists — Shepherding Tags and
    // the Relationship graph — so a church configures serving with the same
    // vocabulary it already uses for everything else.

    const RESTRICTIONS = Object.freeze({
        REQUIRE_TAG: 'requireTag',      // only people carrying the Tag
        EXCLUDE_TAG: 'excludeTag',      // nobody carrying the Tag
        NOT_TOGETHER: 'notTogether',    // no two people joined by a Relationship Type
    });

    // Why somebody was passed over. The Roles tab and auto-assign both have to
    // explain themselves, so ineligibility is always a reason, never a silent
    // omission from the list.
    const REASONS = Object.freeze({
        INACTIVE: 'inactive',
        ALREADY_ASSIGNED: 'alreadyAssigned',
        SEX_MISMATCH: 'sexMismatch',
        SEX_UNKNOWN: 'sexUnknown',
        MISSING_REQUIRED_TAG: 'missingRequiredTag',
        EXCLUDED_BY_TAG: 'excludedByTag',
        RELATIONSHIP_CONFLICT: 'relationshipConflict',
    });

    // An Inactive Person carries no Membership Stage and is off the Track, so
    // they are never proposed — while every Involvement record they already have
    // stays exactly as it was. Reads the current flag and the status value it
    // replaced, so eligibility is right before every record is migrated.
    function isInactive(person) {
        const m = (person && person.membership) || {};
        return m.inactive === true || m.status === 'inactive';
    }

    function carriesTag(person, tagId) {
        return ((person && person.tags) || []).indexOf(tagId) !== -1;
    }

    // Is there an edge of this Relationship Type between the two? Edges are
    // stored one way round (`fromId` is the priority holder), but "may not serve
    // together" is symmetric, so both orientations count.
    function joinedBy(relationships, typeId, a, b) {
        return (relationships || []).some(edge => (
            edge.typeId === typeId && (
                (edge.fromId === a && edge.toId === b) ||
                (edge.fromId === b && edge.toId === a)
            )
        ));
    }

    const restrictionsOf = def => (def && Array.isArray(def.restrictions) ? def.restrictions : []);

    // Judge one Person against one slot. Returns `null` when they may fill it,
    // or the reason they may not. Ordered most-fundamental first, so the user is
    // told the real cause — being Inactive explains everything else about them.
    function ineligibilityFor(def, slot, candidate, context) {
        const seated = (context.assigned || []).filter(a => a.slotId !== slot.id);

        if (isInactive(candidate)) return { reason: REASONS.INACTIVE };

        if (seated.some(a => a.personId === candidate.id)) {
            return { reason: REASONS.ALREADY_ASSIGNED };
        }

        const requirement = slot && slot.requirement;
        if (requirement !== REQUIREMENTS.EITHER) {
            if (!candidate.sex) return { reason: REASONS.SEX_UNKNOWN };
            if (candidate.sex !== requirement) return { reason: REASONS.SEX_MISMATCH };
        }

        for (const rule of restrictionsOf(def)) {
            if (rule.kind === RESTRICTIONS.REQUIRE_TAG && !carriesTag(candidate, rule.tagId)) {
                return { reason: REASONS.MISSING_REQUIRED_TAG, tagId: rule.tagId };
            }
            if (rule.kind === RESTRICTIONS.EXCLUDE_TAG && carriesTag(candidate, rule.tagId)) {
                return { reason: REASONS.EXCLUDED_BY_TAG, tagId: rule.tagId };
            }
            if (rule.kind === RESTRICTIONS.NOT_TOGETHER) {
                const clash = seated.find(a => joinedBy(
                    context.relationships, rule.typeId, candidate.id, a.personId
                ));
                if (clash) {
                    return {
                        reason: REASONS.RELATIONSHIP_CONFLICT,
                        typeId: rule.typeId,
                        conflictsWith: clash.personId,
                    };
                }
            }
            // A rule kind we don't know is skipped rather than treated as a
            // blanket exclusion — a typo in the config must not empty the list.
        }

        return null;
    }

    // Judge every candidate for one slot of one Role on one Event.
    //
    //   people        — the candidates, in the order to show them
    //   relationships — the pairwise edges (for NOT_TOGETHER)
    //   assigned      — [{ slotId, personId }] already seated in THIS Role on
    //                   THIS Event. Scoped that way on purpose: serving another
    //                   Role the same morning is not this Role's business.
    //
    // Everybody comes back, eligible or not, so the UI can grey people out with
    // a reason rather than quietly dropping them.
    function candidatesFor(def, slot, context) {
        const ctx = context || {};
        return (ctx.people || []).map(candidate => {
            const blocked = ineligibilityFor(def, slot, candidate, ctx);
            return Object.assign(
                { personId: candidate.id, eligible: !blocked, reason: null },
                blocked || {}
            );
        });
    }

    // ── Validation ────────────────────────────────────────────────────────────

    // Returns every problem at once rather than the first — the Roles Manager
    // shows them together instead of making the editor fix one, save, repeat.
    function validateDefinition(def) {
        const errors = [];

        const name = def && typeof def.name === 'string' ? def.name.trim() : '';
        if (!name) errors.push('A Role needs a name.');

        // Only liturgical Roles carry the locked family, and they are defined in
        // code — a stored definition claiming it would forge an undeletable Role.
        if (def && def.family !== FAMILIES.SERVANT) {
            errors.push('A Role Definition must belong to the servant family; liturgical Roles are code-defined.');
        }

        const slots = slotsOf(def);
        if (slots.length === 0) {
            errors.push('A Role needs at least one slot.');
        }

        const seen = new Set();
        slots.forEach((slot, i) => {
            const position = 'Slot ' + (i + 1);
            if (!slot || !slot.id) {
                errors.push(position + ' needs an id.');
            } else if (seen.has(slot.id)) {
                errors.push(position + ' repeats the slot id "' + slot.id + '".');
            } else {
                seen.add(slot.id);
            }
            if (!slot || !isRequirement(slot.requirement)) {
                errors.push(position + ' needs a requirement of male, female, or either.');
            }
        });

        return { valid: errors.length === 0, errors: errors };
    }

    const RolesCore = {
        // vocabulary
        FAMILIES,
        REQUIREMENTS,
        REQUIREMENT_VALUES,
        RESTRICTIONS,
        REASONS,
        LITURGICAL_ROLES,
        LITURGICAL_SLUGS,
        isRequirement,
        // the registry: both families, one list
        allRoles,
        roleBySlug,
        isLocked,
        assertEditable,
        assertDeletable,
        slugify,
        // eligibility
        isInactive,
        candidatesFor,
        // reading
        slotOrder,
        slotCount,
        nextSlotId,
        // building
        newDefinition,
        addSlot,
        removeSlot,
        setSlotRequirement,
        reorderSlots,
        // validation
        validateDefinition,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = RolesCore;
    }
    if (global) {
        global.RolesCore = RolesCore;
    }
})(typeof window !== 'undefined' ? window : null);
