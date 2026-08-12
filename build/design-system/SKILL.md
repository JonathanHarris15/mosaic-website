---
name: mosaic-church-design
description: Use this skill to generate well-branded interfaces and assets for Mosaic Church (the Mosaic Services web app — liturgy, hymns, shepherding), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and the component library the app actually ships.
user-invocable: true
---

Read the `readme.md` file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Compose with the classes, not from scratch

Everything here is **plain CSS classes over CSS custom properties** — no
framework. `<button class="m-btn m-btn--primary">Save</button>` is a real
Mosaic button, and it is the same class the shipped app uses on both the
desktop pages and the phone. A screen built from these classes drops into the
codebase without translation, which is the whole point of the library.

Reach for an existing component before writing new CSS. If none fits, say so
plainly rather than inventing a one-off — a new primitive is a decision worth
naming.

## Where things live

- `readme.md` — full design guide: content voice, visual foundations,
  iconography, and the component index. **Start here.**
- `styles.css` — the single CSS entry point. Link it; it `@import`s every token
  file and the component layer.
- `tokens/` — colors, typography, spacing/radius/shadow, fonts, base element
  styles, and `components.css`.
- `components/` — one `.prompt.md` per component (what it is, its variants, a
  worked example) beside a `.card.html` specimen. Flat: the grouping is in each
  card's `@dsCard group` marker, not in folders.
- `guidelines/` — foundation specimen cards for colour, type, spacing and brand.
- `assets/` — the church seal logos. Never redraw the seal; use these files.

## Generated, and what that means for you

`tokens/*.css`, `tokens/components.css`, every `components/*` file and the
`guidelines/colors-*` cards are **generated from the Mosaic codebase** and
uploaded by `/design-sync`. They are the app as it really is, not an
aspiration.

You may still edit a token here — that is a design decision and the sync reads
it as one, carrying it down into the code rather than overwriting it. What you
should not do is hand-edit a component's CSS and expect it to survive; change
it here to *propose* it, and say clearly what you changed and why.

## Non-negotiables

- **Fonts:** Cinzel (page titles only), EB Garamond (hymns, roles, anything
  read rather than operated), Libre Franklin (all UI chrome).
- **Icons: Material Symbols Outlined.** One icon set across the product,
  outline style, `currentColor`, `FILL 0` unless the component says otherwise.
  **No Lucide. No emoji, ever.**
  This file said Lucide until the two ends were reconciled. It never described
  the product — all 34 pages have always used Material Symbols — and the
  correction that was supposed to fix it in MS-99 checked this file, concluded
  it carried no icon rule, and missed the line above.
- **Colour:** warm cream/parchment surfaces, deep-navy ink, ocean/steel-blue
  accents. Sand and gold are hairlines only. No dark mode in the product —
  the code editor in the Service Guide Manager is a deliberate exception and
  has its own `--editor-*` tokens. No gradients.
- **Depth:** 1px warm hairlines and tonal layers, not shadows. Cards flat by
  default; shadow only on a primary button (`--shadow-xs`) and a floating
  action button (`--shadow-md`).
- **Radii:** 10px default, 6px on badges, 16px on cards and the FAB.
  Badges are rectangular, never pills — a pill reads too casual against the
  liturgy.
- **Voice:** warm, grounded, unhurried. Title Case titles, tracked-caps labels,
  terse one-line descriptions.
