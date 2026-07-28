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
            family: FAMILIES.SERVANT,
            slots: [{ id: 's1', requirement: REQUIREMENTS.EITHER }],
            restrictions: [],
        };
    }

    // Every mutator returns a new definition; none touches its input, so a UI can
    // hold the previous value for cancel/undo.
    function withSlots(def, slots) {
        return Object.assign({}, def, { slots: slots });
    }

    function addSlot(def, requirement) {
        if (!isRequirement(requirement)) {
            throw new Error('Unknown slot requirement: ' + requirement);
        }
        return withSlots(def, slotsOf(def).concat([
            { id: nextSlotId(def), requirement: requirement },
        ]));
    }

    function removeSlot(def, slotId) {
        return withSlots(def, slotsOf(def).filter(slot => slot.id !== slotId));
    }

    function setSlotRequirement(def, slotId, requirement) {
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
        const slots = slotsOf(def);
        const inRange = i => Number.isInteger(i) && i >= 0 && i < slots.length;
        if (!inRange(from) || !inRange(to) || from === to) return withSlots(def, slots.slice());

        const next = slots.slice();
        next.splice(to, 0, next.splice(from, 1)[0]);
        return withSlots(def, next);
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
        isRequirement,
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
