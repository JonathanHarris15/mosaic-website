# Mobile Parity — Migration Plan

> **Companion to the spine, [mobile-tiers.md](mobile-tiers.md).** The spine says
> what each page *should* be. This plan is the ordered work to make today's code
> match it, highest-risk first. Tick a box when the acceptance line is true.
>
> **Legend:** current tier → **target tier** (from the spine).
> 🟢 Native · 🟡 Shell · 🔴 Skip. A ⚠️ marks a decision you still owe.

## Where we stand

| | 🟢 Native | 🟡 Shell | 🔴 Skip |
|--|--|--|--|
| **Spine target** | 10 | 9 | 2 |
| **Code today** | 6 correct (Home, Login, Hymn Directory, Hymn Details, People, Calendar) + 3 off-spine (**Hymn Manager**, **Admin** stub, **Profile** stub) | 8 (Service Editor + shepherding ×7) | 0 |

Two forces drive the plan. **Down to shell:** three off-spine natives (Admin stub,
Profile stub, Hymn Manager fork). **Up to native:** four pages promoted from
shell/stub that must now be *built* as native screens — Care List, Documents
(list), Document (single), Service Guide Generator.

---

## Phase 0 — Ratify the spine ✅ (2026-07-08)

- [x] **Analytics** → 🟡 **Shell.**
- [x] **Service Guide Editor** → 🔴 **Skip** (confirmed).
- [x] **Service Guide Manager** → 🔴 **Skip** (confirmed).
- [x] **Profile** → 🟡 **Shell** (not native).

*Spine registry is now final: 6 native · 13 shell · 2 skip.*

---

## Phase 1 — Kill fake parity (highest risk)

These *look* done on mobile but aren't. Most dangerous because they hide the gap.

- [x] **Admin Dashboard** — 🟢 stub → **🟡 Shell.** ✅ Deleted `AdminScreen`;
      added `admin: "admin-dashboard.html"` to `SHELL_PAGES`; wired
      `mobile-shell.js` + `mobile-shell.css` into the page and made its Home link
      shell-aware (Alpine `:href`). *Code done — visual device-mode pass pending.*
- [x] **Profile** — 🟢 stub → **🟡 Shell.** ✅ Deleted `ProfileScreen`; added
      `profile: "profile.html"` to `SHELL_PAGES`; wired the shell scripts, an
      inline home-link rewrite (non-Alpine page), and made shared `logout()`
      shell-aware (`mobile.html#/login`). Big parity win — profile.html brings
      password-change + staff-access management the stub never had.
      *Code done — visual device-mode pass pending.*

---

## Phase 2 — Confirm the native consume screens

These are correctly native. Job is to verify they haven't quietly drifted behind
their web twins — walk each web page and check nothing's missing on mobile.

- [ ] **Home Dashboard** — decide the deliberate delta. Web has draggable cards +
      more widgets; mobile is lighter. Either surface the missing widgets or
      record "intentionally lighter" here.
      *Acceptance: the web/mobile home difference is a written decision, not an accident.*
- [ ] **Login** — verify parity of auth paths (password reset, guest, any SSO).
- [ ] **Hymn Directory** — verify search/filter parity with web.
- [ ] **Hymn Details** — verify all fields/sections present.
- [ ] **People's Directory** — verify fields, search, and person detail parity.
- [ ] **Service Calendar** — verify range, statuses, and tap-through parity.

*Acceptance: for each, a side-by-side pass found no missing web feature (or the miss is logged as a task).*

---

## Phase 3 — Prove the shell-adapted pages actually work on a phone

Shell pages inherit features for free, but not layout. Audit each at 480px wide
(and on a real device) for tap targets, overflow, and modals.

- [ ] **Service Editor** (`service-builder.html`) — the dense one; check
      drag-reorder and forms are usable by thumb.
- [ ] **Shepherd Dashboard** — entry point renders correctly in-shell.
- [ ] **Shepherd People**
- [ ] **Shepherding Profile**
- [ ] **Manage Tags**

*Acceptance: each shepherding/editor page is navigable and legible on a phone with no horizontal scroll or unreachable controls.*

---

## Phase 4 — Build the promoted native screens

Four pages moved *up* to native (2026-07-08). None exist as native yet — this is
net-new Preact work in `public/mobile/`, plus routing changes and a `parity.json`
entry each. Highest effort in the plan, and the two ⚠️ carry ongoing sync cost.

- [ ] **Care List** (`shepherding-care-list.html`) → **🟢 Native.** Build the
      screen; register in `M.SCREENS`; route from the shepherd cluster. Browse
      surface — cleanest of the four.
- [ ] **Documents (list)** (`shepherding-documents.html`) → **🟢 Native.** Build
      the list screen; retire the `ROUTE_META.documentEditor` coming-soon bounce.
- [ ] **Document (single)** (`shepherding-document.html`) → **🟢 Native.** ⚠️
      Editable — the native view must reproduce the web save logic, and stay in
      step with it. Log the parity contract so future web edits get mirrored.
- [ ] **Service Guide Generator** (`service-guide.html`) → **🟢 Native.** ⚠️
      Generative — replace the `ROUTE_META.serviceGuide` bounce with a native
      screen; mirror the generation logic and watch for drift.

*Acceptance: each opens as a native Preact screen (no shell bounce), matches its web twin's features, and has a `parity.json` entry.*

---

## Phase 5 — Close the remaining shell/skip gaps

- [ ] **Analytics** (`analytics.html`) — 🔴 absent → **🟡 Shell.** Add
      `mobile-shell.js` + responsive pass; add an entry point (drawer or Admin).
      *Acceptance: analytics is reachable and legible inside the shell.*
- [ ] **Service Guide Editor** (`service-guide-editor.html`) — **🔴 Skip.** Confirm
      no mobile route points at it (leave web-only).
- [ ] **Service Guide Manager** (`service-guide-manager.html`) — **🔴 Skip.** Same check.

---

## Phase 6 — Converge the grandfathered native screen (low priority)

- [ ] **Hymn Manager** — 🟢 Native → **🟡 Shell**, *opportunistically.* The native
      `HymnManagerScreen` works today, so don't rip it out for its own sake. But
      it's an edit surface off the spine: the next time it needs real work, prefer
      migrating to `manager.html?shell=mobile` over extending the fork.
      *Acceptance: either migrated to shell, or explicitly kept with the drift risk accepted in writing.*

---

## Then: Workflow 2 (keep it this way)

With the spine ratified and the plan underway, the gate is small:

1. **`public/mobile/parity.json`** mirrors the spine registry (page → tier).
2. **A test in `test/`** fails CI when a `public/*.html` has no `parity.json`
   entry — you can't merge a new page without classifying it.
3. Optionally fold the check into the `feature` skill so every new page declares
   its tier before merge.

Phase 0 is settled and the registry is final, so this is ready to build now.
