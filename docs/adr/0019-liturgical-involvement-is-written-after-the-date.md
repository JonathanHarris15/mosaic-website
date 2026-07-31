# ADR 0019: Liturgical Involvement Is Written After the Date, and Converts Unconditionally

## Status
Accepted. Extends ADR-0018 §1–2, which separated Assignment from Involvement for Servant Roles and deliberately left liturgical Roles on their existing plumbing.

## Context

ADR-0018 §1 named the bug plainly: putting someone in a role wrote an Involvement record immediately, including for a Sunday six weeks away, so the serve log already counted serving that had not happened.

It then fixed that **for Assignments only**. A Servant Role's Assignment lives on an Event occurrence and becomes an Involvement record after the date, and only if it was Confirmed. Liturgical Roles were left alone on purpose — they are denormalised fields on `services/{date}` that the printed Service Guide reads, and giving them Assignments would put two sources of truth for who is preaching on one document (§2).

But "leave the plumbing alone" was taken to mean "leave everything alone", and the write moment never moved. So `service-builder.js` went on writing a serve record the instant a Service was saved, with no date check at all. Two consequences, both quiet:

- **CONTEXT.md was already lying.** Its Involvement entry says "an Involvement is never written for an Event that has not happened yet (ADR-0018)". That was true of Assignments and false of the liturgy, which is most of what a Sunday is.
- **MS-17 was about to inherit it.** The fairness engine ranks people by their serve history. A history containing Sundays that have not happened ranks people by what was hoped for, and a fairness engine reading a wrong log *looks like it is working* while handing the most overworked people another round.

At the time of writing, 17 serve records existed for seven Sundays that had not happened. The person with the most was the music leader, who is on nearly every Sunday — exactly the person a bad count damages most.

## Decision

### 1. Liturgical Roles keep their fields; only the write moment moves

The Service document is unchanged. `preacherId` and its siblings stay exactly where they are, and the Service Guide reads them exactly as it did. ADR-0018 §2 holds in full: liturgy is not Assignments, and there is still only one source of truth for who is preaching.

What changes is **when the serve record appears**. Saving a Service dated in the future writes no Involvement. A scheduled job writes it the night the date passes.

### 2. Liturgy converts unconditionally

A Servant Role's Assignment converts only when it is **Confirmed**, because somebody had to say yes, and silence must never be read as a yes.

Liturgy has no such state. There is no Pending or Confirmed on `preacherId` — it is a field, not a record of a conversation. **Being on the printed booklet is the commitment** a state would otherwise capture: the guide went out on Sunday morning with their name on it.

So no "did they serve?" question is raised for liturgy. The alternative — treating liturgy holders as Pending and asking every week — was rejected: that is a question about the preacher, every Sunday, for a role that almost never changes. A prompt that is nearly always answered the same way stops being read, and then the one week it mattered is bulk-answered with the rest. Mistakes are corrected with the manual Involvement add/delete the People's Directory already has.

This asymmetry is the thing a future reader will trip over, and it is the reason this ADR exists.

### 3. A Service says for itself whether its records are owed

Every Sunday saved before this shipped already has its Involvement, written under an auto-generated id. A job that converted by date range would not overwrite those — it would write a **second** record beside each one, which is the exact double-count this work removes.

So the editor stamps `involvementDeferred` on a Service when it declines to write, and the job converts only Services carrying it, clearing the flag in the same batch as the writes. A Sunday already written is never touched, because it never carries the flag.

This is why the fix is safe to deploy against live data without an ordering dance between the code and the migration.

### 4. Records get deterministic ids

Liturgical Involvement is keyed `{date}_{slug}` (plus the prayer type where one person can lead both prayers), rather than an auto-id. Running the conversion twice then overwrites rather than duplicating.

The person is deliberately **not** in the key: the record lives at `people/{personId}/involvement/{id}`, so the person is already its address. Two Music Helpers therefore share an id under different people, which is correct — they are two documents. Anything that keys them by slug alone in memory collapses them into one, and the helper that loses is never credited for a Sunday they actually played.

### 5. Pastoral prayer is not in scope

`liturgy.prayerMale` / `prayerFemale` write a `pastoral_prayer` record on the same save. They are **not serving** — they record someone being prayed *for*. They drive `lastPastoralPrayerDate`, which the prayer rotation reads, and fairness never looks at them. Moving their timing would change the rotation for no benefit here, so it is left exactly as it is.

`elements` and `other` **are** serving and are included, even though they are not liturgical Roles and are absent from `RolesCore.LITURGICAL_SLUGS`. They predate the Role model.

## Consequences

- **`totalInvolvements` moves owner.** The editor used to keep the counter up as it wrote; the scheduled job now owes it, counted per person because one person can hold two Roles on a Sunday. The People page and Analytics both sort by it.
- **Saving a future Sunday clears any serving Involvement already on it**, so a Sunday heals itself when touched rather than waiting on the migration.
- **A one-off cleanup was needed** for Sundays already staffed, deleting their future-dated records and stamping them deferred so the job pays them properly. `scripts/clean-future-involvement.js`, dry run by default because it deletes.
- **The editor's date check is browser-local, the job's is church-local.** They can disagree by a day near midnight. Either way is safe: the editor writes, or it defers and the job converts. No path produces a duplicate.
- **A Sunday's serve records now appear a day late** relative to the old behaviour. That is the point — they appear when they are true.
- **The conversion rules exist twice**, in `public/service-involvement-core.js` for the editor and `functions/service-involvement.js` for the job, because `functions/` deploys alone and cannot require out of `public/`. Same trade `assignment-conversion.js` already makes, and a test holds the two together.
