# ADR 0056 — A Printable is a tree of boxes, not a template of tags

**Status:** Accepted
**Date:** 2026-09-03
**Ticket:** MS-359 (the Printables epic), decided in MS-393
**Supersedes, for Printables:** the page model of [ADR 0008](0008-service-guide-template-system.md)

## Context

Two service-guide systems have been built. The first was eight hardcoded page
types. The second — ADR 0008's Page Template engine — stores each page as **a
string of HTML** with **developer-authored custom tags** (`<hymn-1>`,
`<oos-list>`) that a code catalog resolves. It is a good engine, and it was
the wrong shape for what the church actually asked for next: an editor who
lays a page out **by hand** — draws a box, drops text in it, styles it like
CSS, wires a field onto it, and says "repeat this once per member".

That request has three consequences a string of HTML cannot meet:

- **A visual editor needs to address elements.** Select this box, move that
  text under it, set its padding. A string has no elements until it is
  parsed, and a parse-edit-serialise loop on every click loses anything the
  serialiser does not understand.
- **Bindings live on elements, not in tags.** "This image shows each
  person's photo" is a fact about *that* image. In the tag model it would be
  a new tag per field per source — the catalog would have to grow a tag for
  every field the drawer offers, which is the developer bottleneck the brief
  set out to remove.
- **Iteration needs a subtree, not a placeholder.** "Repeat this card" means
  repeat *these nested elements*, with each descendant's bindings read
  against the row. ADR 0008 chose not to add a loop construct at all, and
  decomposed the liturgy into fixed slots instead; a directory has no fixed
  slots.

## Decision

**A Printable's page is stored as a tree of elements — box, text, image —
each carrying its inline CSS, its bindings and (if it stands for a list) its
repeat. That tree is the record. HTML and CSS are a projection of it.**

The projection round-trips: `PrintableCore.pageToHtml` writes the tree as
HTML with `data-pid`, `data-bind` and `data-repeat` attributes, and
`htmlToNodes` parses it back to the same tree. That is what makes the code
view honest — an editor who prefers to type markup edits the *same* thing the
visual tools edit, and what they type becomes elements again, with their ids
and wires intact where the attributes survived.

Three things follow, and are deliberate:

1. **Every operation is a pure function returning a new page.** Insert,
   update, move, duplicate, wrap. Undo is therefore a stack of snapshots, and
   the editor never mutates a node in place.
2. **The parser is strict.** A tag left open or closed in the wrong order is
   refused with its line number. A page silently rebuilt from a guess is
   worse than one that says no.
3. **Text is one run.** A text element is one string with CSS; bold words in
   a sentence are more elements, not rich text. Rich text is the Note Module's
   job (ADR 0049) and would have made the round trip lossy.

## Alternatives considered

**Keep ADR 0008's engine and add a loop tag.** Rejected: it fixes iteration
and leaves the other two problems — no addressable elements, and a catalog
that grows a tag per field.

**Store the HTML string and parse on open.** Rejected: the canonical form
would then be whatever the serialiser last wrote, and any markup the parser
cannot represent would be lost on the first edit without anyone being told.
Storing the tree makes the loss impossible; the parser only ever runs on what
somebody typed into the code view, where refusing is fine.

**A contenteditable page.** Rejected: a browser's own editing model produces
markup nobody can address or bind, and its output differs by browser.

## Consequences

- Pages are JSON in Firestore, not HTML. Anything that wants the HTML asks
  the model for it.
- The code view can round-trip anything the parser accepts, and refuses the
  rest by line. Unknown tags are kept as-is (a `<section>` survives), so
  markup pasted from elsewhere becomes editable elements.
- The ADR 0008 engine is unchanged and still produces the weekly booklet
  until MS-401's gate is met; the two coexist rather than sharing a model.
