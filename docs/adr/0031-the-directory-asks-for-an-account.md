# ADR 0031 — The directory asks for an account

**Status:** Accepted
**Date:** 2026-08-14
**Resolves:** the directory question filed but never raised by [ADR 0018](0018-event-occurrences-assignments-and-visibility.md) §Consequences and [ADR 0020](0020-fairness-is-a-weekly-solve.md). Changes the premise, not the conclusion, of [ADR 0023](0023-away-advises-a-person-and-refuses-a-program.md). Touches [ADR 0007](0007-prayer-request-one-time-generation.md) and [ADR 0017](0017-shared-relationship-types-elder-controlled-editor-disclosure.md).

## Context

`people/{personId}` was `allow read: if true`. Every Person record — **name,
email address, phone number, home address** — was readable by anybody who could
reach the Firestore endpoint, which is anybody: the project's API key ships in
the browser, because that is what an API key is for. So were `families` (who is
married to whom, whose children are whose), `people_tags`, each Person's
`involvement`, and each Person's `pastoral_prayer_history`.

Nobody decided this. It is the shape a Firebase project starts in, and the app
grew around it.

It was then **accepted twice as a premise**, each time to justify something much
smaller than itself:

- **ADR 0018** accepted that an occurrence's `participantIds` discloses the
  roster as ids, _"on the grounds that the entire directory … is already
  world-readable, so this discloses very little that is not already out"_ — and
  said in the same breath that this is an argument the app's read posture is
  loose, not that the feature should be, and that the directory question was
  filed separately.
- **ADR 0020** made the identical trade for a Role's `allowlist`, and called it
  _"a second instance of the same smell."_

Neither filing happened. The reasoning was reused with nothing tracking the debt.

**ADR 0023 was the first that could not reuse it.** An Away is a stretch of days
somebody will not be at home. A name, an address and "away 10–24 August" on one
world-readable record is not directory data — it is a notice that a particular
house is empty on particular dates. So Away went into a subcollection with its
own rule, and its test asserted the Person record was *still* world-readable, on
purpose, so that whoever eventually closed this would be sent back to re-read the
Away decision rather than discover it.

This is that closing.

## Decision

**The directory is for people who have an account. Nobody else.**

Every directory collection moves from `allow read: if true` to
`allow read: if isSignedIn()`:

| Path | What it discloses |
| --- | --- |
| `people/{personId}` | Name, email, phone, home address |
| `people/{personId}/involvement` (and its collection group) | What a named person served, and when |
| `people/{personId}/pastoral_prayer_history` (and its collection group) | Which named person was prayed for, and when |
| `families/{familyId}` | Marriages and children |
| `people_tags/{tagId}` | The directory's tag vocabulary |

Writes are untouched. This changes who may **read**.

### 0. `request.auth != null` is not an account, and on this project that is the whole boundary

This shipped once written that way and it was very nearly decorative.

**Anonymous sign-in is enabled on this project.** The API key ships in the
browser, because that is what an API key is for. One POST to the Identity
Toolkit carrying nothing but that key returns a valid Firebase token — no email,
no password, no sign-up form, no record anybody would read as a person. That
token satisfies `request.auth != null`. Verified against production: a directory
read as an anonymous token came back `200` with the congregation's names in it.

So the rule asks `isSignedIn()`, which is `request.auth != null` **and** the
token's sign-in provider is not `anonymous`.

Nothing in the app has ever called `signInAnonymously`. Every client already
treats an anonymous session as signed out — `auth.js`, `login.html`, `main.js`,
`profile.js` and `mobile/data.js` all test `!user.isAnonymous`. This is the rules
file catching up with what the app always believed.

**Anonymous sign-in should also be turned off in the Firebase console**, since
nothing uses it. The rule holds either way, and that is the point: a boundary
that depends on a console toggle is a boundary somebody can flip off without
touching the repo, and no test would notice.

### 1. The floor is an account, not a rank — and that is the load-bearing part

`isMember()` is the rule this obviously wants and it is the wrong one.

A brand-new account has **no Person and no rank**. The way it gets one is the
[Directory Request](0027-a-directory-request-is-how-you-change-your-own-record.md)
flow: somebody signs up, searches the directory for their own name, and says
*"that is me."* Gate the directory on membership and you have broken the flow
that **makes people members** — the new person searches, finds nothing, and the
only door in is an editor noticing them by other means.

So the floor is deliberately low, and it should cost an argument to raise. There
is already a precedent at exactly this height: a [Directory
Photo](0029-a-directory-photo-is-self-editable.md) is `allow read: if
request.auth != null` in Storage, and has been since it was built.

### 2. Per collection, not per field

The tempting middle path — names public, contact details closed — is not
available. **Firestore has no field-level read rules.** Buying it would mean
splitting every Person into a public document and a private one, with every
writer, every projection and every query taught about both.

That is a large, permanent complication, and the thing being bought is a public
audience nobody has asked for. Nothing in the app renders a Person's name to a
signed-out visitor. A church directory is a directory *of the church*.

### 3. What stays open, and why that is the real constraint

The public read posture was not a mistake in general — it is what makes the
congregant-facing Sunday material work without a login, and that must survive:

`services`, `hymns`, `roles`, `style_presets`, `page_templates`,
`guide_templates`, `guide_assets`, the Sunday Service series, and public Events.

A visitor can still find out when the church meets, what is being sung, and read
the printed guide. `services` carries denormalised names — the preacher, the
service leader — and that is the one place a name still reaches an anonymous
reader. That is the booklet working as designed: one name a week, not a
directory.

### 4. What this does to the two ADRs that leaned on it

Both improve, without either being reopened. `roles.allowlist` and
`participantIds` still hold Person **ids** — and those ids no longer resolve to
a human being for an anonymous reader. That is precisely the improvement ADR 0018
and ADR 0020 each said they wanted and could not have.

### 5. What it does to Away

Nothing, and that is the point. Away was narrower than the world; it is now
narrower than the directory. Editors and the person themselves, still, because a
member has no business knowing who is on holiday. The premise moved a rung and
the conclusion did not.

## The gap this leaves open, and the decision to leave it

**Sign-up is self-service.** The login page offers Create Account to anybody who
reaches it, and the rules let a new account write its own `users/{uid}` at
permission level `viewer`. Nobody approves it and no email is verified.

So this ADR does not put the directory behind a wall. It puts it behind a
sign-up form.

**That was raised as MS-240 and decided: sign-up stays open** (Jonathan,
2026-08-14). So the boundary the church is keeping is *anybody may have an
account, and an account is what the directory asks for* — in practice, an email
address and a minute.

Stated plainly so nobody later reads it as an oversight. What it buys: the
self-service door stays open, so somebody new can sign up, find themselves and
raise a Directory Request without an editor noticing them first; every reader is
a row in `users` that an admin can see and disable, where an anonymous scraper
left no trace at all; and there is no approval queue for anybody to staff. What
it does not buy is a wall.

Revisit if that trade stops holding — the likeliest triggers are somebody
actually scraping it, or the directory growing something more sensitive than
contact details. The options that were on the table: invitation-only, admin-created
accounts, a domain restriction, or approval-before-access.

Note the asymmetry with §0, which is not a contradiction. An *email address* is a
deliberate, chosen cost the church is happy with. An *anonymous token* is not a
cost at all — it is one HTTP request that anybody's script can make, and nothing
is left behind to look at afterwards. Leaving the front door unlocked is a
decision; leaving the back window open is a bug.

## Consequences

- The five directory collections need a signed-in reader. No migration, no data
  change, and it is one predicate per rule to reverse.
- `test/firestore-people-directory-rules.test.js` pins the boundary in both
  directions: it fails if a rule drifts back to `if true`, **and** if one is
  "tightened" to a rank. The second is the likelier mistake.
- The Services page is viewable signed out and used to load the whole directory
  on init for the editor's person picker. It now waits for the auth state and
  skips the load for an anonymous visitor.
- Service Analytics is now a door in front of a lock rather than a door in front
  of nothing — though the two sit at different heights, so its own screen is
  still what stops a member.
- ADR 0007's premise changes and its decision does not: `pastoral_prayer_history`
  is no longer world-readable, but the Prayer Request **text** still cannot live
  there, because the collection is readable by any account and the text is for
  elders.
- ADR 0017's rejected alternative gets weaker still — answering marriage from the
  "already world-readable" `families` graph was rejected on other grounds, and
  `families` is not world-readable any more either.
