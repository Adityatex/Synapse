const js = require('@eslint/js');
const globals = require('globals');

/**
 * P0-11 — Minimal server lint gate (mirrors the client gate).
 * CommonJS Node service: eslint:recommended + node globals.
 */
module.exports = [
  { ignores: ['node_modules/', 'coverage/', 'dist/'] },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    ...js.configs.recommended,
  },
];
