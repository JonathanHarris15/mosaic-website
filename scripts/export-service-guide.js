/**
 * @fileoverview Export one week's Service Guide as a single self-contained HTML
 * file that can be handed to someone outside the church — no login, no network,
 * no Firebase. Everything (CSS, brand fonts, hymn sheets, maps, logos) is inlined
 * as data URIs, so the output is one file you can email or open from a USB stick.
 *
 * It is deliberately NOT a second renderer. It loads the week's FROZEN snapshot
 * (services/{date}.guide.snapshot) and runs the same pure pipeline the editor and
 * the print path run — GuideEngine.resolveGuide over the real Component catalog —
 * so what exports is byte-for-byte what the app previews (ADR-0008 §4). The only
 * things this file owns are the Node port of the browser-only serviceContext
 * resolver (guide-store's version needs the compat `firebase` global) and the
 * asset inlining.
 *
 * Usage:
 *   node scripts/export-service-guide.js [YYYY-MM-DD] [out.html]
 *
 * Defaults to the most recent past Sunday that has a v2 guide, writing to
 * examples/ (gitignored — these exports carry embedded imagery and are big).
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const SERVICE_ACCOUNT_FILE = 'mosaic-hymn-database-firebase-adminsdk-fbsvc-e5b20d0279.json';
const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';

// Same key the browser generator ships with (public/service-guide-editor.js);
// the key verse text is fetched fresh rather than stored on the Service.
const ESV_API_KEY = process.env.ESV_API_KEY || '3ca8c306dfdefdc42598bb88a037361a0f44cb0b';

const DateUtils = require(path.join(PUBLIC, 'date-utils.js'));
const GuideEngine = require(path.join(PUBLIC, 'guide-engine.js'));
const GuideComponents = require(path.join(PUBLIC, 'guide-components.js'));
const GuideStore = require(path.join(PUBLIC, 'guide-store.js'));

// Components read the resolved context through these globals in the browser.
globalThis.DateUtils = DateUtils;
globalThis.GuideComponents = GuideComponents;

admin.initializeApp({
    credential: admin.credential.cert(require(path.join(ROOT, SERVICE_ACCOUNT_FILE))),
    projectId: FIREBASE_PROJECT_ID,
});
const db = admin.firestore();

const HYMN_FIELDS = ['preparatoryHymn', 'hymn1', 'hymn2', 'hymnMid1', 'hymnMid2', 'hymnEnd1', 'hymnEnd2'];

// ── serviceContext (Node port of GuideStore.resolveServiceContext) ────────────
// Same shape, same field names; only the Firestore calls differ (admin SDK vs the
// compat browser SDK). Keep in step with the original if that one changes.

function addDaysStr(dateStr, n) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

async function getESVPlainText(reference) {
    const url = `https://api.esv.org/v3/passage/text/?q=${encodeURIComponent(reference)}` +
        '&include-passage-references=false&include-verse-numbers=false&include-first-verse-numbers=false' +
        '&include-footnotes=false&include-headings=false&include-short-copyright=false';
    try {
        const res = await fetch(url, { headers: { Authorization: `Token ${ESV_API_KEY}` } });
        const data = await res.json();
        return ((data.passages && data.passages[0]) || '').trim();
    } catch (e) {
        console.warn('  ! ESV lookup failed for', reference, '-', e.message);
        return '';
    }
}

async function resolveServiceContext(date) {
    const doc = await db.collection('services').doc(date).get();
    const data = GuideStore.normalizeServiceData(doc.exists ? doc.data() : {});
    const liturgy = data.liturgy || {};

    const hymnsByField = {};
    for (const f of HYMN_FIELDS) {
        const h = liturgy[f];
        if (!h || !h.name) continue;
        const entry = { name: h.name, id: h.id || null, pages: [], attribution: '' };
        if (h.id) {
            const hd = await db.collection('hymns').doc(h.id).get();
            if (hd.exists) {
                const d = hd.data();
                entry.pages = (d.versions && d.versions[0] && d.versions[0].pages) || [];
                entry.attribution = d.attribution || '';
                entry.name = d.hymn_name || h.name;
            }
        }
        hymnsByField[f] = entry;
    }

    let schedule = [];
    try {
        const snap = await db.collection('services')
            .where(admin.firestore.FieldPath.documentId(), '>=', date)
            .where(admin.firestore.FieldPath.documentId(), '<=', addDaysStr(date, 35))
            .get();
        schedule = snap.docs
            .map(d => {
                const sd = GuideStore.normalizeServiceData(d.data());
                return { id: d.id, preacher: sd.preacher || '', sermon: (sd.liturgy && sd.liturgy.sermon) || '' };
            })
            .sort((a, b) => a.id.localeCompare(b.id));
    } catch (e) {
        console.warn('  ! schedule lookup failed -', e.message);
    }

    const keyVerseText = data.keyVerse ? await getESVPlainText(data.keyVerse) : '';

    return {
        context: {
            date,
            longDate: DateUtils.formatDateLong(date),
            shortDate: GuideComponents.shortDate(date),
            theme: data.theme || '',
            keyVerse: data.keyVerse || '',
            keyVerseText,
            preacher: data.preacher || '',
            musicLeader: data.musicLeader || '',
            serviceLeader: data.serviceLeader || '',
            hasBaptism: !!data.hasBaptism,
            removedHymns: Array.isArray(data.removedHymns) ? data.removedHymns : [],
            baptismNames: GuideStore.baptismNamesOf(liturgy),
            liturgy,
            hymnsByField,
            schedule,
        },
        service: data,
    };
}

// ── asset inlining ────────────────────────────────────────────────────────────
// Every <img src> in the rendered pages becomes a data URI: repo-relative paths
// read off disk, https URLs (hymn sheets in Firebase Storage) fetched once and
// cached. Anything already a data URI (e.g. the uploaded country map) is left be.

const MIME = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

const assetCache = new Map();

// Components emit src through attrEsc, so a Storage URL arrives here with its
// query separators as &amp; — fetching that literally drops the `token` param and
// Storage answers 403. Undo the attribute escaping before the request.
function unescapeAttr(s) {
    return String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"');
}

async function toDataUri(src) {
    if (assetCache.has(src)) return assetCache.get(src);
    let uri = src;
    try {
        if (/^https?:\/\//i.test(src)) {
            const res = await fetch(unescapeAttr(src));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const type = (res.headers.get('content-type') || 'image/png').split(';')[0];
            const buf = Buffer.from(await res.arrayBuffer());
            uri = `data:${type};base64,${buf.toString('base64')}`;
        } else {
            const file = path.join(PUBLIC, src.replace(/^\.?\//, ''));
            const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
            uri = `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
        }
        console.log(`  inlined ${(uri.length / 1024).toFixed(0).padStart(5)}KB  ${src.slice(0, 72)}`);
    } catch (e) {
        console.warn('  ! could not inline', src.slice(0, 72), '-', e.message);
    }
    assetCache.set(src, uri);
    return uri;
}

// Rewrite every src="…" in `html` through toDataUri. Sequential on purpose: the
// cache means each distinct asset is fetched exactly once.
async function inlineImages(html) {
    const srcs = new Set();
    const re = /src="([^"]+)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        if (!/^data:/i.test(m[1])) srcs.add(m[1]);
    }
    for (const src of srcs) await toDataUri(src);
    return html.replace(/src="([^"]+)"/g, (whole, src) =>
        /^data:/i.test(src) ? whole : `src="${assetCache.get(src) || src}"`);
}

// The brand fonts the designed booklet's Style Preset asks for, latin subset only
// (fonts.css also carries cyrillic/greek/vietnamese cuts and other families —
// ~3.3MB of woff2 we would otherwise embed for nothing).
const BRAND_FONTS = ['Cinzel', 'EB Garamond', 'Libre Franklin', 'UnifrakturCook', 'PT Serif'];

function inlineFontFaces() {
    const css = fs.readFileSync(path.join(PUBLIC, 'fonts.css'), 'utf8');
    const out = [];
    let kept = 0;
    for (const block of css.split('@font-face').slice(1)) {
        const body = block.slice(0, block.indexOf('}') + 1);
        const family = (body.match(/font-family: '([^']+)'/) || [])[1];
        if (!BRAND_FONTS.includes(family)) continue;
        const range = (body.match(/unicode-range: ([^;]+);/) || [])[1];
        if (range && !/U\+0000-00FF/.test(range)) continue; // non-latin cut
        const url = (body.match(/url\(([^)]+)\)/) || [])[1];
        if (!url) continue;
        const file = path.join(PUBLIC, url);
        if (!fs.existsSync(file)) continue;
        const b64 = fs.readFileSync(file).toString('base64');
        out.push('@font-face' + body.replace(/url\([^)]+\)/, `url(data:font/woff2;base64,${b64})`));
        kept++;
    }
    console.log(`  inlined ${kept} brand font faces (${(out.join('').length / 1024 / 1024).toFixed(1)}MB base64)`);
    return out.join('\n');
}

// ── page frame ────────────────────────────────────────────────────────────────
// The .preview-page rules are lifted from service-guide-editor.html so an
// exported page is framed exactly like the on-screen preview: a 5.5x8.5in sheet,
// 0.2in padding, Times 10pt — the base the Style Presets then override.

const PAGE_FRAME_CSS = `
.preview-page {
    position: relative; overflow: hidden; background: #fff; color: #000;
    width: 5.5in; height: 8.5in; padding: 0.2in; box-sizing: border-box;
    font-family: 'Times New Roman', Times, serif; font-size: 10pt; line-height: 1.2;
    margin: 0 auto 2rem; box-shadow: 0 18px 48px rgba(14,28,54,.14);
}
.latex-h1 { display: block; font-size: 1.1rem; font-weight: 400; }
.latex-hr { margin-top: .25rem; margin-bottom: .25rem; width: 100%; border-top: 1px solid #000; }
.latex-spacing-2 { line-height: 2.2; }
.preview-page ul, .preview-page ol { list-style-type: disc !important; padding-left: 2rem; }
`;

const SHELL_CSS = `
:root { color-scheme: light; }
body { margin: 0; background: #e9ecf1; font-family: 'Libre Franklin', -apple-system, 'Segoe UI', sans-serif; color: #182F57; }
.export-head { max-width: 5.5in; margin: 0 auto; padding: 3rem 0 2rem; text-align: center; }
.export-head h1 { font-family: 'Cinzel', serif; font-size: 22px; font-weight: 600; letter-spacing: .03em; margin: 0; }
.export-head p { margin: .5rem 0 0; font-size: 12px; color: #5E6B82; }
.export-head .meta { margin-top: 1rem; font-size: 10px; letter-spacing: .18em; text-transform: uppercase; color: #8A93A6; }
.sheets { padding-bottom: 4rem; }
@media print {
    @page { size: 5.5in 8.5in; margin: 0; }
    body { background: #fff; }
    .no-print { display: none !important; }
    .sheets { padding: 0; }
    .preview-page { margin: 0; box-shadow: none; page-break-after: always; }
}
`;

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── main ──────────────────────────────────────────────────────────────────────

// The most recent Sunday at-or-before today that carries a v2 guide.
async function latestV2Date() {
    const snap = await db.collection('services')
        .where(admin.firestore.FieldPath.documentId(), '<=', DateUtils.todayStr())
        .get();
    const dates = snap.docs
        .filter(d => GuideStore.isV2Guide((d.data() || {}).guide))
        .map(d => d.id)
        .sort();
    return dates[dates.length - 1] || null;
}

async function main() {
    const date = process.argv[2] || await latestV2Date();
    if (!date) throw new Error('No week with a v2 Service Guide found.');

    const doc = await db.collection('services').doc(date).get();
    if (!doc.exists) throw new Error(`No Service for ${date}.`);
    const service = GuideStore.normalizeServiceData(doc.data());
    const guide = service.guide;
    if (!GuideStore.isV2Guide(guide)) {
        throw new Error(`${date} is on the legacy guide format — export needs a template-system week.`);
    }

    console.log(`Exporting ${date} — "${service.theme || '(no theme)'}"`);

    // The week's own frozen snapshot, so the export shows the template as it was
    // applied that Sunday rather than as the Manager has it today.
    const snapshot = guide.snapshot;
    const values = guide.values || {};
    const { context } = await resolveServiceContext(date);

    const tmplDoc = await db.collection(GuideStore.COLLECTIONS.guideTemplates).doc(guide.guideTemplateId).get();
    const templateName = (tmplDoc.exists && tmplDoc.data().name) || guide.guideTemplateId;

    const resolved = GuideEngine.resolveGuide(snapshot, values, context, GuideComponents.defaultCatalog);
    console.log(`  ${resolved.total} pages (${resolved.realCount} content + ${resolved.fillerCount} filler)`);

    // Style Preset + per-page CSS, deduped in first-seen order (mirrors the
    // editor's #guide-dynamic-style assembly).
    let guideCss = '';
    const seen = new Set();
    for (const p of resolved.pages) {
        for (const chunk of [p.stylePresetCss, p.css]) {
            if (chunk && !seen.has(chunk)) { seen.add(chunk); guideCss += chunk + '\n'; }
        }
    }

    const sheets = resolved.pages.map((page, i) => {
        const num = GuideEngine.pageNumber(i, resolved.pages.length, resolved.numberStartPage);
        const folio = num
            ? `<div style="position:absolute; bottom:1rem; ${num.side}:1.5rem; font-size:10pt; font-family:'EB Garamond',Georgia,serif; user-select:none;">${num.number}</div>`
            : '';
        return `<div class="preview-page">${folio}<div class="h-full" style="height:100%;">${page.html}</div></div>`;
    }).join('\n');

    console.log('Inlining assets…');
    const inlinedSheets = await inlineImages(sheets);
    const fontCss = inlineFontFaces();

    // mosaic.css (the built Tailwind) is what the editor loads; a handful of
    // Component renders still emit utility classes (input-image's object-contain,
    // the announcements list), so the export needs it for a faithful match.
    const tailwind = fs.readFileSync(path.join(PUBLIC, 'mosaic.css'), 'utf8');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(service.theme || 'Service Guide')} — Mosaic Church, ${esc(context.longDate)}</title>
<style>${fontCss}</style>
<style>${tailwind}</style>
<style>${PAGE_FRAME_CSS}</style>
<style>${SHELL_CSS}</style>
<style>${guideCss}</style>
</head>
<body>
<header class="export-head no-print">
    <h1>${esc(service.theme || 'Service Guide')}</h1>
    <p>Mosaic Church College Station &middot; ${esc(context.longDate)}</p>
    <div class="meta">${esc(templateName)} &middot; ${resolved.total} pages</div>
</header>
<div class="sheets">
${inlinedSheets}
</div>
</body>
</html>`;

    const outArg = process.argv[3];
    const out = outArg
        ? path.resolve(outArg)
        : path.join(ROOT, 'examples', `service-guide-${date}.html`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html, 'utf8');
    console.log(`\nWrote ${out}\n      ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)}MB, self-contained.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
