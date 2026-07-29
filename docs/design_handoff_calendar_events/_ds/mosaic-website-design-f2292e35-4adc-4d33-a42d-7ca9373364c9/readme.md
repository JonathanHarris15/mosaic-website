# Mosaic Church — Design System

The visual and UI foundation for **Mosaic Church · College Station**, and specifically for the **Mosaic Services** web app — the church's liturgy, hymn, and shepherding platform. This system is the *website* expression of the Mosaic brand: tuned for UI/UX rather than printed documents.

> **Aesthetic in one line:** *Modern Liturgy* — reverence, tradition, and clarity. Warm parchment surfaces, deep-navy ink, ocean/steel-blue tile accents drawn from the church seal, and a serif-led hierarchy that treats headings as "sacred" and body text as "functional."

## Sources

This system was reconstructed from the church's own repository. If you have access, explore it to design with higher fidelity:

- **GitHub:** [`JonathanHarris15/mosaic-website`](https://github.com/JonathanHarris15/mosaic-website) — the Mosaic Services web app (vanilla JS + Firebase + Tailwind CDN).
  - `public/mosaic-theme.js` — the **single source of truth** for tokens (the "drop-in fix" that corrected the brand). All color/type/radius/shadow values here come from it.
  - `design/…/mosaic_liturgy/DESIGN.md` — the original brand & style narrative.
  - `CONTEXT.md` — the domain model (Services, Hymns, Shepherding, Elder Documents, Service Guides).
  - `public/assets/` — the church seal logos (imported into `assets/`).

There is a companion **Mosaic document design system** (for printed service guides); this project is the toned-down UI/UX counterpart.

> **Note on the live app:** several source pages still link Noto Serif / Work Sans in their HTML, but `mosaic-theme.js` re-points every font token to **Cinzel / EB Garamond / Libre Franklin**. This system follows the corrected `mosaic-theme.js` direction on type. On icons it does **not**: `mosaic-theme.js` finding #7 proposed swapping to Lucide, and that swap never happened — all 23 pages of the app use **Material Symbols (Outlined)**, including the Roles Manager as rebuilt in MS-120. Material Symbols is therefore the documented icon system (corrected in MS-99).

---

## Content Fundamentals

How Mosaic writes copy:

- **Voice:** warm, grounded, unhurried, quietly reverent — never trendy or salesy. It should feel like a well-kept sanctuary, not a startup.
- **Person:** addresses the reader plainly ("Browse & download musical selections," "View upcoming and past service dates"). Greetings are personal and time-aware ("Good morning, John").
- **Casing:** **Title Case** for page titles and card titles ("Hymn Lookup," "Sunday at a Glance," "Service Calendar"). **UPPERCASE tracked labels** for overlines and field labels ("EMAIL ADDRESS," "FILTER BY TAGS," "THEME"). Sentence case for descriptions and helper text.
- **Length:** terse. Feature cards get a single descriptive line. Helper text is one sentence. No marketing paragraphs.
- **Domain language is precise** (see `CONTEXT.md`): *Elder* not "shepherd" in code; *Shepherding Note*, *Pastoral Record*, *Order of Service*, *Baptism Candidate*, *Service Guide*. Use the canonical terms.
- **Ampersands** are used freely in short labels ("Browse & download," "Add & edit," "Faith & Trust").
- **Emoji:** none. Ever. Iconography carries visual meaning instead.
- **Tone examples:** "Search and explore the catalog of hymns arranged for our Sunday service." · "Step-by-step structural flows." · "Elder tools & member care."

---

## Visual Foundations

- **Color vibe:** warm and architectural. A washed cream/parchment base (`--background #F7F3ED`, `--surface #FBF7F0`) with **deep-navy ink** (`--on-surface #0E1C36`). Accents are the three seal tiles — **navy `#182F57`**, **ocean `#3E6181`**, **steel-teal `#5D94A9`**. **Sand `#C2B79D`** and **gold `#B89B6A`** appear *only* as hairlines and thin accents, never as fills. There is **no dark mode**.
- **Type:** serif-led. **Cinzel** (caps) for page/section titles and wordmark feel; **EB Garamond** for hymn names and long-form reading (italic for scripture); **Libre Franklin** for *all* chrome — labels, meta, buttons, inputs, nav. Titles use slightly *positive* tracking (+0.02em); labels are tracked caps (+0.14em).
- **Backgrounds:** solid warm tones only. No gradients, no photographic hero images, no textures or patterns. The only decorative motif is faint **architectural accent rings** (1px outline circles at ~15–25% opacity) bleeding off a corner, and the **hexagon** from the seal for icon masks.
- **Depth:** communicated through **tonal layers** and **low-contrast warm outlines**, not heavy shadows. Every surface is framed by a **1px `--outline-variant` (#DAD0C0) hairline**. Nested surfaces step one tone at a time (white → parchment → container). Shadows are **ambient navy glows** (`0 8px 24px rgba(14,28,54,.10)`) reserved for the FAB, modals, and card hover — never a harsh drop shadow.
- **Corner radii:** soft and coherent. Cards and inputs `10px` (`--radius`), small chips/checkboxes `6px`, the FAB `16px`, pills/avatars fully round. Badges are **rectangular** (6px) — pills read too casual for the liturgical context.
- **Cards:** flat by default — white surface, 1px hairline, **no shadow**. Interactive cards lift with a soft `--shadow-sm` on hover only.
- **Buttons:** primary = navy fill with **cream** text (not pure white), 10px radius, tracked-caps label, subtle `--shadow-xs`; secondary = ocean 1px outline; ghost = text only. Press state **shrinks to `scale(0.98)`**.
- **Inputs:** 1px warm border on the low surface tint; on focus the border transitions to **steel-teal** with a soft 3px ring.
- **Motion:** restrained and calm. Standard ease `cubic-bezier(0.2,0,0,1)`, 150–300ms. Fades and color transitions; hover elevation; button press-scale. **No bounces, no infinite loops, no flourish.**
- **Hover states:** cards gain a soft shadow; icon medallions fill a navy tint (`--primary-fixed`); ghost buttons/rows fill `--surface-container`; links shift from ocean → navy.
- **Layout:** a fixed, centered **1200px** container with generous "breathing room." Vertical rhythm on an 8px scale; major sections separated by `lg (48)` / `xl (80)`; 24px gutters. The grid is composed and orderly — a "mosaic" of framed sections.
- **Transparency & blur:** used sparingly — the accent rings and light container tints only. No glassmorphism.
- **Imagery:** minimal. The primary visual asset is the **church seal** (a circular navy/ocean/steel mosaic around a hexagonal blackletter "m"). Color grade of any imagery should stay warm and calm.

---

## Iconography

- **Icon system:** **Material Symbols (Outlined)** — what every page of the app actually uses. Loaded from CDN: `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap">`, then `<span class="material-symbols-outlined">name</span>`. One icon set across the whole product; do not mix in a second library.
- **Style:** outline / line icons, **stroke ≈ 1.75px** (`wght` 300–400 at 18–22px), tinted `currentColor` (usually navy or navy-grey). `FILL 0` as a rule; where a nav medallion needs emphasis, the medallion background carries it, not a filled glyph.
- **Common glyphs seen in the source:** `menu_book` (hymns), `calendar_month`, `bar_chart` (analytics), `groups` (directory), `library_music` (hymn manager), `shield` (shepherd), `water_drop` (baptism), `mic` (sermonette), `search`, `edit`, `schedule`, `chevron_right`, `tune`, `add`.
- **Emoji / unicode as icons:** never.
- **Logos:** the real seal is in `assets/` (`mosaic-logo.png` full seal, `mosaic-icon.png` icon only, `mosaic-logo-white.png` / `mosaic-logo-centered-white.png` for navy backgrounds). Do **not** redraw or approximate the seal — always use these files.

---

## Foundations at a glance (tokens)

- **Colors** — `tokens/colors.css`: brand core (navy, ocean, steel, sand, gold, cream, parchment) + semantic primary/secondary/tertiary, warm surface tiers, warm outlines, and status colors.
- **Typography** — `tokens/typography.css`: `--font-display` (Cinzel), `--font-serif` (EB Garamond), `--font-sans` (Libre Franklin) + role sizes and `.m-*` utility classes.
- **Spacing / radius / shadow / motion** — `tokens/spacing.css`: 8px scale, radius scale, ambient shadow scale, standard easing.
- **Fonts** — `tokens/fonts.css`: Google Fonts import for the three families.
- **Base** — `tokens/base.css`: element resets, link styling, and the `blockquote.scripture` treatment.

`styles.css` (project root) is the single entry point — a manifest of `@import`s. Consumers link this one file.

---

## Components

React primitives, bundled to `window.MosaicChurchDesignSystem_f2292e`. See each component's `.prompt.md` for usage.

**Core** (`components/core/`)
- **Button** — primary / secondary / ghost / danger action; tracked-caps label, press-scale.
- **IconButton** — square single-icon button; `ghost` / `outline` / `primary` / `fab` (navy FAB).

**Forms** (`components/forms/`)
- **Input** — labelled text field; steel-teal focus ring; error state.
- **Select** — native dropdown matched to Input, with an inline chevron glyph.
- **Checkbox** — navy-fill box with a cream check.

**Display** (`components/display/`)
- **Card** — flat hairline container; optional hover lift.
- **NavCard** — dashboard feature tile with a circular icon medallion.
- **Badge** — rectangular tag in light palette tints (themes, indicators, filter chips).
- **Avatar** — circular photo/initials chip.
- **ScriptureBlock** — signature scripture quote (Garamond italic + gold divider).
- **SectionLabel** — tracked-caps overline, optional hairline rule.

---

## UI Kits

Full-screen, cosmetic recreations of real product surfaces, composed from the components above.

- **`ui_kits/public_directory/`** — the public directory home: login card ↔ dashboard with greeting, feature tiles, and "Sunday at a Glance."
- **`ui_kits/hymn_directory/`** — the public **Hymn Lookup** page: search, tag filters, and hymn result cards.

---

## Root index / manifest

- `styles.css` — global CSS entry point (import manifest).
- `tokens/` — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `base.css`.
- `components/core/` — `Button`, `IconButton` (+ `.d.ts`, `.prompt.md`, `buttons.card.html`).
- `components/forms/` — `Input`, `Select`, `Checkbox` (+ `forms.card.html`).
- `components/display/` — `Card`, `NavCard`, `Badge`, `Avatar`, `ScriptureBlock`, `SectionLabel` (+ `display.card.html`).
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Brand groups).
- `ui_kits/public_directory/`, `ui_kits/hymn_directory/` — product screen recreations.
- `assets/` — church seal logos.
- `SKILL.md` — Agent-Skills-compatible entry for downloading and using this system.

The **Design System tab** renders every `@dsCard`-tagged HTML in this project, grouped: Colors, Type, Spacing, Brand, Components, Public Directory, Hymn Directory.
