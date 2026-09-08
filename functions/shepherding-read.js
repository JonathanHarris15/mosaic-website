/**
 * Reading a Person's shepherding record, from the server (MS-278).
 *
 * The reads an assistant needs before it may write anything, and the one door
 * from a name to an id.
 *
 * ⚠ shep_find_person IS THE ONLY NAME → ID DOOR, AND IT MUST BE HONEST ABOUT
 * AMBIGUITY. Every write tool takes a person id and none takes a name. Two
 * Sarahs means two results with something to tell them apart by, never a best
 * guess — an agent that guesses which Person a transcript meant writes pastoral
 * history onto a stranger, and nothing about the record afterwards says so.
 *
 * ⚠ THE DIRECTORY IS READ WHOLE, ON PURPOSE. Firestore cannot search inside a
 * string, so a name search is a scan. The People list in the browser already
 * loads every Person for exactly this reason; this is a few hundred small
 * documents, not a table.
 *
 * ⚠ HIDDEN TAGS ARE VISIBLE HERE, AND THAT IS CORRECT. `hiddenFromOthers` and
 * `hidePeople` are lifted for elders — they hide things from everybody else, on
 * an elder's behalf. These tools are elder-gated, so they see everything an
 * elder standing at the People list sees. The tool descriptions say so, because
 * an assistant repeating a private tag into a summary an elder then pastes
 * somewhere is a leak this code cannot prevent.
 */

const ShepherdingCore = require("./shared/shepherding-core.js");
const NoteMarkdownCore = require("./shared/note-markdown-core.js");

const PEOPLE = "people";
const NOTES = "shepherding_notes";
const ACTIVITY = "shepherding_activity";
// ⚠ A Shepherding Tag LIVES IN `people_tags`, not in `shepherding_tags`.
// The domain name and the collection name disagree, and the collection is
// the one every page actually reads and writes (shepherding-tags.js,
// shepherding-profile.js, shepherding-people.js). `shepherding_tags` exists
// in firestore.rules and nothing uses it. Reaching for the name that reads
// correctly here would produce an empty tag list and no error at all.
const TAGS = "people_tags";

// How many People a search hands back before it starts saying "narrow it".
// Enough that a common first name still shows everybody who has it; few enough
// that an assistant is not handed the whole directory to reason about.
const SEARCH_LIMIT = 25;

// How far back a Pastoral Record reads by default. A year of a well-shepherded
// Person is roughly this, and an assistant summarising a meeting wants recent
// context, not a biography.
const RECORD_LIMIT = 40;

/** Whatever Firestore gave us, as milliseconds, or 0. */
function millis(value) {
  if (!value) return 0;
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
}

/** A timestamp an assistant can read, rather than a Firestore sentinel. */
function isoOf(value) {
  const ms = millis(value);
  return ms ? new Date(ms).toISOString() : null;
}

/** Everyone, as plain objects with their id. */
async function allPeople(db) {
  const snap = await db.collection(PEOPLE).get();
  return snap.docs.map((doc) => Object.assign({id: doc.id}, doc.data()));
}

/** Every Shepherding Tag, by id. */
async function tagsById(db) {
  const snap = await db.collection(TAGS).get();
  const byId = {};
  snap.docs.forEach((doc) => {
    byId[doc.id] = Object.assign({id: doc.id}, doc.data());
  });
  return byId;
}

/** The bones of a Person, enough to tell two of them apart. */
function personSummary(person, tags) {
  const membership = person.membership || {};
  return {
    personId: person.id,
    name: person.name || "",
    email: person.email || null,
    phone: person.phone || null,
    membershipStage: membership.stage || null,
    inactive: ShepherdingCore.isInactiveMembership(membership),
    shepherdingStatus: person.shepherdingStatus || null,
    assignedElderId: (person.shepherding && person.shepherding.assignedElderId) || null,
    tags: (person.tags || []).map((id) => ({
      tagId: id,
      name: (tags[id] && tags[id].name) || id,
    })),
  };
}

/**
 * Name, email or phone → the People it could be.
 *
 * Matching is case-insensitive and on any part of the name, because a
 * transcript says "Sarah" and the directory says "Sarah Bell". Whole-word
 * matches sort first so the obvious answer is the first answer, but every
 * match is returned — the sorting is a courtesy, not a decision.
 *
 * @param {object} db the Firestore handle
 * @param {object} args
 * @param {string} args.query what to look for
 * @param {number} [args.limit] how many to return at most
 * @return {Promise<object>} { query, matches, count, truncated }
 */
async function findPerson(db, {query, limit}) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) {
    return {query: "", matches: [], count: 0, truncated: false,
      note: "Give a name, an email address or a phone number to search for."};
  }

  const [people, tags] = await Promise.all([allPeople(db), tagsById(db)]);
  const digits = needle.replace(/\D/g, "");

  const scored = [];
  people.forEach((person) => {
    const name = String(person.name || "").toLowerCase();
    const email = String(person.email || "").toLowerCase();
    const phone = String(person.phone || "").replace(/\D/g, "");

    let score = -1;
    if (name === needle) score = 0;
    else if (name.split(/\s+/).includes(needle)) score = 1;
    else if (name.startsWith(needle)) score = 2;
    else if (name.includes(needle)) score = 3;
    else if (email && email.includes(needle)) score = 4;
    else if (digits.length >= 4 && phone.includes(digits)) score = 5;

    if (score !== -1) scored.push({score, person});
  });

  scored.sort((a, b) => a.score - b.score ||
      String(a.person.name || "").localeCompare(String(b.person.name || "")));

  const cap = Math.max(1, Math.min(Number(limit) || SEARCH_LIMIT, 100));
  const matches = scored.slice(0, cap)
      .map((s) => personSummary(s.person, tags));

  return {
    query: String(query).trim(),
    matches,
    count: scored.length,
    truncated: scored.length > cap,
    // Said out loud rather than left for an assistant to infer from the array
    // length, because the failure this guards against is confident guessing.
    note: matches.length === 1 ? "One match." :
      matches.length === 0 ? "Nobody in the directory matches that." :
        `${scored.length} people match. Do not guess — ask which one is meant.`,
  };
}

/**
 * One Person's Shepherding Profile: who they are and where they stand.
 *
 * @param {object} db the Firestore handle
 * @param {object} args personId, and optionally recordLimit
 * @return {Promise<object>} the profile
 */
async function getProfile(db, {personId, recordLimit}) {
  const snap = await db.collection(PEOPLE).doc(personId).get();
  if (!snap.exists) {
    return {found: false, personId,
      note: "No Person with that id. Use shep_find_person to look somebody up."};
  }

  const person = Object.assign({id: personId}, snap.data());
  const [tags, record] = await Promise.all([
    tagsById(db),
    getPastoralRecord(db, {personId, limit: recordLimit || 10}),
  ]);

  let assignedElder = null;
  const elderId = (person.shepherding && person.shepherding.assignedElderId) || null;
  if (elderId) {
    const elder = await db.collection(PEOPLE).doc(elderId).get();
    assignedElder = {
      personId: elderId,
      name: (elder.exists && elder.data().name) || "",
    };
  }

  return Object.assign({found: true}, personSummary(person, tags), {
    assignedElder,
    birthday: person.birthday || null,
    sex: person.sex || null,
    recentRecord: record.entries,
    recordTruncated: record.truncated,
  });
}

/**
 * The Pastoral Record: Shepherding Notes, Status Changes, Tag Changes,
 * Membership Changes and Assignment Changes, newest first.
 *
 * Assembled by ShepherdingCore, the same module the Shepherding Profile uses,
 * so an assistant and the page read one Person's history the same way.
 *
 * @param {object} db the Firestore handle
 * @param {object} args personId, limit
 * @return {Promise<object>} { personId, entries, truncated }
 */
async function getPastoralRecord(db, {personId, limit}) {
  const cap = Math.max(1, Math.min(Number(limit) || RECORD_LIMIT, 200));
  const personRef = db.collection(PEOPLE).doc(personId);

  const [noteSnap, activitySnap] = await Promise.all([
    personRef.collection(NOTES).get(),
    personRef.collection(ACTIVITY).get(),
  ]);

  const notes = noteSnap.docs.map((d) => Object.assign({id: d.id}, d.data()));
  const activity = activitySnap.docs.map((d) => Object.assign({id: d.id}, d.data()));

  const assembled = ShepherdingCore.assemblePastoralRecord(notes, activity);
  const entries = assembled.slice(0, cap).map(readableEntry);

  return {
    personId,
    entries,
    count: assembled.length,
    truncated: assembled.length > cap,
  };
}

/**
 * One Pastoral Record entry as prose rather than as stored fields.
 *
 * A Note Body comes back as markdown; a Status or Tag Change comes back with
 * the sentence ShepherdingCore would have drawn, so an assistant summarising a
 * record does not have to reinvent the wording the page shows.
 *
 * @param {object} entry the assembled entry
 * @return {object} the readable form
 */
function readableEntry(entry) {
  const base = {
    id: entry.id,
    kind: entry._entryKind,
    at: isoOf(entry.createdAt),
    author: entry.authorName || entry.createdByName || "",
    writtenVia: entry.writtenVia || "page",
  };

  if (entry._entryKind === "note") {
    return Object.assign(base, {
      noteType: entry.type || "",
      subject: entry.subject || "",
      body: NoteMarkdownCore.toMarkdown(entry.contentJson),
      sourceDocumentId: entry.sourceDocumentId || null,
    });
  }

  if (entry._entryKind === "membership_change") {
    return Object.assign(base, {
      summary: ShepherdingCore.describeMembershipChange(entry),
      explanation: entry.explanation || "",
    });
  }

  if (entry._entryKind === "assignment_change") {
    return Object.assign(base, {
      summary: ShepherdingCore.describeAssignmentChange(entry),
      explanation: entry.explanation || "",
    });
  }

  if (entry._entryKind === "tag_change") {
    return Object.assign(base, {
      summary: `Tag "${entry.tagName || entry.tagId}" ${entry.action}`,
      tagId: entry.tagId,
      explanation: entry.explanation || "",
    });
  }

  return Object.assign(base, {
    summary: describeStatusChange(entry),
    previousStatus: entry.previousStatus || null,
    newStatus: entry.newStatus || null,
    explanation: entry.explanation || "",
  });
}

/** The sentence a Status Change reads as. */
function describeStatusChange(entry) {
  const say = (status) => status ?
    `${ShepherdingCore.URGENCY_LABEL[status.urgency] || status.urgency}` +
      ` / ${ShepherdingCore.IMPORTANCE_LABEL[status.importance] || status.importance}` :
    "no status";
  return `Status ${say(entry.previousStatus)} → ${say(entry.newStatus)}`;
}

/**
 * A Person's Shepherding Notes, without the rest of the record.
 * @param {object} db the Firestore handle
 * @param {object} args personId, limit
 * @return {Promise<object>} { personId, notes }
 */
async function listNotes(db, {personId, limit}) {
  const snap = await db.collection(PEOPLE).doc(personId).collection(NOTES).get();
  const notes = snap.docs
      .map((d) => Object.assign({id: d.id}, d.data()))
      .sort((a, b) => millis(b.createdAt) - millis(a.createdAt));

  const cap = Math.max(1, Math.min(Number(limit) || RECORD_LIMIT, 200));
  return {
    personId,
    count: notes.length,
    notes: notes.slice(0, cap).map((note) => ({
      noteId: note.id,
      noteType: note.type || "",
      subject: note.subject || "",
      at: isoOf(note.createdAt),
      author: note.authorName || "",
      writtenVia: note.writtenVia || "page",
      sourceDocumentId: note.sourceDocumentId || null,
      // The list is for choosing which note to open, so the body is a taste
      // rather than the whole thing.
      preview: String(note.content || "").slice(0, 160),
    })),
  };
}

/**
 * One Shepherding Note, Note Body and all.
 * @param {object} db the Firestore handle
 * @param {object} args personId, noteId
 * @return {Promise<object>} the note
 */
async function getNote(db, {personId, noteId}) {
  const snap = await db.collection(PEOPLE).doc(personId)
      .collection(NOTES).doc(noteId).get();
  if (!snap.exists) return {found: false, personId, noteId};

  const note = snap.data();
  return {
    found: true,
    personId,
    noteId,
    noteType: note.type || "",
    subject: note.subject || "",
    body: NoteMarkdownCore.toMarkdown(note.contentJson),
    at: isoOf(note.createdAt),
    updatedAt: isoOf(note.updatedAt),
    author: note.authorName || "",
    writtenVia: note.writtenVia || "page",
    sourceDocumentId: note.sourceDocumentId || null,
  };
}

/**
 * The People list, filtered the way the People list filters it.
 *
 * Every filter here is one the page already offers, applied by the same
 * ShepherdingCore predicates, so a Filtered View an agent builds and a Filtered
 * View an elder builds select the same People.
 *
 * @param {object} db the Firestore handle
 * @param {object} args
 * @param {Array<string>} [args.tagIds] Shepherding Tags to filter on
 * @param {string} [args.tagMode] 'any' (default) or 'all'
 * @param {Array<string>} [args.statusZones] zone keys from ShepherdingCore
 * @param {string} [args.membershipStage] one Membership Stage
 * @param {string} [args.assignedElderId] the Elder's Person id
 * @param {boolean} [args.includeInactive] inactive People are hidden by default
 * @param {object} [args.tagHold] { tagId, days, comparator }
 * @param {number} [args.limit] how many to return
 * @return {Promise<object>} { people, count, truncated }
 */
async function listPeople(db, args) {
  const opts = args || {};
  const [people, tags] = await Promise.all([allPeople(db), tagsById(db)]);

  const wantTags = (opts.tagIds || []).filter(Boolean);
  const mode = opts.tagMode === "all" ? "all" : "any";
  const zones = (opts.statusZones || []).filter(Boolean);

  let matched = people.filter((person) => {
    const carried = person.tags || [];

    if (wantTags.length) {
      const hits = wantTags.filter((id) => carried.includes(id));
      if (mode === "all" ? hits.length !== wantTags.length : !hits.length) return false;
    }

    if (zones.length) {
      const status = person.shepherdingStatus;
      if (!status) return false;
      if (!zones.includes(
          ShepherdingCore.statusZoneKey(status.urgency, status.importance))) return false;
    }

    if (opts.membershipStage) {
      if (((person.membership || {}).stage || null) !== opts.membershipStage) return false;
    }

    if (opts.assignedElderId) {
      const assigned = (person.shepherding && person.shepherding.assignedElderId) || null;
      if (assigned !== opts.assignedElderId) return false;
    }

    // Inactive is orthogonal to the Track (ADR-0012) and hidden by default,
    // exactly as the People list hides it.
    if (!opts.includeInactive &&
        ShepherdingCore.isInactiveMembership(person.membership)) return false;

    return true;
  });

  // Tag Hold is derived from Tag Change history, so it costs a read per Person
  // and is only paid for when it is actually asked for — the People list defers
  // it the same way.
  const hold = opts.tagHold;
  if (hold && hold.tagId) {
    const nowMs = Date.now();
    const kept = [];
    for (const person of matched) {
      const snap = await db.collection(PEOPLE).doc(person.id)
          .collection(ACTIVITY).get();
      const activity = snap.docs.map((d) => d.data());
      const holds = ShepherdingCore.deriveTagHolds(activity, person.tags || [], nowMs);
      const found = holds[hold.tagId];
      if (!found) continue;
      if (!ShepherdingCore.holdSatisfies(
          found.durationMs, Number(hold.days) || 0, hold.comparator || "gte")) continue;
      kept.push(person);
    }
    matched = kept;
  }

  matched.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  const cap = Math.max(1, Math.min(Number(opts.limit) || 100, 500));
  return {
    count: matched.length,
    truncated: matched.length > cap,
    people: matched.slice(0, cap).map((p) => personSummary(p, tags)),
  };
}

module.exports = {
  findPerson,
  getProfile,
  getPastoralRecord,
  listNotes,
  getNote,
  listPeople,
  // Shared with the other read paths, and worth testing directly.
  personSummary,
  readableEntry,
  isoOf,
};
