# ADR 0020: Fairness Is a Weekly Solve — Intensity Measured in Weeks of Rest, Load as the Gate, Recency as the Objective

## Status
Accepted. Supersedes the fairness sketch in ADR-0016 §5–6, which named the concept and left the mechanism open, and sharpens ADR-0018 §4, which described one-off Roles as skipped by fairness "entirely".

## Context

MS-17 was specced as a **ranking** module: hand it a Role and a date range, get candidates back in order, least-recent and least-often first. Both the Sunday picker (MS-16) and auto-assign (MS-18) would import it.

Three things were wrong with that.

**A ranking module cannot produce an even range.** By ADR-0018 and ADR-0019, no Involvement exists for a date that has not happened — that is the whole point of them. A scorer reading only the serve log therefore returns an *identical* ranking for every Sunday in the range, and the same person tops all ten. The ticket's own acceptance criterion demanded evenness across a range and the proposed shape made it arithmetically impossible.

**Counting jobs treats unequal work as equal.** Hauling tables and sitting at the sound desk are one serve each in the log. Every rota gets this wrong, and the people who do the heavy jobs are the ones who quietly stop coming.

**A score sort cannot honour the rules the Roles Manager already promises.** `notTogether`, `notSameGroup` and `sameGroup` constrain *combinations* — whether a person may be seated depends on who else was seated. No ordering of individuals can express that. A sorted list handed to a greedy filler produces rosters that violate rules an editor authored and believes are enforced.

## Decision

### 1. Fairness solves one occurrence at a time; a range is that step repeated

The unit is **one occurrence, fully staffed**. A ten-week roster is the same function run ten times, each step reading a history window that has rolled forward to include the steps before it.

This dissolves the plan-versus-fact problem rather than solving it. There is no second "planned work" input to thread through the model and keep in sync: week one's picks are simply *inside the window* by week two. History is the only input fairness ever has.

It also moves a boundary. **MS-17 is now the solver for one occurrence**, not a ranker; MS-18 shrinks to the loop across dates plus the approve screen. MS-16's picker consumes the underlying numbers — load and recency per person — rather than the solver.

### 2. Intensity is the cost of a job, measured in weeks of rest owed

Every Role carries an **intensity**: a float, at least 0, defaulting to 1. Sound is 1 — someone can do it weekly and stay fresh. Setup/teardown is 4 — a month before they should be asked again. Coffee is 1.25: nearly every week, with the occasional break.

Load is then `Σ intensity` over the window, **denominated in the same unit as the window itself**. In a twelve-week window, twelve weeks of sound and three setups both come to 12, and both mean *spent*. That equivalence is the entire reason the number exists, and it gives a burnout line that needs no tuning constant: **load ≥ window length means the person is over their rest budget.**

`0` means the job is free. It still writes Involvement and still moves the person's recency for that Role — it simply never makes them look busy. For greeting at the door, that is the honest number.

Where it is stored follows what the Role *is*. A Servant Role keeps it on its definition. A **liturgical Role has no stored definition and must never have one** — `/roles` is editor-writable, so a document there would make a locked Role editable — so its intensity lives in a `liturgicalIntensity` map on the Event series. A one-off Role keeps its own on the Event.

### 3. Load gates the pool; recency is what the solve maximises

Two dials, doing different jobs, and the split matters more than either dial.

- **Load** is per person per date: how much you are carrying this season. It decides *who is even considered*.
- **Recency** is per person per Role: how long since you last did this particular job. It decides *who gets which Role* among those considered.

So the least-loaded people are gathered first, and the solve then maximises the total time-since-last-served across the Roles being filled. Load is a hard gate, not a weight; recency is an objective, not a sort key.

An earlier design combined them into one number — staleness docked for load, with a tunable weight. It was rejected: the weight is unguessable, has no feedback loop, and produces a score nobody can explain. Two dials with distinct jobs can be explained in a sentence each.

**Recency is capped at the window.** Never having done a Role scores the same as having done it twelve weeks ago. Uncapped, ancient history would overwhelm the load gate and invert the design.

### 4. The pool starts with slack and widens rather than failing

Cutting the pool to exactly the number of spots makes infeasibility trivial to manufacture: six spots, six least-loaded people, one DBS-checked person, two Kids slots, and no valid roster exists — while the seventh-least-loaded person is DBS-checked and sitting right there.

So the pool takes the least-loaded **spots + 4**, and **widens by one and re-solves** whenever a spot cannot be filled, until it is fillable or the eligible pool is exhausted. Still unfillable means the spot is **left empty with the reason stated** — never a silently short rota.

Two things report themselves, because both are signals about the church rather than the algorithm: a roster where everyone proposed is over their rest budget means you are short of volunteers, and a pool that had to stretch a long way means the restrictions are doing more work than anyone realised.

The pool is **every active assignable Person**. Membership is deliberately not a fairness concept: a church that wants a Role restricted to Members says so with a `requireTag` rule on that Role, because Kids and coffee should not have to share one answer. The cost is that a first-time visitor has zero load and no history, which is the strongest position on both dials — so an untagged Role will lead with strangers until someone tags it. Accepted, because the output is a proposal a human approves (ADR-0016 §6), and the fix is one tag.

### 5. A Role uses up your morning unless it says otherwise

Each Role carries `allowsAnotherRole`, **default off**. A person may hold **at most two** Roles at one Event, and only when *every* Role they hold permits it — holding any exclusive Role means holding nothing else, because that Role itself says so.

This reverses the previous assumption. `RolesCore.candidatesFor` blocked a person from two slots of the same Role but deliberately permitted two different Roles the same morning: "serving another Role the same morning is not this Role's business." That was fine when a human was choosing and could see the whole Sunday. It is not fine when a solver is choosing, and there is no reason the two surfaces should disagree — so **exclusivity is eligibility**, enforced in `RolesCore`, and hand-assignment on the Roles tab obeys it exactly as the solver does.

Intensity and exclusivity are separate questions and the UI must not conflate them. Intensity says *this job tires you out*; exclusivity says *this job occupies you*. Sound is plausibly intensity 1 and exclusive: easy work, but you are stuck at the desk.

### 6. The solve is exact backtracking search — not a sort, and not a matching

Seat a candidate, recurse to the next slot with them seated, keep the best total recency, backtrack when stuck, prune any branch that cannot beat the best found.

Max-weight bipartite matching was considered and is **wrong, not merely approximate**: it expresses only unary constraints (sex, tags, allowlist) and would cheerfully seat a married couple in Kids. Best-of-N random shuffles was also rejected — it is non-deterministic, and a roster that redraws differently on Wednesday than it did on Tuesday cannot be reviewed, because nobody can tell whether the data changed or the dice did.

The search fits the existing model exactly. `RolesCore.ineligibilityFor` already takes `context.assigned` and judges the next candidate against who is already seated — precisely the signature a backtracking solver needs. **No new eligibility logic is written**; the existing function is called from a search instead of from a picker, which is also what guarantees the two can never disagree. It is passed in rather than imported, keeping this module dependency-free like every other `*-core` here, and making the relationship visible at each call site: fairness *asks* about eligibility and never holds an opinion of its own.

**Filling more beats filling better.** Leaving a slot empty is a branch of the search like any other, and rosters are compared on how many slots they fill before how well they spread the work. A Role that can legally seat one of its two slots seats that one and reports the other; coming back empty because it could not do both would throw away a real half-rota an editor can see the gap in. This also lets a cohesive `sameGroup` Role stop early instead of failing outright.

The problem stays small because the coupling splits. Relationship rules are scoped to one Role, so each Role's slots are an independent sub-problem; exclusivity is the single thread tying the Roles together. Ties break on a shuffle seeded from `seriesId + date` — stable for a given week, so a re-run is identical, but not favouring the same names every week. Alphabetical would be a new unfairness wearing fairness's clothes.

### 7. Liturgy is excluded twice, and still costs load

Anyone holding a liturgical Role **on this occurrence** is out of the pool: you cannot preach and run the sound desk. Anyone who has held one in **at least half the window** is out too.

The second rule looks redundant once liturgy carries intensity — the man who preaches every Sunday sinks to the bottom on load alone. It is kept because **load ranking is a tendency and the cliff is a guarantee**. In a thin season everyone's load is high, and "lowest of a bad lot" could still float the preacher into the pool. "We never roster the regular preacher for setup" is a rule that can be said out loud to a congregation; a tendency cannot. Held at a flat 50% and not configurable, because nobody has any intuition about what 40% would mean.

Below that line liturgy still costs load, which is why liturgical Roles needed an intensity at all: a sermon once a quarter is 8% of the window and should not be free.

### 8. An allowlist is a restriction, not a tag

A sixth restriction kind, `{ kind: 'allowlist', personIds: [...] }`, for the few people who serve communion or run coffee.

A Shepherding Tag would work and was rejected. Tags are a *pastoral* concept in this model, and this is not a fact about the person — it is a fact about the Role. Using tags would also mean configuring one Role by editing five Person records on a different screen.

Living in `restrictions[]` rather than as its own field means it composes with the other rules by AND, hand-assignment obeys it for free, and the picker greys people out with a reason instead of hiding them — consistent with every other restriction. **Absent is not empty**: no rule means everyone, an empty list means nobody and is a validation error at authoring time rather than an unfillable rota discovered six weeks later. It is purely an editor's tool and is never shown to the person.

**It is editor-facing in the interface, not in the data.** `/roles` is `allow read: if true`, so an allowlist's person ids are world-readable, and "these four people serve communion" is resolvable against the world-readable directory by anyone who opens devtools. This is the same trade ADR-0018 accepted for `participantIds` and it is accepted here on the same narrow grounds — the directory is already open, so this discloses little that is not — but it is a second instance of the same smell, and the argument is about the app's read posture rather than about this feature. The directory question is filed separately and is larger than either.

## Consequences

- **The Role data type grows three fields** — `intensity`, `allowsAnotherRole`, and an `allowlist` restriction — and all three need authoring UI. Servant Roles in the Roles Manager; one-off Roles on the Event page, which has no Roles Manager to fall back on; liturgical intensity on the locked card that already renders.
- **The liturgical locked card becomes editable in exactly one respect.** ADR-0016 locks the *definition* — name, slots, restrictions. Intensity is a fairness weight, not definition, and it is stored outside `/roles` so the invariant that made those Roles locked still holds.
- **MS-18 shrinks** to stepping the solver across dates and the approve screen. Its fairness logic moved here.
- **MS-16 shipped before this existed** and reserved a subtitle slot for a fairness note. It consumes the load and recency numbers, not the solver — so the module exposes the primitives separately from the solve.
- **Intensity numbers become load-bearing history.** Once a church tunes them and months of rosters accumulate underneath, changing one silently re-reads the past. There is no versioning of this and none is planned; it is a small church tool, and the honest mitigation is that the numbers are visible and few.
- **The window is stored per series but shipped fixed at 12** occurrences, with no UI. Changing it changes what "spent" means, so it should not be a casual knob.
- **`RolesCore.candidatesFor` changes meaning.** Its comment that another Role the same morning "is not this Role's business" is now false, and two new reasons join it: `SERVING_ELSEWHERE` and `NOT_ON_ALLOWLIST`. Every existing caller inherits the stricter rule, which is the intent.
- **A visitor with no history ranks top of an untagged Role** and will lead its drafts until a tag is set. Named here so it reads as a known trade rather than a bug.
- **The solve stays exact, and the cost of that is measurable.** A typical Sunday (15 slots, 4 Roles, 40 people, combination rules) solves in ~2 ms, and an unfillable Role that widens the pool to exhaustion in ~3 ms. The expensive shape is a *varied* history — several slots where every candidate has a different recency, so nothing saturates and the bound has less to cut — which measures ~125 ms. That is fine for staffing one occurrence and means roughly a second for MS-18 to step ten weeks. It was left exact rather than capped: an anytime cut-off would buy speed the church does not need by giving up the guarantee that the roster is the best legal one, which is the claim this whole design rests on.
- **The liturgical block moved onto this mechanism and a latent bug went with it.** The picker used to feed liturgy holders into `assigned` — the list the *relationship* rules read — so on a Sunday where someone preached, a `notTogether` rule blocked their spouse from Kids for being married to someone "already in this Role", and a `sameGroup` Role demanded every candidate share a group with the preacher. Being busy elsewhere is now its own thing, and it blocks the person and nobody else.
