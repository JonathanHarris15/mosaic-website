# Hymn book — design pull

Cold pull. The handed file was a Claude Design bundle (`Mosaic Hymns.html`). There was no `-snapshot.html` and no `-prompt.md` under `docs/design/`. Decisions below are the ones this port used. The design won wherever it and the previous page disagreed, except the overrides named at the end.

## Real

- Hymn list, one hymn, and the editor. Same three views, same `hymns` documents.
- Search across title, both writers, attribution, and tags. Tag filter is AND.
- Add hymn, for someone who may write the book. Edit, Save, Cancel.
- Copy attribution. Download a sheet page. Crop. Add and remove pages and versions.
- The version that prints (`default`). Tags on the hymn and the tag collection.
- Words (`lyrics_writer`), music (`music_writer`), attribution, hymn name.
- Toast for “Attribution copied.” and the other confirmations.
- Phone shell adopts the header actions. Desktop drawer on the list (MS-697).

## New (taken)

- The list is sheet cards, not text rows. The card’s picture is the printing version’s first page.
- The card’s second line is the words writer only.
- Tag rail: a checkbox row per tag, with the count that tag would leave in the list. Chosen tags also read “Tagged with all of”.
- Search placeholder is “Search the book”.
- A hymn opens as pages on the left and a fact rail on the right: name, “Words — … · Music — …”, tag badges, versions, attribution.
- Choosing a version shows that version’s pages. It does not change which version prints.
- The star that sets which version prints lives in the editor. Save writes it, the same as the rest of the draft.
- Copy attribution and Edit live in the header. Cancel and Save live in the header.
- Delete hymn lives on the editor’s rail.
- The header title stays “Hymns”. The record’s name is the rail heading. Back from a hymn or the editor says “All hymns”.
- Add page accepts a chosen file or a dropped scan, and the new page arrives with that file.
- Empty tag filter: “No hymn carries all of those tags. Take one away to widen the list.”

## Scaffolding (not built)

- The sample book (Holy, Holy, Holy, and the rest) and the “JH” avatar. Real hymns and the account slot stay.
- Staff-line rectangles stand in only when a hymn or a page has no scan.
- “Last sung” and “times in all” are in the prototype’s script and not on the screen.
- The drag handle on a page. The prototype did not reorder pages, and neither does the book.
- A new hymn does not start with an empty “Hymnal” version. Add version is the control.

## Overrides

- Wide desktop keeps the app drawer on the list instead of a Home back. Home remains the back link below the drawer breakpoint.
- Delete uses `m-btn--danger-outline`, the destructive button the system already has.
- A search that matches nothing, with no tags chosen, still says “No hymns match.” The tag sentence would be false there.
- The bar is the standing header, not `m-header--tool`, so Copy attribution and Cancel keep their words.
