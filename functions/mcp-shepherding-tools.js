/**
 * The shepherding and calendar tools an assistant can call (MS-278).
 *
 * ⚠ EVERY TOOL HERE DELEGATES. Nothing in this file queries Firestore or
 * decides anything — the same rule mcp-server.js states for the `oos_` tools,
 * for the same reason. The modules underneath (shepherding-read,
 * shepherding-writes, shepherding-tag-writes, shepherding-doc-writes,
 * shepherding-payload-writes, calendar-writes) are the ones the Shepherding
 * Profile's own logic lives in, so an assistant and the page can never be told
 * different things about the same Person. A query in this file is a bug.
 *
 * ⚠ THE GATE IS APPLIED IN ONE PLACE, ON PURPOSE. `elderTool` below is the only
 * way a tool gets registered here, and it does three things every single time:
 * refuses anyone below elder, resolves the Author (refusing rather than writing
 * an untraceable record), and turns a thrown error into a refusal an assistant
 * can read. Registering a tool any other way would be a tool that forgot one of
 * them, which is exactly the failure a per-tool check invites.
 *
 * ⚠ REGISTERED FOR EVERYONE, REFUSED PER CALL. A tool an editor cannot see is a
 * tool that answers "unknown tool" — which reads as a broken server. Every tool
 * is listed and each refuses with a sentence saying it is elder-only and why.
 *
 * ⚠ NO WRITE TOOL TAKES A NAME. `shep_find_person` is the one door from a name
 * to an id; everything else takes the id. An assistant that guesses which Sarah
 * a transcript meant writes pastoral history onto a stranger, and nothing about
 * the record afterwards says so.
 *
 * This file is separate from mcp-server.js only because putting sixty tools
 * beside the twelve would have made neither readable. It is registration and
 * schemas; the sentences an assistant reads are here because a tool's
 * description is part of its interface, not documentation of it.
 */

const {z} = require("zod");

const Actor = require("./mcp-actor.js");
const Firestore = require("./mcp-firestore.js");
const {jsonResult, refuse} = require("./mcp-result.js");

const Read = require("./shepherding-read.js");
const Writes = require("./shepherding-writes.js");
const Tags = require("./shepherding-tag-writes.js");
const Docs = require("./shepherding-doc-writes.js");
const Payload = require("./shepherding-payload-writes.js");
const Cal = require("./calendar-writes.js");
const Tasks = require("./task-writes.js");

// Said once, appended to every tool that can reach a Person's record. An
// assistant summarising a meeting into a message an elder then pastes somewhere
// is a leak this code cannot prevent, so it is named where the assistant reads.
const PRIVACY =
  " Elder-only. What comes back includes tags and notes that are hidden from " +
  "everyone below elder — do not repeat them anywhere the elder has not asked " +
  "for them.";

const personId = z.string().min(1).describe(
    "The Person's id, from shep_find_person. Never a name, and never guessed.");

/**
 * Register one tool, with the gate, the Author and the refusals attached.
 *
 * @param {object} server the McpServer
 * @param {object} deps {db, auth}
 * @param {string} name the tool name
 * @param {object} spec title, description, inputSchema, annotations
 * @param {function(object, ?object): Promise<*>} run given the arguments and
 *   the resolved Author (null for a read-only tool), returns what to hand back
 */
function elderTool(server, deps, name, spec, run) {
  const readOnly = !!(spec.annotations && spec.annotations.readOnlyHint);

  server.registerTool(name, spec, async (args) => {
    const level = deps.auth && deps.auth.permissionLevel;
    if (!Actor.isElder(level)) return refuse(Actor.refusalFor(level));

    try {
      // A read needs no Author. A write refuses without one rather than
      // writing a record nobody can be traced to (CONTEXT.md, Author).
      const actor = readOnly ?
        null : await Actor.requireActor(deps.db, deps.auth.uid);
      return jsonResult(await run(args || {}, actor));
    } catch (e) {
      return refuse(e && e.message ? e.message : "That did not work.");
    }
  });
}

/**
 * Add every `shep_` and `cal_` tool to a server.
 *
 * @param {object} server the McpServer being built
 * @param {object} deps {db, auth}
 */
function register(server, deps) {
  // ⚠ BEFORE ANY TOOL CAN RUN. The write modules take their Firestore
  // sentinels rather than reaching for firebase-admin, because `functions/`
  // carries its own copy and a sentinel from the wrong one cannot be
  // serialised. mcp-firestore.js explains why at length; this is the one call
  // that satisfies it, and doing it here means no tool has to remember.
  Firestore.bind(deps.fieldValues);

  const tool = (name, spec, run) => elderTool(server, deps, name, spec, run);
  const db = deps.db;
  const read = {readOnlyHint: true};

  // ── A. Finding and reading a Person ──────────────────────────────────────

  tool("shep_find_person", {
    title: "Find a person",
    description:
      "Search the church directory by name, email address or phone number, " +
      "and get back the Person id every other tool needs. THE ONLY WAY to " +
      "turn a name into an id. If more than one person matches, ASK WHICH ONE " +
      "IS MEANT — do not pick. Writing a note onto the wrong Sarah is not " +
      "something anybody finds out about later." + PRIVACY,
    inputSchema: {
      query: z.string().min(1).describe("A name, part of a name, an email or a phone number"),
      limit: z.number().int().positive().optional().describe("How many to return (default 25)"),
    },
    annotations: read,
  }, (a) => Read.findPerson(db, a));

  tool("shep_get_profile", {
    title: "A person's Shepherding Profile",
    description:
      "Everything an elder sees at the top of somebody's Shepherding Profile: " +
      "their Shepherding Status, their Shepherding Tags, their Membership " +
      "Stage, the elder assigned to them, and the most recent entries in " +
      "their Pastoral Record. Read this before writing about somebody — it is " +
      "how you find out what has already been said." + PRIVACY,
    inputSchema: {
      personId,
      recordLimit: z.number().int().positive().optional()
          .describe("How many recent Pastoral Record entries to include (default 10)"),
    },
    annotations: read,
  }, (a) => Read.getProfile(db, a));

  tool("shep_get_pastoral_record", {
    title: "A person's Pastoral Record",
    description:
      "The full reverse-chronological feed for one Person: Shepherding Notes, " +
      "Status Changes, Tag Changes, Membership Changes and Assignment " +
      "Changes, interleaved. Note bodies come back as markdown. Each entry " +
      "says whether a person typed it or an assistant wrote it." + PRIVACY,
    inputSchema: {
      personId,
      limit: z.number().int().positive().optional().describe("How many entries (default 40)"),
    },
    annotations: read,
  }, (a) => Read.getPastoralRecord(db, a));

  tool("shep_list_notes", {
    title: "A person's notes",
    description:
      "Just the Shepherding Notes on one Person, newest first, with a short " +
      "preview of each rather than the whole body. Use this to choose which " +
      "note to open or to add to, then shep_get_note or shep_append_to_note." +
      PRIVACY,
    inputSchema: {
      personId,
      limit: z.number().int().positive().optional().describe("How many notes (default 40)"),
    },
    annotations: read,
  }, (a) => Read.listNotes(db, a));

  tool("shep_get_note", {
    title: "One note",
    description:
      "One Shepherding Note in full, its Note Body as markdown. Read a note " +
      "before editing it — shep_edit_note replaces the body rather than " +
      "merging into it." + PRIVACY,
    inputSchema: {
      personId,
      noteId: z.string().min(1).describe("The note's id, from shep_list_notes"),
    },
    annotations: read,
  }, (a) => Read.getNote(db, a));

  tool("shep_list_people", {
    title: "The People list, filtered",
    description:
      "Everybody in the directory, filtered the way the People list filters " +
      "them: by Shepherding Tag (any of them or all of them), by status zone, " +
      "by Membership Stage, by which elder they are assigned to, and by how " +
      "long a tag has been carried. Answering 'who has not been visited " +
      "since June' is this tool, NOT shep_create_view — a view changes what " +
      "every elder sees on their landing page." + PRIVACY,
    inputSchema: {
      tagIds: z.array(z.string()).optional().describe("Shepherding Tag ids to filter on"),
      tagMode: z.enum(["any", "all"]).optional().describe("Carrying any of those tags, or all of them (default any)"),
      statusZones: z.array(z.string()).optional()
          .describe("Status zone keys, e.g. 'urgent__important'"),
      membershipStage: z.string().optional()
          .describe("visitor, regular_attender, prospective_member, member, moving_membership or previous_member"),
      assignedElderId: z.string().optional().describe("The elder's Person id"),
      includeInactive: z.boolean().optional()
          .describe("Inactive People are left out unless this is true"),
      tagHold: z.object({
        tagId: z.string(),
        days: z.number().int().nonnegative(),
        comparator: z.enum(["gte", "lt"]).optional(),
      }).optional().describe("Held a tag for at least (gte) or less than (lt) this many days"),
      limit: z.number().int().positive().optional().describe("How many People (default 100)"),
    },
    annotations: read,
  }, (a) => Read.listPeople(db, a));

  // ── B. Writing on a Person ───────────────────────────────────────────────

  tool("shep_write_note", {
    title: "Write a note on a person",
    description:
      "Add a new Shepherding Note to somebody's Pastoral Record. The body is " +
      "markdown — headings, bold, lists, tables and links all survive into " +
      "the editor an elder opens it in. BEFORE REACHING FOR THIS, check " +
      "shep_list_notes: if there is already a note about the same " +
      "conversation, shep_append_to_note keeps it as one record instead of " +
      "leaving an elder two half-records to reconcile.",
    inputSchema: {
      personId,
      type: z.string().describe(
          "The Note Type: Elder Check-in, Elder Interview, Elder Meeting, " +
          "Life Update, Prayer Request or Other"),
      subject: z.string().optional()
          .describe("A short Subject Line — how the note is named in lists"),
      markdown: z.string().min(1).describe("The Note Body, as markdown"),
    },
  }, (a, actor) => Writes.writeNote(db, Object.assign({}, a, {actor})));

  tool("shep_append_to_note", {
    title: "Add to a note",
    description:
      "Add to the end of a Shepherding Note that already exists, rather than " +
      "making a second note about the same conversation. This is usually the " +
      "right tool when an elder tells you more about something already " +
      "recorded today.",
    inputSchema: {
      personId,
      noteId: z.string().min(1).describe("The note to grow, from shep_list_notes"),
      markdown: z.string().min(1).describe("What to add, as markdown"),
    },
  }, (a, actor) => Writes.appendToNote(db, Object.assign({}, a, {actor})));

  tool("shep_edit_note", {
    title: "Change a note",
    description:
      "Change a Shepherding Note's type, subject or body. ⚠ The body is " +
      "REPLACED, not merged — read the note first with shep_get_note, or use " +
      "shep_append_to_note if you only mean to add. Anything left out is left " +
      "as it was.",
    inputSchema: {
      personId,
      noteId: z.string().min(1).describe("The note to change"),
      type: z.string().optional().describe("A new Note Type"),
      subject: z.string().optional().describe("A new Subject Line"),
      markdown: z.string().optional().describe("A new Note Body, replacing the old one"),
    },
  }, (a, actor) => Writes.editNote(db, Object.assign({}, a, {actor})));

  tool("shep_delete_note", {
    title: "Delete a note",
    description:
      "Remove a Shepherding Note for good. There is no undo and the page's " +
      "confirmation dialog is not available to you, so say what you are about " +
      "to delete and get a clear yes first. What was deleted comes back in " +
      "the result. A note belonging to a Person Panel in an Elder Document is " +
      "refused — remove the panel from the document instead.",
    inputSchema: {
      personId,
      noteId: z.string().min(1).describe("The note to delete"),
    },
  }, (a) => Writes.deleteNote(db, a));

  tool("shep_set_status", {
    title: "Set a person's status",
    description:
      "Set somebody's Shepherding Status — how urgent and how important the " +
      "attention they need is — and log the Status Change on their Pastoral " +
      "Record. The Explanation is where the reason goes, and it is worth " +
      "filling in: a status with no reason is a flag nobody can act on.",
    inputSchema: {
      personId,
      urgency: z.enum(["urgent", "somewhat_urgent", "not_urgent"]),
      importance: z.enum(["important", "somewhat_important", "not_important"]),
      explanation: z.string().optional().describe("Why, in plain text"),
    },
  }, (a, actor) => Writes.setStatus(db, Object.assign({}, a, {actor})));

  tool("shep_clear_status", {
    title: "Clear a person's status",
    description:
      "Take somebody's Shepherding Status off, and record the Status Change " +
      "that says so. Use this when the thing that raised it is settled — the " +
      "record keeps the history either way.",
    inputSchema: {
      personId,
      explanation: z.string().optional().describe("Why it is being cleared"),
    },
  }, (a, actor) => Writes.clearStatus(db, Object.assign({}, a, {actor})));

  tool("shep_add_tags", {
    title: "Apply tags to a person",
    description:
      "Put one or more Shepherding Tags on somebody, logging a Tag Change for " +
      "each. Tags are the main thing Filtered Views and the People list filter " +
      "on, so this is how somebody ends up on the right list. Membership Tags " +
      "and the Elder Tag are refused — those follow the Membership Track and " +
      "the Elder role, not manual tagging.",
    inputSchema: {
      personId,
      tagIds: z.array(z.string().min(1)).min(1).describe("Tag ids, from shep_list_tags"),
      explanation: z.string().optional().describe("Why, in plain text"),
    },
  }, (a, actor) => Writes.addTags(db, Object.assign({}, a, {actor})));

  tool("shep_remove_tags", {
    title: "Take tags off a person",
    description:
      "Take one or more Shepherding Tags off somebody, logging a Tag Change " +
      "for each. The Tag Changes already in their Pastoral Record stay — the " +
      "tag really did apply at the time, and the record says so.",
    inputSchema: {
      personId,
      tagIds: z.array(z.string().min(1)).min(1).describe("Tag ids to remove"),
      explanation: z.string().optional().describe("Why, in plain text"),
    },
  }, (a, actor) => Writes.removeTags(db, Object.assign({}, a, {actor})));

  tool("shep_set_membership_stage", {
    title: "Move somebody along the Membership Track",
    description:
      "Set somebody's Membership Stage, or mark them inactive. The Membership " +
      "Tags are re-projected automatically and emit no Tag Changes of their " +
      "own — the Membership Change is the record. Inactive is separate from " +
      "the stage: somebody can be marked inactive without losing the stage " +
      "they had.",
    inputSchema: {
      personId,
      stage: z.string().nullable().optional().describe(
          "visitor, regular_attender, prospective_member, member, " +
          "moving_membership, previous_member — or null to leave the Track"),
      inactive: z.boolean().optional().describe("Mark them inactive"),
      explanation: z.string().optional().describe("Why, in plain text"),
    },
  }, (a, actor) => Writes.setMembershipStage(db, Object.assign({}, a, {actor})));

  tool("shep_set_elder_assignment", {
    title: "Assign somebody to an elder",
    description:
      "Say which elder shepherds this Person, or clear the assignment by " +
      "passing null. The elder is given by their PERSON id, not a user " +
      "account, and must carry the Elder Tag — an assignment to somebody who " +
      "is not an elder would never appear in anybody's Care Group.",
    inputSchema: {
      personId,
      elderPersonId: z.string().nullable().describe(
          "The elder's Person id, or null to clear the assignment"),
      explanation: z.string().optional().describe("Why, in plain text"),
    },
  }, (a, actor) => Writes.setElderAssignment(db, Object.assign({}, a, {actor})));

  tool("shep_explain_change", {
    title: "Explain a change already recorded",
    description:
      "Put an Explanation on a Status, Tag, Membership or Assignment Change " +
      "that is already in a Pastoral Record — the reason, after the fact. " +
      "Plain text, no formatting. A Shepherding Note is edited with " +
      "shep_edit_note instead; this is only for the change entries.",
    inputSchema: {
      personId,
      activityId: z.string().min(1)
          .describe("The entry's id, from shep_get_pastoral_record"),
      explanation: z.string().describe("The reason, in plain text"),
    },
  }, (a) => Writes.explainChange(db, a));

  // ── C. The Shepherding Tags themselves ───────────────────────────────────

  tool("shep_list_tags", {
    title: "Every Shepherding Tag",
    description:
      "All the Shepherding Tags, with their ids — which every tagging tool " +
      "needs — and both of their hiding flags. `hidePeople` hides the PEOPLE " +
      "carrying the tag from the directory; `hiddenFromOthers` hides the " +
      "tag's NAME. Tags marked projected are set by the Membership Track or " +
      "the Elder role and cannot be edited by hand." + PRIVACY,
    inputSchema: {},
    annotations: read,
  }, () => Tags.listTags(db));

  tool("shep_create_tag", {
    title: "Make a new tag",
    description:
      "Create a Shepherding Tag. Check shep_list_tags first — a second tag " +
      "with nearly the same name splits the people who should be on one list, " +
      "and this refuses an exact duplicate but cannot catch a near one.",
    inputSchema: {
      name: z.string().min(1).describe("What the tag is called"),
      hidePeople: z.boolean().optional()
          .describe("Hide the people carrying it from the member-facing directory"),
      hiddenFromOthers: z.boolean().optional()
          .describe("Hide the tag's own name from everyone below elder"),
    },
  }, (a) => Tags.createTag(db, a));

  tool("shep_rename_tag", {
    title: "Rename a tag",
    description:
      "Change a tag's display name. Nothing else moves: a tag's identity is " +
      "its id, so everybody carrying it still carries it and every Filtered " +
      "View built on it still works. Safe, and not the same as merging.",
    inputSchema: {
      tagId: z.string().min(1),
      name: z.string().min(1).describe("The new name"),
    },
  }, (a) => Tags.renameTag(db, a));

  tool("shep_preview_tag_merge", {
    title: "What a merge would do",
    description:
      "Read what shep_merge_tags is about to do without doing it: which tags " +
      "are folded away, how many people move, which id survives. CALL THIS " +
      "FIRST and read it back to the elder. A merge cannot be undone.",
    inputSchema: {
      tagIds: z.array(z.string().min(1)).min(1).describe("The tags to fold away"),
      survivorTagId: z.string().min(1).describe("The tag that survives"),
    },
    annotations: read,
  }, (a) => Tags.previewMerge(db, a));

  tool("shep_merge_tags", {
    title: "Merge tags",
    description:
      "Fold one or more Shepherding Tags into another. Everybody carrying the " +
      "merged tags is moved onto the survivor, their Tag Changes are " +
      "re-pointed so it inherits the history, and the merged tags are " +
      "deleted. ⚠ THIS CANNOT BE UNDONE and it rewrites Pastoral Records " +
      "across the whole directory. Run shep_preview_tag_merge, read it back, " +
      "and get an explicit yes before calling this.",
    inputSchema: {
      tagIds: z.array(z.string().min(1)).min(1).describe("The tags to fold away"),
      survivorTagId: z.string().min(1).describe("The tag that survives"),
    },
  }, (a) => Tags.mergeTags(db, a));

  tool("shep_delete_tag", {
    title: "Delete a tag",
    description:
      "Delete a Shepherding Tag and take it off everybody carrying it. The " +
      "count comes back in the result. Tag Changes already in Pastoral " +
      "Records are left alone — the tag really was applied at the time. There " +
      "is no undo, so confirm before calling.",
    inputSchema: {tagId: z.string().min(1)},
  }, (a) => Tags.deleteTag(db, a));

  // ── D. The Document Library ──────────────────────────────────────────────

  tool("shep_list_documents", {
    title: "What is in the Document Library",
    description:
      "The Elder Documents and Folders in the Library, or inside one Folder. " +
      "Pass recursive for everything below a Folder at any depth. Start here " +
      "to find where a document lives before moving or opening it." + PRIVACY,
    inputSchema: {
      folderId: z.string().optional().describe("A Folder id; the top level if left out"),
      recursive: z.boolean().optional().describe("Every document below it, at any depth"),
    },
    annotations: read,
  }, (a) => Docs.listDocuments(db, a));

  tool("shep_get_document", {
    title: "Read an Elder Document",
    description:
      "One Elder Document, its body as markdown. A Care List or a Form " +
      "Document carries a payload rather than prose and the result says which " +
      "tool opens it properly." + PRIVACY,
    inputSchema: {documentId: z.string().min(1)},
    annotations: read,
  }, (a) => Docs.getDocument(db, a));

  tool("shep_create_document", {
    title: "Make an Elder Document",
    description:
      "Create an Elder Document — Meeting Minutes, a summary, anything an " +
      "elder would open a blank page for. The body is markdown. To make " +
      "minutes that put a note on each person discussed, create the document " +
      "here and then call shep_add_person_panel once per person.",
    inputSchema: {
      title: z.string().optional().describe("What it is called"),
      markdown: z.string().optional().describe("The body, as markdown"),
      folderId: z.string().optional().describe("Which Folder to file it in"),
      ownerPersonId: z.string().optional()
          .describe("A Person, if this belongs on their profile as well"),
    },
  }, (a, actor) => Docs.createDocument(db, Object.assign({}, a, {actor})));

  tool("shep_update_document", {
    title: "Change an Elder Document",
    description:
      "Replace an Elder Document's title, body or both. ⚠ The body is " +
      "REPLACED — read it first with shep_get_document, or use " +
      "shep_append_to_document to add to the end without touching what is " +
      "there.",
    inputSchema: {
      documentId: z.string().min(1),
      title: z.string().optional(),
      markdown: z.string().optional().describe("A new body, replacing the old one"),
    },
  }, (a, actor) => Docs.updateDocument(db, Object.assign({}, a, {actor})));

  tool("shep_append_to_document", {
    title: "Add to an Elder Document",
    description:
      "Add to the end of an Elder Document, leaving everything already in it " +
      "alone. The safe way to add to minutes somebody else is also writing.",
    inputSchema: {
      documentId: z.string().min(1),
      markdown: z.string().min(1).describe("What to add, as markdown"),
    },
  }, (a, actor) => Docs.appendToDocument(db, Object.assign({}, a, {actor})));

  tool("shep_rename_document", {
    title: "Rename an Elder Document",
    description:
      "Change what an Elder Document is called. Nothing else about it moves — " +
      "it stays in the same Folder with the same body and the same author.",
    inputSchema: {
      documentId: z.string().min(1),
      title: z.string().min(1).describe("The new title"),
    },
  }, (a, actor) => Docs.renameDocument(db, Object.assign({}, a, {actor})));

  tool("shep_move_document", {
    title: "File a document elsewhere",
    description:
      "Move an Elder Document into a different Folder. Only where it sits " +
      "changes; the document itself is untouched. Leave folderId out to move " +
      "it to the top level.",
    inputSchema: {
      documentId: z.string().min(1),
      folderId: z.string().optional().describe("The Folder to move it into; top level if left out"),
    },
  }, (a) => Docs.moveDocument(db, a));

  tool("shep_delete_document", {
    title: "Delete an Elder Document",
    description:
      "Delete an Elder Document for good. Shepherding Notes made from Person " +
      "Panels inside it stay on their People — those are the pastoral record, " +
      "this was only the meeting. No undo; confirm first.",
    inputSchema: {documentId: z.string().min(1)},
  }, (a) => Docs.deleteDocument(db, a));

  tool("shep_create_folder", {
    title: "Make a Folder",
    description:
      "Create a Folder in the Document Library, optionally inside another " +
      "one. Folders can nest as deep as you like.",
    inputSchema: {
      name: z.string().min(1).describe("What the Folder is called"),
      parentFolderId: z.string().optional().describe("The Folder to put it in"),
    },
  }, (a) => Docs.createFolder(db, a));

  tool("shep_rename_folder", {
    title: "Rename a Folder",
    description:
      "Change a Folder's name. Everything inside it stays where it is.",
    inputSchema: {
      folderId: z.string().min(1),
      name: z.string().min(1).describe("The new name"),
    },
  }, (a) => Docs.renameFolder(db, a));

  tool("shep_move_folder", {
    title: "Move a Folder",
    description:
      "Move a Folder, and everything inside it, into another Folder. Moving a " +
      "Folder into one of its own sub-folders is refused — that would take " +
      "the whole subtree out of the Library at once.",
    inputSchema: {
      folderId: z.string().min(1),
      targetFolderId: z.string().optional().describe("Where to move it; top level if left out"),
    },
  }, (a) => Docs.moveFolder(db, a));

  tool("shep_delete_folder", {
    title: "Delete a Folder and everything in it",
    description:
      "Delete a Folder AND EVERY ELDER DOCUMENT INSIDE IT, at any depth. " +
      "⚠ Call it once without confirmDocumentCount: it refuses and tells you " +
      "how many documents are in there. Say that number to the elder, get a " +
      "yes, then call again passing it. No undo.",
    inputSchema: {
      folderId: z.string().min(1),
      confirmDocumentCount: z.number().int().nonnegative().optional().describe(
          "How many documents you have confirmed will be destroyed"),
    },
  }, (a) => Docs.deleteFolder(db, a));

  tool("shep_add_person_panel", {
    title: "Put a person into a document",
    description:
      "Add a Person Panel to an Elder Document, creating the Shepherding Note " +
      "it is linked to on that Person's profile. THIS IS THE TOOL FOR ELDER " +
      "MEETING MINUTES: make one document for the meeting, then call this " +
      "once per person discussed. Each note lands on that Person's Pastoral " +
      "Record and links back to the meeting it came from, so nobody has to " +
      "copy anything anywhere afterwards.",
    inputSchema: {
      documentId: z.string().min(1).describe("The document the panel goes in"),
      personId,
      noteType: z.string().optional()
          .describe("The Note Type; Elder Meeting if left out"),
      markdown: z.string().optional()
          .describe("What was said about them, as markdown"),
    },
  }, (a, actor) => Docs.addPersonPanel(db, Object.assign({}, a, {actor})));

  // ── E. Form Documents ────────────────────────────────────────────────────

  tool("shep_list_form_templates", {
    title: "Forms that can be filled in as a record",
    description:
      "The Form Templates a Form Document can be started from — elder " +
      "interviews and the like, filled in once as a record rather than sent " +
      "out for answers. Each question says whether you can answer it: an " +
      "upload needs a file, which you do not have." + PRIVACY,
    inputSchema: {},
    annotations: read,
  }, () => Payload.listFormTemplates(db));

  tool("shep_create_form_document", {
    title: "Start a form document about somebody",
    description:
      "Start a Form Document from a template, about a Person. It takes a COPY " +
      "of the template's questions, so editing the template later never " +
      "reaches this record. The questions come back in the result, ready for " +
      "shep_answer_form_document.",
    inputSchema: {
      templateId: z.string().min(1).describe("From shep_list_form_templates"),
      personId: z.string().optional().describe("Who it is about"),
      title: z.string().optional().describe("What to call it; the template's name if left out"),
      folderId: z.string().optional().describe("Which Folder to file it in"),
    },
  }, (a, actor) => Payload.createFormDocument(db, Object.assign({}, a, {actor})));

  tool("shep_get_form_document", {
    title: "Read a form document",
    description:
      "A Form Document's questions with whatever has been answered so far, " +
      "so you can see what is still blank before filling anything in." + PRIVACY,
    inputSchema: {documentId: z.string().min(1)},
    annotations: read,
  }, (a) => Payload.getFormDocument(db, a));

  tool("shep_answer_form_document", {
    title: "Fill in a form document",
    description:
      "Answer, or change, a Form Document's questions. Pass answers keyed by " +
      "question id. Anything refused comes back in `skipped` with the reason " +
      "— a date that is not a date, a choice never offered, or an upload, " +
      "which needs a file you do not have. Only the answers move; the " +
      "questions are the record's own copy.",
    inputSchema: {
      documentId: z.string().min(1),
      answers: z.record(z.any()).describe("Answers keyed by question id"),
    },
  }, (a, actor) => Payload.answerFormDocument(db, Object.assign({}, a, {actor})));

  // ── F. Care Lists ────────────────────────────────────────────────────────

  tool("shep_create_care_list", {
    title: "Make a Care List",
    description:
      "Create a Care List — a filtered list of People with elder-written " +
      "columns beside each. ⚠ What gets written in its cells is PRIVATE TO " +
      "THIS DOCUMENT and never reaches anybody's Shepherding Profile. If what " +
      "you have to record is about a person, shep_write_note is almost always " +
      "the right tool instead.",
    inputSchema: {
      title: z.string().optional().describe("What the list is called"),
      viewId: z.string().optional().describe("An existing Filtered View to read"),
      filter: z.object({
        tagIds: z.array(z.string()).optional(),
        tagMode: z.enum(["any", "all"]).optional(),
        statusZones: z.array(z.string()).optional(),
      }).optional().describe("A filter of its own, when no viewId is given"),
      columns: z.array(z.string()).optional().describe("Column names; one called Notes if left out"),
      folderId: z.string().optional().describe("Which Folder to file it in"),
    },
  }, (a, actor) => Payload.createCareList(db, Object.assign({}, a, {actor})));

  tool("shep_get_care_list", {
    title: "Read a Care List",
    description:
      "A Care List: its columns, who is on it, and what each cell says as " +
      "markdown. Who is on it is worked out from its filter every time, so it " +
      "changes as people's tags and statuses change." + PRIVACY,
    inputSchema: {documentId: z.string().min(1)},
    annotations: read,
  }, (a) => Payload.getCareList(db, a));

  tool("shep_add_care_list_column",
      {
        title: "Add a column to a Care List",
        description:
      "Add a column to a Care List. Existing cells stay where they are; the " +
      "new column starts empty for everybody on the list.",
        inputSchema: {
          documentId: z.string().min(1),
          name: z.string().min(1).describe("What the column is called"),
        },
      }, (a, actor) => Payload.addCareListColumn(db, Object.assign({}, a, {actor})));

  tool("shep_write_care_list_cell", {
    title: "Write in a Care List cell",
    description:
      "Write one Person's cell in a Care List, as markdown. ⚠ This does not " +
      "reach their Shepherding Profile — an elder looking at that Person will " +
      "not find it. Use shep_write_note for anything that should be findable " +
      "from their side.",
    inputSchema: {
      documentId: z.string().min(1),
      personId,
      columnId: z.string().optional().describe("Which column; the first one if left out"),
      markdown: z.string().describe("What the cell says, as markdown"),
    },
  }, (a, actor) => Payload.writeCareListCell(db, Object.assign({}, a, {actor})));

  // ── G. The Shepherd Landing Page ─────────────────────────────────────────

  tool("shep_list_views", {
    title: "The Filtered Views",
    description:
      "The Filtered Views on the Shepherd Landing Page — the saved filters " +
      "every elder sees as table widgets when they open it." + PRIVACY,
    inputSchema: {},
    annotations: read,
  }, () => Payload.listViews(db));

  tool("shep_create_view", {
    title: "Make a Filtered View",
    description:
      "Create a Filtered View. ⚠ THIS IS SHARED. It appears on EVERY elder's " +
      "Shepherd Landing Page, not just the one you are working for. To answer " +
      "a question about who matches a filter without changing anybody's " +
      "screen, use shep_list_people instead. Only make one when an elder has " +
      "actually asked for a standing list.",
    inputSchema: {
      title: z.string().min(1).describe("What the view is called"),
      filter: z.object({
        tagIds: z.array(z.string()).optional(),
        tagMode: z.enum(["any", "all"]).optional(),
        statusZones: z.array(z.string()).optional(),
      }).describe("What it selects"),
    },
  }, (a, actor) => Payload.createView(db, Object.assign({}, a, {actor})));

  tool("shep_update_view", {
    title: "Change a Filtered View",
    description:
      "Change a Filtered View's title or filter. Shared, so this changes what " +
      "every elder sees on their landing page.",
    inputSchema: {
      viewId: z.string().min(1),
      title: z.string().optional(),
      filter: z.object({
        tagIds: z.array(z.string()).optional(),
        tagMode: z.enum(["any", "all"]).optional(),
        statusZones: z.array(z.string()).optional(),
      }).optional(),
    },
  }, (a, actor) => Payload.updateView(db, Object.assign({}, a, {actor})));

  tool("shep_delete_view", {
    title: "Delete a Filtered View",
    description:
      "Remove a Filtered View from every elder's Shepherd Landing Page. Any " +
      "Care List built on it comes back in the result — those will open on " +
      "nobody once it is gone. No undo; confirm first.",
    inputSchema: {viewId: z.string().min(1)},
  }, (a) => Payload.deleteView(db, a));

  // ── Tasks & Reminders (MS-79) ────────────────────────────────────────────
  //
  // These replace the old shep_*_reminder tools. A Task does not disappear when
  // its date passes — it goes overdue and stays until somebody finishes it
  // (ADR-0058), so "list" now has to say what is late, and there is something
  // to tick off where before there was only something to delete.
  //
  // ⚠ THE PEOPLE ARGUMENT CHANGED MEANING. It used to be "people it is about",
  // checked against the directory. A Task has no such field (ADR-0059) — it
  // names who must DO it, and they must be elders, because anybody else would
  // never see it. An old call passing the congregation will now be refused, and
  // that is the correct outcome rather than a regression.

  tool("shep_list_tasks", {
    title: "What the elders still have to do",
    description:
      "Every Task still outstanding, with who is responsible and which are " +
      "overdue. Unlike the old reminders, a Task whose date has passed is " +
      "still here — that is the point of it. A Task nobody has been given " +
      "reads as unassigned, which means nobody has picked it up yet." + PRIVACY,
    inputSchema: {},
    annotations: read,
  }, () => Tasks.listTasks(db));

  tool("shep_create_task", {
    title: "Write a task down for the elders",
    description:
      "Add a Task. Good for the loose ends at the end of a meeting — write " +
      "them down and hand some of them out in the same breath.\n\n" +
      "It needs a date: without one nothing can ever read as overdue. A time " +
      "on that date is optional and usually wrong to invent.\n\n" +
      "assigneeIds are the ELDERS responsible for it — not the people it is " +
      "about, which a Task does not record. They are checked, and somebody " +
      "who is not an elder is refused by name. Leave it empty and the Task " +
      "shows on every elder's dashboard as unclaimed.\n\n" +
      "Give a recurrence to make it repeat. The reply names the next few " +
      "dates it computes, so a misread pattern is visible now rather than as " +
      "a date quietly missing in three months.",
    inputSchema: {
      title: z.string().min(1).describe("What needs doing"),
      body: z.string().optional().describe("Anything more to say about it"),
      due: z.string().optional().describe("The day it is due, YYYY-MM-DD. Not needed for a repeat, which starts on its own first date"),
      dueTime: z.string().optional().describe("A time on that day, HH:MM. Leave out unless it genuinely matters"),
      assigneeIds: z.array(z.string()).optional().describe("The elders responsible — Person ids, checked against the Elder Tag"),
      recurrence: z.object({
        freq: z.enum(["weekly", "fortnightly", "monthly"]).describe("How often"),
        startDate: z.string().describe("The first date, YYYY-MM-DD"),
        ends: z.object({
          kind: z.enum(["never", "onDate", "afterCount"]),
          date: z.string().optional().describe("For onDate"),
          count: z.number().optional().describe("For afterCount"),
        }).optional(),
      }).optional().describe("Makes it a standing commitment rather than a one-off"),
    },
  }, (a, actor) => Tasks.createTask(db, Object.assign({}, a, {actor})));

  tool("shep_complete_task", {
    title: "Tick a task off",
    description:
      "Mark a Task done. It is kept, never deleted — the completed list is " +
      "how anybody can say what the elders actually did.\n\n" +
      "For a repeating Task give the date of the one you mean: that month is " +
      "finished and the standing commitment carries on.",
    inputSchema: {
      taskId: z.string().min(1),
      date: z.string().optional().describe("Which date, for a repeating Task"),
    },
  }, (a, actor) => Tasks.completeTask(db, Object.assign({}, a, {actor})));

  tool("shep_skip_task", {
    title: "Stand one date of a repeat down",
    description:
      "Skip one date of a repeating Task without claiming it was done — " +
      "December, because it is Christmas. Deliberately not the same as " +
      "ticking it: once things get marked done that were not, the completed " +
      "list stops meaning anything. A one-off cannot be skipped; it is either " +
      "done or deleted.",
    inputSchema: {
      taskId: z.string().min(1),
      date: z.string().min(1).describe("Which date, YYYY-MM-DD"),
    },
  }, (a, actor) => Tasks.skipOccurrence(db, Object.assign({}, a, {actor})));

  tool("shep_delete_task", {
    title: "Delete a task",
    description:
      "Remove a Task written by mistake. A repeat that has finished work " +
      "behind it is STOPPED rather than erased: no more dates, and every " +
      "record of the times it was kept survives, because stopping a " +
      "commitment and denying you kept it are different things. The result " +
      "says which happened.",
    inputSchema: {taskId: z.string().min(1)},
  }, (a) => Tasks.deleteTask(db, a));

  // ── H. The Calendar ──────────────────────────────────────────────────────

  tool("cal_list_events", {
    title: "What is on between two dates",
    description:
      "Every Event occurrence in a date range, including the dates a " +
      "repeating Event computes but has no record for yet. Start here — an " +
      "id from this is what the other cal_ tools take.",
    inputSchema: {
      from: z.string().min(1).describe("The first date, YYYY-MM-DD"),
      to: z.string().min(1).describe("The last date, YYYY-MM-DD"),
      seriesId: z.string().optional().describe("Only dates of this Event"),
    },
    annotations: read,
  }, (a) => Cal.listEvents(db, a));

  tool("cal_get_event", {
    title: "One date",
    description:
      "One Event occurrence: its name, time, place, description and whether " +
      "it has been skipped. A date computed from a pattern has no record " +
      "until something is written on it, so use cal_list_events to see what " +
      "is really there.",
    inputSchema: {eventId: z.string().min(1)},
    annotations: read,
  }, (a) => Cal.getEvent(db, a));

  tool("cal_list_series", {
    title: "The repeating events",
    description:
      "Every repeating Event as an Event rather than as dates: its pattern, " +
      "time, place, colour and who can see it. The Sunday Service is flagged " +
      "— it is locked, and cannot be skipped, moved or renamed.",
    inputSchema: {},
    annotations: read,
  }, () => Cal.listSeries(db));

  tool("cal_create_event", {
    title: "Put a new event on the calendar",
    description:
      "Create an Event. Without a recurrence it is a single dated event; with " +
      "one it is a repeating Event whose dates are computed from the pattern. " +
      "It must say who can see it — that is not optional, and an Event nobody " +
      "can see is the most common way this goes wrong.",
    inputSchema: {
      name: z.string().min(1).describe("What it is called"),
      visibility: z.enum(["public", "member", "participant", "editor", "elder"])
          .describe("The lowest rung that may see it"),
      date: z.string().optional().describe("The date, YYYY-MM-DD, for a one-off"),
      endDate: z.string().optional().describe("The last day, for something spanning days"),
      time: z.string().optional().describe("Start time, HH:MM"),
      location: z.string().optional().describe("Where"),
      description: z.string().optional().describe("A line for anyone who has not been"),
      recurrence: z.object({
        freq: z.string().describe("How often it repeats"),
        startDate: z.string().optional(),
        time: z.string().optional(),
      }).optional().describe("Leave out for a one-off"),
      rosterShared: z.boolean().optional()
          .describe("Whether the people serving can see the rest of the roster"),
    },
  }, (a) => Cal.createEvent(db, a));

  tool("cal_update_event", {
    title: "Change ONE date",
    description:
      "Change one date of an Event — its name, time, place or description — " +
      "leaving every other date alone. ⚠ THIS IS THE ONE-DATE TOOL. To change " +
      "the Event itself across all its dates, that is cal_update_series. Asked " +
      "to 'move Tuesday's prayer meeting', this is the tool for the date and " +
      "cal_move_event for a re-date; reaching for the series would move a year " +
      "of Tuesdays.",
    inputSchema: {
      eventId: z.string().min(1).describe("The occurrence id, from cal_list_events"),
      name: z.string().optional(),
      time: z.string().optional().describe("HH:MM"),
      location: z.string().optional(),
      description: z.string().optional(),
    },
  }, (a) => Cal.updateEvent(db, a));

  tool("cal_update_series", {
    title: "Change the EVENT, across every date",
    description:
      "Change a repeating Event itself: its name, place, description, start " +
      "time or calendar colour. ⚠ THIS AFFECTS EVERY DATE, past and future. " +
      "If the elder means one week, use cal_update_event instead.",
    inputSchema: {
      seriesId: z.string().min(1).describe("From cal_list_series"),
      name: z.string().optional(),
      location: z.string().optional(),
      description: z.string().optional(),
      time: z.string().optional().describe("Start time for every date, HH:MM"),
      colour: z.string().optional()
          .describe("steel, ocean, navy, green, gold, amber, plum or rose"),
    },
  }, (a) => Cal.updateSeries(db, a));

  tool("cal_move_event", {
    title: "Move one date to another date",
    description:
      "Move a single date of a repeating Event to a different date, carrying " +
      "whoever is already down to serve on it. The Sunday Service cannot be " +
      "moved — its order of service lives under its own date.",
    inputSchema: {
      seriesId: z.string().min(1),
      fromDate: z.string().min(1).describe("The date it is on now, YYYY-MM-DD"),
      toDate: z.string().min(1).describe("The date to move it to, YYYY-MM-DD"),
    },
  }, (a) => Cal.moveEvent(db, a));

  tool("cal_cancel_event", {
    title: "Skip one date",
    description:
      "Mark one date of a repeating Event as not happening, or put a skipped " +
      "one back by passing cancelled false. The rest of the dates are " +
      "untouched. The Sunday Service cannot be skipped.",
    inputSchema: {
      seriesId: z.string().min(1),
      date: z.string().min(1).describe("YYYY-MM-DD"),
      cancelled: z.boolean().optional().describe("False puts a skipped date back"),
    },
  }, (a) => Cal.cancelEvent(db, a));

  tool("cal_delete_event", {
    title: "Delete one date",
    description:
      "Delete a single Event occurrence and its roster. Only that date — " +
      "there is deliberately no tool that deletes a whole repeating Event. To " +
      "stop one date happening while keeping the record, cal_cancel_event is " +
      "usually what is meant.",
    inputSchema: {eventId: z.string().min(1)},
  }, (a) => Cal.deleteEvent(db, a));

  tool("cal_create_event_document", {
    title: "Attach a document to an event",
    description:
      "Add a document to one Event occurrence — an agenda, notes, a running " +
      "order. ⚠ Anyone who can see the Event can read it, so this is NOT the " +
      "place for anything pastoral. An Elder Document is elder-only; this is " +
      "not.",
    inputSchema: {
      eventId: z.string().min(1),
      title: z.string().optional(),
      markdown: z.string().optional().describe("The body, as markdown"),
    },
  }, (a, actor) => Cal.createEventDocument(db, Object.assign({}, a, {actor})));
}

module.exports = {register, elderTool, PRIVACY};
