# Document editing: keep TipTap, switch to Lexical, or run an office server?

**Status:** Research, no decision taken
**Date:** 2026-09-01
**Asked because:** document creation needs beefing up in two places — the Event
Files tab, and the way elders write Shepherding Notes.

## The question is really two questions

They look like one ask and they have different answers.

**Writing something new, in Mosaic.** A Shepherding Note, an Elder Document, and
now a document created from an Event's Files tab. The content is ours, the
format is ours, nobody needs it to be a `.docx`.

**Editing a file somebody uploaded, and keeping it that file.** An editor drops
a `.docx` rota on an Event; somebody fixes a name in it; it is still the same
`.docx` afterwards, with its formatting intact.

No rich-text editor on earth does the second one. TipTap can't, Lexical can't,
and neither can any library you could vendor. Converting `.docx` to editable
HTML and back is lossy in both directions — mammoth, which this app already
uses, is deliberately one-way for that reason. The second job needs a real
office suite running somewhere, and that is the only thing Collabora or
ONLYOFFICE is for.

So: **what beefs up writing is not what unlocks editing uploads.** Decide them
separately.

## What is here today, measured

TipTap is not a library choice in this codebase. It is in the domain language
and in an ADR.

- `CONTEXT.md` defines **Note Body** as *"the rich-text content of a Shepherding
  Note or Meeting Minutes record. **Stored as TipTap JSON.**"* Every note ever
  written is that shape in Firestore.
- `CONTEXT.md` defines the **Note Module** as *"the shared **TipTap-based**
  editor component"*.
- **ADR-0004** is titled *"Person Panel — Sync Model and TipTap Node
  Architecture"* and specifies a custom `personPanel` atom node with a NodeView
  hosting a second nested editor.
- ~4,700 lines across `shepherding-document.js` (1,351), `shepherding-profile.js`
  (1,300), `shepherding-care-list.js` (632), `shepherding-inline-triggers.js`
  (439, the `@` Cross-Reference picker), `guide-components.js` (595),
  `shepherding-documents-core.js` (259) and `tiptap-render.js` (110).
- A separate offline bundle, `public/vendor/tiptap/tiptap.bundle.js`, built from
  `build/tiptap/` for the phone app's Care List editor.
- `functions/prayer-request.js` reads TipTap JSON server-side.

Quill is still present but only in the Service Builder — legacy, unrelated.

## Lexical: no

Lexical is good. It is Meta's, MIT, production-proven, and its core is smaller
than TipTap's. None of that is worth what switching would cost here, for three
reasons.

**Its main advantage does not apply to this app.** Lexical's edge over TipTap is
that it was designed React-first and sits well in React 18/19 concurrent
rendering. Mosaic has 28 Alpine pages and exactly one Preact page
(`mobile.html`). There is no React to be first to.

**It is a rewrite, not an upgrade.** The `personPanel` atom node and its
NodeView, the `@` Cross-Reference system, `tiptap-render.js`, the mobile bundle
and the Cloud Function that reads note JSON would all be rebuilt against a
different content model.

**And every note in Firestore would need migrating.** TipTap JSON is
ProseMirror's shape; Lexical's is not. That is a one-way data migration across
every Shepherding Note and Elder Document, to end up with the same features.

The one reason that would justify it — "TipTap is going to start charging us" —
has got weaker, not stronger. TipTap open-sourced ten formerly-Pro extensions
under MIT, and Hocuspocus 4, the self-hosted collaboration backend, is MIT. What
costs money is their **Cloud** (comments, AI, version snapshots), from $49/month.
Self-hosting the same collaboration is free.

## TipTap: keep it, and this is what "beefing up" means

Nothing about the current gap is the library's fault. The work is features:

- **A document created from the Event Files tab.** Same Note Module, stored as
  TipTap JSON in Firestore behind the Event's own visibility rung, listed on the
  tab beside uploaded files. This is the only design that matches what was asked
  for earlier — created here, stored in your project, opened from here.
- **Tables, images and a fuller toolbar** in the note editor. The table
  extensions are already in `build/tiptap/package.json` and unused in anger.
- **Export to `.docx` or PDF**, so a document written here can leave. jsPDF is
  already vendored; `.docx` export would need a writer.
- **Version history and comments**, if wanted. This is the one place TipTap's
  paid Cloud is the easy path, and Hocuspocus self-hosted is the free one — but
  self-hosting means running a WebSocket server, which this project currently
  has nowhere to put. Same infrastructure problem as the next section.

## An office server: the thing Google could not do

Worth taking seriously, and for a reason that is easy to miss.

Google Docs was ruled out because Google's servers must fetch the file from a
link anyone can read, which would put every Event Attachment outside the
visibility rung. **Collabora and ONLYOFFICE do not have that problem.** They
fetch the file through a WOPI endpoint *you* write, on *your* server, with a
token *you* mint after checking the Event's rung. The file stays in Firebase
Storage. Your rules still decide who reads it. And unlike Google's editor, both
are designed to be embedded in someone else's page.

So the instinct that "something heavier" might be the honest answer is right.
The cost is infrastructure this project does not currently have.

**Both need a Linux container running continuously.** Firebase Hosting serves
static files and Cloud Functions are short-lived; neither can host this. It
would be Cloud Run or a VM.

**ONLYOFFICE Docs Community** asks for a single core at 2 GHz and 2 GB RAM as a
bare minimum, and for production suggests dual core, 4 GB RAM, 40 GB disk and
4 GB swap. It is AGPL v3. Version 9.4 removed the old 20-simultaneous-connection
cap from the Community edition and collapsed the architecture into a single
process with no RabbitMQ or database — which makes self-hosting materially
easier than it was.

**Collabora Online** budgets roughly 10 users per CPU thread and 50 MB of RAM
per user plus 1 GB for the system. It is self-host-only; Collabora sells support,
not hosting.

**The bill is the part to price before committing.** On Cloud Run, keeping one
instance always warm is the only way to avoid a cold start of a heavy container
every time somebody opens a document — and always-warm at 2 vCPU / 4 GB is a
real monthly line item for a church. Scaling to zero makes it free most of the
time and slow exactly when someone uses it. That trade needs a number on it, not
a guess, and neither of us has one yet.

**And you would be writing a WOPI host**: a small service answering "who is
this, may they see this Event, here are the bytes, here is where to put them
back". Not enormous, but it is a new server with new rules, restating the
visibility ladder in a third language after `firestore.rules` and
`storage.rules` (see ADR-0046's note on the cost of that).

## Recommendation

1. **Keep TipTap.** Switching to Lexical is a rewrite and a data migration that
   buys nothing this app can use.
2. **Build Files-tab document creation on the Note Module you already have.**
   Stored as TipTap JSON, behind the Event's rung. This is decision-free and can
   start now.
3. **Treat the office server as its own decision, with a spike before a
   commitment.** It is the only real answer for editing uploaded `.docx` and
   `.xlsx` in place, and it is the one that keeps the file in your Storage —
   but it is a new always-on service, a new bill and a new permission surface.
   ONLYOFFICE looks the better of the two now that 9.4 has dropped the
   connection cap and simplified the deployment.

## What is still unknown

- Does anyone actually need to **edit an uploaded `.docx`**, or only to read
  one? Everything above hinges on this, and it has not been asked of the people
  who use it.
- What is the real Cloud Run bill for an always-warm ONLYOFFICE container, and
  is a cold start on first open tolerable instead?
- Is collaborative editing — two elders in one document at once — wanted, or is
  the current 1.5s autosave enough? That question decides whether Hocuspocus
  enters the picture, and it needs the same always-on server.

## Sources

- [Tiptap: we're open-sourcing more of Tiptap](https://tiptap.dev/blog/release-notes/were-open-sourcing-more-of-tiptap)
- [Tiptap Pro licence](https://tiptap.dev/pro-license)
- [Hocuspocus — self-hosted Yjs collaboration backend](https://github.com/ueberdosis/hocuspocus)
- [Lexical changelog](https://github.com/facebook/lexical/blob/main/CHANGELOG.md)
- [ONLYOFFICE Docs Community system requirements](https://helpcenter.onlyoffice.com/docs/installation/docs-community-sys-reqs-linux.aspx)
- [ONLYOFFICE Docs 9.4 removes the community connection limit](https://linuxiac.com/onlyoffice-docs-9-4-removes-community-connection-limit/)
- [Integration of Collabora Online using a WOPI-like protocol](https://www.collaboraonline.com/blog/wopi-is-open-your-office-stack-should-be-too/)
- [Collabora Online FAQs — sizing](https://www.collaboraonline.com/faqs/)
