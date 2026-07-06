/* ============================================================
   asset-manifest.mjs — single source of truth for local-vendoring.

   Maps every external CDN URL currently referenced anywhere in
   public/ to a local path (relative to public/). Both the downloader
   (vendor-assets.mjs) and the codemod (rewrite-cdn.mjs) import this,
   so what we download and what we rewrite can never drift apart.

   Principle: RELOCATE, don't upgrade. Each library keeps the exact
   version the app references today — only the delivery moves to local.
   Two versions that appear twice (mammoth, fuse) are BOTH kept so no
   page's behavior changes.

   Fonts are handled separately in fonts-manifest.mjs.
   ============================================================ */

const FB = "https://www.gstatic.com/firebasejs/9.6.1";
const CM = "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16";

export const JS_CSS_ASSETS = [
  // ---- Firebase 9.6.1 compat ----
  { url: `${FB}/firebase-app-compat.js`,        local: "vendor/firebase/firebase-app-compat.js" },
  { url: `${FB}/firebase-auth-compat.js`,       local: "vendor/firebase/firebase-auth-compat.js" },
  { url: `${FB}/firebase-firestore-compat.js`,  local: "vendor/firebase/firebase-firestore-compat.js" },
  { url: `${FB}/firebase-functions-compat.js`,  local: "vendor/firebase/firebase-functions-compat.js" },
  { url: `${FB}/firebase-storage-compat.js`,    local: "vendor/firebase/firebase-storage-compat.js" },

  // ---- Alpine.js (CDN @3 resolves to 3.15.12 today) ----
  { url: "https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js", local: "vendor/alpine-3.15.12.min.js",
    downloadUrl: "https://unpkg.com/alpinejs@3.15.12/dist/cdn.min.js" },

  // ---- SortableJS ----
  { url: "https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js", local: "vendor/sortable-1.15.0.min.js" },

  // ---- Mammoth (both versions in use) ----
  { url: "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.4.21/mammoth.browser.min.js", local: "vendor/mammoth-1.4.21.browser.min.js" },
  { url: "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js",  local: "vendor/mammoth-1.6.0.browser.min.js" },

  // ---- jsPDF ----
  { url: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", local: "vendor/jspdf-2.5.1.umd.min.js" },

  // ---- CodeMirror 5.65.16 (core + modes + addons + themes) ----
  { url: `${CM}/codemirror.min.js`,                 local: "vendor/codemirror/codemirror.min.js" },
  { url: `${CM}/codemirror.min.css`,                local: "vendor/codemirror/codemirror.min.css" },
  { url: `${CM}/mode/xml/xml.min.js`,               local: "vendor/codemirror/mode/xml/xml.min.js" },
  { url: `${CM}/mode/javascript/javascript.min.js`, local: "vendor/codemirror/mode/javascript/javascript.min.js" },
  { url: `${CM}/mode/htmlmixed/htmlmixed.min.js`,   local: "vendor/codemirror/mode/htmlmixed/htmlmixed.min.js" },
  { url: `${CM}/mode/css/css.min.js`,               local: "vendor/codemirror/mode/css/css.min.js" },
  { url: `${CM}/addon/selection/active-line.min.js`,local: "vendor/codemirror/addon/selection/active-line.min.js" },
  { url: `${CM}/addon/edit/matchbrackets.min.js`,   local: "vendor/codemirror/addon/edit/matchbrackets.min.js" },
  { url: `${CM}/addon/edit/closebrackets.min.js`,   local: "vendor/codemirror/addon/edit/closebrackets.min.js" },
  { url: `${CM}/theme/material-darker.min.css`,     local: "vendor/codemirror/theme/material-darker.min.css" },

  // ---- Quill ----
  { url: "https://cdn.quilljs.com/1.3.7/quill.min.js",  local: "vendor/quill-1.3.7.min.js" },
  { url: "https://cdn.quilljs.com/1.3.7/quill.snow.css", local: "vendor/quill-1.3.7.snow.css" },

  // ---- Fuse.js (both versions in use) ----
  { url: "https://cdn.jsdelivr.net/npm/fuse.js@6.6.2", local: "vendor/fuse-6.6.2.js" },
  { url: "https://cdn.jsdelivr.net/npm/fuse.js@7.0.0", local: "vendor/fuse-7.0.0.js" },
];
