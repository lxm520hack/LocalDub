import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'solid', autoCodeSplitting: true  }),
    solid(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:19109',
    },
  },
});
