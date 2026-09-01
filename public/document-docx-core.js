// The .docx edge of a document, in both directions.
//
// THE HALF OF .docx EXPORT THAT IS WORTH TESTING. Writing an actual .docx means
// zipping a dozen XML parts, and the `docx` library does that correctly and we
// are not going to relearn it. But the part that gets things WRONG is not the
// zipping — it is the walk: which marks survive, how a nested list keeps its
// level, what a table cell may contain, what happens to a Cross-Reference.
//
// So the walk lives here, pure, and hands back plain data. `document-docx.js`
// turns that data into the library's objects and asks it for a Blob. This
// module never imports the library, never touches the DOM, and is the exact
// mirror of `tiptap-render.js` — the same switch over the same node types, with
// Word on the other end instead of HTML. When the editor learns a new node,
// BOTH files need the case, and the tests here are what says so.
//
// The node and mark set is not guesswork: it is what `build/tiptap/entry.js`
// bundles — StarterKit, Underline, Mention, TextStyle, FontFamily, FontSize,
// Highlight, and the four Table extensions.
//
// Loaded as a classic <script> (window.DocumentDocxCore) and exported for Node.

(function (global) {
    'use strict';

    // ── What comes out ────────────────────────────────────────────────────────
    //
    // A flat list of blocks. Flat matters: Word has no nested-list NODE, it has
    // paragraphs that each carry a level, so flattening here is not a
    // simplification — it is the shape Word actually wants.
    //
    //   { kind: 'paragraph', style, align, runs }
    //   { kind: 'listItem',  ordered, level, align, runs }
    //   { kind: 'table',     rows: [ { cells: [ { header, blocks } ] } ] }
    //   { kind: 'image',     mime, base64, alt }
    //   { kind: 'rule' }
    //
    // A run is one stretch of text with one set of marks:
    //
    //   { text, bold, italic, underline, strike, code, highlight,
    //     sizePt, font, link, mention }
    //
    // …or { break: true } for a hard break, which Word models as a run too.

    const HEADING_STYLES = ['Heading1', 'Heading2', 'Heading3',
                            'Heading4', 'Heading5', 'Heading6'];

    // TextAlign writes a CSS value onto the paragraph. Word has the same four,
    // under different names, and 'left' is the default — emitting it explicitly
    // would override a document whose own default is something else, so it is
    // dropped rather than restated.
    const ALIGNMENTS = { left: null, center: 'center', right: 'right', justify: 'justify' };

    function alignmentOf(attrs) {
        const value = String((attrs && attrs.textAlign) || '').toLowerCase();
        return Object.prototype.hasOwnProperty.call(ALIGNMENTS, value) ? ALIGNMENTS[value] : null;
    }

    function emptyRun() {
        return {
            text: '', bold: false, italic: false, underline: false,
            strike: false, code: false, highlight: null,
            sizePt: null, font: null, link: null, mention: false,
        };
    }

    // ── A size Word understands ───────────────────────────────────────────────
    //
    // The editor's FontSize extension stores CSS — '14px', '1.2em', '11pt'.
    // Word measures in points and nothing else. Pixels convert at the CSS
    // constant of 96dpi against 72 points to the inch; anything relative (em,
    // %, rem) has no fixed answer without knowing what it is relative to, so it
    // is dropped rather than guessed at.
    function fontSizeToPoints(cssSize) {
        const match = /^\s*(\d+(?:\.\d+)?)\s*(px|pt)?\s*$/i.exec(String(cssSize || ''));
        if (!match) return null;
        const value = Number(match[1]);
        if (!isFinite(value) || value <= 0) return null;
        const unit = (match[2] || 'px').toLowerCase();
        const points = unit === 'pt' ? value : value * 0.75;
        // Word's unit is the half-point, so a fraction finer than 0.5pt cannot
        // be expressed anyway.
        return Math.round(points * 2) / 2;
    }

    // ── One stretch of text, with whatever is true of it ──────────────────────

    function runFromText(node) {
        const run = emptyRun();
        run.text = String(node.text == null ? '' : node.text);

        (node.marks || []).forEach(mark => {
            const attrs = mark.attrs || {};
            switch (mark.type) {
                case 'bold': run.bold = true; break;
                case 'italic': run.italic = true; break;
                case 'underline': run.underline = true; break;
                case 'strike': run.strike = true; break;
                case 'code': run.code = true; break;
                case 'link': run.link = attrs.href || null; break;
                case 'highlight':
                    // The editor's default pen when a highlight carries no
                    // colour of its own — same fallback tiptap-render.js uses,
                    // and the two must not drift.
                    run.highlight = attrs.color || '#fef08a';
                    break;
                case 'textStyle':
                    if (attrs.fontSize) run.sizePt = fontSizeToPoints(attrs.fontSize);
                    if (attrs.fontFamily) run.font = attrs.fontFamily;
                    break;
                default: break;
            }
        });
        return run;
    }

    // ── A Cross-Reference, once it is in Word ─────────────────────────────────
    //
    // An @-mention is a link to a page in this app. In a Word file that page is
    // unreachable — the reader may not even be signed in — so it keeps the one
    // thing that still means something: the name it was written as. Bold, so it
    // still reads as a reference rather than as stray text.
    function runFromMention(node) {
        const run = emptyRun();
        run.text = '@' + String((node.attrs && node.attrs.label) || '?');
        run.bold = true;
        run.mention = true;
        return run;
    }

    function runsFromInline(nodes) {
        const runs = [];
        (nodes || []).forEach(node => {
            if (!node) return;
            if (node.type === 'text') { runs.push(runFromText(node)); return; }
            if (node.type === 'mention') { runs.push(runFromMention(node)); return; }
            if (node.type === 'hardBreak') { runs.push({ break: true }); return; }
            // An inline node nobody taught this about still has its text
            // somewhere underneath. Losing formatting beats losing words.
            if (node.content) runs.push.apply(runs, runsFromInline(node.content));
        });
        return runs;
    }

    // ── The walk ──────────────────────────────────────────────────────────────

    function blocksFromNodes(nodes, context, out) {
        (nodes || []).forEach(node => blocksFromNode(node, context, out));
        return out;
    }

    function blocksFromNode(node, context, out) {
        if (!node) return out;
        const attrs = node.attrs || {};

        switch (node.type) {

            case 'paragraph':
                // A paragraph inside a list item IS the list item's text. The
                // context carries that, so the same case serves both.
                out.push(context.list
                    ? {
                        kind: 'listItem',
                        ordered: context.list.ordered,
                        level: context.list.level,
                        align: alignmentOf(attrs),
                        runs: runsFromInline(node.content),
                    }
                    : {
                        kind: 'paragraph',
                        style: context.style || 'Normal',
                        align: alignmentOf(attrs),
                        runs: runsFromInline(node.content),
                    });
                return out;

            case 'heading': {
                const level = Math.min(Math.max(Number(attrs.level) || 1, 1), 6);
                out.push({
                    kind: 'paragraph',
                    style: HEADING_STYLES[level - 1],
                    align: alignmentOf(attrs),
                    runs: runsFromInline(node.content),
                });
                return out;
            }

            case 'blockquote':
                // Quote is a paragraph style in Word, not a container, so the
                // quote itself disappears and its paragraphs carry the style.
                return blocksFromNodes(node.content,
                    Object.assign({}, context, { style: 'Quote' }), out);

            case 'codeBlock':
                out.push({
                    kind: 'paragraph',
                    style: 'Code',
                    runs: runsFromInline(node.content),
                });
                return out;

            case 'bulletList':
            case 'orderedList': {
                const ordered = node.type === 'orderedList';
                // A list nested inside a list item is one level deeper. A list
                // at the top of the document is level 0.
                const level = context.list ? context.list.level + 1 : 0;
                return blocksFromNodes(node.content,
                    Object.assign({}, context, { list: { ordered: ordered, level: level } }), out);
            }

            case 'listItem':
                return blocksFromNodes(node.content, context, out);

            case 'image': {
                // Only a data: URI can go into a Word file. A picture held at a
                // URL would need fetching, and a .docx carrying a link to one
                // shows a broken frame to anyone reading it offline — which is
                // most people, most of the time, with a document they were
                // emailed.
                const parsed = parseDataUri(attrs.src);
                if (parsed) {
                    out.push({
                        kind: 'image',
                        mime: parsed.mime,
                        base64: parsed.base64,
                        alt: String(attrs.alt || ''),
                    });
                } else if (attrs.src) {
                    out.push({
                        kind: 'paragraph',
                        style: 'Normal',
                        align: null,
                        runs: [Object.assign(emptyRun(), {
                            text: '[' + (attrs.alt || 'Picture') + ']',
                            italic: true,
                        })],
                    });
                }
                return out;
            }

            case 'horizontalRule':
                out.push({ kind: 'rule' });
                return out;

            case 'table': {
                const rows = [];
                (node.content || []).forEach(row => {
                    if (!row || row.type !== 'tableRow') return;
                    const cells = [];
                    (row.content || []).forEach(cell => {
                        if (!cell) return;
                        cells.push({
                            header: cell.type === 'tableHeader',
                            // A cell holds paragraphs, and may hold a list or
                            // another table. It never inherits the list context
                            // it was reached through.
                            blocks: blocksFromNodes(cell.content, { style: 'Normal' }, []),
                        });
                    });
                    rows.push({ cells: cells });
                });
                out.push({ kind: 'table', rows: rows });
                return out;
            }

            // ── A Person Panel (ADR-0004) ────────────────────────────────────
            //
            // Its body is NOT in this document — the panel is an atom holding
            // only metadata, and the Note Body lives on the Shepherding Note in
            // Firestore. So the walk cannot reach it, and a caller who wants it
            // in the Word file has to have fetched it and passed it in.
            //
            // When it has not, the panel still becomes a heading with the
            // person's name, and says plainly that the note is not included.
            // Silently exporting an empty panel is how somebody sends out
            // minutes with a person's section missing and never notices.
            case 'personPanel': {
                const name = String(attrs.personName || 'Person');
                out.push({
                    kind: 'paragraph',
                    style: 'Heading3',
                    runs: [Object.assign(emptyRun(), { text: name })],
                });
                const body = context.panelBodies && attrs.noteId
                    ? context.panelBodies[attrs.noteId]
                    : null;
                if (body && body.content) {
                    blocksFromNodes(body.content,
                        Object.assign({}, context, { list: null, style: 'Normal' }), out);
                } else {
                    out.push({
                        kind: 'paragraph',
                        style: 'Normal',
                        runs: [Object.assign(emptyRun(), {
                            text: '(This note is kept on ' + name + "'s profile and is not included here.)",
                            italic: true,
                        })],
                    });
                }
                return out;
            }

            default:
                // Anything unrecognised is walked THROUGH rather than dropped.
                // A node this file has not met yet still has words under it.
                if (node.content) return blocksFromNodes(node.content, context, out);
                if (node.text) {
                    out.push({
                        kind: 'paragraph',
                        style: context.style || 'Normal',
                        runs: [Object.assign(emptyRun(), { text: String(node.text) })],
                    });
                }
                return out;
        }
    }

    // ── The one entry point ───────────────────────────────────────────────────
    //
    // `options.panelBodies` maps a Shepherding Note id to that note's TipTap
    // JSON, for a caller that has already read them. Everything else about this
    // function is a pure walk of what it was given.
    function docxBlocksFromTiptap(doc, options) {
        const opts = options || {};
        if (!doc || !doc.content) return [];
        return blocksFromNodes(doc.content, {
            style: 'Normal',
            list: null,
            panelBodies: opts.panelBodies || null,
        }, []);
    }

    // ── A picture, and how big it is ──────────────────────────────────────────
    //
    // Mammoth turns a picture in a Word file into a data: URI, and the Image
    // extension keeps it as one. Getting it back INTO a Word file needs two
    // things the URI does not say out loud: the bytes, and how big they are.
    //
    // Splitting the URI is pure string work and lives here. Turning the base64
    // into bytes is not the same job in a browser (atob) as in Node (Buffer),
    // so each side does that itself and hands the bytes back for measuring.
    function parseDataUri(uri) {
        // Images only. This is only ever asked about a picture, and a data URI
        // holding markup has no business reaching the block list at all — even
        // though the writer downstream would refuse it anyway.
        const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i
            .exec(String(uri == null ? '' : uri).trim());
        if (!match) return null;
        return { mime: match[1].toLowerCase(), base64: match[2].replace(/\s+/g, '') };
    }

    // How big the picture is, read from its own header rather than guessed at.
    // Word needs a size in points for every image and will not work one out; a
    // wrong one is a picture squashed to a stamp or spilling off the page.
    //
    // PNG says so at a fixed offset. GIF says so at a fixed offset, the other
    // way round. JPEG has to be walked segment by segment until a start-of-frame
    // marker, because everything before it is metadata of unknown length.
    function imageSizeFromBytes(bytes) {
        if (!bytes || bytes.length < 24) return null;
        const at = i => bytes[i];
        const be16 = i => (at(i) << 8) | at(i + 1);
        const be32 = i => ((at(i) << 24) >>> 0) + (at(i + 1) << 16) + (at(i + 2) << 8) + at(i + 3);

        // PNG: 8-byte signature, then IHDR with width and height big-endian.
        if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
            return { width: be32(16), height: be32(20) };
        }
        // GIF: 'GIF8', then width and height LITTLE-endian at byte 6.
        if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) {
            return { width: at(6) | (at(7) << 8), height: at(8) | (at(9) << 8) };
        }
        // JPEG: walk the segments. 0xFFD8 starts the file; each marker after it
        // carries its own length, and the frame markers (0xC0–0xCF, minus the
        // four that are not frames) carry the size.
        if (at(0) === 0xff && at(1) === 0xd8) {
            let i = 2;
            while (i + 9 < bytes.length) {
                if (at(i) !== 0xff) { i++; continue; }
                const marker = at(i + 1);
                if (marker >= 0xc0 && marker <= 0xcf &&
                    marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                    return { height: be16(i + 5), width: be16(i + 7) };
                }
                i += 2 + be16(i + 2);
            }
        }
        return null;
    }

    // A picture the size of a page is a picture nobody meant to send. Word
    // measures in points; this is the widest a picture may be before it is
    // scaled down, keeping its shape.
    const MAX_IMAGE_WIDTH_PT = 450;

    function fitImage(size) {
        if (!size || !size.width || !size.height) {
            // Nothing said how big it is. A square that reads as "a picture"
            // beats leaving it out of the document altogether.
            return { width: 200, height: 200 };
        }
        // Pixels at 96dpi into points at 72.
        const width = size.width * 0.75;
        const height = size.height * 0.75;
        if (width <= MAX_IMAGE_WIDTH_PT) {
            return { width: Math.round(width), height: Math.round(height) };
        }
        const scale = MAX_IMAGE_WIDTH_PT / width;
        return { width: Math.round(width * scale), height: Math.round(height * scale) };
    }

    // ── Coming the other way: a Word file, made safe to put in a page ─────────
    //
    // mammoth turns a .docx into HTML, and that HTML gets written straight into
    // the DOM — into the editor on import, into the viewer on the Files tab.
    // Everything mammoth normally produces is a paragraph, a heading, a list or
    // a table, but a Word hyperlink carries whatever address it was given, and
    // Word can be made to carry `javascript:`. Only an editor can put a file
    // into either place, so this is a low door rather than a locked one — it
    // still costs nothing to shut.
    //
    // One copy, deliberately. This used to live in `event-attachments-core.js`
    // as well; two copies of a security filter is how one gets fixed and the
    // other does not.
    function sanitizeDocxHtml(html) {
        return String(html == null ? '' : html)
            .replace(/<\s*(script|iframe|object|embed|link|style)\b[\s\S]*?(?:<\s*\/\s*\1\s*>|$)/gi, '')
            .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
            .replace(/((?:href|src|xlink:href)\s*=\s*)(["'])\s*javascript:[^"']*\2/gi, '$1$2#$2');
    }

    // ── A filename somebody can find again ────────────────────────────────────
    //
    // Windows refuses \ / : * ? " < > | in a filename outright, and a name that
    // is only punctuation is worse than a dull one.
    function docxFileName(title) {
        const cleaned = String(title == null ? '' : title)
            .replace(/[\\/:*?"<>|]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 120);
        return (cleaned || 'Document') + '.docx';
    }

    const DocumentDocxCore = {
        docxBlocksFromTiptap,
        sanitizeDocxHtml,
        docxFileName,
        fontSizeToPoints,
        parseDataUri,
        imageSizeFromBytes,
        fitImage,
        MAX_IMAGE_WIDTH_PT,
        HEADING_STYLES,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DocumentDocxCore;
    }
    if (global) {
        global.DocumentDocxCore = DocumentDocxCore;
    }
})(typeof window !== 'undefined' ? window : null);
