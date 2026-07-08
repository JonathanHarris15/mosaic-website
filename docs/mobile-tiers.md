# Mobile Tiers — the spine

> **This is the source of truth for how every page reaches the phone.**
> When you add or change a page, you decide its tier *here first*. The migration
> work lives in [mobile-parity-checklist.md](mobile-parity-checklist.md) (the plan);
> the automated gate (Workflow 2) will mirror this file. If code and this file
> disagree, **this file wins** — fix the code or fix the entry, never ignore it.

## The principle

A native screen is a **fork**: it reimplements a page in Preact under
`public/mobile/`, separate from the desktop `.html`/`.js`. A shell-adapted page
is the **same** desktop page running in the WebView. That difference is the
whole game:

> **drift risk ≈ (how often the page changes) × (is it forked?)**

- Fork a fast-changing page → it silently rots as web gains features. Worst case.
- Reuse it via the shell → new web features appear on mobile the same day, for free. Drift is structurally impossible; the only cost is responsive layout.

So **native must earn its place. The default tier is Shell.**

## The three tiers

### 🟢 Native — `public/mobile/`
A hand-built Preact screen. Reserve this for pages that clear **all three** bars:

1. **Frequent on a phone** — someone genuinely pulls it up mid-week or mid-service.
2. **Materially better with touch-native UX** — not just a shrunk desktop page.
3. **Slow-changing** — a stable feature set, so the fork cost is paid once.

...or the page is **inherently mobile** (push settings, camera capture, offline
"now playing"). In practice: **browse / consume / glance** surfaces.

### 🟡 Shell — desktop page + `?shell=mobile`
The desktop page reused inside the WebView (`.shell-mobile` CSS, `mobile-shell.js`
persists the mode across navigations). One codebase, auto-parity. This is the
**default**, and the home for **create / edit / admin / config / heavy** surfaces.

### 🔴 Skip — web-only
Deliberately no mobile presence. For surfaces with near-zero phone value and high
cost (template authoring, deep admin). "Skip" is a *decision*, not neglect — it's
recorded here so the gate doesn't flag it as missing.

---

## The registry (definitive)

Tier = the **intended** architecture. Where today's code differs, the gap is a
task in the plan, not a reason to change the tier.

### 🟢 Native — consume & mobile-native surfaces

| Page | File | Why native |
|------|------|-----------|
| Home Dashboard | `index.html` | Glance surface, opened constantly, low churn. |
| Login | `login.html` | Entry gate, touch-first, essentially static. |
| Hymn Directory | `hymn-directory.html` | Browse/search — read-heavy, used on the go. |
| Hymn Details | `hymn-details.html` | Consume a single hymn; stable shape. |
| People's Directory | `peoples-page.html` | Browse the directory; a phone lookup surface. |
| Service Calendar | `service-calendar.html` | Glance at upcoming services. |
| Care List | `shepherding-care-list.html` | Pulled up during visits — a frequent on-the-go surface. |
| Documents (list) | `shepherding-documents.html` | Browse shepherding docs from a phone. |
| Document (single) | `shepherding-document.html` | Read a doc on the go. ⚠️ Editable — fork carries drift risk. |
| Service Guide Generator | `service-guide.html` | Show/generate the guide during a service. ⚠️ Generates — fork carries drift risk. |

### 🟡 Shell — create / edit / admin / heavy (the default)

| Page | File | Why shell |
|------|------|-----------|
| Service Editor (Order of Service) | `service-builder.html` | Dense editor, high churn, reuse proven save logic. |
| Hymn Manager | `manager.html` | Curation/edit surface — belongs in the single codebase. |
| Shepherd Dashboard | `shepherding-dashboard.html` | Cluster entry point; elder tooling. |
| Shepherd People | `shepherding-people.html` | Part of the shepherding cluster. |
| Shepherding Profile | `shepherding-profile.html` | Part of the shepherding cluster. |
| Manage Tags | `shepherding-tags.html` | Config surface within shepherding. |
| Admin Dashboard | `admin-dashboard.html` | Deep admin/config — never fork this. |
| Analytics | `analytics.html` | Reporting reused as-is; not worth a fork. |
| Profile | `profile.html` | Account/settings surface — one codebase, no fork. |

### 🔴 Skip — web-only

| Page | File | Why skip |
|------|------|----------|
| Service Guide Editor | `service-guide-editor.html` | Template *authoring* — a desk task, web-only. |
| Service Guide Manager | `service-guide-manager.html` | Template management — a desk task, web-only. |

### ⚪ Excluded — not a user-facing content page

| Page | File | Why |
|------|------|-----|
| Components Demo | `components-demo.html` | Dev-only gallery. |
| Not Found | `404.html` | Error page. |
| Mobile Shell Host | `mobile.html` | The shell itself, not content. |

*Tiers ratified 2026-07-08. The two ⚠️ native entries (Document single, Service
Guide Generator) are editable/generative surfaces knowingly forked for on-the-go
value — accept the manual-sync burden and watch them for drift.*

---

## Rule for any new page

1. **Default to 🟡 Shell.** Build the desktop page; add `mobile-shell.js` + a
   responsive pass. Done — it's on mobile with zero fork.
2. **Choose 🟢 Native only if it clears all three bars** (frequent · touch-native ·
   slow-changing) or is inherently mobile. Write the one-line justification in the
   registry above.
3. **Choose 🔴 Skip only deliberately**, with a reason, so the gate treats its
   absence as intended.
4. **Add the row to the registry before merging.** The Workflow 2 gate fails CI
   when a `public/*.html` exists with no entry here.
