const {onCall} = require("firebase-functions/v2/https");
const {log} = require("firebase-functions/logger");
const admin = require("firebase-admin");

/**
 * @fileoverview Firebase Cloud Functions for the Mosaic Website.
 * This file contains the callable HTTPS functions used by the frontend.
 */

// Initialize admin at the top level
if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Cache for the hymn index to reduce Firestore read costs.
 * @type {Array<Object>|null}
 */
let cachedIndex = null;

/**
 * Timestamp of the last cache update in milliseconds.
 * @type {number}
 */
let lastCacheTime = 0;

/**
 * Cache Time-To-Live (TTL) in milliseconds.
 * @type {number}
 */
const CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes

/**
 * A Callable Cloud Function that fetches the entire hymn index from Firestore.
 * 
 * This function returns a simplified list of hymns with basic metadata,
 * optimized for search and display in the frontend lookup tool.
 * Results are cached in memory for 5 minutes.
 * 
 * @param {Object} request - The request object.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of hymn objects.
 * @property {string} id - The Firestore document ID.
 * @property {string} hymn_name - The title of the hymn.
 * @property {number} variations - The number of available versions/arrangements.
 * @property {string} music_writer - The composer of the music.
 * @property {string} lyrics_writer - The author of the lyrics.
 * @property {string|null} last_played_date - The last date the hymn was played.
 * @property {Array<string>} tags - Descriptive tags for the hymn.
 * @property {string} database_url - Relative URL to the hymn details page.
 */
exports.getHymnIndex = onCall({cors: true, region: "us-central1"}, async (request) => {
  if (cachedIndex && (Date.now() - lastCacheTime < CACHE_TTL_MS)) {
    log("Returning index from memory cache.");
    return cachedIndex;
  }

  log("Function 'getHymnIndex' called. Fetching data from Firestore...");

  const db = admin.firestore();

  // 1. Query the entire 'hymns' collection
  const hymnsSnapshot = await db.collection("hymns").orderBy("hymn_name").get();

  // 2. Map the documents to the simpler index structure
  const hymnIndexData = hymnsSnapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      hymn_name: data.hymn_name || "Unknown",
      variations: data.versions ? data.versions.length : 0,
      music_writer: data.music_writer || "Unknown",
      lyrics_writer: data.lyrics_writer || "Unknown",
      last_played_date: data.last_played_date || null,
      tags: data.tags || [],
      database_url: `/hymns/${doc.id}`,
    };
  });

  log(`Returning index with ${hymnIndexData.length} hymns.`);
  
  cachedIndex = hymnIndexData;
  lastCacheTime = Date.now();

  return hymnIndexData;
});

/**
 * A Callable Cloud Function that allows admins to create new users.
 */
exports.createUser = onCall({cors: true, region: "us-central1"}, async (request) => {
  // 1. Check if the caller is an admin
  if (!request.auth) {
    throw new Error("The function must be called while authenticated.");
  }

  const callerUid = request.auth.uid;
  const db = admin.firestore();
  const callerDoc = await db.collection("users").doc(callerUid).get();
  
  if (!callerDoc.exists || callerDoc.data().role !== "admin") {
    throw new Error("Only admins can create new users.");
  }

  const {email, password, role} = request.data;

  if (!email || !password || !role) {
    throw new Error("Missing required fields: email, password, or role.");
  }

  try {
    // 2. Create the user in Firebase Auth
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
    });

    // 3. Store the user's role in Firestore
    await db.collection("users").doc(userRecord.uid).set({
      email: email,
      role: role,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    log(`Successfully created new user: ${userRecord.uid}`);
    return {uid: userRecord.uid};
  } catch (error) {
    log(`Error creating user: ${error.message}`);
    throw new Error(error.message);
  }
});

