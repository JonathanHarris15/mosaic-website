// Relations Graph Core — the pure model behind the Relations Viewer (ADR-0013,
// MS-95). Given the raw collections (people, families, relationships,
// relationship_types), it builds the logical graph: nodes (People) and the union
// of edges — Custom Relationships + Family (spouse + parent→child) + Elder
// Assignment (member→elder). It carries NO presentation (no colours, no canvas,
// no positions); the Relations Viewer layers those on. Kept pure so the edge-set
// union and per-type filtering are unit-testable without Firestore or a browser.
//
// Relationships are DERIVED, never stored (ADR-0013): family edges come from the
// `families` collection and elder edges from `shepherding.assignedElderId`, so
// there is no stored edge to fall out of sync.

(function (global) {
    'use strict';

    // Elder Tag id — must match ShepherdingCore.ELDER_TAG_ID and the Cloud
    // Function's ELDER_TAG. Duplicated (not imported) so this core stays
    // dependency-free; the tests pin that all three agree.
    var ELDER_TAG = 'Elder';

    // Relationship Group bubble colours (MS-105, from the Cloud Design pass).
    // Deliberately clear of the membership-stage pips and the custom-edge palette:
    // bubbles are filled regions, so they must not be mistaken for either. Assigned
    // here rather than in the viewer, so a group keeps its colour across reloads.
    var GROUP_PALETTE = [1, 2, 3, 4, 5, 6].map(function (i) { return "var(--graph-" + i + ")"; });

    // Households (ADR-0044) draw as bubbles too, but they are one KIND of thing
    // rather than six, so they take one colour rather than a cycling palette —
    // every Household on screen reads as the same category at a glance, and no
    // Household can be mistaken for a Relationship Group.
    var HOUSEHOLD_COLOUR = 'var(--steel)';
    var HOUSEHOLD_KEY = 'household';

    // A Relationship Type is a kind × priority structure (ADR-0014). Legacy docs
    // carry a `directional` flag instead — read them defensively, so the graph is
    // right before the backfill has run.
    function typeKind(type) {
        return (type && type.kind === 'group') ? 'group' : 'pairwise';
    }
    function typeIsPrioritized(type) {
        if (!type) return false;
        if (type.kind) return !!type.priority;
        return !!type.directional; // legacy: `directional` is priority's ancestor
    }
    function isGroupType(type) { return typeKind(type) === 'group'; }

    // Split a display name into first/last/initials, matching the viewer's chips.
    function nameParts(person) {
        var name = person.name || [person.firstName, person.lastName].filter(Boolean).join(' ') || '(no name)';
        var parts = String(name).trim().split(/\s+/);
        var first = parts[0] || name;
        var last = parts.length > 1 ? parts[parts.length - 1] : '';
        var initials = ((first[0] || '') + (last[0] || '')).toUpperCase() || (first[0] || '?').toUpperCase();
        return { name: name, first: first, last: last, initials: initials };
    }

    // Is a Person an elder for the graph? The projected Elder Tag is the source of
    // truth (ADR-0013); `eldersById` is an optional interim fallback (person ids
    // linked to an elder-role User) so the graph shows elders before the Elder-Tag
    // projection is deployed/backfilled. Super Admins are NOT elders.
    function isElderNode(person, eldersById) {
        var tags = person.tags || [];
        return tags.indexOf(ELDER_TAG) !== -1 || !!(eldersById && eldersById[person.id]);
    }

    // Build the logical graph. Returns:
    //   nodes: [{ id, name, first, last, initials, stage, inactive, elder, assignedElderId }]
    //   edges: [{ a, b, type, rel }]   type ∈ 'family' | 'elder' | 'rel:<typeId>'
    //   customTypes: [{ key:'rel:<typeId>', label }]   one per Relationship Type, in input order
    //   assignedElderName: { memberPersonId: elderDisplayName }
    //   hasData: boolean (any edge at all)
    function buildGraph(input) {
        var inp = input || {};
        var people = inp.people || [];
        var families = inp.families || [];
        var relationships = inp.relationships || [];
        var relationshipTypes = inp.relationshipTypes || [];
        var relationshipGroups = inp.relationshipGroups || [];
        // STORED Households only. The kiosk projects a Family as a Household so
        // its search is never empty, but a projection is a guess and the graph
        // must not draw guesses as records — a Household is minted the first
        // time somebody uses it, and only then does a bubble appear.
        var households = inp.households || [];
        var eldersById = inp.eldersById || null;

        var nodes = [];
        var byId = {};
        people.forEach(function (p) {
            var m = p.membership || {};
            var np = nameParts(p);
            var node = {
                id: p.id,
                name: np.name, first: np.first, last: np.last, initials: np.initials,
                stage: m.stage || null,
                inactive: !!m.inactive,
                elder: isElderNode(p, eldersById),
                assignedElderId: (p.shepherding && p.shepherding.assignedElderId) || null,
            };
            nodes.push(node);
            byId[p.id] = node;
        });

        var edges = [];
        function add(a, b, type, rel) {
            if (byId[a] && byId[b] && a !== b) edges.push({ a: a, b: b, type: type, rel: rel });
        }

        // Family: spouse + parent→child (siblings emerge via shared parents).
        families.forEach(function (f) {
            if (f.husbandId && f.wifeId) add(f.husbandId, f.wifeId, 'family', 'spouse');
            (f.childIds || []).forEach(function (cid) {
                if (f.husbandId) add(f.husbandId, cid, 'family', 'parent');
                if (f.wifeId) add(f.wifeId, cid, 'family', 'parent');
            });
        });

        // Elder Assignment: member → their assigned elder.
        var assignedElderName = {};
        nodes.forEach(function (n) {
            if (n.assignedElderId && byId[n.assignedElderId]) {
                add(n.id, n.assignedElderId, 'elder', 'shepherds');
                assignedElderName[n.id] = byId[n.assignedElderId].name;
            }
        });

        // Custom Relationships: one edge per stored Pairwise Relationship. A
        // GROUP-kind type has no edges at all — it governs bubbles (below).
        //
        // For a Prioritized type, `fromId` is the priority holder (ADR-0014 s2), so
        // the edge's `a` end is the holder and `b` the counterpart. That is all the
        // viewer needs to point the arrowhead the right way.
        var typeById = {};
        relationshipTypes.forEach(function (t) { typeById[t.id] = t; });
        relationships.forEach(function (r) {
            if (!r.fromId || !r.toId || !r.typeId) return;
            var t = typeById[r.typeId];
            if (!t) return;                 // unknown type → dangling edge, skip
            if (isGroupType(t)) return;     // a Group type never yields an edge
            add(r.fromId, r.toId, 'rel:' + r.typeId, t.name || 'Relationship');
        });

        // Every Relationship Type becomes a toggle, in input order (even with no
        // instances yet). `kind` lets the sidebar split groups from edge types;
        // `prio` decides arrowheads (pairwise) or a leader line (group).
        var customTypes = relationshipTypes.map(function (t) {
            return {
                key: 'rel:' + t.id,
                label: t.name || 'Relationship',
                kind: typeKind(t),
                prio: typeIsPrioritized(t),
            };
        });

        // Family and Elder Assignment are structural, never directional.
        var primaryTypes = {
            family: { key: 'family', label: 'Family', kind: 'pairwise', prio: false },
            elder: { key: 'elder', label: 'Elder Assignment', kind: 'pairwise', prio: false },
            household: { key: HOUSEHOLD_KEY, label: 'Households', kind: 'group', prio: false },
        };

        // ── Relationship Groups → one hull descriptor each (ADR-0014 s5) ──────
        // The viewer draws a bubble around `memberIds` in `colour`, labels it
        // `name`, and — only when the type is Prioritized and the seat is filled —
        // draws ONE line from `leaderId` to the bubble. The leader is deliberately
        // NOT in `memberIds`: they sit outside the hull, which is what makes a
        // single leader→bubble line possible instead of a star to every member.
        var groups = [];
        var leaderColourByPerson = {};
        relationshipGroups.forEach(function (g) {
            var t = typeById[g.typeId];
            if (!t || !isGroupType(t)) return;   // orphaned or wrong-kind → skip

            var memberIds = (g.memberIds || []).filter(function (id) { return !!byId[id]; });
            if (!memberIds.length) return;       // nothing to draw a bubble around

            // A symmetric group has no leader by definition, so a stray leaderId on
            // one is dropped rather than drawn.
            var leaderId = (typeIsPrioritized(t) && g.leaderId && byId[g.leaderId]) ? g.leaderId : null;

            var colour = GROUP_PALETTE[groups.length % GROUP_PALETTE.length];
            groups.push({
                id: g.id,
                key: 'rel:' + g.typeId,
                name: g.name || 'Group',
                typeId: g.typeId,
                colour: colour,
                leaderId: leaderId,
                memberIds: memberIds,
            });
            // The node ring that marks someone as a leader takes the colour of the
            // first group they lead.
            if (leaderId && !(leaderId in leaderColourByPerson)) {
                leaderColourByPerson[leaderId] = colour;
            }
        });

        // ── Households → one hull each (ADR-0044) ────────────────────────────
        // Same descriptor as a Relationship Group, so the viewer draws them with
        // the code it already has. Never a leader: a Household has no head — it
        // is who lives together, not who is in charge. One toggle governs the
        // lot, and it starts OFF, because a bubble round every family at once
        // buries the graph the viewer exists to show.
        var householdGroups = [];
        households.forEach(function (h) {
            if (!h || !h.id) return;
            var ids = (h.memberIds || (h.members || []).map(function (m) { return m && m.personId; }))
                .filter(function (id) { return !!byId[id]; });
            if (!ids.length) return;
            householdGroups.push({
                id: 'household:' + h.id,
                key: HOUSEHOLD_KEY,
                name: h.name || 'Household',
                typeId: null,
                colour: HOUSEHOLD_COLOUR,
                leaderId: null,
                memberIds: ids,
            });
        });

        return {
            nodes: nodes,
            edges: edges,
            customTypes: customTypes,
            primaryTypes: primaryTypes,
            groups: groups.concat(householdGroups),
            householdGroups: householdGroups,
            leaderColourByPerson: leaderColourByPerson,
            assignedElderName: assignedElderName,
            hasData: edges.length > 0 || groups.length > 0 || householdGroups.length > 0,
        };
    }

    var RelationsGraphCore = {
        ELDER_TAG: ELDER_TAG,
        GROUP_PALETTE: GROUP_PALETTE,
        HOUSEHOLD_COLOUR: HOUSEHOLD_COLOUR,
        HOUSEHOLD_KEY: HOUSEHOLD_KEY,
        nameParts: nameParts,
        isElderNode: isElderNode,
        typeKind: typeKind,
        typeIsPrioritized: typeIsPrioritized,
        isGroupType: isGroupType,
        buildGraph: buildGraph,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = RelationsGraphCore;
    }
    if (global) {
        global.RelationsGraphCore = RelationsGraphCore;
    }
})(typeof window !== 'undefined' ? window : null);
