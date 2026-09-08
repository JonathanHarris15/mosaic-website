# ADR 0059 — A Task names who must do it, never who it is about

**Status:** Accepted
**Date:** 2026-09-08
**Ticket:** MS-79 (Tasks & Reminders)

## Context

Almost everything else in shepherding hangs off a Person. A Shepherding Note, a
Status Change, a Tag Change, a profile document — each one is *about* somebody,
and is filed on them.

A Task looks like it should be the same. The obvious reading of "follow up with
the Johnsons" is a record filed on the Johnsons, and the assistant's existing
reminder tool already takes a list of People it is about, validates them against
the directory, and stores them.

But a Task is not a record of pastoral care. It is a piece of work that has to be
done, and the only structural question it answers is **who has to do it**. Filing
it against the person it mentions creates a second, weaker link that reads like
the first: a list on Dave's profile that is neither his pastoral history nor his
outstanding care, but an accident of which tasks happened to name him.

## Decision

**The only Person a Task links to is a responsible elder. There is no field for
who a Task is about.**

So:

- A Task carries **assignees**: zero or more elders. Zero is a real state and
  means nobody has picked it up — visible to everybody, not a blank.
- Only elders and super admins can be assigned. The page is elder-only, so
  assigning anyone else hands out work they cannot see. The **Elder Tag** already
  supplies exactly that set of names ([ADR 0013](0013-elder-tag-projection-and-derived-relationships.md)).
- **A Task never appears on a Shepherding Profile**, and finishing one writes
  nothing to the Pastoral Record. A tick is not a pastoral event; a Shepherding
  Note is what exists for the conversation that followed.
- **People may be named in a Task's body**, as ordinary `@` cross-references, and
  they link and read like they do in a Shepherding Note. That is prose, not a
  field: nothing queries it, filters on it, or draws it as a chip.
- **Assignment is not delivery.** Nothing tells an elder a Task landed on them;
  they find out by looking. Telling somebody something is [MS-189](https://methodllc.atlassian.net/browse/MS-189)'s
  single send path, and this becomes one more caller of it rather than a second,
  private way to reach a person ([ADR 0036](0036-a-notification-picks-its-channel-and-delivery-is-best-effort.md)).

## Alternatives considered

**Keep the "people it is about" field the assistant already writes.** Rejected on
the ticket, deliberately: it is a link nobody would maintain and every reader
would misread as pastoral. Its one existing caller — the assistant's reminder
tool — is repointed at assignees instead.

**Derive who it is about from the body's `@` mentions.** Rejected: it makes a
queryable field out of a sentence, so editing prose silently re-files the Task.

**Show open Tasks on the profile of anyone mentioned.** Rejected with the field.
Without a field it would mean scraping the body, and with one it would mean two
kinds of "what is outstanding for this person" on one screen.

## Consequences

- The Tasks & Reminders page filters by **assignee** only. There is no
  person-based view of tasks, and there is deliberately no route from a Person to
  the tasks that mention them.
- `shep_create_reminder`'s `personIds` parameter changes meaning and validation:
  it becomes the responsible elders, checked against the Elder Tag rather than
  against the directory. Any `mentions` already stored are ignored.
- An elder wanting a person-shaped view of outstanding care uses a Filtered View
  over Shepherding Tags, which is what that feature is for.
