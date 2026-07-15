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
    { key: "directory", label: "Member Directory", icon: "users", route: "people" },
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
          membership: d.membership || null,
          email: d.email || (d.contact && d.contact.email) || "",
          phone: d.phone || d.phoneNumber || (d.contact && d.contact.phone) || "",
          address: (d.contact && d.contact.address) || d.address || "",
          birthday: d.birthday || "",
          tags: Array.isArray(d.tags) ? d.tags : [],
          involvements: typeof d.involvements === "number" ? d.involvements : 0,
          lastPrayed: d.lastPrayed || d.lastPrayedFor || null,
          shepherding: d.shepherding || (d.urgency ? { urgency: d.urgency, importance: d.importance } : null),
          // Shepherding visibility (mirrors desktop): people carrying a hidePeople
          // tag are flagged hidden and suppressed from the directory for non-admins.
          shepherdingHidden: !!d.shepherdingHidden,
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

  // ── Shepherding (native Shepherd Dashboard) ──────────────────
  // Reads/writes the same collections as the desktop page
  // (shepherding-dashboard.js): shepherding_reminders, shepherding_views,
  // people, people_tags. The Shepherding Status value model and Tag-Hold
  // derivation come from window.ShepherdingCore — the single source of truth.
  function mapDocs(snap) { return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); }

  function getShepherdingReminders() {
    var now = firebase.firestore.Timestamp.now();
    return db.collection("shepherding_reminders")
      .where("dueDatetime", ">=", now).orderBy("dueDatetime", "asc").get()
      .then(mapDocs).catch(function () { return []; });
  }
  function getShepherdingViews() {
    return db.collection("shepherding_views").orderBy("createdAt", "asc").get()
      .then(mapDocs).catch(function () { return []; });
  }
  function getShepherdingPeople() {
    return db.collection("people").get().then(mapDocs).catch(function () { return []; });
  }
  function getShepherdingTags() {
    return db.collection("people_tags").orderBy("name", "asc").get()
      .then(function (snap) {
        return snap.docs.map(function (d) {
          var t = d.data() || {};
          return { id: d.id, name: t.name || d.id, hiddenFromOthers: !!t.hiddenFromOthers, hidePeople: !!t.hidePeople };
        });
      }).catch(function () { return []; });
  }
  // Tag-Hold history (ADR-0011): one collection-group pass over tag_change
  // activity, grouped by person, derived via ShepherdingCore. Only needed when a
  // view uses a Hold-Duration filter — call lazily.
  function getShepherdingTagHolds(people) {
    return db.collectionGroup("shepherding_activity").where("kind", "==", "tag_change").get()
      .then(function (snap) {
        var byPerson = {};
        snap.docs.forEach(function (doc) {
          var pid = doc.ref.parent.parent && doc.ref.parent.parent.id;
          if (!pid) return;
          (byPerson[pid] || (byPerson[pid] = [])).push(doc.data());
        });
        var now = Date.now(), holds = {};
        (people || []).forEach(function (p) {
          holds[p.id] = window.ShepherdingCore.deriveTagHolds(byPerson[p.id] || [], p.tags || [], now);
        });
        return holds;
      }).catch(function () { return {}; });
  }

  function addShepherdingReminder(title, dueDate, user) {
    return db.collection("shepherding_reminders").add({
      title: title,
      dueDatetime: firebase.firestore.Timestamp.fromDate(dueDate),
      createdBy: (user && user.uid) || (auth.currentUser && auth.currentUser.uid) || null,
      createdByName: (user && user.name) || "",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }
  function deleteShepherdingReminder(id) { return db.collection("shepherding_reminders").doc(id).delete(); }

  function addShepherdingView(payload, user) {
    return db.collection("shepherding_views").add(Object.assign({
      sortBy: "name",
      createdBy: (user && user.uid) || (auth.currentUser && auth.currentUser.uid) || null,
      createdByName: (user && user.name) || "",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, payload)).then(function (ref) { return ref.id; });
  }
  function updateShepherdingView(id, payload) {
    return db.collection("shepherding_views").doc(id).update(Object.assign({
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, payload));
  }
  function deleteShepherdingView(id) { return db.collection("shepherding_views").doc(id).delete(); }

  // ── Shepherding People list ──────────────────────────────────
  // Latest shepherding-note timestamp per person (one collection-group pass),
  // powering the People list's "Needs Attention" sort + Last Note column.
  function getShepherdingLastNoteDates() {
    return db.collectionGroup("shepherding_notes").orderBy("createdAt", "desc").get()
      .then(function (snap) {
        var latest = {};
        snap.docs.forEach(function (doc) {
          var pid = doc.ref.parent.parent && doc.ref.parent.parent.id;
          if (pid && !latest[pid]) latest[pid] = doc.data().createdAt;
        });
        return latest;
      }).catch(function () { return {}; });
  }
  function addShepherdingPerson(np) {
    var now = firebase.firestore.FieldValue.serverTimestamp();
    return db.collection("people").add({
      name: (np.name || "").trim(), totalInvolvements: 0,
      contact: { email: (np.email || "").trim(), phone: (np.phone || "").trim(), address: (np.address || "").trim() },
      birthday: np.birthday || null, sex: np.sex || null, lastPastoralPrayerDate: null,
      tags: [], createdAt: now, updatedAt: now,
    }).then(function (ref) { return ref.id; });
  }

  // ── Shepherding Profile (person file) ────────────────────────
  function getPerson(id) {
    return db.collection("people").doc(id).get()
      .then(function (d) { return d.exists ? Object.assign({ id: d.id }, d.data()) : null; });
  }
  function getShepherdingNotes(personId) {
    return db.collection("people").doc(personId).collection("shepherding_notes")
      .orderBy("createdAt", "desc").get().then(mapDocs).catch(function () { return []; });
  }
  function getShepherdingActivity(personId) {
    return db.collection("people").doc(personId).collection("shepherding_activity")
      .orderBy("createdAt", "desc").get().then(mapDocs).catch(function () { return []; });
  }
  function addShepherdingNote(personId, note, user) {
    return db.collection("people").doc(personId).collection("shepherding_notes").add({
      type: note.type, subject: note.subject, contentJson: note.contentJson, content: note.content,
      authorUid: (user && user.uid) || (auth.currentUser && auth.currentUser.uid) || null,
      authorName: (user && user.name) || "",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }
  function updateShepherdingNote(personId, noteId, note, user) {
    return db.collection("people").doc(personId).collection("shepherding_notes").doc(noteId).update({
      type: note.type, subject: note.subject, contentJson: note.contentJson, content: note.content,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: (user && user.uid) || null, updatedByName: (user && user.name) || "",
    });
  }
  function deleteShepherdingNote(personId, noteId) {
    return db.collection("people").doc(personId).collection("shepherding_notes").doc(noteId).delete();
  }
  function saveShepherdingExplanation(personId, activityId, text) {
    return db.collection("people").doc(personId).collection("shepherding_activity").doc(activityId)
      .update({ explanation: text });
  }
  function createShepherdingTag(name) {
    return db.collection("people_tags").add({ name: name, hiddenFromOthers: false, hidePeople: false })
      .then(function (ref) { return { id: ref.id, name: name, hiddenFromOthers: false, hidePeople: false }; });
  }
  // ── Manage Tags writes (mirror shepherding-tags.js so the native mobile screen
  // stays byte-compatible with the desktop). Tag identity is a stable auto-id
  // (ADR-0011): Rename touches only the name; Merge re-points carriers + their Tag
  // Changes onto the survivor; Delete removes the tag from every carrier. The
  // mobile UI omits the hiddenFromOthers/hidePeople toggles, but Merge/Delete must
  // still recompute each carrier's shepherdingHidden from the *surviving* hidePeople
  // tags — so the flags (managed on desktop) stay consistent. allTags carries the
  // current people_tags list (with those flags) from the screen.
  function renameShepherdingTag(id, name) {
    return db.collection("people_tags").doc(id).update({ name: name });
  }
  // Apply (batch)=>void ops in chunks under Firestore's 500-write-per-batch cap.
  function commitTagOpsInChunks(ops, size) {
    size = size || 450;
    var chain = Promise.resolve();
    for (var i = 0; i < ops.length; i += size) {
      (function (slice) {
        chain = chain.then(function () {
          var batch = db.batch();
          slice.forEach(function (op) { op(batch); });
          return batch.commit();
        });
      })(ops.slice(i, i + size));
    }
    return chain;
  }
  function mergeShepherdingTag(sourceId, survivorId, survivorName, allTags) {
    return db.collection("people").where("tags", "array-contains", sourceId).get()
      .then(function (carriers) {
        return Promise.all(carriers.docs.map(function (doc) {
          // Re-point each carrier's Tag Changes for the merged tag so the survivor
          // inherits the earlier hold (ADR-0011).
          return doc.ref.collection("shepherding_activity").where("tagId", "==", sourceId).get()
            .then(function (actSnap) {
              return {
                id: doc.id,
                tags: doc.data().tags || [],
                activity: actSnap.docs.map(function (a) { return { id: a.id, tagId: a.data().tagId, action: a.data().action }; }),
              };
            });
        })).then(function (people) {
          var plan = window.ShepherdingCore.planTagMerge({ people: people, mergedTagIds: [sourceId], survivorTagId: survivorId });
          var hidePeopleTagIds = (allTags || []).filter(function (t) { return t.id !== sourceId && t.hidePeople; }).map(function (t) { return t.id; });
          var refById = {};
          carriers.docs.forEach(function (d) { refById[d.id] = d.ref; });
          var ops = [];
          plan.personUpdates.forEach(function (u) {
            ops.push(function (batch) {
              batch.update(refById[u.personId], {
                tags: u.newTags,
                shepherdingHidden: u.newTags.some(function (t) { return hidePeopleTagIds.indexOf(t) !== -1; }),
              });
            });
          });
          plan.activityRewrites.forEach(function (r) {
            ops.push(function (batch) {
              batch.update(refById[r.personId].collection("shepherding_activity").doc(r.activityId), {
                tagId: survivorId, tagName: survivorName,
              });
            });
          });
          return commitTagOpsInChunks(ops).then(function () {
            return db.collection("people_tags").doc(sourceId).delete();
          });
        });
      });
  }
  // Toggle a tag's hiddenFromOthers / hidePeople visibility flag. For hidePeople,
  // recompute every carrier's shepherdingHidden (ON → forced hidden; OFF → hidden
  // only if the carrier still holds another hidePeople tag). Mirrors desktop
  // shepherding-tags.js toggleTagFlag. allTags carries the current flags.
  function toggleShepherdingTagFlag(id, field, newVal, allTags) {
    var update = {}; update[field] = newVal;
    return db.collection("people_tags").doc(id).update(update).then(function () {
      if (field !== "hidePeople") return;
      return db.collection("people").where("tags", "array-contains", id).get().then(function (snap) {
        var otherHidePeopleTagIds = (allTags || []).filter(function (t) { return t.id !== id && t.hidePeople; }).map(function (t) { return t.id; });
        var ops = [];
        snap.docs.forEach(function (doc) {
          ops.push(function (batch) {
            if (newVal) { batch.update(doc.ref, { shepherdingHidden: true }); }
            else {
              var personTags = doc.data().tags || [];
              batch.update(doc.ref, { shepherdingHidden: personTags.some(function (tid) { return otherHidePeopleTagIds.indexOf(tid) !== -1; }) });
            }
          });
        });
        return commitTagOpsInChunks(ops);
      });
    });
  }
  function deleteShepherdingTag(id, hidePeople, allTags) {
    return db.collection("people").where("tags", "array-contains", id).get()
      .then(function (snap) {
        var otherHidePeopleTagIds = (allTags || []).filter(function (t) { return t.id !== id && t.hidePeople; }).map(function (t) { return t.id; });
        var ops = [];
        snap.docs.forEach(function (doc) {
          ops.push(function (batch) {
            var update = { tags: firebase.firestore.FieldValue.arrayRemove(id) };
            if (hidePeople) {
              var remaining = (doc.data().tags || []).filter(function (t) { return t !== id; });
              update.shepherdingHidden = remaining.some(function (tid) { return otherHidePeopleTagIds.indexOf(tid) !== -1; });
            }
            batch.update(doc.ref, update);
          });
        });
        ops.push(function (batch) { batch.delete(db.collection("people_tags").doc(id)); });
        return commitTagOpsInChunks(ops);
      });
  }
  function updateShepherdingPersonDetails(personId, d) {
    return db.collection("people").doc(personId).update({
      "contact.email": (d.email || "").trim(),
      "contact.phone": (d.phone || "").trim(),
      "contact.address": (d.address || "").trim(),
      birthday: d.birthday || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }

  // ── Pastoral Record dual-writes (ADR-0005 via ShepherdingCore) ──
  // Status/Tag changes update the denormalized Person field AND append a
  // matching shepherding_activity entry, atomically — same seam the desktop
  // pages use, so history stays consistent across surfaces.
  // Returns the new activity doc id (so a Care List status chip can later undo it).
  function setShepherdingStatus(personId, newStatus, previousStatus, user, source, sourceDocumentId) {
    var C = window.ShepherdingCore;
    return C.commitPastoralChange(db, personId, {
      shepherdingStatus: newStatus,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, C.buildStatusChange({
      previousStatus: previousStatus, newStatus: newStatus,
      authorUid: (user && user.uid) || (auth.currentUser && auth.currentUser.uid) || null,
      authorName: (user && user.name) || "", source: source || "profile",
      sourceDocumentId: sourceDocumentId || null,
    }));
  }
  function toggleShepherdingTag(personId, tagId, tagName, add, shepherdingHidden, user, source, sourceDocumentId) {
    var C = window.ShepherdingCore;
    return C.commitPastoralChange(db, personId, {
      tags: add ? firebase.firestore.FieldValue.arrayUnion(tagId) : firebase.firestore.FieldValue.arrayRemove(tagId),
      shepherdingHidden: shepherdingHidden,
    }, C.buildTagChange({
      tagId: tagId, tagName: tagName, action: add ? "added" : "removed",
      authorUid: (user && user.uid) || (auth.currentUser && auth.currentUser.uid) || null,
      authorName: (user && user.name) || "", source: source || "profile",
      sourceDocumentId: sourceDocumentId || null,
    }));
  }
  // Relationships (ADR-0012, MS-89) — the elder-only edge graph and its reusable
  // types. Small collections; fetched whole for RelationshipCore to render.
  function getRelationships() {
    return db.collection("relationships").get()
      .then(function (snap) { return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); })
      .catch(function () { return []; });
  }
  function getRelationshipTypes() {
    return db.collection("relationship_types").get()
      .then(function (snap) { return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); })
      .catch(function () { return []; });
  }

  // ── Relationship Groups + the manager's writes (MS-106, ADR-0014) ───────────
  // The mobile Relationships tab is the same manager as the desktop one, so these
  // mirror shepherding-relationships.js exactly. Every model decision goes through
  // RelationshipCore / RelationshipGroupCore — this layer only reads and writes.

  function getRelationshipGroups() {
    return db.collection("relationship_groups").get()
      .then(function (snap) {
        return snap.docs.map(function (d) {
          return Object.assign({ id: d.id, leaderId: null, memberIds: [] }, d.data());
        });
      })
      .catch(function () { return []; });
  }

  // The doc is canonicalised first, so a type edited down to Non-Prioritized does
  // not leave its old role labels lying in Firestore ready to resurrect.
  function saveRelationshipType(existing, form) {
    var doc = window.RelationshipCore.canonicalType(Object.assign({}, existing || {}, form));
    delete doc.id;
    if (existing && existing.id) {
      return db.collection("relationship_types").doc(existing.id).set(doc)
        .then(function () { return Object.assign({ id: existing.id }, doc); });
    }
    return db.collection("relationship_types").add(doc)
      .then(function (ref) { return Object.assign({ id: ref.id }, doc); });
  }

  // Deleting a type in use cascades: it takes its pairs and its named groups with
  // it. The screen count-confirms before calling this.
  function deleteRelationshipType(typeId, pairs, groups) {
    var batch = db.batch();
    (pairs || []).forEach(function (p) { batch.delete(db.collection("relationships").doc(p.id)); });
    (groups || []).forEach(function (g) { batch.delete(db.collection("relationship_groups").doc(g.id)); });
    batch.delete(db.collection("relationship_types").doc(typeId));
    return batch.commit();
  }

  // fromId is the priority holder (ADR-0014 s2).
  function addRelationshipPair(fromId, toId, typeId) {
    var edge = { fromId: fromId, toId: toId, typeId: typeId };
    return db.collection("relationships").add(edge)
      .then(function (ref) { return Object.assign({ id: ref.id }, edge); });
  }
  function deleteRelationshipPair(edgeId) {
    return db.collection("relationships").doc(edgeId).delete();
  }

  function createRelationshipGroup(typeId, name) {
    var group = { typeId: typeId, name: name, leaderId: null, memberIds: [] };
    return db.collection("relationship_groups").add(group)
      .then(function (ref) { return Object.assign({ id: ref.id }, group); });
  }
  // `next` is whatever RelationshipGroupCore returned — the roster invariants are
  // already enforced there, so this only persists the two fields it can change.
  function writeRelationshipGroup(next) {
    return db.collection("relationship_groups").doc(next.id)
      .update({ leaderId: next.leaderId, memberIds: next.memberIds })
      .then(function () { return next; });
  }
  function deleteRelationshipGroup(groupId) {
    return db.collection("relationship_groups").doc(groupId).delete();
  }

  // All Families (ADR-0012, MS-88) — the household graph. Small collection;
  // fetched whole so FamilyCore can resolve a Person's relations client-side.
  function getFamilies() {
    return db.collection("families").get()
      .then(function (snap) { return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); })
      .catch(function () { return []; });
  }

  // Move a Person along the Membership Track (ADR-0012): set the stage/inactive
  // field, re-project the Membership Tags, and append one Membership Change — all
  // atomically. The tag swap is silent (no Tag Changes). Returns the activity id.
  function setMembership(personId, currentTags, previous, next, user, source) {
    return window.ShepherdingCore.commitMembershipChange(db, personId, {
      currentTags: currentTags || [],
      previous: previous, next: next,
      authorUid: (user && user.uid) || (auth.currentUser && auth.currentUser.uid) || null,
      authorName: (user && user.name) || "",
      source: source || "profile",
    });
  }

  // Take a status change back entirely (Care List chip backspaced out): restore the
  // previous status AND delete the activity record that logged it (ADR-0005 mirror).
  function revertShepherdingStatus(personId, previousStatus, activityId) {
    return window.ShepherdingCore.revertPastoralChange(db, personId, {
      shepherdingStatus: previousStatus,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, activityId);
  }

  // ── Care List document (elder_documents care-list) ───────────
  function getShepherdingView(id) {
    return db.collection("shepherding_views").doc(id).get()
      .then(function (d) { return d.exists ? Object.assign({ id: d.id }, d.data()) : null; }).catch(function () { return null; });
  }
  function getCareList(docId) {
    return db.collection("elder_documents").doc(docId).get()
      .then(function (d) { return d.exists ? Object.assign({ id: d.id }, d.data()) : null; });
  }
  // .update() (not .set()) so filterId, authorName, createdAt, docType survive.
  function saveCareList(docId, payload, user) {
    return db.collection("elder_documents").doc(docId).update({
      title: (payload.title || "").trim() || "Untitled Care List",
      careListColumns: payload.careListColumns,
      careListData: payload.careListData,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedByName: (user && user.name) || "",
    });
  }

  // ── Document Library (elder_documents + elder_document_structure) ────────────
  // Same collections + tree shape as the desktop page (shepherding-documents.js):
  // elder_document_structure/root is { children: [ {type:'folder',id,name,children},
  // {type:'document',id} ] }; elder_documents holds the note/care-list docs.
  function getElderDocuments() {
    return db.collection("elder_documents").orderBy("createdAt", "desc").get()
      .then(mapDocs).catch(function () { return []; });
  }
  // MS-98: docId defaults to 'root' (the global Library); a Shepherding-Profile
  // Documents tab passes 'person_<personId>' for that Person's own tree.
  function getDocumentStructure(docId) {
    return db.collection("elder_document_structure").doc(docId || "root").get()
      .then(function (d) {
        var data = d.exists ? d.data() : null;
        return data && data.children ? data : { children: [] };
      }).catch(function () { return { children: [] }; });
  }
  function saveDocumentStructure(structure, docId) {
    // Plain clone so Firestore never sees Preact/proxy wrappers.
    var plain = JSON.parse(JSON.stringify(structure || { children: [] }));
    return db.collection("elder_document_structure").doc(docId || "root").set(plain).then(function () { return plain; });
  }
  function createElderDocument(opts, user) {
    var now = firebase.firestore.FieldValue.serverTimestamp();
    var name = (user && user.name) || "Elder";
    var uid = (user && user.uid) || (auth.currentUser && auth.currentUser.uid) || null;
    var type = opts.type === "care-list" ? "care-list" : "note";
    var docData = {
      title: opts.title || (type === "care-list" ? "New Care List" : "New Document"),
      docType: type,
      authorName: name, authorUid: uid,
      createdAt: now, updatedAt: now, updatedByName: name,
    };
    // MS-98: a document created under a profile is owned by that Person and hidden
    // from shared surfaces until opted into the Library.
    if (opts.ownerPersonId) {
      docData.ownerPersonId = opts.ownerPersonId;
      docData.inLibrary = false;
    }
    if (type === "care-list") {
      if (opts.filterId) docData.filterId = opts.filterId;
      else if (opts.filterConfig) docData.filterConfig = opts.filterConfig;
      docData.careListData = {};
    } else {
      docData.contentJson = null;
    }
    return db.collection("elder_documents").add(docData).then(function (ref) { return ref.id; });
  }
  // MS-98: opt a profile document into the global Library — reference the same
  // record from the root tree (no copy) and flag it. targetFolderId '__root__'
  // drops it at the Library top level.
  function addElderDocToLibrary(docId, targetFolderId) {
    var Core = window.ShepherdingDocsCore;
    return db.collection("elder_document_structure").doc("root").get().then(function (d) {
      var rootStruct = d.exists && d.data().children ? d.data() : { children: [] };
      if (Core.containsDoc(rootStruct, docId)) return false;
      var target = (!targetFolderId || targetFolderId === "__root__") ? rootStruct : Core.getFolderById(rootStruct, targetFolderId);
      if (!target) return false;
      if (!target.children) target.children = [];
      target.children.push({ type: "document", id: docId });
      return db.collection("elder_document_structure").doc("root").set(JSON.parse(JSON.stringify(rootStruct)))
        .then(function () { return db.collection("elder_documents").doc(docId).update({ inLibrary: true }); })
        .then(function () { return true; });
    });
  }
  // MS-98: remove document ids from the Library root tree (used when a profile
  // deletes docs that had been opted in), so no dangling reference remains.
  function pruneElderDocsFromLibrary(ids) {
    var Core = window.ShepherdingDocsCore;
    if (!ids || !ids.length) return Promise.resolve();
    return db.collection("elder_document_structure").doc("root").get().then(function (d) {
      var rootStruct = d.exists && d.data().children ? d.data() : { children: [] };
      var changed = false;
      ids.forEach(function (id) { if (Core.removeFromTree(rootStruct, id)) changed = true; });
      if (!changed) return;
      return db.collection("elder_document_structure").doc("root").set(JSON.parse(JSON.stringify(rootStruct)));
    });
  }
  function renameElderDocument(id, title, user) {
    return db.collection("elder_documents").doc(id).update({
      title: (title || "").trim() || "Untitled Document",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedByName: (user && user.name) || "",
    });
  }
  function deleteElderDocuments(ids) {
    return Promise.all((ids || []).map(function (id) { return db.collection("elder_documents").doc(id).delete(); }));
  }

  // ── Note document editor (elder_documents docType='note') ────────────────────
  function getElderDocument(id) {
    return db.collection("elder_documents").doc(id).get()
      .then(function (d) { return d.exists ? Object.assign({ id: d.id }, d.data()) : null; });
  }
  function saveElderDocument(id, payload, user) {
    return db.collection("elder_documents").doc(id).update({
      title: (payload.title || "").trim() || "Untitled Document",
      contentJson: payload.contentJson,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedByName: (user && user.name) || "",
    });
  }
  // Mention data for the doc editor's @ picker: people, elder docs, standalone
  // notes, folders (from the structure tree), tags. Mirrors loadDocMentionData
  // in shepherding-document.js — labels/ids kept byte-identical.
  function collectStructureFolders(node, out) {
    (node.children || []).forEach(function (child) {
      if (child.type === "folder") {
        out.push({ id: JSON.stringify({ kind: "elder_folder", id: child.id }), label: child.name });
        collectStructureFolders(child, out);
      }
    });
  }
  function getDocMentionData() {
    return Promise.all([
      db.collection("people").orderBy("name", "asc").get().catch(function () { return { docs: [] }; }),
      db.collection("elder_documents").get().catch(function () { return { docs: [] }; }),
      db.collectionGroup("shepherding_notes").orderBy("createdAt", "desc").get().catch(function () { return { docs: [] }; }),
      db.collection("elder_document_structure").doc("root").get().catch(function () { return { exists: false }; }),
      db.collection("people_tags").orderBy("name", "asc").get().catch(function () { return { docs: [] }; }),
    ]).then(function (r) {
      var personMap = {};
      var peopleList = [];
      var people = r[0].docs.map(function (doc) {
        var name = (doc.data() && doc.data().name) || doc.id;
        personMap[doc.id] = name;
        peopleList.push({ id: doc.id, name: name });
        return { id: JSON.stringify({ kind: "person", id: doc.id }), label: name };
      });
      var docTypeById = {};
      var docs = r[1].docs.map(function (doc) {
        var d = doc.data() || {};
        docTypeById[doc.id] = d.docType || "note";
        return { id: JSON.stringify({ kind: "elder_document", id: doc.id }), label: d.title || "Untitled Document" };
      });
      var notes = r[2].docs.map(function (doc) {
        var d = doc.data() || {};
        var personId = doc.ref.parent.parent && doc.ref.parent.parent.id;
        var personName = personMap[personId] || "";
        var label = d.subject || ((d.type || "Note") + (personName ? " – " + personName : ""));
        return { id: JSON.stringify({ kind: "note", id: doc.id, personId: personId }), label: label };
      });
      var folders = [];
      if (r[3].exists) collectStructureFolders(r[3].data(), folders);
      var tags = r[4].docs.map(function (doc) { var t = doc.data() || {}; return { id: doc.id, name: t.name || doc.id, hidePeople: !!t.hidePeople }; });
      return { people: people, peopleList: peopleList, docs: docs, notes: notes, folders: folders, tags: tags, docTypeById: docTypeById };
    });
  }

  // Person-Panel linked notes (people/{pid}/shepherding_notes). The panel binds a
  // nested editor to one of these; source: 'document' + sourceDocumentId ties it
  // back to the elder document, exactly like the desktop panel NodeView.
  function addPanelNote(personId, opts, user) {
    return db.collection("people").doc(personId).collection("shepherding_notes").add({
      type: (opts && opts.type) || "Elder Meeting", subject: "", contentJson: null, content: "",
      authorName: (user && user.name) || "", authorUid: (user && user.uid) || (auth.currentUser && auth.currentUser.uid) || null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      sourceDocumentId: (opts && opts.sourceDocumentId) || null,
    }).then(function (ref) { return ref.id; });
  }
  function getPanelNote(personId, noteId) {
    return db.collection("people").doc(personId).collection("shepherding_notes").doc(noteId).get()
      .then(function (d) { return d.exists ? Object.assign({ id: d.id }, d.data()) : null; });
  }
  function savePanelNote(personId, noteId, payload, user, sourceDocumentId) {
    return db.collection("people").doc(personId).collection("shepherding_notes").doc(noteId).update({
      contentJson: payload.contentJson, content: payload.content || "",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedByName: (user && user.name) || "",
      sourceDocumentId: sourceDocumentId || null,
    });
  }
  function updatePanelNoteType(personId, noteId, type, user) {
    return db.collection("people").doc(personId).collection("shepherding_notes").doc(noteId).update({
      type: type, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedByName: (user && user.name) || "",
    });
  }
  function getPersonNotes(personId) {
    return db.collection("people").doc(personId).collection("shepherding_notes").orderBy("createdAt", "desc").get()
      .then(mapDocs).catch(function () { return []; });
  }
  function setNoteSourceDoc(personId, noteId, docId) {
    return db.collection("people").doc(personId).collection("shepherding_notes").doc(noteId).update({ sourceDocumentId: docId });
  }
  function copyNoteContent(fromPersonId, fromNoteId, toPersonId, toNoteId) {
    return getPanelNote(fromPersonId, fromNoteId).then(function (n) {
      if (!n) return;
      return db.collection("people").doc(toPersonId).collection("shepherding_notes").doc(toNoteId)
        .update({ contentJson: n.contentJson || null, content: n.content || "" });
    });
  }
  function deletePanelNote(personId, noteId) {
    return db.collection("people").doc(personId).collection("shepherding_notes").doc(noteId).delete();
  }
  function unlinkPanelNote(personId, noteId) {
    return db.collection("people").doc(personId).collection("shepherding_notes").doc(noteId)
      .update({ sourceDocumentId: firebase.firestore.FieldValue.delete() });
  }

  // ── Admin Dashboard (SMS / Textbelt via admin-gated callables + prayer config) ─
  // Mirrors admin-dashboard.js: the Textbelt key is a server secret, so status +
  // test-send go through us-central1 callables; replies + prayer templates live in
  // Firestore (sms_test_replies, app_config/prayer_request_sms).
  var PRAYER_MESSAGE_DEFAULTS = {
    initial: "Hi {name}, this is Mosaic Church. You're in our pastoral prayer " +
      "this Sunday. What would you like us to pray about? (This information " +
      "will be private and only shared with Elders) Just reply to this message.",
    reminder: "Hi {name}, a gentle reminder from Mosaic Church — we'd love to " +
      "pray for you this Sunday. What would you like us to pray about? (This " +
      "information will be private and only shared with Elders) Just reply " +
      "here whenever you're ready.",
    thankyou: "Thank you, {name}. We'll be lifting this up in prayer this " +
      "Sunday. — Mosaic Church",
    elderDigest: "Mosaic prayer requests for {date}:\n{requests}",
  };
  function smsFns() { return firebase.app().functions("us-central1"); }
  function getSmsStatus() {
    return smsFns().httpsCallable("smsCheckQuota")().then(function (res) {
      var d = res.data || {};
      return { configured: !!d.configured, quotaRemaining: (d.quotaRemaining == null ? null : d.quotaRemaining), error: d.error || "" };
    });
  }
  function sendTestSms(phone, message) {
    return smsFns().httpsCallable("smsSendTest")({ phone: phone, message: message }).then(function (res) { return res.data || {}; });
  }
  function getSmsReplies() {
    return db.collection("sms_test_replies").orderBy("receivedAt", "desc").get().then(mapDocs).catch(function () { return []; });
  }
  function deleteSmsReply(id) { return db.collection("sms_test_replies").doc(id).delete(); }
  function clearSmsReplies(ids) {
    var batch = db.batch();
    (ids || []).forEach(function (id) { batch.delete(db.collection("sms_test_replies").doc(id)); });
    return batch.commit();
  }
  function getPrayerMessages() {
    return db.collection("app_config").doc("prayer_request_sms").get().then(function (doc) {
      var s = doc.exists ? doc.data() : {};
      return {
        messages: {
          initial: s.initial || PRAYER_MESSAGE_DEFAULTS.initial,
          reminder: s.reminder || PRAYER_MESSAGE_DEFAULTS.reminder,
          thankyou: s.thankyou || PRAYER_MESSAGE_DEFAULTS.thankyou,
          elderDigest: s.elderDigest || PRAYER_MESSAGE_DEFAULTS.elderDigest,
        },
        autoSendEnabled: !!s.autoSendEnabled,
      };
    });
  }
  function savePrayerMessages(msgs, user) {
    return db.collection("app_config").doc("prayer_request_sms").set({
      initial: (msgs.initial || "").trim(), reminder: (msgs.reminder || "").trim(),
      thankyou: (msgs.thankyou || "").trim(), elderDigest: (msgs.elderDigest || "").trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: (user && user.uid) || (auth.currentUser && auth.currentUser.uid) || null,
    }, { merge: true });
  }
  function setAutoSend(enabled, user) {
    return db.collection("app_config").doc("prayer_request_sms").set({
      autoSendEnabled: !!enabled,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: (user && user.uid) || (auth.currentUser && auth.currentUser.uid) || null,
    }, { merge: true });
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
    getShepherdingReminders: getShepherdingReminders,
    getShepherdingViews: getShepherdingViews,
    getShepherdingPeople: getShepherdingPeople,
    getShepherdingTags: getShepherdingTags,
    getShepherdingTagHolds: getShepherdingTagHolds,
    addShepherdingReminder: addShepherdingReminder,
    deleteShepherdingReminder: deleteShepherdingReminder,
    addShepherdingView: addShepherdingView,
    updateShepherdingView: updateShepherdingView,
    deleteShepherdingView: deleteShepherdingView,
    getShepherdingLastNoteDates: getShepherdingLastNoteDates,
    addShepherdingPerson: addShepherdingPerson,
    getPerson: getPerson,
    getShepherdingNotes: getShepherdingNotes,
    getShepherdingActivity: getShepherdingActivity,
    addShepherdingNote: addShepherdingNote,
    updateShepherdingNote: updateShepherdingNote,
    deleteShepherdingNote: deleteShepherdingNote,
    saveShepherdingExplanation: saveShepherdingExplanation,
    createShepherdingTag: createShepherdingTag,
    getRelationshipGroups: getRelationshipGroups,
    saveRelationshipType: saveRelationshipType,
    deleteRelationshipType: deleteRelationshipType,
    addRelationshipPair: addRelationshipPair,
    deleteRelationshipPair: deleteRelationshipPair,
    createRelationshipGroup: createRelationshipGroup,
    writeRelationshipGroup: writeRelationshipGroup,
    deleteRelationshipGroup: deleteRelationshipGroup,
    renameShepherdingTag: renameShepherdingTag,
    mergeShepherdingTag: mergeShepherdingTag,
    deleteShepherdingTag: deleteShepherdingTag,
    toggleShepherdingTagFlag: toggleShepherdingTagFlag,
    updateShepherdingPersonDetails: updateShepherdingPersonDetails,
    setShepherdingStatus: setShepherdingStatus,
    toggleShepherdingTag: toggleShepherdingTag,
    setMembership: setMembership,
    getFamilies: getFamilies,
    getRelationships: getRelationships,
    getRelationshipTypes: getRelationshipTypes,
    revertShepherdingStatus: revertShepherdingStatus,
    getShepherdingView: getShepherdingView,
    getCareList: getCareList,
    saveCareList: saveCareList,
    getElderDocuments: getElderDocuments,
    getDocumentStructure: getDocumentStructure,
    saveDocumentStructure: saveDocumentStructure,
    createElderDocument: createElderDocument,
    addElderDocToLibrary: addElderDocToLibrary,
    pruneElderDocsFromLibrary: pruneElderDocsFromLibrary,
    renameElderDocument: renameElderDocument,
    deleteElderDocuments: deleteElderDocuments,
    getElderDocument: getElderDocument,
    saveElderDocument: saveElderDocument,
    getDocMentionData: getDocMentionData,
    addPanelNote: addPanelNote,
    getPanelNote: getPanelNote,
    savePanelNote: savePanelNote,
    updatePanelNoteType: updatePanelNoteType,
    getPersonNotes: getPersonNotes,
    setNoteSourceDoc: setNoteSourceDoc,
    copyNoteContent: copyNoteContent,
    deletePanelNote: deletePanelNote,
    unlinkPanelNote: unlinkPanelNote,
    PRAYER_MESSAGE_DEFAULTS: PRAYER_MESSAGE_DEFAULTS,
    getSmsStatus: getSmsStatus,
    sendTestSms: sendTestSms,
    getSmsReplies: getSmsReplies,
    deleteSmsReply: deleteSmsReply,
    clearSmsReplies: clearSmsReplies,
    getPrayerMessages: getPrayerMessages,
    savePrayerMessages: savePrayerMessages,
    setAutoSend: setAutoSend,
    lc: lc,
  };
})();
