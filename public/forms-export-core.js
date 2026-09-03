// Getting the responses out of Mosaic (MS-374).
//
// A form plus its responses in, one CSV out. Pure: no Firestore, no browser,
// no download. Everything with a decision in it lives here — which columns
// exist, what an anonymous form leaves out, how a value is escaped, and the
// order the rows come in — so all of it is testable without either.
//
// ── The question this had to settle ──────────────────────────────────────────
//
// ⚠ MAY AN ANONYMOUS FORM BE EXPORTED AT ALL? Yes, and the export carries
// exactly what the SCREEN carries.
//
// The worry was real: once a file is a spreadsheet on somebody's laptop, nobody
// can stop a column being added or the rows being sorted against a list of who
// voted. But an export is not a NEW disclosure. The Responses tab already shows
// every anonymous answer to any editor. The list of who voted is the ledger, and
// no client can read the ledger at all — not an editor, not an elder
// (ADR-0052). Rows leave in the same stable shuffle the screen uses, so there is
// no arrival order in the file and no timestamp to rebuild one from.
//
// Refusing would have protected nothing that is not already on screen, while
// making somebody retype the answers by hand — and a hand-typed copy has none of
// these protections at all.
//
// ── The convention ──────────────────────────────────────────────────────────
//
// Deliberately wide. A column too many is a column somebody ignores; a column
// missing is an export somebody has to run again. But what a form does not HOLD
// it does not export: an anonymous form has no answerer and no submission time,
// so those columns are absent rather than empty. An empty column invites
// somebody to go looking for what should fill it.

(function (global) {
    'use strict';

    const Core = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
        ? require('./forms-core.js')
        : global.FormsCore;

    // Excel reads a CSV as the system codepage unless a byte-order mark says
    // otherwise, and then every name with an accent in it arrives broken.
    const BOM = '﻿';

    // ── One value, safe to put in a cell ─────────────────────────────────────
    //
    // A single unescaped comma silently shifts every column after it, which is
    // the kind of wrong that looks right until somebody sorts by the wrong
    // thing.
    function cell(value) {
        if (value == null) return '';
        const str = String(value);
        if (!/[",\n\r]/.test(str)) return str;
        return '"' + str.replace(/"/g, '""') + '"';
    }

    function line(values) {
        return values.map(cell).join(',');
    }

    // ── Which columns this form has ──────────────────────────────────────────
    //
    // Each column knows its own header and how to read itself out of a response,
    // so adding a question type here is one entry rather than a change in three
    // places.
    function columnsFor(form) {
        const f = form || {};
        const attributed = f.attribution === true;
        const cols = [];

        // Said on every row, so a file found later describes itself.
        cols.push({ header: 'Form', read: (ctx) => ctx.title });
        cols.push({ header: 'Form ID', read: (ctx) => ctx.formId });
        cols.push({ header: 'Exported on', read: (ctx) => ctx.exportedOn });
        cols.push({ header: 'Answer #', read: (ctx) => ctx.handle });

        // ⚠ Only where the form actually recorded them. On an anonymous form
        // these do not exist, and an empty column would be an invitation.
        if (attributed) {
            cols.push({ header: 'Person ID', read: (ctx) => ctx.response.personId });
            cols.push({ header: 'Name', read: (ctx) => ctx.response.personName });
            cols.push({ header: 'Submitted on', read: (ctx) => ctx.response.submittedAt });
        }

        // Questions in the order the form asks them, INCLUDING retired ones —
        // a retired question still holds answers, and dropping it would lose
        // them quietly. A section heading asks nothing and gets nothing.
        const questions = (f.questions || []).filter((q) => q && Core.asksSomething(q.type));

        // Two questions worded the same are still two columns, so a duplicated
        // header is disambiguated rather than left to collide.
        const seen = {};
        questions.forEach((q) => {
            const base = q.text || q.id;
            seen[base] = (seen[base] || 0) + 1;
        });
        const used = {};

        questions.forEach((q) => {
            const base = q.text || q.id;
            used[base] = (used[base] || 0) + 1;
            const label = seen[base] > 1 ? base + ' [' + q.id + ']' : base;
            const answer = (ctx) => (ctx.response.answers || {})[q.id];

            if (q.type === 'person') {
                // Two columns: the id joins up with the directory, the name is
                // what somebody reads.
                cols.push({ header: label + ' (Person ID)', read: (ctx) => (answer(ctx) || {}).personId });
                cols.push({ header: label + ' (Name)', read: (ctx) => (answer(ctx) || {}).name });
                return;
            }
            if (Core.isUploadType(q.type)) {
                // ⚠ Where it lives, never a link. A storage path is meaningless
                // without an account; a download URL would work for anybody, for
                // ever (ADR-0046).
                cols.push({ header: label + ' (File)', read: (ctx) => (answer(ctx) || {}).name });
                cols.push({ header: label + ' (Size)', read: (ctx) => (answer(ctx) || {}).size });
                cols.push({ header: label + ' (Stored at)', read: (ctx) => (answer(ctx) || {}).storagePath });
                return;
            }
            cols.push({
                header: label,
                read: (ctx) => {
                    const v = answer(ctx);
                    return Array.isArray(v) ? v.join('; ') : v;
                },
            });
        });

        return cols;
    }

    // ── The rows, in the right order ─────────────────────────────────────────
    //
    // ⚠ AN ANONYMOUS FORM COMES OUT IN THE STABLE SHUFFLE, never in the order it
    // was handed over. Arrival order is the correlation channel ADR-0052 exists
    // to close, and a file keeps whatever order it was written in for ever.
    //
    // The handle is positional too — the same "Answer 6" the screen shows — and
    // never the response's document id. An id is a stable per-row identifier and
    // there is no reason to hand one out.
    function orderedRows(form, responses, formId) {
        const list = responses || [];
        if (form && form.attribution === true) {
            return list.map((response, i) => ({ response: response, handle: i + 1 }));
        }
        return Core.anonymousReadOrder(list, formId || (form && form.id) || '')
            .map((row) => ({ response: row.response, handle: row.handle }));
    }

    function toCsv(form, responses, opts) {
        const o = opts || {};
        const f = form || {};
        const formId = o.formId || f.id || '';
        const cols = columnsFor(f);

        const out = [line(cols.map((c) => c.header))];

        orderedRows(f, responses, formId).forEach((row) => {
            const ctx = {
                response: row.response || {},
                handle: row.handle,
                title: f.title || '',
                formId: formId,
                exportedOn: o.exportedOn || '',
            };
            out.push(line(cols.map((c) => c.read(ctx))));
        });

        return BOM + out.join('\n') + '\n';
    }

    // What the download is called. The form and the day, because a Downloads
    // folder is where files go to become anonymous.
    function fileNameFor(form, exportedOn) {
        const title = String((form && form.title) || 'form')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60) || 'form';
        return title + '-responses-' + (exportedOn || 'export') + '.csv';
    }

    const FormsExportCore = { BOM, cell, columnsFor, orderedRows, toCsv, fileNameFor };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FormsExportCore;
    }
    if (global) {
        global.FormsExportCore = FormsExportCore;
    }
})(typeof window !== 'undefined' ? window : null);
