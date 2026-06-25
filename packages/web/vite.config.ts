import { defineConfig } from 'vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import solid from 'vite-plugin-solid';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/solid-start/plugin/vite'

export default defineConfig({
  plugins: [
    tanstackStart(),
    solid({
      ssr: true,
    }),
    		paraglideVitePlugin({
			project: '../../packages/shared/i18n/project.inlang',
			outdir: '../../packages/shared/i18n/paraglide',
			strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
		}),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:19109',
    },
  },
  ssr: {
		noExternal: ['solid-sonner', 'solid-js', '@kobalte/core'],
	},
});
