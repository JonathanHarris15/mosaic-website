# ADR 0062 — A Shepherding document is held paragraph by paragraph, not typed together

**Status:** Accepted
**Date:** 2026-09-14
**Follows:** [ADR 0035](0035-one-person-per-box.md), which chose one person per box for the Order of Service, and [ADR 0034](0034-a-sunday-saves-the-fields-you-changed.md), which made that safe by saving only the fields you changed.

## Context

Shepherding pages read once and save whole: an [[Elder Document]] writes its entire body, a [[Care List]] its entire cell map, a [[Form Document]] its entire answers map. Two elders — or an elder and the assistant — on one document overwrite each other without either knowing.

ADR 0035 said its simplification was "only available because the liturgy is a fixed set of named slots rather than free prose". An Elder Document *is* free prose. The obvious answer for prose is shared typing (Yjs / a collaboration server — see `docs/plans/document-editing-tiptap-lexical-or-an-office-server.md`).

## Decision

**Keep one person per box, and make the prose into boxes.** Every heading, paragraph, list item and table cell in an Elder Document carries a stable id, saves on its own, and is held by one person at a time. A [[Person Panel]] is one box. A Care List cell and a Form Document question are boxes the same way. Everything else on the page is adopted live, exactly as the Order of Service does.

Shared typing was rejected: it is a server and a data format we would carry forever, for a case — two elders in the *same* paragraph at the *same* moment — that almost never happens and that "Sam is editing this" settles.

**One rule does not carry over.** The Order of Service can let a box stay held while its page is open because the men are in one room and can ask. Elders are not. **A Shepherding hold lets go after one minute without typing**; the text is already saved, and the holder takes it back on their next keystroke if nobody else has.

## Consequences

- Saving by paragraph is a change to how every Elder Document is stored, and every writer — web, phone, assistant — must go through it. Hard to undo once documents carry ids.
- Two elders can never type in the same paragraph at once. Deliberate.
- Streaming keystrokes or cursors can still be added later; nothing here assumes they are absent.
