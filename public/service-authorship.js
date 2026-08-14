// Who decided each element of a Sunday's order of service.
//
// Shown as a small tag under each element on the Order of Service page, so the
// room can see who chose what. NOT shown on the Service Calendar or in the
// Planning view — those are for doing the work, not for reading who did it.
//
// ⚠ Recorded everywhere, shown in one place. A hymn picked from the Planning
// view is just as decided as one picked on the Order of Service page, so both
// surfaces stamp it. Record in only one and the tag becomes a liar: silent
// about half the decisions, which is worse than absent, because a missing tag
// reads as "nobody has chosen this yet".
//
// Distinct from Assigned (`assignedWriter`), which is who agreed to fill a
// Sunday in beforehand. This is who actually did, element by element — the
// thing Assigned was always a stand-in for.
//
// Also distinct from Involvement: deciding a hymn is not serving on a Sunday,
// and nothing here touches a Person record or the fairness engine.

var ServiceAuthorship = (function () {

    // Where the stamps live on a Service document. One map, keyed by the same
    // liturgy field name the value itself uses, so `liturgy.hymn1` and
    // `decidedBy.hymn1` are obviously the same element.
    var FIELD = 'decidedBy';

    // Turn the paths a save is about to write into the stamps that go with
    // them. Given {'liturgy.hymn1': …, 'theme': …} only the liturgy slots come
    // back, because the tag sits under liturgy elements and nothing else.
    //
    // Returns dot-paths ready to merge into the same update, so the value and
    // the record of who chose it land in ONE write. Two writes could half-fail
    // and leave a hymn nobody appears to have chosen, or a name against a hymn
    // that never saved.
    function stampsFor(changedPaths, identity, at) {
        var stamp = MosaicIdentity.stamp(identity, at);
        var out = {};
        if (!stamp) return out;

        Object.keys(changedPaths || {}).forEach(function (path) {
            if (path.indexOf('liturgy.') !== 0) return;
            var slot = path.slice('liturgy.'.length);
            if (!slot) return;
            out[FIELD + '.' + slot] = stamp;
        });

        return out;
    }

    // The stamp for one slot, for the surfaces that write a single field.
    function stampFor(slot, identity, at) {
        var stamp = MosaicIdentity.stamp(identity, at);
        if (!stamp || !slot) return {};
        var out = {};
        out[FIELD + '.' + slot] = stamp;
        return out;
    }

    // The same stamps as a nested map, for the one write that cannot use dot
    // paths: the very first save of a Sunday that has no document yet, which
    // has to lay the whole thing down with set().
    function nestStamps(stampPaths) {
        var nested = {};
        var any = false;
        Object.keys(stampPaths || {}).forEach(function (path) {
            if (path.indexOf(FIELD + '.') !== 0) return;
            nested[path.slice(FIELD.length + 1)] = stampPaths[path];
            any = true;
        });
        return any ? nested : null;
    }

    // Read the stamp for one slot off a Service.
    function decidedBy(service, slot) {
        var map = service && service[FIELD];
        var entry = map && map[slot];
        return (entry && entry.id) ? entry : null;
    }

    // What the tag says. First name only — the tag sits under a row that
    // already carries a label and a value, and a full name turns a quiet note
    // into a third column of text competing with the element itself.
    function tagLabel(entry) {
        if (!entry || !entry.id) return '';
        var parts = String(entry.name || '').trim().split(/\s+/).filter(Boolean);
        return parts.length ? parts[0] : 'Someone';
    }

    // The whole name, for the tooltip.
    function tagTitle(entry) {
        if (!entry || !entry.id) return '';
        var name = String(entry.name || '').trim();
        return (name || 'Someone') + ' chose this';
    }

    return {
        FIELD: FIELD,
        stampsFor: stampsFor,
        stampFor: stampFor,
        nestStamps: nestStamps,
        decidedBy: decidedBy,
        tagLabel: tagLabel,
        tagTitle: tagTitle
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ServiceAuthorship;
}
