# ADR 0021: Eligibility Advises, the Editor Decides — Restriction Rules Warn Rather Than Refuse

## Status
Accepted. Reverses the enforcement half of ADR-0020 §5 and sharpens ADR-0018 §1. The rules themselves, and where they live, are unchanged — only what happens when one is broken.

## Context

Every restriction the Roles Manager offers has been a refusal. `RolesCore.candidatesFor` returns a reason with each candidate, the picker greys the ineligible ones out, and there is no way past them. ADR-0020 §5 went further and made exclusivity eligibility too, on the explicit grounds that the solver and the hand-assignment screen must never give different answers to the same question.

MS-18 broke that. Auto-assign hands the editor a whole draft — ten Sundays, every Role, every place — and its entire purpose is that the editor then reworks it. An editor dragging people around a term's worth of rota hits the wall constantly, and the wall is nearly always wrong about the week in front of them: the married couple *are* the only two who can do Kids this Sunday, the person who already has two jobs *did* offer to take a third, the woman-only place *is* being covered by whoever turned up.

A tool that refuses the roster the church is actually going to run does not prevent that roster. It just stops being where the roster is recorded, and the real one moves to a WhatsApp message. That failure is worse than any rule it was protecting, because the app then holds a serve history that quietly diverges from what happened — and fairness reads that history.

## Decision

### 1. The line is *can't* versus *shouldn't*

Two categories, and the distinction is not about severity.

**Can't — absolute, unchanged.** Whether a person may be *shown at all*. Somebody **Inactive**, or hidden by a tag carrying `hidePeople` / `shepherdingHidden`, is not offered, not searchable, and never appears. This was never a rule about rosters; it is a rule about names on screens, and for a hidden Person a warning row would print the very name the tag exists to hide. Elders and super admins are unaffected, as before.

**Shouldn't — advisory.** Everything the editor authored: the five restriction kinds, the allowlist, a slot's male/female requirement, Role exclusivity and the two-Role limit, and the liturgical clash. All of these now **warn**. None of them refuse.

*Amended (MS-221).* **Cross-Role Rules** join that list — a rule an editor wrote about a *pair* of Roles ("the Kids Leader and the Kids Helper cannot be from the same Marriage"), stored on the Event series rather than on either Role. It is a rule the editor authored about the roster, so it advises like the rest, and nothing in the test below needed changing to decide that: *rules about the roster advise, rules about who may be seen do not.* Worth recording anyway, because the list above reads as exhaustive and was, for four years' worth of rules, a list of things a Role says about **itself**.

The test is one sentence: *rules about the roster advise, rules about who may be seen do not.* An editor overriding a restriction is overruling themselves, which is their business. An editor being shown a hidden Person is the app leaking, which is not.

### 2. A warning is a property of the roster, not of the act

The old shape asked one question — *may I seat this person here?* — at the moment of seating, and threw the answer away. Warnings cannot work that way: a roster can be perfectly legal when drafted and break later, when someone marries, a tag changes, or a Role gains a restriction. Nothing was overridden and there is still a problem.

So alongside `candidatesFor`, which keeps answering the per-candidate question and keeps returning its reasons, the model gains a pass that judges **a seated roster as it stands** and returns the warnings on it. Both surfaces read the same pass, which is what preserves the property ADR-0020 §5 actually wanted: not that both screens *refuse* alike, but that both screens *say the same thing about the same roster*.

Naming a placement an "override" was rejected for this reason — it describes only the case where an editor did it on purpose, and the drifted-data case has no override in it.

### 3. Auto-assign never produces a warning; only editing does

The solver asks `RolesCore` and accepts its answers, so every draft it emits is legal on the day it is drawn. Every warning on the Auto-assign screen is therefore the editor's own edit — which is worth saying on the screen, because it means a warning is never the machine second-guessing itself.

An empty place is not a warning. Leaving a place unfilled is a legitimate answer an editor may accept and settle nearer the day.

### 4. The Roles tab moves with it

Warn-don't-block cannot be true of one surface. If an accepted draft can carry a broken rule, the date it lands on opens on the Roles tab afterwards — and a Roles tab that cannot show the problem makes the warning evaporate at exactly the moment somebody could act on it. So the Roles tab shows warnings on the roster it is displaying, and, once it can show them, refusing to let it create one would be the same split in the other direction.

## Consequences

- **`RolesCore.candidatesFor` keeps its reasons and loses its authority.** The reasons are now what a surface *displays*, not what it *enforces*. Its callers must stop treating an ineligible verdict as a disabled control. This is the opposite of what ADR-0020 §5 asked every existing caller to inherit, and it lands on shipped MS-16 and MS-99 code.
- **A second model function**, judging a whole seated roster, has to stay in step with the per-candidate one. Two functions expressing one rule set is the drift risk this codebase keeps avoiding; here it is unavoidable, because the questions genuinely differ, and a test holding them together is the mitigation — the same trade `assignment-conversion.js` and `service-involvement.js` already make.
- **The Roles Manager's rules become softer than they read.** Someone authoring "no married couple in this Role" is now expressing a strong preference. The authoring UI should not promise more than that.
- **A warning has no lifecycle.** It is derived on read, never stored, never acknowledged, never dismissed. An editor who decides a warning is fine this week will see it again next time they open the date. Deliberate — a dismissable warning is a warning nobody reads by the third week — but it means a long-running deliberate exception is permanently noisy, and there is no plan for that beyond changing the rule.
- **Nothing here touches fairness.** The solve still refuses to seat an ineligible person, because a proposal that starts by breaking the editor's own rules is not a proposal worth reviewing. Advisory applies to the human, not to the machine.
