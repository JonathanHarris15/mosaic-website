/**
 * Service Theme similarity scoring, lifted out of the scoreTheme callable so
 * the MCP server (MS-262) can score a candidate theme through exactly the
 * same code path the Order of Service editor uses.
 *
 * ⚠ BEHAVIOUR UNCHANGED. Same embedding model, same dimensionality, same
 * corpus query, same excludeDate rule, same rounding — `db`-injected and
 * moved, not rewritten. The callable in index.js is now a thin wrapper.
 * An assistant and the editor screen must never report a theme as fresh and
 * stale respectively; one implementation is how that stays true.
 *
 * See docs/plans/theme-similarity.md and ADR-0037. Advisory only — nothing
 * here blocks or changes a save.
 */

const tsc = require("./shared/theme-similarity-core.js");

// Vectors from different models or dimensionalities are not comparable —
// changing either constant means re-embedding the whole `themes` collection
// first.
const THEME_EMBEDDING_MODEL = "gemini-embedding-001";
const THEME_EMBEDDING_DIMS = 768;

/**
 * Embeds one piece of text with the Gemini embedding API. `taskType:
 * SEMANTIC_SIMILARITY` matters — see the plan for why. Ported from the
 * spike's `embedOne` (scripts/spike/analyze-themes.js).
 * @param {string} text the theme text
 * @param {string} apiKey the Gemini key
 * @return {Promise<Array<number>>} the vector
 */
async function embedThemeText(text, apiKey) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
      THEME_EMBEDDING_MODEL + ":embedContent?key=" + apiKey;
  const res = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      model: "models/" + THEME_EMBEDDING_MODEL,
      content: {parts: [{text: text}]},
      taskType: "SEMANTIC_SIMILARITY",
      outputDimensionality: THEME_EMBEDDING_DIMS,
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini embed failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.embedding.values;
}

/**
 * How close a candidate theme is to one already preached, and how unique it
 * is overall.
 *
 * Throws a plain Error with a `reason` of `stale-corpus` if the stored
 * vectors were embedded with a different model or size — the caller decides
 * how to surface that (the callable turns it into failed-precondition).
 *
 * @param {object} db the Firestore handle
 * @param {object} args
 * @param {string} args.text the candidate theme
 * @param {?string} args.excludeDate a service date to leave out of the corpus
 * @param {string} args.apiKey the Gemini key
 * @return {Promise<{uniqueness: ?number, matches: Array<object>}>} the score
 */
async function scoreTheme(db, {text, excludeDate, apiKey}) {
  const [candidateVector, corpusSnap] = await Promise.all([
    embedThemeText(text, apiKey),
    db.collection("themes").get(),
  ]);

  const corpus = [];
  corpusSnap.forEach((doc) => {
    const data = doc.data();
    if (data.model !== THEME_EMBEDDING_MODEL ||
        data.dims !== THEME_EMBEDDING_DIMS) {
      const e = new Error(
          `themes/${doc.id} was embedded with a different model/size — ` +
          "run scripts/backfill-theme-vectors.js before scoring again.");
      e.reason = "stale-corpus";
      throw e;
    }
    const dates = (data.usedOn || []).filter((d) => d !== excludeDate);
    // Used only on the date being edited right now — that IS this draft,
    // not a piece of history to compare it against.
    if (!dates.length) return;
    corpus.push({text: data.text, dates, vector: data.vector});
  });

  const {uniqueness, matches} = tsc.scoreCandidate(candidateVector, corpus);

  return {
    uniqueness: uniqueness === null ? null : Math.round(uniqueness),
    // Centered cosine, clamped to 0 at "no relation or opposite" — a
    // negative centered similarity carries no useful "how close" meaning to
    // show an editor, only "not this one".
    matches: matches.map((m) => ({
      text: m.text,
      dates: m.dates,
      closenessPercent: Math.round(Math.max(0, m.similarity) * 100),
    })),
  };
}

module.exports = {
  scoreTheme,
  embedThemeText,
  THEME_EMBEDDING_MODEL,
  THEME_EMBEDDING_DIMS,
};
