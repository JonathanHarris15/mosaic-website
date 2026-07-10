// Relationship Core — the pure model for the elder-only Relationship graph
// (ADR-0012, MS-89).
//
// A Relationship is a person-to-person edge `{ fromId, toId, typeId }` carrying a
// Relationship Type — a reusable, elder-defined, optionally-directional label
// `{ id, name, directional }`. Directional types render ORIENTED the same way on
// both profiles ("Alice mentors Bob"); non-directional types render SYMMETRICALLY
// (the other person, labelled by the type — "Dating · Bob"). These pure helpers
// own that rendering so the profile UI stays dumb.
//
// Surfaced only on the Shepherding Profile — never in the member-facing
// directory. Loaded as a classic <script> (window.RelationshipCore) and exported
// for Node tests.

(function (global) {
    'use strict';

    // Every edge touching a Person (as either end).
    function edgesForPerson(relationships, personId) {
        if (!personId) return [];
        return (relationships || []).filter(r => r.fromId === personId || r.toId === personId);
    }

    // How an edge reads on `viewerId`'s profile.
    //   { otherId, typeName, directional, sentence }
    // For a directional type, `sentence` is the oriented phrase built from names
    // (same on both ends); for a symmetric type, `sentence` is null and the UI
    // shows `typeName` + the other person. `nameOf(id)` resolves a display name.
    function describeRelationship(edge, type, viewerId, nameOf) {
        const t = type || { name: '(type)', directional: false };
        const otherId = edge.fromId === viewerId ? edge.toId : edge.fromId;
        const name = nameOf || (id => id);
        if (t.directional) {
            return {
                otherId,
                typeName: t.name,
                directional: true,
                sentence: `${name(edge.fromId)} ${t.name} ${name(edge.toId)}`,
            };
        }
        return { otherId, typeName: t.name, directional: false, sentence: null };
    }

    // Find a reusable Relationship Type by case-insensitive name (for the
    // free-type-then-reuse flow), or null if it's genuinely new.
    function findTypeByName(types, name) {
        const n = (name || '').trim().toLowerCase();
        if (!n) return null;
        return (types || []).find(t => (t.name || '').toLowerCase() === n) || null;
    }

    const RelationshipCore = {
        edgesForPerson,
        describeRelationship,
        findTypeByName,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = RelationshipCore;
    }
    if (global) {
        global.RelationshipCore = RelationshipCore;
    }
})(typeof window !== 'undefined' ? window : null);
