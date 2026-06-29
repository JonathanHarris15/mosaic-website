/* ============================================================
   mosaic-theme.js  —  Mosaic Church · single source of truth
   ------------------------------------------------------------
   DROP-IN FIX for audit finding #1 (no shared tokens).

   HOW TO USE
   1. Save this file in /public.
   2. On EVERY page, DELETE the pasted-in `tailwind.config = {…}`
      <script id="tailwind-config"> block and replace it with:

         <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
         <script src="mosaic-theme.js"></script>     <!-- this file, AFTER the CDN -->

   3. Load the brand fonts once per page (see FONTS note at bottom).
   4. Delete the dead dark stylesheets (index.css / hymn-details.css)
      and remove the stray `dark` class on <body> (audit finding #2).

   All existing token KEYS are preserved, so your current markup
   keeps working — only the VALUES were corrected to the real brand.
   Changed values are flagged with  // ← FIX.
   ============================================================ */

(function () {
  // ---- Brand core (sampled from the seal) --------------------
  const navy        = "#182F57";   // ← FIX  was #001a43 (finding #4)
  const navy900     = "#0E1C36";
  const navy800     = "#14264A";
  const ocean       = "#3E6181";
  const steel       = "#5D94A9";
  const sand        = "#C2B79D";   // grout / hairlines
  const gold        = "#B89B6A";   // accent on light
  const cream       = "#F2EAE2";   // ← FIX  primary warm bg
  const parchment   = "#FBF7F0";

  window.tailwind = window.tailwind || {};
  window.tailwind.config = {
    // NOTE: darkMode removed — there is no dark theme (finding #2).
    theme: {
      extend: {
        colors: {
          /* ---- Brand additions (use these going forward) ---- */
          navy, "navy-900": navy900, "navy-800": navy800,
          ocean, steel, sand, gold,
          cream, parchment,

          /* ---- Existing app tokens, re-pointed to the brand ---- */
          "primary":                navy,         // ← FIX
          "on-primary":             cream,        // ← FIX  cream, not pure white
          "primary-container":      navy800,      // ← FIX
          "on-primary-container":   "#8FA6C8",
          "primary-fixed":          "#D8E2FF",
          "primary-fixed-dim":      "#B2C6F8",
          "inverse-primary":        "#B2C6F8",

          "secondary":              ocean,        // ← FIX  brand ocean tile
          "on-secondary":           "#ffffff",
          "secondary-container":    "#CFE0F1",
          "on-secondary-container": "#34506E",

          "tertiary":               steel,        // ← FIX  steel-teal tile
          "on-tertiary":            "#ffffff",
          "tertiary-container":     "#D7E7EC",
          "on-tertiary-container":  "#2D4F5B",

          /* ---- Warm neutral surfaces (cream → parchment → white) ---- */
          "background":               cream,       // ← FIX  was #fcf9f3
          "on-background":            navy900,      // ← FIX  navy ink, not #1c1c18
          "surface":                  parchment,    // ← FIX
          "surface-bright":           parchment,
          "surface-dim":              "#E3D9CC",
          "surface-container-lowest": "#ffffff",
          "surface-container-low":    "#FAF5EE",
          "surface-container":        "#F4ECE2",
          "surface-container-high":   "#EEE4D8",
          "surface-container-highest":"#E8DDCD",
          "surface-variant":          "#E8DDCD",
          "on-surface":               navy900,      // ← FIX
          "on-surface-variant":       "#5E6B82",     // ← FIX  brand navy-grey

          /* ---- Lines: warm sand hairlines do the work ---- */
          "outline":         "#8A93A6",            // ← FIX
          "outline-variant": "#DAD0C0",            // ← FIX  warm hairline

          /* ---- Status (kept within the palette) ---- */
          "error":            "#A8463E",           // ← FIX  brand danger
          "on-error":         "#ffffff",
          "error-container":  "#F3D9D4",
          "on-error-container":"#5C231C",
          "success":          "#4B8A6B",
          "warning":          "#B8862E",
        },

        /* ---- Radii: one coherent scale; pills are PILLS ---- */
        borderRadius: {
          "none":    "0",
          "sm":      "6px",
          "DEFAULT": "10px",   // ← FIX  brand card radius (was 2px)
          "md":      "10px",   // ← FIX
          "lg":      "10px",   // ← FIX  (was 4px) — match cards
          "xl":      "16px",
          "2xl":     "24px",
          "full":    "9999px", // ← FIX  was 0.75rem — finding #3 (real circles/pills)
        },

        /* ---- Type: ONE serif accent for titles, sans for chrome ----
           Web subset (finding #5):
             • display / page & hymn titles → Cinzel (caps) or EB Garamond
             • EVERYTHING else (labels, meta, buttons, inputs) → Libre Franklin
        */
        fontFamily: {
          "display":     ["Cinzel", "Georgia", "serif"],          // page titles, wordmark feel
          "serif":       ["EB Garamond", "Georgia", "serif"],     // hymn names, reading
          "sans":        ["Libre Franklin", "system-ui", "sans-serif"],
          // back-compat keys (re-pointed off Noto Serif / Work Sans):
          "display-lg":  ["Cinzel", "Georgia", "serif"],          // ← FIX
          "headline-lg": ["EB Garamond", "Georgia", "serif"],     // ← FIX  titles, not Noto Serif
          "headline-md": ["EB Garamond", "Georgia", "serif"],     // ← FIX
          "body-lg":     ["Libre Franklin", "system-ui", "sans-serif"], // ← FIX  was Work Sans
          "body-md":     ["Libre Franklin", "system-ui", "sans-serif"], // ← FIX
          "label-md":    ["Libre Franklin", "system-ui", "sans-serif"], // ← FIX
        },

        fontSize: {
          "display-lg":  ["48px", { lineHeight: "1.1",  letterSpacing: "0.02em",  fontWeight: "600" }],
          "headline-lg": ["32px", { lineHeight: "1.2",  fontWeight: "600" }],
          "headline-md": ["24px", { lineHeight: "1.3",  fontWeight: "600" }],
          "body-lg":     ["18px", { lineHeight: "1.6",  fontWeight: "400" }],
          "body-md":     ["16px", { lineHeight: "1.5",  fontWeight: "400" }],
          "label-md":    ["13px", { lineHeight: "1.2",  letterSpacing: "0.14em", fontWeight: "600" }], // tracked caps
        },

        spacing: {
          "xs": "4px", "sm": "12px", "base": "8px", "md": "24px",
          "lg": "48px", "xl": "80px", "gutter": "24px", "margin": "32px",
        },

        boxShadow: {
          "xs": "0 1px 2px rgba(14,28,54,.06)",
          "sm": "0 2px 6px rgba(14,28,54,.08)",
          "md": "0 8px 24px rgba(14,28,54,.10)",
          "lg": "0 18px 48px rgba(14,28,54,.14)",
        },
      },
    },
  };
})();

/* ============================================================
   FONTS — load these once per page, in <head>:

   <link rel="preconnect" href="https://fonts.googleapis.com">
   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
   <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400..700&family=EB+Garamond:ital,wght@0,400..700;1,400..600&family=Libre+Franklin:wght@400;500;600;700&display=swap">

   ICONS (finding #7) — swap Material Symbols for Lucide:
   <script src="https://unpkg.com/lucide@latest"></script>
   …then <i data-lucide="search"></i> + lucide.createIcons();
   stroke ≈ 1.75px, tinted currentColor.

   THE SPLIT (rule of thumb for the web subset):
   • Cinzel  → only the page/section title (and the wordmark).
   • EB Garamond → hymn names & long-form reading.
   • Libre Franklin → ALL labels, meta, buttons, inputs, nav.
   • gold/sand → thin accents & hairlines ONLY, never a fill.
   ============================================================ */
