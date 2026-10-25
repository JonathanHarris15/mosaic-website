/**
 * Build Mosaic-designed Service Guide pages for the Printable editor/MCP.
 *
 * Visual source: the live "Sunday Service Guide" booklet (seed_mosaic look).
 * Wiring: editor-legal only — sunday / sunday_hymns (from/to) /
 * sunday_announcements / sundays / event_field / event_list /
 * insert_page_number.
 *
 * Hymns: one sunday_hymns list split with from/to around pastoral prayer
 * and sermon notes (MS-743), so the interruption matches the booklet order.
 *
 * Run: node scripts/mosaic-service-guide-pages.mjs
 * Prints JSON { inputs, pages } and also writes /tmp/mosaic-sg-pages/.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Core = require('../public/printable-core.js');

const ZERO_MARGIN = { top: 0, right: 0, bottom: 0, left: 0 };
const SRC = '/tmp/designed-pages';

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
  {
    id: 'legacy_prayerPrompts', label: 'Prayer Prompts', kind: 'list',
    fields: [{ id: 'text', label: 'Prompt', kind: 'text' }],
  },
  { id: 'legacy_kidsLessonTitle', label: 'Lesson Title', kind: 'text' },
  { id: 'legacy_kidsLessonVerse', label: 'Passage Reference', kind: 'text' },
  {
    id: 'legacy_kidsSummary', label: 'Bible Story Summary', kind: 'list',
    fields: [{ id: 'text', label: 'Point', kind: 'text' }],
  },
  {
    id: 'legacy_kidsQuestions', label: 'Review Questions', kind: 'list',
    fields: [{ id: 'text', label: 'Question', kind: 'text' }],
  },
];

function stripPids(html) {
  return String(html).replace(/\s*data-pid="[^"]*"/g, '');
}

/** Assign data-name on every element that lacks one. */
function labelTree(html, pageKey) {
  let n = 0;
  return stripPids(html).replace(/<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g, (full, tag, attrs) => {
    if (tag === 'br') return full;
    const a = attrs || '';
    if (/\sdata-name=/.test(a)) return full;
    n += 1;
    const cls = (/\sclass="([^"]*)"/.exec(a) || [])[1] || '';
    const hint = cls.split(/\s+/).find((c) => c && !c.startsWith('m-sheet')) || tag;
    const name = `${pageKey}-${hint}-${n}`.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 48);
    if (!a) return `<${tag} data-name="${name}">`;
    if (a.endsWith('/')) {
      return `<${tag}${a.slice(0, -1)} data-name="${name}" />`;
    }
    return `<${tag}${a} data-name="${name}">`;
  });
}

function replaceRepeat(html, mutate) {
  return html.replace(/data-repeat="(\{[\s\S]*?\})"/g, (full, raw) => {
    const json = raw.replace(/&quot;/g, '"');
    let obj;
    try { obj = JSON.parse(json); } catch (e) { return full; }
    mutate(obj);
    return `data-repeat="${JSON.stringify(obj).replace(/"/g, '&quot;')}"`;
  });
}

function hymnPage(from, to, nameKey) {
  const base = fs.readFileSync(path.join(SRC, 'page-04.html'), 'utf8');
  const css = fs.readFileSync(path.join(SRC, 'page-04.css'), 'utf8');
  let html = labelTree(base, nameKey);
  html = replaceRepeat(html, (obj) => {
    if (obj.source !== 'sunday_hymns') return;
    delete obj.params.slot;
    obj.params.when = { mode: 'this' };
    obj.from = from;
    obj.to = to;
    obj.overflow = 'new-page';
    obj.omitWhenEmpty = true;
    obj.layout = { direction: 'column', perLine: 1, gap: 0, maxPerPage: 1 };
  });
  return {
    name: from === 1 ? 'Hymns (before prayer)' : 'Hymns (after notes)',
    html,
    css,
    margins: ZERO_MARGIN,
  };
}

function loadDesigned(n, name, pageKey, transform) {
  const html0 = fs.readFileSync(path.join(SRC, `page-${String(n).padStart(2, '0')}.html`), 'utf8');
  const css = fs.readFileSync(path.join(SRC, `page-${String(n).padStart(2, '0')}.css`), 'utf8');
  let html = labelTree(html0, pageKey);
  if (transform) html = transform(html);
  return { name, html, css, margins: ZERO_MARGIN };
}

function listItem(name, inputId) {
  return `<ul data-name="${name}-list" class="m-qlist" style="margin-top: 10.94px">
      <li data-name="${name}-item" data-bind="{&quot;text&quot;:{&quot;field&quot;:&quot;text&quot;,&quot;scope&quot;:&quot;item&quot;}}" data-repeat="{&quot;source&quot;:&quot;event_list&quot;,&quot;params&quot;:{&quot;inputId&quot;:&quot;${inputId}&quot;},&quot;layout&quot;:{&quot;direction&quot;:&quot;column&quot;,&quot;perLine&quot;:1,&quot;gap&quot;:0,&quot;maxPerPage&quot;:0},&quot;from&quot;:0,&quot;to&quot;:0,&quot;overflow&quot;:&quot;clip&quot;,&quot;continueWith&quot;:null,&quot;omitWhenEmpty&quot;:false}"></li>
    </ul>`;
}

/** Replace a scalar event_field span (and its wrapping m-body div) with an event_list. */
function replaceScalarFillWithList(html, fieldId, listName) {
  const re = new RegExp(
      `<div([^>]*class="m-body"[^>]*)>[\\s\\S]*?data-bind="[^"]*${fieldId}[^"]*"[\\s\\S]*?<\\/div>`,
      'i',
  );
  if (!re.test(html)) {
    // Fallback: replace just the span
    const re2 = new RegExp(
        `<span([^>]*)data-bind="[^"]*${fieldId}[^"]*"([^>]*)><\\/span>`,
        'i',
    );
    return html.replace(re2, listItem(listName, fieldId));
  }
  return html.replace(re, listItem(listName, fieldId));
}

function kidsTransform(html) {
  html = replaceScalarFillWithList(html, 'legacy_kidsSummary', 'kids-summary');
  html = replaceRepeat(html, (obj) => {
    if (obj.source !== 'sunday_kids_questions') return;
    obj.source = 'event_list';
    obj.params = { inputId: 'legacy_kidsQuestions' };
  });
  return html;
}

function prayerTransform(html) {
  return replaceScalarFillWithList(html, 'legacy_prayerPrompts', 'prayer-prompts');
}

function build() {
  if (!fs.existsSync(path.join(SRC, 'page-01.html'))) {
    throw new Error('Missing ' + SRC + ' — extract designed pages first');
  }

  const pages = [
    loadDesigned(1, 'Cover', 'cover'),
    loadDesigned(2, 'Welcome', 'welcome'),
    loadDesigned(3, 'Order of Service', 'oos'),
    hymnPage(1, 5, 'hymns-before'),
    loadDesigned(9, 'Pastoral Prayer', 'prayer', prayerTransform),
    loadDesigned(10, 'Sermon Notes', 'notes-main'),
    loadDesigned(11, 'Sermon Notes', 'notes-2'),
    loadDesigned(12, 'Sermon Notes', 'notes-3'),
    hymnPage(6, 0, 'hymns-after'),
    loadDesigned(15, 'For the Rest of the Week', 'kids', kidsTransform),
    loadDesigned(16, 'Announcements', 'announcements'),
  ];

  for (const p of pages) {
    const parsed = Core.htmlToNodes(p.html);
    if (!parsed.ok) {
      throw new Error(p.name + ': ' + parsed.problems.join('; '));
    }
  }

  return { inputs: INPUTS, pages };
}

const out = build();
const dir = '/tmp/mosaic-sg-pages';
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'bundle.json'), JSON.stringify(out));
out.pages.forEach((p, i) => {
  const n = String(i + 1).padStart(2, '0');
  fs.writeFileSync(path.join(dir, `page-${n}.html`), p.html);
  fs.writeFileSync(path.join(dir, `page-${n}.css`), p.css);
  fs.writeFileSync(path.join(dir, `page-${n}.meta.json`), JSON.stringify({
    name: p.name, margins: p.margins,
  }));
});
fs.writeFileSync(path.join(dir, 'inputs.json'), JSON.stringify(out.inputs, null, 2));
process.stdout.write(JSON.stringify({
  ok: true,
  pages: out.pages.length,
  inputs: out.inputs.length,
  names: out.pages.map((p) => p.name),
  dir,
}));
