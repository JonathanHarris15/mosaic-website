// Printable Core — what a Printable IS, before any page draws it.
//
// A **Printable** is a project the church lays out and prints: a membership
// directory, a service guide, an event handout. It is a name, the folder it is
// filed in, the **page template** it was created on (paper size, orientation
// and pixel density — fixed for the life of the project), and its **pages**.
//
// This module is the record shape and the names. The pages themselves — the
// element tree, its HTML and CSS — grow in here under MS-393; the library
// (MS-392) needs only enough to make, name, copy and file a project.
//
// Self-contained like every other *-core module: no Firestore, no DOM, new
// objects out. Loaded as a classic <script> (window.PrintableCore) and
// exported for Node.

(function (global) {
    'use strict';

    // Every record says which shape it was written in, so a later model can
    // read an older one rather than guess. Bumped only when a saved record
    // would otherwise be misread.
    const RECORD_VERSION = 1;

    // ── The name ─────────────────────────────────────────────────────────────
    //
    // 90 characters, the same as a form's title: it is read on a row of its
    // own and in the editor's header, never in a breadcrumb.
    const MAX_NAME_LENGTH = 90;
    const DEFAULT_NAME = 'Untitled printable';

    function normaliseName(name) {
        const trimmed = String(name == null ? '' : name).trim();
        if (!trimmed) return DEFAULT_NAME;
        return trimmed.slice(0, MAX_NAME_LENGTH);
    }

    // What a duplicate is called. "Directory" → "Directory copy"; a second
    // copy beside those → "Directory copy 2", and so on, so two copies made in
    // a row never share a name. `taken` is the names already in the library.
    function copyName(name, taken) {
        const base = normaliseName(name).replace(/ copy( \d+)?$/, '');
        const used = {};
        (taken || []).forEach(n => { used[String(n)] = true; });
        let candidate = base + ' copy';
        let n = 2;
        while (used[candidate]) {
            candidate = base + ' copy ' + n;
            n += 1;
        }
        return normaliseName(candidate);
    }

    // ── The record ───────────────────────────────────────────────────────────
    //
    // `template` is null until the editor's picker settles it — a project
    // exists in the library from the moment it is named, and picking paper is
    // the first thing the editor asks. Pages are an ordered list; an empty
    // list is a project nobody has opened yet.
    function buildPrintable(spec) {
        const s = spec || {};
        return {
            version: RECORD_VERSION,
            name: normaliseName(s.name),
            folderId: s.folderId || null,
            template: s.template ? clone(s.template) : null,
            pages: Array.isArray(s.pages) ? clone(s.pages) : [],
        };
    }

    // A copy for the library's Duplicate: the same paper, the same pages, the
    // same bindings, a new name, filed beside the original. Nothing about who
    // made it or when comes along — the store stamps those afresh.
    function duplicatePrintable(printable, taken) {
        const p = printable || {};
        return buildPrintable({
            name: copyName(p.name, taken),
            folderId: p.folderId || null,
            template: p.template || null,
            pages: p.pages || [],
        });
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    const PrintableCore = {
        RECORD_VERSION,
        MAX_NAME_LENGTH,
        DEFAULT_NAME,
        normaliseName,
        copyName,
        buildPrintable,
        duplicatePrintable,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableCore;
    }
    if (global) {
        global.PrintableCore = PrintableCore;
    }
})(typeof window !== 'undefined' ? window : null);
