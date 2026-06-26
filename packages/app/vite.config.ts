import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
// bun add @inlang/paraglide-js  @tailwindcss/vite  @tanstack/devtools-vite @tanstack/router-plugin

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [		devtools(),
		paraglideVitePlugin({
			project: '../../packages/shared/i18n/project.inlang',
			outdir: '../../packages/shared/i18n/paraglide',
			strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
		}),
		tailwindcss(),
		tanstackRouter({ target: 'solid', autoCodeSplitting: true }),
		solid(),
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // prevent Vite from obscuring rust errors
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
