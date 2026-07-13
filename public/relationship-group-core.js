// Relationship Group Core — the pure roster model for Relationship Groups
// (ADR-0014, MS-97).
//
// A Relationship Group is a Custom Relationship that is a named roster of a
// Group-kind Relationship Type — one record naming the group ("Tuesday Bible
// Study") and listing the Persons in it:
//
//   { id, typeId, name, leaderId | null, memberIds[] }
//
// If its type is Prioritized the group has a single leader (the priority holder)
// plus its members; if Non-Prioritized it is a flat roster with no leader. Both
// a leaderless group (the leader stepped down) and an empty one (freshly created)
// are valid resting states.
//
// A Person occupies at most one slot in a group — leader OR member, never both.
// The roster is therefore the leader plus the members, and the Relations Viewer
// draws the bubble around the members with a single line from the leader to the
// bubble itself (ADR-0014 s5), which is why the leader is not inside `memberIds`.
//
// Every operation is immutable: it returns a new group and leaves the input
// alone, so callers can diff before writing to Firestore.
//
// Distinct from a Care Group (an Elder's assigned People, derived from Elder
// Assignment) and from a Family. Loaded as a classic <script>
// (window.RelationshipGroupCore) and exported for Node tests.

(function (global) {
    'use strict';

    function membersOf(group) {
        return (group && Array.isArray(group.memberIds)) ? group.memberIds : [];
    }

    function isNonEmptyString(v) {
        return typeof v === 'string' && v.trim().length > 0;
    }

    // ── Roster operations ─────────────────────────────────────────────────────

    // Add a Person to the roster. A no-op if they already hold a slot — including
    // the leader's slot, which is not demoted by an add.
    function addMember(group, personId) {
        if (!group || !personId) return group;
        if (belongsTo(group, personId)) return { ...group, memberIds: membersOf(group).slice() };
        return { ...group, memberIds: membersOf(group).concat([personId]) };
    }

    // Pull a Person from the roster, leaving the remaining members in order. Does
    // not touch the leader slot — use clearLeader (or removePersonEverywhere).
    function removeMember(group, personId) {
        if (!group) return group;
        return { ...group, memberIds: membersOf(group).filter(id => id !== personId) };
    }

    // Promote a Person to leader, vacating any seat they held as a member and
    // standing down whoever led before — a group has at most one leader.
    function setLeader(group, personId) {
        if (!group || !personId) return group;
        return { ...group, leaderId: personId, memberIds: membersOf(group).filter(id => id !== personId) };
    }

    // Leave the group leaderless. The group survives — a Prioritized group may sit
    // without a leader while one steps down.
    function clearLeader(group) {
        if (!group) return group;
        return { ...group, leaderId: null, memberIds: membersOf(group).slice() };
    }

    // ── Membership queries ────────────────────────────────────────────────────

    function isLeader(group, personId) {
        return !!group && !!personId && group.leaderId === personId;
    }

    function isMember(group, personId) {
        return !!personId && membersOf(group).includes(personId);
    }

    // Does this Person hold any slot in the group — leading or not?
    function belongsTo(group, personId) {
        return isLeader(group, personId) || isMember(group, personId);
    }

    // Everyone in the group: the leader (if any) first, then the members.
    function rosterIds(group) {
        const members = membersOf(group).slice();
        return group && group.leaderId ? [group.leaderId].concat(members) : members;
    }

    // Every Relationship Group this Person belongs to, leading or not.
    function groupsForPerson(groups, personId) {
        if (!personId) return [];
        return (groups || []).filter(g => belongsTo(g, personId));
    }

    // ── The Relations Viewer's hull descriptor (ADR-0014 s5) ──────────────────

    // What the viewer needs to draw the group: a bubble around `memberIds` in
    // `colour`, labelled `name`, with one line from `leaderId` to the bubble
    // (omitted when the group is leaderless or its type is Non-Prioritized).
    function hullDescriptor(group, colour) {
        if (!group) return null;
        return {
            id: group.id,
            name: group.name,
            typeId: group.typeId,
            colour: colour || null,
            leaderId: group.leaderId || null,
            memberIds: membersOf(group).slice(),
        };
    }

    // ── Validation ────────────────────────────────────────────────────────────

    // Validate a group against its Relationship Type. Returns { valid, errors }.
    // Leaderless and empty rosters are deliberately valid.
    function validateGroup(group, type) {
        if (!group || typeof group !== 'object') {
            return { valid: false, errors: ['group is missing'] };
        }
        const errors = [];

        if (!isNonEmptyString(group.name)) errors.push('a Relationship Group requires a name');
        if (!isNonEmptyString(group.typeId)) errors.push('a Relationship Group requires a Relationship Type');
        if (!Array.isArray(group.memberIds)) errors.push('memberIds must be a list');

        if (type) {
            if (type.kind !== 'group') {
                errors.push('a Relationship Group requires a Group-kind Relationship Type');
            }
            // Nobody holds priority in a Non-Prioritized group, so nobody leads it.
            if (type.priority === false && group.leaderId) {
                errors.push('a Non-Prioritized Relationship Group cannot have a leader');
            }
        }

        if (group.leaderId && isMember(group, group.leaderId)) {
            errors.push('the leader cannot also sit in the member roster');
        }

        return { valid: errors.length === 0, errors };
    }

    // ── Person delete / merge cascade (ADR-0014 s7) ───────────────────────────

    // Remove a Person from every group: pull them from each roster and vacate any
    // leader slot they held. The groups themselves survive — a group that loses
    // its leader simply becomes leaderless.
    function removePersonEverywhere(groups, personId) {
        if (!personId) return (groups || []).slice();
        return (groups || []).map(g => {
            const withoutMember = removeMember(g, personId);
            return isLeader(g, personId) ? clearLeader(withoutMember) : withoutMember;
        });
    }

    const RelationshipGroupCore = {
        // roster operations
        addMember,
        removeMember,
        setLeader,
        clearLeader,
        // membership queries
        isLeader,
        isMember,
        belongsTo,
        rosterIds,
        groupsForPerson,
        // viewer
        hullDescriptor,
        // validation
        validateGroup,
        // lifecycle
        removePersonEverywhere,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = RelationshipGroupCore;
    }
    if (global) {
        global.RelationshipGroupCore = RelationshipGroupCore;
    }
})(typeof window !== 'undefined' ? window : null);
