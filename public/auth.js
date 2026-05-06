
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
 * Updates the header with the appropriate login/user button.
 * Expects a <header> element or a specific container.
 */
function updateAuthUI(user) {
    const authContainer = document.getElementById('auth-container');
    if (!authContainer) return;

    if (user && !user.isAnonymous) {
        // User is signed in with a real account
        authContainer.innerHTML = `
            <div class="flex items-center gap-4">
                <a href="profile.html" class="px-md py-xs font-label-md text-label-md text-primary hover:bg-surface-container rounded-lg transition-colors duration-200 flex items-center gap-1">
                    <span class="material-symbols-outlined text-[18px]">account_circle</span>
                    User Page
                </a>
                <button onclick="auth.signOut()" class="px-md py-xs font-label-md text-label-md text-error hover:bg-error-container rounded-lg transition-colors duration-200">
                    Log Out
                </button>
            </div>
        `;
    } else {
        // User is signed out or anonymous
        authContainer.innerHTML = `
            <a href="login.html" class="px-md py-xs font-label-md text-label-md text-primary hover:bg-surface-container rounded-lg transition-colors duration-200">
                Log In
            </a>
        `;
    }
}

// Listen for auth state changes
auth.onAuthStateChanged((user) => {
    updateAuthUI(user);
    
    // Dispatch a custom event so other scripts can react to auth changes
    const event = new CustomEvent('auth-changed', { detail: { user } });
    document.dispatchEvent(event);
});

/**
 * Helper to check if the current user has a specific role.
 * Roles are stored in /users/{uid}
 */
async function getUserData(uid) {
    if (!uid) return null;
    const doc = await db.collection('users').doc(uid).get();
    return doc.exists ? doc.data() : null;
}
