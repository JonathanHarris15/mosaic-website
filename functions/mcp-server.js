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
 * @param {object} deps.fieldValues {serverTimestamp, deleteField} factories
 * @return {Promise<object>} an McpServer with tools registered
 */
async function buildServer({db, auth, geminiKey, fieldValues}) {
  const {McpServer} = await loadSdk();
  const server = new McpServer({name: SERVER_NAME, version: SERVER_VERSION});

  const isEditor = EDITOR_LEVELS.includes(auth && auth.permissionLevel);

  server.registerTool("oos_get_hymn_history", {
    title: "Hymn history",
    description:
      "Every hymn in the church's registry, with how many times it has been " +
      "sung and when it was last sung. Use this to suggest hymns that fit a " +
      "theme and have not been sung recently. Returns the whole list — " +
      "filter it yourself rather than asking for a subset.",
    inputSchema: {},
    annotations: {readOnlyHint: true},
  }, async () => jsonResult(await hi.getHymnIndex(db)));

  server.registerTool("oos_get_scripture_heatmap", {
    title: "Scripture usage",
    description:
      "How often each scripture reference has been used across every Sunday " +
      "on record, and when it was last used. Use this to notice passages " +
      "the church leans on heavily, and ones it has not touched.",
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
