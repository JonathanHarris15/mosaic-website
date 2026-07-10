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

        // Custom Relationships: one edge per stored relationship, typed by its type.
        var typeName = {};
        relationshipTypes.forEach(function (t) { typeName[t.id] = t.name || 'Relationship'; });
        relationships.forEach(function (r) {
            if (!r.fromId || !r.toId || !r.typeId) return;
            if (!(r.typeId in typeName)) return; // unknown type → skip (dangling)
            add(r.fromId, r.toId, 'rel:' + r.typeId, typeName[r.typeId]);
        });

        // Every Relationship Type becomes a toggle, in input order (even with no edges yet).
        var customTypes = relationshipTypes.map(function (t) {
            return { key: 'rel:' + t.id, label: t.name || 'Relationship' };
        });

        return {
            nodes: nodes,
            edges: edges,
            customTypes: customTypes,
            assignedElderName: assignedElderName,
            hasData: edges.length > 0,
        };
    }

    var RelationsGraphCore = {
        ELDER_TAG: ELDER_TAG,
        nameParts: nameParts,
        isElderNode: isElderNode,
        buildGraph: buildGraph,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = RelationsGraphCore;
    }
    if (global) {
        global.RelationsGraphCore = RelationsGraphCore;
    }
})(typeof window !== 'undefined' ? window : null);
