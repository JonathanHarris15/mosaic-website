// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/theme-similarity-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Theme Similarity Core — the pure maths behind "how close is this Service
// Theme to one we've already preached, and how unique is it" (docs/plans/
// theme-similarity.md). Ported verbatim from the spike,
// scripts/spike/analyze-themes.js — read that file's header before changing
// the maths here; it explains WHY each step exists, not just what it does.
//
// No DOM, no Firebase, no network — everything here operates on vectors and
// plain data the caller already has. That is what lets the same module run
// both in the browser (documentation/tests only; scoring itself is
// server-side, see the plan) and in functions/, via
// scripts/sync-shared-to-functions.js.
(function (global) {
    'use strict';

    // ── Vector basics ────────────────────────────────────────────────────────

    function dot(a, b) {
        let sum = 0;
        for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
        return sum;
    }

    function norm(v) {
        return Math.sqrt(dot(v, v));
    }

    // Unit-length copy of v. A zero vector stays zero rather than dividing by
    // zero — it has no direction to normalize to.
    function unit(v) {
        const n = norm(v) || 1;
        return v.map(x => x / n);
    }

    function cosine(a, b) {
        const denom = (norm(a) * norm(b)) || 1;
        return dot(a, b) / denom;
    }

    // The corpus's average vector — the "this is a Service Theme about God"
    // direction every theme shares, and therefore contributes no topical
    // signal (Trap 1 in the plan).
    function meanVector(vectors) {
        const out = new Array(vectors[0].length).fill(0);
        vectors.forEach(v => v.forEach((x, i) => { out[i] += x; }));
        return out.map(x => x / vectors.length);
    }

    // Subtract the shared direction, then renormalize — the maths only works
    // on unit vectors, and centering moves the vector off the unit sphere.
    function center(v, mean) {
        return unit(v.map((x, i) => x - mean[i]));
    }

    // ── Calibration ──────────────────────────────────────────────────────────

    // Where `value` would insert into an ASCENDING-sorted array, as a
    // percentile 0–100. Binary search, so this stays cheap at corpus size.
    function percentileOf(sortedAscending, value) {
        let lo = 0;
        let hi = sortedAscending.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (sortedAscending[mid] < value) lo = mid + 1;
            else hi = mid;
        }
        return (lo / sortedAscending.length) * 100;
    }

    // Every corpus theme's own "how crowded is my neighbourhood" score — its
    // mean similarity to its 3 nearest OTHER corpus themes — sorted
    // ascending. This is what a theme's uniqueness is calibrated against
    // (Trap 2 in the plan): a nearest-neighbour score is high by
    // construction, so the right yardstick is other themes' own
    // nearest-neighbour scores, not the distribution of all pairs.
    function corpusTop3Means(centeredVectors) {
        return centeredVectors.map((v, i) => {
            const sims = centeredVectors
                .filter((_, j) => j !== i)
                .map(other => cosine(v, other));
            if (!sims.length) return 0;
            sims.sort((a, b) => b - a);
            const top3 = sims.slice(0, 3);
            return top3.reduce((s, x) => s + x, 0) / top3.length;
        }).sort((a, b) => a - b);
    }

    // Below this many distinct themes, a percentile is not a meaningful
    // statement — see the plan's "Notes for the implementer".
    const MIN_CORPUS_FOR_UNIQUENESS = 10;

    // ── Normalization ────────────────────────────────────────────────────────
    //
    // Ported verbatim from scripts/spike/export-themes.js's `normalize`. Must
    // match exactly — this is what turns "The God Who Rescues" and "the god
    // who rescues." into the same `themes/{key}` doc, so each distinct theme
    // is embedded exactly once, ever. A drift here would split one theme into
    // two corpus entries silently.
    function normalizeThemeText(raw) {
        return String(raw || '')
            .replace(/[‘’]/g, "'")
            .replace(/[“”]/g, '"')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/[.,;:]+$/, '');
    }

    // The `themes/{key}` doc id for a theme's text. Lowercased so "The God
    // Who Rescues" and "the god who rescues" share one doc; the doc itself
    // keeps the first-seen casing as its display `text`.
    function themeKey(rawText) {
        const normalized = normalizeThemeText(rawText);
        return normalized ? normalized.toLowerCase() : null;
    }

    // ── The product moment: score one candidate against the corpus ─────────
    //
    // `candidateVector` is the (not-yet-unit) embedding of what's currently
    // typed. `corpus` is every OTHER distinct theme already used:
    // `[{ text, dates, vector }]`, `vector` the theme's stored (not-yet-unit)
    // embedding, `dates` its `usedOn` array. Nothing here reads Firestore —
    // the caller (functions/index.js's scoreTheme) already loaded both.
    //
    // Recomputed from scratch on every call, deliberately — see the plan's
    // note not to cache the mean/calibration incrementally. At real corpus
    // sizes (low hundreds) this is microseconds, and a cache that drifts from
    // the actual vectors would be worse than no cache.
    function scoreCandidate(candidateVector, corpus) {
        if (!corpus || !corpus.length) {
            return { uniqueness: null, matches: [] };
        }

        const raw = corpus.map(t => unit(t.vector));
        const mean = meanVector(raw);
        const centered = raw.map(v => center(v, mean));
        const candidateCentered = center(unit(candidateVector), mean);

        const matches = corpus
            .map((t, i) => ({
                text: t.text,
                dates: t.dates || [],
                similarity: cosine(candidateCentered, centered[i]),
            }))
            .sort((a, b) => b.similarity - a.similarity);

        const top3 = matches.slice(0, 3);
        const top3mean = top3.reduce((s, m) => s + m.similarity, 0) /
            (top3.length || 1);

        const allTop3 = corpus.length >= MIN_CORPUS_FOR_UNIQUENESS
            ? corpusTop3Means(centered)
            : null;

        const uniqueness = allTop3
            ? 100 - percentileOf(allTop3, top3mean)
            : null;

        return { uniqueness, matches: top3 };
    }

    const ThemeSimilarityCore = {
        MIN_CORPUS_FOR_UNIQUENESS,
        dot,
        norm,
        unit,
        cosine,
        meanVector,
        center,
        percentileOf,
        corpusTop3Means,
        normalizeThemeText,
        themeKey,
        scoreCandidate,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ThemeSimilarityCore;
    }
    if (global) {
        global.ThemeSimilarityCore = ThemeSimilarityCore;
    }
})(typeof window !== 'undefined' ? window : null);
