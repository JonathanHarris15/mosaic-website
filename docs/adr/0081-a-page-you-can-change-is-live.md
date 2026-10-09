# ADR 0081 — A page you can change is live

**Status:** Accepted
**Date:** 2026-10-08
**Ticket:** MS-717 (Epic), MS-718
**Keeps:** [ADR 0032](0032-a-page-saves-itself-a-dialog-does-not.md), [ADR 0034](0034-a-sunday-saves-the-fields-you-changed.md), [ADR 0035](0035-one-person-per-box.md)

## Context

The Order of Service and the Services table already work this way: you type, it
saves, and another editor's change arrives without a reload (MS-244, MS-246,
MS-482). Most other pages where you can change something read the record once,
open a form, and wait for **Save**. On those pages you work against the version
you opened, a change you leave without saving is thrown away, and who may edit
is often decided by comparing a `permissionLevel` string against a list. That
list predates MS-695 and drifts from the permission map.

## Decision

Any page where you can change what you are looking at follows five rules.

1. **The value is the control.** There is no read mode or edit mode. An editor
   sees inline fields where the values are. Someone who may not edit sees the
   same layout as plain text, not a greyed-out form. Dense tables keep
   click-to-edit cells (the Services table) because a page of open inputs
   cannot be read.
2. **It saves itself** (ADR 0032). Only the fields that changed are written,
   with a dot-path `update()` (ADR 0034). The header chip reads *Unsaved changes*,
   then *Saving…*, then *Saved*. The debounce is 1.5 s, except the Order of
   Service, which keeps its 3 s. Blur and Enter flush. A failed save keeps the
   change, keeps the chip at *Unsaved changes* and says what happened. The next
   edit retries. A value that fails its own check, such as an end before a
   start, does not save, and the field says why. A dialog still has a button,
   per ADR 0032.
3. **Gated on the MS-695 permission for that surface.** The check goes through
   an `AccessCore` helper that reads the permission map, with a legacy-level
   fallback for accounts that have not been migrated. Never a list of level
   strings. Firestore rules stay the backstop, and the page asks the
   `AccessCore` helper that mirrors the write rule on that collection (one
   key per surface, e.g. `canEditEvents`), so the UI offers exactly what the
   rule lets land. Each page moves to its own key as it converts. Pages do
   not re-implement permission resolution; when the rules change, AccessCore
   changes with them. Where a rule still checks only a level list, the page
   records the gap as an open decision rather than patching the rules in
   passing.
4. **Live.** The page listens with `MosaicLiveRead.watch` (a listener on the
   web; on the phone, a listener with a re-read fallback). A field this editor
   has not touched takes the incoming value. A field this editor has changed
   is left alone until it saves. The page's own write echoing back
   (`hasPendingWrites`) is ignored. This is `remoteAdoptions` from the Order of
   Service, and it needs no merge dialog.
5. **Conflicts and undo.** Where several people edit one record together, a
   box someone is in shows their face and is not offered to anyone else
   (ADR 0035, `PresenceStore`). Elsewhere the last write wins per field.
   Escape reverts a field that has not saved yet. There is no page-wide undo,
   except in editors that already have one (the Printables editor). Deleting
   is never autosaved. It stays an explicit, confirmed action.

## Consequences

- A new page uses the five rules from the start. An existing page is converted
  one PR at a time under MS-717, each with emulator smoke evidence: the editor
  sees controls, the viewer does not, the edit lands, and a second client sees
  it.
- Liturgy Orders is the deliberate exception. A half-built order must not
  publish on every step (ADR 0080), and it is being redesigned under MS-716.
- The first conversion is the Services table's gate (MS-719). It moves from a
  level-string list to `AccessCore.canFixSundayService`.
