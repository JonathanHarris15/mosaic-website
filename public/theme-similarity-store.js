// Theme Similarity Store — the thin client half of "how close is this
// Service Theme to one we've already preached" (docs/plans/
// theme-similarity.md). All the scoring maths runs server-side
// (functions/index.js's `scoreTheme` callable) — this only debounces
// keystrokes, calls it, and remembers what it already asked this session so
// retyping or backspacing to an earlier value doesn't spend another call.
//
// Loaded as a classic <script> after firebase-functions-compat. Also
// module.exports for Node tests (createSession takes its Firebase callable
// as a dependency, so it never touches `firebase`/`db` directly and stays
// require()-able with no Firebase SDK loaded).
(function (global) {
    'use strict';

    const Dates = (typeof module !== 'undefined' && module.exports)
        ? require('./date-utils.js')
        : global.DateUtils;

    // Below this many characters there isn't enough text to embed
    // meaningfully, and calling on every keystroke of "The" would be pure
    // cost for no signal.
    const DEFAULT_MIN_LENGTH = 4;
    const DEFAULT_DEBOUNCE_MS = 600;

    // A `scoreTheme` match — `{ text, dates, closenessPercent }`, `dates`
    // sorted ascending — as one line for the readout: how close, and the
    // most recent time it was preached. One formatter, so the wording can't
    // drift from the hymn/scripture/person pickers' "Used N× · last DATE"
    // (usage-stats-store.js) without that being a deliberate choice.
    function formatMatch(match) {
        const dates = match.dates || [];
        const last = dates[dates.length - 1];
        const when = last
            ? Dates.parseDateStr(last).toLocaleDateString('default', {
                month: 'short', day: 'numeric', year: 'numeric',
            })
            : null;
        const times = dates.length > 1 ? ` (${dates.length}×)` : '';
        return when
            ? `${match.closenessPercent}% close · last ${when}${times}`
            : `${match.closenessPercent}% close`;
    }

    // One session's worth of debouncing + memoizing calls to `scoreTheme`.
    // `deps.scoreThemeCallable` is a Firebase `httpsCallable` function —
    // `({text}) => Promise<{data}>` — so this module never imports Firebase
    // itself.
    function createSession(deps) {
        const scoreThemeCallable = deps.scoreThemeCallable;
        const minLength = deps.minLength || DEFAULT_MIN_LENGTH;
        const debounceMs = deps.debounceMs || DEFAULT_DEBOUNCE_MS;

        const cache = new Map();
        let timer = null;
        let token = 0;

        // Keyed by excludeDate too, not just text — the same phrase can
        // legitimately score differently depending on which service's own
        // draft is being excluded from the corpus (see scoreTheme).
        const cacheKey = (text, excludeDate) => `${excludeDate || ''}::${text.trim().toLowerCase()}`;

        // Invalidates whatever is in flight — the field was cleared, or a
        // newer keystroke superseded it. Cheap to call unconditionally.
        function cancel() {
            clearTimeout(timer);
            token += 1;
        }

        // Debounced score for `text`, as scored for the service dated
        // `excludeDate` — that date is left out of the corpus server-side
        // (scoreTheme) so a theme never matches 100% against the very
        // draft that's typing it. Pass null/undefined if there's no
        // specific service to exclude.
        //
        // Calls `onResult(null)` synchronously (no debounce, no network) for
        // text shorter than `minLength` — a caller can use that to clear its
        // readout immediately rather than waiting out a debounce window for
        // a field that just got cleared. Calls `onResult(data)` for a cache
        // hit, synchronously too. Otherwise debounces, then calls
        // `onResult(data)` or `onError(err)` — never both, and never for a
        // call `cancel()` (or a newer `scoreDebounced`) has since superseded.
        function scoreDebounced(text, excludeDate, onResult, onError) {
            cancel();
            const trimmed = (text || '').trim();
            if (trimmed.length < minLength) {
                onResult(null);
                return;
            }

            const key = cacheKey(trimmed, excludeDate);
            if (cache.has(key)) {
                onResult(cache.get(key));
                return;
            }

            const myToken = token;
            timer = setTimeout(async () => {
                try {
                    const result = await scoreThemeCallable({ text: trimmed, excludeDate: excludeDate || null });
                    cache.set(key, result.data);
                    if (myToken === token) onResult(result.data);
                } catch (err) {
                    if (myToken === token) onError(err);
                }
            }, debounceMs);
        }

        return { scoreDebounced, cancel };
    }

    const ThemeSimilarity = { createSession, formatMatch, DEFAULT_MIN_LENGTH, DEFAULT_DEBOUNCE_MS };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ThemeSimilarity;
    }
    if (global) {
        global.ThemeSimilarity = ThemeSimilarity;
    }
})(typeof window !== 'undefined' ? window : null);
