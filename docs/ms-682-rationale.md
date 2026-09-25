# MS-682 — Push notifications admin tab (rationale)

## Alternatives considered and rejected

**Client-side Firestore for device tokens.** Rejected. ADR-0036 keeps `push_tokens` owner-only; widening rules so admins could read tokens in the browser would expose full FCM tokens to any compromised admin session and duplicate the trust boundary. Admin SDK callables with server-side masking is the chosen seam.

**A separate `push_messages` log or parallel schema.** Rejected (also ruled out in ADR-0036). One `notifications` collection with a `channel` field keeps “did we tell them?” in one place.

**Bulk send / “notify everyone” controls.** Rejected by product guardrails. The tab is observability plus revoke and a self-targeted test send only.

**Acknowledge-then-fallback or delivery receipts.** Rejected in ADR-0036; the admin flow diagram documents the live best-effort path instead of inventing a second mechanism.

**Letting the test-send callable accept a target uid or token from the client.** Rejected. The handler always uses `request.auth.uid` so an admin cannot push arbitrary users from the browser.

**Tabs that hide Service Guide behind messaging.** Rejected. Service Guide stays in the SMS & messaging tab with existing tools; only push-specific surfaces move to the new tab.

**Inlining the entire push UI in one giant callable.** Rejected. Static registry and flow live in `notification-admin-core.js`; sent history uses admin-readable `notifications` client-side; only token inventory, revoke, test send, and overview aggregation need callables.

**Deploying Hosting before new callables and indexes.** Rejected per MS-545 practice. The standing workflow `--only` set gains the four admin callables and `firestore:indexes` before Hosting that depends on them.
