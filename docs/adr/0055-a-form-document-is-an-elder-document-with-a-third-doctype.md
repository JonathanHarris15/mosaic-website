# ADR 0055 — A Form Document is an Elder Document with a third docType, and it keeps a copy of its questions

**Status:** Accepted
**Date:** 2026-09-03
**Ticket:** MS-362 / MS-384

## Context

MS-362 adds a second destination for a **Form Template**. Until now every
template was published as a link and answered by many people, each answer a
**Response** — a data point on a tab. An **Elder Interview** is not that. It is
filled in once, and the filled-in thing *is* the record: it belongs in the
Document Library, openable and re-readable a year later.

Two questions had to be settled before any of it could be built.

**Where does a Form Document live?** `elder_documents` is `isElder()`; a Form
Template is owned by editors. Those do not obviously line up.

**What is inside it?** The cheap answer is to pour the template's headings into
an ordinary document body as prose and let somebody type underneath. That was
proposed and rejected — see Decision.

The ticket expected the answer to **break ADR-0049**, which says four documents
share one shape: a title and a body of TipTap JSON, differing only in path and
rule. It does not, and finding that out changed the design for the better.

## Decision

**A Form Document is an Elder Document with `docType: 'form'`.**

`docType` already had two values, and the second one already does the thing this
needed. A `care-list` document carries `careListData` **instead of**
`contentJson` — it has no body of prose at all. So a document that holds
something other than TipTap is not a new idea here; it is the existing one, used
a third time.

A Form Document therefore carries:

- `templateId` — which template it was started from
- `questions` — **a copy** of that template's questions
- `answers` — what has been filled in, empty rather than absent

and no `contentJson`.

Nothing is stored anywhere new. The Document Library lists it, files it into
folders, renames, moves and deletes it without knowing which kind it is. **No
rule changes**, and `test/form-document-record.test.js` asserts that absence
deliberately, so a rule appearing later reads as somebody having moved the
storage without revisiting this decision.

**It keeps its questions rather than reading its template.**

Editing a template must never reach back into interviews already filled in. A
record has to keep the question it was actually asked — the same reasoning that
**retires** a question rather than deleting it on a `responses` form, so that a
tally keeps its labels.

The copy is deep. A question carries its own options and its own scale, and a
shallow copy would leave those shared with the template, which is the same bug
wearing a hat.

**It keeps its structure rather than becoming prose.**

A form flattened into a document body loses the date control, loses the option
list, and loses the ability to change an answer. Those are the reasons somebody
wanted a template instead of a blank page. So every question is drawn as its own
control, and a multiple choice shows **all** of its options with the chosen one
marked — a filled-in form should read as a record of what was asked as well as
what was answered.

`form-question-markup.js` (ADR-less, MS-383) is what makes that affordable: the
controls are written once and drawn on both surfaces, so a Form Document did not
cost a second implementation of every question type.

## Consequences

**A Form Document is elder-only, and its template's Answering rung governs
nothing.** `elder_documents` is `isElder()`. The rung is therefore stored as
`null` on a `document`-mode template and hidden in the builder, rather than
shown and quietly ignored — a field that looks like it decides something while
deciding nothing is what somebody later writes a permission check against.

Both cases waiting on this are elder work: the elder-intake template (MS-365)
and the counselling intake (MS-271). So it costs nothing today. When a
non-elder case arrives it is a real ticket, and there are two known routes: a
rung **stamped onto the record** (the pattern `event_occurrences` already uses
for visibility, so the rule reads the stamp rather than chasing a reference), or
a second path with its own rule.

**A Form Document does not follow its template.** That is the point, and it is
also a limitation: fixing a typo in a template does not fix it in the interviews
already written. That is the right trade for a record, and the wrong one for a
draft — if templates ever need to propagate, it is a new decision, not a tweak.

**ADR-0049 stands, and reads more clearly for this.** Its "one shape" is about
the record and where it hangs, not about every document holding TipTap. That was
already true of `care-list`; this makes it explicit.

**Three docTypes now branch in `buildElderDocument`.** A fourth would be the
point to ask whether the branch wants to become something else. Three is fine.
