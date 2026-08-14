// Flat config for `expo lint` (Expo SDK 57 / ESLint 9).
// Formatting is Prettier's job at the repo root — this file is only for the
// correctness rules Prettier and tsc cannot see (hooks deps, unused symbols).
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*'],
  },
]);
