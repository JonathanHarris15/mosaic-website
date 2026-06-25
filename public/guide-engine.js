// Guide Engine — the single seam for turning a frozen Service Guide snapshot into
// ordered physical pages and imposed print spreads (ADR-0008).
//
// This replaces the eight hardcoded page types and the hand-written 16-page
// imposition table in the old service-guide.js. It is a PURE pipeline:
//
//     resolveGuide(snapshot, values, serviceContext, catalog) -> physical pages
//     imposeSpreads(pages)                                     -> saddle-stitch spreads
//
// No DOM, no Firestore, no Alpine — so it is the test surface (golden-file tests
// in test/guide-engine.test.js prove the seeded default reproduces today's
// booklet). The browser preview, the Service Guide Manager preview, and the
// print path all run the SAME function, so what you author is what prints.
//
// A Component is a developer-authored preset placed in a Page Template via a
// hyphenated custom tag (see guide-components.js for the catalog). Two kinds:
//   - Bound  — auto-pulls data from the resolved serviceContext; never prompts.
//   - Input  — declares Entry Field(s) the OOS Editor fills weekly; render reads
//              the filled value out of `values`.
// One Bound Component may be "multi-page" (hymn-sheet): on a page whose template
// declares emitsPages:'component' it emits its own ordered list of physical
// pages (one hymn = N sheet-music images = N pages). The Filler Page then
// expands or contracts to hit the template's target page count.
//
// Loaded as a classic <script> before each page script, so it is wrapped in an
// IIFE exposing only window.GuideEngine; also module.exports for Node tests.
(function (global) {
    'use strict';

    // ── Custom-tag scanning ───────────────────────────────────────────────────
    // Component tags are hyphenated custom elements (oos-list, input-text,
    // hymn-sheet …). Standard HTML tags never contain a hyphen, so a hyphen is a
    // reliable, dependency-free way to find Components without a full HTML parser
    // (the engine must run under Node for the golden tests).
    const TAG_OPEN_RE = /<([a-z][a-z0-9]*-[a-z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/gi;

    // Parse an attribute string into a plain object. Supports key="v", key='v',
    // and bare boolean keys (which become true). Unicode-safe enough for the
    // controlled attribute set Components use.
    function parseAttrs(attrString) {
        const attrs = {};
        if (!attrString) return attrs;
        const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
        let m;
        while ((m = re.exec(attrString)) !== null) {
            const key = m[1];
            if (m[2] !== undefined) attrs[key] = m[2];
            else if (m[3] !== undefined) attrs[key] = m[3];
            else if (m[4] !== undefined) attrs[key] = m[4];
            else attrs[key] = true;
            if (re.lastIndex === m.index) re.lastIndex++; // guard against zero-width
        }
        return attrs;
    }

    // Walk every hyphenated custom tag in `html`, calling visit(name, attrs,
    // matchInfo) in document order. matchInfo carries the opening-tag span and,
    // for a paired tag (<x>…</x>), the end of the closing tag so callers can
    // replace the whole element. Components are leaf placeholders, so inner
    // content (if any author typed it) is treated as replaceable.
    function forEachTag(html, visit) {
        if (!html) return;
        TAG_OPEN_RE.lastIndex = 0;
        let m;
        while ((m = TAG_OPEN_RE.exec(html)) !== null) {
            const name = m[1].toLowerCase();
            const attrs = parseAttrs(m[2]);
            const openStart = m.index;
            const openEnd = m.index + m[0].length;
            const selfClosing = m[3] === '/';
            let elementEnd = openEnd;
            if (!selfClosing) {
                // Consume a matching close tag if present (content discarded —
                // Components render their own body).
                const close = new RegExp('</\\s*' + name + '\\s*>', 'i');
                const rest = html.slice(openEnd);
                const cm = close.exec(rest);
                if (cm) elementEnd = openEnd + cm.index + cm[0].length;
                // Components are leaf placeholders: skip the whole element so the
                // scanner never re-visits a Component nested in the body. Without
                // this the visited spans overlap, which corrupts replaceInlineTags
                // (it assumes ascending, non-overlapping edits) and makes
                // deriveEntryFields double-count nested Input fields.
                if (elementEnd > openEnd) TAG_OPEN_RE.lastIndex = elementEnd;
            }
            visit(name, attrs, { openStart, openEnd, elementEnd });
        }
    }

    // ── Entry Field derivation ────────────────────────────────────────────────
    // Parse a Page Template's HTML for Input Component tags and collect the Entry
    // Fields they declare (cached on the page template for the OOS Editor's
    // picker). Flags duplicate keys (same Entry Field declared twice — a bricked
    // template) and unknown component tags (typo / removed Component).
    function deriveEntryFields(html, catalog) {
        const fields = [];
        const seen = new Set();
        const duplicates = [];
        const unknownTags = [];
        forEachTag(html, (name, attrs) => {
            const comp = catalog && catalog.get(name);
            if (!comp) { unknownTags.push(name); return; }
            if (comp.kind === 'input' && typeof comp.fields === 'function') {
                for (const f of comp.fields(attrs)) {
                    if (!f || !f.key) continue;
                    if (seen.has(f.key)) { duplicates.push(f.key); continue; }
                    seen.add(f.key);
                    fields.push(f);
                }
            }
        });
        return {
            fields,
            duplicates: Array.from(new Set(duplicates)),
            unknownTags: Array.from(new Set(unknownTags)),
        };
    }

    // The set of Entry Field keys a whole snapshot asks for (across all pages).
    // Used to compute tasks-remaining and to preserve surviving values when a
    // week's template is overridden (ADR-0008 re-snapshot).
    function snapshotEntryFields(snapshot) {
        const out = [];
        const seen = new Set();
        for (const page of (snapshot && snapshot.pages) || []) {
            for (const f of (page.entryFields || [])) {
                if (f && f.key && !seen.has(f.key)) { seen.add(f.key); out.push(f); }
            }
        }
        return out;
    }

    // ── Component expansion ───────────────────────────────────────────────────

    function makeCtx(page, values, serviceContext, attrs) {
        return {
            attrs: attrs || {},
            // Per-placement parameters (e.g. which hymn slot a Hymn page binds).
            // In-tag attributes win over placement params.
            params: Object.assign({}, page && page.params, attrs),
            values: values || {},
            service: serviceContext || {},
            pageRole: page && page.role,
        };
    }

    // Replace every Component tag in `html` with its inline render() output.
    // Unknown tags are left untouched (validation surfaces them elsewhere) so a
    // partially-authored page still previews.
    function replaceInlineTags(html, page, values, serviceContext, catalog) {
        if (!html) return '';
        // Collect replacements first (so indices stay valid), then splice.
        const edits = [];
        forEachTag(html, (name, attrs, span) => {
            const comp = catalog && catalog.get(name);
            if (!comp || typeof comp.render !== 'function') return;
            let out;
            try {
                out = comp.render(makeCtx(page, values, serviceContext, attrs));
            } catch (e) {
                out = '';
            }
            edits.push({ start: span.openStart, end: span.elementEnd, text: out == null ? '' : String(out) });
        });
        if (!edits.length) return html;
        let result = '';
        let cursor = 0;
        for (const e of edits) {
            result += html.slice(cursor, e.start) + e.text;
            cursor = e.end;
        }
        result += html.slice(cursor);
        return result;
    }

    // Find the first multi-page (page-driving) Component tag on a page, with its
    // span, so expandPage can clone the page once per emitted fragment.
    function findMultiPageTag(html, catalog) {
        let found = null;
        forEachTag(html, (name, attrs, span) => {
            if (found) return;
            const comp = catalog && catalog.get(name);
            if (comp && comp.multiPage && typeof comp.renderPages === 'function') {
                found = { component: comp, attrs, span };
            }
        });
        return found;
    }

    function makePhysical(page, html, extra) {
        return Object.assign({
            pageTemplateId: page.pageTemplateId || null,
            role: page.role || 'normal',
            css: page.css || '',
            stylePresetCss: page.resolvedStylePresetCss || page.stylePresetCss || '',
            html,
        }, extra || {});
    }

    // Expand one snapshot page into 0..N physical pages.
    //   single    -> exactly one physical page (tags replaced inline)
    //   component -> the page-driving Component emits an ordered fragment list;
    //                each fragment becomes one physical page (0 fragments = the
    //                page contributes nothing, e.g. a removed hymn slot).
    function expandPage(page, values, serviceContext, catalog) {
        const html = (page && page.html) || '';
        if (page && page.emitsPages === 'component') {
            const driver = findMultiPageTag(html, catalog);
            if (driver) {
                const ctx = makeCtx(page, values, serviceContext, driver.attrs);
                let fragments;
                try { fragments = driver.component.renderPages(ctx) || []; }
                catch (e) { fragments = []; }
                return fragments.map((frag, i) => {
                    const spliced = html.slice(0, driver.span.openStart) +
                        (frag == null ? '' : String(frag)) +
                        html.slice(driver.span.elementEnd);
                    const pageHtml = replaceInlineTags(spliced, page, values, serviceContext, catalog);
                    return makePhysical(page, pageHtml, {
                        componentPageIndex: i,
                        componentPageCount: fragments.length,
                    });
                });
            }
        }
        return [makePhysical(page, replaceInlineTags(html, page, values, serviceContext, catalog), {})];
    }

    // ── Filler ────────────────────────────────────────────────────────────────
    // The Filler Page (one snapshot page with role:'filler') is cloned to bring
    // the booklet to its target page count. It expands or contracts; it never
    // drops real content. Mirrors today's sermon-notes padding, which always
    // kept at least one notes page (minFiller default 1).
    const DEFAULT_MIN_FILLER = 1;

    function resolveGuide(snapshot, values, serviceContext, catalog, options) {
        options = options || {};
        const target = (snapshot && snapshot.targetPageCount) || 16;
        const minFiller = options.minFiller != null ? options.minFiller : DEFAULT_MIN_FILLER;

        const pages = [];
        let fillerTemplate = null;
        let fillerTemplateIndex = -1;
        let fillerSlot = -1;
        const snapPages = (snapshot && snapshot.pages) || [];

        for (let i = 0; i < snapPages.length; i++) {
            const page = snapPages[i];
            if (page.role === 'filler' && fillerTemplate === null) {
                fillerTemplate = page;
                fillerTemplateIndex = i;
                fillerSlot = pages.length; // fillers splice in at the filler page's position
                continue;
            }
            // snapshotIndex lets the editor map a physical page back to the
            // Page Template (and its Entry Fields) it came from.
            for (const physical of expandPage(page, values, serviceContext, catalog)) {
                physical.snapshotIndex = i;
                pages.push(physical);
            }
        }

        const realCount = pages.length;
        let fillerCount = 0;
        if (fillerTemplate) {
            fillerCount = Math.max(minFiller, target - realCount);
            const fillerPhysical = expandPage(fillerTemplate, values, serviceContext, catalog);
            const base = fillerPhysical[0] || makePhysical(fillerTemplate, '', {});
            const clones = [];
            for (let i = 0; i < fillerCount; i++) {
                clones.push(Object.assign({}, base, { role: 'filler', fillerIndex: i, snapshotIndex: fillerTemplateIndex }));
            }
            pages.splice(fillerSlot, 0, ...clones);
        }

        const total = pages.length;
        return {
            pages,
            target,
            realCount,
            fillerCount,
            total,
            // Over the target — print still works (imposition pads to a multiple
            // of 4) but the editor warns rather than silently dropping content.
            overflow: total > target,
        };
    }

    // ── Imposition ────────────────────────────────────────────────────────────
    // Generated saddle-stitch imposition for any page list. Pages are padded with
    // blanks to a multiple of 4. For spread k (0-based) the outer/inner leaves are
    // page[n-1-k] and page[k]; even spreads put the high page on the left, odd
    // spreads flip — the generalisation of the old hand-written 16-page table
    // (the two indices of every spread sum to n-1).
    function imposeSpreads(pages) {
        const arr = (pages || []).slice();
        while (arr.length % 4 !== 0) arr.push(null); // blank leaf
        const n = arr.length;
        const spreads = [];
        for (let k = 0; k < n / 2; k++) {
            const hi = n - 1 - k;
            const lo = k;
            const even = (k % 2 === 0);
            spreads.push({
                left: even ? arr[hi] : arr[lo],
                leftIdx: even ? hi : lo,
                right: even ? arr[lo] : arr[hi],
                rightIdx: even ? lo : hi,
            });
        }
        return spreads;
    }

    // The page number shown on a physical page, matching today's booklet: the
    // outer pages (cover/title and the back) carry none; interior pages are
    // numbered by reading position. Returns { number, side } or null.
    function pageNumber(index, total) {
        if (index >= 1 && index <= total - 2) {
            return { number: index, side: index % 2 === 1 ? 'left' : 'right' };
        }
        return null;
    }

    // ── Validation (authoring guardrail, ADR-0008 §5) ─────────────────────────
    // A Page Template is publishable when it has no unknown Component tags and no
    // duplicate Entry Field keys. Returned shape feeds the Manager's inline
    // validation badges.
    function validatePageHtml(html, catalog) {
        const derived = deriveEntryFields(html, catalog);
        const problems = [];
        for (const t of derived.unknownTags) problems.push({ kind: 'unknown_tag', tag: t });
        for (const k of derived.duplicates) problems.push({ kind: 'duplicate_key', key: k });
        return { ok: problems.length === 0, problems, entryFields: derived.fields };
    }

    const GuideEngine = {
        parseAttrs,
        forEachTag,
        deriveEntryFields,
        snapshotEntryFields,
        expandPage,
        resolveGuide,
        imposeSpreads,
        pageNumber,
        validatePageHtml,
        DEFAULT_MIN_FILLER,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = GuideEngine;
    }
    if (global) {
        global.GuideEngine = GuideEngine;
    }
})(typeof window !== 'undefined' ? window : null);
