# MS-481 — Church printer booklet / saddle mode

A Printable prints two ways.

**Print folio** is the service guide editor's print. Mosaic pairs
pages onto landscape sheets (two pages each) in saddle-stitch order,
the same pairing as `GuideEngine.imposeSpreads`. Blank leaves pad
the count to a multiple of 4. A half-letter page lands on letter
landscape (`11in × 8.5in`). Fold that stack. Leave the copier's
booklet / saddle mode **off** — it would impose a second time.
Any Printable can take this path from the editor's File menu or
the view-only page. It is not limited to the Sunday booklet.

**Print** (and the event PDF snapshot) stay a **flat** stack
(page 1, page 2, page 3, …). On the Sunday booklet path the count
is a multiple of 4. A copier set to Booklet / Saddle Stitch /
Fold & Staple folds that stack itself. Software does not reorder
this path.

## Why ×4

A saddle-stitched booklet is a folded stack. Each physical sheet
holds four booklet pages (front-left, front-right, back-left,
back-right). A 5-page document cannot fold cleanly; a 8-page one
can. On the **Sunday booklet Printable path** (a project that
binds `sunday_typed` / `sunday_hymns`, or has `bookletExport`),
flat print and PDF export pad with empty white pages so
`pageCount % 4 === 0`. Other Printables print flat as laid out
(MS-592) — a one-page directory is not forced to four leaves.
Folio print pads every Printable, because the fold needs four pages.

## Operator steps — folio (same as the service guide)

1. Open the Printable (editor File menu, or the view-only page) and
   choose **Print folio**.
2. The dialog's paper is one landscape sheet per pair of pages
   (letter landscape for a half-letter Printable). Print double-sided
   the same way the service guide is printed.
3. Leave **Booklet** / **Saddle Stitch** off. Fold the stack.
4. Print one proof and check page order before the Sunday run.

## Operator steps — flat stack (copier booklet mode)

1. Open the Printable and **Print**, or file a PDF snapshot from
   the Sunday event's Files tab.
2. On the Sunday booklet path, confirm the page count is a multiple
   of 4 (the view page names how many blanks were added).
3. On the church printer, choose **Booklet** / **Saddle Stitch** /
   **Fold & Staple** (wording varies by model). Feed the **flat**
   stack. Duplex and booklet mode together fold it so the guide
   reads in order.
4. Print one proof, fold it, and check hymn page order and the
   typed prayer / Kids / announcements pages before the Sunday run.

Do **not** turn on booklet mode for a folio print, and do **not**
turn on a second booklet option in the browser dialog when the
copier is already in booklet mode — either one imposes twice.

## What Mosaic does not do

- No reordering on the flat **Print** path or the filed PDF snapshot
- No change to ADR-0057 snapshots (the filed PDF is still the
  frozen copy of live pages; Sunday booklets stay padded, flat)
- No auto-clear of the MS-401 HITL gate (MS-454). A real Sunday
  booklet still has to be printed and handed out.

Folio print is the software imposition path, and only when someone
chooses **Print folio**.
