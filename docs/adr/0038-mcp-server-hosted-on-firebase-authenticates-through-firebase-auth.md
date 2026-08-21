# ADR 0038 — The Order of Service MCP server is hosted on the existing Firebase project and authenticates callers through Firebase Auth

**Status:** Accepted
**Date:** 2026-08-21

## Context

MS-262 adds an MCP server so an LLM client (Claude Desktop/Code) can query hymn
history, score theme similarity, read the scripture usage heatmap, and write
an auto-filled Order of Service back to `services/{date}` — usable from
anywhere, not just one machine, and by any editor-or-above, not just one
person.

A remote MCP server needs two separate things a local one doesn't: somewhere
to run that's reachable from any client, and a way to answer "is this caller
allowed to talk to me at all" before it ever touches Firestore permissions.

## Decision

**Hosting:** the server is one more exported Cloud Functions v2 HTTP endpoint
in `functions/index.js`, using MCP's Streamable HTTP transport. Cloud
Functions v2 already is a plain HTTP server (Cloud Run underneath), so this
is no new infrastructure — same project, same deploy, same billing. The
server is written to be stateless per-request rather than relying on an
in-memory session, so it survives Cloud Functions recycling the instance
between calls without needing to pay for `minInstances: 1`.

**Auth:** the front door is a full OAuth 2.1 login, gated to `editor` or
above — the same permission floor `scoreTheme` and `services/{date}` writes
already enforce. Firebase Auth is not itself a spec-compliant OAuth
authorization server for third-party clients (no dynamic client
registration, no MCP-shaped `/authorize`/`/token`), so a thin bridge sits in
front of it: a couple of endpoints, alongside the MCP server in the same
project, whose `/authorize` page is a plain Firebase Auth email/password
sign-in (the only method this site already uses — see `login.html`) and
whose `/token` step issues an MCP-shaped token carrying that user's
permission level.

Rejected: reusing the Admin SDK service-account credential (the pattern
`scripts/backfill-*.js` already uses) directly in the server. That would
have been far less setup, but it's all-or-nothing — anyone with the deployed
server URL would get full admin access rather than their own editor
permissions, and it would give every future capability added to this server
the same all-or-nothing shape by default.

## Consequences

Every tool this server exposes — now and anything added later — inherits
per-user editor-gated access for free, because the auth layer is shared
infrastructure rather than something each tool re-implements. The cost is
building and maintaining the OAuth bridge itself, which a purely local or
shared-secret design would not have needed.
