/**
 * Product naming is still open — see the "Potential Names" section of the
 * planning doc (Paratus, Paratus Culina, Nexus Kitchen, Core Culinary, Mise…).
 * Everything user-facing reads from here so a rename is a one-file change.
 * Package names use the neutral `@rit/*` scope for the same reason.
 */
export const siteName = 'Restaurant Internal Tools'
export const siteShortName = 'RIT'
export const siteTagline = 'Recipes, training and prep for the whole group'

export const navLinks = [
  { label: 'Recipes', href: '/recipes' },
  { label: 'Training', href: '/training' },
  { label: 'Allergens', href: '/allergens' },
  { label: 'R&D Bank', href: '/rd-bank' },
] as const
