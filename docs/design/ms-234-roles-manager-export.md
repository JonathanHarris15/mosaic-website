# MS-234 — Roles Manager: what came back

**Date:** 2026-08-14
**Source:** `ui_kits/roles-manager/` in the Mosaic Website Design project
(`f2292e35-4adc-4d33-a42d-7ca9373364c9`).
**Brief it answers:** [`ms-234-roles-manager-prompt.md`](./ms-234-roles-manager-prompt.md)

Files returned: `index.html` · `README.md` · `EXPORT_PROMPT.md` · `app.jsx` ·
`data.jsx` · `kit.jsx` · `screens.jsx` · `phone.jsx` · `page.css` · `roles.css`

Eleven screens: the shape at 1440 · a Role that breaks the row · every rule
there is · rules that have stopped working · the composer mid-sentence · the six
that are locked · who does not serve · save refused · the states · 390px · and a
screen answering the brief's six open questions.

---

## The shape it settled on

One `.m-split` with a 372px list. The list holds only Roles — the create field,
the picklist, then a hairline, the label *The whole church*, and **two rows**:
*Sunday Service Roles* and *Doesn't serve*. Both open in the pane, so neither
stands between the first Role and the seventh any more.

The pane divides rather than stacking: **name · what it involves · how often it
can be asked** down the left, **who it needs** down the right, and **the rules
across the foot**, where the composer has room to read as a sentence. Both halves
scroll independently and the page itself never scrolls.

`.m-tabs` was considered and rejected — its own prompt warns that a page with
tabs is usually a page that should have been two pages, and one Role has five
groups of settings rather than five sides.

---

## What it disagreed with the brief about

1. **`Cannot serve together if` may be unreachable.** The brief's §2 gives
   `Two people connected by "Marriage" cannot serve in this Role together`. That
   rule is `notTogether`, which `validateRestriction` refuses against anything but
   a **pairwise** type — and `roles-core.js` reserves `marriage` as a **group**
   type. Both real shared types in the brief (House Group, Small Group) are groups
   too. With the data as given, `ruleKindOptions` never offers that opener. The kit
   renders it from an **invented** pairwise type (`marriage_pair`). **Confirmed
   against the code: the design is right and the brief was wrong.**
2. **The clash message prints a stored id.** `…clashes with the built-in Role
   "prayer"` is the shipped string, and `prayer` is a slug — on a screen the brief
   said must never show one. Fix in the template: name it from `LITURGICAL_ROLES`.
3. **Casing.** The brief wrote *"This role can't be saved yet:"*; the page's own
   toast capitalises Role. Followed the code.
4. **The description counter can never go red through the box** — `maxlength`
   stops it at 600, so the negative branch is only reachable via a hand edit of
   `/roles`. Kept the branch, drew no screen for it.
5. **`weeks' rest` is static text on the locked card**, so it reads "1 weeks'
   rest" today. A real bug, found on the way through.

---

## What it invented, by its own account

**Structure** — the two church-wide rows and the label *The whole church*; opening
them in the pane; the row subtitles; the `Built in` badge; the pane-head badges.

**List rows** — the place marks `M` / `W` / `•`; `1 week's rest`; `Can double up`;
`1 rule needs attention`.

**Copy** — the rest hint, both exclusivity sentences, the allowlist help text
(promoted from a code comment), the "there is no seventh" footnote, the gold
**"This hides nobody."** notice, and the empty-pane invitation.

**Data** — every Role's places and descriptions except Coffee's; the six
liturgical rest values; the two people on *Doesn't serve* (**flagged wrong on
purpose** — the brief's cast is eight adults and this list should be children and
the frail); the hidden tag id `under_care`; withdrawing Small Group from sharing.

**CSS** — `.m-seg`, `.m-unitfield`, `.m-token`, `.m-rule-row--private`, and
widening `.m-rule-row` into a column. Every value a token; no raw hex anywhere.

---

## Decisions taken on the pull

Agreed 2026-08-14. Everything in the design was taken except where noted.

1. **A Role is open on load.** The first Servant Role is seeded; the 520px dashed
   "Choose a Role on the left" box goes. Only `!hasServantRoles` leaves the pane
   empty, and that one carries the invitation.
2. **Sunday Service Roles and *Doesn't serve* move into the pane**, reached from
   two rows under the list. Both are visible without scrolling; neither stands
   between the first Role and the seventh.
3. **The list row gains place marks and rest.** `W W • M`, one mark per place in
   the order they are set, and `1.25 weeks' rest`.
   **`Can double up` was cut** — the least-consulted of the three, and the row is
   already carrying four things. Exclusivity is still on the pane head badge.
4. **A Role whose rule has stopped working says so on its row**, in the error
   colour. `unavailableRestrictions` has been in `roles-core.js` since MS-170 and
   called by nothing; this is its first reader.
5. **Delete moves to the pane head** on desktop, as `.m-btn--danger-outline`. It
   matches what the phone already does, and takes a destructive control off a
   hover state next to the tap that opens a Role.
6. **The five classes go into the shipped library** — `.m-seg`, `.m-unitfield`
   and `.m-token` as new primitives, `.m-rule-row` and `.m-locked-role` promoted
   out of `recurring-events.html`'s screen-local `re-*` copies, plus the new
   `.m-rule-row--private`.
7. **`Cannot serve together if` is live, and the brief's example was wrong.**
   `relationship_types` carries `kind: 'pairwise' | 'group'`, and the opener is
   offered whenever an elder has shared a pairwise type (Discipler/Disciplee,
   Friend). `marriage` is a reserved **group** id and can never be the pairwise
   one, so the kit's invented `marriage_pair` is **dropped** rather than ported —
   naming an invented pairwise type "Marriage" reproduces the confusion it was
   invented to work around. Nothing needs building.
8. **The clash message stops printing a slug.** Named from
   `RolesCore.LITURGICAL_ROLES` instead.

Also taken without discussion: the three pane-head badges, the new help text on
rest and on both states of the exclusivity box, the allowlist help text, the gold
*"This hides nobody."* notice, the "there is no seventh" footnote, the recased
save-refused heading, the two-column locked list with its `Built in` badge, and
the page that no longer scrolls as a whole.

**Not carried over:** every sample Role and its data, the six liturgical rest
values, `under_care`, the withdrawal of Small Group from sharing, `marriage_pair`,
and the two names on *Doesn't serve* — the design flagged those last as wrong on
purpose.

**Found on the way, fixed separately:** `weeks' rest` is static text on the locked
card, so it reads "1 weeks' rest". Now a `.m-unitfield__unit`, which takes the
singular.
