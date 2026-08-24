// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/mosaic-identity.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Who the signed-in user is AS A PERSON.
//
// Firebase knows a uid; the church knows a Person. `users/{uid}.personId` is the
// bridge, and two features now need to cross it — the authorship tag under each
// order-of-service element, and the presence badge beside a box somebody else
// is editing. Both want the same four things: an id, a name, and a face.
//
// It is one small hop and two pages would each have written their own, so it
// lives here instead. An account with no Person attached resolves to null and
// every caller treats that as "we cannot say who this is" rather than guessing
// from an email address — a tag reading "j.smith@…  chose Hymn 1" is worse than
// no tag, because it is the only place in the app a person is not called by
// their name.

var MosaicIdentity = (function () {

    var cached = null;      // resolved Person, or null once we know there isn't one
    var pending = null;     // in-flight resolution, so N callers make one request

    // Trimmed to what a badge or a tag actually draws. Carrying the whole
    // Person record around would invite somebody to read something sensitive
    // off it in a surface that has no business showing it.
    function toIdentity(personId, person) {
        return {
            id: personId,
            name: (person && person.name) || '',
            photoUrl: (person && person.photoUrl) || null,
            photoCrop: (person && person.photoCrop) || null
        };
    }

    // deps: { db, getUserData, uid }
    async function resolve(deps) {
        var d = deps || {};
        if (!d.uid) return null;

        var userData = await d.getUserData(d.uid);
        var personId = userData && userData.personId;
        if (!personId) return null;

        try {
            var doc = await d.db.collection('people').doc(personId).get();
            return toIdentity(personId, doc.exists ? doc.data() : null);
        } catch (e) {
            // The Person is real even if we could not read the record. An id
            // with no name still identifies who did something; refusing to
            // record it would lose the fact entirely.
            console.warn('Could not read the Person behind this account:', e);
            return toIdentity(personId, null);
        }
    }

    // Resolved once per page load. The answer only changes when somebody's
    // account is re-pointed at a different Person, and auth.js already reloads
    // the page when that happens (see identityMoved).
    function me(deps) {
        if (cached !== null) return Promise.resolve(cached);
        if (pending) return pending;

        pending = resolve(deps).then(function (identity) {
            cached = identity;
            pending = null;
            return identity;
        }).catch(function (e) {
            pending = null;
            console.error('Could not work out who is signed in:', e);
            return null;
        });

        return pending;
    }

    // A stamp saying who decided something, and when. `at` is left to the
    // caller because a batched write wants the server's clock, not the
    // browser's — a laptop an hour fast would otherwise claim the last word
    // on every element it touched.
    function stamp(identity, at) {
        if (!identity || !identity.id) return null;
        return { id: identity.id, name: identity.name || '', at: at || null };
    }

    function _reset() { cached = null; pending = null; }

    // Uncached. `me()`'s cache is deliberately page-scoped — one browser tab
    // is always the same signed-in person for its whole life. A server
    // process is not: one Cloud Functions instance answers many different
    // callers in turn, so caching "the" identity there would eventually hand
    // one caller's Person to another. Server callers (MS-262's
    // oos_update_liturgy) resolve fresh, every call.
    return {
        me: me, stamp: stamp, toIdentity: toIdentity, resolve: resolve,
        _reset: _reset,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MosaicIdentity;
}
