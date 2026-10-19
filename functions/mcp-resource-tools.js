/**
 * The Resources tools an assistant can call (MS-693).
 *
 * The Resources library is one shelf the whole congregation reads: studies,
 * manuscripts, bulletins, policy documents, and links out to the Google Docs
 * the church already keeps elsewhere (CONTEXT.md). An assistant uses these to
 * put something on that shelf, file it, and keep the Pinned card in the order
 * somebody asked for.
 *
 * ⚠ EVERY TOOL HERE DELEGATES, the same rule the `oos_`, `shep_` and
 * `printable_` tools follow. resource-writes.js does the Firestore and the
 * Cloud Storage; resources-core.js and filing-core.js — the same two files the
 * browser loads — make every decision about what a resource is, where it may
 * be filed and what rank a pin gets. A judgement in this file is a bug.
 *
 * ⚠ THE GATE IS APPLIED IN ONE PLACE. `resourceTool` is the only way a tool
 * gets registered here. It is also a DIFFERENT gate from the one
 * mcp-printable-tools.js applies, and deliberately so: Resources is not
 * "editor and above", it is the `resources.edit` permission key (ADR-0077,
 * ADR-0082). An account whose saved permission map says false holds editor and
 * still cannot write here, exactly as `editsWith('resources.edit')` decides in
 * firestore.rules — which, note, NEVER RUNS for these calls, because an MCP
 * write goes through firebase-admin. This check is the only one there is.
 *
 * ⚠ REGISTERED FOR EVERYONE, REFUSED PER CALL. A tool that vanishes for a
 * caller answers "unknown tool", which reads as a broken server rather than a
 * closed door.
 */

const {z} = require("zod");

const Actor = require("./mcp-actor.js");
const Firestore = require("./mcp-firestore.js");
const {jsonResult, refuse} = require("./mcp-result.js");

const Resources = require("./resource-writes.js");
const Core = require("./shared/resources-core.js");

const resourceId = z.string().min(1).describe(
    "The id of a file, link or folder, from resource_list. Never a name, " +
    "never guessed.");

const folderId = z.string().nullable().optional().describe(
    "The folder to put it in, from resource_list. Omit or null for the top " +
    "level.");

const SIZE_HELP =
  "Files are capped at " + Core.formatFileSize(Core.MAX_FILE_BYTES) +
  " each. Anything bigger belongs in Google Drive — add it with " +
  "resource_add_link instead.";

/**
 * Register one tool with the gate, the Author and the refusals attached.
 *
 * A read needs the member rung and no Author. A write needs
 * `resources.edit` and refuses without an Author rather than leaving a row
 * nobody can be traced to (CONTEXT.md, Author).
 *
 * @param {object} server the MCP server
 * @param {object} deps see buildServer in mcp-server.js
 * @param {string} name the tool name
 * @param {object} spec title, description, inputSchema, annotations
 * @param {Function} run (args, actor) => data
 */
function resourceTool(server, deps, name, spec, run) {
  const readOnly = !!(spec.annotations && spec.annotations.readOnlyHint);

  server.registerTool(name, spec, async (args) => {
    const account = deps.auth || {};
    if (readOnly) {
      if (!Actor.mayReadResources(account)) {
        return refuse(Actor.resourcesReadRefusalFor(account));
      }
    } else if (!Actor.mayEditResources(account)) {
      return refuse(Actor.resourcesRefusalFor(account));
    }

    try {
      const actor = readOnly ?
        null : await Actor.requireActor(deps.db, account.uid);
      return jsonResult(await run(args || {}, actor));
    } catch (e) {
      return refuse(e && e.message ? e.message : "That did not work.");
    }
  });
}

/**
 * Add the Resources tools to a server.
 * @param {object} server the MCP server being built
 * @param {object} deps {db, auth, fieldValues, bucket}
 */
function register(server, deps) {
  // The write helpers take their Firestore sentinels rather than reaching for
  // firebase-admin, because functions/ carries its own copy and a sentinel
  // from the wrong one cannot be serialised. mcp-firestore.js explains why.
  Firestore.bind(deps.fieldValues);

  const tool = (name, spec, run) => resourceTool(server, deps, name, spec, run);
  const db = deps.db;
  const bucket = deps.bucket || null;
  const read = {readOnlyHint: true};

  // ── Reading the shelf ────────────────────────────────────────────────────

  tool("resource_list", {
    title: "List the resources",
    description:
      "What is on the church's Resources shelf: the folders, the files and " +
      "links inside one of them, and whatever is pinned to the top. THE " +
      "ONLY WAY to turn a name into the id every other tool needs. Give a " +
      "folderId to look inside one folder; give a search to look across the " +
      "whole library at once, which is usually what somebody who knows the " +
      "name but not the folder wants. Pinned comes back in the order the " +
      "Pinned card reads, whichever folder you asked for.",
    inputSchema: {
      folderId: folderId,
      search: z.string().nullable().optional()
          .describe("Match names across the whole library. Ignores folders."),
    },
    annotations: read,
  }, (a) => Resources.list(db, a));

  // ── Putting something on it ──────────────────────────────────────────────

  tool("resource_upload", {
    title: "Upload a file",
    description:
      "Put a file on the shelf — a PDF, a Word document, a picture, a " +
      "slide deck. Give EITHER url, and the file is fetched from there and " +
      "stored as the church's own copy, OR base64, the bytes themselves. " +
      SIZE_HELP + "\n\n" +
      "⚠ Uploading is COPYING. A Google Doc copied this way stops tracking " +
      "the original the moment somebody edits it, and the church ends up " +
      "reading a stale copy without knowing. Link to a Doc with " +
      "resource_add_link; upload only something finished.",
    inputSchema: {
      name: z.string().nullable().optional()
          .describe("What the shelf calls it. Taken from the URL if omitted."),
      url: z.string().nullable().optional()
          .describe("Fetch the file from here. Give this or base64."),
      base64: z.string().nullable().optional()
          .describe("The file itself, base64 encoded. Give this or url."),
      contentType: z.string().nullable().optional()
          .describe("e.g. application/pdf. Worked out from the fetch if " +
            "omitted, and needed when sending base64."),
      folderId: folderId,
    },
  }, (a, actor) => Resources.upload(db, bucket, a, actor));

  tool("resource_add_link", {
    title: "Add a link",
    description:
      "Put a link on the shelf — a Google Doc, a Sheet, a form, a page " +
      "elsewhere. THE CHURCH KEEPS NO COPY: the row points at the document " +
      "where it already lives, so edits there are what everyone reads. This " +
      "is the right tool for anything still being worked on, and for " +
      "anything too big to upload.",
    inputSchema: {
      url: z.string().min(1).describe("The address, http or https"),
      name: z.string().nullable().optional()
          .describe("What the shelf calls it. Taken from the URL if omitted."),
      folderId: folderId,
    },
  }, (a, actor) => Resources.addLink(db, a, actor));

  tool("resource_create_folder", {
    title: "Make a folder",
    description:
      "A folder on the shelf. Folders can sit inside folders. A folder " +
      "holds nothing until something is moved into it — nothing is filed " +
      "by making one.",
    inputSchema: {
      name: z.string().min(1).describe("What to call it"),
      parentId: z.string().nullable().optional()
          .describe("The folder it goes inside. Omit for the top level."),
    },
  }, (a, actor) => Resources.createFolder(db, a, actor));

  // ── Changing one ─────────────────────────────────────────────────────────

  tool("resource_rename", {
    title: "Rename a resource",
    description:
      "Change what the shelf calls a file, a link or a folder. The file " +
      "itself does not move and the link does not change — this is the " +
      "label, nothing else.",
    inputSchema: {
      resourceId: resourceId,
      name: z.string().min(1).describe("The new name"),
    },
  }, (a, actor) => Resources.rename(db, a, actor));

  tool("resource_move", {
    title: "File it somewhere else",
    description:
      "Move a file, a link or a folder into another folder, or to the top " +
      "level. A folder cannot be moved inside itself or inside something it " +
      "already holds; that is refused with a sentence saying so.",
    inputSchema: {
      resourceId: resourceId,
      folderId: folderId,
    },
  }, (a, actor) => Resources.move(db, a, actor));

  // No destructiveHint. The client's permission card does not see a chat
  // answer, which is how a multiple-choice "delete" has slipped through
  // before. `confirm` is the gate, the same shape printable_delete_page uses.
  tool("resource_delete", {
    title: "Take it off the shelf",
    description:
      "Remove a file, a link or a folder. A file's stored bytes go with it. " +
      "This cannot be undone from here.\n\n" +
      "⚠ A FOLDER TAKES EVERYTHING INSIDE IT. Call it once WITHOUT confirm: " +
      "nothing is deleted and you are told the count and the names. A " +
      "multiple-choice chip is not a yes and does not approve this call. " +
      "Ask the person to reply in chat with a sentence naming what should " +
      "go, then call again with confirm set to that count.",
    inputSchema: {
      resourceId: resourceId,
      confirm: z.number().int().positive().nullable().optional()
          .describe("How many files the person has agreed to lose, in a " +
            "reply that names them. Omit it the first time."),
    },
  }, (a) => Resources.remove(db, bucket, a));

  // ── The Pinned card (ADR-0083) ───────────────────────────────────────────

  tool("resource_pin", {
    title: "Pin it to the top",
    description:
      "Put a file, link or folder on the Pinned card at the top of the " +
      "library, where the church sees it without going looking. It goes at " +
      "the BOTTOM of the card: pinning says 'keep this to hand', not 'put " +
      "it above everything pinned before it'. Use resource_reorder_pins to " +
      "say where it should sit. Pinning something already pinned changes " +
      "nothing.",
    inputSchema: {resourceId: resourceId},
  }, (a) => Resources.pin(db, a));

  tool("resource_unpin", {
    title: "Take it off the Pinned card",
    description:
      "Remove it from the Pinned card. The file, link or folder itself " +
      "stays exactly where it is filed — only the pin goes.",
    inputSchema: {resourceId: resourceId},
  }, (a) => Resources.unpin(db, a));

  tool("resource_reorder_pins", {
    title: "Reorder the Pinned card",
    description:
      "Put the Pinned card in a given order, top first. Pass EVERY pinned " +
      "id — read them from resource_list first — because this is the whole " +
      "order, not a nudge. An id that is not pinned, or a list that is " +
      "missing one, is refused and nothing moves.",
    inputSchema: {
      resourceIds: z.array(z.string().min(1))
          .describe("Every pinned id, in the order they should read"),
    },
  }, (a) => Resources.reorderPins(db, a));
}

module.exports = {register, resourceTool};
