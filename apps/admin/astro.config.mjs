// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import node from '@astrojs/node';

// The platform console. Same shape as apps/web — static shells, React islands
// fetching client-side — on its own port so both apps can run at once in dev.
export default defineConfig({
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  server: { port: 4322 },
  vite: {
    plugins: [tailwindcss()],
  },
});
