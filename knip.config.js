const { readdirSync, readFileSync, statSync } = require('node:fs');
const path = require('node:path');

// Pages load classic scripts by URL. Those <script src> tags are the entries.
// Knip follows require() from there, from tests, and from functions/index.js.
// scripts/ are entries too: they are run by name (`node scripts/…`), not imported.

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

function htmlScriptEntries() {
    const entries = [];
    for (const file of walk('public')) {
        if (!file.endsWith('.html')) continue;
        const html = readFileSync(file, 'utf8');
        for (const match of html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) {
            const src = match[1];
            if (/^(https?:)?\/\//.test(src)) continue;
            if (src.includes('vendor/')) continue;
            entries.push(path.normalize(path.join(path.dirname(file), src.split('?')[0])));
        }
    }
    return [...new Set(entries)];
}

// Native shells and the asset generator. Nothing in JS imports them;
// Capacitor and the stores do. A test pins @capacitor/push-notifications
// in package.json, so these are not dead dependencies.
const CAPACITOR = [
    '@capacitor/android',
    '@capacitor/app',
    '@capacitor/assets',
    '@capacitor/cli',
    '@capacitor/core',
    '@capacitor/ios',
    '@capacitor/push-notifications',
];

// Not missing installs: sharp is loaded from @capacitor/assets, playwright is
// an optional screenshot tool this repo does not install, and the MCP SDK is
// declared in functions/package.json (root tests import that copy).
const NOT_ROOT_DEPS = ['sharp', 'playwright', '@modelcontextprotocol/sdk'];

// Authored copies knip cannot see: sync-shared-to-functions.js names them in
// MODULES and copies them into functions/shared. Requiring the script is safe;
// it only writes when it is the main module.
const { MODULES } = require('./scripts/sync-shared-to-functions.js');
const syncedEntries = MODULES.map((name) => path.join('public', name));

module.exports = {
    ignoreDependencies: [...CAPACITOR, ...NOT_ROOT_DEPS],
    ignoreBinaries: ['java'],
    workspaces: {
        '.': {
            entry: [
                'scripts/**/*.{js,mjs,cjs}',
                'test/**/*.js',
                ...htmlScriptEntries(),
                ...syncedEntries,
            ],
            project: [
                'public/**/*.js',
                'scripts/**/*.{js,mjs,cjs}',
                'test/**/*.js',
            ],
            ignore: ['public/vendor/**'],
        },
        functions: {
            entry: ['index.js'],
            // Top-level functions only. functions/shared is a generated copy;
            // knip still follows require() into a file that is actually imported.
            project: ['*.js'],
            ignore: ['node_modules/**'],
        },
    },
};
