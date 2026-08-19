# ADR 0037 — Service Theme similarity is scored server-side, on a calibrated percentile

**Status:** Accepted
**Date:** 2026-08-19
**Spike:** `docs/plans/theme-similarity.md`, `scripts/spike/` (throwaway, proven).

## Context

A Service Theme is free text on `services/{date}.theme` — "The God Who
Rescues", "Baptism and New Life". Nothing has ever compared them. A planner
picking a theme for next Sunday has no way to know it was preached, under a
different title, four months ago.

The obvious first idea — fuzzy string matching — does not work on this
corpus. Nearly every theme reads as "The [attribute] God" or "The God Who
[verb]", so word overlap ranks two themes as similar because they share "The
God Who", which carries no topical information here. The spike confirms
semantic embeddings find matches keyword search cannot ("Hospitality to
Strangers" / "Welcoming the Outsider": 0 shared words, 0.57 similarity) — but
raw embeddings bring two problems of their own, both load-bearing to solve
correctly:

1. **Every pair lands between 0.69 and 0.97.** Everything in this corpus is
   about God, so that shared direction dominates raw cosine similarity and
   swamps the actual topical signal.
2. **A percentage built from raw cosine is unreadable.** "0.78" means
   nothing to an editor deciding whether a theme is too close to reuse.

## Decision

### Scoring runs on the server

The maths (`public/theme-similarity-core.js`) is pure and could run in the
browser. It doesn't, because running it there means downloading every
theme's 768-float vector on every page load — low hundreds of themes is
several MB, in the phone WebView, on mobile data (the platform rule in
`CLAUDE.md` is develop-once-layout-twice; this feature ships on the same
page mobile already uses). `functions/index.js`'s `scoreTheme` callable
embeds the candidate, reads the corpus, and returns a few hundred bytes.

The pure core is shared into `functions/shared/` the existing way
(`scripts/sync-shared-to-functions.js`) rather than restated, so the
client's understanding of a theme's identity (`themeKey`) and the server's
scoring can never quietly disagree about what "the same theme" means.

### The corpus mean is subtracted before comparing

`center(v) = unit(v - meanOfCorpus)`. Removing the corpus's average
direction — "this is a Mosaic service theme about God" — is what turns an
unreadable 0.69–0.97 raw spread into a −0.26–0.82 spread that actually
separates topics. Confirmed to change the nearest-neighbour answer for ~20%
of a 50-theme sample; without it, "The Fear of the Lord" matches "The
Holiness of God" (true but useless) instead of "Do Not Be Afraid" (the
actually useful observation).

### Uniqueness is a percentile against themes' own nearest-neighbour scores, not against all pairs

A theme's nearest-neighbour similarity is high **by construction** — it's
the best of many comparisons. Calibrating it against the distribution of
*every* pairwise similarity crams every theme into the top ~13% and the
number stops meaning anything. Calibrating it against the distribution of
*every other theme's own top-3-mean* instead means "uniqueness 62%" states
exactly one thing: **more distinctive than 62% of the themes already
preached.** Below 10 distinct themes a percentile isn't a meaningful
statement at all — `scoreCandidate` returns `uniqueness: null` and the UI
renders "not enough history yet" rather than a misleading number.

### The readout is a ranked list, not a single nearest neighbour

The spike's report showed one nearest match. The shipped readout shows the
top 3 — the same three matches uniqueness is already calibrated from, so
what's displayed and what's scored can't drift apart — each with a
**closeness percentage** (the centered cosine similarity itself, clamped at
0%; a negative centered similarity means "unrelated or opposite", not "some
negative percentage of closeness") and the most recent date it was used.
This is advisory information for staying *away* from a theme, not a
picker for choosing one — nothing here writes to the Service, and nothing
blocks a save.

### Themes are embedded once, keyed by normalized text

`theme` is promoted from a loose string to `themes/{key}` — `key` is the
lowercased, punctuation-trimmed, smart-quote-straightened text
(`normalizeThemeText`/`themeKey`, ported verbatim from the spike's
`export-themes.js`). This kills exact duplicates for free and means a
distinct theme is embedded — and paid for — exactly once, ever.
`onServiceThemeWritten` keeps `usedOn` current as services are saved;
`scripts/backfill-theme-vectors.js` seeds it from history that predates
this feature.

**`model` and `dims` travel with every vector and are never assumed.**
Vectors from different models or dimensionalities are not comparable.
`scoreTheme` fails loudly (`failed-precondition`) rather than silently
comparing mismatched vectors if a corpus doc doesn't carry the currently
configured model — the alternative is a wrong answer that looks like a
right one.

### Embed the phrase alone, not enriched with the key verse

Considered adding the key verse or sermon passage to separate
similar-sounding themes further. Decided against it for the initial ship:
mixing the passage into the embedding means similarity starts partly
tracking *scripture* overlap rather than *theme* overlap, and the spike's
50-theme sample didn't show phrase-only results reading as mushy. Revisit
only if real usage shows matches that don't read as "yes, the same idea."

## Consequences

**A theme costs one embedding call, once.** Steady state is a fraction of a
cent per new theme (`GEMINI_KEY`, a Firebase secret — never in `public/`).
Re-typing or re-scoring an already-seen theme this session costs nothing
further (`theme-similarity-store.js` caches per session).

**`scoreTheme` is editor+ only.** It spends money per call; a member or
signed-out caller is refused before the embedding call is made.

**The corpus's mean and calibration are recomputed on every score, not
cached.** At real corpus sizes (low hundreds) this is microseconds, and an
incrementally-maintained cache that could drift from the actual vectors
would be worse than recomputing.

**Nothing here is a source of truth for anything else.** `themes` is a
derived index; the Service document's `theme` string remains the only
record of what was actually preached. Losing or resetting `themes` loses
only the similarity feature, never the Order of Service itself — the
backfill script rebuilds it from `services/*.theme` at any time.
