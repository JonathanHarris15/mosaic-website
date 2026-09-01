// The web's once-only loader for the vendored TipTap bundle.
//
// WHY THIS EXISTS RATHER THAN ANOTHER `import('https://esm.sh/…')`.
// `shepherding-care-list.js`, `shepherding-document.js` and
// `shepherding-profile.js` each fetch TipTap from esm.sh at runtime — 35
// dynamic imports the asset manifest does not know about, on the three pages
// the elders actually write in. If esm.sh is slow, blocked or down, those
// editors do not open, and nothing on the page says why.
//
// The bundle to solve that already exists: `public/vendor/tiptap/tiptap.bundle.js`,
// built from `build/tiptap/` and carrying the exact extension set those pages
// use — but only the phone app loads it (`public/mobile/tiptap-loader.js`).
// This is that loader for the web, so a new editor does not become a fourth
// caller of a CDN nobody chose.
//
// It deliberately does NOT load `shepherding-inline-triggers.js`. The mobile
// loader does, because everything it opens is elder-only. An Event Document is
// not: its @-mention picker would offer a member the names of the
// congregation's pastoral records (ADR-0049). A caller that wants the picker
// loads it itself.
//
// Exposed as window.TiptapEditorLoader.ensureTipTap() — every caller shares ONE
// promise, so the bundle and its single ProseMirror instance load exactly once.

(function (global) {
    'use strict';

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            const existing = document.querySelector('script[data-tt-src="' + src + '"]');
            if (existing) {
                if (existing._loaded) resolve();
                else {
                    existing.addEventListener('load', function () { resolve(); });
                    existing.addEventListener('error', reject);
                }
                return;
            }
            const el = document.createElement('script');
            el.src = src;
            el.setAttribute('data-tt-src', src);
            el.addEventListener('load', function () { el._loaded = true; resolve(); });
            el.addEventListener('error', function () { reject(new Error('Failed to load ' + src)); });
            document.body.appendChild(el);
        });
    }

    // The one extension this codebase wrote itself. It is defined identically
    // in three other places; this is the fourth, and the first that other
    // screens can share. Kept byte-for-byte the same behaviour so a Note Body
    // written on one screen reads the same on another.
    function createFontSize(Extension) {
        return Extension.create({
            name: 'fontSize',
            addOptions: function () { return { types: ['textStyle'] }; },
            addGlobalAttributes: function () {
                return [{
                    types: this.options.types,
                    attributes: {
                        fontSize: {
                            default: null,
                            parseHTML: function (el) { return el.style.fontSize || null; },
                            renderHTML: function (attrs) {
                                return attrs.fontSize ? { style: 'font-size: ' + attrs.fontSize } : {};
                            },
                        },
                    },
                }];
            },
            addCommands: function () {
                return {
                    setFontSize: function (size) {
                        return function (o) { return o.chain().setMark('textStyle', { fontSize: size }).run(); };
                    },
                    unsetFontSize: function () {
                        return function (o) {
                            return o.chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run();
                        };
                    },
                };
            },
        });
    }

    let loadPromise = null;

    function ensureTipTap() {
        // A page that already has TipTap — the shepherding pages, which build
        // `window._TipTap` their own way — is left exactly as it is.
        if (global._TipTap) return Promise.resolve(global._TipTap);
        if (loadPromise) return loadPromise;

        loadPromise = loadScript('vendor/tiptap/tiptap.bundle.js').then(function () {
            const lib = global._TipTapLib;
            if (!lib) throw new Error('the TipTap bundle loaded but did not initialise');
            global._TipTap = Object.assign({}, lib, { FontSize: createFontSize(lib.Extension) });
            return global._TipTap;
        }).catch(function (e) {
            loadPromise = null;
            throw e;
        });

        return loadPromise;
    }

    const TiptapEditorLoader = { ensureTipTap, loadScript };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = TiptapEditorLoader;
    }
    if (global) {
        global.TiptapEditorLoader = TiptapEditorLoader;
    }
})(typeof window !== 'undefined' ? window : null);
