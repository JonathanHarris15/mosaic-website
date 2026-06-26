// Guide Seed — the developer-seeded Page Library, Style Preset, and default
// Service Guide Template that reproduce today's 16-page booklet 1:1 (ADR-0008
// decision #1, the v1 acceptance gate).
//
// The eight hardcoded page types are reborn here as Page Templates composed from
// Components (guide-components.js). Nothing is special-cased in the engine: the
// default Service Guide Template is just an ordered list of these Page Templates,
// and the engine expands it like any other.
//
// IDs are stable ('seed_*') so re-seeding upserts rather than duplicating. The
// seed is plain data plus buildSeed(catalog), which derives each page's Entry
// Fields. Phase 2 writes this to Firestore; the golden tests build a snapshot
// from it and assert the output matches the old booklet.
//
// Loaded as a classic <script> after guide-engine.js + guide-components.js;
// IIFE exposes window.GuideSeed. Also module.exports for Node.
(function (global) {
    'use strict';

    const Engine = (typeof require !== 'undefined') ? require('./guide-engine.js') : global.GuideEngine;
    const Components = (typeof require !== 'undefined') ? require('./guide-components.js') : global.GuideComponents;

    // ── Style Preset: shared booklet CSS (the old .latex-* rules) ──────────────
    const BOOKLET_CSS = `.latex-h1 { font-size: 1.1rem; font-weight: 400; display: block; }
.latex-hr { border-top: 1px solid #000; margin-top: 0.25rem; margin-bottom: 0.25rem; width: 100%; }
.latex-spacing-2 { line-height: 2.2; }
.preview-page ul, .preview-page ol { list-style-type: disc; padding-left: 2rem; }`;

    const STYLE_PRESETS = [
        { id: 'seed_booklet', name: 'Mosaic Booklet', css: BOOKLET_CSS },
    ];

    // ── Page Templates (the eight, reborn) ─────────────────────────────────────
    // Each `html` is the page BODY (what sits inside a .preview-page frame), with
    // Component tags where data flows. Verbatim Tailwind classes from today.

    const TITLE_HTML = `<div class="h-full flex flex-col items-center pt-[1in]">
  <img src="assets/standard/titlepageim.png" class="w-full mb-[0.8in]" alt="Title Image" />
  <div class="text-[1.1rem] mt-[0.2in]"><service-date format="long"></service-date></div>
</div>`;

    const OOS_HTML = `<oos-list></oos-list>`;

    const HYMN_HTML = `<hymn-sheet></hymn-sheet>`;

    const PRAYER_HTML = `<div class="text-[10pt] relative h-full">
  <div class="flex justify-between items-baseline"><span class="text-[1.1rem] font-bold"><pastoral-prayer-label></pastoral-prayer-label></span></div>
  <div class="latex-hr mb-4"></div>
  <div class="space-y-[8.5em] mb-4 flex-shrink-0">
    <div>&nbsp;</div>
    <div><span class="font-bold">Church:</span><pastoral-prayer-subjects></pastoral-prayer-subjects></div>
    <div><span class="font-bold">Nation/Country:</span> <span class="italic"><input-text key="pp_nation" label="Nation" required></input-text></span></div>
  </div>
  <div class="mt-4 pl-6 space-y-1 text-[9.5pt]">
    <div><b>Continent:</b> <span><input-text key="pp_continent" label="Continent"></input-text></span></div>
    <div><b>Capital:</b> <span><input-text key="pp_capital" label="Capital" required></input-text></span></div>
    <div><b>Population:</b> <span><input-text key="pp_population" label="Population"></input-text></span></div>
    <div><b>Official Language:</b> <span><input-text key="pp_language" label="Official Language"></input-text></span></div>
    <div><b>Total Languages:</b> <span><input-text key="pp_total_languages" label="Total Languages"></input-text></span></div>
    <div><b>Literacy Rate:</b> <span><input-text key="pp_literacy" label="Literacy Rate"></input-text></span></div>
    <div><b>Christian:</b> <span><input-text key="pp_christian" label="Christian"></input-text></span></div>
    <div><b>Evangelical:</b> <span><input-text key="pp_evangelical" label="Evangelical"></input-text></span></div>
    <div><b>Un-evangelized:</b> <span><input-text key="pp_unevangelized" label="Un-evangelized"></input-text></span></div>
  </div>
  <div class="absolute top-[30%] right-0 w-[40%] flex items-center justify-center aspect-square overflow-hidden">
    <input-image key="pp_country_image" label="Country Map Image" placeholder="No Country Map Uploaded"></input-image>
  </div>
  <div class="mt-8">
    <div class="underline font-bold mb-2">Prayer Prompts for Country:</div>
    <input-list key="pp_prompts" label="Prayer Prompts" render-as="bullets" class="pl-8 space-y-0.5 text-[9.5pt]"></input-list>
  </div>
</div>`;

    const NOTES_HTML = `<div class="h-full flex flex-col">
  <div class="flex justify-between items-baseline flex-shrink-0"><span class="text-[1.1rem] font-bold">Sermon Notes</span></div>
  <div class="latex-hr mb-4 flex-shrink-0"></div>
  <div class="flex-1"></div>
</div>`;

    const KIDS_HTML = `<div class="text-[10pt] h-full flex flex-col">
  <div class="flex justify-between items-baseline flex-shrink-0"><span class="text-[1.1rem] font-bold">Parent Discussion: Mosaic Kids</span></div>
  <div class="latex-hr mb-4 flex-shrink-0"></div>
  <p class="text-[9.5pt] leading-relaxed indent-8">For parents whose kids attended Mosaic Kids, this section contains a summary of the lesson they received as well as provides questions for you to ask your kids. We, as a church, want to assist you as parents in educating your kids and to help them continue to think about what they learned beyond just Sunday.</p>
  <div class="mt-8 text-center space-y-2 flex-shrink-0">
    <div class="text-[1.1rem] font-bold italic"><input-text key="kids_lesson_title" label="Lesson Title" required></input-text></div>
    <div class="text-[9pt]"><input-text key="kids_lesson_verse" label="Passage Reference" required></input-text></div>
    <div class="latex-hr w-[80%] mx-auto opacity-30"></div>
  </div>
  <div class="mt-8 space-y-6 flex-grow overflow-hidden">
    <div>
      <div class="font-bold italic mb-2">Bible Story Summary:</div>
      <input-list key="kids_summary" label="Story Summary Points" render-as="bullets" class="text-[11pt] leading-relaxed space-y-1"></input-list>
    </div>
    <div class="latex-hr w-[80%] mx-auto opacity-30"></div>
    <div>
      <div class="font-bold italic mb-2">Review Questions:</div>
      <input-list key="kids_questions" label="Review Questions" render-as="bullets" class="text-[11pt] leading-relaxed space-y-1"></input-list>
    </div>
  </div>
</div>`;

    const ANNOUNCEMENTS_HTML = `<div class="flex flex-col h-full text-[10pt]">
  <div class="flex justify-between items-baseline"><span class="text-[1.1rem] font-bold">Announcements</span></div>
  <div class="latex-hr mb-2"></div>
  <div class="min-h-[2.2in] mb-4 overflow-hidden">
    <input-list key="announcements" label="Weekly Announcements" render-as="announcements" required></input-list>
  </div>
  <div class="text-center mb-6">
    <div class="underline font-bold text-[10pt] mb-2">Weekly Events</div>
    <div class="text-left text-[10pt] leading-tight space-y-3">
      <p><b>Mosaic Kids:</b> We have a Mosaic Kids at 8:30 a.m. on Sunday mornings before service. During this hour, the kids will be given a structured lesson plan from the Gospel Project.</p>
      <p><b>Service Review:</b> On Mondays, following the service, we meet for lunch at 12:00 p.m. to review the entire service, giving godly encouragement and loving feedback</p>
    </div>
  </div>
  <div class="w-full mb-6">
    <table class="w-full border-collapse">
      <thead>
        <tr>
          <th class="text-[8.5pt] font-bold py-1 w-1/4">Weekly Playlist</th>
          <th class="text-[8.5pt] font-bold py-1 w-1/4">Comprehensive Playlist</th>
          <th class="text-[8.5pt] font-bold py-1 w-1/4">Giving</th>
          <th class="text-[8.5pt] font-bold py-1 w-1/4">First Time Guest</th>
        </tr>
      </thead>
    </table>
    <div class="border-t border-black mb-3"></div>
    <div class="grid grid-cols-4 gap-2 text-center">
      <div class="flex justify-center"><img src="assets/standard/WeeklyPlaylistQR.png" class="w-[6em] h-[6em] object-contain" /></div>
      <div class="flex justify-center"><img src="assets/standard/ComprehensivePlaylistQR.png" class="w-[6em] h-[6em] object-contain" /></div>
      <div class="flex justify-center"><img src="assets/standard/GivingQR.png" class="w-[6em] h-[6em] object-contain" /></div>
      <div class="flex justify-center"><img src="assets/standard/FirstTimeGuestQR.png" class="w-[6em] h-[6em] object-contain" /></div>
    </div>
  </div>
  <div class="mt-auto">
    <div class="flex justify-between items-baseline flex-shrink-0"><span class="text-[1.1rem] font-bold">Preaching Schedule</span></div>
    <div class="latex-hr mb-1"></div>
    <preaching-schedule></preaching-schedule>
    <div class="border-t border-black mt-0.5"></div>
  </div>
  <div class="flex-1 flex justify-center items-center py-2">
    <div class="flex items-center gap-6">
      <img src="assets/standard/logo.png" class="w-[3.5em] h-auto flex-shrink-0" />
      <div class="text-[9.5pt] leading-snug text-left">
        <div><b>Meeting Address:</b> 4080 State Hwy 6 Frontage Rd</div>
        <div class="mt-0.5"><b>Website:</b> www.mosaiccstx.org</div>
        <div class="mt-0.5"><b>Info:</b> admin@mosaiccstx.org</div>
      </div>
    </div>
  </div>
</div>`;

    const CUSTOM_HTML = `<div class="h-full prose prose-sm max-w-none font-serif"><input-richtext key="custom_html" label="Custom Page Content"></input-richtext></div>`;

    // role 'normal' unless flagged. emitsPages 'component' marks the page whose
    // count is driven by a multi-page Component (the hymn sheet).
    const PAGE_TEMPLATES = [
        { id: 'seed_title', name: 'Title Page', html: TITLE_HTML, css: '', stylePresetId: 'seed_booklet', emitsPages: 'single', isFiller: false },
        { id: 'seed_oos', name: 'Order of Service', html: OOS_HTML, css: '', stylePresetId: 'seed_booklet', emitsPages: 'single', isFiller: false },
        { id: 'seed_hymn', name: 'Hymn Sheet', html: HYMN_HTML, css: '', stylePresetId: 'seed_booklet', emitsPages: 'component', isFiller: false },
        { id: 'seed_prayer', name: 'Pastoral Prayer', html: PRAYER_HTML, css: '', stylePresetId: 'seed_booklet', emitsPages: 'single', isFiller: false },
        { id: 'seed_notes', name: 'Sermon Notes', html: NOTES_HTML, css: '', stylePresetId: 'seed_booklet', emitsPages: 'single', isFiller: true },
        { id: 'seed_kids', name: 'Mosaic Kids', html: KIDS_HTML, css: '', stylePresetId: 'seed_booklet', emitsPages: 'single', isFiller: false },
        { id: 'seed_announcements', name: 'Announcements', html: ANNOUNCEMENTS_HTML, css: '', stylePresetId: 'seed_booklet', emitsPages: 'single', isFiller: false },
        { id: 'seed_custom', name: 'Custom Page', html: CUSTOM_HTML, css: '', stylePresetId: 'seed_booklet', emitsPages: 'single', isFiller: false },
    ];

    // ── Default Service Guide Template ─────────────────────────────────────────
    // Ordered placements. The single Hymn page template is placed seven times,
    // each bound to a liturgy slot via `params.field`; hymn2 carries
    // omit-on-baptism so it drops when the Service has a baptism (reproducing the
    // old conditional). The Sermon Notes page is the Filler Page.
    const hymn = (field, extra) => ({ pageTemplateId: 'seed_hymn', role: 'normal', params: Object.assign({ field }, extra) });

    const GUIDE_TEMPLATE = {
        id: 'seed_default',
        name: 'Standard 16-Page Booklet',
        targetPageCount: 16,
        isDefault: true,
        pages: [
            { pageTemplateId: 'seed_title', role: 'normal' },
            { pageTemplateId: 'seed_oos', role: 'normal' },
            hymn('preparatoryHymn'),
            hymn('hymn1'),
            hymn('hymn2', { 'omit-on-baptism': true }),
            hymn('hymnMid1'),
            hymn('hymnMid2'),
            { pageTemplateId: 'seed_prayer', role: 'normal' },
            { pageTemplateId: 'seed_notes', role: 'filler' },
            hymn('hymnEnd1'),
            hymn('hymnEnd2'),
            { pageTemplateId: 'seed_kids', role: 'normal' },
            { pageTemplateId: 'seed_announcements', role: 'normal' },
        ],
    };

    // ── builder ────────────────────────────────────────────────────────────────
    // Returns deep copies with each Page Template's Entry Fields derived from its
    // HTML (cached for the picker, ADR-0008 §3.3). Pure; no I/O.
    function buildSeed(catalog) {
        const cat = catalog || (Components && Components.defaultCatalog);
        const pageTemplates = PAGE_TEMPLATES.map(pt => {
            const derived = Engine.deriveEntryFields(pt.html, cat);
            return Object.assign({}, pt, { entryFields: derived.fields });
        });
        return {
            stylePresets: STYLE_PRESETS.map(sp => Object.assign({}, sp)),
            pageTemplates,
            guideTemplate: JSON.parse(JSON.stringify(GUIDE_TEMPLATE)),
        };
    }

    const GuideSeed = {
        STYLE_PRESETS, PAGE_TEMPLATES, GUIDE_TEMPLATE, BOOKLET_CSS,
        buildSeed,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = GuideSeed;
    }
    if (global) {
        global.GuideSeed = GuideSeed;
    }
})(typeof window !== 'undefined' ? window : null);
