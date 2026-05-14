# Design System: Mosaic Service Analytics

## 1. Visual Theme & Atmosphere
A refined, data-rich dashboard that balances liturgical tradition with modern analytical clarity. The atmosphere is professional and trustworthy, utilizing a clean, card-based layout with generous whitespace and clear typographic hierarchy. It feels "at home" within the broader Mosaic ecosystem, leveraging the Material 3-inspired palette.

## 2. Color Palette & Roles
- **Primary Background** (#fcf9f3) — `bg-background`
- **Surface (Cards)** (#ffffff) — `bg-surface-container-lowest`
- **Secondary Surface** (#f6f3ed) — `bg-surface-container-low`
- **Primary Text** (#001a43) — `text-primary` (Navy)
- **Secondary Text** (#44474e) — `text-on-surface-variant`
- **Accents (Bible Heat Map)**:
  - Base: `bg-surface-container`
  - Scale: `bg-blue-50` (Low) to `bg-blue-900` (High)
- **Borders** (#c5c6d0) — `border-outline-variant`

## 3. Typography Rules
- **Display/Headlines:** `Noto Serif` — Semibold (600) or Bold (700). Used for page titles and section headers.
- **Body:** `Work Sans` — Regular (400) or Medium (500). Used for all data entries and descriptions.
- **Labels/Metadata:** `Work Sans` — Medium (500), Uppercase, tracked wide (tracking-wider), small size (text-xs). Used for table headers and filter labels.

## 4. Component Stylings
- **Cards:** Rounded corners (`rounded-xl`), subtle border (`border border-outline-variant`), and soft shadow (`shadow-sm`).
- **Tables:** 
  - Header: `bg-surface-container-low`, sticky if possible, with clear sort indicators.
  - Rows: `hover:bg-surface-container-low` for interactivity, `divide-y divide-outline-variant` for separation.
  - Padding: Generous cell padding (`px-6 py-4`).
- **Tabs:** Underlined active state using `text-primary` and `border-primary`. Inactive states in `text-on-surface-variant`.
- **Filters/Inputs:** `bg-surface-container-low` with focus rings in `primary`.

## 5. Layout Principles
- **Max Width:** Contain content within `max-w-7xl` centered.
- **Spacing:** Use standard gutter (24px) and section margins (48px).
- **Asymmetry:** Use grid layouts (e.g., 1:3 ratio for filters vs. main content) to create visual interest.
- **Micro-Interactions:** Transitions on hover states for table rows, heat map cells, and buttons.

## 6. Anti-Patterns
- No generic HTML table borders.
- No tightly packed data without clear row separation.
- No unstyled standard input elements.
- No pure black text; always use `primary` or `on-surface`.
- No abrupt layout shifts; use skeletal loaders or smooth transitions.
