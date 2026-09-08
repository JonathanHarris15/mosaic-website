/**
 * Reading and writing Printables for the MCP (ADR-0056, ADR-0057).
 *
 * ⚠ EVERY DECISION IS printable-core.js's. This file does Firestore and
 * nothing else: it loads a record, hands it to the shared core, and stores
 * what comes back. The core is the same file the editor runs, so a page an
 * assistant writes and a page a person clicks together are the same shape,
 * with the same ids and the same wires.
 *
 * ⚠ HTML IS THE INTERFACE, AND THE PARSER IS STRICT. A page arrives as
 * markup and goes through `Core.htmlToNodes`, the same parser behind the
 * editor's code view. A tag left open is refused with its line number rather
 * than guessed at (ADR-0056), so an assistant cannot write a page the editor
 * would not open.
 *
 * ⚠ NOTHING HERE CHECKS RANK. The gate is in mcp-printable-tools.js, applied
 * once, for the reason mcp-shepherding-tools.js gives: a per-function check is
 * a check somebody forgets. These calls write through firebase-admin and
 * therefore never meet `firestore.rules`.
 */

const Core = require("./shared/printable-core.js");
const Catalog = require("./shared/printable-data-core.js");
const Firestore = require("./mcp-firestore.js");

const PRINTABLES = "printables";
const FOLDERS = "printable_folders";
const TEMPLATES = "printable_templates";

/**
 * A refusal an assistant can act on, thrown for the tool wrapper to catch.
 * @param {string} message why not
 */
function fail(message) {
  throw new Error(message);
}

/**
 * What every write leaves behind: when, and who asked for it.
 * @param {?object} actor the caller, from Actor.requireActor
 * @return {object} the fields to merge onto the record
 */
function stamp(actor) {
  return {
    updatedAt: Firestore.now(),
    updatedByName: (actor && actor.name) || "An assistant",
  };
}

// ── Reading ────────────────────────────────────────────────────────────────

/**
 * One Printable, raw and migrated, or a refusal naming the id.
 * @param {object} db the Firestore handle
 * @param {string} id the Printable's id
 * @return {Promise<object>} {raw, project}
 */
async function loadRecord(db, id) {
  if (!id) fail("No printable was named. Call printable_list first.");
  const doc = await db.collection(PRINTABLES).doc(String(id)).get();
  if (!doc.exists) {
    fail(`No printable has the id "${id}". It may have been ` +
      "deleted; call printable_list to see what is there.");
  }
  const raw = Object.assign({id: doc.id}, doc.data());
  return {raw: raw, project: Core.migrate(raw)};
}

/**
 * Every Printable and every folder, as a shallow list to choose from.
 * @param {object} db the Firestore handle
 * @return {Promise<object>} {printables, folders}
 */
async function list(db) {
  const [printables, folders] = await Promise.all([
    db.collection(PRINTABLES).get(),
    db.collection(FOLDERS).get(),
  ]);
  return {
    printables: printables.docs.map((d) => {
      const r = d.data() || {};
      const t = r.template || null;
      return {
        id: d.id,
        name: r.name || "Untitled",
        folderId: r.folderId || null,
        paper: t ? t.label : "not chosen yet",
        pages: Array.isArray(r.pages) ? r.pages.length : 0,
        memberVisible: r.memberVisible === true,
      };
    }),
    folders: folders.docs.map((d) => Object.assign({id: d.id}, d.data())),
  };
}

/**
 * One Printable, with every page rendered back to HTML.
 *
 * The HTML here is exactly what `printable_write_page` accepts, so an
 * assistant can read a page, change a line and write it back without needing
 * to know the record shape at all.
 *
 * @param {object} db the Firestore handle
 * @param {object} args {printableId}
 * @return {Promise<object>} the Printable, pages rendered to HTML
 */
async function read(db, args) {
  const {raw, project} = await loadRecord(db, args.printableId);
  return {
    id: raw.id,
    name: project.name,
    folderId: project.folderId,
    memberVisible: raw.memberVisible === true,
    template: project.template,
    pages: (project.pages || []).map((p, i) => ({
      pageNumber: i + 1,
      id: p.id,
      name: p.name || "",
      margins: p.margins,
      css: p.css || "",
      html: Core.pageToHtml(p),
    })),
  };
}

// ── Finding a page ─────────────────────────────────────────────────────────

/**
 * Which page a call means.
 *
 * Either handle works: the id a read returned, or the 1-based number the same
 * read printed beside it. Naming neither is refused rather than guessed at —
 * writing over page 1 when page 4 was meant is not a mistake that announces
 * itself.
 *
 * @param {object} project the migrated record
 * @param {object} args {pageNumber} or {pageId}
 * @return {number} the 0-based index
 */
function pageIndex(project, args) {
  const pages = project.pages || [];
  if (!pages.length) {
    fail("This printable has no pages yet. Use printable_add_page.");
  }
  if (args.pageId) {
    const i = pages.findIndex((p) => p.id === args.pageId);
    if (i < 0) {
      fail(`No page here has the id "${args.pageId}".`);
    }
    return i;
  }
  if (args.pageNumber != null) {
    const n = Number(args.pageNumber);
    if (!(n >= 1 && n <= pages.length)) {
      fail(`This printable has ${pages.length} page(s); ` +
        `there is no page ${n}.`);
    }
    return n - 1;
  }
  return fail("Name which page: pageNumber (1 is the first) or pageId.");
}

/**
 * Markup to elements, refusing by line rather than guessing (ADR-0056).
 * @param {string} html the page as markup
 * @return {Array<object>} the elements
 */
function nodesFrom(html) {
  const parsed = Core.htmlToNodes(String(html == null ? "" : html));
  if (!parsed.ok) {
    fail("That HTML could not be read, so nothing was saved:\n" +
      parsed.problems.map((p) => "  " + p).join("\n"));
  }
  return parsed.nodes;
}

// ── Writing ────────────────────────────────────────────────────────────────

/**
 * A new Printable, on a paper or on a saved page template.
 *
 * The template is chosen once and fixed for the life of the record, because
 * every measurement inside it is written in those pixels (CONTEXT.md, Page
 * template). That is why it cannot be changed afterwards and why this refuses
 * rather than defaulting silently.
 *
 * @param {object} db the Firestore handle
 * @param {object} args see mcp-printable-tools.js for the shape
 * @param {?object} actor who is asking
 * @return {Promise<object>} the new Printable's id and paper
 */
async function create(db, args, actor) {
  let template = null;
  let basePage = null;

  if (args.fromTemplateId) {
    const doc = await db.collection(TEMPLATES)
        .doc(String(args.fromTemplateId)).get();
    if (!doc.exists) {
      fail("No saved page template has the id " +
        `"${args.fromTemplateId}".`);
    }
    const t = doc.data() || {};
    template = t.template || null;
    basePage = t.page || null;
  } else {
    if (!args.paper) {
      fail("Name the paper this is printed on — one of: " +
        Core.PAPERS.map((p) => p.key).join(", ") +
        " — or pass fromTemplateId to start from a saved page template.");
    }
    template = Core.buildTemplate({
      paper: args.paper,
      orientation: args.orientation,
      dpi: args.dpi,
    });
  }

  const pages = Array.isArray(args.pages) && args.pages.length ?
    args.pages.map((p) => ({
      name: p.name,
      margins: p.margins,
      css: p.css,
      nodes: nodesFrom(p.html),
    })) :
    [basePage ? Object.assign({}, basePage) : {}];

  const record = Core.buildPrintable({
    name: args.name,
    folderId: args.folderId || null,
    template: template,
    pages: pages,
  });

  const ref = await db.collection(PRINTABLES).add(Object.assign(record, {
    createdAt: Firestore.now(),
    createdBy: (actor && actor.uid) || null,
    createdByName: (actor && actor.name) || "An assistant",
  }, stamp(actor)));

  return {
    id: ref.id,
    name: record.name,
    template: record.template,
    pages: record.pages.length,
    openAt: `printable-editor.html?id=${ref.id}`,
  };
}

/**
 * Store the pages back, having rebuilt them through the core.
 * @param {object} db the Firestore handle
 * @param {string} id the Printable's id
 * @param {object} project the migrated record
 * @param {Array<object>} pages the pages to store
 * @param {?object} actor who is asking
 * @return {Promise<object>} the rebuilt record
 */
async function savePages(db, id, project, pages, actor) {
  const next = Core.buildPrintable(Object.assign({}, project, {pages: pages}));
  await db.collection(PRINTABLES).doc(String(id)).set(
      Object.assign({pages: next.pages}, stamp(actor)), {merge: true});
  return next;
}

/**
 * Replace one page's elements, its stylesheet, its name and its margins.
 * @param {object} db the Firestore handle
 * @param {object} args {printableId, html, css, name, margins} and a page
 * @param {?object} actor who is asking
 * @return {Promise<object>} what was written
 */
async function writePage(db, args, actor) {
  const {project} = await loadRecord(db, args.printableId);
  const i = pageIndex(project, args);
  const pages = (project.pages || []).slice();
  const was = pages[i];

  pages[i] = Core.buildPage(project.template, {
    id: was.id,
    name: args.name != null ? args.name : was.name,
    margins: args.margins || was.margins,
    style: was.style,
    css: args.css != null ? args.css : was.css,
    nodes: args.html != null ? nodesFrom(args.html) : was.nodes,
  });

  const next = await savePages(db, args.printableId, project, pages, actor);
  return {
    written: true,
    pageNumber: i + 1,
    pageId: pages[i].id,
    elements: countNodes(pages[i].nodes),
    pages: next.pages.length,
  };
}

/**
 * A new page, at the end or at a place you name.
 * @param {object} db the Firestore handle
 * @param {object} args {printableId, html, css, name, afterPageNumber}
 * @param {?object} actor who is asking
 * @return {Promise<object>} where it landed
 */
async function addPage(db, args, actor) {
  const {project} = await loadRecord(db, args.printableId);
  const pages = (project.pages || []).slice();
  const page = Core.buildPage(project.template, {
    name: args.name,
    margins: args.margins,
    css: args.css,
    nodes: args.html != null ? nodesFrom(args.html) : [],
  });

  const at = args.afterPageNumber != null ?
    Math.max(0, Math.min(pages.length, Number(args.afterPageNumber))) :
    pages.length;
  pages.splice(at, 0, page);

  const next = await savePages(db, args.printableId, project, pages, actor);
  return {
    added: true, pageNumber: at + 1, pageId: page.id,
    pages: next.pages.length,
  };
}

/**
 * Remove a page. The last one cannot go: a Printable with no page is not one.
 * @param {object} db the Firestore handle
 * @param {object} args {printableId} and a page
 * @param {?object} actor who is asking
 * @return {Promise<object>} what is left
 */
async function deletePage(db, args, actor) {
  const {project} = await loadRecord(db, args.printableId);
  const i = pageIndex(project, args);
  const pages = (project.pages || []).slice();
  if (pages.length <= 1) {
    fail("This is the only page. Write over it instead, or delete the " +
      "whole printable.");
  }
  const gone = pages.splice(i, 1)[0];
  const next = await savePages(db, args.printableId, project, pages, actor);
  return {deleted: true, pageId: gone.id, pages: next.pages.length};
}

/**
 * Rename the Printable itself.
 * @param {object} db the Firestore handle
 * @param {object} args {printableId, name}
 * @param {?object} actor who is asking
 * @return {Promise<object>} the name as stored
 */
async function rename(db, args, actor) {
  const {project} = await loadRecord(db, args.printableId);
  const record = Core.buildPrintable(
      Object.assign({}, project, {name: args.name}));
  await db.collection(PRINTABLES).doc(String(args.printableId)).set(
      Object.assign({name: record.name}, stamp(actor)), {merge: true});
  return {renamed: true, name: record.name};
}

/**
 * Whether a member may open the view-only page.
 *
 * The flag lives on the Printable because that is the record the read rule
 * reads (ADR-0057). Switching it on publishes the page to every member, so the
 * tool says so in its description rather than treating it as a detail.
 *
 * @param {object} db the Firestore handle
 * @param {object} args {printableId, membersMayView}
 * @param {?object} actor who is asking
 * @return {Promise<object>} the flag as stored
 */
async function setMemberVisible(db, args, actor) {
  await loadRecord(db, args.printableId);
  const on = args.membersMayView === true;
  await db.collection(PRINTABLES).doc(String(args.printableId)).set(
      Object.assign({memberVisible: on}, stamp(actor)), {merge: true});
  return {memberVisible: on};
}

// ── Page templates ─────────────────────────────────────────────────────────

/**
 * The saved page templates, and the papers a new Printable can start on.
 * @param {object} db the Firestore handle
 * @return {Promise<object>} {papers, densities, saved}
 */
async function listPageTemplates(db) {
  const snap = await db.collection(TEMPLATES).get();
  return {
    papers: Core.PAPERS.map((p) => ({
      key: p.key, label: p.label, widthIn: p.widthIn, heightIn: p.heightIn,
    })),
    densities: Core.DENSITIES,
    saved: snap.docs.map((d) => {
      const t = d.data() || {};
      return {
        id: d.id,
        name: t.name || "Untitled",
        paper: t.template ? t.template.label : "",
        elements: t.page && Array.isArray(t.page.nodes) ?
        t.page.nodes.length : 0,
        createdByName: t.createdByName || "",
      };
    }),
  };
}

/**
 * Keep a page as a template the next Printable can start from.
 * @param {object} db the Firestore handle
 * @param {object} args {printableId, name} and a page
 * @param {?object} actor who is asking
 * @return {Promise<object>} the template's id
 */
async function savePageTemplate(db, args, actor) {
  const {project} = await loadRecord(db, args.printableId);
  const i = pageIndex(project, args);
  const page = project.pages[i];

  const record = Core.buildCustomTemplate({
    name: args.name,
    template: project.template,
    page: page,
  });
  const ref = await db.collection(TEMPLATES).add(Object.assign(record, {
    createdAt: Firestore.now(),
    createdByName: (actor && actor.name) || "An assistant",
  }));
  return {id: ref.id, name: record.name, fromPage: i + 1};
}

// ── What can be wired ──────────────────────────────────────────────────────

/**
 * The catalog: every source and field a Printable may read, for this caller.
 *
 * ⚠ THE LEVEL IS PASSED IN, NEVER ASSUMED. `sourcesFor` is the permission
 * boundary's first half — it holds nothing elder-only at all — and handing it
 * the caller's own level is what keeps a tool from describing a field the
 * caller could not read (ADR-0057).
 *
 * @param {?string} permissionLevel the caller's level
 * @param {object} args {source} to expand one, or {} for all
 * @return {object} how to wire, how to repeat, and the sources
 */
function dataCatalog(permissionLevel, args) {
  const sources = Catalog.sourcesFor(permissionLevel) || [];
  const wanted = args && args.source ? String(args.source) : "";
  const chosen = wanted ? sources.filter((s) => s.key === wanted) : sources;
  if (wanted && !chosen.length) {
    fail(`No source is called "${wanted}". Call ` +
      "printable_data_catalog with no source to see them all.");
  }
  return {
    howToWire:
      "Put data-bind on the element that shows the value. A single source: " +
      "data-bind='{\"text\":{\"scope\":\"global\",\"source\":\"sunday\"," +
      "\"params\":{\"when\":{\"mode\":\"this\"}},\"field\":\"theme\"}}'. " +
      "A row of a list: data-bind='{\"text\":{\"scope\":\"item\"," +
      "\"field\":\"name\"}}' on an element INSIDE the iterated box. An image " +
      "binds \"src\" instead of \"text\".",
    howToRepeat:
      "Put data-repeat on the box that stands for one row: " +
      "data-repeat='{\"source\":\"people\",\"params\":" +
      "{\"membership\":\"members\"," +
      "\"sort\":\"last\"},\"layout\":{\"direction\":\"column\",\"perLine\":1," +
      "\"gap\":12,\"maxPerPage\":0},\"overflow\":\"new-page\"}'. " +
      "overflow is \"clip\" or \"new-page\".",
    sources: chosen.map((s) => ({
      key: s.key,
      region: s.region,
      label: s.label,
      shape: s.shape,
      blurb: s.blurb,
      params: s.params || [],
      filters: s.filters || [],
      fields: (s.fields || []).map((f) => ({
        key: f.key, label: f.label, kind: f.kind,
      })),
    })),
  };
}

/**
 * How many elements a page carries, copies not counted.
 * @param {Array<object>} nodes the page's elements
 * @return {number} the count
 */
function countNodes(nodes) {
  let n = 0;
  Core.walk(nodes || [], () => {
    n += 1;
  });
  return n;
}

module.exports = {
  list,
  read,
  create,
  writePage,
  addPage,
  deletePage,
  rename,
  setMemberVisible,
  listPageTemplates,
  savePageTemplate,
  dataCatalog,
};
