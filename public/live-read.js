/* ============================================================
   live-read.js — reading data live, on the web and in the phone app.

   ONE WAY TO KEEP A PAGE CURRENT (MS-482). A Firestore listener is the
   obvious answer, and on the web it is the whole answer. Inside the phone
   app it may not be: local-cache.js records the listen stream hanging in
   the Capacitor WebView — refused by a CORS check, with no error, just
   silence. A page waiting on that silence shows nothing, forever.

   So inside the app a listener gets FIVE SECONDS to answer. If it has not,
   it is dropped and the page RE-READS instead, every few seconds, for as
   long as it is open. The caller never needs to know which one it got: both
   hand it the same snapshot.

     watch(ref, onNext, { fallbackEveryMs, onError }) → unsubscribe

   `fallbackEveryMs` is the caller's to choose, because the cost is theirs:
   PERSON_EVERY_MS for data about the one person on screen, ROSTER_EVERY_MS
   for church-wide lists, where re-reading every person every three seconds
   would be a bill for nothing.

   ⚠ THE WEB NEVER RE-READS ON A TIMER. A browser tab on a real connection
   has a working listener; falling back there would only add reads. The one
   exception on either platform is a listener that errors — re-reading is
   better than a blank page — unless the error is a refusal, which no amount
   of re-reading will change.

   THE SETTING. Once a real phone has shown which mode it lands in, the wait
   is pointless: `localStorage[MODE_KEY]` = 'live' | 'reread' | 'auto'
   (default) sends the app straight there. The web ignores it.
   ============================================================ */
(function (global) {
    "use strict";

    var WAIT_MS = 5000;
    var PERSON_EVERY_MS = 3000;
    var ROSTER_EVERY_MS = 30000;
    var MODE_KEY = "mosaicLiveMode";

    // Three ways to be the phone app, the same three local-cache.js checks: the
    // native shell, a desktop page opened inside it, and Capacitor itself.
    function defaultIsNativeApp() {
        if (!global) return false;
        if (global.MOSAIC_MOBILE_APP) return true;
        if (global.MOSAIC_SHELL === "mobile") return true;
        return !!global.Capacitor;
    }

    // What a snapshot says, as a string, so an unchanged re-read can be ignored.
    // Re-reading every three seconds must not redraw a profile every three
    // seconds — that would close menus and jump the scroll for nothing.
    function signatureOf(snap) {
        try {
            if (!snap) return "";
            if (snap.docs) {
                return JSON.stringify(snap.docs.map(function (d) { return [d.id, d.data()]; }));
            }
            if (typeof snap.data === "function") {
                return JSON.stringify([snap.id, snap.exists, snap.data()]);
            }
        } catch (e) {}
        return String(Math.random());
    }

    function create(env) {
        env = env || {};
        var isNativeApp = env.isNativeApp || defaultIsNativeApp;
        // ⚠ Wrapped, not referenced: a browser's timers refuse a foreign `this`
        // (see the note in presence-core.js).
        var setT = env.setTimeout || function (fn, ms) { return setTimeout(fn, ms); };
        var clearT = env.clearTimeout || function (id) { return clearTimeout(id); };
        var doc = env.document !== undefined ? env.document : (global && global.document) || null;
        var storage = env.storage !== undefined ? env.storage : (global && global.localStorage) || null;
        var log = env.log || function (line) { try { console.info(line); } catch (e) {} };

        var mode = "pending";

        function setting() {
            try {
                var v = storage && storage.getItem(MODE_KEY);
                return v === "live" || v === "reread" ? v : "auto";
            } catch (e) { return "auto"; }
        }

        // Said out loud when it changes, not per watch: a profile opens a dozen.
        function report(next) {
            if (mode === next) return;
            mode = next;
            log(next === "live"
                ? "[live-read] Live updates: listening."
                : "[live-read] Live updates: re-reading every few seconds (the live stream did not answer).");
        }

        function watch(ref, onNext, opts) {
            opts = opts || {};
            var every = opts.fallbackEveryMs || PERSON_EVERY_MS;
            var onError = opts.onError || function () {};
            var native = !!isNativeApp();
            var chosen = native ? setting() : "live";

            var stopped = false;
            var unsubscribe = null;
            var waitTimer = null;
            var readTimer = null;
            var polling = false;
            var inFlight = false;
            var lastSeen = null;

            function deliver(snap) {
                if (stopped) return;
                var sig = signatureOf(snap);
                if (polling && sig === lastSeen) return;
                lastSeen = sig;
                onNext(snap);
            }

            function readOnce() {
                if (stopped || inFlight) return;
                inFlight = true;
                var p;
                try { p = ref.get(); } catch (e) { p = Promise.reject(e); }
                Promise.resolve(p).then(
                    function (snap) { inFlight = false; deliver(snap); schedule(); },
                    function (e) { inFlight = false; if (!stopped) onError(e); schedule(); }
                );
            }

            function schedule() {
                if (stopped || !polling) return;
                if (readTimer) clearT(readTimer);
                readTimer = null;
                if (doc && doc.hidden) return; // resumed by onVisibility
                readTimer = setT(function () { readTimer = null; readOnce(); }, every);
            }

            function onVisibility() {
                if (stopped || !polling) return;
                if (doc.hidden) {
                    if (readTimer) clearT(readTimer);
                    readTimer = null;
                } else if (!readTimer && !inFlight) {
                    readOnce();
                }
            }

            function startPolling() {
                if (stopped || polling) return;
                polling = true;
                if (unsubscribe) { try { unsubscribe(); } catch (e) {} unsubscribe = null; }
                if (waitTimer) { clearT(waitTimer); waitTimer = null; }
                if (doc && doc.addEventListener) doc.addEventListener("visibilitychange", onVisibility);
                report("reread");
                readOnce();
            }

            if (chosen === "reread") {
                startPolling();
            } else {
                unsubscribe = ref.onSnapshot(
                    function (snap) {
                        if (waitTimer) { clearT(waitTimer); waitTimer = null; }
                        report("live");
                        deliver(snap);
                    },
                    function (e) {
                        if (stopped) return;
                        onError(e);
                        // Refused is refused. Re-reading would only be refused again.
                        if (e && e.code === "permission-denied") return;
                        startPolling();
                    }
                );
                if (native && chosen === "auto") {
                    waitTimer = setT(function () { waitTimer = null; startPolling(); }, WAIT_MS);
                }
            }

            return function stop() {
                if (stopped) return;
                stopped = true;
                if (unsubscribe) { try { unsubscribe(); } catch (e) {} unsubscribe = null; }
                if (waitTimer) clearT(waitTimer);
                if (readTimer) clearT(readTimer);
                waitTimer = null;
                readTimer = null;
                if (polling && doc && doc.removeEventListener) doc.removeEventListener("visibilitychange", onVisibility);
            };
        }

        function status() {
            return { mode: mode, setting: setting(), native: !!isNativeApp() };
        }

        return { watch: watch, status: status };
    }

    var api = {
        WAIT_MS: WAIT_MS,
        PERSON_EVERY_MS: PERSON_EVERY_MS,
        ROSTER_EVERY_MS: ROSTER_EVERY_MS,
        MODE_KEY: MODE_KEY,
        create: create,
    };

    if (global) {
        var shared = create();
        global.MosaicLiveRead = Object.assign({}, api, { watch: shared.watch, status: shared.status });
    }
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : null);
