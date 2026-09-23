# ADR 0074 — An unsplit name is taken apart only when the parts say the same name

**Status:** Accepted
**Date:** 2026-09-23
**Amends:** [ADR 0069](0069-a-persons-name-is-entered-in-parts.md) (the sentence that existing people are not parsed apart)
**Follows:** [ADR 0070](0070-a-name-fix-is-entered-in-parts.md)
**Ticket:** MS-659

Numbered 0074 so it does not share 0073 with the hymn default-version
decision (MS-661).

## Context

A Person's name is entered as a first name, a last name, and an optional
suffix, and those parts are remembered beside the full name (ADR 0069).
People already in the directory were left as one full name, on purpose:
guessing which word was which had turned "Jonathan Harris Jr." into "The
Jr. Household".

Opening that person in the Membership Directory now shows three blanks.
The heading still has the full name. The blanks are empty, because nothing
was remembered. Typing the name in does stick. Most of the directory has
never been retyped, so an editor meets a blank form for a person the
church has known for years.

## Decision

An existing full name **is** taken apart, once, when the parts say that
same name and not otherwise.

The reading:

- A comma in the name: do not take it apart. "Harris, Jonathan" is not
  guessed into order.
- Trailing tokens in a closed suffix list are the suffix, stored as
  written, and they are not the last name. The list is Jr, Jr., Sr, Sr.,
  II, III, IV, V, VI, VII, VIII, IX, X, 2nd, 3rd, 4th, Esq, Esq., MD,
  M.D., PhD, Ph.D. Match ignores case. Several trailing suffixes stay in
  the one suffix field ("Jr. III").
- After that, two or more words remain: the last is the last name, and
  everything before it is the first name. There is no middle-name field,
  so "Mary Anne Harris" remembers "Mary Anne" as the first name. A name
  particle is not special: "Ludwig van Beethoven" remembers "Ludwig van"
  as the first name. An editor can move a word.
- One word, or a suffix with fewer than two words left beside it: do not
  take it apart. A single word is not marked "no last name". That pass
  means the person has none, and a one-word record might only be
  unfinished. Inventing the pass would also turn a projected Household
  from "The Madonna Household" into "A Household".
- Joining first, last, and suffix with single spaces must equal the
  trimmed full name. If it does not (odd internal spaces, a comma, a
  name that is only a suffix), remember nothing.

The full name is not rewritten. A Household that already has its own name
is not renamed. Someone who already has parts is not read again, even
when the parts and the full name disagree — an editor entered those.

The same reading fills the blanks an editor opens, and the blanks a
member opens for a Name Fix, so the name is visible before any backfill
has run. Saving those blanks without a further edit remembers the parts
and leaves the full name as it was. Blanks that stayed empty still mean
"nothing was entered": saving a phone number on that profile does not
rename the person.

A backfill writes those parts for every person the reading accepts and
who has none yet. It is dry-run until someone applies it. It writes the
parts only.

A Name Fix that was filed as one full string is still not taken apart
(ADR 0070). The phone directory still edits one string. Saving that
string unchanged leaves the parts alone. Saving a different string
clears the parts, and does not invent a new split.

## Consequences

- A projected Household for "Jonathan Harris Jr." can become "The Harris
  Household" once the parts are remembered, because the last name is no
  longer the last word. A stored Household keeps the name it already has.
- Two words are treated as a first name and a last name. A double first
  name with no last name ("Mary Anne") is not distinguished; an editor
  corrects it.
- Booklets that still take the last word of the full name are unchanged
  (ADR 0069).
- The phone's add-a-person form still asks for one name. The next time
  those blanks open on the computer, the reading above fills them when
  it can.
