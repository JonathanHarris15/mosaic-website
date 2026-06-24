# ADR 0009: Prayer Request SMS — Reply Correlation and Anti-Spoofing

## Status
Accepted

## Context
A pastoral-prayer subject is texted (via Textbelt) to ask what they'd like the church to pray about, and their reply must become that Sunday's Prayer Request — written to the elder-only `people/{id}/prayer_requests/{serviceDate}` record described in [ADR 0007](./0007-prayer-request-one-time-generation.md).

Textbelt delivers an inbound reply as an HTTP POST to a single public webhook (`smsInbound`) carrying `{textId, fromNumber, text}`, where `textId` is the *original outbound* message's id. Two problems follow:

1. **Correlation.** A reply names neither person nor service — only the `textId` of the message it answers. The webhook must turn that into "this is Jane's request for 2026-06-28."
2. **Trust.** The webhook is a public, unauthenticated endpoint. Anything that can POST to it could forge a "reply" and inject prayer-request content for an arbitrary person.

The webhook is also shared: the same endpoint receives replies to admin **test** sends (which belong in the Admin Dashboard's `sms_test_replies` stack), not just prayer-request replies.

## Decision
**A server-written outbound log keyed by `textId`, plus HMAC signature verification as the trust boundary.**

1. **Every outbound text is logged** to `sms_messages` with `{textId, purpose, personId, serviceDate, kind}` (`purpose` ∈ `prayer_request` | `prayer_request_thankyou` | `test`). The log is written only via the admin SDK; clients may read it (admins) but never write it.
2. **`smsInbound` verifies Textbelt's `X-textbelt-signature`** (HMAC-SHA256 over `timestamp + raw body`, keyed by the API key) and rejects stale timestamps before doing anything else. An unsigned or mis-signed POST gets `401` and is never stored.
3. **Routing is by the logged `purpose`.** The verified reply's `textId` is looked up in `sms_messages`; a `prayer_request` hit fills that Sunday's request (once) and sends the thank-you, while a `test` hit or an unrecognized id falls through to the `sms_test_replies` stack. Because both the initial and the reminder are logged with the same `{personId, serviceDate}`, a reply to either resolves identically.

## Alternatives Considered

**Phone-number matching** (the original backup approach): look up the person by the last 10 digits of `fromNumber`. Rejected — it's ambiguous (which upcoming service? which of two people sharing a landline?) and unnecessary once a reliable `textId` log exists. `textId` is always present in Textbelt replies, so the precise lookup is strictly better.

**`textId` as the trust guard** (also the backup approach): treat "this `textId` matches an outbound we sent" as proof of authenticity, with no signature. Rejected — `textId`s are guessable/observable, so it is not a real anti-spoofing measure. HMAC signature verification is the actual trust boundary; the log is then used only for routing, not trust.

**Storing the `textId` on the `prayer_requests/{serviceDate}` doc** instead of a separate log, and querying for it on inbound. Rejected — it needs a collection-group query with an index over a field, leaks the linkage into the elder-only request doc, and has no home for non-prayer (test) sends. A dedicated log keeps one correlation path for every kind of outbound text and doubles as an audit trail.
