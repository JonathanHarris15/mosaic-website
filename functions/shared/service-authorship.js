// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/service-authorship.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

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

    // Is this element empty? An emptied slot has no author, so clearing one
    // has to take the credit with it — see stampsFor.
    //
    // Recursive, because a liturgy slot is not one shape: a hymn is
    // {id, name}, a scripture is a string, the baptism candidates are a list.
    // Blank is blank all the way down.
    function isBlank(value) {
        if (value === null || value === undefined) return true;
        if (typeof value === 'string') return value.trim() === '';
        if (Array.isArray(value)) return value.length === 0;
        if (typeof value === 'object') {
            return Object.keys(value).every(function (k) { return isBlank(value[k]); });
        }
        return false;
    }

    // Turn the paths a save is about to write into the stamps that go with
    // them. Given {'liturgy.hymn1': …, 'theme': …} only the liturgy slots come
    // back, because the tag sits under liturgy elements and nothing else.
    //
    // Returns dot-paths ready to merge into the same update, so the value and
    // the record of who chose it land in ONE write. Two writes could half-fail
    // and leave a hymn nobody appears to have chosen, or a name against a hymn
    // that never saved.
    //
    // ⚠ Clearing an element clears its author too, and does so WHETHER OR NOT
    // we can say who cleared it. Taking your hymn back out should take your
    // name out with it; a tag left standing over an empty row claims somebody
    // chose the emptiness, and the next person to look sees a decision that
    // nobody made. That is why the remove runs outside the `stamp` check —
    // "we don't know who did this" is no reason to leave a wrong tag up.
    function stampsFor(changedPaths, identity, at, remove) {
        var stamp = MosaicIdentity.stamp(identity, at);
        var out = {};

        Object.keys(changedPaths || {}).forEach(function (path) {
            if (path.indexOf('liturgy.') !== 0) return;
            var slot = path.slice('liturgy.'.length);
            if (!slot) return;

            if (isBlank(changedPaths[path])) {
                if (remove !== undefined) out[FIELD + '.' + slot] = remove;
                return;
            }
            if (stamp) out[FIELD + '.' + slot] = stamp;
        });

        return out;
    }

    // One slot, for the surfaces that write a single field. Same rules — it is
    // the same function underneath, so a cleared hymn loses its tag whichever
    // screen cleared it.
    function stampFor(slot, value, identity, at, remove) {
        if (!slot) return {};
        var paths = {};
        paths['liturgy.' + slot] = value;
        return stampsFor(paths, identity, at, remove);
    }

    // The same stamps as a nested map, for the one write that cannot use dot
    // paths: the very first save of a Sunday that has no document yet, which
    // has to lay the whole thing down with set().
    // Removals are dropped rather than nested: this shape is only ever used to
    // lay down a document that does not exist yet, and there is nothing there
    // to take a tag off.
    function nestStamps(stampPaths, remove) {
        var nested = {};
        var any = false;
        Object.keys(stampPaths || {}).forEach(function (path) {
            if (path.indexOf(FIELD + '.') !== 0) return;
            if (remove !== undefined && stampPaths[path] === remove) return;
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
        isBlank: isBlank,
        nestStamps: nestStamps,
        decidedBy: decidedBy,
        tagLabel: tagLabel,
        tagTitle: tagTitle
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ServiceAuthorship;
}
