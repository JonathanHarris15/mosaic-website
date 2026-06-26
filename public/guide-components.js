// Guide Components — the developer-authored Component catalog (ADR-0008, §3.1).
//
// A Component is a preset an editor places in a Page Template via a hyphenated
// custom tag. Components ship in code (this file), never as Firestore documents:
// editors place them, only developers author them. Two kinds under one model:
//
//   Bound  (kind:'bound') — auto-pulls from the resolved serviceContext; never
//                           prompts. render(ctx) -> HTML string. One bound
//                           Component (hymn-sheet) is multiPage: renderPages(ctx)
//                           -> string[] (one whole physical page per fragment).
//   Input  (kind:'input') — declares Entry Field(s) via fields(attrs); the OOS
//                           Editor prompts for them weekly. render(ctx) reads the
//                           filled value out of ctx.values.
//
// The render functions reproduce today's booklet markup verbatim (same Tailwind
// classes), so the seeded default Service Guide Template prints byte-for-byte
// what the eight hardcoded page types print today (test/guide-seed.test.js).
//
// Loaded as a classic <script> after guide-engine.js; IIFE exposes only
// window.GuideComponents. Also module.exports for Node tests — no DOM, no
// Firestore: every Component is a pure function of (ctx).
(function (global) {
    'use strict';

    // ── small pure helpers ────────────────────────────────────────────────────
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function attrEsc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    }
    // mm/dd/yy from a YYYY-MM-DD service-date key (ports getShortDate).
    function shortDate(dateStr) {
        if (!dateStr) return '';
        const [y, m, d] = String(dateStr).split('-');
        return `${m}/${d}/${y.slice(-2)}`;
    }
    function svc(ctx) { return (ctx && ctx.service) || {}; }
    function lit(ctx) { return svc(ctx).liturgy || {}; }
    function removed(ctx) { const r = svc(ctx).removedHymns; return Array.isArray(r) ? r : []; }
    function hymnName(ctx, field) { const h = lit(ctx)[field]; return (h && h.name) || ''; }

    // The Tailwind class that shrinks long Baptism Candidate rows (port of
    // baptismNamesClass): keeps the row on one line as the count grows.
    function baptismNamesClass(names) {
        const count = (names || '').split(',').map(s => s.trim()).filter(Boolean).length;
        if (count >= 4) return 'text-xs';
        if (count === 3) return 'text-sm';
        return '';
    }

    // ── Bound Components ───────────────────────────────────────────────────────

    const serviceDate = {
        tag: 'service-date', kind: 'bound', surface: 'builder', label: 'Service Date',
        render(ctx) {
            const s = svc(ctx);
            const fmt = (ctx.attrs && ctx.attrs.format) || 'long';
            return esc(fmt === 'short' ? (s.shortDate || shortDate(s.date)) : (s.longDate || ''));
        },
    };

    const serviceTheme = {
        tag: 'service-theme', kind: 'bound', surface: 'builder', label: 'Theme',
        render(ctx) { return esc(svc(ctx).theme || ''); },
    };

    const keyVerseRef = {
        tag: 'key-verse-ref', kind: 'bound', surface: 'builder', label: 'Key Verse Reference',
        render(ctx) { return esc(svc(ctx).keyVerse || ''); },
    };

    const keyVerseText = {
        tag: 'key-verse-text', kind: 'bound', surface: 'builder', label: 'Key Verse Text (ESV)',
        render(ctx) { return esc(svc(ctx).keyVerseText || ''); },
    };

    const pastoralPrayerLabel = {
        tag: 'pastoral-prayer-label', kind: 'bound', surface: 'builder', label: 'Pastoral Prayer Heading',
        render(ctx) { return esc(lit(ctx).prayerLabel || 'Pastoral Prayer'); },
    };

    const baptismNames = {
        tag: 'baptism-names', kind: 'bound', surface: 'builder', label: 'Baptism Candidate Names',
        render(ctx) { return esc(svc(ctx).baptismNames || ''); },
    };

    const pastoralPrayerSubject = {
        tag: 'pastoral-prayer-subject', kind: 'bound', surface: 'builder', label: 'Pastoral Prayer Subject',
        render(ctx) {
            const which = (ctx.attrs && ctx.attrs.which) === 'female' ? 'prayerFemale' : 'prayerMale';
            const ref = lit(ctx)[which];
            return esc((ref && ref.name) || '');
        },
    };

    // The full Order of Service body — the one bound Component that reproduces the
    // old `order_of_service` page type. Reads the structured Service (liturgy
    // fields stay canonical; ADR-0008 §6) so liturgy editing is never dissolved
    // into generic blanks.
    const oosList = {
        tag: 'oos-list', kind: 'bound', surface: 'builder', label: 'Order of Service',
        render(ctx) {
            const s = svc(ctx);
            const l = lit(ctx);
            const rm = removed(ctx);
            const hide = (f) => rm.includes(f);
            const prayerLabel = l.prayerLabel || 'Pastoral Prayer';
            const rows = [];

            const labelVal = (label, value, italic) =>
                `<div class="flex justify-between"><span class="font-bold">${esc(label)}</span><span class="${italic ? 'italic' : ''}">${esc(value || '')}</span></div>`;
            const bold = (label) => `<div class="font-bold">${esc(label)}</div>`;

            if (!hide('preparatoryHymn')) rows.push(labelVal('Preparatory', hymnName(ctx, 'preparatoryHymn'), true));
            rows.push(bold('Welcome'));
            rows.push(bold('Moment of Silent Preparation'));
            rows.push(labelVal('Scriptural Call to Worship', l.callToWorship));
            if (!hide('hymn1')) rows.push(labelVal('Hymn', hymnName(ctx, 'hymn1'), true));
            if (!s.hasBaptism && !hide('hymn2')) rows.push(labelVal('Hymn', hymnName(ctx, 'hymn2'), true));
            rows.push(bold('Prayer of Praise'));
            rows.push(labelVal('Call To Confession', l.callToConfession));
            rows.push(bold('Prayer of Confession'));
            rows.push(labelVal('Scriptural Assurance of Pardon', l.assuranceOfPardon));
            if (!hide('hymnMid1')) rows.push(labelVal('Hymn', hymnName(ctx, 'hymnMid1'), true));
            if (!hide('hymnMid2')) rows.push(labelVal('Hymn', hymnName(ctx, 'hymnMid2'), true));
            rows.push(labelVal('Scripture Reading', l.scriptureReading));
            rows.push(bold(prayerLabel));
            rows.push(labelVal('Sermon', l.sermon));
            if (s.hasBaptism) {
                const names = s.baptismNames || '';
                rows.push(`<div class="flex justify-between"><span class="font-bold">Baptism</span><span class="text-right whitespace-nowrap ${baptismNamesClass(names)}">${esc(names)}</span></div>`);
            }
            if (!hide('hymnEnd1')) rows.push(labelVal('Hymn', hymnName(ctx, 'hymnEnd1'), true));
            if (!hide('hymnEnd2')) rows.push(labelVal('Hymn', hymnName(ctx, 'hymnEnd2'), true));
            rows.push(bold("The Lord's Supper"));
            rows.push(bold('Moment of Silent Reflection'));
            rows.push(labelVal('Benediction', l.benediction));

            const dash = (s.keyVerseText && s.keyVerse) ? '<span>—</span>' : '';
            return `<div class="text-[10pt] flex flex-col h-full">
  <div class="flex justify-between items-baseline flex-shrink-0">
    <span class="text-[1.1rem] font-bold">Order of Service</span>
    <span class="text-[1.1rem] italic">${esc(s.theme || '')}</span>
  </div>
  <div class="latex-hr mb-1 flex-shrink-0"></div>
  <div class="text-center text-[8pt] italic mb-3 flex-shrink-0 max-h-[4.5em] overflow-hidden leading-relaxed">
    <span>${esc(s.keyVerseText || '')}</span> ${dash} <span>${esc(s.keyVerse || '')}</span>
  </div>
  <div class="latex-spacing-2 flex-grow flex flex-col justify-between overflow-hidden">
    ${rows.join('\n    ')}
  </div>
  <div class="mt-4 flex-shrink-0">
    <div class="grid grid-cols-3 gap-2 text-[8pt] pb-1 border-b border-black">
      <span>Preacher: <span>${esc(s.preacher || 'TBD')}</span></span>
      <span class="text-center">Music Leader: <span>${esc(s.musicLeader || 'TBD')}</span></span>
      <span class="text-right">Service Leader: <span>${esc(s.serviceLeader || 'TBD')}</span></span>
    </div>
    <div class="text-center italic mt-4 text-[9pt]">Our service typically concludes at approximately 11:45 a.m.</div>
  </div>
</div>`;
        },
    };

    // Hymn sheet music — the multi-page Bound Component (ADR-0008 decision #6/#7).
    // Bound to one liturgy hymn slot via `field`. Emits one physical page per
    // sheet-music image; a literal (unlinked) hymn emits one placeholder page; a
    // removed slot — or hymn2 when `omit-on-baptism` and the Service has a baptism
    // — emits nothing, letting the Filler Page absorb the freed pages.
    const hymnSheet = {
        tag: 'hymn-sheet', kind: 'bound', surface: 'builder', label: 'Hymn Sheet Music', multiPage: true,
        render(ctx) { return (this.renderPages(ctx) || []).join(''); },
        renderPages(ctx) {
            const field = ctx.params.field || ctx.attrs.field;
            if (!field) return [];
            const rm = removed(ctx);
            if (rm.includes(field)) return [];
            const omitOnBaptism = ctx.params['omit-on-baptism'] || ctx.attrs['omit-on-baptism'];
            if (omitOnBaptism && svc(ctx).hasBaptism) return [];

            const byField = svc(ctx).hymnsByField || {};
            const hymn = byField[field] || {};
            const ref = lit(ctx)[field] || {};
            const name = hymn.name || ref.name || '';
            // Gate purely on the hymn name, matching the old generator's
            // addHymnPages (`if (!hymnRef.name) return`): an unnamed slot
            // contributes no pages and the Filler absorbs the freed slot.
            if (!name) return [];

            const pages = Array.isArray(hymn.pages) ? hymn.pages : [];
            const attribution = hymn.attribution || '';
            const header = (displayName) => `<div class="flex justify-between items-baseline">
      <span class="text-[1.1rem] font-bold">Hymn</span>
      <span class="text-[1.1rem] italic">${esc(displayName)}</span>
    </div>
    <div class="latex-hr mb-2"></div>`;

            // Literal hymn or no images on file -> single placeholder page. The
            // footer div is kept (matching the old page, which always rendered
            // it) and carries the attribution — '' for a literal hymn.
            if (!pages.length) {
                return [`<div class="h-full flex flex-col pb-8">
    ${header(name)}
    <div class="flex-1 flex flex-col items-center justify-start overflow-hidden mt-4">
      <div class="w-full h-full flex flex-col items-center justify-center bg-gray-50 border-2 border-dashed border-gray-200 rounded text-gray-400">
        <span class="material-symbols-outlined text-4xl mb-2">music_note</span>
        <p class="text-sm font-sans text-center">No music sheet found for:<br/><b>${esc(name)}</b></p>
      </div>
    </div>
    <div class="text-center text-[7pt] italic mt-2"><span>${esc(attribution)}</span></div>
  </div>`];
            }

            return pages.map((url, i) => {
                const footer = (i < pages.length - 1)
                    ? '<span>(next page)</span>'
                    : `<span>${esc(attribution)}</span>`;
                return `<div class="h-full flex flex-col pb-8">
    ${header(name)}
    <div class="flex-1 flex flex-col items-center justify-start overflow-hidden mt-4">
      <img src="${attrEsc(url)}" class="max-w-full max-h-[95%] object-contain" />
    </div>
    <div class="text-center text-[7pt] italic mt-2">${footer}</div>
  </div>`;
            });
        },
    };

    // The upcoming preaching schedule table (port of the announcements page's
    // schedule block). Reads serviceContext.schedule (next ~5 services).
    const schedule = {
        tag: 'preaching-schedule', kind: 'bound', surface: 'builder', label: 'Preaching Schedule',
        render(ctx) {
            const items = (svc(ctx).schedule || []).slice(0, 5);
            const rows = items.map(it => {
                const sermon = it.sermon || (it.liturgy && it.liturgy.sermon) || 'TBA';
                return `<tr><td class="py-1 text-left truncate">${esc(shortDate(it.id))}</td><td class="py-1 text-center truncate">${esc(it.preacher || 'TBA')}</td><td class="py-1 text-right truncate">${esc(sermon)}</td></tr>`;
            }).join('');
            return `<table class="w-full text-[9.5pt] border-collapse table-fixed">
  <thead><tr class="border-b border-black"><th class="text-left py-1 font-normal w-1/3">Date</th><th class="text-center py-1 font-normal w-1/3">Preacher</th><th class="text-right py-1 font-normal w-1/3">Sermon Text</th></tr></thead>
  <tbody class="leading-relaxed">${rows}</tbody>
</table>`;
        },
    };

    // ── Input Components ───────────────────────────────────────────────────────

    // A bare `required` attr (no value, or anything but the string "false")
    // marks the Entry Field as needed weekly — drives generic tasks-remaining.
    function isRequired(attrs) {
        return !!attrs.required && attrs.required !== 'false';
    }

    const inputText = {
        tag: 'input-text', kind: 'input', surface: 'generator', label: 'Text',
        fields(attrs) { return [{ key: attrs.key, type: 'text', label: attrs.label || attrs.key, required: isRequired(attrs) }]; },
        render(ctx) { return esc(ctx.values[ctx.attrs.key] || ''); },
    };

    const inputRichtext = {
        tag: 'input-richtext', kind: 'input', surface: 'generator', label: 'Rich Text',
        fields(attrs) { return [{ key: attrs.key, type: 'richtext', label: attrs.label || attrs.key, required: isRequired(attrs) }]; },
        // Rich text is trusted HTML (TipTap/docx output) — emitted unescaped.
        render(ctx) { return ctx.values[ctx.attrs.key] || ''; },
    };

    const inputImage = {
        tag: 'input-image', kind: 'input', surface: 'generator', label: 'Image',
        fields(attrs) { return [{ key: attrs.key, type: 'image', label: attrs.label || attrs.key, required: isRequired(attrs) }]; },
        render(ctx) {
            const val = ctx.values[ctx.attrs.key];
            const cls = ctx.attrs.class || 'w-full h-full object-contain';
            if (val) return `<img src="${attrEsc(val)}" class="${attrEsc(cls)}" />`;
            const ph = ctx.attrs.placeholder || 'No Image';
            return `<div class="w-full h-full border border-dashed border-gray-200 flex items-center justify-center bg-transparent"><span class="text-[8pt] text-gray-400 italic text-center px-2">${esc(ph)}</span></div>`;
        },
    };

    // A repeating group of weekly entries. The value is an array; `render-as`
    // picks the print layout. Powers announcements, Mosaic Kids summary/questions
    // and pastoral-prayer prompts (ADR-0008 §3.1).
    const inputList = {
        tag: 'input-list', kind: 'input', surface: 'generator', label: 'List',
        fields(attrs) {
            return [{
                key: attrs.key, type: 'list', label: attrs.label || attrs.key,
                renderAs: attrs['render-as'] || 'bullets', required: isRequired(attrs),
            }];
        },
        render(ctx) {
            const items = ctx.values[ctx.attrs.key];
            const list = Array.isArray(items) ? items : [];
            const mode = ctx.attrs['render-as'] || 'bullets';
            const cls = ctx.attrs.class || '';
            if (mode === 'announcements') {
                return list
                    .map(it => `<div class="mb-2 last:mb-0 text-[10pt] leading-snug"><span class="font-bold">${esc((it.title || '') + (it.title ? ': ' : ''))}</span><span>${it.content || ''}</span></div>`)
                    .join('');
            }
            // bullets (default): array of strings or { text }
            const lis = list
                .map(it => `<li>${esc(typeof it === 'string' ? it : (it && it.text) || '')}</li>`)
                .join('');
            return `<ul class="${attrEsc(cls)}">${lis}</ul>`;
        },
    };

    // ── Builder section Components (ADR-0010) ──────────────────────────────────
    // Non-static Builder Components: present on a week only when the chosen Service
    // Guide Template places them. Each names the bespoke `section` the Order of
    // Service editor renders (Person pickers, prayer-request SMS controls) and
    // gates by template presence. In the booklet they are presence markers — the
    // page-template layout carries any visible content — so their render output is
    // minimal; their real job is to tell the Builder what to prompt.

    const baptismCandidates = {
        tag: 'baptism-candidates', kind: 'bound', surface: 'builder', section: 'baptism',
        label: 'Baptism Candidates',
        // Candidate names come from liturgy.baptism (the existing synced store,
        // ADR-0006) via serviceContext.baptismNames.
        render(ctx) { return esc(svc(ctx).baptismNames || ''); },
    };

    const pastoralPrayerSubjects = {
        tag: 'pastoral-prayer-subjects', kind: 'bound', surface: 'builder', section: 'pastoral-prayer-subjects',
        label: 'Pastoral Prayer Subjects',
        // The two prayed-for members + their prayer-request texts are informed in
        // the Builder; nothing extra prints here (the prayer page layout is
        // unchanged), so this renders empty.
        render() { return ''; },
    };

    const congregationalPrayer = {
        tag: 'congregational-prayer', kind: 'bound', surface: 'builder', section: 'congregational-prayer',
        label: 'Congregational Prayer',
        // The pastor-absent variant: carries no prompted fields and no specific
        // prayer subjects, so no prayer-request texts are sent. Presence marker.
        render() { return ''; },
    };

    // ── catalog assembly ──────────────────────────────────────────────────────
    const V1_COMPONENTS = [
        serviceDate, serviceTheme, keyVerseRef, keyVerseText, pastoralPrayerLabel,
        baptismNames, pastoralPrayerSubject, oosList, hymnSheet, schedule,
        inputText, inputRichtext, inputImage, inputList,
        baptismCandidates, pastoralPrayerSubjects, congregationalPrayer,
    ];

    // Build a catalog (the lookup the engine takes) from a list of Components.
    function makeCatalog(list) {
        const byTag = new Map();
        for (const c of list || []) byTag.set(c.tag, c);
        return {
            get(tag) { return byTag.get(String(tag || '').toLowerCase()); },
            all() { return Array.from(byTag.values()); },
            tags() { return Array.from(byTag.keys()); },
            // The palette the Manager shows, split by kind.
            palette() {
                return {
                    bound: this.all().filter(c => c.kind === 'bound').map(c => ({ tag: c.tag, label: c.label, multiPage: !!c.multiPage })),
                    input: this.all().filter(c => c.kind === 'input').map(c => ({ tag: c.tag, label: c.label })),
                };
            },
        };
    }

    const GuideComponents = {
        esc, attrEsc, shortDate, baptismNamesClass,
        V1_COMPONENTS,
        components: V1_COMPONENTS,
        makeCatalog,
        defaultCatalog: makeCatalog(V1_COMPONENTS),
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = GuideComponents;
    }
    if (global) {
        global.GuideComponents = GuideComponents;
    }
})(typeof window !== 'undefined' ? window : null);
