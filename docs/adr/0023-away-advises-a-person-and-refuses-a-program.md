# ADR 0023: Away Advises a Person and Refuses a Program

## Status
Accepted. Extends ADR-0021 rather than reversing it: the rule that eligibility advises and never refuses still holds for every rule the church wrote. This adds the one reason a *Person* wrote, and gives it a second, stricter answer for the machine.

## Context

MS-188 lets a Person say which whole days they will not be here — an **Away**. Everything that staffs an Event then has to decide what to do with it.

The fact already existed and had nowhere to live. Auto-assign has an **Out** control (`away` until this ticket renamed it) whose comment says exactly what it was: *"An editor knows things the church has no record of: somebody is away that weekend, or off for the rest of the term."* It lived in the editor's browser, per draft, and was never stored. So the same fact was re-entered every time a range was drafted, by whoever happened to hear it in the car park.

ADR-0021 settled how a broken rule behaves: **advise, never refuse**, because *"a tool that refuses the roster the church is actually going to run does not prevent that roster. It just stops being where the roster is recorded."* Every one of the thirteen existing reasons follows it.

Away does not obviously belong to that family, and the reason is not severity. **Every existing reason is a rule the church wrote about its own rota** — no married couple in Kids, this place needs a woman, kept to a named few. ADR-0021's justification is that the editor is the final word on the church's own rules, and they are.

**Away is a fact a Person asserted about their own life.** An editor overruling "no married couple in Kids" is exercising judgement about a rule they wrote. An editor overruling "Sarah said she's away" is not exercising judgement — they are disbelieving Sarah. The reasoning that makes ADR-0021 right does not reach it.

But a straight refusal fails ADR-0021's own test. The editor who knows Sarah got back a day early, or who has just spoken to her, must be able to record the rota that is actually happening. Refuse them and the rota moves to WhatsApp, exactly as before.

## Decision

### 1. Away is an ineligibility reason, and the editor may still place them

`REASONS.AWAY`, sitting directly below `INACTIVE` and above every rule about the roster — somebody who will not be there cannot meaningfully be told that this place wants a woman.

Mechanically it behaves like the other twelve: the person is **shown**, greyed, with the reason, and the editor may place them anyway. ADR-0021 is untouched.

### 2. It is worded as the person's own words, and that is the safeguard

Every other reason is impersonal because it is impersonal: *"Excluded by tag"*, *"This place needs a woman"*. Away is attributed:

- **"Sarah said she's away"** — she entered it herself.
- **"Ann marked Sarah away"** — an editor entered it on her behalf.

Never *"Unavailable"*. Since the block is deliberately soft, the sentence is the only thing standing between an editor and overruling somebody's own word without noticing they have done it. An unattributed Away reads as the person's own, never the editor's — putting an unmade claim in an editor's mouth would be worse than the ambiguity.

The attribution is also what makes the responsibility rule fair (§4). Sarah cannot be expected to sort out a clash arising from an Away she never made.

### 3. To fairness and auto-assign it is absolute

A solve seats only `eligible` people. It overrides nothing, it never creates a Warning, and every draft it emits is clean by design (ADR-0021 §3). So **a program can never place somebody who said they would not be there**, while a human still can.

The asymmetry is deliberate and it is not implemented twice — it falls out of Away being a reason. A person knowingly overruling someone's word, in front of a sentence naming them, is defensible. A program doing it silently across ten Sundays is not: nobody chose it, nobody saw it, and the first anyone knows is an empty place on a Sunday morning.

Away is threaded **through** the eligibility check rather than filtered out of the candidate pool beforehand, so an unfilled place can still say *why* — "everybody left is away" is an answer; a silently short lineup is not.

### 4. Said before the rota is made it is prevention; said after, it is the person's own to sort out

Entered ahead of time, nothing ever puts them on those dates and nobody does any work.

Entered over a place they already hold, **it writes nothing to the Assignment.** An Away is not a decline. The place stays theirs, and the roster reports itself with a Warning — which is derived on read, so it appears and clears with nothing having to remember it (ADR-0021 §4).

The person is told at the moment they enter it that they hold places inside the stretch, because **the expectation is that they find their own replacement** rather than handing the hole to an organiser. An editor seeing it is the backstop, not the plan.

Auto-declining was rejected for this ticket: a member cannot write an assignment state at all today, which is the whole engineering problem of MS-20. It becomes the right answer once MS-20 lands, at which point the Warning becomes the fallback for the editor-authored case.

### 5. Out is not Away, and they no longer share a word

The auto-assign draft control is renamed **Out**. Five of its seven names were already `out` (`markOut`, `takeOut`, `outScope`, `outDates`, `outPlaces`); only the data field said `away`.

- **Out** — a drafting move. Leave somebody out of this stretch of this draft. It empties their places, dies with the draft, and asserts nothing about them.
- **Away** — a fact about a Person's diary, stored on their record.

They are kept **separate**, not merged. An editor marking somebody out mid-draft is often thinking aloud — *"what does this look like without Bob?"* — and storing that as Bob's own word would destroy the attribution §2 depends on. One word for both meant an editor's guess and a person's statement were indistinguishable in the code.

A draft saved under the old `away` key is still read, so nobody's work is lost to the rename.

### 6. It is not stored on the Person, and it carries no reason

`people/{personId}` is `allow read: if true` — every name, email, phone number and home address, open to anyone who can reach the endpoint. ADR-0018 met that posture and accepted it for `participantIds`, reasoning that ids disclose little that is not already out.

That reasoning does not stretch here. A name, a home address and *"away 10–24 August"* together are not directory data — they are a notice that a particular house is empty on particular dates. An Away is therefore a document in a **subcollection with its own rule**, readable by the person themselves and by editors and above, and by nobody else. Rules are per-path, so a subcollection under a world-readable parent is closed unless it is opened.

It carries **no reason field**. "Away" is the whole of what a rota needs, and a *why* is pastoral — which has one home in Mosaic already, behind `isElder()`. A note here would be a second, thinner-walled place for the same kind of information.

## Consequences

- **An editor can still draft over somebody's own word**, in one click, with only a sentence to stop them. Accepted: the alternative is refusing the rota the church is running, which ADR-0021 established is worse. The wording carries the weight, so any change to it is a change to this decision.
- **A member cannot see who else is away.** They cannot answer "who could I swap with" from this data, which will matter for MS-190. That is a trade to revisit there, not to pre-empt here.
- **Between somebody marking Away over a place they hold and an editor noticing, the rota still says them.** The system knows they are not coming and the roster does not say so. Closed by MS-20's auto-decline.
- **Whole days only.** Somebody who misses Sunday mornings but is free midweek must block the whole Sunday. Acceptable while most Events are one a day; a recurring-availability pattern ("every third Sunday" — a real shift-worker case) is deliberately out of scope and is a different feature.
- **Two range filters cannot be expressed.** "Overlaps this window" is `end >= from AND start <= to`, and Firestore refuses two range filters on different fields, so half the predicate is applied client-side. Getting this wrong does not return fewer rows — it throws, and reads as though nobody in the church is ever away.
- **The Out rename touches a Done feature** (MS-18). Contained: browser-local state, no migration, and the old saved key is still read.
