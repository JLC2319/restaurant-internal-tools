// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import node from '@astrojs/node';

// Every page in this app sits behind authentication, so there is nothing to
// prerender for SEO and no sitemap to publish. Pages are static shells; the
// React islands fetch their own data client-side.
export default defineConfig({
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  server: { port: 6218 },
  vite: {
    plugins: [tailwindcss()],
  },
});
