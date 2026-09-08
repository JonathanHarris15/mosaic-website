/**
 * The Printables tools an assistant can call.
 *
 * A Printable is a project the church lays out and prints — a membership
 * directory, a service guide, an event handout (CONTEXT.md). These tools let
 * an assistant build one end to end: choose the paper, write the pages, wire
 * the church's own data onto them, and keep a page as a template for next
 * time.
 *
 * ⚠ EVERY TOOL HERE DELEGATES, the same rule the `oos_` and `shep_` tools
 * follow. printable-writes.js does the Firestore; printable-core.js — the same
 * file the editor loads in the browser — makes every decision about what a
 * page is. A query or a judgement in this file is a bug.
 *
 * ⚠ A PAGE IS WRITTEN AS HTML, AND THE PARSER IS STRICT. That is not a
 * convenience: it is the whole reason this surface is small. The editor's code
 * view already turns markup into elements and back (ADR-0056), so an assistant
 * writing a page and a person typing one are doing the same thing to the same
 * record. Markup the parser cannot read is refused with its line number and
 * nothing is saved.
 *
 * ⚠ THE GATE IS APPLIED IN ONE PLACE. `editorTool` is the only way a tool gets
 * registered here, and it refuses anyone below editor, resolves the Author for
 * a write, and turns a throw into a refusal an assistant can read. This matters
 * more here than it looks: these tools write through firebase-admin, which
 * never consults firestore.rules, so the `isEditor()` rule guarding
 * `printables` DOES NOT RUN for them. This check is the only one there is.
 *
 * ⚠ REGISTERED FOR EVERYONE, REFUSED PER CALL, as with the shepherding tools:
 * a tool that vanishes for a viewer reads as a broken server, so every tool is
 * listed and each refuses with a sentence saying why.
 */

const {z} = require("zod");

const Actor = require("./mcp-actor.js");
const Firestore = require("./mcp-firestore.js");
const {jsonResult, refuse} = require("./mcp-result.js");

const Printables = require("./printable-writes.js");

const printableId = z.string().min(1).describe(
    "The Printable's id, from printable_list. Never a name, never guessed.");

// Written once: the same four numbers on create, write and add.
const margins = z.object({
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
  left: z.number(),
}).partial().optional().describe(
    "In pixels at this printable's density");

const pageWhich = {
  pageNumber: z.number().int().positive().optional()
      .describe("Which page, 1 for the first. Give this or pageId."),
  pageId: z.string().min(1).optional()
      .describe("The page's id, from printable_read. Give this or pageNumber."),
};

const HTML_HELP =
  "The page's elements as HTML. This is exactly what printable_read gives " +
  "back, so read a page, change it and write it back. A box is a <div>, text " +
  "is <p>/<h1>/<span>, a picture is <img>. Style with the style attribute — " +
  "there is no class-based stylesheet unless you put it in css. Wire data " +
  "with data-bind and repeat a box with data-repeat; call " +
  "printable_data_catalog for both. Text is one run per element: a bold word " +
  "inside a sentence is another element, not markup inside one.";

/**
 * Register one tool, with the gate, the Author and the refusals attached.
 *
 * @param {object} server the MCP server
 * @param {object} deps see buildServer in mcp-server.js
 * @param {string} name the tool name
 * @param {object} spec title, description, inputSchema, annotations
 * @param {Function} run (args, actor) => data
 */
function editorTool(server, deps, name, spec, run) {
  const readOnly = !!(spec.annotations && spec.annotations.readOnlyHint);

  server.registerTool(name, spec, async (args) => {
    const level = deps.auth && deps.auth.permissionLevel;
    if (!Actor.isEditor(level)) return refuse(Actor.editorRefusalFor(level));

    try {
      // A read needs no Author. A write refuses without one rather than
      // leaving a page nobody can be traced to (CONTEXT.md, Author).
      const actor = readOnly ?
        null : await Actor.requireActor(deps.db, deps.auth.uid);
      return jsonResult(await run(args || {}, actor, level));
    } catch (e) {
      return refuse(e && e.message ? e.message : "That did not work.");
    }
  });
}

/**
 * Add the Printables tools to a server.
 * @param {object} server the MCP server being built
 * @param {object} deps {db, auth, fieldValues}
 */
function register(server, deps) {
  // The write helpers take their Firestore sentinels rather than reaching for
  // firebase-admin, because functions/ carries its own copy and a sentinel
  // from the wrong one cannot be serialised. mcp-firestore.js explains why.
  Firestore.bind(deps.fieldValues);

  const tool = (name, spec, run) => editorTool(server, deps, name, spec, run);
  const db = deps.db;
  const read = {readOnlyHint: true};

  // ── Finding and reading ──────────────────────────────────────────────────

  tool("printable_list", {
    title: "List the printables",
    description:
      "Every Printable in the library, with the id every other tool needs, " +
      "the paper it is on and how many pages it has. THE ONLY WAY to turn a " +
      "name into an id. Also lists the folders they are filed in.",
    inputSchema: {},
    annotations: read,
  }, () => Printables.list(db));

  tool("printable_read", {
    title: "Read a printable",
    description:
      "One Printable in full: its paper, and every page as HTML and CSS. The " +
      "HTML that comes back is what printable_write_page accepts, so this is " +
      "the first call before changing anything. Values are NOT resolved here " +
      "— a wired element comes back with its data-bind, not with today's " +
      "text, because a Printable stores which field feeds it and never the " +
      "value (ADR-0057).",
    inputSchema: {printableId: printableId},
    annotations: read,
  }, (a) => Printables.read(db, a));

  tool("printable_page_templates", {
    title: "Papers and saved page templates",
    description:
      "What a new Printable can start on: the paper sizes, the pixel " +
      "densities, and the page templates somebody has saved. Call this " +
      "before printable_create so the paper is chosen rather than " +
      "defaulted — it is fixed for the life of the Printable.",
    inputSchema: {},
    annotations: read,
  }, () => Printables.listPageTemplates(db));

  tool("printable_data_catalog", {
    title: "What a printable can be told",
    description:
      "Every source and field the website can feed into a page — People, " +
      "Sunday, Events, Forms — and the exact data-bind and data-repeat " +
      "attributes that wire them. Call this before writing a page that shows " +
      "real data. What comes back is only what THIS account may read.",
    inputSchema: {
      source: z.string().optional()
          .describe("One source key to expand. Omit for all of them."),
    },
    annotations: read,
  }, (a, _actor, level) => Printables.dataCatalog(level, a));

  // ── Building one ─────────────────────────────────────────────────────────

  tool("printable_create", {
    title: "Start a printable",
    description:
      "Make a new Printable and lay out its first page. THE PAPER IS FIXED " +
      "FOR THE LIFE OF THE RECORD — every measurement inside is written in " +
      "those pixels — so choose it deliberately from " +
      "printable_page_templates rather than letting it default. Give pages " +
      "to lay it out in the same call, or add pages afterwards.",
    inputSchema: {
      name: z.string().min(1).describe("What the church will call it"),
      paper: z.string().optional()
          .describe("A paper key: letter, legal, tabloid, half_letter, " +
            "a4, a5, photo_5x7, photo_4x6. Required unless " +
            "fromTemplateId is given."),
      orientation: z.enum(["portrait", "landscape"]).optional()
          .describe("Default portrait"),
      dpi: z.number().int().optional()
          .describe("Pixels to the inch: 96, 150 or 300. Default 150."),
      fromTemplateId: z.string().optional()
          .describe("Start from a saved page template instead of a bare paper"),
      folderId: z.string().optional().describe("The folder to file it in"),
      pages: z.array(z.object({
        name: z.string().optional().describe("Cover, Back…"),
        html: z.string().optional().describe(HTML_HELP),
        css: z.string().optional().describe("A stylesheet for this page"),
        margins: margins,
      })).optional()
          .describe("The pages to start with. One empty page if omitted."),
    },
  }, (a, actor) => Printables.create(db, a, actor));

  tool("printable_write_page", {
    title: "Write a page",
    description:
      "Replace what is on one page. Read the page first: this writes over " +
      "everything on it, it does not merge. Markup that cannot be read is " +
      "refused with its line number and NOTHING IS SAVED, so a refusal never " +
      "leaves a half-written page. Leave a field out to keep what is there.",
    inputSchema: Object.assign({
      printableId: printableId,
      html: z.string().optional().describe(HTML_HELP),
      css: z.string().optional().describe("The page's stylesheet"),
      name: z.string().optional().describe("Rename the page"),
      margins: margins,
    }, pageWhich),
  }, (a, actor) => Printables.writePage(db, a, actor));

  tool("printable_add_page", {
    title: "Add a page",
    description:
      "Put a new page in, at the end or after a page you name. A page a list " +
      "spills onto is NOT added this way — an iterated element with overflow " +
      "'new-page' grows its own pages as the data grows, and those are " +
      "drawn, never stored.",
    inputSchema: {
      printableId: printableId,
      html: z.string().optional().describe(HTML_HELP),
      css: z.string().optional().describe("The page's stylesheet"),
      name: z.string().optional().describe("Cover, Back…"),
      afterPageNumber: z.number().int().nonnegative().optional()
          .describe("Put it after this page. 0 puts it first; " +
            "omit for the end."),
      margins: margins,
    },
  }, (a, actor) => Printables.addPage(db, a, actor));

  tool("printable_delete_page", {
    title: "Delete a page",
    description:
      "Remove one page and everything on it. This cannot be undone from " +
      "here. The last remaining page cannot be deleted.",
    inputSchema: Object.assign({printableId: printableId}, pageWhich),
    annotations: {destructiveHint: true},
  }, (a, actor) => Printables.deletePage(db, a, actor));

  tool("printable_rename", {
    title: "Rename a printable",
    description:
      "Change what the library calls it. Nothing on the pages changes.",
    inputSchema: {
      printableId: printableId,
      name: z.string().min(1).describe("The new name"),
    },
  }, (a, actor) => Printables.rename(db, a, actor));

  tool("printable_save_page_template", {
    title: "Keep a page as a template",
    description:
      "Save one page — its paper, margins, stylesheet and elements — so the " +
      "next Printable can start from it. Wires and repeats come along, so a " +
      "directory page saved this way brings its people list with it.",
    inputSchema: Object.assign({
      printableId: printableId,
      name: z.string().min(1).describe("What to call the template"),
    }, pageWhich),
  }, (a, actor) => Printables.savePageTemplate(db, a, actor));

  tool("printable_members_may_view", {
    title: "Let members view a printable",
    description:
      "Switch the view-only page on or off for members. ⚠ SWITCHING IT ON " +
      "PUBLISHES THE PAGE TO EVERY MEMBER of the church, resolved against " +
      "today's data, and a member sees only the rows a member may read. Ask " +
      "before turning it on for anything holding contact details.",
    inputSchema: {
      printableId: printableId,
      membersMayView: z.boolean()
          .describe("true to publish, false to close it"),
    },
  }, (a, actor) => Printables.setMemberVisible(db, a, actor));
}

module.exports = {register, editorTool};
