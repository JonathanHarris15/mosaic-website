/**
 * The Order of Service MCP server (MS-262).
 *
 * What this is: a door an AI assistant (Claude Desktop, Claude Code) can
 * knock on to help an editor build a Sunday — look up what has been sung and
 * preached, and, once the editor agrees, write the choices back.
 *
 * ⚠ EVERY TOOL HERE DELEGATES. Nothing in this file queries Firestore or
 * decides anything. The four tools call the very same modules the website
 * calls — hymn-index.js, theme-scoring.js, scripture-heatmap.js,
 * liturgy-writes.js — so an assistant and the Order of Service page can
 * never be told different things about the same Sunday. If you find yourself
 * writing a query in this file, it belongs in one of those instead.
 *
 * ⚠ STATELESS PER REQUEST. A fresh server and transport are built for every
 * HTTP request and thrown away after it. Cloud Functions recycles instances
 * whenever it likes, so anything remembered between calls would be a bug that
 * only shows up under load. This is also why no `minInstances` is needed.
 *
 * The SDK is ESM and functions/ is CommonJS, so it is pulled in with dynamic
 * `import()` and cached in a module-scoped promise — the import is the one
 * thing worth reusing across calls on a warm instance, because it costs real
 * milliseconds and holds no per-caller state.
 *
 * Tools are named `oos_*` so a later capability group (people_, roles_) can
 * be added without renaming anything a connected client already knows.
 */

const {z} = require("zod");

const hi = require("./hymn-index");
const ts = require("./theme-scoring");
const sh = require("./scripture-heatmap");
const lw = require("./liturgy-writes");
const sr = require("./service-read");
const nw = require("./note-writes");
const gs = require("./guidance-store");
const NoteCore = require("./shared/service-note-core.js");
const GuidanceCore = require("./shared/mcp-guidance-core.js");
const LiturgySaveCore = require("./shared/liturgy-save-core.js");

const SERVER_NAME = "mosaic-order-of-service";
const SERVER_VERSION = "1.0.0";

const EDITOR_LEVELS = ["editor", "elder", "admin", "super_admin"];

// One import, reused on a warm instance. Holds no per-caller state.
let sdkPromise = null;

/** @return {Promise<object>} the bits of the MCP SDK this server uses */
function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      const [{McpServer, ResourceTemplate}, {StreamableHTTPServerTransport}] =
        await Promise.all([
          import("@modelcontextprotocol/sdk/server/mcp.js"),
          import("@modelcontextprotocol/sdk/server/streamableHttp.js"),
        ]);
      return {McpServer, ResourceTemplate, StreamableHTTPServerTransport};
    })();
  }
  return sdkPromise;
}

/**
 * A tool result carrying JSON. MCP wants content blocks; an assistant reads
 * the text, so the data goes in as pretty JSON rather than a prose summary
 * this file would have to keep in step with the shape.
 * @param {*} data whatever the underlying module returned
 * @return {object} an MCP tool result
 */
function jsonResult(data) {
  return {content: [{type: "text", text: JSON.stringify(data, null, 2)}]};
}

/**
 * A refusal the assistant can read and act on, rather than a thrown error
 * that surfaces to the user as "something went wrong".
 * @param {string} message why not
 * @return {object} an MCP tool result flagged as an error
 */
function refuse(message) {
  return {content: [{type: "text", text: message}], isError: true};
}

// A hymn slot is chosen as one act — id and name together — so the schema
// takes the pair. `id` is null for a hymn typed in freehand that the registry
// does not know, which the Order of Service has always allowed.
const hymnSlot = z.object({
  id: z.string().nullable().describe("Hymn registry id, or null if freehand"),
  name: z.string().describe("Hymn name as it should appear"),
}).nullable().describe("The hymn for this slot, or null to clear it");

const textSlot = z.string().nullable()
    .describe("Scripture reference or text, or null to clear it");

/**
 * The liturgy fields oos_update_liturgy accepts, built from the same
 * allowlist the write itself enforces (shared/liturgy-save-core.js) so the
 * schema an assistant sees and the rule the server applies cannot drift.
 * @return {object} a zod raw shape
 */
function liturgyFieldsShape() {
  const shape = {
    theme: z.string().nullable().optional()
        .describe("The Sunday's theme, e.g. 'The God Who Rescues'"),
    keyVerse: z.string().nullable().optional()
        .describe("The key verse reference, e.g. 'Exodus 14:14'"),
  };
  LiturgySaveCore.HYMN_FIELDS.forEach((f) => {
    shape[f] = hymnSlot.optional();
  });
  LiturgySaveCore.TEXT_FIELDS.forEach((f) => {
    shape[f] = textSlot.optional();
  });
  return shape;
}

/**
 * Builds the server for ONE request, with the four tools bound to this
 * caller's identity.
 *
 * @param {object} deps
 * @param {object} deps.db the Firestore handle
 * @param {object} deps.auth who is calling: {uid, permissionLevel}
 * @param {function(): string} deps.geminiKey reads the Gemini secret
 * @param {object} deps.fieldValues {serverTimestamp, deleteField, documentId}
 * @return {Promise<object>} an McpServer with tools registered
 */
async function buildServer({db, auth, geminiKey, fieldValues}) {
  const {McpServer, ResourceTemplate} = await loadSdk();
  const server = new McpServer({name: SERVER_NAME, version: SERVER_VERSION});

  const isEditor = EDITOR_LEVELS.includes(auth && auth.permissionLevel);

  server.registerTool("oos_get_hymn_history", {
    title: "Hymn history",
    description:
      "THE ENTIRE hymn registry, with times sung and last-sung date for " +
      "each. This is a lot of data. Prefer oos_lookup_hymns when you have " +
      "particular hymns in mind; reach for this only when you genuinely need " +
      "to survey everything — finding candidates you could not have named up " +
      "front, for instance.",
    inputSchema: {},
    annotations: {readOnlyHint: true},
    // Fresh, not cached. An assistant may have written a hymn onto a Sunday
    // moments ago, and planning against counts that predate its own write is
    // the one staleness that does not merely mislead — it causes a bad pick.
  }, async () => jsonResult(await hi.getHymnIndex(db, null, {fresh: true})));

  server.registerTool("oos_get_scripture_heatmap", {
    title: "Scripture usage",
    description:
      "EVERY scripture reference the church has used, with counts and " +
      "last-used dates. This is a lot of data. Prefer oos_lookup_scripture " +
      "when you have passages or a book in mind; reach for this only when " +
      "you need the whole picture — spotting which parts of scripture are " +
      "neglected overall, for instance.",
    inputSchema: {},
    annotations: {readOnlyHint: true},
  }, async () => jsonResult(await sh.getScriptureHeatmap(db)));

  server.registerTool("oos_score_theme", {
    title: "Score a theme",
    description:
      "How distinctive a candidate theme is against every theme already " +
      "preached, plus the closest previous themes and the dates they were " +
      "used. Advisory only — a low score is a prompt to think, not a bar to " +
      "using the theme. Scoring calls a paid API, so do not call it " +
      "speculatively in a loop.",
    inputSchema: {
      text: z.string().min(1).describe("The candidate theme text"),
      excludeDate: z.string().nullable().optional().describe(
          "A service date (YYYY-MM-DD) to leave out of the comparison — " +
          "use this when scoring a theme already saved on the Sunday being " +
          "worked on, so it is not compared against itself"),
    },
    annotations: {readOnlyHint: true},
  }, async ({text, excludeDate}) => {
    if (!isEditor) return refuse("Editors only — scoring a theme costs money.");
    try {
      return jsonResult(await ts.scoreTheme(db, {
        text: String(text).trim(),
        excludeDate: excludeDate || null,
        apiKey: geminiKey(),
      }));
    } catch (e) {
      if (e && e.reason === "stale-corpus") {
        return refuse(
            "The stored theme vectors are out of date, so scoring would be " +
            "misleading. " + e.message);
      }
      throw e;
    }
  });

  // ── Guidance ─────────────────────────────────────────────────────────
  //
  // ⚠ EXPOSED BOTH AS RESOURCES AND AS TOOLS, DELIBERATELY. Resources are
  // the right shape — a document to read is exactly what they are for, and
  // the earlier "tools, not resources" decision was about DATA, where the
  // value is filtering rather than browsing. But client support for
  // resources varies: some attach them automatically, some wait for the
  // person to pick one, some ignore them. A tool the model can always reach
  // for is the difference between guidance that is usually read and
  // guidance that is reliably read.
  // ⚠ A TEMPLATE WITH A LIST CALLBACK, NOT ONE RESOURCE PER FILE. Listing
  // the files here to register them individually would put a Firestore read
  // in front of EVERY request — this function runs per call, and most calls
  // are tool calls that never touch guidance at all. The template defers the
  // read to the moment a client actually lists or reads a resource.
  server.registerResource(
      "guidance",
      new ResourceTemplate(GuidanceCore.URI_PREFIX + "{slug}", {
        list: async () => {
          const files = await gs.listGuidance(db);
          return {
            resources: files.map((f) => ({
              uri: GuidanceCore.uriFor(f.slug),
              name: f.slug,
              title: f.title,
              description: f.summary,
              mimeType: "text/markdown",
            })),
          };
        },
      }),
      {
        title: "Order of Service guidance",
        description:
          "This church's written guidance for building an Order of Service.",
        mimeType: "text/markdown",
      },
      async (uri, variables) => {
        const slug = GuidanceCore.slugFromUri(uri.href) ||
          String((variables && variables.slug) || "");
        const file = await gs.getGuidance(db, slug);
        return {
          contents: [{
            uri: uri.href,
            mimeType: "text/markdown",
            // A file that is missing or switched off says so, rather than
            // returning an empty document an assistant would silently
            // follow as "no guidance".
            text: file ? file.body :
              `There is no guidance file at "${slug}". It may have been ` +
              "renamed or switched off.",
          }],
        };
      });

  server.registerTool("oos_list_guidance", {
    title: "What guidance is available",
    description:
      "Lists the written guidance this church keeps for building an Order " +
      "of Service — its conventions, and how it wants choices reasoned " +
      "about. Each entry has an address and a one-line summary. Read the " +
      "ones that apply with oos_get_guidance BEFORE proposing anything, " +
      "and prefer what they say over your own general instincts: they are " +
      "this church's decisions, not suggestions.",
    inputSchema: {},
    annotations: {readOnlyHint: true},
  }, async () => {
    const files = await gs.listGuidance(db);
    if (!files.length) {
      return jsonResult({
        guidance: [],
        note: "No guidance has been written yet. Editors add it on the " +
          "MCP Manager page.",
      });
    }
    return jsonResult({guidance: files});
  });

  server.registerTool("oos_get_guidance", {
    title: "Read one guidance file",
    description:
      "The full text of one guidance file, by the address given in " +
      "oos_list_guidance. Treat what it says as this church's settled " +
      "preference.",
    inputSchema: {
      address: z.string().min(1)
          .describe("The file's address, e.g. 'hymn-selection'"),
    },
    annotations: {readOnlyHint: true},
  }, async ({address}) => {
    const slug = GuidanceCore.slugFromUri(address) || String(address).trim();
    const file = await gs.getGuidance(db, slug);
    if (!file) {
      // Named plainly rather than returned as an empty body: an assistant
      // handed nothing would follow no guidance and never say so.
      return refuse(
          `There is no guidance file at "${slug}". Call oos_list_guidance ` +
          "to see what exists — it may have been renamed or switched off.");
    }
    return jsonResult({
      address: file.slug,
      title: file.title,
      summary: file.summary,
      guidance: file.body,
    });
  });

  server.registerTool("oos_get_service", {
    title: "Read a Sunday's Order of Service",
    description:
      "What is currently planned for a Sunday: theme, key verse, every " +
      "liturgy slot in the order the service actually runs, who chose each " +
      "one, and who is preaching, leading and on music. Read this BEFORE " +
      "proposing changes, so you know what is already there and do not " +
      "offer to replace something that was deliberately chosen. Give one " +
      "date, or add 'through' to read a span of Sundays at once. Dates are " +
      "YYYY-MM-DD — resolve anything vaguer yourself and say which date you " +
      "settled on, because guessing a year silently is worse than asking. " +
      "A Sunday with nothing planned comes back as exists: false, which is " +
      "an answer, not a failure. People here are READ-ONLY: oos_update_liturgy " +
      "cannot change who is preaching.",
    inputSchema: {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("The Sunday, YYYY-MM-DD"),
      through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
          .describe(
              "Optional end date, YYYY-MM-DD inclusive. With this, every " +
              "Sunday from 'date' to here that has something planned comes " +
              "back; Sundays with nothing planned are simply absent."),
    },
    annotations: {readOnlyHint: true},
  }, async ({date, through}) => {
    if (!through || through === date) {
      return jsonResult(await sr.getService(db, date));
    }
    if (through < date) {
      return refuse("The end date is before the start date.");
    }
    const range = await sr.getServiceRange(db, date, through,
        {documentId: fieldValues.documentId()});
    if (range.truncated) {
      // Said out loud rather than quietly returning a prefix — a silently
      // short list reads as "that is all there is".
      return jsonResult(Object.assign({}, range, {
        note: "More Sundays match than the limit of " + range.limit +
          "; narrow the range to see the rest.",
      }));
    }
    return jsonResult(range);
  });

  server.registerTool("oos_lookup_hymns", {
    title: "Look up particular hymns",
    description:
      "How often specific hymns have been sung, and when last. Use this " +
      "rather than oos_get_hymn_history whenever you have hymns in mind — " +
      "it answers the same question without pulling the whole registry " +
      "through the conversation. 'names' must match exactly. 'search' " +
      "matches the START of a name and is case-sensitive, so 'Holy' finds " +
      "'Holy Holy Holy' but not 'O Holy Night'. Names that do not match " +
      "come back under notFound — read that as 'not in the registry under " +
      "that spelling', NOT as 'never sung', and fall back to " +
      "oos_get_hymn_history if you need to be certain.",
    inputSchema: {
      names: z.array(z.string()).nullable().optional()
          .describe("Exact hymn names to look up"),
      search: z.string().nullable().optional()
          .describe("A name prefix, case-sensitive"),
      limit: z.number().int().positive().nullable().optional()
          .describe("Most rows to return (default 50, max 200)"),
    },
    annotations: {readOnlyHint: true},
  }, async ({names, search, limit}) => {
    if (!(names && names.length) && !(search && String(search).trim())) {
      return refuse("Give either some hymn names or a search prefix.");
    }
    return jsonResult(await hi.lookupHymns(db, {
      names: names || [],
      search: search || "",
      limit: limit || undefined,
    }));
  });

  server.registerTool("oos_lookup_scripture", {
    title: "Look up particular scripture",
    description:
      "How often specific scripture references have been used, and when " +
      "last. Use this rather than oos_get_scripture_heatmap whenever you " +
      "have passages or a book in mind. 'references' must match exactly as " +
      "stored, punctuation included, e.g. 'John 3:16'. 'book' matches the " +
      "START of a reference, so 'John' catches John but not 1 John — ask " +
      "for '1 John' separately. References that have never been used come " +
      "back under neverUsed, which is a useful answer in itself: it means " +
      "the church has not preached that passage, not that the lookup failed.",
    inputSchema: {
      references: z.array(z.string()).nullable().optional()
          .describe("Exact references, e.g. ['John 3:16']"),
      book: z.string().nullable().optional()
          .describe("A reference prefix, usually a book name"),
      limit: z.number().int().positive().nullable().optional()
          .describe("Most rows to return (default 50, max 200)"),
    },
    annotations: {readOnlyHint: true},
  }, async ({references, book, limit}) => {
    if (!(references && references.length) && !(book && String(book).trim())) {
      return refuse("Give either some references or a book name.");
    }
    return jsonResult(await sh.lookupScripture(db, {
      references: references || [],
      book: book || "",
      limit: limit || undefined,
    }));
  });

  server.registerTool("oos_update_note", {
    title: "Write the note on an element",
    description:
      "Sets the note attached to one element of a Sunday's Order of Service " +
      "— the comment bubble the service leader reads: context, reminders, " +
      "the reasoning behind a choice. This is separate from the element's " +
      "value: writing a note about Hymn 1 does not change which hymn it is. " +
      "Send plain text; send nothing (or an empty string) to remove the " +
      "note. Blank lines start new paragraphs, lines beginning '- ' become " +
      "bullets, and **text** and *text* become bold and italic. Do NOT send " +
      "HTML — it is not accepted and will appear as literal characters. " +
      "Read the Sunday first with oos_get_service: a note you overwrite is " +
      "gone, and it may be somebody's reasoning rather than a stray remark.",
    inputSchema: {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("The Sunday, YYYY-MM-DD"),
      element: z.enum(NoteCore.NOTE_KEYS)
          .describe("Which element the note belongs to"),
      note: z.string().nullable().optional().describe(
          "The note as plain text. Omit, or send an empty string, to " +
          "remove the note entirely."),
    },
    annotations: {readOnlyHint: false, destructiveHint: false},
  }, async ({date, element, note}) => {
    if (!isEditor) {
      return refuse("Editors only — this changes the live Order of Service.");
    }
    const result = await nw.updateNote(db, {
      dateKey: date,
      element,
      text: note == null ? "" : note,
      serverTimestamp: fieldValues.serverTimestamp(),
      deleteField: fieldValues.deleteField(),
    });
    if (!result.ok) {
      return refuse(
          `"${result.element}" is not an element that carries a note. ` +
          `Notes can go on: ${NoteCore.NOTE_KEYS.join(", ")}.`);
    }
    return jsonResult({
      element: result.element,
      action: result.action,
      date,
      note: result.html ? NoteCore.noteHtmlToText(result.html) : null,
    });
  });

  server.registerTool("oos_update_liturgy", {
    title: "Write liturgy fields to a Sunday",
    description:
      "Writes the given liturgy fields to one Sunday's Order of Service. " +
      "Only send fields the editor has explicitly agreed to — this changes " +
      "the live record the church runs its service from. Fields you leave " +
      "out are untouched; send null to clear a field. Person assignments " +
      "(Preacher, Service Leader, prayer leaders) cannot be set here.",
    inputSchema: {
      dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("The Sunday's date, YYYY-MM-DD"),
      fields: z.object(liturgyFieldsShape())
          .describe("The liturgy fields to write. Omit what should not change."),
    },
    annotations: {readOnlyHint: false, destructiveHint: false},
  }, async ({dateKey, fields}) => {
    if (!isEditor) {
      return refuse("Editors only — this changes the live Order of Service.");
    }
    const given = fields || {};
    if (!Object.keys(given).length) {
      return refuse("No fields given, so there is nothing to write.");
    }

    const result = await lw.updateLiturgy(db, {
      dateKey,
      fields: given,
      uid: auth.uid,
      serverTimestamp: fieldValues.serverTimestamp(),
      deleteField: fieldValues.deleteField(),
    });

    if (!result.ok) {
      return refuse(
          "Refused. These fields cannot be written here: " +
          result.rejectedFields.concat(result.invalidFields).join(", "));
    }
    return jsonResult({
      written: Object.keys(given),
      dateKey,
      note: "Visible on the Order of Service page for that Sunday now.",
    });
  });

  return server;
}

/**
 * Answers one MCP HTTP request. Caller is responsible for having already
 * authenticated `auth` — this function trusts it.
 *
 * @param {object} req the Express-style request
 * @param {object} res the Express-style response
 * @param {object} deps see buildServer
 * @return {Promise<void>}
 */
async function handleMcpRequest(req, res, deps) {
  const {StreamableHTTPServerTransport} = await loadSdk();

  // `sessionIdGenerator: undefined` is what puts the transport in stateless
  // mode — no session to remember, which is the only safe shape on Cloud
  // Functions where the next request may land on a different instance.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  const server = await buildServer(deps);

  // Both are per-request; closing the transport when the response ends stops
  // a recycled instance holding a listener for a request that is over.
  res.on("close", () => {
    transport.close();
    server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

/**
 * What this server actually offers, for the read-only half of the MCP
 * Manager page.
 *
 * ⚠ IT ASKS THE REAL SERVER RATHER THAN DESCRIBING IT. The obvious way to
 * build this screen is a hand-written list of tools, and that list is wrong
 * the first time somebody adds a tool and forgets it — leaving a page that
 * confidently tells an editor the server does something it does not, or
 * hides something it does. So a genuine server is built and a genuine client
 * asks it, over an in-memory transport: exactly the handshake an assistant
 * performs. Whatever comes back is, by construction, what an assistant sees.
 *
 * The cost is one throwaway server per call. This is an admin screen opened
 * occasionally, not a hot path.
 *
 * @param {object} deps the same deps buildServer takes
 * @return {Promise<{tools: Array<object>, resources: Array<object>}>}
 */
async function describeCapabilities(deps) {
  const [{Client}, {InMemoryTransport}] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/inMemory.js"),
  ]);

  const server = await buildServer(deps);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({name: "mcp-manager", version: SERVER_VERSION});

  try {
    await Promise.all([
      server.connect(serverSide),
      client.connect(clientSide),
    ]);

    const [toolsResult, resourcesResult] = await Promise.all([
      client.listTools(),
      client.listResources().catch(() => ({resources: []})),
    ]);

    return {
      tools: (toolsResult.tools || []).map((t) => ({
        name: t.name,
        title: (t.annotations && t.annotations.title) || t.title || t.name,
        description: t.description || "",
        // What an editor most wants to know at a glance: can this thing
        // change a Sunday, or only look at one?
        writes: !(t.annotations && t.annotations.readOnlyHint),
        inputs: Object.keys(
            (t.inputSchema && t.inputSchema.properties) || {}),
      })).sort((a, b) => a.name.localeCompare(b.name)),
      resources: (resourcesResult.resources || []).map((r) => ({
        uri: r.uri,
        name: r.name,
        title: r.title || r.name,
        description: r.description || "",
      })).sort((a, b) => String(a.uri).localeCompare(String(b.uri))),
    };
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

module.exports = {
  handleMcpRequest,
  buildServer,
  describeCapabilities,
  liturgyFieldsShape,
  SERVER_NAME,
  SERVER_VERSION,
  EDITOR_LEVELS,
};
