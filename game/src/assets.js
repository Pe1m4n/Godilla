import { loadImage } from './sprites.js';

// ────────────────────────────────────────────────────────────────────
// Графика сцены. Файлы лежат в assets/sprites/ и подключаются через import:
// Vite сам подставит правильный путь и в dev, и в сборке (оптимизирует, хеширует).
// Добавить новую картинку = добавить import + строку в FILES + ключ в art.
//
// (Папка public/ — для «кинул и работает» без правок кода; но раз эти ассеты
//  уже постоянные и лежат в assets/, импорт здесь правильнее.)
// ────────────────────────────────────────────────────────────────────

import skyUrl        from '../assets/sprites/sky.png';
import groundUrl     from '../assets/sprites/ground.png';
import grassUrl      from '../assets/sprites/grass.png';
import castleUrl     from '../assets/sprites/castle.png';
import cloud1Url     from '../assets/sprites/cloud-1.png';
import cloud2Url     from '../assets/sprites/cloud-2.png';
import cloud3Url     from '../assets/sprites/cloud-3.png';
import flagstockUrl  from '../assets/sprites/flagstock.png';
import flagmatterUrl from '../assets/sprites/flagmatter.png';
import dialogBoxUrl  from '../assets/sprites/ui-dialog-box.png';
import triangleUrl   from '../assets/sprites/triangle.png';
import bloodMiniUrl   from '../assets/sprites/blood-mini.png';
import bloodMediumUrl from '../assets/sprites/blood-medium.png';

const FILES = {
  sky: skyUrl, ground: groundUrl, grass: grassUrl, castle: castleUrl,
  cloud1: cloud1Url, cloud2: cloud2Url, cloud3: cloud3Url,
  flagstock: flagstockUrl, flagmatter: flagmatterUrl,
  dialogBox: dialogBoxUrl, triangle: triangleUrl,
  bloodMini: bloodMiniUrl, bloodMedium: bloodMediumUrl,
};

// ── курсор-рука: кадры 16×16, файлы back1.png … back33.png ──
// Vite собирает их пачкой через glob; собираем карту номер→адрес картинки.
const cursorUrls = import.meta.glob('../assets/sprites/cursor/back/back*.png',
  { eager: true, query: '?url', import: 'default' });
const CURSOR_FILES = {};
for (const [path, url] of Object.entries(cursorUrls)){
  const m = path.match(/back(\d+)\.png$/);
  if (m) CURSOR_FILES[+m[1]] = url;
}

// загруженные кадры курсора: номер → <img> (заполняется в loadArt)
export const cursorFrames = {};

// сюда складываются загруженные картинки; draw() в game.js смотрит на них.
// Пока картинка не догрузилась — null, и игра рисует запасной вариант.
export const art = {
  sky: null, ground: null, grass: null, castle: null,
  cloud1: null, cloud2: null, cloud3: null,
  flagstock: null, flagmatter: null,
  dialogBox: null, triangle: null,
  bloodMini: null, bloodMedium: null,
};

// запустить загрузку (ничего не блокирует — появятся в кадре по готовности)
export function loadArt(){
  return Promise.all([
    ...Object.entries(FILES).map(([k, u]) =>
      loadImage(u).then(img => { art[k] = img; }).catch(() => {})),
    ...Object.entries(CURSOR_FILES).map(([n, u]) =>
      loadImage(u).then(img => { cursorFrames[n] = img; }).catch(() => {})),
  ]);
}
