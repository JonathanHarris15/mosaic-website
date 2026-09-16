# ADR 0065 — An Elder Document is stored as Blocks

**Status:** Accepted
**Date:** 2026-09-16
**Follows:** [ADR 0062](0062-a-shepherding-document-is-held-paragraph-by-paragraph.md), which made every paragraph of an Elder Document a box, and [ADR 0034](0034-a-sunday-saves-the-fields-you-changed.md), which saves only the fields you changed.

## Context

ADR 0062 said each heading, paragraph, list item and table cell of an Elder Document saves on its own. An Elder Document kept its whole Note Body in one field, `contentJson`. One field cannot be saved a paragraph at a time: two elders in two paragraphs each wrote the whole body, and the second undid the first.

## Decision

**The body is a map of Blocks, one field per block.** `blocks.<id>` holds `{ type, attrs?, parent, order, content? }`:

- `id` is the block's lasting id, carried in the editor as the `blockId` attribute. Enter, paste and undo never hand one id to two blocks; the block that was already there keeps it.
- `parent` is the id of the block it sits inside (a list item inside a list, a cell inside a row), or null at the top.
- `order` is a fractional key among its siblings. A block goes between two others by taking a key between theirs, so inserting never renumbers, and never writes, any other block.
- `content` holds a text block's inline content (words and marks). A structural block (a list, a table, a row) has none; its children say what is in it.

A save writes only the changed blocks, each at `blocks.<id>` with a segmented field path, and deletes removed ones the same way. Two writers changing different blocks write different fields.

**Rebuilding the body never drops a word.** A block whose parent is missing, or that sits somewhere its type cannot, goes at the end of the document, wrapped so the document stays valid; a text block holding children keeps both. `bodyOfBlocks(blocksOfBody(body))` gives back the same body, apart from ids.

**A legacy document is converted once, in a transaction.** A page or tool opening a document that still has `contentJson` and no blocks converts it inside a transaction that writes only if there are still no blocks. It is converted only if the round trip gives back exactly the same body. If it doesn't, the page opens the document read-only and the assistant refuses the write, so nothing is written over it. A migration script converts the rest in advance. It is a dry run by default and safe to run twice.

**The rules refuse a whole body onto a Blocks document.** A page from before this change would save `contentJson` beside the Blocks, unread, and its writer would think it had saved. The rule refuses that update instead, so that page says it could not save.

**`blocks` is not indexed.** Nothing queries inside a body, and one index entry per block field would count toward Firestore's per-document index limit.

A Person Panel is one block; its words stay on its Shepherding Note. A Care List and a Form Document are not stored this way; they already save one field per cell or answer.

## Consequences

- Every writer (the web page, the phone, the assistant, a profile deleting a note) reads and writes through `DocumentBodyCore`. A writer that sets `contentJson` on a converted document is refused.
- Undoing this means converting every document back to one body value. Possible (the rebuild exists) but not free.
- Firestore's 1 MiB document limit still applies to the whole document. Blocks change how a document is saved, not how big it can be.
- Two elders can edit different paragraphs at the same moment and both edits stand. The same paragraph is prevented by the box lock (ADR 0062), so it never needs merging.
