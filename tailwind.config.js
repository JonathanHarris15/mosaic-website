/* ============================================================
   tailwind.config.js — compiled build of the Mosaic theme.

   This is the CLI/PostCSS equivalent of the runtime config that
   used to live in public/mosaic-theme.js (window.tailwind.config,
   consumed by the Tailwind Play CDN). The theme.extend block below
   is a verbatim port so compiled output matches the CDN output.

   content globs include the .js files because 8 page scripts build
   markup with Tailwind classes in template strings; those classes
   only survive JIT if the .js files are scanned.
   ============================================================ */

// ---- Brand core (sampled from the seal) --------------------
const navy      = "#182F57";
const navy900   = "#0E1C36";
const navy800   = "#14264A";
const ocean     = "#3E6181";
const steel     = "#5D94A9";
const sand      = "#C2B79D";
const gold      = "#B89B6A";
const cream     = "#F2EAE2";
const parchment = "#FBF7F0";

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./public/**/*.html", "./public/**/*.js"],
  theme: {
    extend: {
      colors: {
        /* ---- Brand additions ---- */
        navy, "navy-900": navy900, "navy-800": navy800,
        ocean, steel, sand, gold,
        cream, parchment,

        /* ---- App tokens, re-pointed to the brand ---- */
        "primary":                navy,
        "on-primary":             cream,
        "primary-container":      navy800,
        "on-primary-container":   "#8FA6C8",
        "primary-fixed":          "#D8E2FF",
        "primary-fixed-dim":      "#B2C6F8",
        "inverse-primary":        "#B2C6F8",

        "secondary":              ocean,
        "on-secondary":           "#ffffff",
        "secondary-container":    "#CFE0F1",
        "on-secondary-container": "#34506E",

        "tertiary":               steel,
        "on-tertiary":            "#ffffff",
        "tertiary-container":     "#D7E7EC",
        "on-tertiary-container":  "#2D4F5B",

        /* ---- Warm neutral surfaces ---- */
        "background":               "#F7F3ED",
        "on-background":            navy900,
        "surface":                  parchment,
        "surface-bright":           parchment,
        "surface-dim":              "#E3D9CC",
        "surface-container-lowest": "#ffffff",
        "surface-container-low":    "#FAF5EE",
        "surface-container":        "#F4ECE2",
        "surface-container-high":   "#EEE4D8",
        "surface-container-highest":"#E8DDCD",
        "surface-variant":          "#E8DDCD",
        "on-surface":               navy900,
        "on-surface-variant":       "#5E6B82",

        /* ---- Lines ---- */
        "outline":         "#8A93A6",
        "outline-variant": "#DAD0C0",

        /* ---- Status ---- */
        "error":             "#A8463E",
        "on-error":          "#ffffff",
        "error-container":   "#F3D9D4",
        "on-error-container":"#5C231C",
        "success":           "#4B8A6B",
        "warning":             "#B8862E",
        "warning-container":   "#F0E2C6",
        "on-warning-container":"#5A4212",
      },

      borderRadius: {
        "none":    "0",
        "sm":      "6px",
        "DEFAULT": "10px",
        "md":      "10px",
        "lg":      "10px",
        "xl":      "16px",
        "2xl":     "24px",
        "full":    "9999px",
      },

      fontFamily: {
        "display":     ["Cinzel", "Georgia", "serif"],
        "serif":       ["EB Garamond", "Georgia", "serif"],
        "sans":        ["Libre Franklin", "system-ui", "sans-serif"],
        "display-lg":  ["Cinzel", "Georgia", "serif"],
        "headline-lg": ["EB Garamond", "Georgia", "serif"],
        "headline-md": ["EB Garamond", "Georgia", "serif"],
        "body-lg":     ["Libre Franklin", "system-ui", "sans-serif"],
        "body-md":     ["Libre Franklin", "system-ui", "sans-serif"],
        "label-md":    ["Libre Franklin", "system-ui", "sans-serif"],
      },

      fontSize: {
        "display-lg":  ["48px", { lineHeight: "1.1", letterSpacing: "0.02em", fontWeight: "600" }],
        "headline-lg": ["32px", { lineHeight: "1.2", fontWeight: "600" }],
        "headline-md": ["24px", { lineHeight: "1.3", fontWeight: "600" }],
        "body-lg":     ["18px", { lineHeight: "1.6", fontWeight: "400" }],
        "body-md":     ["16px", { lineHeight: "1.5", fontWeight: "400" }],
        "label-md":    ["13px", { lineHeight: "1.2", letterSpacing: "0.14em", fontWeight: "600" }],
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
  plugins: [
    require("@tailwindcss/forms"),
    require("@tailwindcss/container-queries"),
    require("@tailwindcss/typography"),
  ],
};
