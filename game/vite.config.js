import { defineConfig } from 'vite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// dev-плагин: принимает сводку сессии от игры (POST /__session) и дописывает
// её строкой JSON в game/sessions.jsonl. Файл читаю я, чтобы анализировать прохождения.
// В сборке (itch.io) эндпоинта нет — клиентский fetch просто молча падает в catch.
const sessionLogger = {
  name: 'session-logger',
  configureServer(server){
    const file = fileURLToPath(new URL('./sessions.jsonl', import.meta.url));
    server.middlewares.use('/__session', (req, res, next) => {
      if(req.method !== 'POST') return next();
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try { fs.appendFileSync(file, body.trim() + '\n'); } catch(e){}
        res.statusCode = 204; res.end();
      });
    });
  },
};

// base: './' — пути в собранном index.html будут относительными.
// Это обязательно для itch.io: игра там лежит не в корне домена,
// а в подпапке, и абсолютные пути ('/assets/...') не находятся.
export default defineConfig({
  base: './',
  plugins: [sessionLogger],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0, // не вшивать мелкие картинки/звуки в JS — пусть лежат файлами
  },
});
