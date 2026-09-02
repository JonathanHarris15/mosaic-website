# Mosaic Church — Design System

The visual and UI foundation for **Mosaic Church · College Station**, and specifically for the **Mosaic Services** web app — the church's liturgy, hymn, and shepherding platform. This system is the *website* expression of the Mosaic brand: tuned for UI/UX rather than printed documents.

> **Aesthetic in one line:** *Modern Liturgy* — reverence, tradition, and clarity. Warm parchment surfaces, deep-navy ink, ocean/steel-blue tile accents drawn from the church seal, and a serif-led hierarchy that treats headings as "sacred" and body text as "functional."

## This system is generated from the app

It used to be a reconstruction — someone read the codebase and wrote down what they saw, and it drifted from the day it was written. It is now **generated and pushed by `/design-sync`** from a single source, `build/design-components.mjs`, in the Mosaic repository.

That means the tokens here are the tokens the app renders, and a component here is the class the app actually ships — on the desktop pages and inside the phone shell alike.

- `tokens/*.css` — generated from `tailwind.config.js`.
- `tokens/components.css` and every `components/*` file — generated from `build/design-components.mjs`.
- `guidelines/colors-*.card.html` — generated, so a swatch and its printed hex cannot disagree. They used to: the swatch read the token and the caption was typed by hand.

**You may still edit a token here.** Doing so is a design decision, and the sync treats it as one — it carries the change down into the code rather than overwriting it. What will not survive is hand-editing a component's CSS; change it to *propose* it, and say what you changed.

### Sources

- **GitHub:** [`JonathanHarris15/mosaic-website`](https://github.com/JonathanHarris15/mosaic-website)
  - `tailwind.config.js` — the source of truth for every token. (`public/mosaic-theme.js` was the old runtime config and is superseded; anything still citing it is out of date.)
  - `build/design-components.mjs` — the source of truth for every component.
  - `public/components-demo.html` — the gallery, the repo's own copy of what is in `components/`.
  - `CONTEXT.md` — the domain model (Services, Hymns, Shepherding, Elder Documents, Service Guides).

There is a companion **Mosaic document design system** for printed service guides; this project is the toned-down UI/UX counterpart. Note that the print templates use their own `m-` class names (`m-hymn`, `m-oos`, `m-sheet`) which have nothing to do with the components here.

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

- **Color vibe:** warm and architectural. A washed cream/parchment base (`--background`, `--surface`) with **deep-navy ink** (`--on-surface`). Accents are the three seal tiles — **navy**, **ocean**, **steel-teal**. **Sand** and **gold** appear *only* as hairlines and thin accents, never as fills. There is **no dark mode** in the product. The code editor in the Service Guide Manager is a deliberate exception with its own `--editor-*` tokens: a dark editor inside a light app is the normal shape of that tool.
- **Type:** serif-led. **Cinzel** for the app's own name for a **place** — a page title like Calendar or Roles Manager, and the wordmark. **EB Garamond** for a **record**: a hymn name, a role, a Person's name, a dated Service Guide — anything read rather than operated, including a page title that happens to be one. **Libre Franklin** for *all* chrome — labels, meta, buttons, inputs, nav. Titles use slightly positive tracking (+0.02em); labels are tracked caps (+0.14em).
  - The place/record split replaced "Cinzel for page titles only" in MS-187. That older rule could not say what to do with `shepherding-profile`, whose title is somebody's name — and setting a member of the church in tracked caps makes them look like a menu item. It is the same split the phone's TopBar already shipped as its `display` and `serif` modes, so the two ends now agree rather than each having a rule.
- **Backgrounds:** solid warm tones only. No gradients, no photographic hero images, no textures. The only decorative motif is faint **architectural accent rings** (1px outline circles at ~15–25% opacity) bleeding off a corner, and the **hexagon** from the seal for icon masks.
- **Depth:** communicated through **tonal layers** and **low-contrast warm outlines**, not shadows. Every surface is framed by a 1px `--outline-variant` hairline. Nested surfaces step one tone at a time (white → parchment → container). Shadows are ambient navy glows, reserved for a primary button (`--shadow-xs`), a floating action button (`--shadow-md`) and modals.
- **Corner radii:** cards and inputs `--radius` (10px), badges and small chips `--radius-sm` (6px), cards and the FAB `--radius-xl` (16px), pills and avatars fully round. Badges are **rectangular** — pills read too casual for the liturgical context.
- **Cards:** flat by default — white surface, 1px hairline, no shadow.
- **Buttons:** primary = navy fill with **cream** text, not pure white. 46px tall, which clears the touch floor on a phone and is the same height on both. Secondary is a filled tonal surface with a hairline; ghost is text only; quiet is the muted toolbar action.
- **Inputs:** 48px tall with a 16px font — iOS zooms into anything smaller and often fails to zoom back out. 1px warm border; on focus it goes steel-teal with a soft 3px ring.
- **Motion:** restrained. Standard ease `--ease-standard`, 150–300ms. Fades and colour transitions. **No bounces, no infinite loops, no flourish.**
- **Layout:** a centred **`--container-max` (1200px)** column with generous breathing room. Vertical rhythm on an 8px scale; sections separated by `--space-lg` / `--space-xl`; 24px gutters.
- **Imagery:** minimal. The primary visual asset is the **church seal**.

---

## Iconography

- **Icon system: Material Symbols Outlined.** Loaded from Google Fonts, used as
  `<span class="material-symbols-outlined">calendar_month</span>`.
- **Style:** outline, `currentColor`, `FILL 0` — except a NavCard's medallion, which fills.
- **Common glyphs:** `menu_book` (hymns), `calendar_month`, `bar_chart` (analytics), `groups` (directory), `library_music` (hymn manager), `shield` (shepherd), `water_drop` (baptism), `mic`, `search`, `edit`, `schedule`, `chevron_right`, `tune`, `add`.
- **Never Lucide.** This file and `SKILL.md` both named Lucide for a long time and neither ever described the product — all 34 pages have always drawn Material Symbols. The correction attempted in MS-99 fixed this file's callout and missed both `SKILL.md` and every component example, so Claude Design kept being told to use Lucide by the very files it composes from. Fixed properly when the component library was unified.
- **Emoji or unicode as icons:** never.
- **Logos:** the real seal is in `assets/`. Do **not** redraw or approximate it.

---

## Foundations at a glance (tokens)

- **Colors** — `tokens/colors.css`: brand core, semantic primary/secondary/tertiary, warm surface tiers, warm outlines, status colours with containers, plus the named palettes the product actually uses: Calendar event colours, Note Module highlighter pens, inline trigger chips, the Relations Viewer's edges and group bubbles, the Service Notes card, the printed-guide preview, and the code editor.
- **Typography** — `tokens/typography.css`: `--font-display` (Cinzel), `--font-serif` (EB Garamond), `--font-sans` (Libre Franklin) + role sizes and `.m-*` type helpers.
- **Spacing / radius / shadow / motion** — `tokens/spacing.css`.
- **Fonts** — `tokens/fonts.css`.
- **Base** — `tokens/base.css`: element resets and link styling.
- **Components** — `tokens/components.css`: every class below.

`styles.css` is the single entry point — a manifest of `@import`s. Link that one file.

---

## Components

**Compose with the classes.** `<button class="m-btn m-btn--primary">Save</button>` is a real Mosaic button, and it is the class the shipped app uses. A screen built from these drops into the codebase without translation.

Each component has a `.prompt.md` (what it is, its variants, a worked example) and a `.card.html` specimen. Reach for one before writing new CSS; if none fits, say so rather than inventing a one-off.

<!-- @generated:start component-index -->

**Core**
- **Button** `.m-btn` — The standard action.
- **IconButton** `.m-icon-btn` — A square button holding one Material Symbol.

**Forms**
- **Input** `.m-input` — A single-line text field, its label, and its error.
- **Select** `.m-select` — A native dropdown matched to Input, with an inline chevron drawn as a Material Symbol rather than a bundled SVG.
- **Checkbox** `.m-check` — A checkbox and its label, as one target.
- **FormPane** `.f-pane` — A titled panel with a head, a body, and a row of badges saying what the thing inside it is.
- **QuestionEditor** `.f-qrow` — A question on a form being built — a row when it is shut, a panel when it is open.
- **SettingBlock** `.f-set` — A group of settings that constrain each other, each carrying its own reason.
- **Dropdown** `.m-dropdown` — A picker with grouped options that opens downward, caps its height, and scrolls inside.
- **OptionCard** `.m-option` — One choice on a form somebody is answering, as a card you tap rather than a radio you aim at.
- **SearchBar** `.m-search` — An Input with a leading search glyph and a clear button that only appears once there is something to clear.
- **Segmented** `.m-seg` — Two to four named choices with one of them chosen, all visible at once.
- **UnitField** `.m-unitfield` — A number and the unit it is in, as one field.

**Display**
- **Tally** `.f-tally` — What came back from a form — a labelled bar per option, and free-text answers as quotes.
- **LinkRow** `.f-linkrow` — A URL you are meant to copy, with the button to copy it.
- **SectionLabel** `.m-label` — The tracked-caps overline above a group of things.
- **SerifHead** `.m-serif-head` — An EB Garamond heading for the things a person reads rather than operates — a hymn name, a role, a one-line summary.
- **Card** `.m-card` — A flat container with a warm hairline.
- **NavCard** `.m-nav-card` — The dashboard tile: a medallion, a title, one line of description.
- **Medallion** `.m-medallion` — The round icon plate on a NavCard.
- **Badge** `.m-badge` — A small rectangular tag: a theological theme, a ministry area, a state.
- **Avatar** `.m-avatar` — A Person's Directory Photo, or their initials when there is none.
- **ScriptureBlock** `.m-scripture` — A quoted passage set in EB Garamond with a gold hairline down its edge, and the reference beneath in tracked caps.
- **Type** `.m-body-md` — The type scale, as classes.
- **Divider** `.m-divider` — A warm hairline between things.
- **Token** `.m-token` — A name, and the control that takes it off the list.
- **RuleRow** `.m-rule-row` — One rule, read back as a sentence in serif, with whatever it is made of underneath.
- **LockedRole** `.m-locked-role` — A Role that cannot be edited, and the one thing about it that can.
- **RotaGrid** `.m-rota` — Roles down the side, dates across the top, and what is really stored in the cells.
- **MonthGrid** `.m-cal` — The month, seven columns wide.
- **EventChip** `.m-chip` — One event, in a day cell or anywhere else that lists them.
- **MonthStrip** `.m-strip` — The phone's month: seven columns of day numbers, each carrying up to three dots.
- **Settled** `.m-settled` — Where something cannot change because it is settled, the sentence is the control.

**Feedback**
- **Spinner** `.m-spinner` — The page's waiting state.
- **Toast** `.m-toast` — A short confirmation at the foot of the screen.
- **EmptyState** `.m-empty` — What a list says when it has nothing in it.
- **Notice** `.m-notice` — The edged bar: signed out, a read that failed, a write that half-failed, or what a selection adds up to.

**Layout**
- **Breadcrumbs** `.f-crumbs` — Where you are in a library you can navigate into.
- **PageShell** `.m-page` — The body of a desktop page: warm background, navy ink, a column capped at --container-max.
- **PageHeader** `.m-header` — The strip across the top of every desktop page: the way back, the page's name, the page's actions, and the account.
- **BackLink** `.m-back` — The way out of a page, top left.
- **Row** `.m-row` — One line of a list: an optional leading avatar or medallion, a title, an optional second line, something trailing.
- **CardList** `.m-card-list` — Rows gathered into one bordered surface, so a list reads as a single object rather than a stack of cards.
- **SplitView** `.m-split` — A list of things beside the one that is open, where picking a row changes the whole right-hand side rather than navigating away.
- **PickList** `.m-picklist` — The list half of a SplitView: rows you choose between, one of them current, each carrying a colour dot and two lines of detail.
- **Tabs** `.m-tabs` — The tab bar inside a pane, when one selected thing has more sides to it than a page can sensibly stack.
- **ActionBar** `.m-actionbar` — A pane's own sticky footer: what the current selection adds up to, said in words on the left, and the actions that take it somewhere on the right.

<!-- @generated:end -->

---

## Root index / manifest

- `styles.css` — global CSS entry point (import manifest).
- `tokens/` — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `base.css`, `components.css`.
- `components/` — one `.prompt.md` + `.card.html` per component, flat. The grouping lives in each card's `@dsCard group` marker.
- `guidelines/` — foundation specimen cards.
- `assets/` — church seal logos.
- `SKILL.md` — Agent-Skills entry for downloading and using this system.

The **Design System tab** renders every `@dsCard`-tagged HTML in this project, grouped: Colors, Core, Forms, Display, Feedback, Layout.
