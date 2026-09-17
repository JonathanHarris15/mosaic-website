# ADR 0065 — A Pastoral Assistant is a grant on the account, not a Permission Level

**Status:** Accepted
**Date:** 2026-09-17
**Follows:** [ADR 0041](0041-a-kiosk-account-reads-like-any-signed-in-account.md), [ADR 0013](0013-elder-tag-projection-and-derived-relationships.md), [ADR 0046](0046-an-event-attachment-is-fetched-never-linked.md)
**Ticket:** MS-426 (decision MS-512)

## Context

The elders' training meeting of 2026-09-08 needed two men to take minutes. They could not open the Shepherd Dashboard: the only door into shepherding data is the `elder` Permission Level, or super admin. Both are the wrong door for a secretary.

Making someone an elder also *counts* them as an elder. They get the Elder Tag, appear in the Elder Assignment and Task Assignee pickers, receive the Elder Digest, can vote on elder-only forms, and can change people's tags and pastoral status. Super admin is the keys to the whole app.

Sam asked for a role called **Pastoral Assistant** for Stephen Persley and Ian Riley: they write the record in the room, they see everything an elder sees, and they are not officers.

Permission Level is the existing access tier (`viewer → member → editor → elder → admin → super_admin`, with `kiosk` as its own allowlist). Two ways of adding a fourth kind of person were available, and both fail this case.

## Decision

**Pastoral Assistant is a boolean grant on the User account (`users.pastoralAssistant`), stacked on whatever Permission Level the account already holds. It is not a new Permission Level.**

An admin or super admin switches it on. The `users` collection is already admin-write only; a user may still only update their own dashboard card order, so nobody can grant it to themselves. The Permission Level is unchanged, and so is the Elder Tag projection, which still reads only the `elder` level.

The grant answers three sentences:

1. **Reads everything an elder reads**, everywhere — web, phone, and the MCP — including the editor-rung things an elder sees because an elder is an editor (Away, editor-rung Events, Forms and their answers, Printables, locked guidance, hidden tags and the people they hide).
2. **Writes the record**: Elder Documents of every kind (Meeting Minutes, Care Lists, Form Documents) and their Folders, Shepherding Notes (including through a Person Panel), and Tasks / Task occurrences, with the same freedom elders have over those.
3. **Makes no elder decision and is never counted as an elder.** They cannot set a Shepherding Status, change tags or the tag vocabulary, set an Elder Assignment, add an Explanation, manage Filtered Views or Relationships, write or text Prayer Requests, lock guidance, shut a form to elders, or answer an elder-rung form. They never carry the Elder Tag, never appear as an assignable elder, and receive no Elder Digest.

A member who is a Pastoral Assistant gets no editor writes. An editor who is one keeps theirs.

### Why not a sibling Permission Level (the Kiosk pattern)

[ADR 0041](0041-a-kiosk-account-reads-like-any-signed-in-account.md) added `kiosk` as its own `permissionLevel` value, checked with an explicit allowlist. That is the right shape for a foyer machine that must *not* also be an editor. A Pastoral Assistant who already holds editor rights (Stephen) would lose them the moment the account moved to a new level. The grant stacks; a new level replaces.

### Why not a rung between editor and elder

A rung `editor < pastoral_assistant < elder` would hand every editor write — including moving Membership Tags, which this ticket defers — to anyone who holds it. The grant names what it gives and nothing else.

### One shared access core; rules restate it

A new shared module answers four questions from an account (`permissionLevel` + `pastoralAssistant`):

- *reads as elder* — elder or super admin, **or** Pastoral Assistant
- *reads as editor* — the existing editor ladder, **or** Pastoral Assistant
- *writes the record* — elder or super admin, **or** Pastoral Assistant
- *is an elder* — elder or super admin only

*writes as editor* stays the existing editor ladder; the grant adds nothing to it.

Web pages, the phone shell, Cloud Functions and the MCP all ask this core. Firestore and Storage cannot import it, so they restate the helpers, and tests pin the restatement — the same trade [ADR 0046](0046-an-event-attachment-is-fetched-never-linked.md) already accepted for Event Attachment visibility.

## Consequences

- Every new elder-gated surface must now ask **two** questions — *may they read / write the record* versus *may they decide / count as an elder* — not one. A single `isElder()` check is no longer enough; a future collection that forgets the split will either lock the assistant out of the minutes or hand them a decision that is not theirs.
- The Elder Tag, the Assignee picker, the Elder Digest and elder-rung form answering stay projected from the `elder` Permission Level. A Pastoral Assistant is absent from all four by construction, not by a second list that can drift.
- Removing the grant cuts every door on the next request. Nothing else has to be revoked.
