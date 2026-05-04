---
name: Mosaic Liturgy
colors:
  surface: '#fcf9f3'
  surface-dim: '#dcdad4'
  surface-bright: '#fcf9f3'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3ed'
  surface-container: '#f0eee8'
  surface-container-high: '#ebe8e2'
  surface-container-highest: '#e5e2dc'
  on-surface: '#1c1c18'
  on-surface-variant: '#44474e'
  inverse-surface: '#31312d'
  inverse-on-surface: '#f3f0ea'
  outline: '#75777f'
  outline-variant: '#c5c6d0'
  surface-tint: '#4a5e8a'
  primary: '#001a43'
  on-primary: '#ffffff'
  primary-container: '#1a3059'
  on-primary-container: '#8499c8'
  inverse-primary: '#b2c6f8'
  secondary: '#436082'
  on-secondary: '#ffffff'
  secondary-container: '#b9d7fe'
  on-secondary-container: '#415e7f'
  tertiary: '#001f28'
  on-tertiary: '#ffffff'
  tertiary-container: '#003643'
  on-tertiary-container: '#67a1b5'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#b2c6f8'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#314670'
  secondary-fixed: '#d1e4ff'
  secondary-fixed-dim: '#abc9ef'
  on-secondary-fixed: '#001d36'
  on-secondary-fixed-variant: '#2b4969'
  tertiary-fixed: '#b5ebff'
  tertiary-fixed-dim: '#95cfe4'
  on-tertiary-fixed: '#001f28'
  on-tertiary-fixed-variant: '#004e60'
  background: '#fcf9f3'
  on-background: '#1c1c18'
  surface-variant: '#e5e2dc'
typography:
  display-lg:
    fontFamily: Noto Serif
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Noto Serif
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Noto Serif
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Work Sans
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Work Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-md:
    fontFamily: Work Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 24px
  lg: 48px
  xl: 80px
  gutter: 24px
  margin: 32px
---

## Brand & Style

This design system is built upon the pillars of reverence, tradition, and clarity. It is designed to evoke a sense of "Modern Liturgy"—an aesthetic that honors historical establishment while remaining accessible to a contemporary audience. The target audience seeks a spiritual home that feels grounded and intentional rather than fleeting or overly trendy.

The visual style follows a **Corporate / Modern** framework with heavy **Minimalist** influences. It prioritizes high-contrast legibility and organized whitespace to create a sanctuary-like digital environment. The interface uses subtle linework and architectural framing to reflect the "mosaic" concept, suggesting that many diverse parts come together to form a beautiful, cohesive whole.

## Colors

The palette is derived directly from the Mosaic Church identity, emphasizing stability and peace.

- **Primary (Deep Navy):** Used for primary branding, headers, and key call-to-action backgrounds to establish authority and depth.
- **Secondary (Slate Blue):** Used for supporting elements, secondary buttons, and icons, bridging the gap between navy and teal.
- **Tertiary (Muted Teal):** Used sparingly as an accent for highlights, active states, and links to provide a soft, welcoming glow.
- **Background (Cream/Off-White):** A warm, parchment-like base for light mode that reduces eye strain and feels more organic than pure white.
- **Dark Mode (Deep Charcoal/Navy):** A rich, near-black navy that maintains high contrast with cream-colored text for evening reflection and low-light environments.

## Typography

Typography is used to create a clear hierarchy between the "Sacred" (Headings) and the "Functional" (Body).

- **Headlines:** **Noto Serif** provides a classic, authoritative feel that echoes the "m" in the church logo. Larger headings should use tighter letter spacing for a more editorial, established look.
- **Functional Text:** **Work Sans** is used for its exceptional readability and neutral character. It ensures that logistical information—times, locations, and scriptures—is consumed without friction.
- **Labels:** Small labels and overlines should use Work Sans in semi-bold with increased letter spacing and uppercase styling to act as structural anchors throughout the layout.

## Layout & Spacing

This design system utilizes a **Fixed Grid** model to maintain a sense of order and composure. On desktop, content is centered within a 1200px container with a 12-column structure. 

The spacing rhythm is generous, favoring "breathing room" to prevent the interface from feeling cluttered or hurried. Vertical rhythm is driven by the `lg` (48px) and `xl` (80px) units to separate major sections of a page, creating a paced, meditative scrolling experience. Gutters are kept wide at 24px to ensure distinct separation between content blocks.

## Elevation & Depth

To maintain a clean and liturgical feel, this design system avoids heavy drop shadows and modern "floating" effects. Instead, depth is communicated through **Tonal Layers** and **Low-Contrast Outlines**.

- **Surface Tiers:** In light mode, the primary background is the warm cream. "Cards" or containers use a slightly lighter version of the background or a pure white to lift off the page subtly.
- **Subtle Borders:** Elements are defined by thin, 1px borders using a low-opacity version of the Slate Blue (#405D7E at 15%). This creates a "framed" appearance reminiscent of architectural plans or hymnals.
- **Shadows:** When necessary (e.g., for modals or floating buttons), use an extremely diffused, "ambient" shadow with a 0.05 alpha of the Primary Navy, creating a soft glow rather than a harsh drop.

## Shapes

The shape language is "Soft" (0.25rem / 4px), leaning toward the more traditional end of the spectrum. Sharp corners (0px) are too aggressive, while pill shapes (3) feel too casual for a liturgical context. 

The 4px radius provides a slight "human" touch to the geometric grid without sacrificing the established, formal feel of the design. Hexagonal accents—inspired by the logo's central shape—can be used for decorative masks or icon containers to reinforce brand recognition.

## Components

- **Buttons:** Primary buttons use the Primary Navy background with Cream text. Secondary buttons use a Slate Blue outline with 1px thickness. Button labels use the `label-md` style for a formal, balanced appearance.
- **Cards:** Cards should be flat with a 1px subtle border. They should not use shadows unless they are interactive (e.g., hover states).
- **Inputs:** Text fields use a 1px border on all sides. When focused, the border transitions to the Tertiary Teal to provide a soft but clear indicator of activity.
- **Lists:** Use generous padding between list items and subtle 1px dividers to maintain the "mosaic" feel of organized sections.
- **Chips/Badges:** Small, rectangular tags with the `label-md` font style. These should use light tints of the Secondary color to denote categories like "Sermon Series" or "Ministry Area."
- **Additional Suggestion:** **Scripture Blocks.** A specific component for Bible verses using the Noto Serif font, centered with an italic style and a subtle vertical divider on the left to set it apart as a sacred quote.