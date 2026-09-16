// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/presence-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Presence and the Box lock — who else is on this page, and which box they
// hold (ADR-0035). Lifted out of the Order of Service (MS-489) so every page
// that locks — the Order of Service, the Services page, and now Shepherding —
// runs the same rules.
//
// ── The rule that keeps this simple ──────────────────────────────────────────
// One person per box. A box someone else holds cannot be opened at all, and a
// value only lands when its holder leaves. No merging, no operational
// transform, no race to resolve, and never a question put to a user about whose
// version to keep. The cost is that you occasionally wait for somebody.
//
// ── Why claims expire ────────────────────────────────────────────────────────
// A lock that outlives its holder is worse than no lock. Somebody closes a
// laptop mid-hymn and, without expiry, that hymn is uneditable until a
// developer clears it by hand. So a claim is a HEARTBEAT, not a flag: held only
// while its holder keeps saying so, and free the moment they stop. Releasing on
// unload is a courtesy that makes the common case instant; expiry is what makes
// it correct.
//
// ── A hold is a SCOPE plus a BOX ─────────────────────────────────────────────
// `scopeKey` + `boxKey` name the record being edited — a Sunday and a liturgy
// field; a person and one of their notes; a Task — never the page it is edited
// on. That is what lets a lock cross surfaces: a hymn held in the Planning view
// is held on the Order of Service page, a Task held on a profile is held on the
// Tasks page. (Before MS-489 these were `dateKey` + `fieldKey`; a record still
// carrying those, from a tab open across a deploy, reads the same.)
//
// ── Holds that go quiet (ADR-0062) ───────────────────────────────────────────
// The Order of Service men are in one room and can ask each other. Elders are
// not. So a store can be given `idleMs`, and then a hold nobody has typed into
// for that long lets go — from BOTH ends. The holder's own store gives it up on
// the next heartbeat, and every reader treats a hold whose `activeAt` is older
// than `idleMs` as free. The second is what makes it correct: a tab asleep in a
// bag still beats, and would otherwise keep the box forever.

var PresenceCore = (function () {

    // How long a claim survives without a heartbeat, and how often to send one.
    // Three beats can be missed to a slow network before anybody is treated as
    // gone, so a lock does not flicker while somebody is still typing into it.
    var TTL_MS = 30000;
    var HEARTBEAT_MS = 10000;
    // A Shepherding hold lets go after this long without typing (ADR-0062).
    var SHEPHERDING_IDLE_MS = 60000;

    // Rules take an options object ({ ttlMs, idleMs }). A bare number is the
    // older ttlMs argument, still accepted so no caller had to change.
    function optionsOf(opts) {
        if (typeof opts === 'number') return { ttlMs: opts };
        return opts || {};
    }

    // Firestore hands back a Timestamp; a pending serverTimestamp reads as
    // null on the write's own echo. Null means "just written by us", which is
    // as fresh as it gets, so it is treated as now rather than as expired.
    function millisOf(at, nowMs) {
        if (!at) return nowMs;
        if (typeof at.toMillis === 'function') return at.toMillis();
        if (at instanceof Date) return at.getTime();
        if (typeof at === 'number') return at;
        return nowMs;
    }

    function scopeOf(entry) {
        return entry.scopeKey !== undefined ? entry.scopeKey : entry.dateKey;
    }

    function boxOf(entry) {
        return entry.boxKey !== undefined ? entry.boxKey : entry.fieldKey;
    }

    function isStale(entry, nowMs, opts) {
        if (!entry) return true;
        var ttl = optionsOf(opts).ttlMs || TTL_MS;
        return (nowMs - millisOf(entry.updatedAt, nowMs)) > ttl;
    }

    // Has this hold gone quiet? Only ever with an idle rule, and never for a
    // record that carries no typing time at all — one written before holds
    // could go quiet must not suddenly unlock.
    function isIdle(entry, nowMs, idleMs) {
        if (!entry || !idleMs) return false;
        if (entry.activeAt === undefined) return false;
        return (nowMs - millisOf(entry.activeAt, nowMs)) > idleMs;
    }

    // Is this entry a live claim on an actual box?
    function isLiveClaim(entry, nowMs, opts) {
        if (!entry || !boxOf(entry) || !scopeOf(entry)) return false;
        var o = optionsOf(opts);
        return !isStale(entry, nowMs, o) && !isIdle(entry, nowMs, o.idleMs);
    }

    function holdKey(scopeKey, boxKey) {
        return String(scopeKey) + '|' + String(boxKey);
    }

    // Everyone else's live claims, keyed by holdKey.
    //
    // Your own entry is excluded throughout. A person is never locked out of a
    // box by their own claim — not even from a second tab, where the far more
    // likely reading of "I am already in this box" is that they meant to come
    // back to it, and a lock they cannot see the holder of is just a bug.
    function claimsByBox(entries, myUid, nowMs, opts) {
        var out = {};
        (entries || []).forEach(function (entry) {
            if (!entry || entry.uid === myUid) return;
            if (!isLiveClaim(entry, nowMs, opts)) return;
            out[holdKey(scopeOf(entry), boxOf(entry))] = entry;
        });
        return out;
    }

    // Who is holding this box, or null if it is free.
    function holderOf(entries, myUid, scopeKey, boxKey, nowMs, opts) {
        return claimsByBox(entries, myUid, nowMs, opts)[holdKey(scopeKey, boxKey)] || null;
    }

    // Everyone else holding ANY box in a scope — a whole document, say — as
    // entries (MS-433). Deleting a document, or replacing its whole body, pulls
    // every one of its boxes out from under whoever is in them.
    function holdersInScope(entries, myUid, scopeKey, nowMs, opts) {
        var claims = claimsByBox(entries, myUid, nowMs, opts);
        var prefix = String(scopeKey) + '|';
        return Object.keys(claims)
            .filter(function (key) { return key.indexOf(prefix) === 0; })
            .map(function (key) { return claims[key]; });
    }

    // Everyone looking at THIS page right now, whether or not they hold a box —
    // the row of faces that says who else is here.
    //
    // ⚠ Scoped to the surface AND the page. Without both, "also here" meant
    // "signed in and has this app open somewhere", so a man reading the
    // calendar appeared to be sitting on a Sunday he had never opened. A
    // presence badge that is wrong is worse than absent.
    //
    // A quiet holder is still HERE — going quiet costs you the box, not the face.
    function peopleHere(entries, myUid, surface, pageKey, nowMs, opts) {
        var seen = {};
        var out = [];
        var wanted = (pageKey === undefined) ? null : pageKey;
        (entries || []).forEach(function (entry) {
            if (!entry || entry.uid === myUid) return;
            if (isStale(entry, nowMs, opts)) return;
            if (entry.surface !== surface) return;
            if ((entry.pageKey || null) !== wanted) return;
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
    //
    // WHERE YOU ARE and WHAT YOU HOLD are two different facts. `surface` +
    // `pageKey` say which screen you are looking at and are always set;
    // `scopeKey` + `boxKey` say which box you have and are null while you hold
    // none. The calendar can hold a box on any Sunday while sitting on none.
    //
    // `activeAt` is left OFF unless given, so a store with no idle rule writes
    // exactly the record it always did, and a beat with no typing since the
    // last one can merge over the stored typing time instead of wiping it.
    function claimRecord(identity, surface, pageKey, scopeKey, boxKey, at, activeAt) {
        var record = {
            personId: (identity && identity.id) || null,
            name: (identity && identity.name) || '',
            photoUrl: (identity && identity.photoUrl) || null,
            photoCrop: (identity && identity.photoCrop) || null,
            surface: surface || null,
            pageKey: pageKey || null,
            scopeKey: scopeKey || null,
            boxKey: boxKey || null,
            updatedAt: at || null
        };
        if (activeAt !== undefined) record.activeAt = activeAt;
        return record;
    }

    // The Shepherding boxes (MS-429). Each names the RECORD being edited, so a
    // Task held on a profile is held on the Tasks page, and the assistant's
    // server check (MS-433) builds exactly the key the page claimed. Later
    // tickets add their own kinds beside these; the scopes do not change.
    var shepherdingBox = {
        note: function (personId, noteId) {
            return { scopeKey: 'person:' + personId, boxKey: 'note:' + noteId };
        },
        details: function (personId) {
            return { scopeKey: 'person:' + personId, boxKey: 'details' };
        },
        // A repeating Task is one commitment: its editor edits the series, so
        // the box is the series id whichever date was opened.
        task: function (taskId) {
            return { scopeKey: 'task:' + taskId, boxKey: 'editor' };
        }
    };

    return {
        TTL_MS: TTL_MS,
        HEARTBEAT_MS: HEARTBEAT_MS,
        SHEPHERDING_IDLE_MS: SHEPHERDING_IDLE_MS,
        shepherdingBox: shepherdingBox,
        holdKey: holdKey,
        isStale: isStale,
        isIdle: isIdle,
        isLiveClaim: isLiveClaim,
        claimsByBox: claimsByBox,
        holderOf: holderOf,
        holdersInScope: holdersInScope,
        peopleHere: peopleHere,
        holderLabel: holderLabel,
        holderTitle: holderTitle,
        claimRecord: claimRecord
    };
})();

// The Firestore side, kept thin and injected so the rules above can be tested
// without a database. One document per signed-in user at `<collection>/{uid}`:
// a person has one place they are in each area, and keying it by uid is what
// lets the security rules say "you may write your own and nobody else's".
//
// One store per area, each with its own collection: the Order of Service's
// `presence` is readable by every editor, and a Shepherding claim says which
// person an elder is looking at, which editors must not learn (MS-477).
function createPresenceStore(config) {
    config = config || {};
    var COLLECTION = config.collection || 'presence';
    var IDLE_MS = config.idleMs || 0;

    // ⚠ EVERY FIELD HERE HAS TO BE USABLE BEFORE start() RUNS.
    //
    // Presence starts late — it waits on auth. The editors do not wait for any
    // of that. So `now` once began as null, the first cell to ask "is anyone in
    // this box?" hit `state.now()`, and the TypeError took out the loop that
    // attaches every edit handler on the page: nothing was editable, with no
    // visible error.
    //
    // The rule this cost us: presence may remove a lock, never an editor. When
    // it is not running the answer to "who holds this box" is nobody, and every
    // claim succeeds.
    var state = {
        db: null, uid: null, identity: null, surface: null,
        entries: [], unsubscribe: null, heartbeat: null, started: false,
        pageKey: null, scopeKey: null, boxKey: null,
        // The box a quiet hold let go of, so coming back can take it again.
        idleReleased: null,
        lastTouch: 0, typedSinceBeat: false,
        onChange: function () {},
        stamp: function () { return null; },
        now: function () { return Date.now(); },
        setInterval: null, clearInterval: null
    };

    function readOptions() {
        return IDLE_MS ? { idleMs: IDLE_MS } : {};
    }

    // ⚠ STARTING PRESENCE CAN NEVER THROW AT ITS CALLER.
    //
    // Callers start presence from inside the auth handler that also grants
    // editing rights, and those handlers catch. So a throw in here did not
    // surface as a broken badge — it turned the whole page read-only, twice,
    // silently. There is no version of this worth crashing a page over: at
    // worst you cannot see who else is in the room.
    function start(deps) {
        try {
            begin(deps);
        } catch (e) {
            console.error('Presence could not start; carrying on without it:', e);
            stop();
        }
    }

    function liveReadWatch() {
        if (typeof MosaicLiveRead !== 'undefined' && MosaicLiveRead && MosaicLiveRead.watch) {
            return function (ref, onNext, opts) { return MosaicLiveRead.watch(ref, onNext, opts); };
        }
        return null;
    }

    function begin(deps) {
        stop();
        state.db = deps.db;
        state.uid = deps.uid;
        state.identity = deps.identity;
        state.surface = deps.surface;
        state.pageKey = deps.pageKey || null;
        state.onChange = deps.onChange || function () {};
        state.stamp = deps.stamp || function () { return null; };
        state.now = deps.now || function () { return Date.now(); };

        // ⚠ WRAPPED, NOT REFERENCED.
        //
        // `state.setInterval = setInterval` then `state.setInterval(fn, ms)` is
        // a METHOD call, so `this` is `state` rather than the window — and the
        // browser's timers are WebIDL operations on Window that refuse a
        // foreign `this` with "Illegal invocation". Node's timers are ordinary
        // functions and do not care, which is precisely why every test passed
        // while both pages were dead.
        state.setInterval = deps.setInterval ||
            function (fn, ms) { return setInterval(fn, ms); };
        state.clearInterval = deps.clearInterval ||
            function (id) { return clearInterval(id); };

        if (!state.db || !state.uid) return;
        state.started = true;

        var ref = state.db.collection(COLLECTION);
        function onNext(snap) {
            var entries = [];
            snap.forEach(function (doc) {
                entries.push(Object.assign({ uid: doc.id }, doc.data()));
            });
            state.entries = entries;
            state.onChange(entries);
        }
        function onError(e) {
            // Presence failing must not take the page with it. Without it you
            // simply cannot see the others — the editing still works.
            console.warn('Presence is unavailable:', e);
            state.entries = [];
            state.onChange([]);
        }
        // Read through live-read.js when it is on the page, so faces and locks
        // keep working when the phone falls back to re-reading.
        var watch = deps.watch || liveReadWatch();
        state.unsubscribe = watch
            ? watch(ref, onNext, {
                fallbackEveryMs: (typeof MosaicLiveRead !== 'undefined' && MosaicLiveRead.PERSON_EVERY_MS) || 3000,
                onError: onError
            })
            : ref.onSnapshot(onNext, onError);

        // The beat runs the whole time the page is open, not only while a box
        // is held, so the row of faces stays honest about who is here.
        state.heartbeat = state.setInterval(beat, PresenceCore.HEARTBEAT_MS);

        write(null, null, IDLE_MS ? null : undefined);
    }

    // Give up the box this store holds, remembering it so a keystroke can ask
    // for it back. The page is told, so it can redraw.
    function letGo() {
        state.idleReleased = { scopeKey: state.scopeKey, boxKey: state.boxKey };
        state.scopeKey = null;
        state.boxKey = null;
        state.typedSinceBeat = false;
        write(null, null, null);
        state.onChange(state.entries);
    }

    // ⚠ WITH AN IDLE RULE, READERS AND THE HOLDER CAN DISAGREE. A reader
    // decides a hold has gone quiet by its own clock; this store decides by
    // its own, and a tab asleep in a bag fires its timers late. So another
    // elder can take the box a moment before this store notices it went quiet.
    // When that has happened, this store must not beat its old claim back over
    // theirs, and must not let a keystroke through as though it still held it.
    function takenFromUs() {
        return !!(IDLE_MS && state.boxKey && holder(state.scopeKey, state.boxKey));
    }

    function beat() {
        if (!state.started) return;
        if (IDLE_MS && state.boxKey &&
            ((state.now() - state.lastTouch) >= IDLE_MS || takenFromUs())) {
            letGo();
            return;
        }
        var activeAt;
        if (IDLE_MS && state.boxKey && state.typedSinceBeat) activeAt = state.stamp();
        state.typedSinceBeat = false;
        write(state.scopeKey, state.boxKey, activeAt);
    }

    // `activeAt`: a value to store; null to clear it; undefined to leave the
    // stored one alone — which is a merge, not an overwrite.
    function write(scopeKey, boxKey, activeAt) {
        if (!state.db || !state.uid) return Promise.resolve();
        var record = PresenceCore.claimRecord(
            state.identity, state.surface, state.pageKey, scopeKey, boxKey, state.stamp(), activeAt);
        var doc = state.db.collection(COLLECTION).doc(state.uid);
        var keepTypingTime = IDLE_MS && activeAt === undefined;
        return (keepTypingTime ? doc.set(record, { merge: true }) : doc.set(record))
            .catch(function (e) { console.warn('Could not record presence:', e); });
    }

    // Take a box. Refused only if somebody else demonstrably holds it.
    //
    // With presence not running this ALLOWS the edit. A claim that cannot be
    // recorded is not a claim that should be denied: the page simply has no
    // locking, which is far better than a screen where nothing opens.
    function claim(scopeKey, boxKey) {
        if (!state.started) return true;
        if (holder(scopeKey, boxKey)) return false;
        state.scopeKey = scopeKey;
        state.boxKey = boxKey;
        state.idleReleased = null;
        state.lastTouch = state.now();
        state.typedSinceBeat = false;
        write(scopeKey, boxKey, IDLE_MS ? state.stamp() : undefined);
        return true;
    }

    // Call on every edit inside a held box. True means carry on; false means
    // somebody else has the box now and this edit must not be saved.
    //
    // After a quiet hold let go, the next keystroke takes the box back if it is
    // still free — so stepping away to think costs nothing — and is refused if
    // somebody else took it while you were gone.
    function touch() {
        if (!state.started) return true;
        state.lastTouch = state.now();
        if (state.boxKey) {
            if (takenFromUs()) {
                letGo();
                return false;
            }
            state.typedSinceBeat = true;
            return true;
        }
        var was = state.idleReleased;
        if (!was) return true;
        if (holder(was.scopeKey, was.boxKey)) return false;
        state.scopeKey = was.scopeKey;
        state.boxKey = was.boxKey;
        state.idleReleased = null;
        state.typedSinceBeat = false;
        write(was.scopeKey, was.boxKey, state.stamp());
        return true;
    }

    function release() {
        if (!state.started) return;
        state.scopeKey = null;
        state.boxKey = null;
        state.idleReleased = null;
        write(null, null, IDLE_MS ? null : undefined);
    }

    function holder(scopeKey, boxKey) {
        if (!state.started) return null;
        return PresenceCore.holderOf(
            state.entries, state.uid, scopeKey, boxKey, state.now(), readOptions());
    }

    function claims() {
        if (!state.started) return {};
        return PresenceCore.claimsByBox(state.entries, state.uid, state.now(), readOptions());
    }

    function here() {
        if (!state.started) return [];
        return PresenceCore.peopleHere(
            state.entries, state.uid, state.surface, state.pageKey, state.now(), readOptions());
    }

    function isHolding(scopeKey, boxKey) {
        return !!(state.started && state.scopeKey === scopeKey && state.boxKey === boxKey);
    }

    // Closing the page. DELETES the claim rather than rewriting it — release()
    // writes a fresh timestamp, so using it here left somebody looking newly
    // arrived for half a minute after they had gone. Best-effort, as an unload
    // always is; expiry is still the thing that guarantees it.
    function leave() {
        if (!state.started || !state.db || !state.uid) return;
        state.scopeKey = null;
        state.boxKey = null;
        state.idleReleased = null;
        try {
            state.db.collection(COLLECTION).doc(state.uid).delete();
        } catch (e) {
            console.warn('Could not clear presence on leaving:', e);
        }
    }

    function stop() {
        if (state.unsubscribe) state.unsubscribe();
        if (state.heartbeat && state.clearInterval) state.clearInterval(state.heartbeat);
        state.unsubscribe = null;
        state.heartbeat = null;
        state.started = false;
        state.entries = [];
        state.scopeKey = null;
        state.boxKey = null;
        state.idleReleased = null;
        state.typedSinceBeat = false;
    }

    return {
        start: start, stop: stop,
        claim: claim, touch: touch, release: release, leave: leave,
        holder: holder, claims: claims, here: here, isHolding: isHolding,
        _state: state
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PresenceCore: PresenceCore, createPresenceStore: createPresenceStore };
}
