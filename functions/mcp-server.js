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
      const [{McpServer}, {StreamableHTTPServerTransport}] = await Promise.all([
        import("@modelcontextprotocol/sdk/server/mcp.js"),
        import("@modelcontextprotocol/sdk/server/streamableHttp.js"),
      ]);
      return {McpServer, StreamableHTTPServerTransport};
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
  const {McpServer} = await loadSdk();
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

module.exports = {
  handleMcpRequest,
  buildServer,
  liturgyFieldsShape,
  SERVER_NAME,
  SERVER_VERSION,
  EDITOR_LEVELS,
};
