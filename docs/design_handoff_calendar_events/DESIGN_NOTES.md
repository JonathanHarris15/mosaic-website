# Calendar & Events — MS-99 design pass handoff

Five DCs, one per screen group. `README.md` (root) is the kit README, ready to paste into
`ui_kits/calendar/` with the files. Model vocabulary follows ADR-0018 and `roles-core.js` /
`events-core.js` exactly — no invented terms.

## Screens → repo surfaces

| DC | Ids | Backs onto |
| --- | --- | --- |
| `Calendar.dc.html` | 1a, 1b | new `calendar.html` / `calendar.js`; reads occurrences sparsely per ADR-0018 §3 |
| `Event Detail.dc.html` | 2a–2e | new occurrence view; Sunday variant links to the renamed **Services** page |
| `Roles and Assignment.dc.html` | 3a–3c | `roles-core.js` slots/requirements/restrictions; assignment writes |
| `Recurring Events.dc.html` | 4a, 4b | recurrence rule on the series + the orphan reconciliation prompt (ADR-0018 §3) |
| `Did They Serve.dc.html` | 5a–5c | the Pending→Involvement resolution surface (ADR-0018 §1) |

## Decisions made in this pass

1. **Month grid is the default, list is the alternative** — same two-view precedent as the
   Services page, no third pattern. The grid answers "what's on"; the **You in July** rail
   and the **Only mine** filter answer "am I in it" without hunting. On a phone the order
   flips: a navy *You in July* summary card, then a month dot-strip (one dot per event,
   navy = yours, red = needs sorting), then the agenda. The grid is reachable but not first.
2. **A Sunday chip is a cross-link, never an editor.** Serif label, `north_east` glyph,
   `--secondary` bar; on the detail screen the Sunday variant replaces the visibility
   control with a settled statement ("Sunday is public…") and a *Open on Services* button.
   No disabled control anywhere.
3. **One state dot, three tokens.** Hollow `--outline` ring = Pending (calm, and the resting
   state — no chip, no fill, no colour). Filled `--success` = Confirmed. **Declined is the
   only loud state:** the slot row gets an `--error-container` fill, a 3px `--error` left
   bar, and a filled `--error` badge reading **SAID NO — REASSIGN**, the role card's border
   turns `--error`, the event grows a top banner with a *Find someone* button, the calendar
   cell shows an `error` glyph, and the day's chip shows `priority_high`. Four escalating
   surfaces, one colour, so a glance at next Wednesday finds it.
4. **Managed and one-off roles differ in structural weight, not just label.** A managed Role
   is a bordered card: header with `badge` icon, serif name, rule line, places badge, then
   numbered slot rows with requirement captions. A one-off Role is *not a card* — a
   dashed-hairline strip below them, one row per job: `label` glyph, plain name, person
   chips, inline `+ Someone`. Adding one is a single always-visible input ending in
   "Press Enter". If a one-off ever grows a border, a header, or a count, that's the
   regression to catch in review.
5. **The picker lists everyone.** Blocked people are 45%-opacity with a `block` glyph and
   the reason as their subtitle, in the same slot where an eligible person's fairness note
   sits ("last served 6 weeks ago") — which is also where a later auto-assign suggestion
   can appear without relayout. A *Hide the ones who can't* checkbox exists but is off by
   default. The four reason strings: `Already serving here — …` / `This place needs a
   woman` / `Married to X, who is already in this role` / `Not in the X group`.
6. **Visibility is a ladder of five rows**, each with icon + name + who-sees-it in plain
   words, selected by a 3px navy bar and a check. The roster toggle sits below a hairline
   and drops to 45% with an explanatory hint at Public/Members, where it is meaningless.
7. **Changing a pattern is a question in gold, not an error in red.** `--gold` border, a
   `help` glyph, a heading that states the number of affected evenings, per-date
   Move / Delete segmented controls, and a footer sentence that recomputes ("3 moving,
   2 going — which loses 5 assignments"). *Move all* / *Delete all* shortcuts in the
   sub-header. Nothing red; nothing pre-decided except a default of Move.
8. **"Did they serve?" is scaffolding, so it is small.** One gold-barred row on the past
   event — not a banner, not a modal, no count badge in the nav. The tick-list wording is
   tidying ("Tick anyone who did it — the rest stay an open question and don't count"), and
   `5c` deliberately shows Unanswered as a grey `remove` dash beside Served, so the
   permanent-unanswered state reads as normal.

## New display helpers for the real page (pure formatting)

- `stateLabel(assignment)` → `'Pending' | 'Confirmed' | 'Declined'`; `stateTone(assignment)`
  → `'calm' | 'good' | 'attention'` — the three-way switch every surface above keys off.
- `needsAttention(occurrence)` → true if any assignment is Declined. Drives the calendar
  cell glyph, the chip flag, and the *Needs sorting* rail in one place.
- `visibilityLabel(level)` / `visibilityIcon(level)` / `visibilityWho(level)` — the five
  rungs' display name, Material Symbol, and plain-language sentence.
- `recurrenceSentence(rule)` → the Garamond "Reads as" string ("Every Wednesday at 7:00 pm,
  until further notice.").
- `blockReason(person, slot, role, occurrence)` → the picker's subtitle string, or null when
  the person is eligible. Must return a *reason*, never a boolean — the whole point of §5.
- `orphanOutcome(date, choice)` → the per-row consequence line; `orphanSummary(choices)` →
  the footer sentence.
- `unconfirmedCount(occurrence)` → drives the past-event prompt; zero means render nothing.

## Responsive

Phone layouts are in `Calendar.dc.html` (1b) and `Event Detail.dc.html` (2e) at 390px.
Port them as `html.shell-mobile` overrides, same as the Tags and Relationships tabs: row
actions always visible (no hover on touch), the desktop right rail becomes the top summary
card, the month grid becomes the dot-strip, and slot rows get `min-height:48px`. The
heavier editors (3a–3c, 4a–4b, 5b) assume desktop.

## Icon-set correction — the exact diff

`SKILL.md` in the design system **contains no icon rule at all** (grepped for `icon` and
`lucide`: no matches), so it needs no change. Only `readme.md` does. Applied to the copy
under `_ds/…/readme.md` in this project; apply the same three edits to the design system's
own `readme.md`:

**1. The "Note on the live app" callout (line ~19)** — was:

> …but `mosaic-theme.js` re-points every font token to **Cinzel / EB Garamond / Libre Franklin** and calls for **Lucide** icons. This system follows the corrected `mosaic-theme.js` direction. The live pages are mid-migration.

now:

> …but `mosaic-theme.js` re-points every font token to **Cinzel / EB Garamond / Libre Franklin**. This system follows the corrected `mosaic-theme.js` direction on type. On icons it does **not**: `mosaic-theme.js` finding #7 proposed swapping to Lucide, and that swap never happened — all 23 pages of the app use **Material Symbols (Outlined)**, including the Roles Manager as rebuilt in MS-120. Material Symbols is therefore the documented icon system (corrected in MS-99).

**2. `## Iconography`, first three bullets** — the icon-system bullet now names Material
Symbols with the Google Fonts `<link>` and `<span class="material-symbols-outlined">`
usage; the style bullet keeps **stroke ≈ 1.75px** (as `wght` 300–400 at 18–22px),
`currentColor`, and `FILL 0`; the glyph list is translated one-for-one:
`book-open`→`menu_book`, `calendar`→`calendar_month`, `bar-chart-3`→`bar_chart`,
`users`→`groups`, `library`→`library_music`, `droplet`→`water_drop`, `edit-3`→`edit`,
`clock`→`schedule`, `chevron-right`→`chevron_right`, `sliders-horizontal`→`tune`,
`plus`→`add`. `shield`, `mic`, `search` are unchanged. **Emoji: never** is untouched.

**3. Components list** — "**Select** — native dropdown matched to Input, with a Lucide
chevron" → "…with an inline chevron glyph."

The intent behind the original rule is unchanged and still binding: **one** icon set across
the product, outline style at ~1.75px, `currentColor`, never emoji.

One loose end: the bundled `Select` component draws its chevron as an inline SVG copied
from Lucide. Visually identical to `expand_more` at these sizes, so it is not worth a
bundle change on this ticket — but it is the last Lucide artefact in the system and should
be swapped when `Select` is next touched.

---

# Relationships tab — design pass handoff

`Relationships Tab.dc.html` is the interactive mockup. It models the same state the
Alpine component holds, so every state is real (create/edit a type, add/remove pairs,
create groups, add/remove/promote members, empty + error + toast states).

## How the mockup maps to the Alpine bindings

The mockup's logic mirrors the required Alpine surface 1:1 — port the *markup*, keep
your existing state/method behaviour:

- **State** used verbatim: `activeTab`, `relError`, `relTypes`, `relPairs`,
  `relGroups`, `relPeople`, `selectedTypeId`, `showTypeForm`, `editingTypeId`,
  `typeForm.*`, `pairForm.*`, `groupForm.name`, `memberPicker.*`.
- **Methods** all present with the same names/semantics: `typeSummary`, `labelFor`,
  `personName`, `pairsForType`, `groupsForType`, `instanceCount`, `personCandidates`,
  `startNewType`, `startEditType`, `saveType`, `resetTypeForm`, `deleteType`,
  `selectType`, `pickPairPerson`, `addPair`, `removePair`, `pairSentence`,
  `createGroup`, `addGroupMember`, `removeGroupMember`, `setGroupLeader`,
  `clearGroupLeader`, `deleteGroup`, `showToast`.
- Hard rules honoured: `kind` disabled while editing; type/group creation lives only
  here; `deleteType` count-confirms the cascade; only Prioritized groups show a leader
  slot; leaderless/empty groups are calm resting states; `relError` is a visible banner.

## New *display* helpers to add to `public/shepherding-relationships.js`

These are pure formatting — no behaviour change:

- `kindLabel(type)` → `'Pairwise' | 'Group'`; `kindIcon(type)` → `swap_horiz | groups`.
- `priorityLabel(type)` → `'Prioritized' | 'Symmetric'`; `priorityIcon(type)` →
  `trending_flat | sync_alt`.
- `initials(name)` → 1–2 letter avatar text.
- `roleLabel(type, side)` — thin wrapper over `labelFor` returning the UPPERCASE field
  caption ("Discipler"/"Leader"/"Person") for the pair-add slots.
- `previewSentence(typeForm)` — the live "Reads as" string in the type form
  (e.g. `Alice (Discipler) → Bob (Disciplee)`), driven off `typeForm` not saved data.

## Design decisions (the 8 crude points)

1. **Type form** — kind × priority are two segmented controls; below them a live
   "shape you're building" panel whose avatars + inline label inputs redraw per
   quadrant, with a Garamond-italic "Reads as" sentence. The 2×2 is now the hero.
2. **Type rows** — kind + priority are rectangular badges (secondary/tertiary tints);
   summary is the serif label pattern; a navy accent bar marks the selected row.
3. **Person pickers** — one reusable popover: search field, ↑/↓ + Enter + Esc, a
   highlighted active option, and a real "no matches" line. Excludes already-used ids.
4. **Roster chips** — avatar + name; on hover reveal a labelled **Lead** button (star)
   and a remove ×, both ≥26px targets. "Promote" is now the word "Lead".
5. **Pair-add** — two person slots with a directional `arrow_right_alt` (prioritized)
   or `sync_alt` (symmetric) between them, roles captioned above each slot.
6. **Empty states** — icon + calm one-liner in a dashed container, never italic-grey
   apology. Leaderless/empty groups read as normal.
7. **Responsive** — `@media (max-width:640px)` rules stack the pair-add column, reveal
   row actions (no hover on touch), and tighten padding. Port these into the page's
   `<style>` block as `html.shell-mobile` overrides to match the Tags tab.
8. **Icon buttons** — reveal on hover (desktop), consistent with the Tags tab; always
   visible on mobile via the media query.

## Tokens
Everything uses the Mosaic semantic tokens (`--primary`, `--on-surface-variant`,
`--surface-container-*`, `--outline-variant`, `--secondary-container`, etc.) — no raw
hex. In the real page these are the Tailwind theme utilities (`bg-surface-container-lowest`,
`text-on-surface-variant`, `px-md`, `font-label-md`, …). Icons are Material Symbols
Outlined, matching the Tags tab.

---

# Relations Viewer — Groups & Priority pass (MS-97 / ADR-0014)

`Relations Viewer.dc.html` was extended for **prioritized relationships** (arrowheads),
**Relationship Groups** (bubbles), **leader lines**, and a **group-clustering force**.
The hand-rolled 2D-canvas physics engine was extended, not replaced — presets,
Show-isolated, Show-inactive, search, stage pips, and the three original edge kinds all
still work exactly as before. Desktop only. No d3 / SVG / new libraries.

## What `buildGraph` must emit for the viewer

The mockup builds this shape inline; the real `relations-graph-core.js` must emit it.

**1. Edges gain a direction flag.** Each edge already has `{ a, b, type }`. For a
**prioritized** pairwise type, `a` is the **priority holder** and `b` the counterpart —
the viewer draws the arrowhead pointing at `b`. Symmetric types render as a plain line.
No per-edge flag is strictly required if the *type* carries priority, but the viewer must
be able to ask, per edge type: `prio: true|false`. Family/Elder are always `prio:false`.

**2. Relationship Groups — one hull descriptor per group** (exactly the shape you
proposed):

```js
{ id, name, typeId, colour, leaderId | null, memberIds: [ ... ] }
```

- `typeId` → a **Group-kind** relationship type (`kind === 'group'`). A group type has
  **no edges**; it governs bubbles only.
- `leaderId` is `null` for a **Symmetric** group type and for a **leaderless**
  Prioritized group — both are normal resting states, not errors.
- `memberIds` may be **empty** (empty group is fine; the viewer simply draws no bubble
  for it that frame). The leader is **not** included in `memberIds`.

**3. Colour assignment (please do it in core).** Assign each group a colour from the
**proposed GROUP palette** below, cycling by stable group order so a group keeps its
colour across reloads. The viewer will use whatever `colour` you send; it does not
recolour. Keep the palette out of the stage-pip / edge ranges (it already is).

**Proposed GROUP palette** (muted, warm-harmonious, kept distinct from the stage pips
and the edge palette both by hue and by being rendered as filled regions):

```
#5E8C8A  #C0803A  #8E6FA6  #6F9E5C  #C26B6B  #4E7BA6
```

**4. Group-type metadata.** Per group type the viewer needs `kind` (`'group'`),
`priority` (`'prioritized'|'symmetric'` → `prio` boolean), a display `label`, and an
icon name. Prioritized group types show a leader slot + leader line; symmetric ones do
not.

## New display helpers the viewer wants (pure formatting, no behaviour change)

- `groupHullPoints(group, positions)` — optional: if core wants to own hull geometry,
  return the ordered hull polygon. Otherwise the viewer computes it (see below).
- `groupColour(group)` — returns the assigned palette hex (or the viewer falls back to
  cycling the palette by index).
- `isPrioritizedType(type)` / `isGroupType(type)` — booleans mirroring `kind`/`priority`.
- `leaderColourFor(personId)` — the colour of the (first) group a person leads, for the
  node's leader ring. Null if they lead nothing visible.

## Display decisions made in this pass (so the real page matches)

- **Arrowheads** — drawn in **screen space at constant pixel size** (≈8.5px), so they
  stay legible at low zoom and on dashed/dotted edges (the head is a solid filled
  triangle, drawn after the dashed stroke). Placed just outside the counterpart node
  radius. Only prioritized types get them; Family/Elder never do, so the graph doesn't
  become a thicket of arrows. Global gate: `showArrows` prop.
- **Bubbles** — a smoothed closed blob (quadratic-through-midpoints) over the **convex
  hull of ring-sampled points** around each member node (14 samples × (nodeR + 22px)
  padding). This one path handles a 1-person group (→ circle) through a 30-person group
  uniformly. Fills use **`multiply` blend at ~0.16 alpha** so overlaps darken
  predictably and read as intersections; strokes are the full group colour at ~0.7
  alpha. Larger bubbles are drawn first so smaller bubbles' strokes stay on top and
  traceable. **Community (prioritized) = solid stroke; Serve (symmetric) = dashed
  stroke.** Global gate: `showGroups` prop.
- **Group name** — a parchment chip (colour dot + name) pinned at the **top vertex of
  the hull** in screen space, so it survives overlap and zoom.
- **Leader line** — **one** line from the leader node to the **nearest point on the
  hull** (not a star to every member), ending in a small filled **diamond anchor** on
  the hull, in the group colour; the leader node also gets a group-colour **ring**. The
  leader is kept just outside the hull by a weaker centroid pull (see clustering).
  A leaderless group simply omits the line.
- **Clustering force** — an **added centroid attractor** per visible group
  (`k ≈ 0.013 × heatBoost` for members, `0.008` for the leader). It is summed into the
  same force accumulator as repulsion/springs and **does not change any edge rest
  length** — the family/elder spring structure still dominates; clustering only keeps a
  group from stretching into a sliver. If core would rather emit `clusterHint` weights
  per group, the viewer can read them, but the default constant works well.
- **Sidebar** — group types live in a **separate "Groups" section** (distinct from the
  edge-type list). Each row shows a **two-overlapping-bubbles swatch** (not a line), the
  type label, a prioritized marker, the group count, and **one toggle that governs both
  the bubbles and the leader lines** of that type. Under an enabled type, each group is
  listed with its colour chip, name, and a Leader/Open badge; clicking a group frames it.
- **Detail panel** — a person's **Groups** section lists every group they're a member or
  leader of (colour tile + type + Leader/Member badge, click to frame the group), above
  the existing Relationships section. Discipleship relationships now name the
  Discipler/Disciplee roles.

## Palette / token note
Group-bubble colours are the one **explicitly proposed palette** (above); everything
else in the viewer uses Mosaic tokens / the documented edge + stage-pip hexes. No new
raw hex outside that palette.
