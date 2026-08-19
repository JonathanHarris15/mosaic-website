# ADR 0036: A Notification Picks Its Own Channel, and Delivery Is Best Effort

## Status
Accepted. Supersedes ADR-0009's assumption that a text is the only outbound channel, and renames the collection that ADR names.

## Context

Mosaic can reach a person exactly one way today: a text through Textbelt, sent by the pastoral-prayer scheduler, which calls the provider directly (`sendPrayerRequestTexts` / `sendPrayerRequestNow` in `functions/index.js`). Everything else that ought to reach somebody — a [[Trade]] offer, a nudge at somebody still Unconfirmed, the prayer ask itself — either does not reach them or would have to learn Textbelt's API for itself.

MS-189 adds push. That immediately raises the question the SMS-only world never had to answer: **who decides which channel a message goes by?**

Two facts constrain the answer, and they are not symmetric.

1. **Push needs an account and a device; a text needs a phone number.** A push token belongs to a signed-in User. A Person with no [[Linked User]] — which on day one is nearly everybody, and permanently is a real slice of the church — can never be pushed to. So a caller choosing "send a push" is a caller who will silently fail to reach most of the congregation.

2. **You cannot tell whether a push arrived.** FCM reports whether it *accepted* the message, not whether a human saw it. A revoked permission, a flat battery, a phone in a drawer and a delivered notification are indistinguishable from the server. The obvious fix — wait for the app to acknowledge, then fall back — builds a whole ack channel and a timer to learn something the server still cannot trust.

An earlier draft of MS-189 also carried recorded SMS consent as a send-time gate. That was cut on 2026-08-14; it is not part of this decision and the text channel sends as it always has.

## Decision

### 1. One send path, and the caller never names a channel

Every feature calls one thing — *tell this Person this thing* — passing who, what, and where it leads. The path decides: **push if the Person's Linked User holds a live [[Device token]], a text if not.**

The existing prayer-request senders are **refactored onto it** rather than left alongside it. Two send paths would kill the rule on the day it was written, and the escalation in §2 only works if one piece of code knows how the first message went out.

### 2. Delivery is best effort, and the feature's own second chance is the fallback

No delivery receipts, no acknowledgement channel, no retry timer:

- **No token** → text now.
- **A token the provider rejects** (`UNREGISTERED`, `INVALID_ARGUMENT`) → delete that token, text now.
- **A token the provider accepts** → the send is finished. We do not ask again.

What makes this sufficient is that the features which matter already re-ask on their own. Pastoral prayer sends an initial at five days out and a **reminder at three days if the request is still empty** (`prayerRequestAction`). So the initial goes by push and the reminder by text, and an unanswered request turns out to be a better failure signal than any receipt: it measures the thing we actually care about rather than the thing the transport can report.

A feature with no natural second chance gets one message on the best channel available and no more. That is a real limit, stated rather than papered over.

### 3. A Notification carries a URL

The payload names its destination as a URL, not as a screen name or a message id. It is the only identifier a push, a text and a browser all understand: the app parses the path into a route through the mobile shell's existing `nav()`, and the text carries the same link because a text has no shell to talk to.

**A Mosaic link in a text opens the browser, not the app.** Universal Links and App Links would change that, and they are a **deliberate non-goal** — not a deferred phase. They cost association files served from the domain, entitlements on both platforms and a store round-trip before they can even be tested, and they buy polish rather than reach.

### 4. `sms_messages` becomes `notifications`

ADR-0009 logs every outbound text to `sms_messages` keyed by `textId`, because an inbound reply names nothing else. That log is now one channel's worth of a bigger question — *did we tell them?* — which must have one home. The collection is renamed and gains a `channel`; reply correlation demotes from the log's reason for existing to a field on an SMS row.

Everything ADR-0009 decided about **trust** is untouched: the HMAC signature on `smsInbound` is still the boundary, and the log is still routing only.

### 5. The OS prompt is asked once, behind our own explainer

iOS grants one permission prompt per install. Denied is permanent short of talking somebody through iOS Settings. So Mosaic shows its own explainer on the phone home — after sign-in, once the User is linked — and only then triggers the OS prompt, with a permanent toggle in settings as the way back.

Mosaic keeps **no notification preferences of its own** beyond that. With one feature sending Notifications, per-kind opt-outs are a settings screen with one row on it. Revisit when there are kinds worth choosing between.

## Alternatives Considered

**Let each caller pick the channel.** Rejected: every caller then has to know who owns a phone with the app on it, and gets it wrong for anybody who has not installed it. The whole value of a single path is that a feature can stop asking.

**Acknowledge-then-fall-back** — push, wait, text if the app never confirms. Rejected as machinery bought for a signal the features already have. It also picks an arbitrary wait, and the right wait differs per message: hours for a prayer ask, minutes for a Saturday-morning Trade.

**Send both channels always.** Rejected — it spends Textbelt credit on every message and trains people to ignore both.

**Web push as well as the app.** Rejected for now: a service worker, a second permission model, and on iOS Safari it only works once the site is added to the home screen. A desktop browser is not where somebody is when they need telling.

**A separate `push_messages` log** beside `sms_messages`. Rejected — "did we tell them?" would then have two places to look, and the answer would depend on guessing the channel first.

## Consequences

- **Working code that sends real messages gets refactored.** The prayer senders move onto the new path, which wants tests written first: a bug here is a message the church does not send, and nothing on screen reports it.
- **A live collection is renamed.** `sms_messages` has data in it and `smsInbound` reads it for routing, so the rename needs a migration and a rules change, not a find-and-replace.
- **The first push cannot be verified without shipping.** APNs sandbox and production behave differently, so "it worked in debug" proves little. MS-189 is done when it is submitted to both stores, which puts a review wait inside the ticket.
- **A Person with no token and no phone number is unreachable**, and this is the one delivery fact surfaced to an editor. Nothing else is: a per-message log viewer is a screen nobody opens.
- **Push tokens die on sign-out.** Not tidiness — leaving one behind puts the previous user's pastoral prayer on the next user's lock screen.
