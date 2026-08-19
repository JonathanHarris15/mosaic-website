/**
 * @fileoverview SPIKE (throwaway): does semantic similarity actually work on our
 * Service Themes? Embeds every distinct theme, then answers two questions:
 *   1. For each theme, what is its closest equivalent in the list?
 *   2. How unique is it, on a scale a human can read?
 *
 * Usage:
 *   node scripts/spike/analyze-themes.js                     # uses themes.json
 *   node scripts/spike/analyze-themes.js --in=themes.txt     # one theme per line
 *   node scripts/spike/analyze-themes.js --model=gemini-embedding-2
 *   node scripts/spike/analyze-themes.js --test="The God Who Waits"
 *
 * Needs GEMINI_API_KEY in the environment. Vectors are cached per model, so
 * re-running costs nothing.
 */

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GEMINI_API_KEY;
const arg = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
    return hit ? hit.slice(name.length + 3) : fallback;
};

const MODEL = arg('model', 'gemini-embedding-001');
const DIMS = Number(arg('dims', 768));
const IN = path.resolve(__dirname, arg('in', 'themes.json'));
const TEST = arg('test', null);
const CACHE = path.join(__dirname, 'vectors-' + MODEL + '-' + DIMS + '.json');
const REPORT = path.join(__dirname, 'report-' + MODEL + '.md');

// ---------------------------------------------------------------- embeddings

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};

async function embedOne(text) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
        MODEL + ':embedContent?key=' + API_KEY;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'models/' + MODEL,
            content: { parts: [{ text }] },
            taskType: 'SEMANTIC_SIMILARITY',
            outputDimensionality: DIMS,
        }),
    });
    if (!res.ok) throw new Error(res.status + ' ' + (await res.text()));
    return (await res.json()).embedding.values;
}

/** Embed with a small concurrency window and retry, caching by exact text. */
async function embedAll(texts) {
    const todo = [...new Set(texts)].filter((t) => !cache[t]);
    if (!todo.length) return;
    process.stdout.write('embedding ' + todo.length + ' themes');
    const WINDOW = 5;
    for (let i = 0; i < todo.length; i += WINDOW) {
        await Promise.all(todo.slice(i, i + WINDOW).map(async (text) => {
            for (let attempt = 0; attempt < 4; attempt++) {
                try {
                    cache[text] = await embedOne(text);
                    return;
                } catch (e) {
                    if (attempt === 3) throw e;
                    await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
                }
            }
        }));
        process.stdout.write('.');
    }
    process.stdout.write('\n');
    fs.writeFileSync(CACHE, JSON.stringify(cache));
}

// ------------------------------------------------------------- vector basics

const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const norm = (v) => Math.sqrt(dot(v, v));
const unit = (v) => { const n = norm(v) || 1; return v.map((x) => x / n); };
const cosine = (a, b) => dot(a, b) / ((norm(a) * norm(b)) || 1);

/** Average vector of the corpus — the "this is a Mosaic service theme" direction. */
function meanVector(vectors) {
    const out = new Array(vectors[0].length).fill(0);
    vectors.forEach((v) => v.forEach((x, i) => { out[i] += x; }));
    return out.map((x) => x / vectors.length);
}

/** Subtract the corpus mean, then renormalize. Strips the shared "about God" signal. */
const center = (v, mean) => unit(v.map((x, i) => x - mean[i]));

/** Word-overlap similarity — the lexical baseline, included to show it failing. */
function jaccard(a, b) {
    const words = (s) => new Set(
        s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean),
    );
    const A = words(a);
    const B = words(b);
    const shared = [...A].filter((w) => B.has(w)).length;
    return shared / (new Set([...A, ...B]).size || 1);
}

// ------------------------------------------------------------------ analysis

/** Percentile of a value within an ascending-sorted array. */
function percentile(sorted, value) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < value) lo = mid + 1;
        else hi = mid;
    }
    return (lo / sorted.length) * 100;
}

function loadThemes() {
    if (!fs.existsSync(IN)) {
        console.error('No input at ' + IN + '. Run export-themes.js first, or pass --in=<file>.');
        process.exit(1);
    }
    const raw = fs.readFileSync(IN, 'utf8');
    if (IN.endsWith('.json')) return JSON.parse(raw);
    return raw.split('\n').map((l) => l.trim()).filter(Boolean)
        .map((text) => ({ text, dates: [] }));
}

async function main() {
    if (!API_KEY) {
        console.error('GEMINI_API_KEY is not set.');
        process.exit(1);
    }

    const themes = loadThemes();
    const N = themes.length;
    console.log(N + ' distinct themes, model ' + MODEL + ' @ ' + DIMS + 'd\n');

    await embedAll(themes.map((t) => t.text));
    const raw = themes.map((t) => unit(cache[t.text]));
    const mean = meanVector(raw);
    const centered = raw.map((v) => center(v, mean));

    // Full pairwise similarity, measured both ways.
    const simRaw = [];
    const simCen = [];
    for (let i = 0; i < N; i++) {
        simRaw.push(new Float64Array(N));
        simCen.push(new Float64Array(N));
    }
    const allCen = [];
    const allRaw = [];
    for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
            const r = cosine(raw[i], raw[j]);
            const c = cosine(centered[i], centered[j]);
            simRaw[i][j] = r; simRaw[j][i] = r;
            simCen[i][j] = c; simCen[j][i] = c;
            allCen.push(c);
            allRaw.push(r);
        }
    }
    allCen.sort((a, b) => a - b);
    allRaw.sort((a, b) => a - b);

    const nearestBy = (matrix, i) => {
        let best = -Infinity;
        let bestJ = -1;
        for (let j = 0; j < N; j++) {
            if (j !== i && matrix[i][j] > best) { best = matrix[i][j]; bestJ = j; }
        }
        return { j: bestJ, sim: best };
    };

    // Per theme: nearest neighbour, plus a "how crowded is its neighbourhood" score.
    const rows = themes.map((t, i) => {
        const others = themes
            .map((o, j) => ({ o, j, cen: simCen[i][j] }))
            .filter((x) => x.j !== i)
            .sort((a, b) => b.cen - a.cen);
        const top3 = others.slice(0, 3);
        return {
            i,
            text: t.text,
            dates: t.dates || [],
            nearest: others[0],
            top3mean: top3.reduce((s, x) => s + x.cen, 0) / top3.length,
        };
    });

    // Calibrate against the OTHER THEMES' top-3 scores, not against all pairs.
    // A nearest-neighbour score is high by construction, so the all-pairs
    // distribution is the wrong yardstick — it crams every theme into the top
    // few percent. Measured this way, "uniqueness 70%" means plainly: more
    // distinctive than 70% of the themes we have already used.
    const allTop3 = rows.map((r) => r.top3mean).sort((a, b) => a - b);
    rows.forEach((r) => { r.uniqueness = 100 - percentile(allTop3, r.top3mean); });

    // ------------------------------------------------------------- reporting
    const pct = (n) => n.toFixed(0) + '%';
    const sim = (n) => n.toFixed(3);
    const out = [];
    const say = (s) => { out.push(s === undefined ? '' : s); console.log(s === undefined ? '' : s); };

    say('# Theme similarity spike — ' + MODEL);
    say();
    say(N + ' distinct themes · ' + allCen.length + ' pairs');
    say();
    say('| measure | min | median | max |');
    say('|---|---|---|---|');
    say('| raw cosine | ' + sim(allRaw[0]) + ' | ' + sim(allRaw[allRaw.length >> 1]) +
        ' | ' + sim(allRaw[allRaw.length - 1]) + ' |');
    say('| centered | ' + sim(allCen[0]) + ' | ' + sim(allCen[allCen.length >> 1]) +
        ' | ' + sim(allCen[allCen.length - 1]) + ' |');
    say();
    say('A narrow raw spread is the "everything is about God" effect. Centering should widen it.');
    say();

    say('## Closest pairs in the whole list');
    say();
    say('If these read as "those are the same idea", the approach works. `word` is plain');
    say('word-overlap — where it is low and `sim` is high, embeddings are earning their keep.');
    say();
    say('| sim | word | theme A | theme B |');
    say('|---|---|---|---|');
    const pairs = [];
    for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) pairs.push({ i, j, c: simCen[i][j] });
    }
    pairs.sort((a, b) => b.c - a.c).slice(0, 25).forEach((p) => {
        say('| ' + sim(p.c) + ' | ' + sim(jaccard(themes[p.i].text, themes[p.j].text)) +
            ' | ' + themes[p.i].text + ' | ' + themes[p.j].text + ' |');
    });
    say();

    say('## Most unique themes');
    say();
    say('| uniqueness | theme | closest equivalent | sim |');
    say('|---|---|---|---|');
    [...rows].sort((a, b) => b.uniqueness - a.uniqueness).slice(0, 15).forEach((r) => {
        say('| ' + pct(r.uniqueness) + ' | ' + r.text + ' | ' + r.nearest.o.text +
            ' | ' + sim(r.nearest.cen) + ' |');
    });
    say();

    say('## Most well-worn themes');
    say();
    say('| uniqueness | theme | closest equivalent | sim |');
    say('|---|---|---|---|');
    [...rows].sort((a, b) => a.uniqueness - b.uniqueness).slice(0, 15).forEach((r) => {
        say('| ' + pct(r.uniqueness) + ' | ' + r.text + ' | ' + r.nearest.o.text +
            ' | ' + sim(r.nearest.cen) + ' |');
    });
    say();

    // Does centering change the answer? If not, drop it and keep the code simpler.
    const flipped = rows.filter((r) => nearestBy(simRaw, r.i).j !== r.nearest.j);
    say('## Is mean-centering worth it?');
    say();
    say('Centering changes the nearest neighbour for ' + flipped.length + '/' + N +
        ' themes (' + pct((flipped.length / N) * 100) + ').');
    say();
    if (flipped.length) {
        say('| theme | raw pick | centered pick |');
        say('|---|---|---|');
        flipped.slice(0, 12).forEach((r) => {
            say('| ' + r.text + ' | ' + themes[nearestBy(simRaw, r.i).j].text +
                ' | ' + r.nearest.o.text + ' |');
        });
        say();
    }

    // The actual product moment: score a theme an editor is typing right now.
    if (TEST) {
        await embedAll([TEST]);
        const v = center(unit(cache[TEST]), mean);
        const ranked = themes
            .map((t, j) => ({ text: t.text, dates: t.dates || [], c: cosine(v, centered[j]) }))
            .sort((a, b) => b.c - a.c);
        const top3mean = ranked.slice(0, 3).reduce((s, x) => s + x.c, 0) / 3;
        const uniqueness = 100 - percentile(allTop3, top3mean);
        say('## Scoring a new theme: "' + TEST + '"');
        say();
        say('**Uniqueness ' + pct(uniqueness) + '** — more distinctive than ' +
            pct(uniqueness) + ' of the themes we have already preached.');
        say();
        ranked.slice(0, 5).forEach((r, n) => {
            const when = r.dates.length ? ' _(' + r.dates.join(', ') + ')_' : '';
            say((n + 1) + '. ' + sim(r.c) + ' — ' + r.text + when);
        });
        say();
    }

    fs.writeFileSync(REPORT, out.join('\n'));
    console.log('\nwritten to ' + path.relative(process.cwd(), REPORT));
}

main().catch((e) => { console.error(e); process.exit(1); });
