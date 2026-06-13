import {
  DEMON_MAP, PALS_SMALL, PALS_BIG, PALS_HUGE,
  DOG_MAP, PALS_DOG, PALS_ROLLER, PALS_BOMBER,
  BAT_MAP, PALS_BAT, PALS_WISP, PALS_CASTER, PALS_MOLE,
  CYC_MAP, CYC_PAL, SPELL_MAPS, SPELL_PALS,
  HORN_MAP, HORN_PAL,
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

// Перекрашивает белый силуэт (форма в альфе) в сплошной цвет col.
// Берёт исходную картинку, оставляет её форму, но заливает целиком цветом.
// Тени внутри спрайта при этом сплющиваются — спрайт должен быть белым силуэтом.
export function tint(img, col){
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = col;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

export const SPRITES = {
  small:  PALS_SMALL.map(p => bake(DEMON_MAP, p)),
  big:    PALS_BIG.map(p => bake(DEMON_MAP, p)),
  huge:   PALS_HUGE.map(p => bake(DEMON_MAP, p)),
  dog:    PALS_DOG.map(p => bake(DOG_MAP, p)),
  roller: PALS_ROLLER.map(p => bake(DEMON_MAP, p)),
  bomber: PALS_BOMBER.map(p => bake(DEMON_MAP, p)),
  bat:    PALS_BAT.map(p => bake(BAT_MAP, p)),
  wisp:   PALS_WISP.map(p => bake(BAT_MAP, p)),
  caster: PALS_CASTER.map(p => bake(DEMON_MAP, p)),
  mole:   PALS_MOLE.map(p => bake(DEMON_MAP, p)),
};

export const CYC_SPRITE = bake(CYC_MAP, CYC_PAL);

export const HORN_SPRITE = bake(HORN_MAP, HORN_PAL);

export const SPELL_SPRITES = Object.fromEntries(
  Object.entries(SPELL_MAPS).map(([k, m]) => [k, bake(m, SPELL_PALS[k])])
);
