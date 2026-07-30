/* ============================================================
   local-cache.js — what the app already knows, kept on the device.

   THE PROBLEM THIS EXISTS FOR. In the phone app every screen re-fetched
   everything from the network every time you opened it. Nothing was kept:
   Firestore's own on-device cache was never switched on, and no screen
   remembered what the last one had just read. So the same list of people
   was pulled over the wire on the directory, again on the calendar, again
   on the shepherding dashboard — and each of those waits happened while
   you watched a spinner. The desktop hides this behind a fast connection
   and a page you leave open. A phone does not.

   WHAT IT DOES. Two halves, and the second is the one that matters:

     1. Turns on Firestore's on-device cache, so a read CAN be answered
        without the network.
     2. Reads from that cache FIRST, and refreshes from the server in the
        background.

   Half 2 is not optional. Switching persistence on by itself changes almost
   nothing you can feel: a plain .get() still asks the server first and only
   falls back to the cache when the device is offline. The cache fills up and
   never gets used. What makes a screen open instantly is answering from the
   cache and letting the network catch up afterwards.

   WHAT YOU TRADE FOR IT. A screen can show data a few seconds old — someone
   ELSE's edit lands on your next visit rather than this one. Your OWN edits
   are never stale: Firestore applies local writes to the cache immediately,
   so anything you just changed reads back changed. That is the whole of the
   trade, and it is why this is worth it: the stale case is another person
   editing the same record in the seconds you took to walk to it.

   MOBILE ONLY, deliberately. On the web every read stays exactly as it was —
   live, server-first, no cache. The desktop doesn't have the problem (one
   page, left open, on a real connection) and giving it cached reads would
   change what a browser tab shows for no gain.
   ============================================================ */
(function (global) {
    "use strict";

    if (!global) return;

    // ── Where are we? ────────────────────────────────────────────────────────
    // Three ways to be the phone app, because there are three ways in: the
    // native shell sets MOSAIC_MOBILE_APP (mobile.html), a desktop page opened
    // inside it has been marked by mobile-shell.js, and Capacitor is the
    // backstop for anything that loaded before either.
    function isMobile() {
        if (global.MOSAIC_MOBILE_APP) return true;
        if (global.MOSAIC_SHELL === "mobile") return true;
        return !!global.Capacitor;
    }

    // ── 1. The on-device cache ───────────────────────────────────────────────
    var enabled = false;
    // Switching persistence on is asynchronous, and a page starts reading almost
    // immediately — so a plain boolean would lose that race and quietly serve
    // the first reads of every page load from the network, which are exactly the
    // reads you are waiting on. Callers wait for this instead.
    var ready = null;

    // MUST be called before any other read or write on this Firestore handle —
    // that is Firestore's rule, not ours. So it runs on the line after
    // firebase.firestore(), at both places the app builds one.
    //
    // synchronizeTabs because navigating between shell pages briefly has two
    // documents alive at once; without it the second one loses the race and
    // throws failed-precondition. A failure here is survivable — the app falls
    // back to exactly today's behaviour — so it never rejects.
    // ⚠ THE CACHE CANNOT BE TURNED ON WITHOUT THIS.
    //
    // Firestore's default transport is a streaming WebChannel. Nothing in this
    // app ever opened one — no page uses onSnapshot — so no page ever needed it
    // to work, and it never had to. Switching the cache on changes that: the
    // cache is kept in sync by a listen stream, so the first read opens the
    // WebChannel.
    //
    // Inside the Capacitor WebView the page's origin is capacitor://localhost,
    // which that stream's CORS check rejects outright ("Fetch API cannot load …
    // due to access control checks"). The request never completes and never
    // errors, so the read never settles and the page spins forever. The Roles
    // Manager did exactly that.
    //
    // Long polling is the same Firestore over ordinary requests the WebView will
    // make. FORCED rather than auto-detected: auto-detect tries the WebChannel
    // first, and here it does not fail fast — it hangs, which is the bug.
    function configureTransport(db) {
        if (!db || !db.settings) return;
        try {
            db.settings({ experimentalForceLongPolling: true, merge: true });
        } catch (e) {
            console.warn("Could not set the long-polling transport:", e && e.message);
        }
    }

    function enable(db) {
        if (!isMobile() || !db || !db.enablePersistence) return Promise.resolve(false);
        if (ready) return ready;
        configureTransport(db);
        ready = db.enablePersistence({ synchronizeTabs: true })
            .then(function () { enabled = true; return true; })
            .catch(function (e) {
                // failed-precondition: another tab got there first.
                // unimplemented: the WebView has no IndexedDB.
                console.warn("Local cache unavailable, reading live:", e && e.code);
                return false;
            });
        return ready;
    }

    // ── 2. Cache-first reads ─────────────────────────────────────────────────
    // Answer from the device if we have it, then quietly refresh so the NEXT
    // read is current. On the web, or before the cache is up, this is a plain
    // get() and nothing about the read changes.
    //
    // An empty cache result is treated as a miss, not as "there is nothing".
    // Firestore cannot tell those two apart for a query it has never run, and
    // showing an empty directory to somebody who has simply never opened it is
    // the worse of the two mistakes.
    // `original` is passed by the interception below — the un-patched .get, so
    // the fallbacks here don't re-enter this function. Called directly (without
    // it) the fallback states source:"default", which is both the ordinary read
    // and, being an explicit option, the thing the patch steps aside for.
    function read(query, original) {
        if (!query || !query.get) return Promise.reject(new Error("local-cache: not a query"));
        var call = original
            ? function (opts) { return original.call(query, opts); }
            : function (opts) { return query.get(opts || { source: "default" }); };

        // Not up yet — wait for it rather than racing past it (see `ready`).
        if (!enabled) {
            if (!ready) return call();
            return ready.then(function (on) { return on ? cacheFirstRead(call) : call(); });
        }

        return cacheFirstRead(call);
    }

    function cacheFirstRead(call) {
        return call({ source: "cache" })
            .then(function (snap) {
                var empty = snap.empty || (snap.exists === false) || (snap.size === 0 && !snap.exists);
                if (empty) return call();
                refresh(call);
                return snap;
            })
            .catch(function () { return call(); });
    }

    // The background half. Errors are swallowed on purpose: the caller has
    // already been handed good-enough data, and a failed refresh must not
    // surface as a failed screen. Being offline is the common case here.
    function refresh(call) {
        try {
            call({ source: "server" }).catch(function () {});
        } catch (e) {}
    }

    // ── Making every page read this way ──────────────────────────────────────
    //
    // There are ~130 read sites across the fifteen desktop pages the phone opens
    // in its shell, and they were written long before any of this existed. Three
    // ways to reach them:
    //
    //   - Edit all 130 by hand. Noisy, easy to miss one, and the next page
    //     written brings the old behaviour back with nothing to catch it.
    //   - Hand each page a wrapper to import. Same problem, plus every page now
    //     has to remember to use it.
    //   - Intercept .get() once, here.
    //
    // The third is the only one where a page written next year is fast by
    // default. It IS a patch of somebody else's prototype, which is why it is
    // fenced as tightly as it is: phone only, reads only, and it steps aside the
    // moment a caller states what it wants.
    //
    // WHAT IT NEVER TOUCHES. A call that passes its own options — .get({source:
    // 'server'}) — goes straight through. That is the opt-out, and it is what
    // fresh() below is for. Writes, transactions (Transaction.get is a separate
    // method) and live listeners are all untouched.
    function interceptReads(firebase) {
        if (!isMobile() || !firebase || !firebase.firestore) return false;
        var ns = firebase.firestore;
        var patched = 0;
        ["Query", "CollectionReference", "DocumentReference"].forEach(function (name) {
            var ctor = ns[name];
            if (!ctor || !ctor.prototype) return;
            var proto = ctor.prototype;
            // CollectionReference inherits Query's get — patching the inherited
            // one twice would double-wrap every collection read.
            if (!Object.prototype.hasOwnProperty.call(proto, "get")) return;
            if (proto.get.__mosaicCacheFirst) return;

            var original = proto.get;
            function cacheFirst(options) {
                // The caller said what it wants. Honour it exactly — this is the
                // opt-out every write-feeding read uses (FRESH_READ).
                if (options) return original.call(this, options);
                return read(this, original);
            }
            cacheFirst.__mosaicCacheFirst = true;
            proto.get = cacheFirst;
            patched++;
        });
        return patched > 0;
    }

    // For a read whose RESULT DECIDES A WRITE — merging tags, reassigning
    // people, rebuilding a batch. Stale input to a write doesn't show you old
    // data, it destroys new data: a merge built from a people list thirty
    // seconds old silently drops whoever was added in those thirty seconds.
    // Those reads must come from the server, and say so at the call site.
    function fresh(query) {
        return query.get({ source: "server" });
    }

    // ── Who you are ──────────────────────────────────────────────────────────
    // Every page began by asking Firestore who you are (/users/{uid}) and could
    // not start its REAL query until that answered — a whole round trip before
    // the first useful byte, repeated on every page, for something that changes
    // about once a year. Remembered here per uid so a page can start straight
    // away and correct itself if the answer moved.
    var IDENTITY_KEY = "mosaicIdentity";

    function readIdentity(uid) {
        if (!uid || !isMobile()) return null;
        try {
            var raw = global.localStorage.getItem(IDENTITY_KEY);
            if (!raw) return null;
            var saved = JSON.parse(raw);
            return saved && saved.uid === uid ? saved : null;
        } catch (e) { return null; }
    }

    function writeIdentity(uid, identity) {
        if (!uid || !isMobile() || !identity) return;
        try {
            global.localStorage.setItem(IDENTITY_KEY, JSON.stringify({
                uid: uid,
                personId: identity.personId || null,
                permissionLevel: identity.permissionLevel || null,
            }));
        } catch (e) {}
    }

    // Signing out must forget you. Otherwise the next person to sign in on this
    // phone starts the first page with the last person's rank.
    function clearIdentity() {
        try { global.localStorage.removeItem(IDENTITY_KEY); } catch (e) {}
    }

    global.MosaicLocalCache = {
        isMobile: isMobile,
        enable: enable,
        read: read,
        fresh: fresh,
        interceptReads: interceptReads,
        readIdentity: readIdentity,
        writeIdentity: writeIdentity,
        clearIdentity: clearIdentity,
        isEnabled: function () { return enabled; },
    };

    if (typeof module !== "undefined" && module.exports) module.exports = global.MosaicLocalCache;
})(typeof window !== "undefined" ? window : null);
