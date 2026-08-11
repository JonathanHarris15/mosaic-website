/* ============================================================
   design-components.mjs — the one definition of a Mosaic component

   THE PROBLEM THIS SOLVES. There were three worlds. The desktop pages
   wrote their components out by hand in Tailwind classes, so the same
   tracked-caps label existed in five spellings across six files and one
   of them used text-gray-500. The phone had a real component library in
   mobile/ui.js, drawn with inline styles, so nothing on the desktop could
   reuse it. And the design system on claude.ai described eleven React
   components matching neither.

   Nothing could be "in sync" because there was no single thing to be in
   sync WITH.

   THE SHAPE OF THE FIX. A component is plain CSS built from the design
   tokens. Not Tailwind @apply, not JSX, not a framework — plain CSS,
   because that is the only thing all three worlds can hold at once:

     the desktop  writes  class="m-btn m-btn--primary"
     the phone    writes  class="m-btn m-btn--primary"
     the design system gets the same stylesheet, verbatim

   One definition. It is generated into public/mosaic.css (which every
   page already loads), into the gallery, into the design system's own
   components.css, and into the .prompt.md files Claude Design reads when
   it composes a screen. Change it here and all four follow.

   NAMING. `m-` for Mosaic, then BEM-ish modifiers: .m-btn, .m-btn--ghost,
   .m-btn--sm. The design system's existing type helpers already use m-,
   so this keeps one prefix rather than inventing a second.

   NO RAW COLOURS. Every value is a var(--token). check-design-drift
   enforces it here like anywhere else.
   ============================================================ */

export const COMPONENTS = [
  /* ── Core ───────────────────────────────────────────────── */
  {
    name: "Button",
    cls: "m-btn",
    group: "Core",
    summary:
      "The standard action. Primary for the one thing a screen is for, secondary for the alternative, ghost for everything that would otherwise be a link.",
    variants: {
      variant: ["primary", "secondary", "ghost", "quiet", "danger"],
      size: ["sm", "md", "lg"],
    },
    notes: [
      "Shadow only on primary, and only --shadow-xs. Everything else is flat — depth here comes from tonal layers and warm hairlines.",
      "Disabled drops to 40% and takes not-allowed; it is never hidden, because a control that vanishes reads as a bug.",
      "46px tall, not 40. The phone shipped 46 and it is above the 44px touch floor; one height that works on both beats two that each work on one.",
    ],
    examples: [
      '<button class="m-btn m-btn--primary">Save the service</button>',
      '<button class="m-btn m-btn--secondary m-btn--sm">Cancel</button>',
      '<button class="m-btn m-btn--ghost">Show past dates</button>',
    ],
    css: `
.m-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  height: 46px; padding: 0 16px;
  border: 1px solid transparent; border-radius: var(--radius);
  font-family: var(--font-sans); font-size: 15px; font-weight: 600;
  line-height: 1; white-space: nowrap; cursor: pointer;
  transition: background-color var(--duration) var(--ease-standard),
              border-color var(--duration) var(--ease-standard),
              color var(--duration) var(--ease-standard);
}
.m-btn:disabled, .m-btn[aria-disabled="true"] { opacity: .4; cursor: not-allowed; }
.m-btn:focus-visible { outline: 2px solid var(--tertiary); outline-offset: 2px; }

.m-btn--sm { height: 38px; padding: 0 14px; font-size: 13.5px; }
.m-btn--lg { height: 52px; padding: 0 20px; font-size: 16px; }

.m-btn--primary {
  background: var(--primary); color: var(--on-primary);
  border-color: var(--primary); box-shadow: var(--shadow-xs);
}
.m-btn--primary:hover:not(:disabled) { background: var(--primary-container); border-color: var(--primary-container); }

.m-btn--secondary {
  background: var(--surface-container-high); color: var(--on-surface);
  border-color: var(--outline-variant);
}
.m-btn--secondary:hover:not(:disabled) { background: var(--surface-container-highest); }

.m-btn--ghost { background: transparent; color: var(--primary); }
.m-btn--ghost:hover:not(:disabled) { background: var(--surface-container); }

/* The muted toolbar action — 24 of these on the desktop, in two sizes. Not
   --ghost: that is still an action, this is closer to a link that happens
   to be a button. */
.m-btn--quiet { background: transparent; color: var(--on-surface-variant); font-weight: 600; }
.m-btn--quiet:hover:not(:disabled) { background: var(--surface-container); color: var(--primary); }

.m-btn--danger { background: var(--error); color: var(--on-error); border-color: var(--error); }
.m-btn--danger:hover:not(:disabled) { background: var(--on-error-container); border-color: var(--on-error-container); }
`,
  },

  {
    name: "IconButton",
    cls: "m-icon-btn",
    group: "Core",
    summary:
      "A square button holding one Material Symbol. Toolbar actions, close buttons, the floating action button. Always carries an aria-label — an icon alone is not a name.",
    variants: { variant: ["ghost", "outline", "primary", "fab"], size: ["sm", "md", "lg"] },
    notes: [
      "Material Symbols Outlined, never Lucide and never emoji. One icon set across the product.",
      "The fab variant is the only elevated one: navy, 16px radius, --shadow-md.",
    ],
    examples: [
      '<button class="m-icon-btn m-icon-btn--ghost" aria-label="Close"><span class="material-symbols-outlined">close</span></button>',
      '<button class="m-icon-btn m-icon-btn--fab" aria-label="Add an event"><span class="material-symbols-outlined">add</span></button>',
    ],
    css: `
.m-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; flex: 0 0 auto;
  border: 1px solid transparent; border-radius: var(--radius-sm);
  background: transparent; color: var(--on-surface-variant); cursor: pointer;
  transition: background-color var(--duration) var(--ease-standard),
              color var(--duration) var(--ease-standard);
}
.m-icon-btn .material-symbols-outlined { font-size: 20px; }
.m-icon-btn:disabled { opacity: .4; cursor: not-allowed; }
.m-icon-btn:focus-visible { outline: 2px solid var(--tertiary); outline-offset: 2px; }

.m-icon-btn--sm { width: 28px; height: 28px; }
.m-icon-btn--sm .material-symbols-outlined { font-size: 18px; }
.m-icon-btn--lg { width: 44px; height: 44px; }
.m-icon-btn--lg .material-symbols-outlined { font-size: 24px; }

.m-icon-btn--ghost:hover:not(:disabled) { background: var(--surface-container); color: var(--primary); }
.m-icon-btn--outline { border-color: var(--outline-variant); background: var(--surface-container-lowest); }
.m-icon-btn--outline:hover:not(:disabled) { background: var(--surface-container); }
.m-icon-btn--primary { background: var(--primary); color: var(--on-primary); }
.m-icon-btn--fab {
  width: 56px; height: 56px; border-radius: var(--radius-xl);
  background: var(--primary); color: var(--on-primary); box-shadow: var(--shadow-md);
}
.m-icon-btn--fab .material-symbols-outlined { font-size: 26px; }

/* The unread count that sits on a bar action. Ringed in the surface it
   overlaps so it reads as attached to the icon rather than floating. */
.m-count {
  position: absolute; top: 8px; right: 8px;
  display: flex; align-items: center; justify-content: center;
  min-width: 16px; height: 16px; padding: 0 4px;
  border: 1.5px solid var(--surface-container-lowest); border-radius: var(--radius-full);
  background: var(--error); color: var(--on-error);
  font-family: var(--font-sans); font-size: 10px; font-weight: 700;
}
`,
  },

  /* ── Forms ──────────────────────────────────────────────── */
  {
    name: "Input",
    cls: "m-input",
    group: "Forms",
    summary:
      "A single-line text field, its label, and its error. There were four spellings of this across the app before it was named.",
    variants: { state: ["default", "invalid", "disabled"] },
    notes: [
      "48px tall on purpose: iOS zooms into any focused field under 16px and often fails to zoom back out, so the font floor and the height go together.",
      "The focus ring is steel-teal at low alpha, the one place the system uses a colour outside the token set — see --m-focus-ring.",
    ],
    examples: [
      '<label class="m-field"><span class="m-label">Email address</span><input class="m-input" type="email" /></label>',
      '<input class="m-input m-input--invalid" aria-invalid="true" value="not an email" />',
    ],
    css: `
.m-field { display: block; }
.m-input {
  width: 100%; height: 48px; padding: 0 14px;
  border: 1px solid var(--outline-variant); border-radius: var(--radius);
  background: var(--surface-container-lowest); color: var(--on-surface);
  font-family: var(--font-sans); font-size: 16px;
  transition: border-color var(--duration) var(--ease-standard),
              box-shadow var(--duration) var(--ease-standard);
}
.m-input::placeholder { color: var(--on-surface-variant); opacity: .7; }
.m-input:focus { outline: none; border-color: var(--tertiary); box-shadow: 0 0 0 3px var(--m-focus-ring); }
.m-input:disabled { opacity: .5; cursor: not-allowed; background: var(--surface-container); }
.m-input--invalid, .m-input[aria-invalid="true"] { border-color: var(--error); background: var(--error-container); }
textarea.m-input { height: auto; min-height: 96px; padding: 12px 14px; line-height: 1.5; resize: vertical; }
.m-input-hint { display: block; margin-top: 6px; font-family: var(--font-sans); font-size: 12px; color: var(--on-surface-variant); }
.m-input-hint--error { color: var(--error); }
`,
  },

  {
    name: "Select",
    cls: "m-select",
    group: "Forms",
    summary: "A native dropdown matched to Input, with an inline chevron drawn as a Material Symbol rather than a bundled SVG.",
    variants: { state: ["default", "disabled"] },
    notes: ["Native, so the phone gets its own picker and the keyboard works without any of our code."],
    examples: ['<div class="m-select-wrap"><select class="m-select"><option>Sunday Service</option></select></div>'],
    css: `
.m-select-wrap { position: relative; display: block; }
.m-select-wrap::after {
  content: "expand_more"; font-family: "Material Symbols Outlined"; font-size: 20px;
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  color: var(--on-surface-variant); pointer-events: none;
}
.m-select {
  width: 100%; height: 48px; padding: 0 40px 0 14px; appearance: none;
  border: 1px solid var(--outline-variant); border-radius: var(--radius);
  background: var(--surface-container-lowest); color: var(--on-surface);
  font-family: var(--font-sans); font-size: 16px; cursor: pointer;
}
.m-select:focus { outline: none; border-color: var(--tertiary); box-shadow: 0 0 0 3px var(--m-focus-ring); }
.m-select:disabled { opacity: .5; cursor: not-allowed; }
`,
  },

  {
    name: "Checkbox",
    cls: "m-check",
    group: "Forms",
    summary: "A checkbox and its label, as one target. The whole row is clickable, because a 16px box is a miss on a phone.",
    variants: { state: ["default", "checked", "disabled"] },
    notes: ["Minimum 44px of tappable height even though the box itself is 18px."],
    examples: ['<label class="m-check"><input type="checkbox" /><span>Only mine</span></label>'],
    css: `
.m-check {
  display: inline-flex; align-items: center; gap: 10px; min-height: 44px; cursor: pointer;
  font-family: var(--font-sans); font-size: 15px; color: var(--on-surface);
}
.m-check input[type="checkbox"] {
  width: 18px; height: 18px; flex: 0 0 auto; margin: 0; cursor: pointer;
  accent-color: var(--primary);
}
.m-check input:disabled { cursor: not-allowed; }
.m-check:has(input:disabled) { opacity: .5; cursor: not-allowed; }
`,
  },

  {
    name: "SearchBar",
    cls: "m-search",
    group: "Forms",
    summary: "An Input with a leading search glyph and a clear button that only appears once there is something to clear.",
    variants: {},
    examples: [
      '<div class="m-search"><span class="material-symbols-outlined">search</span><input placeholder="Search people" /></div>',
    ],
    css: `
.m-search { position: relative; display: flex; align-items: center; }
.m-search > .material-symbols-outlined {
  position: absolute; left: 12px; font-size: 20px; color: var(--on-surface-variant); pointer-events: none;
}
.m-search > input {
  width: 100%; height: 44px; padding: 0 14px 0 40px;
  border: 1px solid var(--outline-variant); border-radius: var(--radius-full);
  background: var(--surface-container-lowest); color: var(--on-surface);
  font-family: var(--font-sans); font-size: 15px;
}
.m-search > input:focus { outline: none; border-color: var(--tertiary); box-shadow: 0 0 0 3px var(--m-focus-ring); }
`,
  },

  /* ── Display ────────────────────────────────────────────── */
  {
    name: "SectionLabel",
    cls: "m-label",
    group: "Display",
    summary:
      "The tracked-caps overline above a group of things. The most-repeated pattern in the app by a distance — about 146 hand-written copies in five different spellings before it was named, one of which reached for text-gray-500.",
    variants: { size: ["sm", "md"] },
    notes: ["Uppercase, 0.14em tracking, --on-surface-variant. Never a heading: it labels a group, it does not open one."],
    examples: ['<span class="m-label">Filter by tags</span>', '<span class="m-label m-label--sm">Serving</span>'],
    css: `
/* The size is the component's own, deliberately. --label-md-size is 13px,
   the type scale's label role, and nothing in the app actually drew a
   13px overline — the hand-written copies ranged 10px to 12px and the
   phone settled on 11.5. Weight and tracking still come from the token. */
.m-label {
  display: inline-block;
  font-family: var(--font-sans); font-size: 11.5px;
  font-weight: var(--label-md-weight); line-height: var(--label-md-line);
  letter-spacing: var(--label-md-spacing); text-transform: uppercase;
  color: var(--on-surface-variant);
}
.m-label--sm { font-size: 10.5px; }
`,
  },

  {
    name: "SerifHead",
    cls: "m-serif-head",
    group: "Display",
    summary: "An EB Garamond heading for the things a person reads rather than operates — a hymn name, a role, a one-line summary.",
    variants: { size: ["md", "lg"] },
    notes: ["Cinzel is for the page title only. This is the layer below it."],
    examples: ['<h2 class="m-serif-head">Sunday at a Glance</h2>'],
    css: `
.m-serif-head {
  margin: 0; font-family: var(--font-serif); font-size: var(--headline-md-size);
  font-weight: var(--headline-md-weight); line-height: var(--headline-md-line);
  color: var(--on-surface);
}
.m-serif-head--lg { font-size: var(--headline-lg-size); line-height: var(--headline-lg-line); }
`,
  },

  {
    name: "Card",
    cls: "m-card",
    group: "Display",
    summary: "A flat container with a warm hairline. The default surface for grouping anything.",
    variants: { variant: ["default", "interactive", "raised"], padding: ["sm", "md", "lg"] },
    notes: [
      "Flat by default. Depth is a tonal layer and a 1px --outline-variant line, not a shadow.",
      "The interactive variant lifts its background on hover; it does not grow a shadow.",
    ],
    examples: ['<div class="m-card"><span class="m-label">Next Sunday</span></div>'],
    css: `
.m-card {
  background: var(--surface-container-lowest);
  border: 1px solid var(--outline-variant); border-radius: var(--radius-xl);
  padding: var(--space-md);
}
.m-card--sm { padding: var(--space-sm); }
.m-card--lg { padding: var(--space-lg); }
.m-card--interactive { cursor: pointer; transition: background-color var(--duration) var(--ease-standard); }
.m-card--interactive:hover { background: var(--surface-container-low); }
.m-card--raised { box-shadow: var(--shadow-sm); }
`,
  },

  {
    name: "NavCard",
    cls: "m-nav-card",
    group: "Display",
    summary:
      "The dashboard tile: a medallion, a title, one line of description. Four identical copies of this lived in shepherding-dashboard.html alone.",
    variants: {},
    notes: ["One descriptive line, never two. The Medallion fills on hover to say the whole tile is the target."],
    examples: [
      '<a class="m-nav-card" href="#"><span class="m-medallion"><span class="material-symbols-outlined">groups</span></span><h2 class="m-nav-card__title">People</h2><p class="m-nav-card__desc">View and manage member profiles.</p></a>',
    ],
    css: `
.m-nav-card {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; text-decoration: none; cursor: pointer;
  background: var(--surface-container-lowest);
  border: 1px solid var(--outline-variant); border-radius: var(--radius-xl);
  padding: var(--space-lg);
  transition: background-color var(--duration) var(--ease-standard);
}
.m-nav-card:hover { background: var(--surface-container-low); }
.m-nav-card__title {
  margin: 0 0 var(--space-xs); font-family: var(--font-serif);
  font-size: var(--headline-md-size); font-weight: var(--headline-md-weight);
  color: var(--on-surface);
}
.m-nav-card__desc {
  margin: 0; font-family: var(--font-sans); font-size: 14px;
  line-height: 1.5; color: var(--on-surface-variant);
}
`,
  },

  {
    name: "Medallion",
    cls: "m-medallion",
    group: "Display",
    summary: "The round icon plate on a NavCard. Fills with --primary-fixed when its card is hovered.",
    variants: { size: ["sm", "md"] },
    examples: ['<span class="m-medallion"><span class="material-symbols-outlined">folder_open</span></span>'],
    css: `
.m-medallion {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; margin-bottom: var(--space-sm);
  border-radius: var(--radius-full); background: var(--surface-container);
  color: var(--primary);
  transition: background-color var(--duration) var(--ease-standard);
}
.m-medallion .material-symbols-outlined { font-size: 28px; font-variation-settings: "FILL" 1; }
.m-medallion--sm { width: 40px; height: 40px; margin-bottom: 0; }
.m-medallion--sm .material-symbols-outlined { font-size: 20px; }
.m-medallion--tint { background: var(--primary-fixed); }
.m-nav-card:hover .m-medallion { background: var(--primary-fixed); }
`,
  },

  {
    name: "Badge",
    cls: "m-badge",
    group: "Display",
    summary: "A small rectangular tag: a theological theme, a ministry area, a state. Rectangular, not a pill — pills read too casual against the liturgy.",
    variants: { tone: ["neutral", "primary", "secondary", "tertiary", "success", "warning", "error"] },
    notes: [
      "6px radius. A tone is a meaning, never decoration — if two badges mean the same thing they take the same tone.",
      "The phone drew these as pills until the two were reconciled. The design system's rule was the older and the deliberate one, so the rectangle won and the phone changed.",
    ],
    examples: ['<span class="m-badge m-badge--secondary">Assurance</span>'],
    css: `
.m-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: var(--radius-sm);
  font-family: var(--font-sans); font-size: 11.5px; font-weight: 600;
  line-height: 1.5; white-space: nowrap;
  background: var(--surface-container-high); color: var(--on-surface-variant);
}
.m-badge .material-symbols-outlined { font-size: 14px; }
/* Spelled out even though the base is already neutral: a caller composing
   m-badge--{tone} would otherwise land on a class that does not exist and
   get the right answer by accident. */
.m-badge--neutral { background: var(--surface-container-high); color: var(--on-surface-variant); }
.m-badge--primary { background: var(--primary-fixed); color: var(--primary); }
.m-badge--secondary { background: var(--secondary-container); color: var(--on-secondary-container); }
.m-badge--tertiary { background: var(--tertiary-container); color: var(--on-tertiary-container); }
.m-badge--success { background: var(--success-container); color: var(--on-success-container); }
.m-badge--warning { background: var(--warning-container); color: var(--on-warning-container); }
.m-badge--error { background: var(--error-container); color: var(--on-error-container); }
`,
  },

  {
    name: "Avatar",
    cls: "m-avatar",
    group: "Display",
    summary:
      "A Person's Directory Photo, or their initials when there is none. Framing comes from PersonPhotoCore so the reframing preview and every card agree.",
    variants: { size: ["sm", "md", "lg"] },
    notes: ["Absent and empty are the same thing: no photo means initials, never a placeholder silhouette."],
    examples: ['<span class="m-avatar">JH</span>'],
    css: `
.m-avatar {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; flex: 0 0 auto; overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--primary-fixed); color: var(--primary);
  font-family: var(--font-sans); font-size: 14px; font-weight: 600;
}
.m-avatar > img { width: 100%; height: 100%; object-fit: cover; }
.m-avatar--sm { width: 28px; height: 28px; font-size: 11px; }
.m-avatar--lg { width: 64px; height: 64px; font-size: 20px; }
`,
  },

  {
    name: "ScriptureBlock",
    cls: "m-scripture",
    group: "Display",
    summary: "A quoted passage set in EB Garamond with a gold hairline down its edge, and the reference beneath in tracked caps.",
    variants: { align: ["left", "center"] },
    examples: [
      '<blockquote class="m-scripture">For God so loved the world…<cite class="m-label">John 3:16</cite></blockquote>',
    ],
    css: `
.m-scripture {
  margin: 0; padding: var(--space-sm) 0 var(--space-sm) var(--space-md);
  border-left: 2px solid var(--gold);
  font-family: var(--font-serif); font-size: var(--body-lg-size);
  line-height: var(--body-lg-line); color: var(--on-surface);
}
.m-scripture cite { display: block; margin-top: var(--space-base); font-style: normal; }
.m-scripture--center { border-left: none; padding: var(--space-sm) 0; text-align: center; }
`,
  },

  {
    name: "Divider",
    cls: "m-divider",
    group: "Display",
    summary: "A warm hairline between things. Vertical for toolbar groups, horizontal between sections.",
    variants: { orientation: ["horizontal", "vertical"] },
    examples: ['<span class="m-divider m-divider--vertical"></span>'],
    css: `
.m-divider { display: block; width: 100%; height: 1px; background: var(--outline-variant); border: 0; }
.m-divider--vertical { width: 1px; height: 20px; margin: 0 var(--space-xs); display: inline-block; }
`,
  },

  /* ── Feedback ───────────────────────────────────────────── */
  {
    name: "Spinner",
    cls: "m-spinner",
    group: "Feedback",
    summary:
      "The page's waiting state. Thirteen pages drew this by hand with the same three classes and a 48px Material Symbol.",
    variants: { size: ["sm", "md", "lg"] },
    notes: ["Use m-loading to centre it in the page body — that pairing was written out twelve separate times."],
    examples: [
      '<div class="m-loading"><span class="m-spinner material-symbols-outlined">progress_activity</span></div>',
    ],
    css: `
.m-loading { flex-grow: 1; display: flex; align-items: center; justify-content: center; }
.m-spinner { color: var(--outline); font-size: 48px; animation: m-spin 1s linear infinite; }
.m-spinner--sm { font-size: 20px; }
.m-spinner--lg { font-size: 64px; }
@keyframes m-spin { to { transform: rotate(360deg); } }
`,
  },

  {
    name: "Toast",
    cls: "m-toast",
    group: "Feedback",
    summary: "A short confirmation at the foot of the screen. Error is the only loud tone; everything else is the calm one.",
    variants: { tone: ["default", "error"] },
    notes: ["Its ink follows its background — cream on primary, white on error. --on-primary is cream, not pure white."],
    examples: ['<div class="m-toast">Saved</div>', '<div class="m-toast m-toast--error">That date is taken</div>'],
    css: `
.m-toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 50;
  max-width: 90%; padding: 11px 18px; border-radius: var(--radius);
  background: var(--primary); color: var(--on-primary); box-shadow: var(--shadow-lg);
  font-family: var(--font-sans); font-size: 13px; font-weight: 500; white-space: nowrap;
}
.m-toast--error { background: var(--error); color: var(--on-error); }
`,
  },

  {
    name: "EmptyState",
    cls: "m-empty",
    group: "Feedback",
    summary:
      "What a list says when it has nothing in it. An icon and one calm line inside a dashed container — never italic grey text, which reads as an apology for a state that is usually normal.",
    variants: {},
    notes: [
      "There were 23 italic-grey empty states across nine pages, against a rule the design system had already written down.",
    ],
    examples: [
      '<div class="m-empty"><span class="material-symbols-outlined">event_busy</span><p>Nothing on this week yet.</p></div>',
    ],
    css: `
.m-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: var(--space-base); padding: var(--space-lg) var(--space-md);
  border: 1px dashed var(--outline-variant); border-radius: var(--radius-xl);
  color: var(--on-surface-variant); text-align: center;
}
.m-empty .material-symbols-outlined { font-size: 32px; opacity: .8; }
.m-empty p { margin: 0; font-family: var(--font-sans); font-size: 14px; }
`,
  },

  /* ── Layout ─────────────────────────────────────────────── */
  {
    name: "PageShell",
    cls: "m-page",
    group: "Layout",
    summary: "The body of a desktop page: warm background, navy ink, a column capped at --container-max.",
    variants: {},
    notes: ["The width is the token, not Tailwind's max-w-7xl. Ten pages reached for the framework default before this."],
    examples: ['<body class="m-page"><header class="m-page__bar">…</header><main class="m-page__body">…</main></body>'],
    css: `
.m-page {
  min-height: 100vh; display: flex; flex-direction: column;
  margin: 0; background: var(--background); color: var(--on-background);
  font-family: var(--font-sans); font-size: var(--body-md-size); line-height: var(--body-md-line);
  -webkit-font-smoothing: antialiased;
}
.m-page__bar, .m-page__body {
  width: 100%; max-width: var(--container-max); margin: 0 auto;
  padding-left: var(--space-md); padding-right: var(--space-md);
}
.m-page__bar { display: flex; align-items: center; justify-content: space-between; padding-top: var(--space-base); }
.m-page__body { flex-grow: 1; display: flex; flex-direction: column; gap: var(--space-md); padding-top: var(--space-md); padding-bottom: var(--space-lg); }
`,
  },

  {
    name: "BackLink",
    cls: "m-back",
    group: "Layout",
    summary: "The way out of a page, top left. Eight pages wrote the same arrow-and-label by hand.",
    variants: {},
    examples: [
      '<a class="m-back" href="index.html"><span class="material-symbols-outlined">arrow_back</span><span class="m-label">Home</span></a>',
    ],
    css: `
.m-back {
  display: inline-flex; align-items: center; gap: 4px; text-decoration: none;
  color: var(--on-surface-variant);
  transition: color var(--duration) var(--ease-standard);
}
.m-back:hover { color: var(--primary); }
.m-back .material-symbols-outlined { font-size: 20px; }
`,
  },

  {
    name: "Row",
    cls: "m-row",
    group: "Layout",
    summary:
      "One line of a list: an optional leading avatar or medallion, a title, an optional second line, something trailing. The shape the phone already used, adopted whole rather than reinvented.",
    variants: { variant: ["default", "interactive"], title: ["sans", "serif"] },
    notes: [
      "On a phone the trailing action is always visible — there is no hover on touch.",
      "A serif title is for something a person reads: a hymn, a Role, somebody's name. Sans is for everything operational.",
    ],
    examples: [
      '<div class="m-row"><span class="m-avatar m-avatar--sm">SA</span><div class="m-row__main"><div class="m-row__title">Sarah Adams</div><div class="m-row__sub">Elder · Kids Ministry</div></div><span class="m-badge m-badge--secondary">Elder</span></div>',
    ],
    css: `
.m-row {
  display: flex; align-items: center; gap: var(--space-sm);
  width: 100%; min-height: 48px; padding: 13px 16px; text-align: left;
  border: 0; border-bottom: 1px solid var(--outline-variant);
  background: transparent; font-family: var(--font-sans);
}
.m-row:last-child, .m-row--last { border-bottom: 0; }
.m-row--interactive { cursor: pointer; }
.m-row--interactive:hover { background: var(--surface-container-low); }
.m-row__main { flex: 1; min-width: 0; }
.m-row__title {
  font-family: var(--font-sans); font-size: 15.5px; font-weight: 500; color: var(--on-surface);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.m-row--serif .m-row__title { font-family: var(--font-serif); font-size: 17px; font-weight: 600; }
.m-row__sub {
  margin-top: 2px; font-size: 13px; color: var(--on-surface-variant);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.m-row__meta { flex-shrink: 0; font-size: 13px; color: var(--on-surface-variant); }
.m-row__chevron { display: flex; flex-shrink: 0; color: var(--outline); }
`,
  },

  {
    name: "CardList",
    cls: "m-card-list",
    group: "Layout",
    summary: "Rows gathered into one bordered surface, so a list reads as a single object rather than a stack of cards.",
    variants: {},
    notes: ["No padding of its own — a Row carries its own, so the hairline between rows can run the full width."],
    examples: ['<div class="m-card-list"><div class="m-row">…</div><div class="m-row">…</div></div>'],
    css: `
.m-card-list {
  background: var(--surface-container-lowest);
  border: 1px solid var(--outline-variant); border-radius: var(--radius-xl);
  overflow: hidden;
}
`,
  },
];

/* The one value in the system that is not a token: the focus ring, a
   steel-teal wash at low alpha. It is derived from --tertiary rather than
   typed, so it follows if the brand moves. */
export const EXTRA_ROOT = `  --m-focus-ring: color-mix(in srgb, var(--tertiary) 18%, transparent);`;
