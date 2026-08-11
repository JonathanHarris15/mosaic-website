# ADR 0030 — Eligibility refuses a member and advises an editor

**Status:** Accepted
**Date:** 2026-08-07
**Extends:** [ADR 0021](0021-eligibility-advises-the-editor-decides.md) (which made every roster rule advisory) and [ADR 0018 §5](0018-event-occurrences-assignments-and-visibility.md) (the visibility ladder).

## Context

ADR-0021 took every restriction the Roles Manager offers — the five restriction
kinds, the allowlist, a slot's male/female requirement, Role exclusivity and the
two-Role limit, the liturgical clash — and made all of them **warn rather than
refuse**. The reasoning was specific and it was right: an editor dragging people
around a term's worth of rota hits the wall constantly, the wall is usually wrong
about the week in front of them, and a tool that refuses the roster the church is
actually going to run does not prevent that roster — it just stops being where
the roster is recorded.

MS-20 and MS-190 hand the roster to the congregation. A member declines an
Assignment, it goes looking for [[Cover]], and another member takes it. There is
no editor anywhere in that sequence.

And that breaks the sentence ADR-0021 rests on:

> An editor overriding a restriction is overruling themselves, which is their
> business.

A member is not overruling themselves. They are overruling the church, in a path
nobody reviews, and there is no editor in the loop to catch it afterwards. The
justification does not carry across, and the rule cannot simply be inherited.

## Decision

### 1. The line is the editor, not the human

This is not a new axis. The codebase already draws it twice and calls it
something else both times.

ADR-0021 §5, on fairness: *"The solve still refuses to seat an ineligible person,
because a proposal that starts by breaking the editor's own rules is not a
proposal worth reviewing. Advisory applies to the human, not to the machine."*
ADR-0023, on Away: absolute to Fairness and Auto-assign, advisory to the editor.

Both were written as human-versus-machine. They are not. What actually separates
the two sides is **whether the actor is the person whose rules these are.** The
editor authored them and may overrule them. Everything else — the solver, and now
the congregation — is bound.

So a member picking up an open Assignment, or accepting a Trade, hits the wall.
The escape hatch is unchanged and has always existed: the editor may seat anyone,
warned.

### 2. The cover list shows what you cannot take

Every open Assignment appears, sorted soonest-first, including the ones you are
ineligible for — marked, carrying the reason `RolesCore.candidatesFor` already
returns, with the button off.

Filtering them out was the obvious alternative and it is worse. The cover list is
the church's open need, not a personal to-do list, and a list that quietly
shortens itself per reader understates how much is unfilled — to the very editor
whose backstop depends on reading it. Showing the reason also teaches the rule,
which a silent omission never does.

### 3. Your own Away is yours to overrule

If you are [[Away]] on the date and you pick the Assignment up anyway, you are
warned and let through.

ADR-0023's own reasoning inverts here. Away is absolute to the machine because it
is *a fact a Person asserted about their own life*, and a program overriding it is
not judgement but disbelief. When the person overruling it **is that person**,
there is nothing to disbelieve — they are changing their mind, which is the one
thing they are unambiguously entitled to do.

### 4. Visibility is not eligibility, and does not bend at all

Taking an Assignment writes you into the occurrence's `participantIds`, which is
what the security rule reads to answer `participant` visibility. So accepting a
Trade is a **visibility-granting act performed by a member**: Sarah could hand a
stranger sight of the Elders' Meeting by offering them her place in it.

An offer may therefore only name Assignments **both parties can already see**, and
the cover list is filtered by rank like everything else. This is not the advisory
half of ADR-0021 — it is the absolute half, §1: *rules about the roster advise,
rules about who may be seen do not.* An Event's rung is the editor's stamp, and no
member may restamp it by trading.

A consequence worth naming: a `participant`-rung Event can never put an Assignment
on the cover list, because at that rung there is nobody the list could legitimately
reach. Those stay quiet — directed Trades only, to people already in the Event —
and failing that, the editor's problem.

## Consequences

- **One question now has two answers, chosen by who is asking.**
  `RolesCore.candidatesFor` keeps returning its reasons; the member-facing path
  treats an ineligible verdict as a disabled control, which is precisely what
  ADR-0021 told every existing caller to *stop* doing. The split is by caller and
  nothing in the model expresses it, so a test has to hold the two paths apart or
  they will drift back together.
- **A hard-to-fill Assignment will sit in the cover list untaken**, visible to
  people who are not allowed to take it. That is the honest picture and the editor
  is the resolution — but it means the list can look busier than it is useful.
- **The Trade system cannot produce an illegal roster.** Every settled Trade is
  legal at the moment it settles, so any Warning an editor later sees on a traded
  Assignment came from drift — somebody married, a tag changed, a Role gained a
  rule — which is exactly what ADR-0021 §2 built Warnings to catch, derived on
  read, with no extra plumbing.
- **A member who genuinely is the right answer has no way to say so.** The married
  couple who really are the only two who can do Kids this Sunday cannot arrange it
  between themselves; one of them has to ask an editor. Accepted — that
  conversation was going to happen anyway, and ADR-0021's fear (the rota migrating
  to WhatsApp) applies to the person building the whole rota, not to one member
  covering one date.
- **[[One-off Role]]s have no eligibility rules at all** (ADR-0018 §4), so anybody
  may take one off the cover list. Nothing to check, and nothing to warn about.

*Amended (MS-221).* **A Cross-Role Rule is refused to a member like any other, and
it cost more to honour than it looks.** §1 is written about actors, so a new rule
kind inherits it without argument. What does not come free is the *ingredients*:
the server assembles the eligibility context itself, and it used to load a
Person's Relationship Groups only when the **Role's own definition** asked for
them. A Cross-Role Rule lives on the Event series, so a Role whose definition has
no group rule can now be constrained by one — and with the groups list left empty
the rule finds no shared group, concludes there is no clash, and **silently
permits everything a member asks for**, while the editor's picker refuses the
same person. A rule enforced at one door and not the other is worse than a rule
at neither: the roster ends up wrong in a way the screen that built it never
shows. Anything added to the eligibility model from outside a Role Definition has
to ask the same question — *what does the server now have to load that it did
not?*
