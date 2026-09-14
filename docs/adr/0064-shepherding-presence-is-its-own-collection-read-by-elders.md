# ADR 0064 — Shepherding presence is its own collection, read by elders only

**Status:** Accepted
**Date:** 2026-09-14
**Follows:** [ADR 0035](0035-one-person-per-box.md), [ADR 0062](0062-a-shepherding-document-is-held-paragraph-by-paragraph.md)
**Ticket:** MS-429 (decision MS-477)

## Context

The Order of Service keeps presence at `presence/{uid}`: one record per editor saying which page they are on and which box they hold. Every editor may read it, which is fine — it names people writing a service guide.

Shepherding needs the same thing (MS-429), but a Shepherding record says something else: *which person* an elder is looking at, and which of that person's notes they have open. That is pastoral attention. Editors who are not elders — and admins — have no business learning it.

Narrowing the read rule on `presence` would not work: the Order of Service listens to the whole collection, and a query the rules can refuse for some documents is refused outright, so guide-writers who are not elders would lose their faces and locks.

## Decision

**Shepherding presence lives at `shepherding_presence/{uid}`, readable only by elders and super admins, and writable only by its owner** — the same "the document id is the lock" rule as `presence`, with the elder check in place of the editor check.

Both use one store implementation (`presence-core.js`), which takes its collection as a setting. A page claims all its Shepherding boxes through **one** store (`shepherding-presence.js`), because a store writes one record per person and two on one page — a profile and the Tasks tab inside it — would overwrite each other's claim.

## Consequences

- One person can hold an Order of Service box and a Shepherding box at the same time. Harmless: the two areas never share a box.
- The assistant's held-box check (MS-433) must read the collection that matches the tool's area.
- Adding presence to another pastoral surface means using this collection, never `presence`.
