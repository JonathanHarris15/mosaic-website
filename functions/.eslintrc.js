module.exports = {
  // `shared/` is not authored here. It is copied verbatim from public/ by
  // scripts/sync-shared-to-functions.js, because functions/ deploys as its own
  // bundle and cannot require across into public/ (MS-20, ADR-0030). Those
  // files follow the browser code's style — four spaces, single quotes — and
  // reformatting them here would guarantee the copy diverged from its original
  // on the next sync. Lint them where they are written, not where they land.
  ignorePatterns: ["shared/**"],
  env: {
    es6: true,
    node: true,
  },
  parserOptions: {
    "ecmaVersion": 2018,
  },
  extends: [
    "eslint:recommended",
    "google",
  ],
  rules: {
    "no-restricted-globals": ["error", "name", "length"],
    "prefer-arrow-callback": "error",
    "quotes": ["error", "double", {"allowTemplateLiterals": true}],
  },
  overrides: [
    {
      files: ["**/*.spec.*"],
      env: {
        mocha: true,
      },
      rules: {},
    },
  ],
  globals: {},
};
