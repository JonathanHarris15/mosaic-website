# PRD shape (Mosaic)

A ticket may not sit right of **To Plan** without a PRD. `To Do` is a promise the thinking is finished.

Lead the description with:

```text
> **PRD.** Planned YYYY-MM-DD. <one line of context — who asked, which ticket this split from>
```

Then these sections, in this order. Skip a section only when it cannot apply (a one-line Task may omit User Stories). Do not invent product behavior to fill a hole — name the hole.

1. **Problem** (or Problem Statement)
2. **Solution**
3. **User Stories** — Features; numbered; use domain words from `CONTEXT.md`
4. **Implementation Decisions** / **Locked decisions** — what is settled and must not be re-litigated
5. **Acceptance criteria** — observable; checkboxes
6. **Testing** / **Testing Decisions** / **Named verification plan** — real commands (`npm test`, `npm run lint --prefix functions`) or a named manual matrix
7. **Out of scope**
8. **Risk** — what a wrong gate or a missed refuse path would do
9. **Prototype** — path if one exists; otherwise omit
10. **Build order** — subtasks = commits on one parent PR / branch

Examples of this shape on the board: MS-247, MS-543, MS-594, MS-601, HAS-187.

Do not replace a ticket’s existing PRD. Append a dated refinement only when Jonathan (or Grok Bot escalating a crucial decision) changes a lock.
