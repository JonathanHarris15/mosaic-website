# ADR 0008: Service Guide Template System — Full Replacement + Per-Week Snapshot

## Status
Accepted

## Context
The Service Guide is currently built from **eight hardcoded page types** (`title_page`,
`order_of_service`, `hymn_pages`, `pastoral_prayer`, `sermon_notes`, `kids_section`,
`announcements`, `custom_page`). Each has a bespoke editor panel and a bespoke print template in
`service-guide.js`, the booklet is fixed at **exactly 16 pages** with a hand-written imposition
table, and `sermon_notes` is the de-facto padding mechanism. Adding or changing a page means a code
change. The Order of Service editor (`service-builder.js`) and the Service Guide generator
(`service-guide.js`) are also two separate pages.

We want churches to compose their own pages (HTML/CSS + reusable Components) into named **Service
Guide Templates**, pick a default, override per week, and generate a variable-length booklet — all
from a single tool launched off the Service Calendar. See the executable plan in
[docs/plans/service_guide_template_system.md](../plans/service_guide_template_system.md) and the
glossary in [CONTEXT.md](../../CONTEXT.md) ("Service Guide Template System").

Three choices in this design are hard to reverse, surprising without context, and the result of
real trade-offs. They are recorded here.

## Decision

### 1. Full replacement, not coexistence
The eight hardcoded page types are **removed** and reborn as developer-seeded **Page Templates** and
**Components** inside one general engine. No special-cased page code survives. The seeded default
Service Guide Template must reproduce today's 16-page booklet 1:1 — that is the v1 acceptance gate.

A **Component** is a developer-authored preset placed in a Page Template via a custom HTML tag, of
two kinds under one model: an **Input Component** declares an Entry Field the OOS Editor prompts for
weekly; a **Bound Component** auto-pulls existing data (Service fields, the Order of Service, the
`hymns` collection, the ESV API) and never prompts. Components ship in code, not Firestore.

### 2. Components own their pagination (discrete, in v1)
A section that spans a variable number of physical pages — hymn sheet music being the real driver
(1–3 images per hymn) — is handled by the **Bound Component emitting its own ordered list of whole
pages** (`render(ctx) → fragment[]`, one fragment per physical page). The render pipeline counts the
emitted pages and lets the **Filler Page** expand or contract to hit the template's configured
target page count (a multiple of 4; default 16). The fixed imposition table is replaced by a
**generated** saddle-stitch imposition for any multiple-of-4 count. v1 supports **discrete**
pagination only (each fragment is exactly one page); continuous text reflow is deferred.

### 3. Per-week snapshot (past weeks freeze)
Each week's `services/{date}.guide` stores a **frozen snapshot** of its fully resolved guide
structure (pages, their HTML/CSS, resolved Style Preset, derived Entry Fields) plus the filled
`values`, taken when the template is applied to that week. Editing a `guide_template` afterwards
affects **future weeks only**; re-opening and reprinting a past week reproduces what was handed out
then. Switching a week's template re-snapshots, preserving `values` whose Entry Field keys survive.

## Alternatives Considered

**Coexist / hybrid** — keep hymn/prayer/kids as native code and let templates govern only new custom
pages. Rejected: two parallel mechanisms is more long-term complexity, and the special-casing is
exactly what motivated the rework. (Accepted cost: a bigger, riskier overhaul up front.)

**Repeating Page Templates** for variable-length sections — a template flagged "repeating", cloned
once per bound item. Rejected in favour of components-own-pagination so one component (`hymn-sheet`)
encapsulates both its data and its page count; the page author drops one tag rather than wiring a
repeat binding. (Accepted cost: page count is less predictable from the template alone — mitigated
by the Filler Page absorbing the variance and an overflow warning.)

**Continuous reflow engine** in v1 — measure and break long content across pages. Rejected for v1:
the only real multi-page need (hymns) is discrete, and a measure/break engine carries significant
build cost and print-fidelity risk. The `render → fragment[]` interface is kept reflow-compatible
for a later phase.

**Live-reference templates (past weeks update)** — every week always reflects the current template.
Rejected: reprinting an old week could differ from the copy congregants received, silently
rewriting history. (A "freeze, but offer refresh" middle option was considered and deferred as
extra UI for no v1 need.)

## Consequences
- The per-week `guide` shape changes from an embedded `elements` blob to
  `{ guideTemplateId, snapshot, values, format: 'v2' }`. Existing guides lack `format: 'v2'` and are
  rendered **read-only via a kept legacy path** — there is no bulk migration.
- Rendering becomes a pure pipeline `(snapshot, values, serviceContext) → physical pages → imposed
  spreads → print`, testable with golden-file fixtures independent of any UI.
- New global collections: `style_presets`, `page_templates`, `guide_templates`. Components remain in
  a code catalog; adding/altering one is a deploy, by design.
- Template authoring is open to **editor+** (same as weekly editing), so the authoring UI must carry
  guardrails (preview-before-save, reset-to-seeded-default). The snapshot model (decision 3) is what
  makes this safe: a bad template edit cannot retroactively break an already-printed week.
- The OOS editor and Service Guide generator merge into one calendar-launched page; `service-builder`
  and `service-guide` are superseded.
- This mirrors the denormalization trade-off in [ADR 0005](./0005-pastoral-record-status-denormalization.md)
  and [ADR 0007](./0007-prayer-request-one-time-generation.md): a frozen per-record snapshot is kept
  alongside the live source because the historical view needs its own stable record.
