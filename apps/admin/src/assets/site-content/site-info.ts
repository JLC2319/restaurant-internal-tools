/**
 * Console naming follows the product name, which is still open — see the
 * planning doc. Everything user-facing reads from here so a rename is a
 * one-file change, same as apps/web.
 */
export const siteName = 'RIT Platform Console'
export const siteShortName = 'RIT Console'
export const siteTagline = 'Provisioning and support for platform staff'

export const navLinks = [
  { label: 'Overview', href: '/' },
  { label: 'Organizations', href: '/organizations' },
  { label: 'Users', href: '/users' },
] as const
