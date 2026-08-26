# ADR 0040 — Nobody reads a password, so recovery has to exist first

**Status:** Accepted
**Date:** 2026-08-26
**Resolves:** MS-241. Continues the read-posture work of [ADR 0031](0031-the-directory-asks-for-an-account.md) — that one closed the directory to the internet, this one closes a hole inside the door.

## Context

Mosaic wrote every user's password, **in plain text**, into their own
`users/{uid}` document. The line carried its own explanation:

```js
password: this.password, // Storing for admin visibility
```

Four places did it: sign-up, the admin create-user callable, and both password
changes. The admin profile page then rendered, for every account in the
directory, a panel headed **Password Visibility** — a masked box, an eye icon
that revealed the password in cleartext, and a button that copied it to the
clipboard. A second comment recorded that this was `// Storing for admin
visibility as requested`.

Firebase Authentication had held a properly hashed copy the whole time. That is
the copy every sign-in actually used. This was a second, readable one, made on
purpose.

**The cost of keeping it reached well past this app.** People reuse passwords, so
a readable list of this congregation's passwords is a readable list of their
email accounts and their banking. It is also the one field here nobody could
consent to: a person typing a password into a login box is entitled to assume it
is not being filed. `public/privacy.html` promised account holders "a securely hashed
password", which was false.

### Why it had not simply been deleted

Two reasons, and the ticket that filed this bug was wrong about both.

**It was load-bearing.** `updateUserPasswordSelf` authenticated with it:

```js
const userData = userDoc.data();
if (userData.password !== oldPassword) {
    throw new Error("Incorrect current password.");
}
```

Its doc comment said the quiet part — *"since we store it in Firestore, we can
verify it here too."* Deleting the field broke changing your own password.

**And it was the only account recovery that existed.** There was no password
reset anywhere in the application: no "Forgot password?" link, no reset email,
not on the web login, not on mobile, not on the MCP sign-in page. An admin
reading somebody their password off that panel was the *whole* of how a
locked-out user got back in.

So the field was not carelessness. It was a real answer to a real problem, in an
app that had no other answer. That is exactly why deleting it alone would have
been wrong, and why it kept not being deleted.

## Decision

**Nobody reads a password. Not an admin, not a cloud function, not us.**

Three commitments, and the order between them is part of the decision.

### 1. Recovery ships before removal, never after

A "Forgot password?" link that sends a Firebase reset email lands **first**. At
no point may the application be in a state where a locked-out user has no way
back in.

This is a sequencing constraint, not a preference. Removing a bad solution
without supplying a good one is how the bad one comes back — somebody would have
re-added the field the first week an elder could not sign in.

### 2. A current password is proved to Firebase, not to us

Changing your own password re-authenticates against Firebase Auth and calls
`updatePassword` from the browser. `updateUserPasswordSelf` is deleted rather
than trimmed: with the string comparison gone it did nothing the client cannot do
better, and a deployed endpoint that still expected the field would be a standing
reason to keep writing it.

### 3. Admins set, and never read

`updateUserPasswordAdmin` stays — setting somebody's password is a privileged act
that belongs server-side, and it never needed to *read* one. The Password
Visibility panel goes.

So an admin helping somebody who is locked out sends them a reset link, or sets
them a new password. They cannot be told what the old one was, because nobody
can.

### 4. A reset answers identically whether or not the account exists

`auth/user-not-found` returns the success message, deliberately.

The login page is open to the whole internet. A distinct "no account with that
address" makes it an oracle: type addresses at it and learn which ones belong to
this congregation. For a church that is a list of who attends, handed to anybody
who asks. Malformed input and rate limiting *may* be reported — they describe
what the request did and disclose nothing about who has an account.

This is the same instinct ADR 0031 acted on: a thing that looks like a small
disclosure is a directory when you can ask it repeatedly.

## Alternatives considered

**Keep the panel, drop the field.** Not a real option once examined: with nothing
writing the field the reveal box renders empty, so the choice was only ever
between removing a dead control now or later.

**Keep admin visibility and accept the risk.** The capability was explicitly
requested, so this deserved asking rather than assuming, and it was signed off on
2026-08-26. What decided it: the admin's actual need is *get this person back
into their account*, and a reset link serves that need strictly better than
reading a password aloud. It works at 11pm, it needs nobody else, and it proves
the person controls the mailbox — which reading a password to whoever is on the
phone does not.

**Ship reset as its own ticket first, then remove the field.** Cleaner cards, but
it leaves the liability live across two releases for no benefit, and the removal
ticket cannot be built or shipped alone anyway.

**Hash the stored copy instead of deleting it.** A second hash of the same secret,
kept for nobody to read, is strictly worse than no copy: all of the storage risk,
none of the admin capability it existed for.

## Consequences

- **Admins lose a capability they had and asked for.** They keep setting
  passwords and gain a reset link to point people at. Signed off; no
  announcement judged necessary.
- **The deletion is one-way.** The stored copies cannot come back, which is the
  point — and why the cleanup pass over `users` is run by a person after reading
  a dry run, not by an agent (MS-300 writes it, MS-301 runs it).
- **Stopping the writes did not remove the liability.** Every copy written before
  this is still in Firestore until that pass runs. The board keeps them as
  separate sub-tasks so "we fixed it" cannot mean "we stopped making it worse."
- **The privacy policy becomes true**, and is corrected once it is — not before.
- **A guard has to be cheap to keep.** The field was written in four places and
  three were copies of the first. A source sweep reads the object literal handed
  to each Firestore write, rather than looking for the word "password" near the
  word "users" — the blunt version flagged an Alpine field, a string literal and
  the two `admin.auth()` calls that are the *correct* way to handle a password,
  and a test that cries wolf about correct code gets deleted by the next person.
- **`users` still has no rule constraining which keys a document may carry**, so a
  stale cached client could reintroduce the field. Tightening that is MS-302.
