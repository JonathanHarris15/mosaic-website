# Arena candidate 1 — the query builder prints what the Service Guide printed

Branch `cursor/arena-query-builder-candidate-1-8540`, on top of
`cursor/printables-hotfixes-0da3` (`1a16848`). No custom tags came back: a
Printable is still a tree of boxes with a **Repeat**, a **query** and
**Bindings** (ADR 0056 / 0057). Everything below grows the existing catalog
(`public/printable-data-core.js`) and the existing query builder. There is no
second data engine and no new source.

## The short version

A 5-Sunday preaching schedule is **one iterated row over the Sundays list**.
Pick **Sundays** in the query builder and it is already set up for that job:
**5 Sundays from this Sunday**, **every Sunday** whether or not anybody has
written it yet, and **TBA** wherever nothing is written. Wire three fields
onto the row's three text elements and you have the old
`<preaching-schedule>`, without a tag and without any day math.

## What I built

### 1. Sundays counts Sundays from a Sunday (`sundays`)

- **A new way to count the range.** The range can now be "*N* Sundays from
  last / this / next Sunday, or from a date you pick". It sits beside the
  existing *From today* (days) and *Fixed dates*. It is stored as
  `{ mode: 'weeks', count, start }`, where `start` is the same `when` shape the
  single Sunday already uses. The count is whole, at least 1 and at most 52.
  The drawer reads the range back in words: "For the 5 Sundays from this
  Sunday."
- **The Sundays list defaults to that:** 5 from this Sunday. The old default
  was a 14-day relative window, which is a fortnight, not a schedule.
- **Every Sunday in the count is a row, written or not.** That is the
  ServiceDatesCore rule: a Sunday exists whether or not anybody has written
  it, and the Services list draws every one. Which Sundays there are is
  arithmetic, and the services only fill them in. A service written on
  another day inside the count (Christmas Day) is listed too, because the old
  guide printed those.
- **Filter "Which Sundays":** *Every Sunday* (the default) or *Only Sundays
  already planned* (what the old guide did).
- **Filter "Not planned yet reads as":** text, `TBA` by default. It fills
  every empty field of a row, except the date, the short date, baptism
  candidates and a hymn the Sunday has dropped. A Sunday is not going to
  "announce" its date, a baptism, or a hymn that was taken out. Blank the box
  and the rows fall back to each element's **Stand-in**, and the drawer lists
  every gap under **Not all data could be pulled**, dated in words ("No
  preacher for Sunday 4 October 2026.").
- **The whole Sunday is on the row.** Short date ("Sep 27", the designed
  guide's column), preacher, sermon passage, theme, key verse, service and
  music leaders, prayers, every scripture slot, every hymn slot and baptism
  candidates. The single Sunday and the list share one row builder
  (`sundayRow`) and one field list (`SUNDAY_FIELDS`), so they cannot drift.
  This also means a **list of one Sunday from this Sunday reads this Sunday**:
  a cover can be built in the query builder without putting singles in it.
- **Guard rails.** A range wider than 520 Sundays (ten years) is cut there,
  with a warning, so a typo of a century neither loops nor fetches that much.
  An empty list says why: "Nothing is planned yet for the 5 Sundays from this
  Sunday." or "There is no Sunday from … to …".

### 2. The query builder UI (`printable-editor.html`, `printable-editor-data.js`)

- The range control reads **[Sundays] [From today] [Fixed dates]** on the
  Sundays list, and **[Weeks] …** on event dates. The unit comes from the
  catalog (`unit` on the range param).
- In the counted mode it shows **How many Sundays**, **From which Sunday**
  (Last / This / Next, or a date), and the range in words.
- Switching mode starts from the catalog's own default for that mode
  (`rangeForMode`). Pressing the mode that is already on keeps the editor's
  numbers.
- A text filter can say what an empty box means: the placeholder reads
  "Blank: the stand-in shows", not "any".
- The row preview names rows by name, slot or **date in words**, never
  `2026-09-27`.
- **Not all data could be pulled** is visible again. It had been moved inside
  the hidden catalog block when the old catalog was hidden (`670fbba`), so
  the drawer never showed a warning. It now sits above that block.

### 3. Other common jobs the data connection could not do

- **Which hymn** filter on the Sunday hymns list: one liturgy slot's sheet
  music (the closing hymn page on its own), with "No closing hymn is planned
  for …" when that slot is empty.
- **Event dates count weeks from a Sunday** the same way ("the 8 weeks from
  this Sunday"), and gain **Short date** and **Day of the week** fields.
- **A rota on event dates, for editors.** An editor may pick **Who is down
  for** a Role. Each date then gets a **Who is down for the role** field:
  whoever has confirmed, else whoever was asked. Somebody who declined is not
  down. The drawer warns "Pete has not confirmed Sermonette on 8 October 2026
  yet." A member is never offered the role or the field. A member opening an
  editor's rota gets the dates only: `resolve()` strips the field, and the
  resolver does not work out holders or warnings below `ROTA_LEVEL`. The
  store reads whole rosters only for editors (EventsStore `staffingFrom`).
- **Dated gaps say which date.** An empty field on an event date names the
  event *and* the date, so a rota with two empty weeks does not print the
  same line twice.

### 4. Domain notes

The `CONTEXT.md` **Data drawer** entry now says how Sundays counts, what an
unwritten Sunday reads, that a list of one Sunday reads this Sunday, and that
the rota is an editor's. The **Stand-in** entry now says TBA is text the
editor chose, not a stand-in.

## How an editor sets up a 5-Sunday preaching schedule

1. On the page, add a heading and a **header row** box with three text
   elements typed as labels: Date, Preacher, Sermon text. Nothing is wired to
   these.
2. Under it, add a **row** box with three text elements. Type stand-ins into
   them (Jul 27, Preacher, Text) and arrange the row across.
3. Select the row box. The Data drawer offers **Make this element iterated**.
   Press it.
4. In the query builder, pick **Sundays**. Nothing else needs setting: **5
   Sundays from This Sunday**, **Every Sunday**, **Not planned yet reads as
   TBA**. The drawer says "For the 5 Sundays from this Sunday." and "5 rows
   today", and lists the five dates in words.
5. Drag **Short date (Sep 6)** onto the first text, **Preacher** onto the
   second, and **Sermon passage** onto the third. The canvas draws five rows
   straight away:

   | Date | Preacher | Sermon text |
   |---|---|---|
   | Sep 27 | Pastor Sam | Romans 8 |
   | Oct 4 | TBA | John 3 |
   | Oct 11 | TBA | TBA |
   | Oct 18 | Guest Gil | Luke 15 |
   | Oct 25 | TBA | TBA |

6. Optional adjustments:
   - **Which Sundays → Only Sundays already planned** prints the old guide's
     list (3 rows in this example).
   - Type "—" instead of TBA, or blank it so the stand-ins show and the drawer
     lists what is missing.
   - **How many Sundays → 8** for a two-month card.
   - **From which Sunday → Next** for next week's bulletin.

The Printable stores the wires and the query (`{ source: 'sundays', params:
{ range: { mode: 'weeks', count: 5, start: { mode: 'this' } }, which:
'every', notPlanned: 'TBA' } }`), never the names. Next month it shows next
month's five Sundays.

## Alternatives considered and rejected

- **A new `preaching_schedule` source.** The schedule is Sundays with the
  right defaults and fields. A second source would copy the Sunday row, split
  every later fix in two, and give an editor two lists that almost agree.
  GROUNDING asks for `sundays` to grow unless a new seam can be defended, and
  I could not defend one.
- **Reviving `<preaching-schedule>` / `<mosaic-schedule>`, or any tag.**
  Ruled out by ADR 0056 and the brief. A tag hides its layout from the
  element panel. A Repeat does not.
- **Copying the old guide: a relative +35-day window and a cap of five
  rows.** That takes two knobs to say "five Sundays", and the editor does the
  day math. A row cap would also be a second, data-side version of the
  Repeat's own per-page cap. The old guide's cap reached into a sixth Sunday
  to fill five rows when one was unplanned. "5 Sundays" now means those five
  Sundays, which is what an editor asks for.
- **Only planned Sundays by default** (the old guide). A schedule with holes
  reads as "no service that week", and the Services list draws every Sunday
  (ServiceDatesCore). It is still one choice away.
- **Using each element's stand-in as the TBA.** A stand-in means "no data
  here", and every one is listed as a gap. A normal schedule would open with
  ten warnings, and "TBA" would have to be typed into every element's
  design, so the Stand-ins switch would stop showing the design. An unwritten
  Sunday is an answer ("to be announced"), not missing data. Blanking the TBA
  still gives the stand-in behaviour to those who want it.
- **Hard-coding TBA, as the old guide did.** Churches print "TBA", "—" or
  nothing. It is a filter with TBA as its default.
- **A "when empty" text on each wire.** A wire says which field feeds which
  element (ADR 0057). A per-wire fallback is a value stored per element,
  needs UI on every wire, and cannot tell "this Sunday is not written yet"
  from "this field is empty". That is a fact about the Sunday, so it belongs
  in the query.
- **Putting singles (this Sunday, booklet text) into the builder.**
  `CONTEXT.md` says singles are not in the builder. A list of one Sunday
  reads the same fields through the same row, which covers the cover-page job
  without reopening that decision.
- **Sundays only, skipping services written on weekdays.** The old guide read
  every service document in its window, so Christmas Day and Good Friday
  printed. Leaving them out would lose that.
- **A holder field named after the role** (a "Sermonette" column).
  `resolve()` strips fields above the viewer's level from the static field
  list. A field made up at run time would slip past that strip and read a
  roster out to a member. The field is a fixed `holder`, at editor level.
- **A new "rota" source.** Event dates already are the dates. A role param
  and one field on the existing source is the smaller change, and it keeps
  weeks mode, the series filter and the cancelled-date rules in one place.
- **A source warning for every date with nobody down.** The drawer already
  lists each empty wired element per row, so it would say everything twice.
  Only "has not confirmed" is a source warning, because the row cannot show
  that.
- **Field labels in gap messages** ("No key verse" rather than "No keyVerse").
  An item wire stores only its field key, and `printable-render-core` does
  not pass the list's source to `valueFor`. Doing this properly means
  threading that source through the pure render module, so it is left as a
  follow-up.

## Behaviour changes to know about

- **Stored Sundays queries change.** A query built before this change still
  runs. It now lists every Sunday in its window and reads TBA where nothing is
  written. Choosing *Only Sundays already planned* and blanking TBA gives the
  old output.
- **Dropped hymns read blank on the single Sunday** (`removedHymns`), as they
  did on the old guide. Before this they printed the hymn anyway.
- **Sermon passage falls back to the service's top-level `sermon`** when the
  liturgy slot is empty. The Order of Service slot wins when both are set.
  The old guide preferred the top-level field.
- **Limits.** The Sundays list stops at 520 Sundays, with a warning. A
  counted range stops at 52.
- **A member opening an editor's rota Printable still requests roles and
  people.** `needsFor` does not know the viewer's level. Reads the rules
  refuse degrade to empty, and the resolver works out no rota below editor,
  so nothing leaks, but the reads are wasted.

## Follow-ups I did not build

- Sunday booklet text on the Sunday row, for a multi-week bulletin.
- Announcements as a list (one row per announcement) rather than one block of
  booklet text.
- A "birthdays this week / this month" filter on People.
- Services built from a custom `elements` array on the Sunday row and on
  `sunday_rows`.
- Field labels in gap messages (see the last rejected alternative).

## Permission boundary

- No new source. `sundays` and `event_dates` stay viewer-level, and nothing
  elder-only was added.
- The rota's role param, field and roster work share `ROTA_LEVEL = 'editor'`.
  Tests pin the builder hiding the param and the field from a member, the
  field being stripped from a member's rows, and a member's warnings carrying
  no names.
- No `firestore.rules` or `storage.rules` edits, and no deploy.

## Verification

- Tests came first at the data-core, editor-query and live seams:
  `test/printable-data-core.test.js`, `test/printable-editor-query.test.js`
  and `test/printable-live.test.js`. `node scripts/sync-shared-to-functions.js`
  was run after every data-core edit.
- `npm test`: 5000 tests, 4981 pass, 0 fail, 19 skipped (emulator suites).
  `npm run lint --prefix functions`: exit 0.
- **The real editor on local emulators** (`demo-*` project, throwaway
  harness outside the repo). The steps above were driven end to end and
  produced exactly the five rows in the table. *Only planned* gave 3 rows. A
  blank TBA gave the stand-ins plus five dated gaps. *8 Sundays* ran to 15
  November. The preview listed dates in words. Evidence captured in this run:
  `candidate_1_building_five_sunday_preaching_schedule_in_query_builder.mp4`,
  `candidate_1_query_builder_five_sundays.png`,
  `candidate_1_preaching_schedule_live_tba.png` and
  `candidate_1_blank_shows_stand_ins_and_warnings.png`.

## Files changed

- `public/printable-data-core.js` and the synced copy
  `functions/shared/printable-data-core.js`: weeks ranges, `describeRange`
  units, `rangeForMode`, `SUNDAY_FIELDS` / `sundayRow`, the Sundays filters
  and resolver, the hymn slot filter, event-date weeks / short date / weekday
  / rota, `needsFor`, `describeParams`.
- `public/printable-editor.html` and `public/printable-editor-data.js`: the
  counted range control, the role picker, placeholders, preview names, and
  the warnings section outside the hidden catalog.
- `public/printable-live.js`: dated row naming in gap messages.
- `CONTEXT.md`: the Data drawer and Stand-in entries.
- Tests: `test/printable-data-core.test.js`,
  `test/printable-editor-query.test.js`, `test/printable-live.test.js`.

## Disclosure

- I read `/tmp/arena-query-builder/FRAME.md`, including its rubric, early on.
- `/workspace` was shared with candidate 2 at the start. I saw one line of
  their diff before moving to my own worktree
  (`/home/ubuntu/worktrees/arena-candidate-1`), and I did not use it.
