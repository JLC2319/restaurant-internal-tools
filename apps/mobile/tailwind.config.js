const colors = require('./src/theme/colors.js');

/**
 * Same design language as apps/web, adapted for NativeWind. Differences that
 * are deliberate, not drift:
 *
 * - Font weights are separate families (`font-sans-semibold`, not
 *   `font-semibold`): Android renders custom fonts per-file, so each loaded
 *   weight needs its own fontFamily name.
 * - Named breakpoints match the web's, but on native they matter mostly for
 *   `tablet` — phone-first layout, more grid columns on iPad.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],

  theme: {
    screens: {
      mobile: '375px',
      phablet: '480px',
      tablet: '768px', // iPad portrait — more grid columns from here up
      laptop: '1024px',
      desktop: '1280px',
      wide: '1536px',
      ultra: '1920px',
    },

    fontSize: {
      '2xs': ['0.625rem', { lineHeight: '1rem' }],
      xs: ['0.75rem', { lineHeight: '1rem' }],
      sm: ['0.875rem', { lineHeight: '1.25rem' }],
      base: ['1rem', { lineHeight: '1.5rem' }],
      md: ['1.125rem', { lineHeight: '1.75rem' }],
      lg: ['1.25rem', { lineHeight: '1.75rem' }],
      xl: ['1.5rem', { lineHeight: '2rem' }],
      '2xl': ['1.875rem', { lineHeight: '2.25rem' }],
      '3xl': ['2.25rem', { lineHeight: '2.5rem' }],
      '4xl': ['3rem', { lineHeight: '1.1' }],
      '5xl': ['3.75rem', { lineHeight: '1' }],
    },

    extend: {
      colors,

      // One family name per loaded weight — see the note above.
      fontFamily: {
        sans: 'Inter_400Regular',
        'sans-medium': 'Inter_500Medium',
        'sans-semibold': 'Inter_600SemiBold',
        'sans-bold': 'Inter_700Bold',
        mono: 'JetBrainsMono_400Regular',
        'mono-semibold': 'JetBrainsMono_600SemiBold',
        'mono-bold': 'JetBrainsMono_700Bold',
      },

      // Gloved hands, greasy screens: 44px floor on anything tappable.
      minHeight: {
        touch: '44px',
      },
      minWidth: {
        touch: '44px',
      },
    },
  },

  plugins: [],
};
