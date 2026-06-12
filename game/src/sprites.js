import {
  DEMON_MAP, PALS_SMALL, PALS_BIG, PALS_HUGE,
  CYC_MAP, CYC_PAL,
} from './config.js';

// ────────────────────────────────────────────────────────────────────
// СЕЙЧАС спрайты «запекаются» из пиксельных карт прямо в коде (bake).
// Игровой код работает с готовыми <canvas>/<img>-объектами через drawImage,
// поэтому переход на настоящие картинки будет точечным:
//
//   1. Кладёшь PNG в game/assets/sprites/ (например small-0.png).
//   2. Грузишь их одной функцией (см. loadImage ниже) ДО старта игры.
//   3. Заменяешь содержимое SPRITES/CYC_SPRITE на загруженные <img>.
//
// Остальной код (render.js использует SPRITES[type][pal] и CYC_SPRITE)
// менять не придётся — он уже рисует объекты-картинки.
// ────────────────────────────────────────────────────────────────────

// запекает пиксельную карту в маленький canvas нужного цвета
export function bake(map, pal){
  const c = document.createElement('canvas');
  c.width = map[0].length; c.height = map.length;
  const g = c.getContext('2d');
  map.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    g.fillStyle = pal[ch]; g.fillRect(x, y, 1, 1);
  }));
  return c;
}

// Заготовка загрузчика картинок на будущее (вернёт промис с <img>).
// const small0 = await loadImage(new URL('../assets/sprites/small-0.png', import.meta.url).href);
export function loadImage(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export const SPRITES = {
  small: PALS_SMALL.map(p => bake(DEMON_MAP, p)),
  big:   PALS_BIG.map(p => bake(DEMON_MAP, p)),
  huge:  PALS_HUGE.map(p => bake(DEMON_MAP, p)),
};

export const CYC_SPRITE = bake(CYC_MAP, CYC_PAL);
