import { defineConfig } from 'vite';

// base: './' — пути в собранном index.html будут относительными.
// Это обязательно для itch.io: игра там лежит не в корне домена,
// а в подпапке, и абсолютные пути ('/assets/...') не находятся.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0, // не вшивать мелкие картинки/звуки в JS — пусть лежат файлами
  },
});
