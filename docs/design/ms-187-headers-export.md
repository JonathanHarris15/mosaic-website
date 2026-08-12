# MS-187 — Header Crusade: the design coming back

**Date:** 2026-08-12
**From:** Claude Design, project `f2292e35-4adc-4d33-a42d-7ca9373364c9`, kit at `ui_kits/headers/`
**Brief it answers:** [`ms-187-headers-brief.md`](ms-187-headers-brief.md)

Files returned: `index.html` · `header.css` · `kit.jsx` · `screens.jsx` · `README.md` · `EXPORT_PROMPT.md`

---

## What it proposes, in one paragraph

**One component, two types.** A **Standing Bar** (`.m-header`) for pages a person reads or browses, and a **Tool Bar** (`.m-header--tool`) for full-bleed editors. Both carry the same anatomy in one row: back link · title (+ subtitle) · actions · hairline · `#auth-container`. The eight current header shapes all collapse into it. Three things are settled deliberately: **the title moves into the header**, **page actions move into the header**, and **the navy bar is deleted** in favour of a tonal step (`--surface-container`).

## The rule the design states, in four questions

1. **Does the page fill the viewport and scroll inside its own panes?** Yes → Tool Bar. No → Standing Bar.
2. **Is the body one long scroll passing under the top of the window?** Yes → add `--sticky`. (Tool Bar is always sticky.)
3. **How wide is the page's column?** Set `--m-header-max`. Default `1200px`; `1600px` for the wide grids; `none` for full-bleed. The background and hairline always span the window — only the contents align to the column.
4. **Is the title a place in the app, or a record in the database?** A place → Cinzel. A record → EB Garamond (`--serif`).

A subtitle adds `--tall`. Nothing else is a decision.

---

## header.css as returned

```css
.m-header {
  --m-header-max: var(--container-max);
  --m-header-h: 64px;
  --m-header-pad: var(--space-md);
  --m-header-title: 28px;
  --m-header-title-serif: 30px;
  --m-header-title-track: .02em;
  --m-header-title-transform: none;
  position: relative; z-index: 40; flex: 0 0 auto; width: 100%;
  background: var(--surface-container-lowest);
  border-bottom: 1px solid var(--outline-variant);
}
.m-header__inner {
  display: flex; align-items: center; gap: var(--space-md);
  width: 100%; max-width: var(--m-header-max); margin: 0 auto;
  min-height: var(--m-header-h); padding: 0 var(--m-header-pad);
}
.m-header__lead { display: flex; align-items: center; gap: var(--space-sm); min-width: 14ch; flex: 1 1 auto; }
.m-header__titles { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.m-header__title {
  margin: 0; min-width: 0;
  font-family: var(--font-display); font-size: var(--m-header-title); font-weight: 600;
  line-height: 1.15; letter-spacing: var(--m-header-title-track);
  text-transform: var(--m-header-title-transform); color: var(--primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.m-header__title--serif {
  font-family: var(--font-serif); font-size: var(--m-header-title-serif);
  letter-spacing: .01em; text-transform: none; color: var(--on-surface);
}
.m-header__sub {
  font-family: var(--font-sans); font-size: 13.5px; line-height: 1.35;
  color: var(--on-surface-variant);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.m-header--tall { --m-header-h: 84px; }

.m-header__actions { display: flex; align-items: center; gap: var(--space-base); flex: 0 0 auto; }
.m-header__rule { align-self: stretch; flex: 0 0 auto; width: 1px; margin: 14px 0; background: var(--outline-variant); }
.m-header__auth { display: flex; align-items: center; gap: var(--space-xs); flex: 0 0 auto; min-height: 40px; }
.m-header__logout { color: var(--error); }
.m-header__logout:hover:not(:disabled) { background: var(--error-container); color: var(--on-error-container); }

.m-header--sticky {
  position: sticky; top: 0; z-index: 50;
  background: color-mix(in srgb, var(--surface-container-lowest) 88%, transparent);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}

.m-header--tool {
  --m-header-max: none; --m-header-h: 56px;
  --m-header-title: 24px; --m-header-title-serif: 24px;
  position: sticky; top: 0; z-index: 50;
  background: var(--surface-container);
}
.m-header--tool .m-header__auth .m-btn__label,
.m-header--tool .m-header__actions .m-btn:not(.m-btn--primary) .m-btn__label { display: none; }
.m-header--tool .m-header__auth .m-btn,
.m-header--tool .m-header__actions .m-btn:not(.m-btn--primary) { width: 38px; padding: 0; }

@media print { .m-header { display: none; } }

.m-header--compact {
  --m-header-h: 46px; --m-header-pad: var(--space-xs);
  --m-header-title: 17px; --m-header-title-serif: 20px;
  --m-header-title-track: .06em; --m-header-title-transform: uppercase;
}
.m-header--compact .m-header__inner { gap: var(--space-xs); }
.m-header--compact .m-header__sub,
.m-header--compact .m-back__label,
.m-header--compact .m-btn__label,
.m-header--compact .m-header__rule { display: none; }
.m-header--compact .m-back { min-width: 44px; min-height: 44px; justify-content: center; }
.m-header--compact .m-header__actions { gap: 2px; }
.m-header--compact .m-header__chip { padding: 2px; }
.m-header--compact .m-header__actions .m-btn { width: 44px; height: 44px; padding: 0; background: transparent; border-color: transparent; color: var(--primary); box-shadow: none; }
.m-header--compact .m-header__title--serif { letter-spacing: .01em; }

/* @media (max-width: 640px) and @container (max-width: 640px) repeat the
   compact block verbatim. The design says the @container copy is optional. */

/* Proposed changes to BackLink */
.m-back { flex: 0 0 auto; white-space: nowrap; min-height: 44px; padding-right: var(--space-xs); }
.m-back__label { font-family: var(--font-sans); font-size: 11.5px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; }

/* A status chip in the bar */
.m-header__chip { align-self: center; flex: 0 0 auto; white-space: nowrap; }
.m-chip-dot { width: 6px; height: 6px; border-radius: var(--radius-full); background: currentColor; flex: 0 0 auto; }
```

## The markup shape

```html
<body class="m-page">
  <header class="m-header">
    <div class="m-header__inner">
      <div class="m-header__lead">
        <a class="m-back" href="index.html">
          <span class="material-symbols-outlined">chevron_left</span>
          <span class="m-back__label">Home</span>
        </a>
        <div class="m-header__titles">
          <h1 class="m-header__title">Shepherd Dashboard</h1>
          <span class="m-header__sub">Elder-only tools for member care.</span>
        </div>
      </div>
      <div class="m-header__actions">…</div>
      <div class="m-header__rule"></div>
      <div class="m-header__auth" id="auth-container"><div class="h-10"></div></div>
    </div>
  </header>
  <main class="m-page__body">…</main>
</body>
```

## The six page tops it drew

| Page | Type | Mode | Width | Back | Actions |
| --- | --- | --- | --- | --- | --- |
| Shepherd Dashboard | standing | display | 1200 | `Home` | none (has a subtitle) |
| Calendar | standing | display | 1200 | `Home` | Away · Recurring events |
| Service Guide Editor | **tool** | serif | none | `Service Guides` | 2 chips · Save · Print PDF |
| Hymn Directory | standing, sticky | display | 1600 | `Home` | search field · Add New Hymn |
| Shepherding Profile | standing | **serif** | 1600 | `Shepherd Dashboard` | Edit · Add Note |
| Roles Manager | standing | display | 1200 | `Manager` | Auto-assign |

## What the design flagged about itself

- `Recurring events` is sentence case among twenty Title Case titles — rendered as-is, not corrected.
- The pulsing dots on the Unsaved / page-count chips are gone (static `.m-chip-dot`), because an infinite animation is against the motion rule. Offers to bring it back as a one-shot fade.
- Back labels `Service Guides`, `Manager`, `Shepherd Dashboard` are **invented** — asks for them to be checked against the real navigation graph.
- Page bodies are placeholder slabs; only the top 500px is the deliverable.
- The `@container (max-width: 640px)` block duplicates the `@media` block and can be dropped on sync.
- The `more_vert` overflow for a fourth action is a **stated rule, not a shipped pattern** — no page has four today.
- No nav/drawer designed. The back link is still the whole wayfinding story.

---

## Decisions

_To be filled in from the grilling round, then carried onto MS-187's PRD._
