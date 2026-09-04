# ADR 0053 — The Forms library is a place you navigate, not a pane you pick from

**Status:** Accepted
**Date:** 2026-09-02
**Ticket:** MS-360, constraining MS-361

## Context

The MS-360 brief told Claude Design not to draw folders — they belong to MS-361,
and MS-360 is meant to be the thin slice that proves a stranger can answer a form
safely.

It drew them anyway, and it went further: it came back with **two competing
navigation models** and recommended the one it had been told not to build.

- **The split pane.** A 372px list of forms down the left, the form being edited
  on the right — the shape `roles-manager.html` already uses, and the shape the
  brief pointed it at.
- **The library page.** A full-width list of folders and forms with a breadcrumb,
  which you open *into* a full-page form editor. The shape
  `shepherding-documents.html` uses.

Ignoring the second one and building the first was the obvious, disciplined
answer. It is also wrong, and the reason is worth writing down.

## Decision

**The Forms library is a page you navigate into, not a list you pick from — and
MS-360 builds it that way, without folders.**

The split pane cannot survive folders. A folder tree, a breadcrumb, and a
drag-to-file target do not fit in a 372px rail beside an editor; the Document
Library does not attempt it, and it is the closest sibling this feature has.
Building the split pane in MS-360 therefore buys a screen that MS-361 must throw
away — and the thing it throws away is the whole navigation layer, not a detail.

So MS-360 adopts the **navigation shape** and defers the **folders**:

- A full-page Forms library listing forms, with search and a "hide closed"
  toggle.
- Opening a form goes to the form's own page — questions, settings, responses.
- A breadcrumb is present and reads `Forms` and nothing else, because there is
  nowhere yet to go.
- No folder rows, no New folder, no drag-to-file. MS-361 adds those to a page
  already shaped to receive them.

**The Roles Manager stays as it is.** Its split pane is right for it: a Role is a
small object with no hierarchy and no plausible folder story, and it is edited in
bursts against a list you keep glancing at. This decision is about the Forms
library, not a house rule that split panes are wrong.

## Consequences

**MS-361 gets smaller and stops being a rewrite.** It adds folder rows,
breadcrumb depth, and a move affordance to a page whose shape already assumes
them. Its ticket needs updating to say so, since it was written expecting to
build the library from scratch.

**MS-360 gets slightly larger** — a library page plus a form page is more than one
split-pane screen. That is accepted: it is the same total work moved earlier, not
new work, and the alternative was paying for the split pane twice.

**The design was right and the brief was wrong.** The brief said "leave room for
folders but do not draw them", which sounds careful and is not implementable —
you cannot leave room in a layout that has no room. Asked to honour it literally
the design would have produced the throwaway. A future brief should say *"design
the end state, build the near state"* when a deferred feature changes a layout's
bones.

**The phone is unaffected either way.** Both models collapse to list-then-editor
inside the mobile shell, which is what the Roles Manager already does.
