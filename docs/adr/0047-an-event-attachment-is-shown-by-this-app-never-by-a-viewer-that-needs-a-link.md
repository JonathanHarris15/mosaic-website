# ADR 0047 — An Event Attachment is shown by this app, never handed to a viewer that needs a link

**Status:** Accepted
**Date:** 2026-09-01
**Supersedes one consequence of:** [ADR-0046](0046-an-event-attachment-is-fetched-never-linked.md)

## Context

The Files tab landed with one door on a file: clicking it saved it. The ask that
came back was the obvious one — *Google Drive lets me open a .docx in Docs or
download it; a PDF opens on the web or downloads. Do that.*

ADR-0046 had already written down why it did not:

> **Files download rather than open in a tab.** A blob cannot be handed to a new
> tab as reliably as a URL can, so a PDF saves instead of previewing.

That sentence conflated two things, and only one of them is true.

**Handing the file to Google is impossible, and always will be.** Docs, Sheets,
Slides, the Office web viewer and Drive's own previewer all open a file the same
way: their servers fetch it from an address anyone can read. Giving Google that
address means giving it to everyone — signed out, forever, whatever
`storage.rules` says about who may see the Event. That is precisely the hole
MS-287 spent a week closing, and no amount of wanting the feature reopens it.

**Drawing the file ourselves was never impossible.** The bytes already arrive in
the browser, as a blob, over a request carrying the reader's own token. A
browser will render most of them with no help at all, and the one common format
it will not — a Word file — is read by `mammoth`, which this codebase already
carries for the Service Guide.

So the wanted thing and the forbidden thing were not the same thing.

## Decision

**An Event Attachment opens where it already is.** The blob fetched under
ADR-0046 is rendered inside the Event page. No URL leaves the browser that
fetched it, and no third party is asked to read anything.

`EventAttachmentsCore.previewKindFor(name, contentType)` names the renderer, or
`null` for "there is nothing to show". Clicking a row shows the file when it can
be shown and saves it when it cannot — one click, no menu, which is what Drive
does.

| Renderer | Files | Drawn by |
| --- | --- | --- |
| `pdf` | `.pdf` | the browser's own PDF reader, in an `<iframe>` |
| `image` | `.png .jpg .jpeg .gif .webp .bmp .avif .svg` | `<img>` |
| `docx` | `.docx` | `mammoth`, loaded on demand, output sanitised |
| `text` | `.txt .md .markdown .log .json .xml .yml .yaml .ics .vcf .srt .css .js .html .htm` | `<pre>` |
| `sheet` | `.csv .tsv` | parsed here, drawn as a table |
| `audio` | `.mp3 .wav .m4a .aac .oga .ogg .flac` | `<audio controls>` |
| `video` | `.mp4 .webm .m4v .mov .ogv` | `<video controls>` |
| none | everything else | nothing — it downloads |

Four of those rows are decisions rather than lists:

1. **An `.html` attachment is shown as text, never rendered.** A blob URL
   inherits the origin of the page that made it, so an uploaded page would run
   its script beside the reader's signed-in session. It gets read, not run. The
   PDF path is the deliberate exception: the renderer there is the browser's own
   locked-down reader, not our JavaScript.

2. **`.docx` output is sanitised before it is written into the page.** Mammoth
   emits paragraphs, headings, lists and tables — but a Word hyperlink carries
   whatever address it was given, and Word will carry `javascript:`. Only an
   editor can attach a file, so this is a low door; it still costs nothing to
   shut.

3. **`.heic`, `.heif` and `.tiff` are absent from `image` on purpose.** Only
   Safari draws them. A broken picture in a box is a worse answer than an honest
   "download it to look at it".

4. **`.xlsx` has no renderer, and `.csv` does.** Reading an `.xlsx` needs a
   parser carried in full — every `<script>` this site loads is vendored
   locally, tracked in `scripts/asset-manifest.mjs` — and the last version
   published to a CDN has a prototype-pollution hole in exactly the code that
   would read an uploaded file.

   *(Correction, 2026-09-01: this originally said "nothing loads from a CDN",
   which is not true. `shepherding-care-list.js`, `shepherding-document.js` and
   `shepherding-profile.js` import TipTap from `esm.sh` at runtime on the web —
   35 dynamic imports the asset manifest does not know about. The vendoring
   policy holds for script tags and is what this decision rests on; the absolute
   claim was wrong.)* A `.csv` is a spreadsheet that can be read with thirty lines of pure
   function, so it is. The same goes for `.doc`, `.xls` and `.ppt`: pre-2007
   binaries with no browser-side reader worth carrying.

## Consequences

**ADR-0046 is unchanged where it matters and wrong in one paragraph.** Every
byte is still fetched with the reader's credentials, the rule is still asked on
every read, and the record still carries no URL. Only the closing "files
download rather than open" consequence is retired.

**One fetch serves both doors.** The blob behind the viewer is the blob behind
its Download button, so saving what you are looking at costs no second trip
through the rule — and no second pair of Firestore reads.

**The list of what opens is a list, and lists rot.** Something will eventually
be attached that this could show and does not. That is a one-line addition to
`PREVIEW_BY_EXTENSION` with a test beside it, which is the cheapest kind of
wrong to be.

**A viewer is a page-weight decision, not just a feature.** `mammoth` is loaded
only when somebody opens a Word file, never in the page head. Any future
renderer must arrive the same way, or the Event page pays for it on every visit.

**The phone app gets this for free, and may render less of it.** It is the same
page inside Capacitor. Where a WebView refuses a format — an `.mov` holding a
codec it does not have — the viewer says so and the Download button is still
there.
