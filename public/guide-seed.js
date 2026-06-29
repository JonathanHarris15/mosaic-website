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

    // ── Style Preset: the designed booklet (Claude Design import) ──────────────
    // Brand tokens (color / type / layout) + the page-frame reset + the reusable
    // building-block classes the designed Page Templates and granular Components
    // share. Authors compose pages from these classes, so the page HTML stays
    // legible in the editor instead of being a wall of inline styles.
    const MOSAIC_CSS = `/* ===== Brand tokens (Mosaic Church College Station design system) ===== */
.preview-page{
  --navy-900:#0E1C36; --navy-800:#14264A; --navy:#182F57; --navy-700:#25426E;
  --ocean:#3E6181; --steel:#5D94A9; --sky:#8FB9CE; --sky-200:#C4DBE8;
  --sand:#C2B79D; --gold:#B89B6A; --gold-bright:#D0B080;
  --cream:#F2EAE2; --cream-200:#E8DDCD; --parchment:#FBF7F0; --white:#FFFFFF; --ink:#0E1C36;
  --text:#182F57; --text-strong:#0E1C36; --text-muted:#5E6B82; --text-soft:#8A93A6; --text-gold:#B89B6A;
  --border:#DAD0C0; --border-strong:#C2B79D; --divider:#E8DDCD;
  --font-display:'Cinzel','Trajan Pro','Times New Roman',serif;
  --font-serif:'EB Garamond','Adobe Caslon Pro',Georgia,serif;
  --font-sans:'Libre Franklin',-apple-system,'Segoe UI',sans-serif;
  --font-black:'UnifrakturCook','Old English Text MT',serif;
}

/* ===== Page-frame reset ===== the .preview-page IS the 5.5x8.5 sheet, so the
   designed pages own their own margins. Override the legacy 0.2in pad + Times
   default on both screen and the booklet print layer (higher specificity). */
.preview-page,
.booklet-print-layer .preview-page{
  padding:0 !important; background:var(--white); color:var(--navy);
  font-family:var(--font-serif); font-size:13px; line-height:1.5;
}
.preview-page h1,.preview-page h2,.preview-page h3{ font-family:var(--font-display); font-weight:600; margin:0; }

/* ===== Sheet + shared chrome ===== */
.m-sheet{ position:relative; box-sizing:border-box; width:100%; height:100%; display:flex; flex-direction:column; overflow:hidden; }
.m-head{ display:flex; justify-content:space-between; align-items:center; }
.m-head-brand,.m-head-label{ font-family:var(--font-sans); font-size:9px; letter-spacing:.22em; text-transform:uppercase; color:var(--text-soft); font-weight:600; }
.m-head-brand{ font-family:var(--font-serif); }
.m-rule{ height:1px; background:var(--border); }
.m-rule-strong{ height:1px; background:var(--border-strong); }
.m-kicker{ font-family:var(--font-sans); font-size:10px; letter-spacing:.3em; text-transform:uppercase; color:var(--gold); font-weight:600; }
.m-kicker-sm{ font-family:var(--font-sans); font-size:9.5px; letter-spacing:.24em; text-transform:uppercase; color:var(--gold); font-weight:600; }
.m-eyebrow{ font-family:var(--font-sans); font-size:9px; letter-spacing:.18em; text-transform:uppercase; color:var(--text-muted); font-weight:600; }
.m-body{ font-size:12px; line-height:1.55; color:var(--text); }
.m-quote{ font-family:var(--font-serif); font-style:italic; color:var(--text-muted); }
/* ✦ four-pointed-star divider */
.m-star{ display:flex; align-items:center; justify-content:center; gap:12px; }   /* caller sets width */
.m-star::before,.m-star::after{ content:""; flex:1; height:1px; background:var(--border-strong); }
.m-star > span{ color:var(--sand); line-height:0; display:flex; }
/* Mosaic hexagon ornament (replaces the old ✦); a mask so it takes currentColor. */
.m-hex{ display:inline-block; width:8px; height:9px; background:currentColor; -webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 17.32 20'%3E%3Cpolygon points='8.66,0 17.32,5 17.32,15 8.66,20 0,15 0,5'/%3E%3C/svg%3E") no-repeat center/contain; mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 17.32 20'%3E%3Cpolygon points='8.66,0 17.32,5 17.32,15 8.66,20 0,15 0,5'/%3E%3C/svg%3E") no-repeat center/contain; }

/* ===== Order of Service ===== static labels (left) + granular value tags (right) ===== */
.m-oos-title{ font-family:var(--font-display); font-size:22px; font-weight:600; letter-spacing:.03em; color:var(--navy); }
.m-oos-verse{ font-family:var(--font-serif); font-style:italic; font-size:12px; line-height:1.4; color:var(--text-muted); padding-left:11px; border-left:2px solid var(--sand); }
.m-oos-list{ display:flex; flex-direction:column; flex:1; min-height:0; justify-content:space-between; }
.oos-row{ display:flex; align-items:baseline; justify-content:space-between; gap:11px; padding:2.75px 0; }
.oos-label{ font-size:13.5px; font-weight:600; color:var(--navy); white-space:nowrap; }
.oos-bold{ padding:2.75px 0; font-size:13.5px; font-weight:600; color:var(--navy); }      /* label-only row */
.oos-val{ font-style:italic; font-size:12.5px; color:var(--text-muted); text-align:right; }   /* hymn name */
.oos-val-plain{ font-size:12.5px; color:var(--text-muted); text-align:right; }                /* scripture ref */
.m-oos-roles{ display:grid; grid-template-columns:1fr 1fr 1fr; font-family:var(--font-serif); font-size:9px; font-weight:500; color:var(--sand); }
.m-oos-names{ display:grid; grid-template-columns:1fr 1fr 1fr; font-family:var(--font-sans); font-size:7px; letter-spacing:.12em; text-transform:uppercase; color:var(--text-muted); font-weight:600; }
.m-oos-roles > :nth-child(2),.m-oos-names > :nth-child(2){ text-align:center; }
.m-oos-roles > :nth-child(3),.m-oos-names > :nth-child(3){ text-align:right; }
.m-oos-close{ font-family:var(--font-serif); font-style:italic; font-size:10.5px; color:var(--text-soft); text-align:center; }

/* ===== Cover ===== */
.m-cover{ text-align:center; }
.m-cover-frame-1{ position:absolute; inset:18px; border:1px solid var(--border-strong); }
.m-cover-frame-2{ position:absolute; inset:23px; border:1px solid rgba(194,183,157,.4); }
.m-cover-overline{ font-family:'PT Serif', var(--font-sans); font-size:12px; letter-spacing:.34em; text-transform:uppercase; color:var(--text-muted); font-weight:700; }
.m-cover-title{ font-family:'PT Serif', var(--font-display); font-size:36px; font-weight:700; letter-spacing:.04em; line-height:1.08; color:var(--navy); white-space:nowrap; }
.m-cover-verse{ font-family:var(--font-serif); font-style:italic; font-size:15.5px; line-height:1.66; color:var(--text); max-width:362px; margin:0 auto; }
.m-cover-ref{ font-family:var(--font-sans); font-size:11px; letter-spacing:.28em; text-transform:uppercase; color:var(--gold); font-weight:600; }
.m-cover-when{ font-family:var(--font-sans); font-size:11px; letter-spacing:.24em; text-transform:uppercase; color:var(--navy); font-weight:600; }

/* ===== Explainer ===== */
.m-explain-item{ break-inside:avoid; margin-bottom:11px; }
.m-explain-head{ display:flex; align-items:baseline; gap:7px; }
.m-explain-num{ font-family:var(--font-display); font-size:13px; color:var(--gold); font-weight:600; }
.m-explain-name{ font-size:12px; font-weight:600; color:var(--navy); }
.m-explain-body{ margin:3px 0 0; font-size:11px; line-height:1.42; color:var(--text); }

/* ===== Hymn ===== */
.m-hymn-title{ font-family:var(--font-display); font-weight:600; font-size:15px; line-height:1.14; letter-spacing:.01em; color:var(--navy); }
.m-hymn-stage{ flex:1; display:flex; align-items:flex-start; justify-content:center; padding:14px 0 0; min-height:0; }
.m-hymn-img{ max-width:100%; max-height:100%; object-fit:contain; }
.m-hymn-missing{ width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; border:2px dashed var(--border); border-radius:6px; color:var(--text-soft); font-family:var(--font-sans); font-size:11px; text-align:center; gap:6px; }
.m-hymn-credit{ font-family:var(--font-sans); font-size:9px; line-height:1.5; letter-spacing:.04em; color:var(--text-soft); text-align:center; }

/* ===== Pastoral Prayer ===== */
.m-card{ background:var(--white); border:1px solid var(--border-strong); padding:14px 16px; color:var(--navy); }
.m-card-head{ display:flex; justify-content:space-between; align-items:baseline; border-bottom:1px solid var(--border); padding-bottom:9px; margin-bottom:12px; }
.m-card-title{ font-family:var(--font-display); font-size:19px; letter-spacing:.04em; color:var(--navy); }
.m-stats{ display:grid; grid-template-columns:1fr 1fr; gap:8px 16px; font-family:var(--font-sans); }
.m-stat{ display:flex; justify-content:space-between; font-size:10.5px; }
.m-stat > span:first-child{ color:var(--text-muted); }
.m-stat > span:last-child{ color:var(--navy); font-weight:600; }

/* ===== Mosaic Kids / Sermon Notes ===== */
.m-prompt{ margin:7px 0 0; font-size:11px; line-height:1.5; font-style:italic; color:var(--text-soft); }
.m-q{ display:flex; gap:10px; align-items:flex-start; margin-top:9px; }
.m-q > span{ color:var(--sand); font-family:var(--font-display); font-size:14px; line-height:1.4; }
.m-q > p{ margin:0; font-size:13px; line-height:1.55; color:var(--text); }
/* ✦-bulleted list (Mosaic Kids review questions) — input-list render-as=bullets + class */
/* Override the editor's global ".preview-page ul { list-style: disc !important }"
   so the hexagon ::before is the ONLY marker (needs the !important + specificity). */
.preview-page ul.m-qlist, ul.m-qlist{ list-style:none !important; padding:0 !important; margin:0; }
.m-qlist li{ position:relative; padding-left:22px; font-size:13px; line-height:1.55; color:var(--text); margin-top:9px; }
.m-qlist li::before{ content:""; position:absolute; left:2px; top:.42em; width:8px; height:9px; background:var(--sand); -webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 17.32 20'%3E%3Cpolygon points='8.66,0 17.32,5 17.32,15 8.66,20 0,15 0,5'/%3E%3C/svg%3E") no-repeat center/contain; mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 17.32 20'%3E%3Cpolygon points='8.66,0 17.32,5 17.32,15 8.66,20 0,15 0,5'/%3E%3C/svg%3E") no-repeat center/contain; }
.m-blank{ border-bottom:1px solid var(--border); }   /* handwriting space */

/* ===== Back cover: announcements + schedule ===== */
.m-sched{ display:flex; flex-direction:column; margin-top:9px; }
.m-sched-row{ display:grid; grid-template-columns:88px 1fr 92px; padding:6px 0; border-bottom:1px solid var(--cream-200); font-size:12px; align-items:baseline; }
.m-sched-head{ border-top:1px solid var(--border); font-family:var(--font-sans); font-size:8.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--text-muted); font-weight:600; }
.m-sched-date{ color:var(--text-muted); }
.m-sched-row .m-sched-preacher{ text-align:center; color:var(--navy); }
.m-sched-row .m-sched-text{ text-align:right; font-style:italic; color:var(--text-muted); }
.m-sched-head .m-sched-preacher{ text-align:center; }
.m-sched-head .m-sched-text{ text-align:right; font-style:normal; }
.m-foot-rule{ display:flex; justify-content:space-between; font-family:var(--font-serif); font-size:9px; font-weight:500; color:var(--sand); }
.m-foot-meta{ display:flex; justify-content:space-between; font-family:var(--font-sans); font-size:7px; letter-spacing:.12em; text-transform:uppercase; color:var(--text-muted); font-weight:600; }`;

    const STYLE_PRESETS = [
        { id: 'seed_booklet', name: 'Mosaic Booklet', css: BOOKLET_CSS },
        { id: 'seed_mosaic_print', name: 'Mosaic Print', css: MOSAIC_CSS },
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

    // ── Designed booklet pages (Claude Design import) ──────────────────────────
    // Each is the inner content of a 5.5x8.5 sheet, composed from the Mosaic Print
    // Style Preset classes + granular Components. Authored exactly as a church
    // editor would: static structure + dropped-in value tags. Brand art is in
    // public/assets (mosaic-logo = full seal, mosaic-icon = stained-glass disc);
    // weekly art (hymn sheet, country map) flows through Components/Entry Fields.

    const M_COVER_HTML = `<div class="m-sheet m-cover">
  <div class="m-cover-frame-1"></div>
  <div class="m-cover-frame-2"></div>
  <div style="position:relative; height:100%; box-sizing:border-box; padding:60px 56px 48px; display:flex; flex-direction:column; align-items:center;">
    <img src="assets/mosaic-icon.png" alt="Mosaic Church seal" style="width:328px; height:340px; object-fit:contain; margin:50px 0 -40px;" />
    <div style="height:72px;"></div>
    <div class="m-cover-overline">College Station</div>
    <div class="m-cover-title" style="margin-top:14px;">MOSAIC CHURCH</div>
    <div class="m-star" style="width:160px; margin:22px auto;"><span class="m-hex"></span></div>
    <div class="m-cover-verse">&#8220;<key-verse-text></key-verse-text>&#8221;</div>
    <div class="m-cover-ref" style="margin-top:14px;"><key-verse-ref></key-verse-ref></div>
    <div style="flex:1;"></div>
    <div class="m-cover-when"><service-date format="long"></service-date></div>
    <div style="font-family:var(--font-sans); font-size:10px; letter-spacing:.2em; text-transform:uppercase; color:var(--text-muted); font-weight:500; margin-top:7px;">10:00 AM</div>
  </div>
</div>`;

    const M_OOS_HTML = `<div class="m-sheet" style="padding:26px 44px 16px;">
  <div class="m-head"><span class="m-head-brand">Mosaic Church</span><span class="m-head-label"><service-date format="long"></service-date></span></div>
  <div class="m-rule-strong" style="margin:12px 0 16px;"></div>
  <div class="m-kicker">Order of Service</div>
  <div class="m-oos-title" style="margin-top:5px;"><service-theme></service-theme></div>
  <div class="m-oos-verse" style="margin:7px 0 10px;">&#8220;<key-verse-text></key-verse-text>&#8221; &#8212; <key-verse-ref></key-verse-ref></div>
  <div class="m-rule" style="margin:7px 0 4px;"></div>
  <div class="m-oos-list">
    <div class="oos-row"><span class="oos-label">Preparatory Hymn</span><span class="oos-val"><hymn-preparatory></hymn-preparatory></span></div>
    <div class="oos-bold">Welcome</div>
    <div class="oos-bold">Moment of Silent Preparation</div>
    <div class="oos-row"><span class="oos-label">Scriptural Call to Worship</span><span class="oos-val-plain"><ref-call-to-worship></ref-call-to-worship></span></div>
    <div class="oos-row"><span class="oos-label">Hymn</span><span class="oos-val"><hymn-1></hymn-1></span></div>
    <div class="oos-row"><span class="oos-label">Hymn</span><span class="oos-val"><hymn-2></hymn-2></span></div>
    <div class="oos-bold">Prayer of Praise</div>
    <div class="oos-row"><span class="oos-label">Call to Confession</span><span class="oos-val-plain"><ref-call-to-confession></ref-call-to-confession></span></div>
    <div class="oos-bold">Prayer of Confession</div>
    <div class="oos-row"><span class="oos-label">Assurance of Pardon</span><span class="oos-val-plain"><ref-assurance></ref-assurance></span></div>
    <div class="oos-row"><span class="oos-label">Hymn</span><span class="oos-val"><hymn-mid-1></hymn-mid-1></span></div>
    <div class="oos-row"><span class="oos-label">Hymn</span><span class="oos-val"><hymn-mid-2></hymn-mid-2></span></div>
    <div class="oos-row"><span class="oos-label">Scripture Reading</span><span class="oos-val-plain"><ref-scripture-reading></ref-scripture-reading></span></div>
    <div class="oos-bold">Pastoral Prayer</div>
    <div class="oos-row"><span class="oos-label" style="font-weight:700;">Sermon</span><span class="oos-val-plain"><ref-sermon></ref-sermon></span></div>
    <div class="oos-row"><span class="oos-label">Hymn</span><span class="oos-val"><hymn-end-1></hymn-end-1></span></div>
    <div class="oos-row"><span class="oos-label">Hymn</span><span class="oos-val"><hymn-end-2></hymn-end-2></span></div>
    <div class="oos-bold">The Lord&#8217;s Supper</div>
    <div class="oos-bold">Moment of Silent Reflection</div>
    <div class="oos-row"><span class="oos-label">Benediction</span><span class="oos-val-plain"><ref-benediction></ref-benediction></span></div>
  </div>
  <div style="margin-top:8px;">
    <div class="m-oos-roles"><span>Service Leader</span><span>Music</span><span>Preacher</span></div>
    <div class="m-rule-strong" style="margin:6px 0 5px;"></div>
    <div class="m-oos-names"><span><service-leader-name></service-leader-name></span><span><music-leader-name></music-leader-name></span><span><preacher-name></preacher-name></span></div>
    <div class="m-oos-close" style="margin-top:7px;">Our service typically concludes at approximately 12:00 p.m.</div>
  </div>
</div>`;

    const M_EXPLAINER_HTML = `<div class="m-sheet" style="padding:34px 40px 26px;">
  <div style="position:absolute; inset:16px; border:1px solid var(--border-strong);"></div>
  <div style="position:relative; text-align:center;">
    <div style="font-family:var(--font-display); font-size:24px; font-weight:600; letter-spacing:.03em; color:var(--navy);">Welcome to Mosaic Church</div>
    <div class="m-quote" style="font-size:12px; margin-top:5px;">A guide to the elements of our worship service</div>
    <div class="m-star" style="width:140px; margin:12px auto 4px;"><span class="m-hex"></span></div>
  </div>
  <div style="position:relative; margin-top:8px;">
    <div class="m-explain-item"><div class="m-explain-head"><span class="m-explain-num">I</span><span class="m-explain-name">Service Theme</span></div><p class="m-explain-body">Our entire service is structured around a central theme drawn from the sermon text, highlighting an attribute or title of God we want to emphasize. The songs we sing, the Scriptures we read, and the prayers we pray are all chosen to reflect this truth, helping us behold His glory and respond in worship.</p></div>
    <div class="m-explain-item"><div class="m-explain-head"><span class="m-explain-num">II</span><span class="m-explain-name">Preparatory Hymn</span></div><p class="m-explain-body">This hymn is our invitation into worship, helping us turn from the distractions of the week and prepare our hearts to meet with God. You are welcome to sing along or simply listen as we reflect on who God is and ready ourselves to worship Him together.</p></div>
    <div class="m-explain-item"><div class="m-explain-head"><span class="m-explain-num">III</span><span class="m-explain-name">Congregational Singing</span></div><p class="m-explain-body">We as a church practice congregational singing. Colossians 3:16 says &#8220;Let the word of Christ dwell in you richly, teaching and admonishing one another in all wisdom, singing psalms and hymns and spiritual song, with thankfulness in your hearts to God.&#8221; This means that Singing is not just a means by which we worship God, but it is also a teaching ministry of the church. Therefore we sing not just to God, but to each other, in order to teach and admonish one another in the faith.</p></div>
    <div class="m-explain-item"><div class="m-explain-head"><span class="m-explain-num">IV</span><span class="m-explain-name">Call to Worship</span></div><p class="m-explain-body">The Call to Worship is the Scripture through which God Himself calls us to worship Him. It marks the true beginning of our service, displaying His glory in light of our theme and reminding us that we come not on our own initiative, but at His gracious invitation.</p></div>
    <div class="m-explain-item"><div class="m-explain-head"><span class="m-explain-num">V</span><span class="m-explain-name">Call to Confession</span></div><p class="m-explain-body">The Call to Confession follows naturally from the Call to Worship. Having seen who God is, we must now see who we are. This Scripture displays our sin against the backdrop of God&#8217;s glory so that we might confess it genuinely to Him in prayer.</p></div>
    <div class="m-explain-item"><div class="m-explain-head"><span class="m-explain-num">VI</span><span class="m-explain-name">Assurance of Pardon</span></div><p class="m-explain-body">Having seen our sin clearly, we need to be reminded of the gospel. The Scriptural Assurance of Pardon is the word of God that speaks peace to the confessing heart, assuring us that the saving work of Christ is sufficient and that those in Him stand fully pardoned.</p></div>
    <div class="m-explain-item"><div class="m-explain-head"><span class="m-explain-num">VII</span><span class="m-explain-name">Reading &amp; Prayer</span></div><p class="m-explain-body">The Scripture Reading places God&#8217;s promises before us so that we might pray them back to Him. We ask that He would bring these promises to bear in our church and others worldwide, praying for two of our members, another church, and a country that needs the gospel.</p></div>
    <div class="m-explain-item" style="margin-bottom:0;"><div class="m-explain-head"><span class="m-explain-num">VIII</span><span class="m-explain-name">Benediction</span></div><p class="m-explain-body">The Benediction is the blessing of God declared over His church as we depart. It reminds us of the rich truths we have learned and assures us that we are equipped and blessed to do the work of ministry for His kingdom and glory.</p></div>
  </div>
</div>`;

    // The header repeats on every page of the hymn; <mosaic-hymn-sheet> drives the
    // page count and emits the title (first page only), image, and credit (last
    // page only). emitsPages:'component' (set on the Page Template below).
    const M_HYMN_HTML = `<div class="m-sheet" style="padding:42px 46px 30px;">
  <div class="m-head"><span class="m-head-brand">Mosaic Church</span><span class="m-head-label">Hymn</span></div>
  <div class="m-rule-strong" style="margin:12px 0 16px;"></div>
  <mosaic-hymn-sheet></mosaic-hymn-sheet>
</div>`;

    const M_PRAYER_HTML = `<div class="m-sheet" style="padding:42px 46px 30px;">
  <div class="m-head"><span class="m-head-brand">Mosaic Church</span><span class="m-head-label"><pastoral-prayer-label></pastoral-prayer-label></span></div>
  <div class="m-rule-strong" style="margin:12px 0 16px;"></div>
  <pastoral-prayer-subjects></pastoral-prayer-subjects>
  <div style="margin-top:2px;">
    <div class="m-eyebrow">Members</div>
    <div style="height:104px;"></div>
    <div class="m-eyebrow" style="margin-top:6px;">Church</div>
    <div style="height:104px;"></div>
  </div>
  <div class="m-card" style="margin-top:18px;">
    <div class="m-card-head"><span class="m-card-title"><input-text key="pp_nation" label="Nation" required></input-text></span><span class="m-kicker-sm"><input-text key="pp_continent" label="Continent/Region"></input-text></span></div>
    <div style="display:flex; gap:16px; align-items:center;">
      <div style="flex:0 0 148px; width:148px; aspect-ratio:1; display:flex; align-items:center; justify-content:center; overflow:hidden;"><input-image key="pp_country_image" label="Country Map Image" placeholder="No Country Map"></input-image></div>
      <div class="m-stats">
        <div class="m-stat"><span>Capital</span><span><input-text key="pp_capital" label="Capital" required></input-text></span></div>
        <div class="m-stat"><span>Population</span><span><input-text key="pp_population" label="Population"></input-text></span></div>
        <div class="m-stat"><span>Language</span><span><input-text key="pp_language" label="Official Language"></input-text></span></div>
        <div class="m-stat"><span>Literacy</span><span><input-text key="pp_literacy" label="Literacy Rate"></input-text></span></div>
        <div class="m-stat"><span>Christian</span><span><input-text key="pp_christian" label="Christian"></input-text></span></div>
        <div class="m-stat"><span>Evangelical</span><span><input-text key="pp_evangelical" label="Evangelical"></input-text></span></div>
        <div class="m-stat"><span>Unevangelized</span><span><input-text key="pp_unevangelized" label="Un-evangelized"></input-text></span></div>
        <div class="m-stat"><span>Languages</span><span><input-text key="pp_total_languages" label="Total Languages"></input-text></span></div>
      </div>
    </div>
  </div>
  <div style="margin-top:16px; flex:1;">
    <div class="m-kicker-sm">Prayer Prompts</div>
    <div class="m-body" style="margin-top:8px;"><input-richtext key="pp_prompts" label="Prayer Prompts"></input-richtext></div>
  </div>
</div>`;

    const M_NOTES_HTML = `<div class="m-sheet" style="padding:42px 46px 30px;">
  <div class="m-head"><span class="m-head-brand">Mosaic Church</span><span class="m-head-label">Sermon Notes</span></div>
  <div class="m-rule-strong" style="margin:12px 0 5px;"></div>
  <div class="m-kicker"><ref-sermon></ref-sermon></div>
  <div class="m-rule-strong" style="margin:16px 0 8px;"></div>
  <div style="font-family:var(--font-sans); font-size:8px; letter-spacing:.18em; text-transform:uppercase; color:var(--text-soft); font-weight:600;">Main Idea of the Sermon:</div>
  <div style="height:200px;"></div>
  <div class="m-rule-strong"></div>
  <div style="flex:1;"></div>
</div>`;

    // The Filler/continuation Sermon Notes page: blank writing space only. No
    // "Main Idea of the Sermon" heading and no sermon reference — those belong on
    // the first (non-filler) notes page so they appear exactly once.
    const M_NOTES_BLANK_HTML = `<div class="m-sheet" style="padding:42px 46px 30px;">
  <div class="m-head"><span class="m-head-brand">Mosaic Church</span><span class="m-head-label">Sermon Notes</span></div>
  <div class="m-rule-strong" style="margin:12px 0 16px;"></div>
  <div style="flex:1;"></div>
</div>`;

    const M_KIDS_HTML = `<div class="m-sheet" style="padding:42px 46px;">
  <div class="m-head"><span class="m-head-brand">Mosaic Church</span><span class="m-head-label">For the Rest of the Week</span></div>
  <div class="m-rule-strong" style="margin:12px 0 16px;"></div>
  <div style="flex:1; min-height:0;">
    <div class="m-kicker">Takeaway from Service</div>
    <p class="m-prompt">A thought, verse, or conviction from today&#8217;s worship service to carry into the week.</p>
  </div>
  <div class="m-rule-strong" style="margin:16px 0;"></div>
  <div class="m-kicker">Parent Discussion</div>
  <p class="m-body" style="color:var(--text-muted); margin-top:8px;">For parents whose children attended Mosaic Kids, this is a summary of today&#8217;s lesson, with questions to keep the conversation going throughout the week.</p>
  <div class="m-rule" style="margin:16px 0;"></div>
  <div style="display:flex; align-items:baseline; justify-content:space-between;">
    <span style="font-family:var(--font-display); font-size:21px; font-weight:600; letter-spacing:.03em; color:var(--navy);"><input-text key="kids_lesson_title" label="Lesson Title" required></input-text></span>
    <span class="m-eyebrow" style="color:var(--gold); letter-spacing:.18em;"><input-text key="kids_lesson_verse" label="Passage Reference" required></input-text></span>
  </div>
  <div class="m-quote" style="font-size:10.5px; color:var(--text-soft);">From the Gospel Project &#183; Mosaic Kids</div>
  <div style="margin-top:14px;">
    <div class="m-eyebrow" style="letter-spacing:.2em;">Bible Story Summary</div>
    <div class="m-body" style="margin-top:7px;"><input-richtext key="kids_summary" label="Bible Story Summary"></input-richtext></div>
  </div>
  <div style="margin-top:16px;">
    <div class="m-eyebrow" style="letter-spacing:.2em;">Review Questions</div>
    <input-list key="kids_questions" label="Review Questions" render-as="bullets" class="m-qlist"></input-list>
  </div>
</div>`;

    const M_BACKCOVER_HTML = `<div class="m-sheet">
  <div style="padding:42px 46px 0; flex:1; display:flex; flex-direction:column;">
    <div style="display:flex; align-items:center; justify-content:space-between;">
      <img src="assets/mosaic-icon.png" alt="Mosaic Church" style="width:44px; height:44px; object-fit:contain;" />
      <span class="m-head-label"><service-date format="long"></service-date></span>
    </div>
    <div class="m-rule-strong" style="margin:14px 0 16px;"></div>
    <!-- Announcements take all extra vertical space; the blocks below sit at the bottom. -->
    <div style="flex:1; min-height:0;">
      <div class="m-kicker-sm">Announcements</div>
      <div class="m-body" style="margin-top:7px;"><input-list key="announcements" label="Weekly Announcements" render-as="announcements" required></input-list></div>
    </div>
    <div class="m-kicker-sm" style="margin-top:16px;">Weekly Events</div>
    <p class="m-body" style="margin-top:7px;"><span style="font-weight:600; color:var(--navy);">Mosaic Kids</span> &#8212; 8:30 a.m. Sundays before service; a structured lesson from the Gospel Project.</p>
    <p class="m-body" style="margin-top:6px;"><span style="font-weight:600; color:var(--navy);">Service Review</span> &#8212; Mondays at 12:00 p.m. over lunch, for godly encouragement and loving feedback.</p>
    <div style="margin-top:18px;">
      <div class="m-kicker-sm">Preaching Schedule</div>
      <mosaic-schedule></mosaic-schedule>
    </div>
    <div style="margin-top:20px; display:flex; align-items:center; gap:18px;">
      <img src="assets/mosaic-linktree-qr.png" alt="Connect &amp; Give QR" style="width:50px; height:50px; object-fit:contain; flex:none;" />
      <div>
        <div class="m-kicker-sm">Connect &amp; Give</div>
        <p class="m-body" style="margin-top:7px; max-width:300px;">Scan to access our linktree: give online, listen to past sermons, and find our hymn playlist.</p>
      </div>
    </div>
  </div>
  <div style="padding:10px 46px 32px;">
    <div class="m-foot-rule"><span style="text-align:left;">Address</span><span style="text-align:right;">Website</span></div>
    <div class="m-rule-strong" style="margin:6px 0 5px;"></div>
    <div class="m-foot-meta"><span style="text-align:left;">4080 State Hwy 6 Frontage Rd</span><span style="text-align:right;">www.mosaiccstx.org</span></div>
  </div>
</div>`;

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
        // Designed booklet pages (Claude Design import) — all on the Mosaic Print
        // preset. The Hymn page is emitsPages:'single' in v1 (one sheet image per
        // slot); multi-image pagination is deferred to a later pass.
        { id: 'seed_m_cover', name: 'Cover (Mosaic)', html: M_COVER_HTML, css: '', stylePresetId: 'seed_mosaic_print', emitsPages: 'single', isFiller: false },
        { id: 'seed_m_explainer', name: 'Our Order of Service (Mosaic)', html: M_EXPLAINER_HTML, css: '', stylePresetId: 'seed_mosaic_print', emitsPages: 'single', isFiller: false },
        { id: 'seed_m_oos', name: 'Order of Service (Mosaic)', html: M_OOS_HTML, css: '', stylePresetId: 'seed_mosaic_print', emitsPages: 'single', isFiller: false },
        { id: 'seed_m_hymn', name: 'Hymn (Mosaic)', html: M_HYMN_HTML, css: '', stylePresetId: 'seed_mosaic_print', emitsPages: 'component', isFiller: false },
        { id: 'seed_m_prayer', name: 'Pastoral Prayer (Mosaic)', html: M_PRAYER_HTML, css: '', stylePresetId: 'seed_mosaic_print', emitsPages: 'single', isFiller: false },
        { id: 'seed_m_notes', name: 'Sermon Notes (Mosaic)', html: M_NOTES_HTML, css: '', stylePresetId: 'seed_mosaic_print', emitsPages: 'single', isFiller: false },
        { id: 'seed_m_notes_blank', name: 'Sermon Notes — Continuation (Mosaic)', html: M_NOTES_BLANK_HTML, css: '', stylePresetId: 'seed_mosaic_print', emitsPages: 'single', isFiller: true },
        { id: 'seed_m_kids', name: 'For the Rest of the Week (Mosaic)', html: M_KIDS_HTML, css: '', stylePresetId: 'seed_mosaic_print', emitsPages: 'single', isFiller: false },
        { id: 'seed_m_backcover', name: 'Back Cover (Mosaic)', html: M_BACKCOVER_HTML, css: '', stylePresetId: 'seed_mosaic_print', emitsPages: 'single', isFiller: false },
    ];

    // ── Default Service Guide Template ─────────────────────────────────────────
    // Ordered placements. The single Hymn page template is placed seven times,
    // each bound to a liturgy slot via `params.field`; hymn2 carries
    // omit-on-baptism so it drops when the Service has a baptism (reproducing the
    // old conditional). The Sermon Notes page is the Filler Page.
    const hymn = (field, extra) => ({ pageTemplateId: 'seed_hymn', role: 'normal', params: Object.assign({ field }, extra) });

    // The legacy booklet — KEPT (ADR-0008 / user request "keep legacy for
    // novelty") but no longer the church default; the designed booklet below is.
    const GUIDE_TEMPLATE = {
        id: 'seed_default',
        name: 'Standard 16-Page Booklet (Legacy)',
        targetPageCount: 16,
        isDefault: false,
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

    // ── The designed booklet (Claude Design import) — the new church default ────
    // Same liturgy data as the legacy booklet, rebuilt on the Mosaic Print pages.
    // The Order of Service page is composed from granular value Components, so a
    // church editor could author it by hand (the point of the redesign). Hymn
    // pages are placed per slot via params.field; v1 emits one sheet image each.
    const mhymn = (field, extra) => ({ pageTemplateId: 'seed_m_hymn', role: 'normal', params: Object.assign({ field }, extra) });

    const GUIDE_TEMPLATE_MOSAIC = {
        id: 'seed_mosaic',
        name: 'Mosaic Booklet (Designed)',
        targetPageCount: 16,
        // Cover + Explainer are front matter; numbering begins on page 3 (the OOS).
        numberStartPage: 3,
        isDefault: true,
        pages: [
            { pageTemplateId: 'seed_m_cover', role: 'normal' },
            { pageTemplateId: 'seed_m_explainer', role: 'normal' },
            { pageTemplateId: 'seed_m_oos', role: 'normal' },
            mhymn('preparatoryHymn'),
            mhymn('hymn1'),
            mhymn('hymn2'),
            mhymn('hymnMid1'),
            mhymn('hymnMid2'),
            { pageTemplateId: 'seed_m_prayer', role: 'normal' },
            // First notes page is a normal page (always present, carries "Main Idea
            // of the Sermon" + the sermon reference); the blank continuation page is
            // the Filler that expands to fill the booklet.
            { pageTemplateId: 'seed_m_notes', role: 'normal' },
            { pageTemplateId: 'seed_m_notes_blank', role: 'filler' },
            mhymn('hymnEnd1'),
            mhymn('hymnEnd2'),
            { pageTemplateId: 'seed_m_kids', role: 'normal' },
            { pageTemplateId: 'seed_m_backcover', role: 'normal' },
        ],
    };

    // Both seeded templates, default first by the isDefault flag.
    const GUIDE_TEMPLATES = [GUIDE_TEMPLATE, GUIDE_TEMPLATE_MOSAIC];

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
            // `guideTemplate` (singular) stays the legacy seed_default for
            // back-compat with existing callers/tests; `guideTemplates` (plural)
            // is the full set seeded into a church, default chosen by isDefault.
            guideTemplate: JSON.parse(JSON.stringify(GUIDE_TEMPLATE)),
            guideTemplates: JSON.parse(JSON.stringify(GUIDE_TEMPLATES)),
        };
    }

    const GuideSeed = {
        STYLE_PRESETS, PAGE_TEMPLATES, GUIDE_TEMPLATE, GUIDE_TEMPLATE_MOSAIC, GUIDE_TEMPLATES, BOOKLET_CSS, MOSAIC_CSS,
        buildSeed,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = GuideSeed;
    }
    if (global) {
        global.GuideSeed = GuideSeed;
    }
})(typeof window !== 'undefined' ? window : null);
