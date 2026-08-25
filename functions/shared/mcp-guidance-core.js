// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/mcp-guidance-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// MCP Guidance Core — the rules for a guidance file: the written instructions
// an assistant pulls down through the MCP to learn how this church builds an
// Order of Service (MS-262).
//
// A guidance file is not data about a Sunday. It is the standing knowledge an
// editor would otherwise have to repeat in every conversation: which hymns
// suit which season, when a repeated theme is fine and when it is lazy, the
// house style for a note. Editors write them on the MCP Manager page; the MCP
// server serves them.
//
// Pure logic only, so it can be COPIED into functions/shared (see
// scripts/sync-shared-to-functions.js) and used by the server as well as by
// the page that edits them.
//
// ⚠ THE SLUG IS THE ADDRESS, AND IT IS PERMANENT IN PRACTICE. It is what the
// resource URI is built from, so an assistant that has been told to read
// `oos://guidance/hymn-selection` is referring to a slug, not a title.
// Renaming a title is free; changing a slug silently breaks anything that
// named the old one.
(function (global) {
    'use strict';

    // The scheme the MCP server publishes guidance under. Not http: — these
    // are not fetchable pages, and a client that treated them as such would
    // be reaching past the server's own access checks.
    const URI_SCHEME = 'oos';
    const URI_PREFIX = URI_SCHEME + '://guidance/';

    // Deliberately narrow: lowercase, digits, single hyphens. A slug goes in
    // a URI and gets read aloud in a conversation, so anything that needs
    // escaping or that two people would spell differently is out.
    const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

    const MAX_TITLE = 80;
    const MAX_SUMMARY = 200;
    // Long enough for real instructions, short enough that one file cannot
    // fill an assistant's context on its own.
    const MAX_BODY = 20000;

    function slugify(text) {
        return String(text || '')
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60)
            .replace(/-+$/, '');
    }

    function isValidSlug(slug) {
        return typeof slug === 'string' &&
            slug.length > 0 && slug.length <= 60 &&
            SLUG_PATTERN.test(slug);
    }

    function uriFor(slug) {
        return URI_PREFIX + slug;
    }

    // The slug back out of a URI, or null if this is not one of ours. Returns
    // null rather than guessing: a URI we do not recognise is not a guidance
    // file, and answering for it would be inventing one.
    function slugFromUri(uri) {
        const text = String(uri || '');
        if (text.indexOf(URI_PREFIX) !== 0) return null;
        const slug = text.slice(URI_PREFIX.length);
        return isValidSlug(slug) ? slug : null;
    }

    /**
     * Checks a guidance file before it is saved. Returns a list of problems
     * in plain language — an empty list means it is fine.
     *
     * The messages are written to be shown to the editor as they are, since
     * this runs on the page as well as on the server.
     */
    function validate(file) {
        const f = file || {};
        const problems = [];

        const title = String(f.title || '').trim();
        if (!title) problems.push('Give it a title.');
        else if (title.length > MAX_TITLE) {
            problems.push(`The title is too long (max ${MAX_TITLE} characters).`);
        }

        if (!isValidSlug(f.slug)) {
            problems.push(
                'The address must be lowercase letters, numbers and hyphens ' +
                '— for example "hymn-selection".');
        }

        const summary = String(f.summary || '').trim();
        if (!summary) {
            // Without this an assistant has to open every file to find out
            // which one it wants, which defeats having several.
            problems.push(
                'Give it a one-line summary, so the assistant can tell which ' +
                'file it needs without opening them all.');
        } else if (summary.length > MAX_SUMMARY) {
            problems.push(`The summary is too long (max ${MAX_SUMMARY} characters).`);
        }

        const body = String(f.body || '').trim();
        if (!body) problems.push('The file is empty — write the guidance itself.');
        else if (body.length > MAX_BODY) {
            problems.push(
                `This file is too long (${body.length} characters, max ` +
                `${MAX_BODY}). Split it into two files rather than trimming ` +
                'it — that is what having several is for.');
        }

        return problems;
    }

    /** The stored shape, cleaned up. Assumes validate() passed. */
    function normalize(file) {
        const f = file || {};
        return {
            title: String(f.title || '').trim(),
            slug: String(f.slug || '').trim(),
            summary: String(f.summary || '').trim(),
            body: String(f.body || '').trim(),
            enabled: f.enabled !== false,
        };
    }

    const McpGuidanceCore = {
        URI_SCHEME,
        URI_PREFIX,
        SLUG_PATTERN,
        MAX_TITLE,
        MAX_SUMMARY,
        MAX_BODY,
        slugify,
        isValidSlug,
        uriFor,
        slugFromUri,
        validate,
        normalize,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = McpGuidanceCore;
    }
    if (global) {
        global.McpGuidanceCore = McpGuidanceCore;
    }
})(typeof window !== 'undefined' ? window : null);
