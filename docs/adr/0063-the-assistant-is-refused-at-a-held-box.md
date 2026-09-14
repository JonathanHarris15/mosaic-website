# ADR 0063 — The assistant is refused at a held box, checked on the server

**Status:** Accepted
**Date:** 2026-09-14
**Follows:** [ADR 0035](0035-one-person-per-box.md), [ADR 0038](0038-mcp-server-hosted-on-firebase-authenticates-through-firebase-auth.md)

## Context

A [[Box lock]] today is enforced only in the browser: a held box has no editor to click into, but nothing on the server checks a write against who holds it. That was enough while every writer was a page that drew the lock. The assistant (the MCP) is not — it writes straight to Firestore from a Cloud Function and has never read `presence`, so it can write into a hymn, a cell or a paragraph an elder is typing in, and the elder's next autosave silently writes it back.

## Decision

**Every assistant tool that writes into a box first checks `presence` on the server and refuses if someone else holds it**, naming them ("Sam is editing this — try again shortly"). This covers the Shepherding tools and the Order of Service tools alike.

Pages keep enforcing locks in the browser only. Making the Firestore rules check presence on every write was considered and not taken: it would put a presence read inside every rule evaluation, and the pages already cannot open a held box.

## Consequences

- A request to the assistant can fail because a person is working. That is the right answer, and it says who.
- The server now depends on the presence record's shape; changing it means changing the MCP too.
