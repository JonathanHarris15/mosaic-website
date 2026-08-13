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
      variant: ["primary", "secondary", "ghost", "quiet", "danger", "danger-outline"],
      size: ["sm", "md", "lg"],
    },
    notes: [
      "Shadow only on primary, and only --shadow-xs. Everything else is flat — depth here comes from tonal layers and warm hairlines.",
      "Disabled drops to 40% and takes not-allowed; it is never hidden, because a control that vanishes reads as a bug.",
      "46px tall, not 40. The phone shipped 46 and it is above the 44px touch floor; one height that works on both beats two that each work on one.",
      "Wrap the word in `.m-btn__label` when the button sits somewhere that collapses to icons — a PageHeader's tool or compact mode. Elsewhere the text can go straight in.",
    ],
    examples: [
      '<button class="m-btn m-btn--primary">Save the service</button>',
      '<button class="m-btn m-btn--secondary m-btn--sm">Cancel</button>',
      '<button class="m-btn m-btn--ghost">Show past dates</button>',
      '<button class="m-btn m-btn--quiet m-btn--sm"><span class="material-symbols-outlined">print</span><span class="m-btn__label">Print PDF</span></button>',
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

/* An optional slot for the button's word. A button that only ever shows its
   word can still write the text straight in — this exists so the surfaces that
   COLLAPSE a button to its glyph (the header's tool and compact modes) have
   something to hide. A bare text node cannot be addressed by a selector. */
.m-btn__label { display: inline; }

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

/* The destructive action that has to be findable without ever being the thing
   your eye lands on. Distinct from --danger because on a roster screen a
   FILLED red button collides with the red that means somebody declined — the
   loudest signal on the calendar cannot also be the colour of a button you are
   meant to walk past. */
.m-btn--danger-outline {
  background: var(--surface-container-lowest); color: var(--error); border-color: var(--error);
}
.m-btn--danger-outline:hover:not(:disabled) { background: var(--error-container); color: var(--on-error-container); }
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
/* Every size here is a token. The overline is --label-sm, one step below
   the field-and-button label at --label-md; --label-xs is the tightest,
   for a caption sitting directly on top of what it names. */
.m-label {
  display: inline-block;
  font-family: var(--font-sans); font-size: var(--label-sm-size);
  font-weight: var(--label-sm-weight); line-height: var(--label-sm-line);
  letter-spacing: var(--label-sm-spacing); text-transform: uppercase;
  color: var(--on-surface-variant);
}
.m-label--sm { font-size: var(--label-xs-size); }
.m-label--lg { font-size: var(--label-md-size); }
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
    notes: [
      "The width is the token, not Tailwind's max-w-7xl. Ten pages reached for the framework default before this.",
      "The bar is PageHeader's job now. `.m-page__bar` was removed in MS-187: its declarations sat INSIDE the capped column, so a bar built on it could never run its background or its hairline to the window edge — which is most of why the eight hand-rolled headers read as eight products. `.m-header` is a sibling of `.m-page__body`, not a child of the column.",
    ],
    examples: ['<body class="m-page"><header class="m-header">…</header><main class="m-page__body">…</main></body>'],
    css: `
.m-page {
  min-height: 100vh; display: flex; flex-direction: column;
  margin: 0; background: var(--background); color: var(--on-background);
  font-family: var(--font-sans); font-size: var(--body-md-size); line-height: var(--body-md-line);
  -webkit-font-smoothing: antialiased;
}
.m-page__body {
  width: 100%; max-width: var(--container-max); margin: 0 auto;
  padding-left: var(--space-md); padding-right: var(--space-md);
  flex-grow: 1; display: flex; flex-direction: column; gap: var(--space-md);
  padding-top: var(--space-md); padding-bottom: var(--space-lg);
}
`,
  },

  {
    name: "PageHeader",
    cls: "m-header",
    group: "Layout",
    summary:
      "The strip across the top of every desktop page: the way back, the page's name, the page's actions, and the account. One component replacing the eight shapes thirty-four pages had arrived at.",
    variants: { type: ["standing", "tool"], title: ["display", "serif"] },
    notes: [
      "WHICH TYPE, in four questions. 1) Does the page fill the viewport and scroll inside its own panes? Yes → --tool. No → the Standing Bar. 2) Is the body one long scroll passing under the top of the window? Yes → --sticky. 3) How wide is the page's column? Set --m-header-max (default --container-max; 1600px for the wide grids; none for full-bleed). 4) Is the title a place in the app or a record in the database? A place → Cinzel. A record → __title--serif.",
      "The bar spans the WINDOW; only its contents align to the page's column. That is the whole reason the top of the screen can look identical on a 760px reading page and a 1600px table, and it is what .m-page__bar could not do.",
      "A Person's name is not chrome. Cinzel is the app's own word for a place — Calendar, Roles Manager. A record the database holds — a Person, a dated Service Guide — is set in EB Garamond, because setting somebody's name in tracked caps makes a member of the church look like a menu item.",
      "The account slot reserves 40px unconditionally. auth.js injects into #auth-container after Firebase resolves, and a bar that changes height when it lands is the layout shift this replaces.",
      "Actions live here, not stacked under the title in main. Up to three. A fourth would go behind a more_vert menu — that rule is written down but deliberately NOT built, because no page has four today and speculative chrome rots (MS-187).",
      "The header never prints. That is in the component, so no page needs its own no-print.",
      "MOTION EXCEPTION: --pulse is an infinite animation, which the system's motion rule otherwise forbids. It is kept on purpose for the two chips that mean something is broken — 'Unsaved', and a booklet over its page limit — because the pulse is what makes anyone notice. Ruled on in MS-187. It yields to prefers-reduced-motion.",
    ],
    examples: [
      '<header class="m-header"><div class="m-header__inner"><div class="m-header__lead"><a class="m-back" href="index.html"><span class="material-symbols-outlined">chevron_left</span><span class="m-back__label">Home</span></a><div class="m-header__titles"><h1 class="m-header__title">Calendar</h1></div></div><div class="m-header__actions"></div><div class="m-header__rule"></div><div class="m-header__auth" id="auth-container"></div></div></header>',
      '<header class="m-header m-header--tool m-header--sticky"><div class="m-header__inner"><div class="m-header__lead"><div class="m-header__titles"><h1 class="m-header__title m-header__title--serif">Service Guide Editor: Sunday, November 9, 2025</h1></div></div></div></header>',
      '<span class="m-badge m-badge--warning m-header__chip"><span class="m-chip-dot m-chip-dot--pulse"></span><span class="m-btn__label">Unsaved</span></span>',
    ],
    css: `
.m-header {
  --m-header-max: var(--container-max);
  --m-header-h: 64px;
  --m-header-pad: var(--space-md);
  --m-header-title: 28px;
  --m-header-title-serif: 30px;
  --m-header-title-track: .02em;
  --m-header-title-transform: none;
  position: relative; z-index: 40; flex: 0 0 auto; width: 100%;
  background: var(--surface-container-lowest);
  border-bottom: 1px solid var(--outline-variant);
}
.m-header__inner {
  display: flex; align-items: center; gap: var(--space-md);
  width: 100%; max-width: var(--m-header-max); margin: 0 auto;
  min-height: var(--m-header-h); padding: 0 var(--m-header-pad);
}
.m-header__lead { display: flex; align-items: center; gap: var(--space-sm); min-width: 0; flex: 1 1 auto; }
.m-header__titles { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.m-header__title {
  margin: 0; min-width: 0;
  font-family: var(--font-display); font-size: var(--m-header-title); font-weight: 600;
  line-height: 1.15; letter-spacing: var(--m-header-title-track);
  text-transform: var(--m-header-title-transform); color: var(--primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* The title names a record the database holds — a Person, a dated Service —
   rather than the app's own name for a place. */
.m-header__title--serif {
  font-family: var(--font-serif); font-size: var(--m-header-title-serif);
  letter-spacing: .01em; text-transform: none; color: var(--on-surface);
}
.m-header__sub {
  font-family: var(--font-sans); font-size: 13.5px; line-height: 1.35;
  color: var(--on-surface-variant);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.m-header--tall { --m-header-h: 84px; }

/* The trail, above the title, where a page can be reached from more than one
   place and which one you came from is worth keeping. It REPLACES the back
   link rather than joining it — two ways out of one page is one too many. */
.m-header__crumbs {
  display: flex; align-items: center; gap: 4px; min-width: 0;
  font-family: var(--font-sans); font-size: var(--label-sm-size); font-weight: var(--label-sm-weight);
  letter-spacing: var(--label-sm-spacing); text-transform: uppercase;
  color: var(--on-surface-variant);
}
.m-header__crumbs a { color: inherit; text-decoration: none; white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; transition: color var(--duration) var(--ease-standard); }
.m-header__crumbs a:hover { color: var(--primary); }
.m-header__crumbs .material-symbols-outlined { font-size: 16px; opacity: .5; flex: 0 0 auto; }

.m-header__actions { display: flex; align-items: center; gap: var(--space-base); flex: 0 0 auto; }
.m-header__rule { align-self: stretch; flex: 0 0 auto; width: 1px; margin: 14px 0; background: var(--outline-variant); }
.m-header__auth { display: flex; align-items: center; gap: var(--space-xs); flex: 0 0 auto; min-height: 40px; }
.m-header__logout { color: var(--error); }
.m-header__logout:hover:not(:disabled) { background: var(--error-container); color: var(--on-error-container); }

/* The page body scrolls under the bar. Translucent parchment and a blur, still
   one hairline, still no shadow. */
.m-header--sticky {
  position: sticky; top: 0; z-index: 50;
  background: color-mix(in srgb, var(--surface-container-lowest) 88%, transparent);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}

/* Full-bleed editors. One tonal step up from white says "working surface"
   without leaving the parchment — this is what replaced the navy bar, which
   was the only filled header in the app and needed a bespoke white button. */
.m-header--tool {
  --m-header-max: none; --m-header-h: 56px;
  --m-header-title: 24px; --m-header-title-serif: 24px;
  position: sticky; top: 0; z-index: 50;
  background: var(--surface-container);
}
/* A tool bar's chrome is already learned and its title is the longest in the
   app, so only the primary action keeps its word. The name gets the slack. */
.m-header--tool .m-header__auth .m-btn__label,
.m-header--tool .m-header__actions .m-btn:not(.m-btn--primary) .m-btn__label { display: none; }
.m-header--tool .m-header__auth .m-btn,
.m-header--tool .m-header__actions .m-btn:not(.m-btn--primary) { width: 38px; padding: 0; }

/* A status chip in the bar: unsaved, over the page limit, refused. */
.m-header__chip { align-self: center; flex: 0 0 auto; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; }
.m-chip-dot { width: 6px; height: 6px; border-radius: var(--radius-full); background: currentColor; flex: 0 0 auto; }
.m-chip-dot--pulse { animation: m-chip-pulse 2s var(--ease-standard) infinite; }
@keyframes m-chip-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
@media (prefers-reduced-motion: reduce) { .m-chip-dot--pulse { animation: none; } }

/* A header is chrome. It never prints. */
@media print { .m-header { display: none; } }

/* ---- Phone metrics: the phone TopBar's 46px row, from the same markup the
   desktop renders. The class is how the gallery shows it at desktop width;
   the media query is how production reaches it. ---- */
.m-header--compact {
  --m-header-h: 46px; --m-header-pad: var(--space-xs);
  --m-header-title: 17px; --m-header-title-serif: 20px;
  --m-header-title-track: .06em; --m-header-title-transform: uppercase;
}
.m-header--compact .m-header__inner { gap: var(--space-xs); }
.m-header--compact .m-header__sub,
.m-header--compact .m-header__crumbs,
.m-header--compact .m-back__label,
.m-header--compact .m-btn__label,
.m-header--compact .m-header__rule { display: none; }
.m-header--compact .m-back { min-width: 44px; justify-content: center; padding-right: 0; }
.m-header--compact .m-header__actions { gap: 2px; }
.m-header--compact .m-header__title--serif { letter-spacing: .01em; }
.m-header--compact .m-header__actions .m-btn {
  width: 44px; height: 44px; padding: 0;
  background: transparent; border-color: transparent; color: var(--primary); box-shadow: none;
}

@media (max-width: 640px) {
  .m-header {
    --m-header-h: 46px; --m-header-pad: var(--space-xs);
    --m-header-title: 17px; --m-header-title-serif: 20px;
    --m-header-title-track: .06em; --m-header-title-transform: uppercase;
  }
  .m-header__inner { gap: var(--space-xs); }
  .m-header__sub, .m-header__crumbs, .m-back__label, .m-btn__label, .m-header__rule { display: none; }
  .m-back { min-width: 44px; justify-content: center; padding-right: 0; }
  .m-header__actions { gap: 2px; }
  .m-header__title--serif { letter-spacing: .01em; }
  .m-header__actions .m-btn {
    width: 44px; height: 44px; padding: 0;
    background: transparent; border-color: transparent; color: var(--primary); box-shadow: none;
  }
}
`,
  },

  {
    name: "BackLink",
    cls: "m-back",
    group: "Layout",
    summary: "The way out of a page, top left. Eight pages wrote the same chevron-and-label by hand.",
    variants: {},
    notes: [
      "The glyph is `chevron_left`, not `arrow_back`. The phone's TopBar always drew a chevron and twenty desktop pages drew an arrow; two glyphs for one idea is the bug, and the phone's was the older and more-used answer (MS-187).",
      "The label names WHERE IT GOES — `Home`, `Calendar`, `People`. Never `Back` and never `Back to Dashboard`: the chevron already says back, so the word is wasted. This collapsed five spellings into one rule.",
      "44px minimum, because it renders on a phone in six pages and was a bare text link with no touch target.",
      "The label is a slot so the header's compact and tool modes can hide it and leave a square chevron. A bare text node cannot be addressed.",
    ],
    examples: [
      '<a class="m-back" href="index.html"><span class="material-symbols-outlined">chevron_left</span><span class="m-back__label">Home</span></a>',
    ],
    css: `
.m-back {
  display: inline-flex; align-items: center; gap: 4px; text-decoration: none;
  flex: 0 0 auto; white-space: nowrap;
  min-height: 44px; padding-right: var(--space-xs);
  color: var(--on-surface-variant);
  transition: color var(--duration) var(--ease-standard);
}
.m-back:hover { color: var(--primary); }
.m-back .material-symbols-outlined { font-size: 20px; }
.m-back__label {
  font-family: var(--font-sans); font-size: var(--label-sm-size); font-weight: var(--label-sm-weight);
  letter-spacing: var(--label-sm-spacing); text-transform: uppercase;
}
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

  /* ── MS-229 ─────────────────────────────────────────────────
     Six things the merged Recurring Events screen needed and the
     library did not have, plus one (.m-notice) it had in eleven
     hand-rolled copies across two pages. */

  {
    name: "SplitView",
    cls: "m-split",
    group: "Layout",
    summary:
      "A list of things beside the one that is open, where picking a row changes the whole right-hand side rather than navigating away.",
    variants: {},
    notes: [
      "The list is a PANEL, not a page. This is the shape for a screen whose subject is one of several similar things — not for a sidebar of navigation.",
      "Stacks below 1000px by media query AND container query, so it collapses correctly whether the page is narrow or the pane it sits in is.",
      "It only stops the two columns. A phone that wants the pane to REPLACE the list entirely does that itself — the component has no opinion about which of the two you are looking at.",
      "--m-split-list overrides the list width; 320px otherwise.",
    ],
    examples: [
      '<div class="m-split"><div class="m-split__list">…</div><div class="m-split__pane">…</div></div>',
    ],
    css: `
.m-split {
  display: grid; grid-template-columns: var(--m-split-list, 320px) minmax(0, 1fr);
  gap: var(--space-md); align-items: start;
}
@media (max-width: 1000px) { .m-split { grid-template-columns: minmax(0, 1fr); } }
@container (max-width: 1000px) { .m-split { grid-template-columns: minmax(0, 1fr); } }
.m-split__list { min-width: 0; }
.m-split__pane { min-width: 0; display: flex; flex-direction: column; }
`,
  },

  {
    name: "PickList",
    cls: "m-picklist",
    group: "Layout",
    summary:
      "The list half of a SplitView: rows you choose between, one of them current, each carrying a colour dot and two lines of detail.",
    variants: { state: ["default", "current"] },
    notes: [
      "Not a CardList of Rows. A Row carries one sub-line, has no current state, and TRUNCATES its title — and the one list that names the subject of the whole screen must be allowed to wrap. A clipped name there is a bug waiting to be filed.",
      "The current row is a tonal step plus a 3px --primary left edge. Both, because the tonal step alone is too quiet against a warm surface and the edge alone reads as decoration.",
    ],
    examples: [
      '<div class="m-picklist"><button class="m-picklist__item m-picklist__item--current"><span class="m-picklist__dot" style="background: var(--event-navy)"></span><span class="m-picklist__main"><span class="m-picklist__name">Sunday Service</span><span class="m-picklist__line">Every Sunday at 10:30 am</span><span class="m-picklist__meta">5 roles · next 17 Aug</span></span></button></div>',
    ],
    css: `
.m-picklist {
  background: var(--surface-container-lowest);
  border: 1px solid var(--outline-variant); border-radius: var(--radius-xl);
  overflow: hidden;
}
.m-picklist__item {
  display: flex; align-items: flex-start; gap: var(--space-base);
  width: 100%; padding: 11px var(--space-sm) 12px; text-align: left;
  background: transparent; border: 0;
  border-bottom: 1px solid var(--outline-variant);
  border-left: 3px solid transparent;
  cursor: pointer; font-family: var(--font-sans);
  transition: background-color var(--duration) var(--ease-standard);
}
.m-picklist__item:last-child { border-bottom: 0; }
.m-picklist__item:hover { background: var(--surface-container-low); }
.m-picklist__item:focus-visible { outline: 2px solid var(--tertiary); outline-offset: -2px; }
.m-picklist__item--current { background: var(--surface-container-low); border-left-color: var(--primary); }
.m-picklist__dot {
  width: 10px; height: 10px; margin-top: 5px; flex: 0 0 auto;
  border-radius: var(--radius-full); border: 1px solid var(--outline-variant);
}
.m-picklist__main { min-width: 0; flex: 1 1 auto; }

/* It WRAPS. There is no stored cap on the name, and clipping the one list
   that identifies what the rest of the screen is about is not a saving. */
.m-picklist__name {
  display: block; font-size: 14.5px; line-height: 1.35;
  color: var(--on-surface); text-wrap: pretty;
}
.m-picklist__item--current .m-picklist__name { font-weight: 600; }
.m-picklist__line { display: block; margin-top: 2px; font-size: 12px; line-height: 1.4; color: var(--on-surface-variant); }
.m-picklist__meta { display: block; margin-top: 2px; font-size: 11.5px; color: var(--outline); }
`,
  },

  {
    name: "Tabs",
    cls: "m-tabs",
    group: "Layout",
    summary:
      "The tab bar inside a pane, when one selected thing has more sides to it than a page can sensibly stack.",
    variants: { state: ["default", "current"] },
    notes: [
      "Inside a PANE, over a hairline — not across the top of a page. A page with tabs is usually a page that should have been two pages.",
      "Tracked caps at the same weight the header uses for a label, so the pane's chrome and the page's agree rather than competing.",
      "46px is the button height; this is 44 — it is chrome, not an action, and it still clears the touch floor.",
      "__dot marks a tab holding work that has not been saved. Amber, never red: red on a roster surface means somebody declined. Static, because the motion rule forbids a pulse.",
      "overflow-x: auto with the scrollbar hidden, so four tabs survive a 390px phone.",
    ],
    examples: [
      '<div class="m-tabs"><button class="m-tabs__tab m-tabs__tab--current">Rota</button><button class="m-tabs__tab">The event<span class="m-tabs__dot"></span></button></div>',
    ],
    css: `
.m-tabs {
  display: flex; align-items: stretch; gap: 2px; flex: 0 0 auto;
  overflow-x: auto; scrollbar-width: none;
  border-bottom: 1px solid var(--outline-variant);
}
.m-tabs::-webkit-scrollbar { display: none; }
.m-tabs__tab {
  display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto;
  min-height: 44px; padding: 0 var(--space-sm);
  background: transparent; border: 0; border-bottom: 2px solid transparent;
  color: var(--on-surface-variant);
  font-family: var(--font-sans); font-size: 11.5px; font-weight: 600;
  letter-spacing: .14em; text-transform: uppercase; white-space: nowrap;
  cursor: pointer;
  transition: color var(--duration) var(--ease-standard),
              border-color var(--duration) var(--ease-standard);
}
.m-tabs__tab:hover { color: var(--primary); }
.m-tabs__tab:focus-visible { outline: 2px solid var(--tertiary); outline-offset: -2px; }
.m-tabs__tab--current { color: var(--primary); border-bottom-color: var(--primary); }

/* Work not yet pressed into the record. */
.m-tabs__dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: var(--radius-full); background: var(--warning); }
`,
  },

  {
    name: "ActionBar",
    cls: "m-actionbar",
    group: "Layout",
    summary:
      "A pane's own sticky footer: what the current selection adds up to, said in words on the left, and the actions that take it somewhere on the right.",
    variants: {},
    notes: [
      "It belongs to the PANE, not to a tab. Where a selection is made in one place and acted on from another, a footer that scrolls away gets drawn twice — which is exactly what it replaces.",
      "The words on the left are not a caption. They are what makes the buttons honest: how many, which ones, and what the action will quietly not touch.",
      "Hidden in print. A sticky bar over a printed rota covers the last row.",
    ],
    examples: [
      '<div class="m-actionbar"><div class="m-actionbar__said"><p class="m-actionbar__count">5 dates ticked</p><p class="m-actionbar__note">Two more come with them.</p></div><div class="m-actionbar__acts"><button class="m-btn m-btn--primary m-btn--sm">Auto-assign 7 dates</button></div></div>',
    ],
    css: `
.m-actionbar {
  position: sticky; bottom: 0; z-index: 5;
  display: flex; align-items: flex-start; gap: var(--space-md); flex-wrap: wrap;
  padding: var(--space-sm) var(--space-md);
  background: color-mix(in srgb, var(--surface-container-lowest) 92%, transparent);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  border-top: 1px solid var(--outline-variant);
}
.m-actionbar__said { flex: 1 1 22ch; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.m-actionbar__count { font-size: 14px; color: var(--on-surface); }
.m-actionbar__note { font-size: 12.5px; line-height: 1.45; color: var(--on-surface-variant); text-wrap: pretty; }
.m-actionbar__acts { display: flex; align-items: center; gap: var(--space-base); flex-wrap: wrap; flex: 0 0 auto; }
@media print { .m-actionbar { display: none; } }
`,
  },

  {
    name: "RotaGrid",
    cls: "m-rota",
    group: "Display",
    summary:
      "Roles down the side, dates across the top, and what is really stored in the cells. The role column stays put while the dates scroll, each column header ticks, and an unfilled place is drawn rather than left blank.",
    variants: { column: ["default", "picked"] },
    notes: [
      "⚠ THE ROLE COLUMN STAYS PUT. Eight date columns are wider than any screen, and scrolling that took the row headings away would leave you reading names three columns in with no idea which Role they are in.",
      "An unfilled place is DRAWN — a dashed ring and a word. A blank cell reads as a place somebody forgot to fill; seeing the hole before the morning it matters is the whole point of reading ahead.",
      "A ticked column is tinted the whole way down, so a selection reads as 'these dates' rather than as a row of checkboxes at the top. The header tint is stronger than the body's.",
      "__state is the one line that lets an editor pick columns from the header instead of reading every cell under it.",
      "Only __scroll scrolls sideways. The page never does.",
    ],
    examples: [
      '<div class="m-rota"><div class="m-rota__scroll"><table class="m-rota__table">…</table></div></div>',
    ],
    css: `
.m-rota {
  border: 1px solid var(--outline-variant); border-radius: var(--radius-xl);
  background: var(--surface-container-lowest); overflow: hidden;
}
.m-rota__scroll { overflow-x: auto; }
.m-rota__table {
  width: 100%; text-align: left; border-collapse: separate; border-spacing: 0;
  font-family: var(--font-sans);
}
.m-rota__table th, .m-rota__table td { border-bottom: 1px solid var(--surface-dim); vertical-align: top; }
.m-rota__table tbody tr:last-child th, .m-rota__table tbody tr:last-child td { border-bottom: 0; }
.m-rota__stick {
  position: sticky; left: 0; z-index: 2;
  background: var(--surface-container-lowest);
  border-right: 1px solid var(--surface-dim);
}
.m-rota__table thead .m-rota__stick { z-index: 3; }
.m-rota__table thead th {
  position: sticky; top: 0; z-index: 1;
  background: var(--surface-container-lowest); vertical-align: bottom;
  padding: 10px var(--space-sm);
}
.m-rota__table tbody th, .m-rota__table tbody td { padding: 10px var(--space-sm); }
.m-rota__table tbody th { font-weight: 400; min-width: 180px; }
.m-rota__col { min-width: 158px; }
.m-rota__role { display: block; font-size: 13.5px; color: var(--on-surface); }
.m-rota__rolesub { display: block; margin-top: 2px; font-size: 11px; color: var(--outline); }
.m-rota__head { display: flex; align-items: flex-start; gap: var(--space-base); cursor: pointer; }
.m-rota__day {
  display: block; font-family: var(--font-sans); font-size: 10.5px; font-weight: 600;
  letter-spacing: .12em; text-transform: uppercase; color: var(--on-surface-variant);
}
.m-rota__date { display: block; font-size: 13.5px; color: var(--on-surface); }
.m-rota__state { display: block; margin-top: 2px; font-size: 11px; color: var(--on-surface-variant); }
.m-rota__state--full { color: var(--success); }
.m-rota__state--declined { color: var(--error); }
.m-rota__state--off { color: var(--outline); }
.m-rota__table th.m-rota--picked { background: color-mix(in srgb, var(--tertiary) 13%, var(--surface-container-lowest)); }
.m-rota__table td.m-rota--picked { background: color-mix(in srgb, var(--tertiary) 7%, transparent); }
.m-rota__cell { display: flex; flex-direction: column; gap: 5px; }
.m-rota__place { display: flex; align-items: center; gap: 6px; min-width: 0; }
.m-rota__initials {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; flex: 0 0 auto;
  border-radius: var(--radius-full); border: 1px solid var(--outline-variant);
  background: var(--surface-container-high);
  font-size: 9.5px; font-weight: 600; letter-spacing: .02em; color: var(--on-surface-variant);
}
.m-rota__initials--declined { background: var(--error-container); border-color: var(--error); color: var(--on-error-container); }
.m-rota__name {
  min-width: 0; font-size: 13px; color: var(--on-surface);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.m-rota__name--declined { color: var(--error); text-decoration: line-through; }

/* An unfilled place is DRAWN. */
.m-rota__hole { display: flex; align-items: center; gap: 6px; color: var(--outline); }
.m-rota__hole-dot { width: 22px; height: 22px; flex: 0 0 auto; border-radius: var(--radius-full); border: 1px dashed var(--outline-variant); }
.m-rota__hole-label { font-size: 12.5px; font-style: italic; }
.m-rota__none { font-size: 12px; color: var(--outline); }

/* Narrow: the role column still stays put, but it stops eating half a phone. */
@media (max-width: 640px) { .m-rota__table tbody th { min-width: 132px; } .m-rota__col { min-width: 140px; } }
@container (max-width: 640px) { .m-rota__table tbody th { min-width: 132px; } .m-rota__col { min-width: 140px; } }
`,
  },

  {
    name: "Notice",
    cls: "m-notice",
    group: "Feedback",
    summary:
      "The edged bar: signed out, a read that failed, a write that half-failed, or what a selection adds up to. One component, four tones, replacing eleven hand-rolled copies.",
    variants: { tone: ["gold", "info", "warning", "error"] },
    notes: [
      "Gold is 'you are not signed in' and other doors. Info (tertiary) is what the app is telling you about your own selection. Warning is amber — something needs looking at. Error is a read or a write that failed.",
      "⚠ There is no 'danger' tone beyond --error, and nothing decorative is ever red. On the serving surfaces red already means somebody declined.",
      "The left edge carries the tone at 3px; gold and info keep the ordinary surface behind them, warning and error take their container. A gold bar with a gold background would shout as loudly as an error.",
    ],
    examples: [
      '<div class="m-notice m-notice--gold"><span class="material-symbols-outlined m-notice__icon">person_off</span><div class="m-notice__body"><p class="m-notice__title">You are not signed in.</p><p class="m-notice__text">Sign in to see the events that repeat and who is on them.</p></div><div class="m-notice__acts"><a class="m-btn m-btn--primary m-btn--sm" href="#">Sign in</a></div></div>',
    ],
    css: `
.m-notice {
  display: flex; align-items: flex-start; gap: var(--space-sm);
  padding: 11px var(--space-md);
  border: 1px solid var(--outline-variant); border-left-width: 3px;
  border-radius: var(--radius); background: var(--surface-container-low);
}
.m-notice__icon { flex: 0 0 auto; font-size: 20px; color: var(--on-surface-variant); }
.m-notice__body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.m-notice__title { font-size: 14px; color: var(--on-surface); }
.m-notice__text { font-size: 12.5px; line-height: 1.45; color: var(--on-surface-variant); text-wrap: pretty; }
.m-notice__acts { flex: 0 0 auto; display: flex; align-items: center; gap: var(--space-base); }
.m-notice--gold { border-left-color: var(--gold); }
.m-notice--gold .m-notice__icon { color: var(--gold); }
.m-notice--info { border-left-color: var(--tertiary); }
.m-notice--info .m-notice__icon { color: var(--tertiary); }
.m-notice--warning { border-left-color: var(--warning); background: var(--warning-container); }
.m-notice--warning .m-notice__icon { color: var(--on-warning-container); }
.m-notice--warning .m-notice__title, .m-notice--warning .m-notice__text { color: var(--on-warning-container); }
.m-notice--error { border-left-color: var(--error); background: var(--error-container); }
.m-notice--error .m-notice__icon,
.m-notice--error .m-notice__title,
.m-notice--error .m-notice__text { color: var(--on-error-container); }
`,
  },

  {
    name: "MonthGrid",
    cls: "m-cal",
    group: "Display",
    summary:
      "The month, seven columns wide. Rows floor at 112px and grow to what is on them; the numeral sits out of the way on the right, and a day carrying more than its row holds says so rather than hiding it.",
    notes: [
      "⚠ A CELL IS NOT A CARD. `.m-card` was tried and bent out of shape: this needs seven equal columns, a row that grows, a per-cell overflow line and a chip whose colour bar comes from data. It is the only grid of its kind in the app.",
      "Sunday carries one tonal step and nothing else does. The church's week has a shape and the grid should show it before you read a word — but tinting both ends draws a box round the weekend, which is somebody else's week, not this one's.",
      "⚠ WHICH COLUMN A CELL IS IN IS A CLASS — `--sunday`, `--rowend` — NEVER `nth-child`. Alpine's `<template x-for>` stays put as the grid's first child, so the nth cell is not the nth child and a positional rule lands one column out. That shipped once: Saturday tinted, Friday missing its rule.",
      "A day from the month either side keeps the week rule under it — a horizontal line has to run the full width — but loses its vertical, so the corners of the month dissolve rather than being ruled off into boxes nobody is meant to read. It is not tinted: two tones in a row is one too many.",
      "`--fit` divides whatever height is left into equal rows, so the month ends where the window does. You scroll for more information, never to see the rest of what is already on screen.",
      "⚠ `--open` IS A WEEK, NOT A DAY. A cell cannot be taller than its row, so opening one opens the row — and every day on that row then shows everything, rather than sitting beside empty space with events still hidden. `--open` stops the grid dividing the window; the caller pins the other rows to the height they already had, so the opened week is the only thing that moves.",
    ],
    examples: [
      '<section class="m-cal"><div class="m-cal__days"><div class="m-cal__day">SUN</div>…</div><div class="m-cal__grid"><div class="m-cal__cell"><div class="m-cal__head"><span class="m-cal__num">3</span></div><div class="m-cal__events">…</div></div>…</div></section>',
    ],
    css: `
.m-cal {
  background: var(--surface-container-lowest);
  border: 1px solid var(--outline-variant); border-radius: var(--radius-xl);
  overflow: hidden;
}
.m-cal__days {
  display: grid; grid-template-columns: repeat(7, minmax(0, 1fr));
  background: var(--surface-container-low);
  border-bottom: 1px solid var(--outline-variant);
}
.m-cal__day {
  padding: 9px var(--space-sm); text-align: right;
  font-family: var(--font-sans); font-size: 10.5px; font-weight: 600;
  letter-spacing: .12em; text-transform: uppercase; color: var(--on-surface-variant);
}
.m-cal__grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.m-cal__cell {
  position: relative; display: flex; flex-direction: column; gap: 6px;
  min-width: 0; min-height: 112px; padding: 7px 0 10px; text-align: left;
  background: transparent;
  border-right: 1px solid var(--outline-variant);
  border-bottom: 1px solid var(--outline-variant);
  transition: background-color var(--duration) var(--ease-standard);
}
/* ⚠ THE COLUMN A CELL IS IN IS A CLASS, NEVER nth-child. A framework that
   renders a list leaves its own element among the children — Alpine's
   x-for template stays put as the grid's first child — so the nth cell is
   not the nth child and every rule keyed on position lands one column out.
   It is the same trap data-rail-month exists for on the rail. */
.m-cal__cell--rowend { border-right: 0; }

/* Sunday, and never a day belonging to the month either side: the church's
   week has a shape and the grid should show it before you read a word. */
.m-cal__cell--sunday:not(.m-cal__cell--outside) { background: var(--surface-container-low); }
.m-cal__cell--outside { opacity: .45; border-right-color: transparent; }
.m-cal__cell--outside + .m-cal__cell:not(.m-cal__cell--outside) { border-left: 1px solid var(--outline-variant); }
.m-cal__cell--clickable { cursor: pointer; }
.m-cal__cell--clickable:hover { background: var(--surface-container); }
.m-cal__cell:focus-visible { outline: 2px solid var(--tertiary); outline-offset: -2px; }

.m-cal__head { display: flex; align-items: center; justify-content: flex-end; gap: 5px; min-height: 23px; padding: 0 8px; }

/* The date is a record, not chrome — serif, and tabular so a column of
   them lines up. Display-face numerals read as a heading. */
.m-cal__num {
  font-family: var(--font-serif); font-size: 15px; line-height: 1;
  color: var(--on-surface); font-variant-numeric: tabular-nums;
}
.m-cal__num--outside { color: var(--outline); }
.m-cal__num--today {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 23px; height: 23px; border-radius: var(--radius-full);
  background: var(--primary); color: var(--on-primary); font-weight: 600;
}
.m-cal__flag { font-size: 16px; color: var(--error); flex: 0 0 auto; }
.m-cal__events { display: flex; flex-direction: column; gap: 3px; min-width: 0; }

/* What the day is holding and not drawing. Never a silent truncation.
   A LABEL, NOT A CONTROL — the whole cell is what opens the week, so a
   second small target inside it would be hiding the answer twice. */
.m-cal__more {
  align-self: flex-start; padding: 2px 8px;
  font-family: var(--font-sans); font-size: 11.5px;
  color: var(--on-surface-variant); pointer-events: none;
}
.m-cal__cell--clickable:hover .m-cal__more { color: var(--primary); }

/* ── Fitted to the window ─────────────────────────────────────
   The rows divide the height left after everything above them, so the
   last week ends where the window does. What a cell can hold follows
   the row rather than being fixed. */
.m-cal--fit { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.m-cal--fit .m-cal__grid { flex: 1 1 auto; min-height: 0; grid-auto-rows: minmax(0, 1fr); }
.m-cal--fit .m-cal__cell { min-height: 0; overflow: hidden; gap: 4px; padding: 5px 0 7px; }
.m-cal--fit .m-cal__head { min-height: 21px; }
/* Fitted, a name past two lines is cut. It is whole on the chip's
   title, on the list row, and in the cell once it is opened. */
.m-cal--fit .m-chip { padding: 4px 8px; }
.m-cal--fit .m-chip__label {
  font-size: 11.5px; line-height: 1.25;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.m-cal--fit .m-chip--sunday .m-chip__label { font-size: 13px; }
/* Fitted, the count rides in the free corner opposite the numeral
   rather than taking a line the row has not got. */
.m-cal--fit .m-cal__more { position: absolute; top: 4px; left: 5px; padding: 0; font-size: 10.5px; letter-spacing: .04em; }

/* ── A week opened out ────────────────────────────────────────
   A cell cannot be taller than its row, so what grows is the ROW —
   and once a row is taller, every day on it shows everything it has
   rather than sitting next to empty space with events still hidden.

   ⚠ THE OTHER ROWS ARE PINNED, NOT LEFT TO REFLOW. Dropping the
   1fr lets every row size to its own contents, which would redraw
   the whole month around the week somebody asked to read. So the
   grid stops dividing the window and the page pins every other cell
   to the height it already had — the opened week is the only thing
   that moves. The page is allowed to scroll while one is open. */
.m-cal--fit.m-cal--open .m-cal__grid { grid-auto-rows: auto; }
.m-cal__cell--expanded { overflow: visible; }
/* Whatever a fitted cell clipped to make the month fit is unclipped
   here — the whole point of opening it is to read what was cut. */
.m-cal--fit .m-cal__cell--expanded .m-chip__label {
  display: block; -webkit-line-clamp: none; overflow: visible;
}
`,
  },

  {
    name: "EventChip",
    cls: "m-chip",
    group: "Display",
    summary:
      "One event, in a day cell or anywhere else that lists them. One shape, six families, and only the two that ask something of somebody carry a fill.",
    variants: { family: ["other", "sunday", "mine", "unfilled", "declined", "off"] },
    notes: [
      "⚠ THE RULE THE WHOLE CALENDAR RESTS ON. A chosen event colour only ever draws the BAR down the side; a tint only ever fills the BACKGROUND. So a filled chip always means the app is saying something, and a bar always means somebody picked a shade. Set the bar with an inline `border-left-color` from data — it is the one value that cannot be a class.",
      "Loudness, and it is deliberate: off · declined · unfilled · mine · sunday · other. Only `--declined` (error) and `--unfilled` (warning) fill. `mine` is a semibold name and the navy dot; `other` is a bar and a name.",
      "⚠ RED IS SPOKEN FOR. `--declined` means somebody said no. Nothing decorative is ever red, and no event colour includes one.",
      "The `__you` dot reads off whether the person is serving, NOT off the family — so an amber chip you are on still says so.",
      "A name WRAPS rather than truncating, and breaks at a space and nowhere else: `overflow-wrap: break-word` put \"Servic / e\" in a 90px cell, which is worse than either.",
      "A chip carrying a leading glyph drops its trailing one. Two glyphs and a name in a 110px chip is one too many.",
      "⚠ THE FAMILIES ARE BUILT, NOT TYPED — `'m-chip--' + chipKind(ev)`. So the class checker reports most of them as unused and always will. They are not dead; deleting one silently drops a whole state off the Calendar.",
    ],
    examples: [
      '<button class="m-chip m-chip--other" style="border-left-color: var(--event-steel)"><span class="m-chip__label">Midweek Gathering</span></button>',
      '<button class="m-chip m-chip--unfilled" style="border-left-color: var(--event-ocean)"><span class="m-chip__you"></span><span class="material-symbols-outlined m-chip__icon">warning</span><span class="m-chip__label">Sunday Service</span></button>',
    ],
    css: `
.m-chip {
  display: flex; align-items: flex-start; gap: 5px;
  width: 100%; min-width: 0; padding: 5px 8px; text-align: left;
  background: transparent; border: 0;
  border-left: 3px solid var(--outline-variant); border-radius: var(--radius-sm);
  cursor: pointer; font-family: var(--font-sans);
  transition: background-color var(--duration) var(--ease-standard);
}
.m-chip:hover { background: var(--surface-container); }
.m-chip:focus-visible { outline: 2px solid var(--tertiary); outline-offset: -1px; }
.m-chip__label {
  min-width: 0; font-size: 12px; font-weight: 500; line-height: 1.3;
  color: var(--on-surface);
  overflow-wrap: normal; word-break: normal; hyphens: none; text-wrap: pretty;
}
.m-chip__icon { flex: 0 0 auto; font-size: 14px; margin-top: 1px; }
.m-chip__trail { flex: 0 0 auto; margin-left: auto; font-size: 13px; color: var(--outline); }
.m-chip--declined .m-chip__trail, .m-chip--unfilled .m-chip__trail { display: none; }
.m-chip__you {
  width: 5px; height: 5px; flex: 0 0 auto; margin-top: 5px;
  border-radius: var(--radius-full); background: var(--primary);
}

/* In a day cell the chip is full-bleed: the column edge does the
   aligning, so it needs no corner of its own. */
.m-cal__events .m-chip { border-radius: 0; }

.m-chip--mine .m-chip__label { font-weight: 600; }
.m-chip--sunday .m-chip__label { font-family: var(--font-serif); font-size: 13.5px; font-weight: 600; line-height: 1.25; }
.m-chip--declined { background: var(--error-container); }
.m-chip--declined .m-chip__label, .m-chip--declined .m-chip__icon { color: var(--on-error-container); }
.m-chip--declined:hover { background: color-mix(in srgb, var(--error-container) 80%, var(--error)); }
.m-chip--unfilled { background: var(--warning-container); }
.m-chip--unfilled .m-chip__label, .m-chip--unfilled .m-chip__icon { color: var(--on-warning-container); }
.m-chip--unfilled:hover { background: color-mix(in srgb, var(--warning-container) 80%, var(--warning)); }

/* Called off, or moved away. It never carries the dot or a glyph —
   there is nothing to do about it. */
.m-chip--off { border-left-style: dashed; opacity: .55; }
.m-chip--off .m-chip__label { text-decoration: line-through; }

/* Day two onwards of something running over several days: named,
   because somebody scanning Wednesday needs to know half-term is on —
   but quieter, so five days do not read as five events. */
.m-chip--continues { opacity: .7; }
`,
  },

  {
    name: "MonthStrip",
    cls: "m-strip",
    group: "Display",
    summary:
      "The phone's month: seven columns of day numbers, each carrying up to three dots. A glance, not a list — the count lives in the cards underneath it.",
    notes: [
      "Three dots and no more. A fourth 5px dot in a ~46px cell has nowhere to go, and asking the strip to be exhaustive is asking it to stop being a glance.",
      "A dot takes the same colour the chip's family would, so the strip and the cards under it cannot disagree about what a day looks like.",
      "Two grids, not one: the weekday letters and the days. They share the column count so they line up without either knowing about the other.",
    ],
    examples: [
      '<div class="m-strip"><div class="m-strip__day">S</div>…</div><div class="m-strip"><button class="m-strip__cell m-strip__cell--current"><span class="m-strip__num">16</span><span class="m-strip__dots"><span class="m-strip__dot" style="background: var(--event-ocean)"></span></span></button>…</div>',
    ],
    css: `
.m-strip { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
.m-strip__day {
  text-align: center; padding-bottom: 4px;
  font-family: var(--font-sans); font-size: 9.5px; font-weight: 600;
  letter-spacing: .1em; text-transform: uppercase; color: var(--outline);
}
.m-strip__cell {
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 7px 0; border: 0; background: transparent;
  border-radius: var(--radius); cursor: pointer;
  transition: background-color var(--duration) var(--ease-standard);
}
.m-strip__cell--current { background: var(--surface-container); }
.m-strip__cell:focus-visible { outline: 2px solid var(--tertiary); outline-offset: -2px; }
.m-strip__num { font-family: var(--font-serif); font-size: 14px; line-height: 1; color: var(--on-surface); }
.m-strip__cell--outside .m-strip__num { color: var(--outline); }
.m-strip__cell--current .m-strip__num { color: var(--primary); font-weight: 600; }
.m-strip__dots { display: flex; gap: 2px; height: 5px; }
.m-strip__dot { width: 5px; height: 5px; border-radius: var(--radius-full); }
`,
  },

  {
    name: "Settled",
    cls: "m-settled",
    group: "Display",
    summary:
      "Where something cannot change because it is settled, the sentence is the control. Greying one out implies a permission you might one day be given.",
    variants: { size: ["md", "sm"] },
    notes: [
      "Not a disabled input, not a tooltip, not a lock glyph on its own. A disabled control says 'not for you'; this says 'not a question'.",
      "Serif, because it is read rather than operated. The rule marks it as quoted from the model rather than typed into a field.",
    ],
    examples: [
      '<p class="m-settled">Anyone at all. A Sunday Service is always public — that is settled, not a setting.</p>',
    ],
    css: `
.m-settled {
  margin: 0; padding-left: var(--space-sm);
  border-left: 2px solid var(--outline-variant);
  font-family: var(--font-serif); font-size: 16px; line-height: 1.5;
  color: var(--on-surface); text-wrap: pretty;
}
.m-settled--sm { font-size: 15px; }
`,
  },
];

/* The one value in the system that is not a token: the focus ring, a
   steel-teal wash at low alpha. It is derived from --tertiary rather than
   typed, so it follows if the brand moves. */
export const EXTRA_ROOT = `  --m-focus-ring: color-mix(in srgb, var(--tertiary) 18%, transparent);`;
