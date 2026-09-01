// TipTap JSON → a description of a Word document.
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
    //   { kind: 'paragraph', style, runs }
    //   { kind: 'listItem',  ordered, level, runs }
    //   { kind: 'table',     rows: [ { cells: [ { header, blocks } ] } ] }
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
                        runs: runsFromInline(node.content),
                    }
                    : {
                        kind: 'paragraph',
                        style: context.style || 'Normal',
                        runs: runsFromInline(node.content),
                    });
                return out;

            case 'heading': {
                const level = Math.min(Math.max(Number(attrs.level) || 1, 1), 6);
                out.push({
                    kind: 'paragraph',
                    style: HEADING_STYLES[level - 1],
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
        docxFileName,
        fontSizeToPoints,
        HEADING_STYLES,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DocumentDocxCore;
    }
    if (global) {
        global.DocumentDocxCore = DocumentDocxCore;
    }
})(typeof window !== 'undefined' ? window : null);
