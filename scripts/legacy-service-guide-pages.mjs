/**
 * Build the HTML/CSS for a Legacy Service Guide Printable.
 *
 * Pixel layout matches the old half-letter booklet (service-guide.html /
 * test/fixtures/service-guide-golden.html). Wires use only what the printable
 * editor offers: sunday / sunday_hymns / sunday_announcements / sundays /
 * sunday_prayer_requests / event_field / event_list. A page number is an
 * element on the page, not a data source.
 *
 * Hymn sheets are one sunday_hymns list split with from/to around pastoral
 * prayer and sermon notes (MS-743). The range counts hymns, not sheets
 * (MS-772): a multi-page hymn stays inside the range that holds its index.
 *
 * Run: node scripts/legacy-service-guide-pages.mjs
 * Prints JSON { inputs, pages } to stdout after validating with PrintableCore.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const Core = require('../public/printable-core.js');

const MARGIN = { top: 30, right: 30, bottom: 30, left: 30 }; // 0.2in @ 150dpi

const LEGACY_CSS = `
.legacy-root {
  font-family: 'Times New Roman', Times, serif;
  font-size: 10pt;
  line-height: 1.2;
  color: #000;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}
.h-full { height: 100%; }
.w-full { width: 100%; }
.flex { display: flex; }
.flex-col { flex-direction: column; }
.flex-grow, .flex-1 { flex: 1 1 0%; min-height: 0; }
.flex-shrink-0 { flex-shrink: 0; }
.items-center { align-items: center; }
.items-baseline { align-items: baseline; }
.justify-between { justify-content: space-between; }
.justify-start { justify-content: flex-start; }
.justify-center { justify-content: center; }
.text-center { text-align: center; }
.text-left { text-align: left; }
.text-right { text-align: right; }
.font-bold { font-weight: 700; }
.italic { font-style: italic; }
.underline { text-decoration: underline; }
.relative { position: relative; }
.absolute { position: absolute; }
.overflow-hidden { overflow: hidden; }
.object-contain { object-fit: contain; }
.grid { display: grid; }
.grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.grid-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.gap-2 { gap: 0.5rem; }
.gap-6 { gap: 1.5rem; }
.pt-\\[1in\\] { padding-top: 1in; }
.mt-\\[0\\.2in\\] { margin-top: 0.2in; }
.mb-\\[0\\.8in\\] { margin-bottom: 0.8in; }
.mb-1 { margin-bottom: 0.25rem; }
.mb-2 { margin-bottom: 0.5rem; }
.mb-3 { margin-bottom: 0.75rem; }
.mb-4 { margin-bottom: 1rem; }
.mb-6 { margin-bottom: 1.5rem; }
.mt-2 { margin-top: 0.5rem; }
.mt-4 { margin-top: 1rem; }
.mt-8 { margin-top: 2rem; }
.mt-auto { margin-top: auto; }
.pb-1 { padding-bottom: 0.25rem; }
.pb-8 { padding-bottom: 2rem; }
.pl-6 { padding-left: 1.5rem; }
.pl-8 { padding-left: 2rem; }
.py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
.px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
.space-y-1 > * + * { margin-top: 0.25rem; }
.space-y-2 > * + * { margin-top: 0.5rem; }
.space-y-3 > * + * { margin-top: 0.75rem; }
.space-y-6 > * + * { margin-top: 1.5rem; }
.space-y-\\[8\\.5em\\] > * + * { margin-top: 8.5em; }
.text-\\[1\\.1rem\\] { font-size: 1.1rem; }
.text-\\[10pt\\] { font-size: 10pt; }
.text-\\[9\\.5pt\\] { font-size: 9.5pt; }
.text-\\[9pt\\] { font-size: 9pt; }
.text-\\[8\\.5pt\\] { font-size: 8.5pt; }
.text-\\[8pt\\] { font-size: 8pt; }
.text-\\[7pt\\] { font-size: 7pt; }
.text-\\[11pt\\] { font-size: 11pt; }
.leading-relaxed { line-height: 1.625; }
.leading-tight { line-height: 1.25; }
.leading-snug { line-height: 1.375; }
.indent-8 { text-indent: 2rem; }
.max-h-\\[4\\.5em\\] { max-height: 4.5em; }
.max-h-\\[95\\%\\] { max-height: 95%; }
.max-w-full { max-width: 100%; }
.min-h-\\[2\\.2in\\] { min-height: 2.2in; }
.w-\\[40\\%\\] { width: 40%; }
.w-\\[80\\%\\] { width: 80%; }
.w-\\[6em\\] { width: 6em; }
.h-\\[6em\\] { height: 6em; }
.w-\\[3\\.5em\\] { width: 3.5em; }
.w-1\\/3 { width: 33.333%; }
.w-1\\/4 { width: 25%; }
.mx-auto { margin-left: auto; margin-right: auto; }
.opacity-30 { opacity: 0.3; }
.top-\\[30\\%\\] { top: 30%; }
.right-0 { right: 0; }
.aspect-square { aspect-ratio: 1 / 1; }
.border { border-width: 1px; border-style: solid; }
.border-b { border-bottom-width: 1px; border-bottom-style: solid; }
.border-t { border-top-width: 1px; border-top-style: solid; }
.border-black { border-color: #000; }
.border-dashed { border-style: dashed; }
.border-gray-200 { border-color: #e5e7eb; }
.border-collapse { border-collapse: collapse; }
.table-fixed { table-layout: fixed; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bg-transparent { background-color: transparent; }
.text-gray-400 { color: #9ca3af; }
.latex-hr { border-top: 1px solid #000; margin-top: 0.25rem; margin-bottom: 0.25rem; width: 100%; }
.latex-spacing-2 { line-height: 2.2; }
.legacy-root ul { list-style-type: disc; padding-left: 2rem; margin: 0; }
.legacy-ann { margin: 0 0 0.5rem; font-size: 10pt; line-height: 1.375; }
.legacy-ann:last-child { margin-bottom: 0; }
.legacy-ann-title { font-weight: 700; }
.legacy-ann-body { white-space: pre-line; }
`.trim();

function bindText(source, field, params) {
  const b = { text: { scope: 'global', source, field, params: params || {} } };
  return JSON.stringify(b);
}
function bindSunday(field) {
  return bindText('sunday', field, { when: { mode: 'this' } });
}
function bindItem(field) {
  return JSON.stringify({ text: { scope: 'item', field } });
}
function bindItemSrc(field) {
  return JSON.stringify({ src: { scope: 'item', field } });
}
function bindFill(field, prop) {
  const key = prop || 'text';
  return JSON.stringify({ [key]: { scope: 'global', source: 'event_field', field, params: {} } });
}
function bindClassItem(field) {
  return JSON.stringify({ class: { scope: 'item', field } });
}

function hymnRepeat(from, to) {
  return JSON.stringify({
    source: 'sunday_hymns',
    params: { when: { mode: 'this' } },
    layout: { direction: 'column', perLine: 1, gap: 0, maxPerPage: 1 },
    from,
    to,
    overflow: 'new-page',
    continueWith: null,
    omitWhenEmpty: true,
  });
}

function listRepeat(source, extraParams, layout) {
  return JSON.stringify({
    source,
    params: Object.assign({ when: { mode: 'this' } }, extraParams || {}),
    layout: layout || { direction: 'column', perLine: 1, gap: 0, maxPerPage: 0 },
    from: 0,
    to: 0,
    overflow: 'clip',
    continueWith: null,
    omitWhenEmpty: false,
  });
}

function fillListRepeat(inputId) {
  return JSON.stringify({
    source: 'event_list',
    params: { inputId },
    layout: { direction: 'column', perLine: 1, gap: 0, maxPerPage: 0 },
    from: 0,
    to: 0,
    overflow: 'clip',
    continueWith: null,
    omitWhenEmpty: false,
  });
}

function oosRow(label, field, italic) {
  const valClass = italic ? 'italic' : '';
  return `<div data-name="oos-row-${field}" class="flex justify-between">
  <span data-name="oos-label-${field}" class="font-bold">${label}</span>
  <span data-name="oos-value-${field}" class="${valClass}" data-bind='${bindSunday(field)}'></span>
</div>`;
}

function oosBold(label, name) {
  return `<div data-name="${name}" class="font-bold">${label}</div>`;
}

const INPUTS = [
  { id: 'legacy_prayerNation', label: 'Nation/Country', kind: 'text' },
  { id: 'legacy_prayerContinent', label: 'Continent', kind: 'text' },
  { id: 'legacy_prayerCapital', label: 'Capital', kind: 'text' },
  { id: 'legacy_prayerPopulation', label: 'Population', kind: 'text' },
  { id: 'legacy_prayerLanguage', label: 'Official Language', kind: 'text' },
  { id: 'legacy_prayerTotalLanguages', label: 'Total Languages', kind: 'text' },
  { id: 'legacy_prayerLiteracy', label: 'Literacy Rate', kind: 'text' },
  { id: 'legacy_prayerChristian', label: 'Christian', kind: 'text' },
  { id: 'legacy_prayerEvangelical', label: 'Evangelical', kind: 'text' },
  { id: 'legacy_prayerUnevangelized', label: 'Un-evangelized', kind: 'text' },
  { id: 'legacy_prayerCountryImage', label: 'Country Map', kind: 'image' },
  { id: 'legacy_prayerPrompts', label: 'Prayer Prompts', kind: 'list', fields: [
    { id: 'text', label: 'Prompt', kind: 'text' },
  ] },
  { id: 'legacy_kidsLessonTitle', label: 'Lesson Title', kind: 'text' },
  { id: 'legacy_kidsLessonVerse', label: 'Passage Reference', kind: 'text' },
  { id: 'legacy_kidsSummary', label: 'Bible Story Summary', kind: 'list', fields: [
    { id: 'text', label: 'Point', kind: 'text' },
  ] },
  { id: 'legacy_kidsQuestions', label: 'Review Questions', kind: 'list', fields: [
    { id: 'text', label: 'Question', kind: 'text' },
  ] },
];

function titlePage() {
  return `<div data-name="title-page" class="legacy-root h-full flex flex-col items-center pt-[1in]">
  <img data-name="title-image" src="assets/standard/titlepageim.png" class="w-full mb-[0.8in]" alt="Title Image">
  <div data-name="title-date" class="text-[1.1rem] mt-[0.2in]" data-bind='${bindSunday('longDate')}'></div>
</div>`;
}

function oosPage() {
  // Live liturgy field ids from printable_data_catalog (this congregation).
  return `<div data-name="order-of-service" class="legacy-root text-[10pt] flex flex-col h-full">
  <div data-name="oos-header" class="flex justify-between items-baseline flex-shrink-0">
    <span data-name="oos-heading" class="text-[1.1rem] font-bold">Order of Service</span>
    <span data-name="oos-theme" class="text-[1.1rem] italic" data-bind='${bindSunday('theme')}'></span>
  </div>
  <div data-name="oos-rule" class="latex-hr mb-1 flex-shrink-0"></div>
  <div data-name="oos-key-verse" class="text-center text-[8pt] italic mb-3 flex-shrink-0 max-h-[4.5em] overflow-hidden leading-relaxed" data-bind='${bindSunday('keyVerse')}'></div>
  <div data-name="oos-rows" class="latex-spacing-2 flex-grow flex flex-col justify-between overflow-hidden">
    ${oosRow('Preparatory', 'hymn2', true)}
    ${oosBold('Welcome', 'oos-welcome')}
    ${oosBold('Moment of Silent Preparation', 'oos-silent-prep')}
    ${oosRow('Scriptural Call to Worship', 'callToWorship', false)}
    ${oosRow('Hymn', 'hymn6', true)}
    ${oosRow('Hymn', 'hymn7', true)}
    ${oosBold('Prayer of Praise', 'oos-prayer-of-praise')}
    ${oosRow('Call To Confession', 'callToConfession', false)}
    ${oosBold('Prayer of Confession', 'oos-prayer-of-confession')}
    ${oosRow('Scriptural Assurance of Pardon', 'assuranceOfPardon', false)}
    ${oosRow('Hymn', 'hymn', true)}
    ${oosRow('Hymn', 'hymn3', true)}
    ${oosRow('Scripture Reading', 'scriptureReading', false)}
    ${oosBold('Pastoral Prayer', 'oos-pastoral-prayer')}
    ${oosRow('Sermon', 'sermon', false)}
    ${oosRow('Hymn', 'hymn4', true)}
    ${oosRow('Hymn', 'hymn5', true)}
    ${oosBold("The Lord's Supper", 'oos-lords-supper')}
    ${oosBold('Moment of Silent Reflection', 'oos-silent-reflection')}
    ${oosRow('Benediction', 'benediction', false)}
  </div>
  <div data-name="oos-footer" class="mt-4 flex-shrink-0">
    <div data-name="oos-roles" class="grid grid-cols-3 gap-2 text-[8pt] pb-1 border-b border-black">
      <span data-name="oos-preacher-line">Preacher: <span data-name="oos-preacher" data-bind='${bindSunday('preacher')}'></span></span>
      <span data-name="oos-music-line" class="text-center">Music Leader: <span data-name="oos-music" data-bind='${bindSunday('musicLeader')}'></span></span>
      <span data-name="oos-leader-line" class="text-right">Service Leader: <span data-name="oos-leader" data-bind='${bindSunday('serviceLeader')}'></span></span>
    </div>
    <div data-name="oos-close" class="text-center italic mt-4 text-[9pt]">Our service typically concludes at approximately 11:45 a.m.</div>
  </div>
</div>`;
}

function hymnPage(name, from, to) {
  return `<div data-name="${name}" class="legacy-root h-full flex flex-col pb-8" data-repeat='${hymnRepeat(from, to)}'>
  <div data-name="hymn-header" class="flex justify-between items-baseline">
    <span data-name="hymn-label" class="text-[1.1rem] font-bold">Hymn</span>
    <span data-name="hymn-name" class="text-[1.1rem] italic" data-bind='${bindItem('name')}'></span>
  </div>
  <div data-name="hymn-rule" class="latex-hr mb-2"></div>
  <div data-name="hymn-sheet-stage" class="flex-1 flex flex-col items-center justify-start overflow-hidden mt-4">
    <img data-name="hymn-sheet-image" src="" class="max-w-full max-h-[95%] object-contain" alt="" data-bind='${bindItemSrc('image')}'>
  </div>
  <div data-name="hymn-footer" class="text-center text-[7pt] italic mt-2" data-bind='${bindItem('sheetFooter')}'></div>
</div>`;
}

function prayerPage() {
  const fact = (label, id, name) =>
    `<div data-name="${name}"><b>${label}:</b> <span data-name="${name}-value" data-bind='${bindFill(id)}'></span></div>`;
  return `<div data-name="pastoral-prayer" class="legacy-root text-[10pt] relative h-full">
  <div data-name="prayer-header" class="flex justify-between items-baseline">
    <span data-name="prayer-heading" class="text-[1.1rem] font-bold">Pastoral Prayer</span>
  </div>
  <div data-name="prayer-rule" class="latex-hr mb-4"></div>
  <div data-name="prayer-subjects-block" class="space-y-[8.5em] mb-4 flex-shrink-0">
    <div data-name="prayer-spacer">&nbsp;</div>
    <div data-name="prayer-church-line">
      <span data-name="prayer-church-label" class="font-bold">Church:</span>
      <span data-name="prayer-church-subjects" data-bind='${bindSunday('prayer3')}'></span>
    </div>
    <div data-name="prayer-nation-line">
      <span data-name="prayer-nation-label" class="font-bold">Nation/Country:</span>
      <span data-name="prayer-nation-value" class="italic" data-bind='${bindFill('legacy_prayerNation')}'></span>
    </div>
  </div>
  <div data-name="prayer-facts" class="mt-4 pl-6 space-y-1 text-[9.5pt]">
    ${fact('Continent', 'legacy_prayerContinent', 'prayer-continent')}
    ${fact('Capital', 'legacy_prayerCapital', 'prayer-capital')}
    ${fact('Population', 'legacy_prayerPopulation', 'prayer-population')}
    ${fact('Official Language', 'legacy_prayerLanguage', 'prayer-language')}
    ${fact('Total Languages', 'legacy_prayerTotalLanguages', 'prayer-total-languages')}
    ${fact('Literacy Rate', 'legacy_prayerLiteracy', 'prayer-literacy')}
    ${fact('Christian', 'legacy_prayerChristian', 'prayer-christian')}
    ${fact('Evangelical', 'legacy_prayerEvangelical', 'prayer-evangelical')}
    ${fact('Un-evangelized', 'legacy_prayerUnevangelized', 'prayer-unevangelized')}
  </div>
  <div data-name="prayer-map-frame" class="absolute top-[30%] right-0 w-[40%] flex items-center justify-center aspect-square overflow-hidden">
    <img data-name="prayer-map-image" src="" alt="Country map" class="w-full h-full object-contain" data-bind='${bindFill('legacy_prayerCountryImage', 'src')}'>
  </div>
  <div data-name="prayer-prompts-block" class="mt-8">
    <div data-name="prayer-prompts-heading" class="underline font-bold mb-2">Prayer Prompts for Country:</div>
    <ul data-name="prayer-prompts-list" class="pl-8 space-y-0.5 text-[9.5pt]">
      <li data-name="prayer-prompt-item" data-repeat='${fillListRepeat('legacy_prayerPrompts')}' data-bind='${bindItem('text')}'></li>
    </ul>
  </div>
</div>`;
}

function notesPage(name) {
  return `<div data-name="${name}" class="legacy-root h-full flex flex-col">
  <div data-name="notes-header" class="flex justify-between items-baseline flex-shrink-0">
    <span data-name="notes-heading" class="text-[1.1rem] font-bold">Sermon Notes</span>
  </div>
  <div data-name="notes-rule" class="latex-hr mb-4 flex-shrink-0"></div>
  <div data-name="notes-writing-space" class="flex-1"></div>
</div>`;
}

function kidsPage() {
  return `<div data-name="for-the-rest-of-the-week" class="legacy-root text-[10pt] h-full flex flex-col">
  <div data-name="kids-header" class="flex justify-between items-baseline flex-shrink-0">
    <span data-name="kids-heading" class="text-[1.1rem] font-bold">Parent Discussion: Mosaic Kids</span>
  </div>
  <div data-name="kids-rule" class="latex-hr mb-4 flex-shrink-0"></div>
  <p data-name="kids-intro" class="text-[9.5pt] leading-relaxed indent-8">For parents whose kids attended Mosaic Kids, this section contains a summary of the lesson they received as well as provides questions for you to ask your kids. We, as a church, want to assist you as parents in educating your kids and to help them continue to think about what they learned beyond just Sunday.</p>
  <div data-name="kids-lesson-block" class="mt-8 text-center space-y-2 flex-shrink-0">
    <div data-name="kids-lesson-title" class="text-[1.1rem] font-bold italic" data-bind='${bindFill('legacy_kidsLessonTitle')}'></div>
    <div data-name="kids-lesson-verse" class="text-[9pt]" data-bind='${bindFill('legacy_kidsLessonVerse')}'></div>
    <div data-name="kids-lesson-rule" class="latex-hr w-[80%] mx-auto opacity-30"></div>
  </div>
  <div data-name="kids-body" class="mt-8 space-y-6 flex-grow overflow-hidden">
    <div data-name="kids-summary-section">
      <div data-name="kids-summary-heading" class="font-bold italic mb-2">Bible Story Summary:</div>
      <ul data-name="kids-summary-list" class="text-[11pt] leading-relaxed space-y-1">
        <li data-name="kids-summary-item" data-repeat='${fillListRepeat('legacy_kidsSummary')}' data-bind='${bindItem('text')}'></li>
      </ul>
    </div>
    <div data-name="kids-mid-rule" class="latex-hr w-[80%] mx-auto opacity-30"></div>
    <div data-name="kids-questions-section">
      <div data-name="kids-questions-heading" class="font-bold italic mb-2">Review Questions:</div>
      <ul data-name="kids-questions-list" class="text-[11pt] leading-relaxed space-y-1">
        <li data-name="kids-question-item" data-repeat='${fillListRepeat('legacy_kidsQuestions')}' data-bind='${bindItem('text')}'></li>
      </ul>
    </div>
  </div>
</div>`;
}

function announcementsPage() {
  const sundaysRepeat = JSON.stringify({
    source: 'sundays',
    params: {
      notPlanned: 'TBA',
      range: { start: { mode: 'this' }, mode: 'weeks', count: 5 },
      which: 'every',
    },
    layout: { direction: 'column', perLine: 1, gap: 0, maxPerPage: 5 },
    from: 0,
    to: 0,
    overflow: 'clip',
    continueWith: null,
    omitWhenEmpty: false,
  });
  return `<div data-name="announcements-page" class="legacy-root flex flex-col h-full text-[10pt]">
  <div data-name="announcements-header" class="flex justify-between items-baseline">
    <span data-name="announcements-heading" class="text-[1.1rem] font-bold">Announcements</span>
  </div>
  <div data-name="announcements-rule" class="latex-hr mb-2"></div>
  <div data-name="announcements-list" class="min-h-[2.2in] mb-4 overflow-hidden">
    <div data-name="announcement-item" class="legacy-ann" data-repeat='${listRepeat('sunday_announcements')}' data-bind='${bindClassItem('fitClass')}'>
      <span data-name="announcement-title" class="legacy-ann-title" data-bind='${bindItem('label')}'></span>
      <span data-name="announcement-body" class="legacy-ann-body" data-bind='${bindItem('plain')}'></span>
    </div>
  </div>
  <div data-name="weekly-events" class="text-center mb-6">
    <div data-name="weekly-events-heading" class="underline font-bold text-[10pt] mb-2">Weekly Events</div>
    <div data-name="weekly-events-body" class="text-left text-[10pt] leading-tight space-y-3">
      <p data-name="weekly-mosaic-kids"><b>Mosaic Kids:</b> We have a Mosaic Kids at 8:30 a.m. on Sunday mornings before service. During this hour, the kids will be given a structured lesson plan from the Gospel Project.</p>
      <p data-name="weekly-service-review"><b>Service Review:</b> On Mondays, following the service, we meet for lunch at 12:00 p.m. to review the entire service, giving godly encouragement and loving feedback</p>
    </div>
  </div>
  <div data-name="qr-block" class="w-full mb-6">
    <table data-name="qr-labels" class="w-full border-collapse">
      <thead>
        <tr>
          <th class="text-[8.5pt] font-bold py-1 w-1/4">Weekly Playlist</th>
          <th class="text-[8.5pt] font-bold py-1 w-1/4">Comprehensive Playlist</th>
          <th class="text-[8.5pt] font-bold py-1 w-1/4">Giving</th>
          <th class="text-[8.5pt] font-bold py-1 w-1/4">First Time Guest</th>
        </tr>
      </thead>
    </table>
    <div data-name="qr-rule" class="border-t border-black mb-3"></div>
    <div data-name="qr-images" class="grid grid-cols-4 gap-2 text-center">
      <div data-name="qr-weekly" class="flex justify-center"><img src="assets/standard/WeeklyPlaylistQR.png" class="w-[6em] h-[6em] object-contain" alt="Weekly Playlist QR"></div>
      <div data-name="qr-comprehensive" class="flex justify-center"><img src="assets/standard/ComprehensivePlaylistQR.png" class="w-[6em] h-[6em] object-contain" alt="Comprehensive Playlist QR"></div>
      <div data-name="qr-giving" class="flex justify-center"><img src="assets/standard/GivingQR.png" class="w-[6em] h-[6em] object-contain" alt="Giving QR"></div>
      <div data-name="qr-guest" class="flex justify-center"><img src="assets/standard/FirstTimeGuestQR.png" class="w-[6em] h-[6em] object-contain" alt="First Time Guest QR"></div>
    </div>
  </div>
  <div data-name="preaching-schedule" class="mt-auto">
    <div data-name="schedule-header" class="flex justify-between items-baseline flex-shrink-0">
      <span data-name="schedule-heading" class="text-[1.1rem] font-bold">Preaching Schedule</span>
    </div>
    <div data-name="schedule-rule" class="latex-hr mb-1"></div>
    <table data-name="schedule-table" class="w-full text-[9.5pt] border-collapse table-fixed">
      <thead>
        <tr class="border-b border-black">
          <th class="text-left py-1 font-normal w-1/3">Date</th>
          <th class="text-center py-1 font-normal w-1/3">Preacher</th>
          <th class="text-right py-1 font-normal w-1/3">Sermon Text</th>
        </tr>
      </thead>
      <tbody data-name="schedule-body" class="leading-relaxed">
        <tr data-name="schedule-row" data-repeat='${sundaysRepeat}'>
          <td data-name="schedule-date" class="py-1 text-left truncate" data-bind='${bindItem('slashDate')}'></td>
          <td data-name="schedule-preacher" class="py-1 text-center truncate" data-bind='${bindItem('preacher')}'></td>
          <td data-name="schedule-sermon" class="py-1 text-right truncate" data-bind='${bindItem('sermon')}'></td>
        </tr>
      </tbody>
    </table>
    <div data-name="schedule-bottom-rule" class="border-t border-black mt-0.5"></div>
  </div>
  <div data-name="church-footer" class="flex-1 flex justify-center items-center py-2">
    <div data-name="church-footer-inner" class="flex items-center gap-6">
      <img data-name="church-logo" src="assets/standard/logo.png" class="w-[3.5em] h-auto flex-shrink-0" alt="Mosaic Church">
      <div data-name="church-contact" class="text-[9.5pt] leading-snug text-left">
        <div data-name="church-address"><b>Meeting Address:</b> 4080 State Hwy 6 Frontage Rd</div>
        <div data-name="church-website" class="mt-0.5"><b>Website:</b> www.mosaiccstx.org</div>
        <div data-name="church-email" class="mt-0.5"><b>Info:</b> admin@mosaiccstx.org</div>
      </div>
    </div>
  </div>
</div>`;
}

function page(name, html) {
  return { name, html, css: LEGACY_CSS, margins: MARGIN };
}

export function buildLegacyServiceGuide() {
  const pages = [
    page('Title', titlePage()),
    page('Order of Service', oosPage()),
    page('Hymns (rows 1–5, before prayer)', hymnPage('hymns-before-prayer', 1, 5)),
    page('Pastoral Prayer', prayerPage()),
    page('Sermon Notes', notesPage('sermon-notes-1')),
    page('Sermon Notes', notesPage('sermon-notes-2')),
    page('Sermon Notes', notesPage('sermon-notes-3')),
    page('Hymns (rows 6–, after notes)', hymnPage('hymns-after-notes', 6, 0)),
    page('For the Rest of the Week', kidsPage()),
    page('Announcements', announcementsPage()),
  ];
  const problems = [];
  pages.forEach((p, i) => {
    const parsed = Core.htmlToNodes(p.html);
    if (!parsed.ok) {
      problems.push(`Page ${i + 1} (${p.name}):\n` + parsed.problems.map((x) => '  ' + x).join('\n'));
    }
  });
  if (problems.length) {
    const err = new Error('HTML could not be read:\n' + problems.join('\n'));
    err.problems = problems;
    throw err;
  }
  return { inputs: INPUTS, pages };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = buildLegacyServiceGuide();
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
