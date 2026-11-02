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

    // ── A light touch keeps the credit ──────────────────────────────────────
    //
    // Several people write one Sunday. Whoever fixes a typo in somebody
    // else's Call to Worship has not chosen that Call to Worship, and taking
    // the tag off its author for it would hand the credit for the order of
    // service (see writerOf) to whoever proofread it last.
    //
    // So a change is a NEW DECISION unless it is plainly the same choice:
    //   · a hymn with the same index id (its name re-spelt), or a typed hymn
    //     linked to the index entry it already named;
    //   · text whose numbers are all unchanged and whose letters differ by a
    //     slip — "Pslam 23" for "Psalm 23". A different number is a different
    //     chapter, verse or hymn, and is always a decision;
    //   · a list of the same people, re-spelt or reordered.
    // Anything else — another hymn, another passage, someone added — is a
    // new choice and stamps whoever made it.

    function textOf(value) {
        if (value == null) return '';
        if (typeof value === 'string') return value;
        if (typeof value === 'object' && !Array.isArray(value)) return String(value.name || '');
        return String(value);
    }

    // Optimal string alignment distance: insertions, deletions, substitutions
    // and a swap of two neighbours each cost one, so "Pslam" is one slip.
    function slips(a, b) {
        var m = a.length;
        var n = b.length;
        var d = [];
        for (var i = 0; i <= m; i++) {
            d[i] = [i];
            for (var j = 1; j <= n; j++) d[i][j] = i === 0 ? j : 0;
        }
        for (i = 1; i <= m; i++) {
            for (j = 1; j <= n; j++) {
                var cost = a[i - 1] === b[j - 1] ? 0 : 1;
                d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
                if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                    d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
                }
            }
        }
        return d[m][n];
    }

    function sameWords(a, b) {
        var x = textOf(a).toLowerCase();
        var y = textOf(b).toLowerCase();
        var digits = function (s) { return (s.match(/\d+/g) || []).join(' '); };
        if (digits(x) !== digits(y)) return false;
        var letters = function (s) { return s.replace(/[^a-z]+/g, ''); };
        var lx = letters(x);
        var ly = letters(y);
        if (lx === ly) return true;
        var longest = Math.max(lx.length, ly.length);
        // Short words get one slip: two would turn Job into Joel.
        var allowed = longest < 8 ? 1 : Math.max(2, Math.floor(longest * 0.15));
        return slips(lx, ly) <= allowed;
    }

    function samePerson(a, b) {
        var ida = a && typeof a === 'object' ? a.id : null;
        var idb = b && typeof b === 'object' ? b.id : null;
        if (ida && idb) return ida === idb;
        return sameWords(a, b);
    }

    function isLightTouch(before, after) {
        if (isBlank(before) || isBlank(after)) return false;
        if (Array.isArray(before) || Array.isArray(after)) {
            if (!Array.isArray(before) || !Array.isArray(after)) return false;
            var left = after.filter(function (v) { return !isBlank(v); });
            var pool = before.filter(function (v) { return !isBlank(v); });
            if (left.length !== pool.length) return false;
            return left.every(function (person) {
                for (var i = 0; i < pool.length; i++) {
                    if (samePerson(pool[i], person)) { pool.splice(i, 1); return true; }
                }
                return false;
            });
        }
        var idBefore = before && typeof before === 'object' ? before.id : null;
        var idAfter = after && typeof after === 'object' ? after.id : null;
        if (idBefore && idAfter) return idBefore === idAfter;
        return sameWords(before, after);
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
    //
    // `before`, when given, is the Sunday as it stood before this save (its
    // `liturgy` and its `decidedBy`). An element that already has an author
    // and is only lightly touched — a typo fixed, a typed hymn linked to the
    // index — keeps that author: no stamp is written, so theirs stays. See
    // isLightTouch. Without `before` every change is a decision, as it was.
    function stampsFor(changedPaths, identity, at, remove, before) {
        var stamp = MosaicIdentity.stamp(identity, at);
        var out = {};
        var oldLiturgy = (before && before.liturgy) || {};

        Object.keys(changedPaths || {}).forEach(function (path) {
            if (path.indexOf('liturgy.') !== 0) return;
            var slot = path.slice('liturgy.'.length);
            if (!slot) return;

            if (isBlank(changedPaths[path])) {
                if (remove !== undefined) out[FIELD + '.' + slot] = remove;
                return;
            }
            if (decidedBy(before, slot) && !isBlank(oldLiturgy[slot])
                && isLightTouch(oldLiturgy[slot], changedPaths[path])) {
                return;
            }
            if (stamp) out[FIELD + '.' + slot] = stamp;
        });

        return out;
    }

    // One slot, for the surfaces that write a single field. Same rules — it is
    // the same function underneath, so a cleared hymn loses its tag whichever
    // screen cleared it.
    function stampFor(slot, value, identity, at, remove, before) {
        if (!slot) return {};
        var paths = {};
        paths['liturgy.' + slot] = value;
        return stampsFor(paths, identity, at, remove, before);
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

    // ── Who wrote the order of service ───────────────────────────────────────
    //
    // Several people fill in one Sunday, so the order of service is credited
    // to whoever decided MOST of its elements. `elementIds` is the Sunday's
    // order, in service order; only filled elements count, because a stamp
    // over an empty slot is a leftover, not a decision. A tie goes to whoever
    // decided the earlier element. Light touches never moved a stamp, so a
    // proofreader is not counted for what they proofread.
    //
    // Returns {id, name, count, of} — `of` is how many elements carry an
    // author at all — or null when nobody is recorded.
    function writerOf(service, elementIds) {
        var liturgy = (service && service.liturgy) || {};
        var tally = {};
        var order = [];
        var of = 0;
        (elementIds || []).forEach(function (slot) {
            if (isBlank(liturgy[slot])) return;
            var entry = decidedBy(service, slot);
            if (!entry) return;
            of += 1;
            if (!tally[entry.id]) {
                tally[entry.id] = { id: entry.id, name: String(entry.name || '').trim(), count: 0 };
                order.push(entry.id);
            }
            tally[entry.id].count += 1;
            if (!tally[entry.id].name && entry.name) tally[entry.id].name = String(entry.name).trim();
        });
        var best = null;
        order.forEach(function (id) {
            if (!best || tally[id].count > best.count) best = tally[id];
        });
        if (!best) return null;
        return { id: best.id, name: best.name, count: best.count, of: of };
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
        isLightTouch: isLightTouch,
        writerOf: writerOf,
        tagLabel: tagLabel,
        tagTitle: tagTitle
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ServiceAuthorship;
}
