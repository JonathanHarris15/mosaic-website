# MS-481 — Church printer booklet / saddle mode

v1 folding is **the printer's job**. Mosaic exports a **flat PDF**
(page 1, page 2, page 3, …) whose page count is a **multiple of 4**.
Blank pages are appended as needed. Software does **not** reorder
pages into saddle-stitch spreads.

## Why ×4

A saddle-stitched booklet is a folded stack. Each physical sheet
holds four booklet pages (front-left, front-right, back-left,
back-right). A 5-page document cannot fold cleanly; a 8-page one
can. On the **Sunday booklet Printable path** (a project that
binds `sunday_typed` / `sunday_hymns`, or has `bookletExport`),
print and PDF export pad with empty white pages so
`pageCount % 4 === 0`. Other Printables print as laid out
(MS-592) — a one-page directory is not forced to four leaves.

## Operator steps (church copier)

1. Open the Printable (editor or view-only page) and **Print**, or
   file a PDF snapshot from the Sunday event's Files tab.
2. Confirm the PDF page count is a multiple of 4 (the print path
   pads; the view page names how many blanks were added).
3. On the church printer, choose **Booklet** / **Saddle Stitch** /
   **Fold & Staple** (wording varies by model). Feed the **flat**
   PDF. Duplex and booklet mode together fold the stack so the
   Sunday guide reads in order.
4. Print one proof, fold it, and check hymn page order and the
   typed prayer / Kids / announcements pages before the Sunday run.

Do **not** turn on a second "booklet" or "impose" option in the
browser print dialog if the printer is already in booklet mode —
that would impose twice.

## What Mosaic does not do

- No software page imposition / signature reordering
- No change to ADR-0057 snapshots (the filed PDF is still the
  frozen copy of live pages, now padded)
- No auto-clear of the MS-401 HITL gate (MS-454). A real Sunday
  booklet still has to be printed and handed out.

## If printer booklet mode fails

File a follow-up Feature. Do not add an imposition engine in a
hotfix on this path.
