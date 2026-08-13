
/**
 * Shared Firebase configuration and authentication logic.
 */

const firebaseConfig = {
    apiKey: "AIzaSyCJLgZP27CWayqFoqYoqg9mVdkhgCWqgbg",
    authDomain: "mosaic-hymn-database.firebaseapp.com",
    projectId: "mosaic-hymn-database",
    storageBucket: "mosaic-hymn-database.firebasestorage.app",
    messagingSenderId: "55153890298",
    appId: "1:55153890298:web:4ca1f526f0169fb7920a43",
    measurementId: "G-64N3W268V9"
};

// Initialize Firebase if it hasn't been initialized yet
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

// On-device cache for the phone app only — see local-cache.js. Must run before
// anything else touches `db`, which is why it sits on the line after it. On the
// web this is a no-op and every read stays live.
//
// interceptReads is what reaches the fifteen desktop pages the phone opens in
// its shell: they were all written against a plain .get(), and this is what
// makes those reads answer from the device without editing every one of them.
if (window.MosaicLocalCache) {
    window.MosaicLocalCache.enable(db);
    window.MosaicLocalCache.interceptReads(firebase);
}

// Connect to emulators if running locally and emulators are detected
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    // You can manually toggle this if you want to test against production or emulators
    const USE_EMULATORS = false; 
    
    if (USE_EMULATORS) {
        console.log("Connecting to Firebase emulators...");
        auth.useEmulator("http://localhost:9099");
        db.useEmulator("localhost", 8080);
        firebase.functions().useEmulator("localhost", 5001);
    } else {
        console.log("Localhost detected, but using production Firebase project.");
    }
}

/**
 * Logs the user out and redirects to the landing page.
 */
function logout() {
    forgetUserDoc();
    if (window.MosaicLocalCache) window.MosaicLocalCache.clearIdentity();
    auth.signOut().then(() => {
        // In the mobile shell, return to the shell's login rather than the
        // desktop app (which would bounce the user out of the WebView).
        window.location.href = (window.MOSAIC_SHELL === 'mobile') ? 'mobile.html#/login' : 'index.html';
    });
}

// ── The header, and the race it kept losing ──────────────────────────────────
//
// ⚠ auth.js is loaded in <head>. #auth-container is in the <body>, further
// down. Firebase resolves the stored session off IndexedDB, and how long that
// takes has nothing to do with how long the rest of the HTML takes to parse —
// so the first onAuthStateChanged sometimes lands while the container is still
// an unparsed line of HTML. On a warm cache it often does.
//
// The old code found no container and returned. Nothing asked again: auth state
// only changes at login and logout, so the header stayed empty for the whole
// visit and the next page load looked fine. That is the header that "sometimes"
// does not show up.
//
// So the answer is HELD, and applied again when the document is ready. Held,
// not re-fetched: the state was correct, it just arrived at an empty room.
let lastKnownUser = null;
let authStateKnown = false;
let waitingForTheHeader = false;

/**
 * Updates the header with the appropriate login/user button.
 * Expects a <header> element or a specific container.
 */
function updateAuthUI(user) {
    const authContainer = document.getElementById('auth-container');
    if (!authContainer) {
        // Not a failure — the body may simply not be here yet. Marked so the
        // catch-up below knows there is something owed.
        waitingForTheHeader = true;
        return;
    }
    waitingForTheHeader = false;

    if (user && !user.isAnonymous) {
        // User is signed in with a real account
        authContainer.innerHTML = `
            <div class="flex items-center gap-2 md:gap-4">
                <a href="profile.html" class="p-2 md:px-md md:py-xs font-label-md text-label-md text-primary hover:bg-surface-container rounded-lg transition-colors duration-200 flex items-center gap-1" title="User Page">
                    <span class="material-symbols-outlined text-[20px] md:text-[18px]">account_circle</span>
                    <span class="hidden md:inline">User Page</span>
                </a>
                <button onclick="logout()" class="p-2 md:px-md md:py-xs font-label-md text-label-md text-error hover:bg-error-container rounded-lg transition-colors duration-200 flex items-center gap-1" title="Log Out">
                    <span class="material-symbols-outlined text-[20px] md:text-[18px]">logout</span>
                    <span class="hidden md:inline">Log Out</span>
                </button>
            </div>
        `;
    } else {
        // User is signed out or anonymous
        authContainer.innerHTML = `
            <a href="login.html" class="px-4 py-2 md:px-md md:py-xs font-label-md text-label-md text-primary hover:bg-surface-container rounded-lg transition-colors duration-200">
                Log In
            </a>
        `;
    }
}

// Everything that happens when we learn who somebody is: the header, and then
// the event other scripts hang their own auth-dependent UI off.
function applyAuthState(user) {
    updateAuthUI(user);

    // Dispatch a custom event so other scripts can react to auth changes
    const event = new CustomEvent('auth-changed', { detail: { user } });
    document.dispatchEvent(event);
}

// Listen for auth state changes
auth.onAuthStateChanged((user) => {
    lastKnownUser = user;
    authStateKnown = true;
    applyAuthState(user);
});

// The catch-up. Only when an answer arrived with nowhere to put it — a page
// that won the race must not be told twice, and main.js re-reads the user's
// permission level off this event.
document.addEventListener('DOMContentLoaded', () => {
    if (!authStateKnown || !waitingForTheHeader) return;
    applyAuthState(lastKnownUser);
});

// The same race, arriving by a third road: a page that BUILDS its own chrome
// from script creates #auth-container after the answer AND after the catch-up
// above, so both have already given up on it. The Relations Viewer mounts its
// whole bar this way. It asks again once the room exists.
//
// Held, not re-fetched — the state was right, it just had nowhere to go.
window.refreshAuthUI = function refreshAuthUI() {
    if (!authStateKnown) { waitingForTheHeader = true; return; }
    updateAuthUI(lastKnownUser);
};

/**
 * Helper to check if the current user has a specific role.
 * Roles are stored in /users/{uid}
 *
 * ⚠ THE FIRST THING EVERY PAGE AWAITS, AND FIFTEEN OF THEM DO IT UNGUARDED.
 * Their boot reads `const userData = await getUserData(user.uid)` straight
 * inside an onAuthStateChanged callback, with `loading = false` further down
 * the same function and no try/finally around it. So if this rejects, the
 * callback throws, the flag is never cleared, and the page spins forever —
 * no error, no retry, nothing to press. That is the "keeps loading for a
 * really long time" on navigation: every shell page is a NEW document that
 * must fetch this before it can do anything, and a request in flight while
 * the WebView swaps documents is exactly what fails transiently.
 *
 * So a transient failure is retried here rather than surfaced. Only the
 * transient ones: permission-denied and not-found mean the same thing on the
 * third attempt as the first, and retrying them would just make being refused
 * slower.
 *
 * It can still reject after that, deliberately — returning null instead would
 * read as "no record", which every caller turns into 'viewer', quietly showing
 * somebody a smaller church than they belong to. Failing loudly is caught by
 * the boot guard below.
 */
const RETRYABLE = ['unavailable', 'deadline-exceeded', 'internal', 'resource-exhausted', 'aborted', 'cancelled'];

// ── Who you are, remembered ──────────────────────────────────────────────────
//
// ⚠ THIS READ WAS ON THE CRITICAL PATH OF EVERY PAGE IN THE APP, AND IT DID NOT
// NEED TO BE. Measured on a phone connection: 200–380ms, every navigation, 27
// pages, before any of them could start the query they actually opened for.
// Because it is what tells a page its rank, nothing else could begin — the
// Calendar sat idle for a third of a second on each visit to re-learn something
// that changes about once a year.
//
// So it is answered from what this browser already knows and refreshed behind
// the page. The mobile app has done this since local-cache.js; this is the same
// idea moved to the one place all 27 pages already go through, which is why it
// reaches them without editing 27 control flows.
//
// WHAT YOU TRADE FOR IT. For one page load after somebody's Permission Level is
// changed, their browser still believes the old one. It cannot ACT on it —
// every rule is enforced in Firestore, so a stale rank shows the wrong menu,
// never the wrong data. And the refresh below notices within the same visit:
// when the answer has moved, the memory is dropped and the page is loaded again
// so nobody is left looking at a screen built on a rank they no longer hold.
const IDENTITY_KEY = 'mosaicUserDoc';

function rememberedUserDoc(uid) {
    try {
        const raw = window.localStorage.getItem(IDENTITY_KEY);
        if (!raw) return null;
        const saved = JSON.parse(raw);
        return saved && saved.uid === uid ? saved.data : null;
    } catch (e) { return null; }
}

function rememberUserDoc(uid, data) {
    try {
        window.localStorage.setItem(IDENTITY_KEY, JSON.stringify({ uid: uid, data: data }));
    } catch (e) { /* private browsing, a full disk — the read still works */ }
}

// Signing out must forget you, or the next person to sign in on this device
// starts their first page with the last person's rank.
function forgetUserDoc() {
    try { window.localStorage.removeItem(IDENTITY_KEY); } catch (e) {}
}

// Only the two fields any page branches on. A change to a display name is not
// worth interrupting somebody for; a change to their rank or their Person is.
function identityMoved(before, after) {
    const rank = d => (d && (d.permissionLevel || d.role)) || null;
    const person = d => (d && d.personId) || null;
    return rank(before) !== rank(after) || person(before) !== person(after);
}

async function fetchUserData(uid) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const doc = await db.collection('users').doc(uid).get();
            return doc.exists ? doc.data() : null;
        } catch (e) {
            lastError = e;
            if (!RETRYABLE.includes(e && e.code)) throw e;
            await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
        }
    }
    throw lastError;
}

// One refresh per page load, however many times the page asks who you are.
let refreshing = null;

async function getUserData(uid) {
    if (!uid) return null;

    const known = rememberedUserDoc(uid);
    if (!known) {
        const fresh = await fetchUserData(uid);
        rememberUserDoc(uid, fresh);
        return fresh;
    }

    if (!refreshing) {
        refreshing = fetchUserData(uid).then(fresh => {
            rememberUserDoc(uid, fresh);
            // ⚠ RELOAD RATHER THAN PATCH. The page has already drawn itself
            // around the old answer — menus, panels, the query it ran. There is
            // no way to correct that from here without knowing every page, and
            // guessing would leave somebody on a half-corrected screen, which is
            // worse than the second they lose to a reload.
            if (identityMoved(known, fresh)) window.location.reload();
            return fresh;
        }).catch(() => {
            // A failed refresh must not fail the page: the caller already has a
            // usable answer, and being offline is the common case here.
            return known;
        });
    }

    return known;
}

// ── The boot guard ───────────────────────────────────────────────────────────
//
// The fix above makes the common failure rarer; this makes the WORST OUTCOME
// impossible. A page whose boot throws leaves its spinner running with no way
// out but force-quitting, and every one of those throws lands here as an
// unhandled rejection — so this is the one place that can catch all fifteen
// without editing fifteen control flows, which is where the risk of breaking
// something actually is.
//
// It does not guess at recovery. It says the page did not finish and offers to
// load it again, which is the honest description and the only safe action.
(function bootGuard() {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    let shown = false;

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event && event.reason;
        console.error('Unhandled rejection — the page may not have finished loading:', reason);
        if (shown || !document.body) return;
        shown = true;

        const bar = document.createElement('div');
        bar.id = 'mosaic-boot-guard';
        bar.setAttribute('role', 'alert');
        bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;' +
            'display:flex;align-items:center;gap:12px;justify-content:center;flex-wrap:wrap;' +
            'padding:12px 16px calc(12px + env(safe-area-inset-bottom, 0px));' +
            'background:#7A2E2E;color:#FFF;font-family:var(--font-sans, system-ui, sans-serif);font-size:13.5px;';
        bar.innerHTML = '<span>This page didn’t finish loading.</span>';

        const again = document.createElement('button');
        again.textContent = 'Try again';
        again.style.cssText = 'border:1px solid rgba(255,255,255,0.6);background:transparent;color:#FFF;' +
            'padding:6px 14px;border-radius:999px;font:inherit;font-weight:600;cursor:pointer;';
        again.addEventListener('click', () => window.location.reload());
        bar.appendChild(again);

        document.body.appendChild(bar);
    });
})();
