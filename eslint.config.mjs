import js from '@eslint/js';
import globals from 'globals';

// Correctness lint for the authored JS that the functions job does not cover.
// `functions/` keeps its own eslint (Google style, `npm run lint --prefix functions`).
// That script sets ESLINT_USE_FLAT_CONFIG=false. ESLint 8 turns flat config on
// when it finds this file walking up from `functions/`, and then the ignores
// below skip the whole functions tree.
//
// `public/` pages are classic scripts. A name declared in one file is a global
// in the next, which ESLint cannot see, so `no-undef` is off there and
// `no-unused-vars` only flags nested bindings (`vars: "local"`). A top-level
// function that exists for an HTML page or another script is not unused.
// Node programs (scripts, tests) use the full recommended set, including
// `no-undef` and top-level `no-unused-vars`.

const unusedLocal = ['error', {
    vars: 'local',
    args: 'none',
    caughtErrors: 'none',
    ignoreRestSiblings: true,
    varsIgnorePattern: '^_',
}];

const unusedAll = ['error', {
    vars: 'all',
    args: 'none',
    caughtErrors: 'none',
    ignoreRestSiblings: true,
    varsIgnorePattern: '^_',
    argsIgnorePattern: '^_',
}];

const recommended = js.configs.recommended.rules;

export default [
    {
        ignores: [
            'node_modules/**',
            'functions/**',
            'public/vendor/**',
            'build/**',
            'android/**',
            'ios/**',
            'coverage/**',
            '.firebase/**',
        ],
    },
    {
        files: ['public/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                firebase: 'readonly',
                Alpine: 'readonly',
                Capacitor: 'readonly',
            },
        },
        rules: {
            ...recommended,
            'no-undef': 'off',
            'no-unused-vars': unusedLocal,
            // An empty catch is a deliberate swallow. An empty if/else is not.
            'no-empty': ['error', { allowEmptyCatch: true }],
        },
    },
    {
        files: ['public/analytics.js'],
        languageOptions: {
            sourceType: 'module',
        },
    },
    {
        files: ['scripts/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: globals.node,
        },
        rules: {
            ...recommended,
            'no-unused-vars': unusedAll,
            'no-empty': ['error', { allowEmptyCatch: true }],
        },
    },
    {
        files: ['test/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                // Tests load browser scripts and name window/document.
                // Other page globals stay undefined so a typo still fails.
                window: 'readonly',
                document: 'readonly',
            },
        },
        rules: {
            ...recommended,
            'no-unused-vars': unusedAll,
            'no-empty': ['error', { allowEmptyCatch: true }],
        },
    },
    {
        files: ['scripts/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: globals.node,
        },
        rules: {
            ...recommended,
            'no-unused-vars': unusedAll,
            'no-empty': ['error', { allowEmptyCatch: true }],
        },
    },
];
