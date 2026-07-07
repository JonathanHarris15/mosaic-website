/* ============================================================
   data.js — Firebase wiring for the mobile shell. Reuses the same
   project config as the desktop app (public/auth.js). Exposes
   M.data with auth/db handles, an auth-state subscription, and the
   navigation destinations.
   ============================================================ */
(function () {
  "use strict";

  var firebaseConfig = {
    apiKey: "AIzaSyCJLgZP27CWayqFoqYoqg9mVdkhgCWqgbg",
    authDomain: "mosaic-hymn-database.firebaseapp.com",
    projectId: "mosaic-hymn-database",
    storageBucket: "mosaic-hymn-database.firebasestorage.app",
    messagingSenderId: "55153890298",
    appId: "1:55153890298:web:4ca1f526f0169fb7920a43",
    measurementId: "G-64N3W268V9",
  };
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  var auth = firebase.auth();
  var db = firebase.firestore();

  var ROLE_LABELS = { admin: "Administrator", editor: "Editor", elder: "Elder", viewer: "Member" };

  // Resolve a display profile from the auth user + /users/{uid}.
  function loadProfile(user) {
    if (!user || user.isAnonymous) return Promise.resolve(null);
    return db.collection("users").doc(user.uid).get()
      .then(function (doc) { return doc.exists ? doc.data() : {}; })
      .catch(function () { return {}; })
      .then(function (data) {
        var name = data.name || data.displayName || user.displayName || (user.email ? user.email.split("@")[0] : "Friend");
        var role = data.role || "viewer";
        return {
          uid: user.uid,
          email: user.email || "",
          name: name,
          first: String(name).trim().split(/\s+/)[0],
          role: role,
          roleLabel: ROLE_LABELS[role] || "Member",
        };
      });
  }

  // Subscribe to auth changes; cb(profileOrNull). Returns unsubscribe.
  function onUser(cb) {
    return auth.onAuthStateChanged(function (user) {
      if (!user) { cb(null); return; }
      loadProfile(user).then(cb);
    });
  }

  function signIn(email, password) { return auth.signInWithEmailAndPassword(email, password); }
  function signOut() { return auth.signOut(); }

  // Drawer / home destinations -> desktop pages (page-load nav for now;
  // in-shell screens override where they exist). `roles` mirrors the card
  // gating on index.html (:300-320) — an entry is hidden unless the signed-in
  // user's role is listed. See canSee().
  var DESTINATIONS = [
    { key: "home", label: "Home", icon: "house", route: "home" },
    { key: "hymn-directory", label: "Hymn Directory", icon: "book-open", route: "hymnDirectory" },
    { key: "calendar", label: "Service Calendar", icon: "calendar", route: "calendar" },
    { key: "directory", label: "People's Directory", icon: "users", route: "people" },
    { key: "hymn-manager", label: "Hymn Manager", icon: "library", route: "hymnManager" },
    { key: "shepherd", label: "Shepherd Dashboard", icon: "shield", route: "shepherd", roles: ["elder", "super_admin"] },
    { key: "admin", label: "Admin Dashboard", icon: "settings-2", route: "admin", roles: ["admin", "super_admin"] },
  ];

  // True when a destination/tile with an optional `roles` gate is visible to
  // this user (no gate = always visible). Matches index.html role checks.
  function canSee(item, user) {
    if (!item || !item.roles) return true;
    return !!(user && item.roles.indexOf(user.role) >= 0);
  }

  // ── Collection loaders (defensive: tolerate missing fields) ──
  function lc(v) { return String(v == null ? "" : v).toLowerCase(); }

  function getHymns() {
    return db.collection("hymns").get().then(function (snap) {
      var out = [];
      snap.forEach(function (doc) {
        var d = doc.data() || {};
        var versions = Array.isArray(d.versions) ? d.versions : [];
        var pages = versions.reduce(function (acc, v) {
          return acc.concat(Array.isArray(v && v.pages) ? v.pages : []);
        }, []);
        out.push({
          id: doc.id,
          name: d.hymn_name || d.name || d.title || "(untitled)",
          lyricsWriter: d.lyrics_writer || "",
          musicWriter: d.music_writer || "",
          author: d.lyrics_writer || d.music_writer || "",  // subtitle
          attribution: d.attribution || "",
          tags: Array.isArray(d.tags) ? d.tags : [],
          keys: d.key ? [d.key] : (Array.isArray(d.keys) ? d.keys : []),
          pages: pages,               // flattened sheet-music image URLs
          versionCount: versions.length,
          hasSheet: pages.length > 0,
          lastPlayed: d.last_played_date || "",
        });
      });
      out.sort(function (a, b) { return a.name.localeCompare(b.name); });
      return out;
    });
  }

  function getPeople() {
    return db.collection("people").get().then(function (snap) {
      var out = [];
      snap.forEach(function (doc) {
        var d = doc.data() || {};
        var name = d.name || [d.firstName, d.lastName].filter(Boolean).join(" ") || "(no name)";
        out.push({
          id: doc.id,
          name: name,
          role: d.role || d.title || "",
          status: d.status || "member",
          email: d.email || "",
          phone: d.phone || d.phoneNumber || "",
          tags: Array.isArray(d.tags) ? d.tags : [],
          involvements: typeof d.involvements === "number" ? d.involvements : 0,
          lastPrayed: d.lastPrayed || d.lastPrayedFor || null,
          shepherding: d.shepherding || (d.urgency ? { urgency: d.urgency, importance: d.importance } : null),
        });
      });
      out.sort(function (a, b) { return a.name.localeCompare(b.name); });
      return out;
    });
  }

  function getServices() {
    return db.collection("services").get().then(function (snap) {
      var out = [];
      snap.forEach(function (doc) {
        var d = doc.data() || {};
        var date = d.date || doc.id;
        out.push({
          id: doc.id,
          date: date,
          theme: d.theme || d.title || "(no theme)",
          preacher: d.preacher || "",
          serviceLeader: d.serviceLeader || d.leader || "",
          musicLeader: d.musicLeader || "",
          sermonette: d.sermonette || "",
          hasBaptism: !!d.hasBaptism,
        });
      });
      out.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
      return out;
    });
  }

  function todayStr() { return new Date().toISOString().slice(0, 10); }

  // The service to feature on Home: nearest upcoming (date >= today), else most recent.
  function getNextService() {
    return getServices().then(function (list) {
      var t = todayStr();
      var up = list.filter(function (s) { return String(s.date) >= t; });
      if (up.length) { up.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); }); return up[0]; }
      return list[0] || null;
    });
  }

  M.data = {
    auth: auth, db: db,
    onUser: onUser, loadProfile: loadProfile,
    signIn: signIn, signOut: signOut,
    DESTINATIONS: DESTINATIONS, canSee: canSee,
    getHymns: getHymns, getPeople: getPeople, getServices: getServices,
    getNextService: getNextService,
    lc: lc,
  };
})();
