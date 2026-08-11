
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

async function getUserData(uid) {
    if (!uid) return null;
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
