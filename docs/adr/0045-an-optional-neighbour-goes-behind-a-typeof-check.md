# ADR 0045 — An optional neighbour goes behind a typeof check, so the guard can read intent instead of keeping a list

**Status:** Accepted
**Date:** 2026-08-31
**Ticket:** MS-321

## Context

Every screen in Mosaic is an HTML page that loads its code as a list of
`<script>` tags. The shared logic sits in about 55 Core modules, each publishing
itself as a browser global in its own tail. A page must load every module its
own scripts use.

When it does not, the browser hands back `undefined`, the screen draws an empty
panel, and nothing throws anywhere a person can see it. It reads as *"you have
nothing"* rather than as a crash — which is why this class of fault gets
reported as a data problem, or not at all.

`test/page-script-deps.test.js` exists to catch it. Until now it recognised
**one** spelling of a dependency out of three, so most of what it was written to
catch was invisible to it.

### The three spellings

```js
: global.Name                    // 1. the require-ternary a *-core.js ends with
const Alias = window.Name;       // 2. a capture at the head of a page script
Name.member                      // 3. a bare use inside a function body
```

Only the first was checked. The second is the **dominant** spelling in page
scripts and is usually *aliased* — `calendar-event.js` captures seven modules
this way and then says `Roles.…`, `Fairness.…` — so the module's own name never
appears at the use site. That is why an earlier attempt to widen the guard by
matching bare names missed these entirely.

The third is how MS-303 slipped through: `docx-importer.js` grew a read of
`ServiceDatesCore`, and the Services page loaded it 460 lines before the module
it names. It worked only because the read waits for a click.

### Why widening it once did not work

The obvious fix — match bare names too — was tried and reverted. It reported
roughly 25 pairs across the repo, and separating the real faults from the
deliberate ones looked like a page-by-page judgement with no end to it.

Two things were actually wrong, and neither needed judgement.

Most of the noise was **prose**. The guard read comments and strings as code: a
comment in `events-core.js` explaining what `RolesCore` does is not a call to
`RolesCore`.

The rest were **deliberate**. A shared module often reaches for a neighbour it
can live without, because it is written to run on pages that leave half its
neighbours out. `auth.js` reads `KioskCore` on all 31 pages that load it; only
the kiosk loads `kiosk-core.js`. Both facts are correct, and the guard was
calling all 31 a bug.

## Decision

**A module you can live without is marked as optional in the code that reaches
for it, and the guard reads that mark. There is no list.**

### 1. Say it with a check, not an entry in a table

An optional neighbour is written one of two ways, both of which were already
house style before this was decided:

```js
typeof Name !== 'undefined'      // also typeof window.Name / typeof global.Name
window.Name && …
```

A reference wrapped in either is optional by construction — the page is allowed
not to load it, and the code already copes. The guard treats it as no dependency
at all.

**This makes the spelling load-bearing.** From now on, a genuinely optional read
written without a check will be reported as a missing tag, and the fix is to
write the check rather than to excuse the page.

The alternative was a hand-maintained exemption list. It was rejected because a
list needs editing every time somebody adds a module, and because a list rots in
a particular way: entries accumulate, nobody rechecks them, and a real fault
eventually gets added to it by whoever is trying to get the suite green. Reading
the check needs no maintenance and cannot go stale, because it *is* the code.

An exemption list still exists for a genuine oddity, and every entry must carry
its reason. **It is currently empty, and that is the point.**

The check is read **file-wide** rather than per use site: guard a module once
and the whole file is taken at its word. Proximity rules — "the check must be in
the same function" — are fragile and hard to state, and the failure they would
prevent (a file that guards a module in one place and forgets in another) is
rarer than the false alarms they would cause. The cost is real and is worth
naming: that file is believed.

### 2. Order binds for two spellings, presence for all three

Spellings 1 and 2 capture a value **as the script parses**. If the module is not
there yet the captured value is `undefined` for the life of the page, so the tag
must be present *and* earlier.

Spelling 3 runs long after every script on the page has run. Position cannot
matter, and asserting it would fail honest code.

| Spelling | Binds | Checked for |
| --- | --- | --- |
| `: global.Name` | load time | presence **and** order |
| `const Alias = window.Name;` | load time | presence **and** order |
| bare `Name.member` | deferred | **presence only** |

This is the only place the two rules part company.

### 3. Comments and strings are removed before anything is read

Not a refinement — a correctness requirement, and the source of most of the
original noise. Removed spans become spaces of the same length so reported line
numbers still point at the real line.

### 4. A global is credited to the file that assigns it

The map of which file publishes which global was built with `global.X\s*=`,
which also matches `global.EventsStore === 'undefined'` — `\s*=` matches the
first `=` of `===`. Files are read in directory order, so `away-store.js` claimed
`EventsStore` from `events-store.js`.

Nothing was broken by this only because nothing used the narrow spelling of that
global. The first person who did would have been sent to the wrong file.

The pattern is now `=(?!=)`, and the test that guards the map asserts over the
**whole** map — no global may be credited to a file that never assigns it. The
previous test named four globals from MS-20 and would have passed throughout.

## Consequences

**The guard now fails when it should, and that is tested.** A guard that reports
nothing is indistinguishable from a guard that sees nothing, which is the state
this one was in. Two deliberate breakages — a missing tag behind a bare read, and
a load-time capture placed before its module — are pinned as fixtures, so the
guard's own blindness is now a test failure rather than a silence.

**The backlog was not a backlog.** With all four decisions in place the guard
reports exactly **one** real fault across the whole site: `service-builder.html`
loads `calendar-event.js`, which captures `window.FamilyCore` and calls
`servingGroups` when the Roles picker opens, on a page that never loads
`family-core.js`. Opening that picker gave an empty box. Fixed with the ticket.
The "about 25 pairs" was the noise of an untaught guard.

**A contributor has a new rule to know**, and it is the price of not having a
list: mark an optional neighbour with a check. The rule is stated in the test's
own header as well as here, because that is where somebody meets it.

**A top-level bare read is not order-checked.** `const x = RolesCore.thing()` at
module scope binds at load time but is treated as spelling 3. The house style
captures through `window.` instead, which *is* checked, so this is a gap in
coverage rather than in the codebase. Closing it means following an alias, which
means a real JavaScript parser, which is a much larger change than the fault
justifies. Recorded here rather than solved.

**No production module changed.** The whole mechanism lives in one test file.
The `global.Name =` publishing tail stays exactly as it is, and nothing here
reopens the question of whether these pages should use a module system.
