// The hymn index, and the one way of searching it.
//
// Two surfaces now pick hymns — the Order of Service editor and the Planning
// view on the Service Calendar — and they must offer the same five hymns for
// the same typing. Two copies of "search hymns" would drift within a month and
// the symptom would be somebody insisting a hymn is missing on one screen and
// present on the other.
//
// So the ranking lives here, once: an exact id match first (people type "H128"
// as often as they type a title), then fuzzy matches, capped.

var HymnRegistry = (function () {

    // A hymn as the index holds it. The callable returns this shape already;
    // the Firestore fallback has to build it.
    function fromDoc(id, data) {
        return {
            id: id,
            hymn_name: (data && data.hymn_name) || 'Unknown',
            variations: (data && data.versions) ? data.versions.length : 0,
            music_writer: (data && data.music_writer) || 'Unknown',
            lyrics_writer: (data && data.lyrics_writer) || 'Unknown',
            last_played_date: (data && data.last_played_date) || null,
            tags: (data && data.tags) || [],
            database_url: '/hymns/' + id
        };
    }

    var FUSE_OPTIONS = {
        keys: ['id', 'hymn_name', 'lyrics_writer', 'music_writer'],
        threshold: 0.4,      // lenient, so prefixes and typos still land
        distance: 100,
        minMatchCharLength: 1,
        includeScore: true
    };

    function buildIndex(hymns, FuseCtor) {
        if (!FuseCtor || !hymns || !hymns.length) return null;
        try {
            return new FuseCtor(hymns, FUSE_OPTIONS);
        } catch (e) {
            console.error('Error creating Fuse instance for hymns:', e);
            return null;
        }
    }

    // Fetch the index. Prefers the callable, which serves a prepared list;
    // falls back to reading the collection when it is unavailable, because a
    // hymn picker that cannot offer hymns is a dead screen.
    async function load(deps) {
        var d = deps || {};
        var hymns = [];

        try {
            var result = await d.getHymnIndex();
            hymns = result && result.data ? result.data : [];
        } catch (error) {
            console.warn('getHymnIndex failed, falling back to direct Firestore fetch:', error);
            try {
                var snap = await d.db.collection('hymns').get();
                hymns = snap.docs.map(function (doc) { return fromDoc(doc.id, doc.data()); });
            } catch (fsError) {
                console.error('Error loading hymn registry from Firestore:', fsError);
                hymns = [];
            }
        }

        return { hymns: hymns, fuse: buildIndex(hymns, d.Fuse) };
    }

    // The five hymns to offer for what has been typed so far.
    //
    // An exact id match is promoted to the front and never duplicated below it.
    // Fuzzy search alone buries it: "H12" scores worse against the hymn
    // actually called H12 than against a dozen titles that happen to contain
    // those letters.
    function search(index, query, limit) {
        var cap = limit || 5;
        var hymns = (index && index.hymns) || [];
        var fuse = index && index.fuse;

        if (!fuse) return [];

        var trimmed = (query || '').trim();
        if (!trimmed) return hymns.slice(0, cap);

        var lower = trimmed.toLowerCase();
        var exact = hymns.find(function (h) {
            return h && typeof h.id === 'string' && h.id.toLowerCase() === lower;
        });

        var results = fuse.search(trimmed).map(function (r) { return r.item; });
        if (exact) {
            results = [exact].concat(results.filter(function (h) { return h.id !== exact.id; }));
        }
        return results.slice(0, cap);
    }

    return { load: load, search: search, fromDoc: fromDoc, FUSE_OPTIONS: FUSE_OPTIONS };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = HymnRegistry;
}
