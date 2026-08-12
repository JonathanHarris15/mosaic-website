# MS-187 — Header Crusade: design brief

**Date:** 2026-08-12
**For:** Claude Design, against the **Mosaic Website Design** system (project `f2292e35-4adc-4d33-a42d-7ca9373364c9`).
**Deliverable:** a UI kit at `ui_kits/headers/`, following `ui_kits/away/` and `ui_kits/calendar/` — an `index.html` entry point, JSX screens, and a `README.md` naming the header types, the rule for which is used where, and the components used.
**Read first:** `readme.md`, `styles.css`, `guidelines/`, and `components/PageShell.prompt.md` + `components/BackLink.prompt.md` — those two are the half-built version of the thing being designed here. **Material Symbols Outlined**, matching all 34 pages. Never Lucide, never emoji.

---

## 1. The job

Every desktop page in Mosaic has something across the top: a way back, who you're signed in as, usually the page's name, sometimes the church seal, sometimes the page's actions. Thirty-four pages have arrived at **eight different answers** for what that strip is, and no page can tell you why it got the one it did. Move from the Calendar to the Hymn Directory to the Service Guide and the top of the screen changes background, height, border, alignment, and typeface each time — so the app reads as three or four products stitched together rather than one.

This is not a page design. It is the **one piece of furniture every page shares**, and it needs a system: a small set of header types, each with a stated job, and a rule an engineer can apply to a new page without asking anybody. More than one type is fine — a full-bleed editing tool and a 1200px reading page genuinely want different things. What is not fine is a type existing because somebody was in a hurry.

The person who feels this most is the editor working a Sunday: they go dashboard → calendar → order of service → service guide in one sitting, and the top of the screen jumps every time.

---

## 2. What is real — use these, do not invent

### 2a. The eight header shapes shipping today

These are the literal class strings in the repo. This is the mess being replaced.

**Type A — bare utility bar.** Transparent, no border, no background, no height. Back link left, auth widget right. **The page title is not in it** — it lives further down inside `<main>`. Twelve pages:

```
<header class="w-full max-w-container mx-auto px-4 md:px-margin pt-2 md:pt-md flex items-center justify-between">
```
`index.html` (right-aligned only, no back link) · `admin-dashboard.html` · `calendar.html` · `calendar-event.html` · `roles-manager.html` · `shepherding-dashboard.html` · `shepherding-documents.html` · `shepherding-tags.html` · `shepherding-document.html` (no max-width) · `recurring-events.html` (`max-w-[1600px]`) · `shepherding-profile.html` (`max-w-[1600px]`) · `shepherding-care-list.html` (`max-w-6xl`, **and a live typo — `px- margin`**)

**Type B — sticky translucent bar with a bottom hairline.** Blurs the content scrolling under it. Five pages, two different border tokens:

```
<header class="flex-shrink-0 bg-background/80 backdrop-blur-md border-b border-surface-variant/30 z-50">
```
`hymn-directory.html` · `peoples-page.html` (`sticky top-0`) · `service-calendar.html` (`z-[60]`) · `analytics.html` (`border-outline-variant`, `z-[100]`) · `service-builder.html` (`bg-background`, no blur)

**Type C — solid `bg-surface` bar with a bottom hairline and a centred seal.** Three-column: back left, logo centre, auth right. Three pages:

```
<header class="w-full flex-shrink-0 flex justify-between items-center px-6 py-4 max-w-full mx-auto border-b border-surface-variant/30 relative z-10 bg-surface">
```
`manager.html` · `hymn-details.html` · `profile.html` (`sticky top-0`, `z-50`)

**Type D — navy filled bar, 64px, white text, drop shadow.** Carries the page title *and* the page's actions. The only type that does. Three pages:

```
<header class="no-print h-16 bg-primary text-white flex items-center justify-between px-6 sticky top-0 z-50 shadow-md">
```
`service-guide.html` · `service-guide-editor.html` · `service-guide-manager.html`

**Type E — compact toolbar, 44px, `surface-container-lowest`.** Swaps its own contents between two states of the page. One page:

```
<header class="shrink-0 w-full px-6 py-2.5 flex items-center gap-4 bg-surface-container-lowest border-b border-outline-variant">
```
`auto-assign.html`

**Type F — inline styles, no tokens.** One page:

```
<header style="max-width:80rem; margin:0 auto; padding:8px 32px;" class="flex items-center justify-between">
```
`shepherding-people.html`

**Type G — no `<header>` at all.** The back link and title sit loose inside `<main>`. Four pages: `commitments.html` (`max-w-[760px]`) · `cover.html` (`max-w-[860px]`) · `login.html` (no back, no auth) · `relations-viewer.html` (nothing across the top at all)

**Type H — an unstyled `<header>` element.** One page: `privacy.html`

`away.html` is a near-miss of Type A — same contents, but nested inside a `max-w-container` wrapper rather than carrying the width itself.

### 2b. The design system already declares a header, and nothing uses it

`PageShell` (`.m-page`) ships a `.m-page__bar`:

```css
.m-page__bar { display: flex; align-items: center; justify-content: space-between; padding-top: var(--space-base); }
```

**Used by exactly one file: the gallery.** Zero product pages. `.m-page` itself is used by one page. `.m-back` — the BackLink component — is used by 8 of the 20 pages that draw a back arrow; the other 12 hand-write the same arrow-and-label. So the system's own answer exists, is thin, and lost.

### 2c. The phone already solved this, and the desktop must not contradict it

`public/mobile/ui.js` → `M.ui.TopBar` is **one header, used by every phone screen**:

- `padding-top: calc(env(safe-area-inset-top, 20px) + 4px)`, then a **46px** row
- background `--surface-container-lowest`, bottom border `1px solid --outline-variant`
- left: one 44px icon button — `chevron-left` (back) or `menu` (drawer)
- centre-left: the title, `flex: 1`, single line, ellipsis on overflow. Two title modes: **display** (Cinzel, 17px, UPPERCASE, +0.06em) or **serif** (EB Garamond, 20px, sentence case, +0.01em)
- right: 0–3 icon buttons, gap 2, each optionally carrying a count badge

`public/mobile-shell-header.js` draws that same bar for **desktop pages opened inside the phone shell** (`?shell=mobile`) — and it works by **hiding `body > header` and replacing it**. Six desktop pages do this today: `roles-manager`, `manager`, `service-builder`, `service-calendar`, `shepherding-dashboard`, `shepherding-tags`, `shepherding-people`. Whatever the desktop header becomes, it must survive being hidden wholesale and swapped for the phone bar.

### 2d. What actually goes inside a header — the real contents

**The auth widget.** `#auth-container`, injected at runtime by `auth.js` into 24 pages. Two states, exact markup:
- *Signed in:* two items — `account_circle` + "User Page" (links to `profile.html`), and `logout` + "Log Out" (red, `text-error`). Both collapse to icon-only below `md`.
- *Signed out:* one item — a "Log In" link.
- *Not yet known:* an empty `<div class="h-10">` placeholder, so the header does not jump when Firebase resolves. **This 40px reservation is load-bearing** — the header must hold its height before auth arrives.

**The back link.** Twenty pages have one, with **five different labels**: `Home` · `Dashboard` · `Back to Dashboard` · `Calendar` · `Back` (the `md:hidden` short form). Two pages branch the destination on the shell: `window.MOSAIC_SHELL === 'mobile' ? 'mobile.html#/home' : 'index.html'`.

**The church seal.** `assets/mosaic-logo.png`, `h-10 w-10`, centred in Type C (3 pages) and in the Hymn Directory's Type B. `index.html` puts a larger `h-16 w-16` seal in `<main>` instead. Sixteen pages show no seal at all.

**Page actions.** Only Type D carries them today. The Service Guide's four right-hand items are the hardest real case:
- a page-count chip — `"18 Pages (Limit 16)"` — red, pulsing dot, only when overflowing
- an unsaved chip — `"Unsaved"` — yellow, pulsing dot, only when dirty
- a Save button (hidden for `viewer`)
- a Print PDF button (white fill on the navy bar — the only white-on-navy button in the app)

Everywhere else, page actions live in `<main>` under the title. The Calendar puts `Away` and `Recurring events` there; the Hymn Catalog puts search + "Add New Hymn" in a second sticky toolbar *below* its header.

### 2e. The real page titles — use these, they are the strings that break layouts

Longest static: **"Manage Tags and Relationships"** (29 chars).
Longest dynamic: **"Service Guide Editor: Sunday, November 9, 2025"** (46 chars) — and it swaps to `"Service Guide: …"` for a viewer.
The full set, spelled as the app spells them:

`Calendar` · `Services` · `People` · `Documents` · `Away` · `New event` · `Auto-assign` · `By hand` · `Roles Manager` · `Recurring events` · `Hymn Directory` · `Hymn Catalog` · `Service Analytics` · `Shepherd Dashboard` · `Admin Dashboard` · `User Profile` · `Privacy Policy` · `Your Commitments` · `Needing Somebody` · `Manage Tags and Relationships` · `Service Guide Manager`

Two titles are **a Person's name** — `shepherding-profile.html` and `away.html` when an editor records it for somebody else. Real names from the directory to test with: `Ben Trueblood` · `Christiana Ohanele` · `Jonathan Harris` · `Alexandra Vandergriff`.

Six pages have **no `<h1>` at all**: `index` · `hymn-details` · `peoples-page` · `relations-viewer` · `shepherding-care-list` · `shepherding-document`.

Note `Recurring events` is sentence case while everything else is Title Case — the readme says Title Case. Flag it, do not silently correct it.

### 2f. The title typography is nine different things

The design system's rule (`readme.md`, `tokens/typography.css`) says: **Cinzel for the page title only; EB Garamond for what a person reads; Libre Franklin for all chrome.** The code disagrees with itself:

| Treatment | Renders as | Pages |
| --- | --- | --- |
| `font-headline-lg text-headline-lg` | EB Garamond 32px | admin-dashboard, shepherding-dashboard, shepherding-documents, shepherding-people, shepherding-profile, shepherding-tags |
| `font-display text-headline-lg tracking-[.02em]` | Cinzel 32px | calendar, calendar-event, roles-manager, recurring-events |
| `font-display text-display-lg` | Cinzel 48px | auto-assign |
| `font-display-lg text-display-lg` | Cinzel 48px | profile |
| `font-display-lg text-[32px]` | Cinzel 32px | away |
| `font-headline-lg text-[26px] sm:text-[30px]` | EB Garamond 26/30px | commitments, cover |
| `font-headline-md text-2xl` | EB Garamond 24px | manager |
| `font-headline-md` (no size) | EB Garamond, inherited | hymn-directory, service-calendar |
| `text-lg font-semibold` | **Libre Franklin 18px** | service-guide, service-guide-editor, service-guide-manager |

**This is the contradiction the header system has to settle**, and it is the one place you should feel free to have a strong opinion — the app cannot have it both ways.

### 2g. The widths are seven different things

`--container-max` is **1200px** and the readme calls it the layout. In practice: `max-w-container` (12 pages) · `max-w-[1600px]` (4: recurring-events, shepherding-profile, hymn-directory, peoples-page) · `max-w-[1280px]` (manager) · `max-w-6xl` = 1152px (shepherding-care-list) · `80rem` inline (shepherding-people) · `max-w-[860px]` (cover) · `max-w-[760px]` (commitments) · full-bleed (hymn-details, profile, the Service Guide trio).

The 1600px ones are **not sloppiness** — they are wide grids (a dates × Roles table, a directory with a filter sidebar) that genuinely need the room. The narrow ones are single-column reading pages. A header system has to say what happens to the bar when the page under it is not 1200px.

### 2h. States every header must survive

- **Auth unknown** — the 40px placeholder, before Firebase answers
- **Signed out** — one "Log In" link where two items were
- **Page loading** — every Alpine page hides `<main>` behind `x-show="!loading"` and shows a centred spinner. **The header stays visible throughout.**
- **Refused** — signed in without the rank. `auto-assign` shows a panel, header intact
- **The phone shell** — header hidden and replaced (§2c)
- **Printing** — the Service Guide trio mark theirs `no-print`
- **Title too long** — 46 chars today, a Person's name tomorrow
- **No title** — six pages have none
- **No back link** — `index.html` is home; `login.html` has neither back nor auth

---

## 3. Compose from these

The design system's real classes, from `build/design-components.mjs`. Use them by name:

**Layout** — `.m-page` (PageShell) and its `.m-page__bar` / `.m-page__body`, `.m-back` (BackLink), `.m-divider`, `.m-row`, `.m-card-list`
**Core** — `.m-btn` (`--primary` / `--secondary` / `--ghost` / `--quiet`), `.m-icon-btn`
**Display** — `.m-label` (SectionLabel — the tracked-caps overline), `.m-serif-head` (SerifHead), `.m-card`, `.m-badge`, `.m-avatar`
**Feedback** — `.m-spinner`, `.m-toast`

The full set is in the Design System pane and in `public/components-demo.html`.

**`.m-page__bar` and `.m-back` are the incumbents here, and both are thin.** `.m-page__bar` is nine declarations and no page uses it; `.m-back` is an arrow and a label. If the header system needs them to be more than that, **change them and say what you changed** — that is a proposal the sync will carry down, and it is a better outcome than a new class sitting beside the old one.

**If none of the existing components fit, say so and design the new thing.** A real new primitive — a PageHeader, a title block, an action group — is a good result. An `.m-card` bent into a header shape is not.

---

## 4. What is open

This is where you should have opinions.

**How many header types, and what decides which a page gets.** This is the whole question. The answer has to be a rule someone can apply to a page that does not exist yet. The real axes the current pages differ on — take them as evidence, not as the answer, and reject any that turn out not to matter:

- **Reading vs. working.** A dashboard you arrive at, versus an editor you sit in for an hour (Order of Service, Service Guide, Hymn Catalog, Auto-assign).
- **Does the page scroll under the header?** Five pages went sticky-and-blurred; twelve did not.
- **Does the page carry actions at the top?** Three pages do. Everywhere else the actions sit under the title in `<main>` — which may be right, or may be the thing to fix.
- **Does it print?**
- **Does it open in the phone shell?** Six pages do.
- **How wide is the page under it?** 760px to full-bleed.

**Where the page title lives.** Today twelve pages put the utility strip in `<header>` and the title 40px lower inside `<main>`, and three put both in one navy bar. Those are two different ideas about what a header *is* — one type or two, and if two, which pages get which.

**What settles §2f.** Cinzel or EB Garamond for a page title, at what size, and whether a Person's name follows the same rule as "Calendar".

**Whether the seal belongs in the header.** Four pages centre it, sixteen omit it, `index.html` puts it below.

**Whether the desktop header should visibly rhyme with the phone's TopBar** (§2c) — same background, same hairline, same left-chevron — or whether the desktop is a different enough medium to look different on purpose.

**The Service Guide's navy bar.** It is the only filled header in the app and the only one that is not warm parchment. That is either a deliberate signal ("you are in a document tool now") worth keeping and generalising, or an accident worth deleting.

**Whether a page needs a header at all.** `relations-viewer.html` has nothing across the top and nobody has complained.

---

## 5. Constraints

- **Tokens only.** No raw hex, no arbitrary Tailwind values. Warm parchment surfaces, deep-navy ink; sand and gold as hairlines only, never fills. **No dark mode.**
- **Material Symbols Outlined**, `currentColor`, `FILL 0`. Never Lucide. Never emoji or unicode as icons.
- **Depth is tonal layers and 1px `--outline-variant` hairlines, not shadows.** Shadows are reserved for modals, the FAB, and a primary button. The current navy header's `shadow-md` is against the system's own rule — that is a fact about the code, not a licence.
- **No gradients, no textures, no hero images.**
- **Draw both widths.** A desktop width (≥1200px) and a phone width (390px) for every header type, because the repo ships both and six pages render both from the same markup.
- **`--container-max` is 1200px**, but the system must have an answer for the 1600px and full-bleed pages — do not design as though every page is 1200.
- **Copy:** Title Case for page titles, UPPERCASE tracked labels (+0.14em) for overlines, sentence case for helper text. Voice is warm, grounded, unhurried. Terse.
- **Non-negotiable:** the auth widget's two states and its 40px height reservation; the header staying put while the page body is loading; the header being hideable and replaceable by the phone shell.

---

## 6. What to send back

1. The **export prompt**.
2. A **`README.md`** naming each header type, the job it does, and the rule for which pages get it — stated so an engineer can apply it to a new page without asking.
3. Each type mounted on **the top 500px of a real page it would serve**, using the real titles and real contents above. Cover at least these six, because each breaks a naive design differently:
   - **Shepherd Dashboard** — the plain case: back, title, subtitle, auth, nothing else
   - **Calendar** — title plus two actions, over a title block that already has its own bottom hairline
   - **Service Guide Editor** — a 46-character dynamic title, two conditional status chips, two buttons, and it prints
   - **Hymn Directory** — 1600px wide, seal centred, sticky over a scrolling grid
   - **Shepherding Profile** — the title is a Person's name, 1600px wide
   - **Roles Manager** — the one that also opens in the phone shell and has its header hidden and replaced
4. **A note on anything you placeholdered or guessed**, and on any existing component you propose changing rather than adding beside.
