// The browser edge of .docx, both ways: turning the description that
// `document-docx-core.js` produced into the `docx` library's own objects, and
// asking it for a file.
//
// Kept deliberately thin. Every decision about WHAT goes in the Word file was
// already made and tested in the core; everything here is "which constructor
// says that". If a rule about the document's shape starts creeping in here, it
// belongs one file over, where it can be tested without a 1.1MB library.
//
// `buildWordDocument` takes the library as an argument rather than reaching for
// a global, so a test can hand it the vendored bundle and read the .docx that
// comes out.
//
// Loaded as a classic <script> (window.DocumentDocx) and exported for Node.

(function (global) {
    'use strict';

    const Core = (typeof require === 'function' && typeof module !== 'undefined')
        ? require('./document-docx-core.js')
        : (global && global.DocumentDocxCore);

    // Where the library lives, and the promise that it is here. 1.1MB of Word
    // format knowledge is not worth loading into a page nobody will export
    // from, so it arrives on the first click and never again.
    const DOCX_LIBRARY_SRC = 'vendor/docx-9.7.1.iife.js';
    // The same converter the Service Guide and the Files viewer already use.
    const MAMMOTH_SRC = 'vendor/mammoth-1.6.0.browser.min.js';

    const loading = {};

    // Neither library belongs in a page head: one is 1.1MB and writes Word
    // files, the other is 350KB and reads them, and most visits to a document
    // do neither. They arrive on the first click and never again.
    function loadLibraryOnce(src, globalName) {
        if (global && global[globalName]) return Promise.resolve(global[globalName]);
        if (loading[src]) return loading[src];
        loading[src] = new Promise(function (resolve, reject) {
            const el = document.createElement('script');
            el.src = src;
            el.onload = function () {
                if (global && global[globalName]) resolve(global[globalName]);
                else reject(new Error(src + ' loaded but defined nothing'));
            };
            el.onerror = function () {
                delete loading[src];
                reject(new Error('could not load ' + src));
            };
            document.head.appendChild(el);
        });
        return loading[src];
    }

    function loadDocxLibrary() {
        return loadLibraryOnce(DOCX_LIBRARY_SRC, 'docx');
    }

    // ── Numbering ─────────────────────────────────────────────────────────────
    //
    // Word does not carry a list as a container the way HTML does. A list item
    // is a paragraph that points at a numbering definition and says which level
    // it sits at — so the definitions have to exist on the document before any
    // paragraph can refer to them. Five levels is deeper than anyone nests a
    // rota, and costs nothing to declare.
    const BULLET_REFERENCE = 'mosaic-bullet';
    const NUMBER_REFERENCE = 'mosaic-number';
    const LIST_LEVELS = 5;
    const BULLETS = ['•', '◦', '▪', '•', '◦'];

    function indentForLevel(level) {
        return { left: 720 * (level + 1), hanging: 360 };
    }

    function numberingConfig(lib) {
        const levels = [];
        for (let level = 0; level < LIST_LEVELS; level++) {
            levels.push({
                level: level,
                format: lib.LevelFormat.BULLET,
                text: BULLETS[level] || '•',
                alignment: lib.AlignmentType.LEFT,
                style: { paragraph: { indent: indentForLevel(level) } },
            });
        }
        const numbered = [];
        for (let level = 0; level < LIST_LEVELS; level++) {
            numbered.push({
                level: level,
                // A nested number restarts at 1 under its parent, which is what
                // '%n.' means — the nth counter, not the whole trail.
                format: lib.LevelFormat.DECIMAL,
                text: '%' + (level + 1) + '.',
                alignment: lib.AlignmentType.LEFT,
                style: { paragraph: { indent: indentForLevel(level) } },
            });
        }
        return {
            config: [
                { reference: BULLET_REFERENCE, levels: levels },
                { reference: NUMBER_REFERENCE, levels: numbered },
            ],
        };
    }

    // ── Runs ──────────────────────────────────────────────────────────────────

    // Word writes colour as six hex digits with no hash.
    function hexOnly(colour) {
        const match = /^#?([0-9a-f]{6})$/i.exec(String(colour || ''));
        return match ? match[1].toUpperCase() : null;
    }

    function textRun(lib, run, inherited) {
        if (run.break) return new lib.TextRun({ break: 1 });

        const fill = hexOnly(run.highlight);
        const options = {
            text: run.text,
            bold: run.bold || undefined,
            italics: (run.italic || (inherited && inherited.italic)) || undefined,
            strike: run.strike || undefined,
            // The library wants an object here, not a boolean — an empty one
            // means "a plain single underline".
            underline: run.underline ? {} : undefined,
            // Word measures text in HALF points.
            size: run.sizePt ? Math.round(run.sizePt * 2) : undefined,
            font: run.code ? 'Courier New' : (run.font || undefined),
            shading: fill ? { type: lib.ShadingType.CLEAR, color: 'auto', fill: fill } : undefined,
        };

        if (!run.link) return new lib.TextRun(options);

        // A link is a run wrapped in the thing that makes it clickable, and it
        // takes Word's own Hyperlink style so it looks like one.
        return new lib.ExternalHyperlink({
            children: [new lib.TextRun(Object.assign({}, options, { style: 'Hyperlink' }))],
            link: run.link,
        });
    }

    function runsFor(lib, runs, inherited) {
        return (runs || []).map(function (run) { return textRun(lib, run, inherited); });
    }

    // ── Blocks ────────────────────────────────────────────────────────────────

    const HEADING_FOR_STYLE = {
        Heading1: 'HEADING_1', Heading2: 'HEADING_2', Heading3: 'HEADING_3',
        Heading4: 'HEADING_4', Heading5: 'HEADING_5', Heading6: 'HEADING_6',
    };

    function paragraphFor(lib, block) {
        const heading = HEADING_FOR_STYLE[block.style];
        const options = { children: runsFor(lib, block.runs, { italic: block.style === 'Quote' }) };

        if (heading) options.heading = lib.HeadingLevel[heading];
        // Word has no reliable built-in Quote style to lean on across versions,
        // so a quote is what a quote looks like: indented, and italic (applied
        // to the runs above).
        if (block.style === 'Quote') options.indent = { left: 720 };
        return new lib.Paragraph(options);
    }

    function listParagraphFor(lib, block) {
        return new lib.Paragraph({
            numbering: {
                reference: block.ordered ? NUMBER_REFERENCE : BULLET_REFERENCE,
                level: Math.min(Math.max(block.level || 0, 0), LIST_LEVELS - 1),
            },
            children: runsFor(lib, block.runs),
        });
    }

    function ruleParagraphFor(lib) {
        return new lib.Paragraph({
            children: [],
            border: {
                bottom: { style: lib.BorderStyle.SINGLE, size: 6, color: 'auto', space: 1 },
            },
        });
    }

    function tableFor(lib, block) {
        const rows = (block.rows || []).map(function (row) {
            const cells = (row.cells || []).map(function (cell) {
                // Word rejects an empty cell — it must hold at least one
                // paragraph, even a blank one.
                const children = elementsFor(lib, cell.blocks);
                return new lib.TableCell({
                    children: children.length ? children : [new lib.Paragraph({ children: [] })],
                    shading: cell.header ? { fill: 'F2F2F2' } : undefined,
                });
            });
            return new lib.TableRow({ children: cells });
        });

        return new lib.Table({
            rows: rows,
            width: { size: 100, type: lib.WidthType ? lib.WidthType.PERCENTAGE : 'pct' },
        });
    }

    function elementsFor(lib, blocks) {
        const out = [];
        (blocks || []).forEach(function (block) {
            if (!block) return;
            if (block.kind === 'listItem') { out.push(listParagraphFor(lib, block)); return; }
            if (block.kind === 'table') { out.push(tableFor(lib, block)); return; }
            if (block.kind === 'rule') { out.push(ruleParagraphFor(lib)); return; }
            out.push(paragraphFor(lib, block));
        });
        return out;
    }

    // ── The document ──────────────────────────────────────────────────────────
    //
    // `lib` is the docx library. Passed in rather than reached for, so this can
    // be run against the vendored bundle from a test.
    function buildWordDocument(lib, blocks, options) {
        const opts = options || {};
        const children = elementsFor(lib, blocks);

        // A document with nothing in it still has to have a paragraph, or Word
        // reports the file as corrupt rather than as empty.
        if (!children.length) children.push(new lib.Paragraph({ children: [] }));

        // The title goes in as a real Heading 1 rather than as a bare line, so
        // it lands in Word's navigation pane and in any table of contents.
        if (opts.title) {
            children.unshift(new lib.Paragraph({
                heading: lib.HeadingLevel.HEADING_1,
                children: [new lib.TextRun({ text: String(opts.title) })],
            }));
        }

        return new lib.Document({
            numbering: numberingConfig(lib),
            sections: [{ children: children }],
        });
    }

    // ── What a page calls ─────────────────────────────────────────────────────

    // Note Body (TipTap JSON) in, a .docx Blob out.
    async function toWordBlob(spec) {
        const s = spec || {};
        const lib = await loadDocxLibrary();
        const blocks = Core.docxBlocksFromTiptap(s.doc, { panelBodies: s.panelBodies || null });
        return await lib.Packer.toBlob(buildWordDocument(lib, blocks, { title: s.title }));
    }

    // …and hands it to the browser to save, under a name somebody can find.
    async function downloadAsWord(spec) {
        const s = spec || {};
        const blob = await toWordBlob(s);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = Core.docxFileName(s.title);
        document.body.appendChild(link);
        link.click();
        link.remove();
        // Left alive past the click so the browser has taken the bytes.
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }

    // ── Reading a Word file in ────────────────────────────────────────────────
    //
    // mammoth converts a .docx to HTML in the browser — nothing is uploaded
    // anywhere to be converted (ADR-0048) — and TipTap parses that HTML into
    // its own schema using whichever extensions the editor has registered.
    //
    // ⚠ WHAT THE EDITOR DOES NOT KNOW, IT DROPS. The editor currently has no
    // Image extension, so a picture in a Word file arrives as a data: URI in
    // the HTML and is thrown away on the way into the document. Adding
    // @tiptap/extension-image to build/tiptap/entry.js is what fixes that, and
    // until it is there the import is text-only.
    async function wordFileToHtml(file) {
        if (!file) throw new Error('no file');
        const mammoth = await loadLibraryOnce(MAMMOTH_SRC, 'mammoth');
        const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
        // Mammoth reports what it could not carry across. Worth having in the
        // console when somebody says "my headings went missing".
        if (result && result.messages && result.messages.length) {
            console.warn('Word import notes:', result.messages);
        }
        return Core.sanitizeDocxHtml(result && result.value);
    }

    const DocumentDocx = {
        DOCX_LIBRARY_SRC,
        MAMMOTH_SRC,
        buildWordDocument,
        toWordBlob,
        downloadAsWord,
        wordFileToHtml,
        hexOnly,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DocumentDocx;
    }
    if (global) {
        global.DocumentDocx = DocumentDocx;
    }
})(typeof window !== 'undefined' ? window : null);
