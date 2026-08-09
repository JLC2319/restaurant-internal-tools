/**
 * The design tokens from apps/web/tailwind.config.mjs, verbatim. CommonJS on
 * purpose: tailwind.config.js (Node, CJS) requires this file, and the app
 * imports it too, so icons and native-only styles use the exact same hex
 * values as every className. Change a colour here and both sides move.
 *
 * `chili` is reserved for allergens and danger only — see AGENTS.md §7.
 */
module.exports = {
  // Steel — brushed stainless. Primary chrome, headings, body text.
  steel: {
    50: '#f4f6f8',
    100: '#e3e8ed',
    200: '#c6d0da',
    300: '#9fb0c0',
    400: '#7189a0',
    500: '#526b83',
    600: '#3f5468',
    700: '#2f3f4f',
    800: '#1f2b36',
    900: '#11181f',
  },

  // Ember — the flame. Primary CTA and active state.
  ember: {
    50: '#fff4ed',
    100: '#ffe2d0',
    200: '#ffc0a1',
    300: '#ff9a6b',
    400: '#f9743c',
    500: '#e3541b',
    600: '#b94013',
    700: '#8c300e',
    800: '#5c1f09',
    900: '#2e0f04',
  },

  // Basil — fresh herb. Success, verified, approved.
  basil: {
    50: '#f0faf1',
    100: '#d5f2da',
    200: '#a8e3b3',
    300: '#72cd86',
    400: '#45b25f',
    500: '#2c9346',
    600: '#217537',
    700: '#185929',
    800: '#0f3a1b',
    900: '#071d0d',
  },

  // Citron — warning, and the "awaiting human review" state.
  citron: {
    50: '#fefbea',
    100: '#fdf3c4',
    200: '#fae389',
    300: '#f4cd49',
    400: '#e6b31d',
    500: '#c39311',
    600: '#9b720d',
    700: '#75550a',
    800: '#4d3806',
    900: '#271c03',
  },

  // Chili — allergen and danger ONLY.
  chili: {
    50: '#fef2f2',
    100: '#fddcdc',
    200: '#fab6b6',
    300: '#f38585',
    400: '#e85555',
    500: '#d02f2f',
    600: '#a92222',
    700: '#801a1a',
    800: '#551111',
    900: '#2b0808',
  },

  // Salt — near-white neutrals for surfaces, borders, muted text.
  salt: {
    50: '#fcfcfd',
    100: '#f6f7f9',
    200: '#eceef1',
    300: '#dde0e5',
    400: '#c3c8d0',
    500: '#9aa1ac',
    600: '#727a86',
    700: '#535a64',
    800: '#363b42',
    900: '#1b1e22',
  },
};
