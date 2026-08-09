/** Type surface for colors.js — one palette object per token family. */
type Palette = {
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
};

declare const colors: {
  steel: Palette;
  ember: Palette;
  basil: Palette;
  citron: Palette;
  chili: Palette;
  salt: Palette;
};

export = colors;
