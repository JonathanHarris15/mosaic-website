# Service Guide Template System — Executable Plan

> Status: **Planned** · Owner: Jonathan Harris · Last refined: 2026-06-24 (grill-with-docs session)
>
> This document supersedes the original free-form sketch. Vocabulary is canonical in
> [CONTEXT.md](../../CONTEXT.md) under "Service Guide Template System". The data-flow sketch is
> [image.png](./image.png).

## 1. Goal

Replace the eight **hardcoded** Service Guide page types with a fully general, user-composable
template system, and **merge** the Order of Service editor and the Service Guide generator into a
single tool launched from the Service Calendar.

The pipeline (from the sketch):

```
Components (Input + Bound)  ─┐
                             ├──►  Page Template  ──(×N)──►  Page Library
Style Preset (master CSS) ───┘                                   │
                                                                 ▼
                                           Service Guide Template (ordered pages, count, filler)
                                                                 │
                                              default ──► every week  │  per-week override
                                                                 ▼
                                          OOS Editor (fill Entry Fields)  ──►  Service Guide (print)
```

**v1 definition of done:** a developer-seeded **default Service Guide Template reproduces today's
16-page booklet 1:1** — but now every page is editable, reorderable, and replaceable through the UI.

## 2. Decisions locked in this session

| # | Decision | Choice |
|---|----------|--------|
| 1 | The 8 hardcoded page types | **Full replacement** — reborn as developer-seeded Page Templates + Components. No special-cased page code remains. |
| 2 | Component model | **Two kinds, one model** — Input Components (declare Entry Fields, prompt weekly) and Bound Components (auto-pull, never prompt). |
| 3 | Vocabulary | Page Template, Component, Input/Bound Component, Entry Field, Page Library, Style Preset, Service Guide Template, Filler Page. Written to CONTEXT.md. |
| 4 | Unified editor layout | **Single unified scroll** — pages top-to-bottom, liturgy fields and Entry Fields interleaved by page, live booklet preview alongside. Launched from the calendar. |
| 5 | Page count | **Configurable target per Service Guide Template** (multiple of 4, default 16). Filler Page expands/contracts to hit the target exactly. Overflow warns. |
| 6 | Variable-length sections | **Components own pagination internally** — a Bound Component emits its own list of physical pages. |
| 7 | Pagination scope (v1) | **Discrete only** — a component emits a known list of whole pages (hymn = N images = N pages). No continuous text reflow. Single-page overflow warns. |
| 8 | Persistence of past weeks | **Past weeks freeze** — each week stores a frozen snapshot of its resolved guide. Editing a template affects future weeks only. |
| 9 | Authoring access | **editor+** (same as weekly editing). Requires strong authoring guardrails. |
| 10 | Existing data | **No bulk migration** — old `guide.elements` renders read-only via a kept legacy path; new weeks use the new pipeline. |
| 11 | v1 catalog | **Reproduce today exactly** — no new content types in v1. |

## 3. Data model

All new collections are **global** (single-church app, consistent with `services`/`people`/`hymns`).

### 3.1 Components — in code, not Firestore
Components are developer-authored presets registered in a code catalog (e.g.
`public/guide-components.js`). They are **not** Firestore documents. Each entry declares:

```js
// Bound Component
{
  tag: 'oos-list',                 // custom HTML tag authors place in a page
  kind: 'bound',
  label: 'Order of Service',
  // Given a resolved Service context, return ordered physical-page HTML fragments.
  render(ctx) { return ['<section>…</section>']; }   // length = physical page count
}

// Input Component
{
  tag: 'input-richtext',
  kind: 'input',
  label: 'Rich Text',
  // Declares the Entry Field(s) this tag contributes, derived from its attributes.
  fields(attrs) { return [{ key: attrs.key, type: 'richtext', label: attrs.label }]; },
  render(ctx, value) { return [`<div>${value ?? ''}</div>`]; }
}
```

**v1 catalog:**

- **Bound:** `service-date`, `theme`, `key-verse-ref`, `key-verse-text` (ESV), `oos-list`,
  `hymn-sheet` (discrete multi-page from `hymns`), `schedule`, `baptism-names`,
  `pastoral-prayer-subject`.
- **Input:** `input-text`, `input-richtext` (also the docx-import target), `input-image`,
  `input-list` (repeating group of sub-fields — powers announcements, Mosaic Kids questions,
  summary bullets, pastoral-prayer country stats). The announcements use of `input-list` carries
  the **previous-week suggestions** feature (port of [fetchPreviousAnnouncements](../../public/service-guide.js#L356)).

### 3.2 `style_presets/{id}`
```
{ name, css, createdAt, updatedAt }
```

### 3.3 `page_templates/{id}`
```
{
  name,
  html,                 // author-written body; contains Component custom tags
  css,                  // page-specific CSS
  stylePresetId,        // optional inherited Style Preset
  entryFields: [ … ],   // DERIVED by parsing html for Input Component tags; cached for the picker
  emitsPages: 'single' | 'component',  // 'component' => a Bound Component drives page count
  isFiller: bool,       // may this page act as a Filler Page?
  createdAt, updatedAt
}
```

### 3.4 `guide_templates/{id}` — Service Guide Template
```
{
  name,
  pages: [ { pageTemplateId, role: 'normal' | 'filler' } ],  // ordered
  targetPageCount,      // multiple of 4, default 16
  isDefault: bool,      // exactly one true
  createdAt, updatedAt
}
```

### 3.5 `services/{date}.guide` — per-week (frozen)
```
{
  guideTemplateId,      // provenance ref
  snapshot: {           // FROZEN resolved structure at apply time (decision #8)
    targetPageCount,
    pages: [ { pageTemplateId, html, css, resolvedStylePresetCss, entryFields, role } ]
  },
  values: { <entryFieldKey>: <value> },   // filled Entry Field data
  format: 'v2',         // discriminator; absent/old => legacy renderer (decision #10)
  updatedAt
}
```

## 4. Rendering & pagination pipeline

A pure function turns `(snapshot, values, serviceContext)` → ordered physical pages → imposed
spreads → print. No special-casing per page type.

1. **Resolve context** — load the Service, its liturgy, hymn details, ESV text, schedule, baptism
   names into a `serviceContext` object (ports the existing `loadService`/`fetchHymnDetails`/
   `fetchSchedule` logic).
2. **Expand pages** — for each snapshot page in order, run its Components:
   - Input Component tags → replaced by `values[key]`.
   - Bound Component tags → replaced by `render(ctx)`; a `hymn-sheet` returns N fragments,
     producing **N physical pages** (decision #6/#7, discrete).
3. **Apply Filler** — count real physical pages; the Filler Page is cloned/removed so the total
   equals `targetPageCount`. If real pages already exceed the target, **warn** (port of the
   current `isOverflowing` warning) — do not silently drop content.
4. **Impose** — replace the hardcoded [bookletSpreads](../../public/service-guide.js#L286) table
   with a **generated saddle-stitch imposition** for any multiple-of-4 count
   (`spread k: page[n-1-2k] | page[2k]` pattern, generalised).
5. **Print** — clone resolved pages into the print layer in imposition order and `window.print()`
   (keep the existing [printGuide](../../public/service-guide.js#L485) `x-ignore`/`afterprint`
   cleanup approach).

> Single-page overflow detection (content taller than one physical page) shows a per-page warning
> badge in the editor; no auto-reflow in v1 (decision #7).

## 5. Service Guide Manager (authoring surface)

New page `public/service-guide-manager.html` + `.js`. Gated to **editor+** (decision #9), with
guardrails because that group is wide.

Three sub-areas:

1. **Page Library** — list/create/rename/delete Page Templates. Editing a Page Template opens the
   **split authoring editor**:
   - Left: a *simple* code editor (recommend **CodeMirror 5**, lightweight, already CDN-friendly)
     with two tabs — HTML and CSS.
   - Right: live preview rendered against **sample/placeholder data** (no week context here).
   - A **Component palette** inserts custom tags with their attributes (authors may also hand-type).
   - Live validation: unknown tags, unbalanced HTML, and duplicate Entry Field keys are flagged
     inline. Entry Fields are re-derived on save.
2. **Style Presets** — list/create/edit master CSS a Page Template can inherit.
3. **Service Guide Templates** — assemble ordered pages from the Page Library, set
   `targetPageCount`, mark one page as Filler, and set the church-wide default.

**Guardrails (because editor+ can brick the booklet):** preview-before-save, a "Reset to seeded
default" action per seeded template, and snapshotting (#8) means a bad template edit can never
retroactively break already-printed weeks.

## 6. Unified OOS Editor (weekly surface)

Merge [service-builder](../../public/service-builder.js) + [service-guide](../../public/service-guide.js)
into one page launched from the Service Calendar (replaces both `service-builder.html` and
`service-guide.html`). **Single unified scroll** (decision #4):

- Top: week header + **Service Guide Template picker** (defaults to the church default; changing it
  overrides for this week only — re-snapshots, preserving `values` whose Entry Field keys survive).
- Body: the booklet's pages top-to-bottom. For each page, the **structured liturgy editors**
  (preacher/hymn/person pickers — ported from the builder) and the page's **Entry Field inputs**
  appear inline, with the **live page preview** alongside.
- The structured Service entity remains the canonical source feeding Bound Components; liturgy
  editing is not dissolved into generic blanks.
- Footer/sidebar: "tasks remaining" affordance (port of [tasksRemaining](../../public/service-guide.js#L653))
  now computed generically from required Entry Fields, plus **Print**.

On first open of a week with no `guide`, snapshot from the default template. The legacy renderer
(decision #10) handles weeks whose `guide` lacks `format: 'v2'`.

## 7. Implementation phases

Each phase is independently shippable and test-guarded.

- **Phase 0 — Engine spine.** Component registry + catalog (§3.1), the pure render/expand/filler
  pipeline (§4) with the generated imposition, and unit tests against fixtures. No UI yet.
- **Phase 1 — Seeded default reproduces today.** Author the 8 seeded Page Templates + default
  Service Guide Template in code/fixtures so the new pipeline outputs a byte-comparable 16-page
  booklet to the current one for representative past services. **This is the v1 acceptance gate.**
- **Phase 2 — Persistence + collections.** `style_presets`, `page_templates`, `guide_templates`,
  the new `services/{date}.guide` shape, snapshot-on-apply, Firestore rules (editor+ read/write).
- **Phase 3 — Service Guide Manager.** Authoring editor, palette, validation, Style Presets,
  template assembly, default selection (§5).
- **Phase 4 — Unified OOS Editor.** Merge the two pages, single-scroll UX, template picker /
  per-week override, generic tasks-remaining, print (§6). Calendar links repoint here.
- **Phase 5 — Legacy + cleanup.** Legacy read-only render path for old guides; remove the dead
  hardcoded element code once the seeded templates fully cover it.

## 8. Testing strategy

- **Render pipeline (Phase 0/1):** golden-file tests — fixture Service + seeded template →
  expected physical pages and imposition order. Cover: variable hymn counts, filler expand &
  contract, overflow warning, every multiple-of-4 target.
- **Entry Field derivation:** parsing a Page Template's HTML yields the correct Entry Field set;
  duplicate-key detection fires.
- **Snapshot/freeze:** editing a `guide_template` does not alter an already-snapshotted week.
- **Override:** switching a week's template preserves values for surviving keys, drops the rest.
- **Migration:** an old-format `guide` renders read-only and prints without touching its data.

## 9. Open questions / phase 2 wishlist

- Continuous text reflow across pages (decision #7 deferred). Keep the Component interface
  (`render → array of fragments`) compatible so a future reflow component fits without rework.
- New content types beyond today's 8 (none captured in v1 — decision #11).
- Authoring preview against a *real* chosen week instead of placeholder data.

## 10. Related ADRs

- [ADR 0003](../adr/0003-service-guide-generator.md) — HTML/CSS + `window.print()` rendering
  (still holds; this plan generalises the *authoring* model, not the rendering tech).
- [ADR 0008](../adr/0008-service-guide-template-system.md) — "Service Guide Template System: full
  replacement + per-week snapshot." Captures decisions #1, #6, and #8 (the hard-to-reverse,
  surprising, real-trade-off ones).
