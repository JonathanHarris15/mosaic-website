#!/usr/bin/env node
// Quality ratchet for PR CI.
//
// Counts tsc errors, eslint errors, and knip dead files / exports / deps.
// Compares them to quality-baseline.json. A count above the baseline fails.
// A count below it passes, and the log names the number to paste so the
// ceiling can drop. --update writes those lower numbers and refuses to
// write a higher one.
//
// Against a base ref (origin/main in CI), a baseline number that went up
// fails even when the new count sits under the raised ceiling. The file
// only moves down.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'quality-baseline.json');

export const KEYS = [
    'tsc',
    'eslint',
    'knipFiles',
    'knipExports',
    'knipDependencies',
    'knipUnlisted',
];

const EXPORT_KEYS = [
    'exports', 'nsExports', 'types', 'nsTypes',
    'enumMembers', 'namespaceMembers', 'duplicates',
];
const DEP_KEYS = ['dependencies', 'devDependencies', 'optionalPeerDependencies'];
const UNLISTED_KEYS = ['unlisted', 'unresolved'];

// `npm run check:knip` passes `--only knip`. That name is the group.
/** @type {Record<string, string[]>} */
const GROUPS = {
    knip: ['knipFiles', 'knipExports', 'knipDependencies', 'knipUnlisted'],
};

/** @param {string} output */
export function tscCount(output) {
    const matches = String(output).match(/error TS\d+/g);
    return matches ? matches.length : 0;
}

/**
 * A clean tsc exits 0. Type errors exit non-zero and print `error TS` lines.
 * A non-zero exit with none of those lines is a compiler failure, not a clean tree.
 * @param {number | null} status
 * @param {string} output
 */
export function tscOutcome(status, output) {
    const count = tscCount(output);
    if (status !== 0 && count === 0) {
        throw new Error('tsc failed with no diagnostics');
    }
    return count;
}

/** @param {Array<{ errorCount?: number }>} report */
export function eslintCount(report) {
    if (!Array.isArray(report)) {
        throw new Error('eslint JSON was not an array of file results');
    }
    return report.reduce((n, file) => n + (file.errorCount || 0), 0);
}

/** @param {unknown} value */
function listLength(value) {
    return Array.isArray(value) ? value.length : 0;
}

/** @param {{ issues: Array<Record<string, unknown>> }} report */
export function knipCounts(report) {
    // Knip 6's JSON reporter puts findings on each issue. One shape.
    if (!report || !Array.isArray(report.issues)) {
        throw new Error('knip JSON has no issues array');
    }
    let files = 0;
    let exports = 0;
    let dependencies = 0;
    let unlisted = 0;
    for (const issue of report.issues) {
        files += listLength(issue.files);
        for (const key of EXPORT_KEYS) exports += listLength(issue[key]);
        for (const key of DEP_KEYS) dependencies += listLength(issue[key]);
        for (const key of UNLISTED_KEYS) unlisted += listLength(issue[key]);
    }
    return {
        knipFiles: files,
        knipExports: exports,
        knipDependencies: dependencies,
        knipUnlisted: unlisted,
    };
}

/** @param {string} file */
export function readBaseline(file) {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    /** @type {Record<string, number>} */
    const counts = {};
    for (const key of KEYS) {
        if (!Number.isInteger(raw[key]) || raw[key] < 0) {
            throw new Error(`${path.basename(file)} ${key} must be a non-negative integer`);
        }
        counts[key] = raw[key];
    }
    return { raw, counts };
}

/**
 * @param {Record<string, number>} actual
 * @param {Record<string, number>} baseline
 * @param {string[]} [keys]
 */
export function compareCounts(actual, baseline, keys = KEYS) {
    const raised = [];
    const lowerable = [];
    for (const key of keys) {
        const have = actual[key];
        const cap = baseline[key];
        if (!Number.isInteger(have) || !Number.isInteger(cap)) {
            raised.push({ key, actual: have, baseline: cap });
            continue;
        }
        if (have > cap) raised.push({ key, actual: have, baseline: cap });
        else if (have < cap) lowerable.push({ key, actual: have, baseline: cap });
    }
    return { raised, lowerable };
}

/**
 * @param {Record<string, number>} actual
 * @param {Record<string, number>} baseline
 * @param {Record<string, number> | null} previous
 * @param {string[]} [keys]
 */
export function gateDecision(actual, baseline, previous, keys = KEYS) {
    const { raised, lowerable } = compareCounts(actual, baseline, keys);
    const ceiling = previous ? compareCounts(baseline, previous, keys).raised : [];
    return {
        raised,
        lowerable,
        ceiling,
        ok: raised.length === 0 && ceiling.length === 0,
    };
}

/**
 * @param {string} cmd
 * @param {string[]} args
 */
function run(cmd, args) {
    const result = spawnSync(cmd, args, {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    return result;
}

/** @param {string} name */
function bin(name) {
    return path.join(ROOT, 'node_modules', '.bin', name);
}

/** @param {string[]} keys */
export function measure(keys) {
    /** @type {Record<string, number>} */
    const actual = {};
    if (keys.includes('tsc')) {
        const result = run(bin('tsc'), ['-p', 'tsconfig.json', '--pretty', 'false', '--noEmit']);
        actual.tsc = tscOutcome(result.status, `${result.stdout || ''}\n${result.stderr || ''}`);
    }
    if (keys.includes('eslint')) {
        const result = run(bin('eslint'), ['.', '-f', 'json']);
        actual.eslint = eslintCount(JSON.parse(result.stdout));
    }
    if (keys.some((key) => key.startsWith('knip'))) {
        const result = run(bin('knip'), ['--reporter', 'json', '--no-progress', '--no-exit-code']);
        if (!result.stdout || !result.stdout.trim()) {
            throw new Error(`knip produced no JSON\n${result.stderr || ''}`);
        }
        Object.assign(actual, knipCounts(JSON.parse(result.stdout)));
    }
    return actual;
}

/**
 * The ref is real and `quality-baseline.json` is not on it.
 * Git prints "does not exist in '<ref>'" when the path is also absent from
 * the worktree, and "exists on disk, but not in '<ref>'" when the worktree
 * has the file (the pull request that adds it). A bad ref is a different
 * error: `invalid object name`, which does not name this file.
 * @param {number | null} status
 * @param {string} stderr
 * @returns {'ok' | 'absent' | 'error'}
 */
export function baselineRefStatus(status, stderr) {
    if (status === 0) return 'ok';
    const text = String(stderr || '');
    const namesThisFile = text.includes('quality-baseline.json');
    const missingFromRef = text.includes('does not exist in') || text.includes('but not in');
    if (namesThisFile && missingFromRef) return 'absent';
    return 'error';
}

/** @param {string} ref */
function baselineOnRef(ref) {
    if (!ref) return null;
    const result = spawnSync('git', ['show', `${ref}:quality-baseline.json`], {
        cwd: ROOT,
        encoding: 'utf8',
    });
    const status = baselineRefStatus(result.status, result.stderr || '');
    if (status === 'absent') {
        console.error(`no quality-baseline.json on ${ref}`);
        return null;
    }
    if (status === 'error') {
        throw new Error(
            `could not read quality-baseline.json from ${ref}\n${result.stderr || ''}`);
    }
    return readBaselineText(result.stdout || '');
}

/** @param {string} text */
function readBaselineText(text) {
    const raw = JSON.parse(text);
    /** @type {Record<string, number>} */
    const counts = {};
    for (const key of KEYS) {
        if (!Number.isInteger(raw[key]) || raw[key] < 0) {
            throw new Error(`base quality-baseline.json ${key} must be a non-negative integer`);
        }
        counts[key] = raw[key];
    }
    return counts;
}

/**
 * @param {string[]} argv
 * @returns {{ keys: string[], update: boolean, baselineRef: string }}
 */
export function parseArgs(argv) {
    /** @type {string[]} */
    const only = [];
    let update = false;
    let baselineRef = process.env.QUALITY_BASELINE_REF || '';
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--update') update = true;
        else if (arg === '--only') {
            const name = argv[++i];
            if (GROUPS[name]) only.push(...GROUPS[name]);
            else only.push(name);
        } else if (arg === '--baseline-ref') baselineRef = argv[++i] || '';
        else throw new Error(`Unknown argument ${arg}`);
    }
    const keys = only.length ? only : KEYS.slice();
    for (const key of keys) {
        if (!KEYS.includes(key)) throw new Error(`Unknown count ${key}`);
    }
    if (update && only.length) {
        throw new Error('--update rewrites every count; run it without --only');
    }
    return { keys, update, baselineRef };
}

/**
 * @param {string} title
 * @param {Array<{ key: string, actual: number, baseline: number }>} rows
 */
function report(title, rows) {
    for (const row of rows) {
        console.error(`${title} ${row.key}: baseline ${row.baseline}, actual ${row.actual}`);
    }
}

function main() {
    const { keys, update, baselineRef } = parseArgs(process.argv.slice(2));
    const { raw, counts } = readBaseline(BASELINE_PATH);
    const actual = measure(keys);
    const previous = baselineOnRef(baselineRef);
    const { raised, lowerable, ceiling } = gateDecision(actual, counts, previous, keys);

    if (update) {
        if (raised.length || ceiling.length) {
            report('refusing to raise', raised.concat(ceiling));
            process.exit(1);
        }
        /** @type {Record<string, any>} */
        const next = Object.assign({}, raw);
        let changed = false;
        for (const row of lowerable) {
            next[row.key] = row.actual;
            changed = true;
        }
        if (changed) {
            writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + '\n');
            console.log('lowered quality-baseline.json');
        } else {
            console.log('quality-baseline.json already matches');
        }
        return;
    }

    for (const key of keys) console.log(`${key} ${actual[key]} (baseline ${counts[key]})`);
    if (lowerable.length) {
        console.log('These counts can be lowered. Edit quality-baseline.json:');
        for (const row of lowerable) console.log(`  ${row.key}: ${row.baseline} -> ${row.actual}`);
    }
    if (raised.length || ceiling.length) {
        report('count went up', raised);
        report('baseline file went up', ceiling);
        process.exit(1);
    }
}

const isMain = process.argv[1]
    && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main();
