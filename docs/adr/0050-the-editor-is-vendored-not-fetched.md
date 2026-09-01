# ADR 0050 — The editor is vendored, not fetched from a CDN at runtime

**Status:** Accepted
**Date:** 2026-09-01

## Context

`shepherding-care-list.js`, `shepherding-document.js` and
`shepherding-profile.js` each began their editor bootstrap with a dozen dynamic
imports:

```js
if (!window._TipTap) {
    const [...] = await Promise.all([
        import('https://esm.sh/@tiptap/core@2'),
        import('https://esm.sh/prosemirror-state@1'),
        …
    ]);
}
```

Thirty-five of them across the three files. Three things were wrong with that,
and none of them had been noticed because it works on a good connection:

1. **A single point of failure on the pages the elders write in.** If esm.sh is
   slow, blocked by a network, or down, the editor never opens and nothing on
   the page says why — it simply sits there.
2. **`scripts/asset-manifest.mjs` claims to be "the single source of truth for
   local-vendoring… maps every external CDN URL currently referenced anywhere in
   `public/`".** It did not know about any of these, so the policy was true of
   `<script>` tags and quietly false of everything else.
3. **`@2` and `@1` are floating ranges.** The version the app ran was whatever
   esm.sh resolved that morning, which is not the version anybody tested.

The fix already existed and was being used by half the app.
`public/vendor/tiptap/tiptap.bundle.js` is built from `build/tiptap/` and
carries exactly the extension set those pages use — but only the phone app
loaded it, through `public/mobile/tiptap-loader.js`.

## Decision

**Every editor on the web loads the vendored bundle, through one shared
loader.**

`public/tiptap-editor-loader.js` is the web counterpart of the mobile loader:
it loads `vendor/tiptap/tiptap.bundle.js`, adds the custom `FontSize` extension
that this codebase wrote, and assembles the same `window._TipTap` the pages
already expect. Every caller shares one promise, so the bundle and its single
ProseMirror instance load exactly once. The three bootstrap blocks — 142 lines —
became one line each.

It deliberately does **not** load `shepherding-inline-triggers.js`. The mobile
loader does, because everything the phone app opens is elder-only. An Event
Document is not (ADR-0049), so a caller that wants the Cross-Reference picker
loads it itself.

### What the bundle gained, and the one thing it did not

The Word work needed three extensions the bundle did not carry, all now at the
same pinned `2.27.2`: **Image**, **Link** and **TextAlign**. `TableOfContents`
came along too, unused for now. Together they cost 32KB.

**DragHandle was left out, and it is the one worth explaining.** It is genuinely
wanted — dragging a block by a handle is most of what makes Docs feel fluid, and
it is MIT now. But on TipTap v2, `@tiptap/extension-drag-handle` hard-depends on
`@tiptap/extension-collaboration` → `y-prosemirror` → `yjs`: about 180KB of
collaborative-editing machinery this app does not use, in a bundle the phone app
ships. Adding it took the bundle from 347KB to 530KB. Removing it again brought
it to 379KB. On TipTap v3 the two are decoupled; that is when to revisit.

## Consequences

**The editor works offline, and works the same everywhere.** Web and phone now
load the same bytes, so a Note Body cannot render differently depending on which
one you opened it in.

**`build/tiptap/` is now load-bearing for the whole app, not just the phone.**
Changing an extension means editing `build/tiptap/entry.js` and running
`npm run vendor:tiptap`, and forgetting the rebuild means the code references
something the bundle does not export. That is a worse failure mode than the old
one in one respect — it is silent until the editor opens — and better in every
other.

**The version is pinned for real.** `^2.27.2` in `build/tiptap/package.json`,
resolved once at build time, committed as bytes.

**ADR-0047 and ADR-0048 were corrected rather than reworded.** Both said nothing
on this site loads from a CDN, which was written in good faith and was not true
at the time. It is true now, which is a poor excuse for having said it then.
