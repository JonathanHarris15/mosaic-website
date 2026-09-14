// Shepherding presence (MS-491) — the one store a Shepherding page claims boxes
// through: a note editor, the person-details editor, a Task editor.
//
// ONE PER PAGE, not one per component. A store writes one record per person,
// named after them, so two stores on one page — the profile and the Tasks tab
// inside it — would each overwrite the other's claim. So the page starts this
// once, and every component on it claims through it and subscribes to it.
//
// ITS OWN COLLECTION. A Shepherding claim says which person an elder is looking
// at and which note they have open. The Order of Service's `presence` is
// readable by every editor; this is readable by elders only (MS-477).
//
// A hold lets go after a minute without typing (ADR-0062): elders are not in
// one room, and a cursor left in a note must not lock out an elder in another
// town who cannot ask.
//
// Load presence-core.js before this file.

var ShepherdingPresence = (function () {
    // In a browser these are globals from presence-core.js; under Node they are
    // required. ⚠ Named Core and makeStore, never PresenceCore: a `var` of that
    // name in here would be hoisted over the global and read as undefined.
    var Core = (typeof PresenceCore !== 'undefined') ? PresenceCore : require('./presence-core.js').PresenceCore;
    var makeStore = (typeof createPresenceStore !== 'undefined')
        ? createPresenceStore : require('./presence-core.js').createPresenceStore;
    var store = makeStore({
        collection: 'shepherding_presence',
        idleMs: Core.SHEPHERDING_IDLE_MS
    });

    var listeners = [];
    var latest = [];

    function tell(entries) {
        latest = entries || [];
        listeners.slice().forEach(function (fn) {
            try { fn(latest); } catch (e) { console.warn('A presence listener failed:', e); }
        });
    }

    // Same contract as the store's start — it can never throw at its caller,
    // and with it not running every box opens — with the page's listeners told
    // about every change instead of one.
    function start(deps) {
        store.start(Object.assign({}, deps, { onChange: tell }));
    }

    // Hear about everybody's presence, now and on every change. Returns a
    // function that stops listening.
    function subscribe(fn) {
        listeners.push(fn);
        try { fn(latest); } catch (e) { console.warn('A presence listener failed:', e); }
        return function () {
            var i = listeners.indexOf(fn);
            if (i !== -1) listeners.splice(i, 1);
        };
    }

    // Whoever else holds this box, read off a list of entries the caller keeps
    // (so a page redraws when they change), with the Shepherding idle rule.
    function holderIn(entries, myUid, box, nowMs) {
        if (!box || !myUid) return null;
        return Core.holderOf(entries, myUid, box.scopeKey, box.boxKey,
            nowMs || Date.now(), { idleMs: Core.SHEPHERDING_IDLE_MS });
    }

    function claimBox(box) { return store.claim(box.scopeKey, box.boxKey); }

    return {
        start: start,
        stop: function () { store.stop(); tell([]); },
        subscribe: subscribe,
        claim: store.claim,
        claimBox: claimBox,
        touch: store.touch,
        release: store.release,
        leave: store.leave,
        holder: store.holder,
        here: store.here,
        isHolding: store.isHolding,
        holderIn: holderIn,
        box: Core.shepherdingBox
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ShepherdingPresence: ShepherdingPresence };
}
