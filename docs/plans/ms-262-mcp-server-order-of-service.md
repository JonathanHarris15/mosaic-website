# MS-262 — MCP server for Order of Service building

**Status:** PRD and sub-task breakdown drafted and approved locally; nothing
implemented yet. Stored here because Jira (`methodllc.atlassian.net`, ticket
[MS-262](https://methodllc.atlassian.net/browse/MS-262)) is currently
unreachable from this session. **This file is a stand-in for the ticket
description, not a replacement for it** — once Jira is back:
1. Paste the PRD section below into MS-262's description via `editJiraIssue`
   (`contentFormat: "markdown"`).
2. Create each sub-task below under MS-262 via `createJiraIssue`
   (`parent` = MS-262), in the dependency order listed, then link them with
   `createIssueLink` (`Blocks`) per the pairs noted under each one.
3. Ticket stays in `To Plan` in Jira until the sub-tasks exist there, then
   `/plan-ticket` Phase 6 decides Night Work / On Deck / To Do.
**Do not start building any sub-task below until the user explicitly says
so** — this breakdown is approved for planning purposes only so far.

Design decisions behind this PRD were settled in a `grill-with-docs` session;
see ADR-0038 (`docs/adr/0038-mcp-server-hosted-on-firebase-authenticates-through-firebase-auth.md`)
for the hosting/auth decision specifically.

---

## Problem Statement
Building a Sunday's Order of Service means answering questions the site already has the data for, but not the tools to ask directly: which hymns fit this theme and haven't been sung in a while? Has this theme (or something close to it) already been preached? What scripture passages have we leaned on too heavily lately? Today, answering these means manually digging through the Analytics page and the hymn list yourself, then typing the results into the Order of Service editor by hand. The site knows the answers, but nothing lets an assistant help reason through them in conversation.

## Solution
A remote MCP server (a small service an AI assistant such as Claude Desktop or Claude Code can connect to over the internet), hosted on the same Firebase project as the rest of the site. Once an editor-or-above connects, by signing in with their existing site login, the assistant can pull hymn play history, score a candidate theme against everything preached before, and read the scripture usage heatmap, then, once the editor has agreed on picks in conversation, write them into that Sunday's Order of Service with one approved action.

This is deliberately the first slice of a broader idea: an assistant that can help with more of the website over time. This ticket only covers Order-of-Service-building, but every naming and access-control choice below is made so later capabilities (for example helping with the People directory or Roles) can be added as new tool groups without reworking what this ticket builds.

## User Stories
1. As an editor, I want to connect my Claude assistant to the church's Order of Service data, so that I can ask it questions instead of digging through pages myself.
2. As an editor, I want the assistant to know which hymns exist and how recently each was used, so that I can avoid repeating a hymn too soon without checking by hand.
3. As an editor, I want the assistant to tell me how similar a theme I'm considering is to themes already preached, so that I can decide whether to reuse it or pick something fresher.
4. As an editor, I want the assistant to know which scripture passages we've leaned on heavily and which we haven't touched, so that I can round out the Order of Service more deliberately.
5. As an editor, I want the assistant to propose hymns, theme, and scripture picks in conversation without touching the real Order of Service until I say so, so that nothing changes on the live Sunday record without my say-so.
6. As an editor, I want to explicitly approve before anything is written to a Sunday's Order of Service, so that I stay the final word on what actually runs.
7. As an editor, I want to sign in with my normal site account to use this, so that I don't need a separate password or credential to manage.
8. As a member who is not an editor, I want to be refused if I try to connect, so that only people already trusted to edit the Order of Service can use this.
9. As the site owner, I want this server's tools clearly namespaced to Order-of-Service concerns, so that adding a different capability later does not require renaming anything already in use by a connected client.
10. As the site owner, I want the write-back tool to only ever touch liturgy fields such as theme, key verse, hymns, and scripture readings, so that assigning people to roles like Preacher or Service Leader stays out of scope until a proper lookup tool exists for it.

## Implementation Decisions

Hosting and transport: the MCP server is one more exported Cloud Functions v2 HTTP endpoint, using MCP's Streamable HTTP transport. No new infrastructure is needed; it deploys and bills alongside everything else already running there. The server is written to be stateless per request, so it keeps working correctly when Cloud Functions recycles the underlying instance, without needing to pay to keep one instance always warm.

Authentication (see ADR-0038): the front door is a full OAuth 2.1 login, gated to editor or above, the same floor scoreTheme and services writes already enforce. Firebase Auth is not itself an MCP-shaped OAuth authorization server, so a thin bridge sits in front of it: an authorize endpoint that is a plain Firebase Auth email/password sign-in page (the only sign-in method this site already uses), and a token endpoint that issues an MCP-shaped token carrying that user's permission level. The MCP server calls the underlying Cloud Functions as the signed-in editor's own Firebase identity, not via the Admin SDK service-account credential, so every existing permission check applies exactly as it does today, with no new bypass introduced.

Tool naming: every tool this ticket adds is prefixed oos_, so a future capability group can be added later as a clean, separate namespace without renaming anything already in use by a connected client.

Tools exposed, all as MCP tools rather than resources, since the value is filtering and reasoning over the data rather than passively browsing it:
- oos_get_hymn_history wraps the existing getHymnIndex callable (hymn name, times played, last played date, tags). Expected to need little or no server-side change; the assistant filters the returned list in conversation.
- oos_score_theme wraps the existing scoreTheme callable as-is (already editor+ gated, embeds the candidate theme and returns a calibrated uniqueness score plus the top-3 closest past themes with dates). Supports the existing excludeDate parameter for a theme already saved on the Sunday being worked on.
- oos_get_scripture_heatmap is a new thin wrapper reading the scripture_usage collection (reference, use count, last used date). Same shape and pattern as getHymnIndex; today this data is only read client-side on the Analytics page, with no callable wrapping it.
- oos_update_liturgy is a new write tool. It takes a Sunday's date and a partial set of liturgy fields only: theme, key verse, the seven hymn slots, and the five scripture/text fields (Call to Worship, Call to Confession, Assurance of Pardon, Scripture Reading, Sermon, Benediction). Explicitly out of scope: person-assignment fields such as Preacher, Service Leader, Music Leader, prayer leaders, and baptism candidates, since assigning those needs a find-this-person tool this ticket does not build.

Write-back behaviour: the assistant is a placer, not a decision-maker. It proposes picks conversationally using the read tools above, and only calls oos_update_liturgy once the editor has agreed to the specific values; the MCP client's own tool-call approval prompt is the human-in-the-loop gate, so no separate custom confirmation UI is built. The write merges only the fields it is given into that Sunday's document; it never overwrites the whole record, reusing the same partial-merge behaviour the Order of Service editor itself already relies on (ADR-0034: a Sunday saves the fields you changed).

Shared logic, not a new shape: the exact liturgy field shape and merge semantics already exist as pure, already-exported functions in the Order of Service editor's own code (the field map, and the functions that flatten a service for saving, pick which fields belong to a save, and apply one field's new value by path). The relevant subset is promoted into the functions layer's shared-logic folder the same way two other features (usage-stats tracking, theme-similarity scoring) already promoted their own pure logic, so the write tool can never produce a shape the real editor UI wouldn't, and automatically stays correct if the liturgy shape changes later.

## Acceptance Criteria
- [ ] An editor (or elder, admin, or super_admin) can connect Claude Desktop or Claude Code to the MCP server from any machine, completing a real sign-in with their existing site email and password.
- [ ] A member-level or signed-out user cannot complete the connection; the sign-in step itself refuses them.
- [ ] oos_get_hymn_history returns the current hymn list with times-played and last-played-date for each hymn.
- [ ] oos_score_theme returns a uniqueness score and the top-3 closest previously-used themes for a given candidate theme text, matching what the existing Order of Service editor's theme-similarity feature shows.
- [ ] oos_get_scripture_heatmap returns usage count and last-used date for scripture references that have been used before.
- [ ] oos_update_liturgy writes only the liturgy fields it is given to the named Sunday's record, leaving every other field on that record, and every other Sunday's record, untouched.
- [ ] Calling oos_update_liturgy with a non-liturgy field, such as attempting to set Preacher, is rejected.
- [ ] A change made through oos_update_liturgy is visible immediately on the Order of Service editor page for that Sunday, and correctly updates hymn/scripture usage stats and the theme-similarity corpus exactly as a manual edit through the editor would.
- [ ] All four tools are named with the oos_ prefix.

## Testing Decisions
- The promoted shared liturgy-merge logic is tested directly as pure functions, no mocks, matching how usage-stats-core.js and theme-similarity-core.js are already tested.
- oos_update_liturgy and oos_get_scripture_heatmap are tested against the Firestore emulator, matching the existing pattern used for other server-side Cloud Functions logic (for example family-plan-server.test.js). Coverage specifically includes: a member-level caller is refused, a partial write leaves untouched fields alone, and a write correctly triggers the existing usage-stats and theme-similarity triggers.
- The MCP protocol handling itself and the OAuth bridge are not unit-tested to the same depth; their correctness is verified by actually connecting a real MCP client (Claude Desktop or Claude Code) to the deployed server, since what matters is whether the real handshake works end-to-end, not internal plumbing.

## Out of Scope
- Person-assignment fields on the Order of Service (Preacher, Service Leader, Music Leader, prayer leaders, baptism candidates), deferred until a find-this-person tool exists.
- Any capability beyond Order-of-Service building (People directory, Roles, Calendar, etc.). This ticket is deliberately scoped to one capability group, though the oos_ naming convention is chosen specifically so those can be added later without rework.
- Any change to the existing Order of Service editor UI, getHymnIndex, or scoreTheme themselves; this ticket wraps and reuses them, it doesn't modify their existing behaviour.
- A custom in-conversation confirmation UI for the write tool; the MCP client's own existing tool-call approval prompt serves this purpose.

## Further Notes
- ADR-0038 (docs/adr/0038-mcp-server-hosted-on-firebase-authenticates-through-firebase-auth.md) records the hosting/auth decision and why the Admin SDK credential approach was rejected.
- Relevant precedent: ADR-0034 (partial-field-merge semantics) and ADR-0037 (server-side theme scoring, advisory-not-authoritative philosophy). This feature follows both.

---

## Sub-tasks (approved breakdown, not yet built)

Six sub-tasks, in dependency order. Each becomes a JIRA sub-task under MS-262
once Jira is reachable (`parent` = MS-262), using the standard sub-task
template (What to build / Acceptance criteria / Parent Feature). AFK/HITL
classification is load-bearing — see `/to-issues`'s own notes on why.

### 1. Promote liturgy merge logic — **AFK**
**What to build:** Extract the liturgy-relevant subset of
`CANONICAL_MAPPING`, `flattenServiceForSave`, `pickSaveFields`,
`applyFlatFieldPath`, and `changedFieldPaths` out of
`public/service-builder.js` (lines ~1-260) into a new
`functions/shared/liturgy-save-core.js`, wired into `functions/` via the
existing `scripts/sync-shared-to-functions.js` mechanism (same pattern as
`usage-stats-core.js` / `theme-similarity-core.js`).
**Acceptance criteria:**
- [ ] The promoted module is pure — no Firebase/Firestore imports, just data in/data out.
- [ ] Tested directly as pure functions, no mocks, covering the merge-by-field-path behaviour (ADR-0034).
- [ ] `public/service-builder.js`'s own behaviour is unchanged (it still owns the UI-facing copy or now requires the shared module — implementer's choice, as long as there's one source of truth).
**Blocked by:** none.
**User stories covered:** 5, 6, 10.

### 2. Build `oos_update_liturgy` callable — **AFK**
**What to build:** A new Cloud Functions v2 callable wrapping module 1's
merge logic. Accepts a `services/{date}` doc id plus a partial liturgy-field
object (the 2 top-level fields + 7 hymn slots + 5 text fields listed in the
PRD). Editor+ gated, mirroring `scoreTheme`'s existing permission check.
Rejects any field outside the liturgy allowlist.
**Acceptance criteria:**
- [ ] A member-level (or signed-out) caller is refused.
- [ ] A partial write updates only the given fields; every other field and every other Sunday's document is untouched.
- [ ] Attempting to set a non-liturgy field (e.g. `preacher`) is rejected.
- [ ] The write correctly triggers the existing usage-stats and theme-similarity Firestore triggers, same as a manual edit.
- [ ] Tested against the Firestore emulator, matching `family-plan-server.test.js` / `membership-track-server.test.js` precedent.
**Blocked by:** #1.
**User stories covered:** 5, 6, 10.

### 3. Build `oos_get_scripture_heatmap` callable — **AFK**
**What to build:** A new thin Cloud Functions v2 callable reading the
`scripture_usage/{reference}` collection (`count`, `lastUsed`), same shape
and pattern as `getHymnIndex` (`functions/index.js` ~line 123). Today this
data is only read client-side by `usage-stats-store.js` / `analytics.html`.
**Acceptance criteria:**
- [ ] Returns usage count and last-used date for every scripture reference on record.
- [ ] Tested against the Firestore emulator.
**Blocked by:** none.
**User stories covered:** 4.

### 4. Build the MCP server endpoint, wiring up all 4 `oos_*` tools — **AFK**
**What to build:** A new `functions/mcp-server.js`, exported as one more
Cloud Functions v2 HTTP endpoint using MCP's Streamable HTTP transport,
stateless per request. Defines the 4 tools:
- `oos_get_hymn_history` — wraps existing `getHymnIndex` as-is.
- `oos_score_theme` — wraps existing `scoreTheme` as-is, including `excludeDate`.
- `oos_get_scripture_heatmap` — wraps #3.
- `oos_update_liturgy` — wraps #2.
**Acceptance criteria:**
- [ ] All 4 tools are registered and named with the `oos_` prefix.
- [ ] Each tool call is routed through the calling user's own Firebase identity (not an Admin SDK credential) — plumbing only; the identity itself comes from #5.
- [ ] `oos_get_hymn_history` / `oos_score_theme` require no behavioural change to the underlying callables.
**Blocked by:** #2, #3.
**User stories covered:** 1, 2, 3, 4, 9.

### 5. Build the OAuth bridge (`/authorize` + `/token`) — **HITL**
**What to build:** Per ADR-0038 — an `/authorize` endpoint that is a plain
Firebase Auth email/password sign-in page (mirroring `public/login.html`
line 150, the only sign-in method this site uses), and a `/token` endpoint
that issues an MCP-shaped token carrying the signed-in user's Firebase
identity and permission level.
**Acceptance criteria:**
- [ ] An editor/elder/admin/super_admin completes a real email/password sign-in and receives a working token.
- [ ] A member-level or signed-out user cannot complete the flow.
- [ ] The issued token is scoped to that user's own Firebase identity (verifiable — not a shared/service credential).
**Blocked by:** none (can build in parallel with #1-#4; #4's server needs to sit behind it before end-to-end testing).
**User stories covered:** 1, 7, 8.
**Why HITL:** this is the feature's actual security boundary. The design is already settled (ADR-0038), but an auth-bypass mistake here is the costliest possible failure mode on this ticket, so the built code should get a human review before anything deploys — not just automated coverage.

### 6. Connect a real MCP client end-to-end and verify the handshake — **HITL**
**What to build (verify, not build):** Deploy #4 and #5. Connect a real
Claude Desktop or Claude Code client as a real editor-level account. Confirm
sign-in → token → all 4 tools work against real data, and that a
non-editor account is refused at sign-in.
**Acceptance criteria:**
- [ ] All 9 PRD acceptance criteria pass against the deployed server with a real client connected.
**Blocked by:** #4, #5.
**User stories covered:** all (this is the ticket's full acceptance pass).
**Why HITL:** the PRD's own Testing Decisions section rules this out as agent-only — it explicitly requires a human's own Claude Desktop/Code and their own site login, since what matters is the real handshake, not internal plumbing.
