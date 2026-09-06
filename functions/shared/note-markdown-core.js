// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/note-markdown-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Note Markdown Core — prose in, Note Body out, and back again (MS-278).
//
// Every Note Body in Mosaic is TipTap JSON: a Shepherding Note, Meeting
// Minutes, an Elder Document, an Event Document, all the same shape. That is
// right for an editor and useless to an assistant, which writes sentences.
// This is the hinge between the two.
//
// ⚠ ONE DIRECTION IS LOSSLESS AND THE OTHER IS A READING. Those are different
// promises and it matters which is which.
//
//   markdown → TipTap → markdown   LOSSLESS for everything below. This is an
//                                  agent's own words going in and coming back,
//                                  and a note that changed on the way through
//                                  would be a note nobody can trust.
//
//   TipTap → markdown              A FAITHFUL READING of a document a person
//                                  typed. It keeps the words, the structure and
//                                  the emphasis, and drops what markdown has no
//                                  way to say: alignment, font size, colour, and
//                                  the bytes of a pasted picture. Dropped on
//                                  purpose — inventing syntax for them would
//                                  mean an agent reading a note back and then
//                                  saving it wrote that invention into the
//                                  document.
//
// ⚠ A PICTURE IS NAMED, NEVER DUMPED. Pictures ride INSIDE the Note Body as
// data URIs (ADR-0048), so a naive read hands an assistant a megabyte of base64
// where a sentence should be. An image reads as `![its alt text]` and nothing
// more, and there is no markdown an agent can write that puts one back — an
// agent pasting base64 into a note is a Firestore document-size failure that
// surfaces to an elder as "saving didn't work".
//
// What survives the round trip: headings (six levels), paragraphs, bold,
// italic, underline, highlight, links, bullet and numbered lists (nested),
// blockquotes, horizontal rules, tables, and hard line breaks.
//
// Deliberately self-contained like every other *-core module here: requires
// nothing, mutates nothing, returns new objects.
//
// Loaded as a classic <script> (window.NoteMarkdownCore) and exported for Node.

(function (global) {
    'use strict';

    // The characters that mean something in this dialect. A backslash in front
    // of any of them makes it literal, both on the way in and on the way out.
    const ESCAPABLE = '\\`*_[]<>=|';

    // Deepest heading markdown has. A seventh hash is not a deeper heading, it
    // is a paragraph that starts with hashes.
    const MAX_HEADING = 6;

    // ── The empty document ───────────────────────────────────────────────────
    // document-body-core.js owns what "empty" means; this asks it when it can,
    // so "new" means the same thing whether a person or an agent made it. The
    // fallback is for this module loaded on its own (its unit test does that)
    // and must stay identical to the answer over there.

    function emptyBody() {
        const owner = (global && global.DocumentBodyCore) || null;
        if (owner && typeof owner.emptyBody === 'function') return owner.emptyBody();
        return { type: 'doc', content: [{ type: 'paragraph' }] };
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  markdown → TipTap
    // ═══════════════════════════════════════════════════════════════════════

    // ── Inline ───────────────────────────────────────────────────────────────
    //
    // A scanner rather than a regex sweep, because the rule that matters is
    // "an unclosed mark is text". `a ** dangling star` must come out as those
    // words, not as bold swallowing the rest of the sentence — an agent's
    // half-typed emphasis should never eat an elder's note.

    const DELIMITERS = [
        { open: '**', close: '**', mark: 'bold' },
        { open: '==', close: '==', mark: 'highlight' },
        { open: '<u>', close: '</u>', mark: 'underline' },
        { open: '*', close: '*', mark: 'italic' },
        { open: '_', close: '_', mark: 'italic' },
    ];

    // Where `close` next appears, skipping anything escaped. Returns -1 when it
    // does not, which is what turns a would-be mark back into plain text.
    function findClose(text, close, from) {
        let i = from;
        while (i <= text.length - close.length) {
            if (text[i] === '\\') { i += 2; continue; }
            if (text.startsWith(close, i)) return i;
            i += 1;
        }
        return -1;
    }

    // Adjacent runs carrying exactly the same marks are one text node. Without
    // this the scanner emits a node per character, which is valid TipTap and
    // horrible to read, diff or test.
    function mergeRuns(nodes) {
        const out = [];
        nodes.forEach(function (node) {
            const last = out[out.length - 1];
            if (last && last.type === 'text' && node.type === 'text' &&
                sameMarks(last.marks, node.marks)) {
                last.text += node.text;
                return;
            }
            out.push(node);
        });
        return out.filter(function (n) { return n.type !== 'text' || n.text.length; });
    }

    function sameMarks(a, b) {
        return markKey(a) === markKey(b);
    }

    function markKey(marks) {
        return JSON.stringify((marks || []).slice().sort(function (x, y) {
            return x.type < y.type ? -1 : x.type > y.type ? 1 : 0;
        }));
    }

    function withMark(nodes, mark) {
        return nodes.map(function (node) {
            if (node.type !== 'text') return node;
            return Object.assign({}, node, { marks: (node.marks || []).concat([mark]) });
        });
    }

    function textNode(text, marks) {
        const node = { type: 'text', text: text };
        if (marks && marks.length) node.marks = marks;
        return node;
    }

    function parseInline(source) {
        const text = String(source == null ? '' : source);
        const out = [];
        let buffer = '';

        const flush = function () {
            if (buffer) { out.push(textNode(buffer)); buffer = ''; }
        };

        let i = 0;
        while (i < text.length) {
            const ch = text[i];

            // An escape makes the next character literal, whatever it is.
            if (ch === '\\' && i + 1 < text.length) {
                buffer += text[i + 1];
                i += 2;
                continue;
            }

            // A link: [what it says](where it goes). The label is parsed as
            // inline in its own right, so a bold word inside a link stays bold.
            if (ch === '[') {
                const link = readLink(text, i);
                if (link) {
                    flush();
                    withMark(parseInline(link.label), {
                        type: 'link', attrs: { href: link.href },
                    }).forEach(function (n) { out.push(n); });
                    i = link.end;
                    continue;
                }
            }

            const delimiter = DELIMITERS.find(function (d) {
                return text.startsWith(d.open, i);
            });
            if (delimiter) {
                const from = i + delimiter.open.length;
                const close = findClose(text, delimiter.close, from);
                if (close !== -1 && close > from) {
                    flush();
                    withMark(parseInline(text.slice(from, close)), {
                        type: delimiter.mark,
                    }).forEach(function (n) { out.push(n); });
                    i = close + delimiter.close.length;
                    continue;
                }
                // Unclosed. The delimiter is the text it looks like.
                buffer += delimiter.open;
                i += delimiter.open.length;
                continue;
            }

            buffer += ch;
            i += 1;
        }

        flush();
        return mergeRuns(out);
    }

    // `[label](href)` starting at `start`, or null if this bracket is just a
    // bracket. Brackets nest one level, which is all a label ever needs.
    function readLink(text, start) {
        let depth = 0;
        let i = start;
        while (i < text.length) {
            if (text[i] === '\\') { i += 2; continue; }
            if (text[i] === '[') depth += 1;
            if (text[i] === ']') {
                depth -= 1;
                if (depth === 0) break;
            }
            i += 1;
        }
        if (depth !== 0 || text[i + 1] !== '(') return null;

        const closeParen = text.indexOf(')', i + 2);
        if (closeParen === -1) return null;

        return {
            label: text.slice(start + 1, i),
            href: text.slice(i + 2, closeParen).trim(),
            end: closeParen + 1,
        };
    }

    // ── Blocks ───────────────────────────────────────────────────────────────

    const HEADING_RE = /^(#{1,6})\s+(.*)$/;
    const RULE_RE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
    const QUOTE_RE = /^>\s?(.*)$/;
    const BULLET_RE = /^(\s*)([-*+])\s+(.*)$/;
    const ORDERED_RE = /^(\s*)(\d+)[.)]\s+(.*)$/;
    const TABLE_ROW_RE = /^\s*\|(.*)\|\s*$/;
    const TABLE_DIVIDER_RE = /^\s*\|(?:\s*:?-{1,}:?\s*\|)+\s*$/;

    function isBlank(line) { return !String(line).trim(); }

    // Does this line begin something other than the paragraph we are in? Used
    // to end a paragraph without needing a blank line, which is what an agent
    // writing a heading straight after a sentence produces.
    function startsBlock(line, next) {
        if (isBlank(line)) return true;
        if (HEADING_RE.test(line)) return true;
        if (RULE_RE.test(line)) return true;
        if (QUOTE_RE.test(line)) return true;
        if (BULLET_RE.test(line) || ORDERED_RE.test(line)) return true;
        if (TABLE_ROW_RE.test(line) && next && TABLE_DIVIDER_RE.test(next)) return true;
        return false;
    }

    function fromMarkdown(markdown) {
        const lines = String(markdown == null ? '' : markdown)
            .replace(/\r\n?/g, '\n')
            .split('\n');
        const blocks = parseBlocks(lines);
        if (!blocks.length) return emptyBody();
        return { type: 'doc', content: blocks };
    }

    function parseBlocks(lines) {
        const out = [];
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];

            if (isBlank(line)) { i += 1; continue; }

            if (RULE_RE.test(line)) {
                out.push({ type: 'horizontalRule' });
                i += 1;
                continue;
            }

            const heading = line.match(HEADING_RE);
            if (heading) {
                out.push({
                    type: 'heading',
                    attrs: { level: Math.min(heading[1].length, MAX_HEADING) },
                    content: parseInline(heading[2].trim()),
                });
                i += 1;
                continue;
            }

            if (QUOTE_RE.test(line)) {
                const inner = [];
                while (i < lines.length && QUOTE_RE.test(lines[i])) {
                    inner.push(lines[i].match(QUOTE_RE)[1]);
                    i += 1;
                }
                out.push({ type: 'blockquote', content: parseBlocks(inner) });
                continue;
            }

            if (TABLE_ROW_RE.test(line) && TABLE_DIVIDER_RE.test(lines[i + 1] || '')) {
                const table = parseTable(lines, i);
                out.push(table.node);
                i = table.next;
                continue;
            }

            if (BULLET_RE.test(line) || ORDERED_RE.test(line)) {
                const list = parseList(lines, i);
                out.push(list.node);
                i = list.next;
                continue;
            }

            const paragraph = parseParagraph(lines, i);
            out.push(paragraph.node);
            i = paragraph.next;
        }

        return out;
    }

    // A paragraph runs until a blank line or the start of another block. A line
    // ending in a backslash is a hard break: the words stay in ONE paragraph
    // with a break between them, which is what an elder pressing shift-enter
    // gets and is not the same as two paragraphs.
    function parseParagraph(lines, start) {
        const segments = [];
        let current = [];
        let i = start;

        while (i < lines.length) {
            if (i > start && startsBlock(lines[i], lines[i + 1])) break;
            const line = lines[i];
            if (/\\$/.test(line)) {
                current.push(line.slice(0, -1).trim());
                segments.push(current.join(' '));
                current = [];
            } else {
                current.push(line.trim());
            }
            i += 1;
        }
        segments.push(current.join(' '));

        const content = [];
        segments.forEach(function (segment, index) {
            if (index) content.push({ type: 'hardBreak' });
            parseInline(segment).forEach(function (n) { content.push(n); });
        });

        return { node: { type: 'paragraph', content: content }, next: i };
    }

    // A list, and everything indented underneath it. An item owns the lines
    // more deeply indented than its own marker, which is what makes a nested
    // list a child of the item above rather than a sibling of the whole list.
    function parseList(lines, start) {
        const first = lines[start].match(BULLET_RE) || lines[start].match(ORDERED_RE);
        const ordered = !BULLET_RE.test(lines[start]);
        const indent = first[1].length;

        const items = [];
        let i = start;

        while (i < lines.length) {
            const line = lines[i];
            if (isBlank(line)) break;

            const match = line.match(BULLET_RE) || line.match(ORDERED_RE);
            if (!match || match[1].length !== indent) break;
            if (!BULLET_RE.test(line) !== ordered) break;

            // Where this item's own text starts, so its continuation lines can
            // be dedented to it and parsed as ordinary blocks.
            const contentColumn = line.length - match[3].length;
            const own = [match[3]];
            i += 1;

            while (i < lines.length && !isBlank(lines[i])) {
                const indentOf = lines[i].length - lines[i].replace(/^\s*/, '').length;
                if (indentOf <= indent) break;
                own.push(lines[i].slice(Math.min(contentColumn, indentOf)));
                i += 1;
            }

            items.push({ type: 'listItem', content: parseBlocks(own) });
        }

        return {
            node: { type: ordered ? 'orderedList' : 'bulletList', content: items },
            next: i,
        };
    }

    // `| a | b |` on an unescaped pipe. The outer pipes are the fence, not
    // columns, so the empty strings either side of them are dropped.
    function splitRow(line) {
        const inner = line.match(TABLE_ROW_RE)[1];
        const cells = [];
        let buffer = '';
        for (let i = 0; i < inner.length; i += 1) {
            if (inner[i] === '\\' && i + 1 < inner.length) {
                buffer += inner[i] + inner[i + 1];
                i += 1;
                continue;
            }
            if (inner[i] === '|') { cells.push(buffer); buffer = ''; continue; }
            buffer += inner[i];
        }
        cells.push(buffer);
        return cells.map(function (c) { return c.trim(); });
    }

    function cellNode(type, text) {
        return { type: type, content: [{ type: 'paragraph', content: parseInline(text) }] };
    }

    function parseTable(lines, start) {
        const header = splitRow(lines[start]);
        const columns = header.length;
        const rows = [{
            type: 'tableRow',
            content: header.map(function (c) { return cellNode('tableHeader', c); }),
        }];

        let i = start + 2; // the divider row is punctuation, not data
        while (i < lines.length && TABLE_ROW_RE.test(lines[i]) &&
            !TABLE_DIVIDER_RE.test(lines[i])) {
            const cells = splitRow(lines[i]);
            // A ragged row is padded rather than dropped. A row with a missing
            // cell is still a row somebody meant to write.
            while (cells.length < columns) cells.push('');
            rows.push({
                type: 'tableRow',
                content: cells.slice(0, columns).map(function (c) {
                    return cellNode('tableCell', c);
                }),
            });
            i += 1;
        }

        return { node: { type: 'table', content: rows }, next: i };
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  TipTap → markdown
    // ═══════════════════════════════════════════════════════════════════════

    function escapeText(text) {
        let out = '';
        for (let i = 0; i < text.length; i += 1) {
            const ch = text[i];
            // `=` only means something doubled, so a lone equals sign in a
            // sentence is left alone rather than gaining a backslash.
            if (ch === '=' && text[i + 1] !== '=') { out += ch; continue; }
            out += ESCAPABLE.indexOf(ch) === -1 ? ch : '\\' + ch;
        }
        return out;
    }

    // Outermost first. Fixed, so a document read twice reads the same twice.
    const WRAP_ORDER = ['link', 'bold', 'italic', 'underline', 'highlight'];

    function serializeText(node) {
        const marks = node.marks || [];
        let out = escapeText(node.text || '');
        const has = function (type) {
            return marks.find(function (m) { return m.type === type; });
        };
        // Innermost outwards, so the fixed order above ends up on the page.
        WRAP_ORDER.slice().reverse().forEach(function (type) {
            const mark = has(type);
            if (!mark) return;
            if (type === 'bold') out = '**' + out + '**';
            if (type === 'italic') out = (has('bold') ? '_' : '*') + out + (has('bold') ? '_' : '*');
            if (type === 'underline') out = '<u>' + out + '</u>';
            if (type === 'highlight') out = '==' + out + '==';
            if (type === 'link') out = '[' + out + '](' + ((mark.attrs && mark.attrs.href) || '') + ')';
        });
        return out;
    }

    function serializeInline(nodes) {
        return (nodes || []).map(function (node) {
            if (!node) return '';
            if (node.type === 'text') return serializeText(node);
            if (node.type === 'hardBreak') return '\\\n';
            // A Cross-Reference reads as the name it points at. The id behind it
            // is machine detail an assistant cannot do anything useful with.
            if (node.type === 'mention') {
                return '@' + ((node.attrs && node.attrs.label) || '');
            }
            if (node.type === 'image') return serializeImage(node);
            return serializeInline(node.content);
        }).join('');
    }

    // Named, never dumped — see the header. The alt text is the only part of a
    // picture that is words.
    function serializeImage(node) {
        const alt = (node.attrs && node.attrs.alt) || 'picture';
        return '![' + String(alt).replace(/[[\]]/g, '') + ']';
    }

    function indentLines(text, prefix) {
        return text.split('\n').map(function (line) {
            return line ? prefix + line : line;
        }).join('\n');
    }

    function serializeBlock(node) {
        if (!node) return '';

        switch (node.type) {
            case 'paragraph':
                return serializeInline(node.content);

            case 'heading': {
                const level = Math.min(
                    Math.max((node.attrs && node.attrs.level) || 1, 1), MAX_HEADING);
                return '#'.repeat(level) + ' ' + serializeInline(node.content);
            }

            case 'horizontalRule':
                return '---';

            case 'blockquote':
                return serializeBlocks(node.content).split('\n').map(function (line) {
                    return line ? '> ' + line : '>';
                }).join('\n');

            case 'bulletList':
            case 'orderedList':
                return serializeList(node);

            case 'table':
                return serializeTable(node);

            case 'image':
                return serializeImage(node);

            // A Person Panel is a Shepherding Note living inside a document. It
            // reads as who it is about, because the note's own words are read
            // from the note, not from here.
            case 'personPanel': {
                const attrs = node.attrs || {};
                const type = attrs.noteType ? ' (' + attrs.noteType + ')' : '';
                return '**' + (attrs.personName || 'Someone') + '**' + type;
            }

            default:
                // A node this module has not met yet is still worth reading for
                // its words. Dropping it would lose an elder's sentence to a
                // schema change nobody told this file about.
                return node.content ? serializeInline(node.content) : '';
        }
    }

    function serializeList(list) {
        const ordered = list.type === 'orderedList';
        return (list.content || []).map(function (item, index) {
            const marker = ordered ? (index + 1) + '. ' : '- ';
            const blocks = (item && item.content) || [];
            const head = serializeBlock(blocks[0]);
            const rest = blocks.slice(1).map(function (block) {
                return indentLines(serializeBlock(block), '  ');
            });
            return [marker + head].concat(rest).join('\n');
        }).join('\n');
    }

    function serializeTable(table) {
        const rows = (table.content || []).map(function (row) {
            return ((row && row.content) || []).map(function (cell) {
                return serializeBlocks(cell && cell.content)
                    .replace(/\n+/g, ' ')
                    .replace(/\|/g, '\\|')
                    .trim();
            });
        });
        if (!rows.length) return '';

        const columns = rows[0].length;
        const line = function (cells) { return '| ' + cells.join(' | ') + ' |'; };

        const out = [line(rows[0]), line(new Array(columns).fill('---'))];
        rows.slice(1).forEach(function (cells) {
            while (cells.length < columns) cells.push('');
            out.push(line(cells.slice(0, columns)));
        });
        return out.join('\n');
    }

    function serializeBlocks(nodes) {
        return (nodes || [])
            .map(serializeBlock)
            .filter(function (text) { return text !== ''; })
            .join('\n\n');
    }

    function toMarkdown(contentJson) {
        if (!contentJson) return '';
        const content = contentJson.type === 'doc' ?
            contentJson.content : [contentJson];
        return serializeBlocks(content).replace(/\s+$/, '');
    }

    // ═══════════════════════════════════════════════════════════════════════

    // Growing a note rather than making a second one about the same
    // conversation. Returns a NEW document — the caller's copy is left alone,
    // because an append that quietly rewrote what it was handed would be a
    // trap in any caller that still needs the old version to compare against.
    function appendMarkdown(contentJson, markdown) {
        const existing = (contentJson && contentJson.content) || [];
        const added = fromMarkdown(markdown).content;

        // fromMarkdown of nothing is the empty document, which is one blank
        // paragraph. Appending that would grow the note by a blank line.
        if (!String(markdown || '').trim()) {
            return { type: 'doc', content: existing.slice() };
        }

        // The same blank paragraph on the other side: appending to an untouched
        // note should fill it, not push its emptiness down the page.
        const kept = isEmptyContent(existing) ? [] : existing.slice();
        return { type: 'doc', content: kept.concat(added) };
    }

    function isEmptyContent(content) {
        return (content || []).every(function (node) {
            return node && node.type === 'paragraph' &&
                !(node.content && node.content.length);
        });
    }

    const NoteMarkdownCore = {
        emptyBody,
        fromMarkdown,
        toMarkdown,
        appendMarkdown,
        // Worth testing on their own, and worth reusing where a caller has one
        // paragraph rather than a document.
        parseInline,
        serializeInline,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = NoteMarkdownCore;
    }
    if (global) {
        global.NoteMarkdownCore = NoteMarkdownCore;
    }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
