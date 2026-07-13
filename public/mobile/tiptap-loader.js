/* ============================================================
   tiptap-loader.js — shared, once-only loader for the offline TipTap
   bundle used by the native shepherding editors (Care List + Document).

   Loads vendor/tiptap/tiptap.bundle.js (exposes window._TipTapLib), adds
   the custom FontSize extension, assigns window._TipTap (the shape the
   desktop pages + shepherding-inline-triggers.js expect), then loads the
   shared inline-triggers extension. Exposed as M.ensureTipTap() — every
   caller shares ONE promise so the bundle + single ProseMirror instance
   load exactly once.
   ============================================================ */
(function () {
  "use strict";

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-tt-src="' + src + '"]');
      if (existing) {
        if (existing._loaded) resolve();
        else { existing.addEventListener("load", function () { resolve(); }); existing.addEventListener("error", reject); }
        return;
      }
      var s = document.createElement("script");
      s.src = src; s.setAttribute("data-tt-src", src);
      s.addEventListener("load", function () { s._loaded = true; resolve(); });
      s.addEventListener("error", function () { reject(new Error("Failed to load " + src)); });
      document.body.appendChild(s);
    });
  }

  var _loadPromise = null;
  function ensureTipTap() {
    if (_loadPromise) return _loadPromise;
    _loadPromise = loadScript("vendor/tiptap/tiptap.bundle.js").then(function () {
      var L = window._TipTapLib;
      if (!L) throw new Error("TipTap bundle did not initialise");
      // Custom FontSize extension (matches shepherding-care-list.js /
      // shepherding-document.js) + assemble window._TipTap so the shared
      // inline-triggers extension + the ported NodeViews find their globals.
      var FontSize = L.Extension.create({
        name: "fontSize",
        addOptions: function () { return { types: ["textStyle"] }; },
        addGlobalAttributes: function () {
          return [{ types: this.options.types, attributes: { fontSize: {
            default: null,
            parseHTML: function (el) { return el.style.fontSize || null; },
            renderHTML: function (attrs) { return attrs.fontSize ? { style: "font-size: " + attrs.fontSize } : {}; },
          } } }];
        },
        addCommands: function () {
          return {
            setFontSize: function (size) { return function (o) { return o.chain().setMark("textStyle", { fontSize: size }).run(); }; },
            unsetFontSize: function () { return function (o) { return o.chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(); }; },
          };
        },
      });
      window._TipTap = Object.assign({}, L, { FontSize: FontSize });
      return loadScript("shepherding-inline-triggers.js");
    });
    return _loadPromise;
  }

  M.ensureTipTap = ensureTipTap;
  M.loadScript = loadScript;
})();
