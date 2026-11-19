# ADR 0085 — Who a Role needs, and its rules, belong to the Event that runs it

**Status:** Accepted
**Date:** 2026-11-19
**Supersedes:** the part of [ADR 0016](0016-roles-as-events-locked-liturgical-editable-servant.md) and of the glossary's **Role Definition** that put slots, restriction rules, rest and exclusivity on the Role itself

## Context

A Servant Role used to carry everything about itself: its name, what it
involves, who it needs (slots, each a man, a woman or either), restriction
rules, rest between turns, and whether it uses up the morning. That held "for
the Role wherever it runs".

It does not hold. Setup needs two men on a Sunday and one of anybody on a
Wednesday. Fairness was already counted per Event series (ADR-0016 §5), so a
Role's rest was the only part of "how often" that ignored which Event it was.
Rules across two Roles already lived on the Event (MS-221), because only the
Event knows the two run together.

Rules also could not say OR. "Tagged Member, or tagged Special help" and "a
man and a woman, or two men" were not sayable, and neither were line-ups across
Roles: "(the Helpers are a woman and a man, and the Leader is a man), or (the
Helpers are two men, and the Leader is a woman)".

## Decision

1. **A Role is its name and what it involves.** Who it needs, who may fill it,
   its rest and whether it uses up the morning are set per Event, on the
   series' `roleSettings[slug]`. Everything that seats, checks or counts a Role
   reads the Event's version through `EventsCore.effectiveRole`.
2. **The Role's old values stand in until the Event has its own.** On the day
   this ships every Event reads exactly what it read before. An Event takes a
   Role over the first time an editor changes it there; the stored slot ids
   are kept, because an Assignment names its seat by id.
3. **Rules can say OR.** A rule may be `{ kind: 'anyOf', options: [{ conditions:
   [...] }, ...] }`: any one option will do, and every condition in an option
   must hold. Options are objects because Firestore cannot store a list inside
   a list. One level only — an option inside an option is refused.
4. **Who it needs is a rule.** How many people a Role needs stays a plain
   number, because a rota has that many seats. Which men and women is a
   **line-up**: `{ kind: 'lineup', sexes: [...] }`, unordered, judged as
   "can this team still become one of the line-ups?". The old per-seat
   requirements read as one line-up.
5. **Three places a rule can be about**: *who can do it* (each person on their
   own), *the team* (the people on the Role together: line-up, at least n
   tagged, no two from one group…), and *across Roles* (conditions naming the
   Role they are about).
6. **Must, or Try to.** A rule is Must unless it says `strength: 'try'`. A Try
   rule refuses nobody and warns nobody; the solve fills every place it can
   first, then breaks the fewest Try rules, then is fairest.
7. **The Roles Manager becomes a ledger** of name, description and the events
   a Role runs in. The Roles & rules tab of each recurring Event is where who
   it needs, its rules and its rest are set.

## Consequences

- `RolesCore` gains `anyOf`, `sex`, `lineup` and `atLeastTagged` conditions, the
  `LINEUP_MISMATCH`, `NO_OPTION_FITS` and `TOO_FEW_TAGGED` reasons, and
  `misses` on every candidate. A caller that judges one person at a time
  (Cover, Trade, a member's own take) hands the team in as `knownPeople`.
- Cross-Role Rules may be stored in either shape; `EventsCore.rolesNamedBy`
  is how anything asks which Roles a rule names.
- A Role is created with only its name, slug, family and description; the
  security rules no longer let any write add or change the old fields. An
  Event that adds a Role writes its own settings for it at once.
- Moving what is stored is `scripts/migrate-role-settings-to-events.js`, in
  two phases: copy onto every series, then strip the old fields off every
  Role ([ops note](../ops/adr-0085-role-settings-migration.md)). Until the copy
  has run, `EventsCore.effectiveRole` still falls back to the Role's old
  values, and the rule readers still accept the old shapes; both go once it
  has.
- A Try rule is invisible to a member taking a place themselves: they are not
  refused and not told. That is deliberate; a preference is the rota's to keep.
