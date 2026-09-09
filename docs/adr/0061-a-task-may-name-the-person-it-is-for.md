# ADR 0061 — A Task may name the person it is for

**Status:** Accepted
**Date:** 2026-09-08
**Supersedes:** [ADR 0059](0059-a-task-names-who-must-do-it-never-who-it-is-about.md),
in part — its rule about **Assignees** stands untouched; its refusal of a
"who it is about" field is reversed.

## Context

ADR 0059 said a Task names who must do it and never who it is about, and gave
two reasons. The first was that a second Person link would read like the first
and nobody would know which was which. The second was that the link nobody
maintains is the link that lies — a list on Dave's profile that is neither his
pastoral history nor his outstanding care, only an accident of which tasks
happened to name him.

Both reasons were about a link **derived** from prose, or one **duplicating**
the assignee. Neither is an argument against the thing the elders actually
asked for once they had used the page: standing on John Piper's Shepherding
Profile and seeing what the elders still owe *him*.

The profile already does this for documents. A document created in the Document
Library belongs to nobody; one created on a profile carries `ownerPersonId` and
appears there ([ADR 0015](0015-shepherding-profile-documents.md)).
One record, two ways in. Tasks were the odd one out, and the odd one out for a
reason that had stopped being true.

## Decision

**A Task may carry a Subject — `aboutPersonId`, at most one — and that is what
puts it on that Person's Shepherding Profile.**

So:

- **Two Person links, and they answer different questions.** `assigneeIds` is
  who must DO the work and is unchanged: Elders, checked against the Elder Tag,
  zero of them a real state (ADR 0059's rule, which stands). `aboutPersonId` is
  who the work is FOR. "Ring John" is assigned to Rob and about John.
- **The Subject is any member, not only an elder.** An assignee must be able to
  open the page or the work is lost; a Subject opens nothing, and being an
  ordinary member is the whole point.
- **It is optional, and stays optional.** Most Tasks are about nobody in
  particular. Nothing invents a Subject, and nothing derives one from the body's
  `@` cross-references — that half of ADR 0059 holds, for its original reason:
  editing prose must never silently re-file a Task.
- **A Subject hides nothing.** A Task with one is still on the Tasks &
  Reminders page, always. This is where a Task and a profile document part
  company: a profile document is private to that profile until somebody opts it
  into the Library, but work the elders owe somebody is not filed away where
  only that person's profile can find it.
- **The Subject belongs to the commitment, never to one date.** A repeat is for
  the same person every month, so an occurrence reads it through from the series
  and may not override it — the same rule the recurrence itself obeys.
- **A tick is still not a pastoral event.** Finishing a Task writes nothing to
  the Pastoral Record, and the Tasks tab is a tab beside the record rather than
  entries inside it. A Shepherding Note is still what exists for the
  conversation that followed.

## Alternatives considered

**Leave ADR 0059 alone and use a Filtered View.** That is what ADR 0059 told an
elder to do, and it is the right answer for "who needs attention". It is not an
answer to "what have we promised this man", which is a list of work with dates
on it, not a slice of the directory.

**Several subjects, as the old reminder's `personIds` had.** Rejected. One
Subject keeps "whose profile does this appear on" a question with one answer,
and a Task about a household is a Task about a household — write that in the
title. The plural field was the shape ADR 0059 was right to refuse.

**Show a Task on the profile of anyone in `assigneeIds` too.** Rejected, and
this is the confusion ADR 0059 warned about. A Task assigned to John is John's
*workload*; it belongs on his dashboard panel. Drawing both on one tab would
make the tab mean two things at once.

## Consequences

- `shepherding_tasks` records gain `aboutPersonId`, null on every existing one.
  No migration: absent already means "nobody in particular".
- The Tasks & Reminders page shows who each Task is for and links through to
  them. Its filter is still by Assignee — the person-shaped view is the profile
  tab, which is the route ADR 0059's consequences said did not exist.
- The Shepherding Profile gains a Tasks tab, mounting the Tasks & Reminders
  component scoped to that Person. Same component, same writes, same rules — the
  trade the Document Library already makes with its own profile tab.
- `shep_create_task` takes an optional `aboutPersonId`; `shep_list_tasks` takes
  an optional `personId` and answers with the Subject's name. Setting it on one
  date of a repeat is refused with a sentence saying why.
- CONTEXT.md gains **Subject**, which is not the **Subject Line** of a
  Shepherding Note. Two words that had to be told apart, and the entry says so.
