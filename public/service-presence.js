// Who else is in this Sunday, and which box they are in.
//
// A guide-writing night is a dozen men editing the same handful of documents.
// MS-243 stopped them overwriting each other and MS-244 let them see each
// other's work; this is the last part — seeing each other, and being kept out
// of a box somebody is already typing in.
//
// ── The rule that keeps this simple ──────────────────────────────────────────
// One person per box. A box someone else holds cannot be opened at all, and a
// value only lands when its holder leaves. That is a deliberate trade: no
// merging, no operational transform, no race to resolve, and never a question
// put to a user about whose version to keep. The cost is that you occasionally
// wait for somebody. In a room where you can see them, that is cheap.
//
// ── Why claims expire ────────────────────────────────────────────────────────
// A lock that outlives its holder is worse than no lock. Somebody closes a
// laptop mid-hymn and, without expiry, that hymn is uneditable until a
// developer clears it by hand — on the one evening of the year the church has
// everybody in a room to get it done. So a claim is a HEARTBEAT, not a flag:
// held only while its holder keeps saying so, and free the moment they stop.
// Releasing on unload is a courtesy that makes the common case instant; expiry
// is what makes it correct.

var ServicePresence = (function () {

    // How long a claim survives without a heartbeat, and how often to send one.
    // The gap between them is deliberate: three beats can be missed to a slow
    // network before anybody is treated as gone, so a lock does not flicker on
    // a bad connection while somebody is still typing into it.
    var TTL_MS = 30000;
    var HEARTBEAT_MS = 10000;

    // Firestore hands back a Timestamp; a pending serverTimestamp reads as
    // null on the write's own echo. Null means "just written by us", which is
    // as fresh as it gets, so it is treated as now rather than as expired.
    function millisOf(updatedAt, nowMs) {
        if (!updatedAt) return nowMs;
        if (typeof updatedAt.toMillis === 'function') return updatedAt.toMillis();
        if (updatedAt instanceof Date) return updatedAt.getTime();
        if (typeof updatedAt === 'number') return updatedAt;
        return nowMs;
    }

    function isStale(entry, nowMs, ttlMs) {
        if (!entry) return true;
        var ttl = ttlMs || TTL_MS;
        return (nowMs - millisOf(entry.updatedAt, nowMs)) > ttl;
    }

    // Is this entry a live claim on an actual box?
    function isLiveClaim(entry, nowMs, ttlMs) {
        return !!(entry && entry.fieldKey && entry.dateKey && !isStale(entry, nowMs, ttlMs));
    }

    // Everyone else's live claims, keyed by "dateKey|fieldKey".
    //
    // Your own entry is excluded throughout. A person is never locked out of a
    // box by their own claim — not even from a second tab, where the far more
    // likely reading of "I am already in this box" is that they meant to come
    // back to it, and a lock they cannot see the holder of is just a bug.
    function claimsByBox(entries, myUid, nowMs, ttlMs) {
        var out = {};
        (entries || []).forEach(function (entry) {
            if (!entry || entry.uid === myUid) return;
            if (!isLiveClaim(entry, nowMs, ttlMs)) return;
            out[boxKey(entry.dateKey, entry.fieldKey)] = entry;
        });
        return out;
    }

    function boxKey(dateKey, fieldKey) {
        return String(dateKey) + '|' + String(fieldKey);
    }

    // Who is holding this box, or null if it is free.
    function holderOf(entries, myUid, dateKey, fieldKey, nowMs, ttlMs) {
        return claimsByBox(entries, myUid, nowMs, ttlMs)[boxKey(dateKey, fieldKey)] || null;
    }

    // Everyone present on a surface right now, whether or not they hold a box —
    // the row of faces along the top that says who else is here.
    function peopleHere(entries, myUid, nowMs, ttlMs) {
        var seen = {};
        var out = [];
        (entries || []).forEach(function (entry) {
            if (!entry || entry.uid === myUid) return;
            if (isStale(entry, nowMs, ttlMs)) return;
            if (!entry.personId || seen[entry.personId]) return;
            seen[entry.personId] = true;
            out.push(entry);
        });
        return out;
    }

    // What the badge beside a held box says.
    function holderLabel(entry) {
        if (!entry) return '';
        var parts = String(entry.name || '').trim().split(/\s+/).filter(Boolean);
        return parts.length ? parts[0] : 'Someone';
    }

    function holderTitle(entry) {
        if (!entry) return '';
        var name = String(entry.name || '').trim();
        return (name || 'Someone') + ' is editing this';
    }

    // The document one person's presence is written as. Keyed by uid by the
    // caller, which is what lets the rules say "write only your own".
    function claimRecord(identity, surface, dateKey, fieldKey, at) {
        return {
            personId: (identity && identity.id) || null,
            name: (identity && identity.name) || '',
            photoUrl: (identity && identity.photoUrl) || null,
            photoCrop: (identity && identity.photoCrop) || null,
            surface: surface || null,
            dateKey: dateKey || null,
            fieldKey: fieldKey || null,
            updatedAt: at || null
        };
    }

    return {
        TTL_MS: TTL_MS,
        HEARTBEAT_MS: HEARTBEAT_MS,
        boxKey: boxKey,
        isStale: isStale,
        isLiveClaim: isLiveClaim,
        claimsByBox: claimsByBox,
        holderOf: holderOf,
        peopleHere: peopleHere,
        holderLabel: holderLabel,
        holderTitle: holderTitle,
        claimRecord: claimRecord
    };
})();

// The Firestore side, kept thin and injected so the rules above can be tested
// without a database. One document per signed-in user at `presence/{uid}`:
// a person has one place they are, and keying it by uid is what lets the
// security rules say "you may write your own and nobody else's".
var PresenceStore = (function () {

    // ⚠ EVERY FIELD HERE HAS TO BE USABLE BEFORE start() RUNS.
    //
    // Presence starts late — it waits on auth, and on the Order of Service page
    // it used to wait on the signed-in user resolving to a Person. The editors
    // do not wait for any of that. So `now` began as null, the first cell to
    // ask "is anyone in this box?" hit `state.now()`, and the TypeError took
    // out the loop that attaches every edit handler on the page: nothing was
    // editable, on both surfaces, with no visible error.
    //
    // The rule this cost us: presence may remove a lock, never an editor. When
    // it is not running the answer to "who holds this box" is nobody, and every
    // claim succeeds — which is exactly how the page behaved before any of this
    // existed.
    var state = {
        db: null, uid: null, identity: null, surface: null,
        entries: [], unsubscribe: null, heartbeat: null, started: false,
        dateKey: null, fieldKey: null,
        onChange: function () {},
        stamp: function () { return null; },
        now: function () { return Date.now(); },
        setInterval: null, clearInterval: null
    };

    function start(deps) {
        stop();
        state.db = deps.db;
        state.uid = deps.uid;
        state.identity = deps.identity;
        state.surface = deps.surface;
        state.onChange = deps.onChange || function () {};
        state.stamp = deps.stamp;
        state.now = deps.now || function () { return Date.now(); };
        state.setInterval = deps.setInterval || setInterval;
        state.clearInterval = deps.clearInterval || clearInterval;

        if (!state.db || !state.uid) return;
        state.started = true;

        state.unsubscribe = state.db.collection('presence').onSnapshot(
            function (snap) {
                var entries = [];
                snap.forEach(function (doc) {
                    entries.push(Object.assign({ uid: doc.id }, doc.data()));
                });
                state.entries = entries;
                state.onChange(entries);
            },
            function (e) {
                // Presence failing must not take the page with it. Without it
                // you simply cannot see the others — the editing still works,
                // which is the part that matters.
                console.warn('Presence is unavailable:', e);
                state.entries = [];
                state.onChange([]);
            }
        );

        // The beat runs the whole time the page is open, not only while a box
        // is held, so the row of faces stays honest about who is here.
        state.heartbeat = state.setInterval(function () {
            write(state.dateKey, state.fieldKey);
        }, ServicePresence.HEARTBEAT_MS);

        write(null, null);
    }

    function write(dateKey, fieldKey) {
        if (!state.db || !state.uid) return Promise.resolve();
        var record = ServicePresence.claimRecord(
            state.identity, state.surface, dateKey, fieldKey, state.stamp());
        return state.db.collection('presence').doc(state.uid)
            .set(record)
            .catch(function (e) { console.warn('Could not record presence:', e); });
    }

    // Take a box. Refused only if somebody else demonstrably holds it.
    //
    // With presence not running this ALLOWS the edit. A claim that cannot be
    // recorded is not a claim that should be denied: the page simply has no
    // locking, which is how it worked before this feature and is far better
    // than a screen where nothing opens.
    function claim(dateKey, fieldKey) {
        if (!state.started) return true;
        if (holder(dateKey, fieldKey)) return false;
        state.dateKey = dateKey;
        state.fieldKey = fieldKey;
        write(dateKey, fieldKey);
        return true;
    }

    function release() {
        if (!state.started) return;
        state.dateKey = null;
        state.fieldKey = null;
        write(null, null);
    }

    function holder(dateKey, fieldKey) {
        if (!state.started) return null;
        return ServicePresence.holderOf(
            state.entries, state.uid, dateKey, fieldKey, state.now());
    }

    function claims() {
        if (!state.started) return {};
        return ServicePresence.claimsByBox(state.entries, state.uid, state.now());
    }

    function here() {
        if (!state.started) return [];
        return ServicePresence.peopleHere(state.entries, state.uid, state.now());
    }

    function stop() {
        if (state.unsubscribe) state.unsubscribe();
        if (state.heartbeat && state.clearInterval) state.clearInterval(state.heartbeat);
        state.unsubscribe = null;
        state.heartbeat = null;
        state.started = false;
        state.entries = [];
        state.dateKey = null;
        state.fieldKey = null;
    }

    return {
        start: start, stop: stop,
        claim: claim, release: release,
        holder: holder, claims: claims, here: here,
        _state: state
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ServicePresence: ServicePresence, PresenceStore: PresenceStore };
}
