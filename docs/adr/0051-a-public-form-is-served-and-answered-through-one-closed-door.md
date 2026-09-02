# ADR 0051 — A public form is served and answered through one closed door

**Status:** Accepted
**Date:** 2026-09-02
**Ticket:** MS-360

## Context

MS-173 wants forms the public can fill in — a waiver, a counselling intake, a
sign-up sent to somebody outside the church. That means a person with **no
Mosaic account** must be able to read a form's questions and write their
answers.

Nothing in this app has ever let that happen, and the exclusion is deliberate.
ADR-0031 closed the directory to `isSignedIn()`, and that helper does not mean
`request.auth != null` — it explicitly rejects an anonymous token, because
anonymous sign-in is enabled on this project and one POST with the public API
key mints one. MS-197 shipped the directory open to the internet the first time
precisely by writing the looser test. The comment above `isSignedIn()` in
`firestore.rules` runs twenty lines for that reason.

So the obvious implementation — mark a public Form Template `allow read: if
true`, and let a signed-out browser talk to Firestore directly — is the exact
shape of the bug this codebase has already paid for once.

There is a second, quieter problem with it. A rules read is not just permission
to read *this* form; it is permission to read the collection, which makes every
public form on the site enumerable by anybody who thinks to ask. A poll sent to
forty people becomes a poll the whole internet can find.

## Decision

**A signed-out person never touches Firestore. One Cloud Function hands out the
questions and takes the answer, and `firestore.rules` stays shut.**

Concretely: a single `onCall` function (v2, the same shape every other callable
here uses — an unauthenticated caller simply arrives with no `request.auth`)
answers two things:

- *give me the form at this id* — returning the title and questions, and only
  when the template's rung is `public` and it is still open.
- *here is my answer* — validated against the template server-side, written
  with admin credentials.

No rule in `firestore.rules` is loosened. A Form Template and a Response are
readable and writable by editors and above through the ordinary ladder, and by
nobody else. The public path is not a hole in the wall; it is a door with
somebody standing in it.

**A public form is therefore link-only and unlisted.** You can fetch a form
whose id you were sent. You cannot ask what forms exist, and an id is not
guessable.

**Public submissions pass an invisible bot check.** An open, unauthenticated
write endpoint with no throttle is a spam sink, and the day it matters is a
public day. App Check is invisible to a real browser, which keeps the cost off
the person filling in a waiver on their phone.

## Consequences

**The rules file gains nothing, which is the point.** A reviewer looking for
where public access was granted will not find it in `firestore.rules`, because
it was not granted there. It is in one function, which is a place a person can
read end to end.

**The function is now the only description of what a public answerer may see.**
That is a real cost: rules are declarative and this is code. It is accepted
because the alternative puts the same logic in a language that cannot express
"only when the form is open," and would have to be paired with a rules read
anyway.

**Validation moves server-side and stays there.** Required questions, closed
forms, and the one-response-each rule are all checked where the write happens
rather than in the browser, because a browser answering a public form is not
something we control at all.

**A signed-in member goes through the same door.** Two paths — one through
rules, one through the function — would be two places for "is this form open"
to disagree. The rung is checked inside the function for everybody.

**App Check must be configured before a public form ships**, not after. It is
listed as an acceptance criterion on MS-360 rather than left as ops work.

## Refinement — what a form's link actually looks like (2026-09-02)

The MS-360 design came back with `mosaicchurch.app/f/monday-food`, and it was
right about the need and wrong about the value.

The need is real: a link that goes in a text message to the whole church is a
thing people see, and an opaque blob looks like phishing. The design also added
a copy-link row on the form page, which is plainly correct — you come back on
Thursday and want the link again.

But a readable slug is a **guessable** slug. Walk `/f/` with a wordlist and you
find forms nobody sent you, which is the enumeration this ADR exists to prevent.
`monday-food` is worse than a guess — it is derivable from the form's own title.

**So: the affordance is taken, the value is not.** A form's link carries a
high-entropy random token (128 bits, base58, e.g. `/f/7bQm2xK9vRt4Lp8sYw3NcF`) —
unguessable, unenumerable, and stable for the life of the form. The copy-link
row stays, and the token is what it copies.

A vanity slug is not forbidden forever, but it would have to be *opt-in per
form and clearly labelled as public*, because choosing one is choosing to be
findable. That is a product decision nobody has made, and it must never be the
default that a form's own title quietly becomes its address.
