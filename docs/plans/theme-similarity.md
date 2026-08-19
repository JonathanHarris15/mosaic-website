# Plan: Service Theme similarity

**Status:** spiked and proven, not built.
**Spike code:** `scripts/spike/` (throwaway — delete once this ships).
**Owner decision still open:** see [Open questions](#open-questions) before Phase 4.

---

## What we are building

When an editor types a **Service Theme** in the Order of Service editor
(`service-builder.html`), show them two things:

1. **The closest equivalent theme we have already preached**, with the dates.
2. **A uniqueness score** — a plain percentage meaning "more distinctive than
   N% of the themes we have already used".

Advisory only. Nothing blocks saving. The point is that a service planner
should not discover in the pulpit that "The God Who Rescues" was three months
ago under a different name.

Today `theme` is a free-text string on `services/{YYYY-MM-DD}` — see the field
map at the top of `public/service-builder.js`. Nothing compares them.

---

## Why this needs embeddings, not string matching

Our themes are an unusually *homogeneous* corpus: nearly every one is
"The [attribute] God" or "The God Who [verb]". That breaks the obvious
approaches:

- **Word overlap / fuzzy match ranks on the meaningless half.** Two themes
  score as similar because they share "The God Who", which carries no topical
  information in this list.
- **Raw embedding cosine is unreadable.** Every pair lands between 0.69 and
  0.97 because every theme is about God. A "0.78" tells an editor nothing.

Both are solved below, and the solutions are load-bearing — do not drop them
to simplify.

---

## What the spike proved

Run on 50 representative themes with `gemini-embedding-001` @ 768 dims.
Reproduce with:

```bash
node scripts/spike/analyze-themes.js --in=sample-themes.txt --test="Your Theme"
```

**Semantic matching works, and finds things keyword search cannot.** `word` is
plain word-overlap:

| sim | word | theme A | theme B |
|---|---|---|---|
| 0.572 | **0.000** | Hospitality to Strangers | Welcoming the Outsider |
| 0.545 | **0.000** | Baptism and New Life | Born Again |
| 0.413 | **0.000** | The Justice of God | Judgment and Mercy |
| 0.393 | **0.000** | Anxiety and Trust | Do Not Be Afraid |

**Scoring an unseen theme behaves correctly.** "The God Who Runs to Meet Us"
→ uniqueness 16%, nearest "The God Who Seeks the Lost" — it caught the
prodigal-son idea with no shared words. "Lament in the Time of Exile" →
uniqueness 62%, only loosely near "The Suffering Servant".

### The two traps (both already hit, both already solved)

**Trap 1 — you must mean-center.** Raw cosine spans 0.69–0.97. After
subtracting the corpus average vector it spans −0.26 to 0.82, and it *changes
the nearest-neighbour answer for 20% of themes*. Example: "The Fear of the
Lord" raw-matches "The Holiness of God"; centered, it matches "Do Not Be
Afraid" — the more useful observation. The corpus mean is the shared
"this is a Mosaic service theme about God" direction; removing it leaves the
actual topical difference.

**Trap 2 — calibrate against nearest-neighbour scores, not all pairs.** A
nearest-neighbour similarity is high *by construction*. Calibrating it against
the distribution of all pairwise similarities crams every theme into the top
13% and the number is useless. Calibrate against the distribution of *the other
themes' own top-3 scores*. Then "uniqueness 62%" means exactly "more
distinctive than 62% of the themes we have used", and it spans the full range.

---

## The algorithm

Reference implementation: `scripts/spike/analyze-themes.js`. Port the maths
verbatim; it is ~40 lines.

1. Embed each distinct theme → vector. Normalize to unit length.
2. `mean` = element-wise average of all corpus vectors.
3. `centered(v)` = `unit(v - mean)`.
4. Similarity between two themes = cosine of their centered vectors.
5. For a theme, `top3mean` = mean similarity to its 3 nearest neighbours.
6. `allTop3` = every corpus theme's `top3mean`, sorted ascending.
7. `uniqueness = 100 - percentile(allTop3, top3mean)`.
8. Display: uniqueness %, plus nearest neighbour and the dates it was used.

Notes for the implementer:

- Re-normalize after centering, and after any dimension truncation.
- With <10 themes in the corpus the percentile is meaningless. Return
  `uniqueness: null` and render "not enough history yet" rather than a
  misleading number.
- `mean` and `allTop3` change every time a theme is added. Recompute them per
  request from the loaded vectors — at this corpus size it is microseconds. Do
  not try to cache them incrementally.

---

## Architecture

### Scoring runs on the SERVER, not the client

This is a change from the first sketch of this plan and the reason matters.
Client-side scoring needs every vector downloaded: ~250 themes × 768 floats is
several MB of JSON on every page load. That is unacceptable in the phone
WebView on mobile data. The callable sends a few hundred bytes back instead.

Consequence: the pure maths must be available to `functions/`. Use the existing
shared-module mechanism — **authored copy in `public/`, copied into
`functions/shared/` by `scripts/sync-shared-to-functions.js`** (wired as a
`predeploy` hook in `firebase.json`; `test/functions-shared-sync.test.js` fails
if the copy is stale). Read that script's header comment before touching it.

### Pieces

| File | What it is |
|---|---|
| `public/theme-similarity-core.js` | **Pure maths.** cosine / mean / center / percentile / rank. No DOM, no Firebase, no network. Authored here; synced to `functions/shared/`. |
| `test/theme-similarity-core.test.js` | `node --test`, hand-built fixture vectors. Green before any UI. |
| `functions/index.js` → `exports.scoreTheme` | v2 `onCall`, `us-central1`, `cors: true`. Embeds the candidate, loads corpus vectors, returns the score. |
| `functions/index.js` → `exports.onServiceThemeWritten` | `onDocumentWritten` on `services/{date}` — keeps the `themes` collection current as services are saved. |
| `public/theme-similarity-store.js` | Thin client: debounce, call the callable, cache per session. UMD-lite IIFE (`window.ThemeSimilarity` + `module.exports`), same shape as `public/date-utils.js`. |
| `service-builder.html` / `.js` | The readout next to the Theme field. |
| `scripts/backfill-theme-vectors.js` | One-off, dry-run-first, same shape as the other `scripts/backfill-*.js`. |

### Firestore: a `themes` collection

Promote theme from a loose string to a document. Kills exact duplicates for
free, and means each distinct theme is embedded exactly once, ever.

```
themes/{normalizedKey}          // key = lowercased normalized text
{
  text: "The God Who Rescues",  // canonical display casing
  vector: [ ...768 floats ],
  model: "gemini-embedding-001",
  dims: 768,
  usedOn: ["2024-04-14", "2025-01-19"],   // YYYY-MM-DD service dates
  embeddedAt: Timestamp
}
```

Normalization (must match `scripts/spike/export-themes.js` exactly): straighten
smart quotes, collapse whitespace, trim, strip trailing `.,;:`. Dedupe key is
the lowercased result.

**`model` and `dims` are not decoration.** Vectors from different models are
not comparable. If either changes, every vector must be re-embedded before any
score is shown. Make `scoreTheme` refuse to mix — if a corpus doc's `model`
does not match the configured one, treat the corpus as stale and fail loudly.

### Security rules

- `themes` is readable by member+ (same rung as the rest of the service data),
  writable only by the Admin SDK. Clients never write vectors.
- `scoreTheme` requires `request.auth` and an **editor+** caller — it spends
  money per call. Check `users/{uid}.permissionLevel || .role`, the same read
  the other callables do (see `exports.takeAssignment` for the pattern).

### The embedding API

Google's Gemini embedding API — least friction given we are already on Firebase.

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent
{ "model": "models/gemini-embedding-001",
  "content": { "parts": [{ "text": "..." }] },
  "taskType": "SEMANTIC_SIMILARITY",
  "outputDimensionality": 768 }
→ { "embedding": { "values": [ ... ] } }
```

- `taskType: SEMANTIC_SIMILARITY` matters — it is what the model is being asked
  for. Do not omit it.
- Key goes in a Firebase secret: `defineSecret("GEMINI_KEY")`, declared in the
  function's `secrets: []` option. Never in `public/`.
- Node 20 has global `fetch`; no new dependency needed.
- Cost is negligible — the entire history is a fraction of a cent, and steady
  state is one embed per new theme.
- `gemini-embedding-2` also exists and is trivially swappable via the spike's
  `--model` flag. Compare before committing if you like; 001 is the stable one.

---

## Phases

Each phase must be green before the next starts.

### Phase 1 — pure core + tests

`public/theme-similarity-core.js` and `test/theme-similarity-core.test.js`.
Hand-built fixture vectors, no network, no Firestore.

**Done when:** `npm test` green. Tests cover — centering changes the ranking;
percentile calibration spans the full range; <10 themes returns `null`
uniqueness; identical text scores 1.0; empty corpus does not throw.

### Phase 2 — server

`scoreTheme` callable + `onServiceThemeWritten` trigger + the secret + rules.
Add `theme-similarity-core.js` to `scripts/sync-shared-to-functions.js`.

**Done when:** callable returns a sane score against a seeded emulator corpus;
`test/functions-shared-sync.test.js` green; an unauthenticated and a
member-rank caller are both refused.

### Phase 3 — backfill

`scripts/backfill-theme-vectors.js`. Dry-run first, printing what it would
write. Then populate `themes` from every existing `services/*.theme`.

**Done when:** the real corpus is in Firestore and its numbers look like the
spike's. **Eyeball the top-25 closest pairs before moving on** — if they do not
read as "yes, same idea", stop and revisit enrichment (see Open questions)
rather than building UI on a bad signal.

### Phase 4 — UI

Readout beside the Theme field in `service-builder.html`, debounced ~600ms on
input, or on blur. Mobile-first markup: base classes are the 360px layout,
`md:`/`lg:` for desktop. One Alpine component, one page — per the platform rule
in `CLAUDE.md` this ships to web and mobile together; a themes feature that
only works on desktop is a defect.

Then `npm run build:css` (committed `public/mosaic.css` deploys verbatim —
forgetting this ships stale styles), then `npm test`.

**Done when:** eyeballed at 360px *and* ~1280px, and working in the phone
WebView.

### Phase 5 — write it down

ADR in `docs/adr/` — next number is **0037** on `main`. It records the two
non-obvious decisions: scoring is server-side because of WebView payload size,
and the score is a calibrated percentile rather than raw cosine because raw
cosine is unreadable on a corpus this homogeneous.

---

## Open questions

Decide these with Jonathan before Phase 4.

1. **Embed the phrase alone, or enrich it?** "The Merciful God" is three words
   of signal. Adding the key verse (and sermon passage, if available) separates
   themes much better — but then similarity starts being driven by the passage
   rather than the theme. **Recommendation: phrase-only first.** Only enrich if
   the Phase 3 eyeball says the results are mushy.
2. **Where does the readout live?** Inline under the field, or behind a "check
   this theme" affordance? Inline is more useful; it is also a live network
   call on every edit, hence the debounce.
3. **Explain the match?** Once the top 3 are known, one Claude call could say
   *why* they are close ("both frame mercy as God's response to judgment").
   Genuinely useful and cheap — it only runs on 3 candidates. **Ship the
   numbers first**; this is a separate follow-up.

---

## Constraints the implementer must not violate

From `CLAUDE.md` — read it in full, but these are the ones this feature will
trip over:

- **Vanilla JS, script-tag globals, no bundler, no ES modules** in `public/`.
  Per-page `<script>` order *is* the dependency system.
- **Firebase compat SDK**, vendored under `public/vendor/` — no CDN.
- **No Tailwind class concatenation.** Only complete literal class names
  survive the JIT purge.
- **Service dates are local `YYYY-MM-DD`** — always `DateUtils`, never
  `toISOString()`.
- **Vocabulary is canonical** — use `CONTEXT.md` terms. "Service Theme" is the
  term; check `CONTEXT.md` for its entry and its *Avoid* list before naming
  anything.
- **Stores must be `require()`-able with no DOM and no firebase.**

Note for whoever picks this up: `docs/plans/` and `public/nav-registry.js` exist
on the unmerged `mobile-port` branch but not on `main`. If this work lands after
that branch merges, register the feature in the nav registry; if before, there
is nothing to register.
