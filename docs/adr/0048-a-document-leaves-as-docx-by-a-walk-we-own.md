# ADR 0048 — A document leaves as .docx by a walk we own, not a service we rent

**Status:** Accepted
**Date:** 2026-09-01

## Context

Documents written in Mosaic — Shepherding Notes, Elder Documents, and soon
documents created from an Event's Files tab — have never been able to leave.
Downloading one as a Word file, and importing a Word file into one, was named as
something that must work and must feel almost seamless.

TipTap sells exactly this, and it is worth being precise about what is on offer,
because the two halves are sold differently:

- **Export** (`@tiptap-pro/extension-export-docx`) converts in the browser and
  needs no credentials at the moment it runs — but the package is published only
  to TipTap's private npm registry, so obtaining it needs a subscription. Entry
  is $49/month.
- **Import** runs through TipTap's cloud at `api.tiptap.dev`. Every Word file an
  elder imports would be uploaded to a third party to be converted.

That second point is the same objection this project already accepted against
Google Docs (ADR-0047): the church's documents leaving the church's project to
be read by somebody else's servers. Buying the export half alone would still be
paying a subscription for a conversion that runs on our own machine anyway.

## Decision

**Both directions are built here, out of libraries we vendor, and nothing is
uploaded anywhere to be converted.**

**Import is mammoth**, which this codebase already carries and already uses in
three places. A `.docx` becomes HTML in the browser, and TipTap parses HTML into
its own schema using the extensions it has registered. Nothing leaves the page.

**Export is a walk we own plus a writer we rent by value, not by subscription.**
It is split in two on purpose:

1. `document-docx-core.js` walks the Note Body and returns a plain description
   of a Word document — paragraphs with a style, list items with a level, tables
   of cells, and runs carrying their marks. Pure, no DOM, no library.
2. `document-docx.js` turns that description into the `docx` library's objects
   and asks it for a Blob.

The split is where the value is. Writing a valid `.docx` means zipping a dozen
XML parts with numbering definitions and relationship files, and the `docx`
library (MIT) does that correctly. But the part that gets things *wrong* is
never the zipping — it is the walk. Which marks survive. Whether a nested list
keeps its level. What a table cell may contain. What happens to a
Cross-Reference. All of that is a pure function of TipTap JSON, so all of it is
tested in Node without the library in the room.

**`document-docx-core.js` is the mirror of `tiptap-render.js`** — the same
switch over the same node types, with Word on the other end instead of HTML.
When the editor learns a new node, both files need the case.

Three smaller decisions inside it:

- **An unknown node is walked through, never dropped.** The editor will grow
  nodes after this file is written. Losing formatting is a bad day; losing words
  is a lost document.
- **A Cross-Reference keeps its name.** An `@`-mention points at a page in this
  app, which a Word reader cannot reach and may not be signed in to. It exports
  as the bold name it was written as.
- **A Person Panel that could not be read says so in the file.** The panel is an
  atom holding only metadata; the words live on the Shepherding Note (ADR-0004).
  A caller that has fetched those notes passes them in and they are inlined. One
  that has not gets the person's name and an italic line saying the note is not
  included — because silently exporting an empty panel is how somebody sends out
  minutes with a person's section missing and never notices.

## Consequences

**The library is 1.1MB, and is loaded on the first click and never in a page
head.** No Event page or profile pays for it. The phone app carries it in its
bundle, which is the real cost of this decision and is accepted for a feature
named as a must.

**Fidelity is bounded by what our documents actually contain**, which is the set
`build/tiptap/entry.js` bundles: headings, paragraphs, bold, italic, underline,
strike, code, highlight, font and size, links, bullet and ordered lists, tables,
hard breaks. Columns, headers and footers, footnotes, comments and track changes
do not exist in the editor, so they cannot be exported, and a `.docx` that
carries them will lose them on import.

**A test can prove the file is right; nothing here can prove Word likes it.**
`test/document-docx-file.test.js` loads the same vendored bundle the browser
loads, builds a real `.docx`, unzips it and reads the XML — so a missing part, a
mark that never reached the XML, or a list with no numbering behind it all fail
the build. What Word itself makes of the file is checked by opening one.

**We are not paying $49/month**, and no church document is uploaded to anybody
to be converted.
