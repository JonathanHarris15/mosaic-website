# Calendar & Events — UI kit (MS-99)

Cosmetic recreations of the Calendar surfaces, built against the Mosaic Website Design
system. Paste into `ui_kits/calendar/` alongside `hymn_directory/` and
`public_directory/`.

The screens are authored as Design Components (`*.dc.html`) rather than
`index.html` + JSX, matching how the Roles Manager, Relationships tab, and Relations
Viewer passes in this project were delivered. Each file opens directly in a browser and
loads the design-system bundle from `_ds/…/_ds_bundle.js`; each is a canvas holding every
state of its screen side by side, with a stable `{turn}{letter}` badge on each option so
they can be referenced in review (`1a`, `2c`, `4b`…).

## Screens

| File | Ids | What it covers |
| --- | --- | --- |
| `Calendar.dc.html` | `1a` desktop, `1b` phone | The front door. Month grid (default) with a live **Month / List** control, an **Only mine** filter, a *You in July* rail, and a *Needs sorting* rail. Sundays link across to Services rather than opening an editor. Phone is agenda-first with a month dot-strip. |
| `Event Detail.dc.html` | `2a` editor, `2b` member (roster shared), `2c` member (own part only), `2d` Sunday, `2e` phone member + phone editor | One event. Details, roles, the five-rung visibility ladder, the roster-sharing toggle, and the recurrence summary. Sunday shows its visibility as settled, not as a disabled control. |
| `Roles and Assignment.dc.html` | `3a` adding a role, `3b` the picker, `3c` the three states | Managed vs one-off roles at deliberately different weights; the person picker that lists **everyone** with the reason each blocked person can't take the place; the Pending / Confirmed / Declined specimens and the control an editor uses. |
| `Recurring Events.dc.html` | `4a` the pattern, `4b` dates that no longer fit | Weekly / fortnightly / monthly only, with a Garamond "Reads as" sentence and a preview of the next dates. `4b` is the careful question: five orphaned evenings, who is on each, move-or-delete per date, and a live consequence sentence. |
| `Did They Serve.dc.html` | `5a` where it turns up, `5b` tidying up, `5c` afterwards | The gentle prompt on a past event, the tick-list, and the resting state where "unanswered" reads as normal rather than as an error. |

## Design-system components used

Everything is composed from the bundle's primitives or their inline equivalents at the
same token values: **Button** (primary / secondary / ghost), **IconButton** (ghost),
**Input**, **Checkbox**, **Badge** (rectangular, 6px), **Card** (flat + hairline),
**Avatar** (initials), **SectionLabel** (tracked-caps overlines). No **NavCard**,
**Select**, or **ScriptureBlock** in this kit.

**No new primitive is needed.** Two patterns are new *compositions* worth promoting later
if they recur:

- **Visibility ladder** — five stacked radio rows, each icon + name + plain-language
  "who sees it", selected row marked by a 3px navy accent bar. Built from Card + rows.
- **State dot** — 7px circle, hollow (`--outline` ring) for Pending, filled `--success`
  for Confirmed, filled `--error` for Declined. Three tokens, one shape, used identically
  in all five screens.

## Rules the kit holds to

- Material Symbols (Outlined) throughout — see the icon note below. No Lucide, no emoji.
- Flat cards, 1px `--outline-variant` hairlines, tonal layers. Shadows only `--shadow-xs`
  on primary buttons. No gradients.
- Cinzel for page and panel titles; EB Garamond for role names, "Reads as" sentences, and
  the one-line summaries a person reads; Libre Franklin for every label, button, and field.
- Semantic tokens only. The one place a raw value appears is the steel-teal focus ring
  `rgba(93,148,169,.18)`, matching the Input component.
- Phone screens keep every tap target ≥ 44px.

## Icon-set correction

`readme.md` documented **Lucide** as non-negotiable. The product uses **Material Symbols
(Outlined)** on all 23 pages, including the Roles Manager as rebuilt in MS-120. The
intent behind the rule — one icon set, ~1.75px stroke, `currentColor`, no emoji — stands;
the library name was wrong. `readme.md` is corrected in this pass. `SKILL.md` carries no
icon rule at all, so it needs no change — see `HANDOFF.md` for the verified diff.
