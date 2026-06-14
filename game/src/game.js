import {
  // SPD_MED/SPD_HARD не импортируем: наша боёвка (combat rework) даёт ровный урон,
  // пороги по скорости из dev не используются. SPELL_NAMES нужен законсервированной панели.
  CFG, GRAV, TYPES, SPD_LIGHT,
  CYC_PAL, CYC_PX, CYC_W, CYC_H, CYC_EYE, DRG_W, DRG_H, SPELL_NAMES,
} from './config.js';
import { SPRITES, CYC_SPRITE, DRAGON_SPRITE, SPELL_SPRITES, tint } from './sprites.js';
import { sfx, setMuted as setSfxMuted, setMasterVolume, setSfxDebugSink } from './audio.js';
import { music } from './music.js';
import { art, cursorFrames } from './assets.js';
import {
  initTutorial, resetTutorial, tutorialActive, tutorialDemon,
  tutorialOnFirstDemon, tutorialComplete, drawTutorial,
  tutorialFrozen, tutorialMsgActive, tutorialMsgKey, tutorialMsgDismiss,
  tutorialTryMessage, dismissTutorialMessage, drawTutorialMask,
  tutorialTick, tutorialMsgLocked, tutorialActiveLocked, tutorialMsgTime,
} from './tutorial.js';
import { initUIText, floatText, label, hideLabel } from './uitext.js';
import {
  initDialogue, startDialogue, dialogueActive, dialogueClick, updateDialogue, drawDialogue,
} from './dialogue-ui.js';

const cv = document.getElementById('game');
const cx = cv.getContext('2d');
cx.imageSmoothingEnabled = false;
// отдельный холст для пылинок — лежит поверх стартового экрана (см. #dust в index.html)
const dustCv = document.getElementById('dust');
const dcx = dustCv.getContext('2d');

// Пиксельный шрифт для текста на канвасе. Размеры — только кратные 8
// (нативная сетка Press Start 2P): иначе глифы попадают между пикселями
// холста 960×540 и мылятся при растягивании на весь экран.
const FONT = '"Press Start 2P", monospace';

const W = cv.width, H = cv.height;
const GROUND_Y = H - 130;
const MOUNTAIN_X = 195;          // где демоны/циклоп упираются во врата Асгарда (правый край стены)
const CASTLE_SINK = 6;           // на сколько пикселей опустить замок ниже линии земли

// ── стена замка: коллизия для летящих и удерживаемых мобов (тюнинг) ──
// x — правая грань стены; top — y кромки каменной кладки (рога — декор, без коллизии).
// Ниже кромки моб стукается о стену как об землю и получает урон по скорости;
// выше — пролетает и может упасть уже в защищаемой зоне за стеной.
// top = GROUND_Y - 329 + CASTLE_SINK + 51 (камень в castle.png начинается на 51px от верха)
const WALL = { x: MOUNTAIN_X, top: 138 };
// Верх каменной башни: горизонтальная поверхность, об которую летящие юниты бьются сверху.
const TOWER_ROOF = { left: 72, right: MOUNTAIN_X, y: WALL.top };
const FIRE = CFG.fire;
const BRAZIERS = FIRE.braziers;   // два огонька в золотых навершиях крыши

// слоты заклинаний — внизу экрана по центру (панель сейчас отключена, см. drawSpellUI)
const SLOT = CFG.spells.slotSize, SLOT_GAP = 16;
const SLOT_X = (W - (SLOT*3 + SLOT_GAP*2)) / 2;
const SLOT_Y = H - SLOT - 18;

// размер моба в пикселях экрана
const sizeOf = d => 9 * TYPES[d.type].px;

// обучающий модуль: отдаём ему контекст отрисовки (см. tutorial.js)
initTutorial({ cx, W, H, FONT, sizeOf });
// слой HTML-текста поверх холста (всплывашки, подписи) — см. uitext.js
initUIText();
// окно диалога: тот же контекст отрисовки (см. dialogue-ui.js)
initDialogue({ cx, W, H, FONT });

// ── облака: плывут на фоне (x,y в дизайн-координатах, spd — px/сек, минус = влево) ──
// charge: null | 'storm' — заряженную грозовую тучу можно кликнуть (см. triggerCloud)
const clouds = [
  { key:'cloud1', x: 240, y: 64,  spd: -34, charge:null },
  { key:'cloud2', x: 560, y: 120, spd: -23, charge:null },
  { key:'cloud3', x: 830, y: 52,  spd: -45, charge:null },
];
let nextCharge = rnd(CFG.sky.chargeMin, CFG.sky.chargeMax);
const cloudW = c => art[c.key] ? art[c.key].width  : 210;
const cloudH = c => art[c.key] ? art[c.key].height : 90;
function updateClouds(dt){
  for(const c of clouds){
    const w = cloudW(c);
    c.x += c.spd * dt;
    // грозовая туча держит заряд, пока не доплывёт до башни — там гаснет (шанс упущен)
    if(c.charge && c.x + w/2 <= WALL.x) c.charge = null;
    if(c.x + w < -40) c.x = W + 40;       // уплыло влево — заводим справа
    else if(c.x > W + 40) c.x = -w - 40;
  }
  // стандартная зарядка туч — только в бою, ПОСЛЕ срежиссированной первой грозы
  // (см. updateIntroScript) и не в отладочном режиме локации
  if(running && !choosing && introCloudDone && !debugLocation){
    nextCharge -= dt;
    if(nextCharge <= 0){
      chargeCloud();
      // «Громовержец»: тучи заряжаются чаще
      nextCharge = rnd(CFG.sky.chargeMin, CFG.sky.chargeMax) / (1 + CFG.skills.stormcaller.mult * sk('stormcaller'));
    }
  }
}

// зарядить одно спокойное облако грозой (нужно место до башни)
function chargeCloud(){
  const idle = clouds.filter(c => !c.charge && c.x + cloudW(c)/2 > WALL.x + 140);
  if(!idle.length) return;
  const c = idle[(Math.random()*idle.length)|0];
  c.charge = 'storm';
  floatText(c.x + cloudW(c)/2, c.y + cloudH(c)/2, 'ГРОЗА — КЛИКНИ!', '#2a3a7a', 1.8);
}

// клик по грозовой туче: бьёт молнией строго вниз
// ближайшие НАЗЕМНЫЕ цели к точке (sx) по горизонтали в радиусе r (летающих не берём),
// отсортированы по дистанции; не больше count штук
function nearestGroundTargets(sx, r, count){
  const cand = [];
  for(const d of demons){
    if(TYPES[d.type].air) continue;  // летающих (bat/wisp) молния не выбирает
    if(d.state==='held' || d.state==='offscreen' || d.state==='burrow' || d.state==='fly') continue; // только на земле
    const s = sizeOf(d), cx0 = d.x + s/2;
    const dx = Math.abs(cx0 - sx);
    if(dx <= r) cand.push({ x: cx0, y: d.y + s/2, dx });
  }
  cand.sort((a, b) => a.dx - b.dx);
  return cand.slice(0, count);
}

function triggerCloud(c){
  const cxp = c.x + cloudW(c)/2, cyp = c.y + cloudH(c)*0.6;
  stats.lightning++;
  const n = 1 + sk('stormBurst');   // «Шквал»: туча бьёт несколькими молниями
  const targets = nearestGroundTargets(cxp, CFG.spells.lightning.seekR, n);
  for(let i = 0; i < n; i++){
    const t = targets[i];
    if(t) castLightning(cxp, cyp, t.x - cxp, t.y - cyp);            // навёлся на наземную цель
    else  castLightning(cxp + (i - (n-1)/2) * 42, cyp, 0, 1);       // нет цели — бьёт вниз (веером)
  }
  c.charge = null;
}

// ── раскладка флага (тюнинг) ──
// Y заданы в пикселях от НИЗА экрана (экран 540 → y_холста = 540 - высота).
// X прикинут по референсу — двигай эти числа, если флаг стоит не там.
const FLAG = {
  stockX: 201,  stockBottom:  540 - 331, // флагшток: низ на высоте 331 → y=209
  bannerX: 222, bannerBottom: 540 - 267, // полотно: левый-низ на высоте 267 → y=273
};

// ── god rays: лучи света из-за облаков, падают на замок (тюнинг) ──
// Источник — над верхней кромкой ближе к центру экрана, как будто солнце за облаками.
const GODRAYS = {
  src: { x: 480, y: -70 },  // откуда светит (выше экрана)
  color: '255, 243, 196',   // тёплый свет, r,g,b
  alpha: 0.14,              // базовая яркость (0 — выключить)
  sway: 10,                 // насколько гуляет точка падения, px
  swaySpeed: 0.25,          // скорость покачивания
  pulseSpeed: 0.5,          // скорость «дыхания» яркости
  // x — куда падает луч (у земли), w — полуширина там, srcW — полуширина у источника
  beams: [
    { x: 60,  w: 58, srcW: 8, phase: 0.0 },
    { x: 140, w: 44, srcW: 6, phase: 2.1 },
    { x: 205, w: 32, srcW: 5, phase: 4.4 },
  ],
};

// ── дым из труб домиков (фоновая атмосфера, тюнинг) ──────────────────
// В левом-нижнем углу спрайта замка стоят три домика; из каждой трубы
// поднимается дымок. Точки спауна — экранные координаты верха труб (от
// верхнего-левого угла холста 960×540). Дым поднимается вверх-влево по
// слегка извилистой траектории и довольно быстро уходит за край экрана.
// Спрайт каждой струйки выбирается случайно (smoke1..smoke4); новые рисуются
// поверх старых (просто порядок в массиве). Анимируется всегда — как облака.
const SMOKE = {
  debug:    false, // ДЕБАГ: рисовать красные точки в местах спауна (трубы + жаровни)
  vents: [ {x:3, y:392}, {x:21, y:392}, {x:42, y:392} ], // верх каждой трубы
  every:    0.30,  // средний интервал между затяжками на одной трубе, сек (часто — густой дым)
  everyVar: 0.5,   // случайный разброс интервала (× every)
  rise:     10,    // базовая скорость подъёма вверх, px/сек (помедленнее)
  drift:    17,    // снос влево, px/сек (минус по x)
  sway:     10,    // амплитуда бокового покачивания «дымной» траектории, px
  swaySpeed:1.6,   // как быстро виляет струйка
  grow:     16,    // на сколько px вырастает клуб
  size0:    7,     // стартовый размер клуба, px
  growTime: 4.2,   // за сколько секунд клуб дорастает до полного размера
  alpha:    0.85,  // постоянная прозрачность (без проявления/затухания)
  // дым из жаровен (когда разгорелись): тот же дым, но крупнее с самого начала
  // и чуть чернее
  brazier:  { every: 0.22, dark: 0.35, size0: 13, grow: 22, yOff: -10 },
  // дым с горящего моба: ещё темнее, почти чёрный; размер от размера моба
  burn:     { every: 0.08, dark: 0.72, size0Mul: 0.40, growMul: 0.55, riseMul: 1.3, life: 1.5 },
};

// ── вечерний оттенок (полноэкранный спрайт Tint) ─────────────────────
// Со временем вечереет: спрайт всё заметнее. В начале не виден (непрозрачность 0),
// затем со 2-й минуты игры плавно проявляется по 1% непрозрачности в минуту и к
// 10-й минуте доходит до потолка 8% (т.е. прозрачность падает со 100% до 92%).
// Привязан к gameTime — копится только в активной игре и сам сбрасывается при рестарте.
const TINT = {
  startMin: 2,    // с какой минуты начинает проявляться
  perMin:   0.01, // прирост непрозрачности за минуту (1%)
  maxAlpha: 0.08, // потолок непрозрачности (8% → прозрачность 92%), достигается к 10-й мин
};
function tintAlpha(){
  const min = gameTime / 60;
  return Math.max(0, Math.min(TINT.maxAlpha, (min - TINT.startMin) * TINT.perMin));
}
let smokePuffs = [];
// Один клуб дыма. opts: dark (0..1 — сколько черноты подмешать), size0/grow
// (размер; по умолчанию — как у труб), riseMul (множитель скорости подъёма).
function spawnSmoke(x, y, opts = {}){
  smokePuffs.push({
    x0: x, y, t: 0,
    vx: -SMOKE.drift * rnd(0.7, 1.3),
    vy: -SMOKE.rise  * rnd(0.8, 1.2) * (opts.riseMul || 1),
    phase: rnd(0, Math.PI*2),                  // фаза покачивания
    spr: 'smoke' + (1 + (Math.random()*4|0)),  // случайный спрайт 1..4
    dark: opts.dark || 0,
    size0: opts.size0 != null ? opts.size0 : SMOKE.size0,
    grow:  opts.grow  != null ? opts.grow  : SMOKE.grow,
    life:  opts.life != null ? opts.life : null, // null → живёт пока не уйдёт за край
  });
}

// Затемнённые версии спрайтов дыма кэшируются по «спрайт|чернота»: чернота
// подмешивается только в непрозрачные пиксели (source-atop), форма сохраняется.
const smokeDarkCache = {};
function darkSmokeSprite(sprKey, amount){
  const key = sprKey + '|' + Math.round(amount*100);
  if(smokeDarkCache[key]) return smokeDarkCache[key];
  const img = art[sprKey];
  if(!img) return null;                          // ещё не догрузилось
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = amount; g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  return (smokeDarkCache[key] = c);
}

// у каждой трубы и каждой жаровни — свой таймер до следующей затяжки
let smokeTimers   = SMOKE.vents.map(() => rnd(0, SMOKE.every));
let brazierTimers = BRAZIERS.map(() => rnd(0, SMOKE.brazier.every));
function updateSmoke(dt){
  // спавн новых клубов из каждой трубы домиков
  for(let i = 0; i < SMOKE.vents.length; i++){
    smokeTimers[i] -= dt;
    if(smokeTimers[i] <= 0){
      spawnSmoke(SMOKE.vents[i].x, SMOKE.vents[i].y);
      smokeTimers[i] = SMOKE.every * (1 + rnd(-SMOKE.everyVar, SMOKE.everyVar));
    }
  }
  // дым из жаровен — только когда они разгорелись
  if(braziersLit){
    const b = SMOKE.brazier;
    for(let i = 0; i < BRAZIERS.length; i++){
      brazierTimers[i] -= dt;
      if(brazierTimers[i] <= 0){
        spawnSmoke(BRAZIERS[i].x, BRAZIERS[i].y + b.yOff, { dark: b.dark, size0: b.size0, grow: b.grow });
        brazierTimers[i] = b.every * (1 + rnd(-SMOKE.everyVar, SMOKE.everyVar));
      }
    }
  }
  // движение/старение; вычисляем экранный x с учётом покачивания
  for(const p of smokePuffs){
    p.t += dt;
    p.y += p.vy * dt;
    p.x0 += p.vx * dt;
    p.x = p.x0 + Math.sin(p.phase + p.t * SMOKE.swaySpeed) * SMOKE.sway;
  }
  // убираем ТОЛЬКО когда клуб полностью пересёк край экрана (влево или вверх) —
  // без затухания: пропадает, лишь когда даже его дальний край ушёл за границу
  smokePuffs = smokePuffs.filter(p =>
    (p.life == null || p.t < p.life) && p.x + (p.size0 + p.grow)/2 > 0 && p.y > 0);
}
function drawSmoke(){
  for(const p of smokePuffs){
    const img = p.dark > 0 ? darkSmokeSprite(p.spr, p.dark) : art[p.spr];
    if(!img) continue;
    const k = Math.min(1, p.t / SMOKE.growTime); // 0..1 рост размера
    const sz = p.size0 + p.grow * k;              // клуб растёт по мере подъёма
    // дым труб/жаровен — постоянная прозрачность (уходит за край). Дым с life
    // (мобы) плавно гаснет в последней половине жизни и исчезает.
    let a = SMOKE.alpha;
    if(p.life != null) a *= Math.min(1, (1 - p.t / p.life) / 0.5);
    cx.globalAlpha = a;
    const h = sz * (img.height / img.width);
    // без Math.round: при медленном подъёме округление до целого пикселя
    // даёт рывки (дрожь). Дыму субпиксельное положение не вредит.
    cx.drawImage(img, p.x - sz/2, p.y - h, sz, h);
  }
  cx.globalAlpha = 1;
  // ДЕБАГ: красные точки в местах спауна — трубы домиков (дым) и жаровни (огонь+дым).
  // Поставь SMOKE.debug=false, чтобы убрать.
  if(SMOKE.debug){
    cx.fillStyle = '#ff0000';
    for(const v of SMOKE.vents){
      cx.beginPath(); cx.arc(v.x, v.y, 1.5, 0, Math.PI*2); cx.fill();
    }
    for(const bz of BRAZIERS){
      cx.beginPath(); cx.arc(bz.x, bz.y, 1.5, 0, Math.PI*2); cx.fill();
    }
  }
}

// ── огонь на жаровнях: квадратные пиксели ────────────────────────────
// Пиксель спавнится крупным и почти белым, поднимается вверх, уменьшаясь и
// меняя цвет по стадиям (белый → жёлтый → оранжевый → красный), потом исчезает.
// Смена цвета и уменьшение быстрые (короткая жизнь частицы). Рисуется квадратами
// fillRect (целые пиксели), без 'lighter' — чтобы цвета были честными, не сливались в белый.
const BRZ = {
  colors: ['#efe8e3', '#e2a028', '#df7a3c', '#be3824'], // почти белый → жёлтый → оранж → красный
  every:    0.04,  // как часто каждая жаровня выбрасывает пиксель, сек
  size0Min: 6.6,   // стартовый размер пикселя (крупный), px (+10%)
  size0Max: 9.9,
  rise:     55,    // скорость подъёма, px/сек
  riseVar:  0.4,   // разброс скорости (× rise)
  drift:    6,     // боковой разброс скорости, px/сек
  spread:   5,     // горизонтальный разброс точки спауна вокруг центра жаровни, px
  life:     0.6,   // сек — короткая жизнь (быстрая смена цвета и уменьшение)
  lifeVar:  0.3,   // разброс жизни (× life)
  bomberScale: 0.5,// фитиль бомбера: тот же огонь, но мельче (без дыма)
  // огонь по телу горящего моба — масштаб и густота от размера моба
  mob: { every: 0.06, widthPer: 12, maxCount: 14, sizeRef: 40, scaleMin: 0.45, scaleMax: 1.5 },
};
// линейная интерполяция между двумя hex-цветами (t 0..1)
function lerpHex(a, b, t){
  const p = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  const [ar,ag,ab] = p(a), [br,bg,bb] = p(b);
  return `rgb(${Math.round(ar+(br-ar)*t)},${Math.round(ag+(bg-ag)*t)},${Math.round(ab+(bb-ab)*t)})`;
}
let brzFire = [];
let brzTimers = BRAZIERS.map(() => 0);
// один пиксель огня (жаровни/фитиль бомбера). scale<1 — мельче (размер, разлёт,
// подъём масштабируются), цвета и время жизни — те же.
function spawnBrzFire(x, y, scale = 1){
  brzFire.push({
    x: x + rnd(-BRZ.spread, BRZ.spread) * scale,
    y: y + rnd(-2, 2) * scale,
    vx: rnd(-BRZ.drift, BRZ.drift) * scale,
    vy: -BRZ.rise * (1 + rnd(-BRZ.riseVar, BRZ.riseVar)) * scale,
    t: 0, life: BRZ.life * (1 + rnd(-BRZ.lifeVar, BRZ.lifeVar)),
    size0: rnd(BRZ.size0Min, BRZ.size0Max) * scale,
  });
}
// огонь по телу сущности шириной w / высотой h (от x0,y0): масштаб и густота
// пикселей берутся от размера — мелкий моб коптит слабо, циклоп — мощно
function emitMobFire(x0, y0, w, h){
  const m = BRZ.mob;
  const sc = Math.max(m.scaleMin, Math.min(m.scaleMax, w / m.sizeRef));
  const n = Math.max(1, Math.min(m.maxCount, Math.round(w / m.widthPer)));
  for(let j = 0; j < n; j++)
    spawnBrzFire(x0 + rnd(w*0.15, w*0.85), y0 + rnd(h*0.2, h*0.65), sc);
}
function updateBrzFire(dt){
  if(braziersLit){
    for(let i = 0; i < BRAZIERS.length; i++){
      brzTimers[i] -= dt;
      while(brzTimers[i] <= 0){
        brzTimers[i] += BRZ.every;
        spawnBrzFire(BRAZIERS[i].x, BRAZIERS[i].y, 1);
      }
    }
  }
  for(const d of demons){
    if(d.state === 'offscreen' || d.state === 'burrow') continue;
    const s = sizeOf(d);
    // фитиль бомбера — тот же огонь, мельче (скейл 0.5), без дыма
    if(d.type === 'bomber'){
      d.fuseT = (d.fuseT || 0) - dt;
      while(d.fuseT <= 0){
        d.fuseT += BRZ.every;
        spawnBrzFire(d.x + s/2, d.y + s*0.06, BRZ.bomberScale);
      }
    }
    // горящий моб — пиксельный огонь по всему телу, под его размер
    if(burning(d)){
      d.fireT = (d.fireT || 0) - dt;
      while(d.fireT <= 0){ d.fireT += BRZ.mob.every; emitMobFire(d.x, d.y, s, s); }
    }
  }
  // горящие циклопы — огонь под размер тела босса
  for(const c of cyclopes){
    if(!burning(c)) continue;
    c.fireT = (c.fireT || 0) - dt;
    while(c.fireT <= 0){ c.fireT += BRZ.mob.every; emitMobFire(c.x, c.y, CYC_W, CYC_H); }
  }
  for(const p of brzFire){ p.t += dt; p.x += p.vx*dt; p.y += p.vy*dt; }
  brzFire = brzFire.filter(p => p.t < p.life);
}
function drawBrzFire(){
  const nseg = BRZ.colors.length - 1;
  for(const p of brzFire){
    const k = p.t / p.life;                       // 0..1 прогресс жизни
    const seg = k * nseg;
    const i = Math.min(nseg - 1, Math.floor(seg)); // на каком отрезке цветов
    cx.fillStyle = lerpHex(BRZ.colors[i], BRZ.colors[i+1], seg - i);
    const sz = Math.max(1, Math.round(p.size0 * (1 - k))); // уменьшается к концу
    cx.fillRect(Math.round(p.x - sz/2), Math.round(p.y - sz/2), sz, sz);
  }
}

// ── зернистость: статичный плёночный шум поверх всей картинки (тюнинг) ──
// Живёт в DOM-слое #grain поверх игры и НЕ масштабируется вместе с холстом,
// поэтому зерно остаётся мелким (в пикселях монитора) даже в полном экране.
const GRAIN = {
  opacity: 0.04, // сила зерна (0 — выключить)
  size: 192,     // размер тайла шума, px монитора
};
{
  const c = document.createElement('canvas');
  c.width = c.height = GRAIN.size;
  const g = c.getContext('2d');
  const img = g.createImageData(GRAIN.size, GRAIN.size);
  for(let i = 0; i < img.data.length; i += 4){
    const v = (Math.random()*255)|0;
    img.data[i] = img.data[i+1] = img.data[i+2] = v;
    img.data[i+3] = 255;
  }
  g.putImageData(img, 0, 0);
  const grainEl = document.getElementById('grain');
  grainEl.style.backgroundImage = `url(${c.toDataURL()})`;
  grainEl.style.opacity = GRAIN.opacity;
}

// ── кровь ──────────────────────────────────────────────────────────
// Толщина любого пятна крови ограничена сверху: даже огромные лужи (циклоп) не
// толще обычной «средней» лужи. По длине/ширине пятно растёт свободно — упирается
// только толщина (поперечный размер спрайта). ≈ толщина medium-лужи в её максимуме.
const MAX_BLOOD_THICK = 13;
// Цвет крови по типу моба (по умолчанию — из CFG.blood).
function bloodCol(type){ return CFG.blood.byType[type] || CFG.blood.defaultCol; }
// «Мелкокровные» мобы: после них маленькая лужа (mini-спрайт, малый радиус, мало
// брызг) независимо от размера спрайта.
const SMALL_BLOOD = new Set(['small', 'dog', 'bat', 'wisp', 'caster', 'mole']);
// Какой спрайт лужи: у мелкокровных — mini, у остальных — medium.
function bloodSize(type){ return SMALL_BLOOD.has(type) ? 'mini' : 'medium'; }
// Перекрашенные спрайты крови кэшируются по «размер|цвет» — красим один раз.
const bloodCache = {};
function bloodSprite(size, col){
  const key = size + '|' + col;
  if (bloodCache[key]) return bloodCache[key];
  const img = size === 'mini' ? art.bloodMini : art.bloodMedium;
  if (!img) return null;                 // ещё не догрузилось — будет запасной эллипс
  return (bloodCache[key] = tint(img, col));
}

// ── состояние ──────────────────────────────────────────────────────
let demons = [], puddles = [], particles = [], cyclopes = [], shockwaves = [];
let blasts = []; // огненные шары-вспышки (взрыв бомбера): {x,y,r,max,life,maxLife}
let bolts = [], boulders = [], windStreaks = [], shots = [], tornadoes = [];
let heldBoulder = null; // отобранный у носильщика валун в руке: {x, y}
// ── боссы (последовательность из трёх) ──
let fireballs = [];     // огненные шары дракона: летят к стене; пойманные — обратно
let pendingFB = [];     // отложенные выстрелы дракона (задержка между двумя в ярости)
let heldFireball = null;// пойманный фаербол в руке (следует за курсором)
let dragons = [];       // 3-й босс. Массив: в основной игре один, в бесконечном — парами
let braziersLit = false;// разгорелись ли жаровни на крыше (на 2-й минуте, см. CFG.fire.litAt)
// контроллер появления боссов: каждый выходит один раз в свой момент
let boss1Spawned = false, boss2Spawned = false, boss2Dead = false;
let dragonSpawned = false, dragonTimer = 0, dragonRoared = false, won = false;
// машина финала после смерти дракона. Фазы (см. updateFinale):
// null → 'pause' → 'dlgVictory' → 'horde' → 'lightningKill' → 'dlgThor' → 'victoryScreen' → 'endless'
let finale = null, finaleT = 0;
// бесконечный режим: время в нём (для эскалации) и планировщик боссов-пар
let endlessT = 0, endlessBossCount = 0, endlessNextBossAt = 0;
// врата неуязвимы от смерти дракона до момента, когда молнии Тора выкосят всю орду
let gateInvuln = false;
function gateImmune(){ return gateInvuln; }
// размеры спрайта дракона приходят из пиксельной карты (DRAGON_MAP/DRG_W/DRG_H в config.js)
// данные законсервированной панели заклинаний (см. drawSpellUI — сейчас не вызывается)
let spellSlots = [{id:'lightning', cd:0}, {id:'boulder', cd:0}, {id:'wind', cd:0}];
let heldSpell = null;   // заклинание в руке: {id, slot, x, y}
// воздушные завихрения в небе: кликни — встаёт торнадо. {x, y, spd}
let swirls = [];
let nextSwirl = rnd(CFG.tornado.swirlMin, CFG.tornado.swirlMax);
const SWIRL_R = 30;     // радиус клика/иконки завихрения
let score = 0, hp = 100;
let gameTime = 0, spawnTimer = 0, cyclopsTimer = 0, threat = 1;
let hugeSeen = false; // появился ли уже первый «huge» — по нему музыка переходит в боевую
// знакомство с типами: какие игрок уже видел и когда была последняя «премьера» нового типа.
// Новый тип выходит впервые в одиночку и с паузой introGap после прошлой премьеры —
// чтобы игрок не встречал двух незнакомцев разом (см. pickStreamType).
let seenTypes = new Set();
let lastDebutAt = -999;
let lastPickedDebut = false;
let firstSpawnPending = true; // первый моб партии (туториальный) выходит сразу на экране
const TUTORIAL_DEBUT_TYPES = new Set(['big', 'caster', 'mole', 'roller']);
// одноразовые события срежиссированного начала (см. updateIntroScript / CFG.intro)
let introPackDone = false, introSwirlDone = false, introHugeDone = false, introCloudDone = false;
let rollerDebutT = 0; // >0 — идёт спец-дебют роллера: отсчёт до выхода самого роллера на экран
let lastRollerAt = -999; // когда последний раз вышел роллер (для кулдауна в бесконечном режиме)
const FIRE_PERKS = new Set(['pyro', 'inferno', 'wildfire', 'emberSmash', 'stormConduit', 'wildSpread', 'fireVortex', 'infernoThrow', 'ashSlam']);
let player = { level: 0, xp: 0, xpNeed: CFG.leveling.baseXP, skills: {} };
let pendingLevels = 0, choosing = false;
// Прокачка перками — НЕ часть основной игры: механика «спит» весь забег и
// включается только при входе в бесконечный режим (см. startEndless). В основной
// игре опыт не копится и полоса навыков скрыта. CFG.leveling.enabled — мастер-тумблер
// на случай отладки: если его включить, перки заработают и в основной игре.
let perksLive = false;
// Перки забега: при старте тасуем CFG.leveling.perks и выдаём первыми двумя из
// массива. После выбора срезаем пару целиком (slice(2)) — невыбранный из пары
// больше не выпадает. 10 перков → 5 пар → ровно 5 уровней.
let perkPool = [];
let currentOfferIds = [];
let killSinceRepair = 0;   // счётчик для перка «Кладка из костей»
let usedSecondWind = false; // перк «Второе дыхание» — одноразовое спасение врат
// ── статистика сессии (для лога прохождений, см. logSession) ──
function newStats(){ return { kills:{}, killsTotal:0, lightning:0, tornado:0, gateShots:0, cityBreaches:0 }; }
let stats = newStats();
let running = false, held = null;
let debugLocation = false;
let debugTildeHits = 0, debugTildeTimer = null;
const sk = id => player.skills[id] || 0; // уровень скилла игрока
const enemySlow = () => 1 - CFG.skills.molasses.mult * sk('molasses'); // «Трясина»: множитель скорости врагов
let mouse = {x:0,y:0,px:0,py:0,vx:0,vy:0};
let shake = 0;
const SHAKE_MUL = 0.7; // глобальное приглушение тряски камеры (−30% ко всем источникам)
let skyFlash = 0; // зарево на небо в момент удара молнии (1 → 0)

function rnd(a,b){ return a + Math.random()*(b-a); }

function addCrushed(){
  score++;
  scoreEl.textContent = score;
}

function firePerksUnlocked(){
  return braziersLit || gameTime >= CFG.fire.litAt;
}

function perkEligible(id){
  return !FIRE_PERKS.has(id) || firePerksUnlocked();
}

// onScreen=true — моб появляется сразу на экране (у правого края), как раньше; так
// выходят туторные мобы. По умолчанию мобы спавнятся ЗА правым краем и заходят из-за экрана.
function spawnDemon(type, onScreen = false){
  // первый «huge» за партию — переключаем музыку с вступительной на боевую
  if(type === 'huge' && !hugeSeen){ hugeSeen = true; music.toCombat(); }
  const T = TYPES[type];
  const d = {
    type,
    hp: T.hp,
    x: onScreen ? (W - 60 + rnd(-10,10)) : (W + CFG.stream.spawnOffscreen + rnd(0,24)),
    y: 0,
    vx: 0, vy: 0,
    speed: rnd(T.speedMin, T.speedMax) + (finale === 'endless'
              ? (CFG.stream.speedRampEnd + endlessT)        // в эндлесе скорость снова растёт от плато
              : Math.min(gameTime, CFG.stream.speedRampEnd)) * CFG.stream.speedPerSec,
    pal: 0, // один вид на тип — мобы узнаются по внешности с первого взгляда
    t: rnd(0,10),
    state: 'walk',           // walk | held | fly | stun | offscreen
    returnT: 0,              // таймер возврата, пока state==='offscreen'
    rot: 0, rotV: 0,
    stun: 0,
    flash: 0,                // вспышка при уроне
    grounded: true,          // для драг-ударов об землю
    armed: false,            // «заряжен» броском: наносит урон, пока не коснулся земли
    noEyeDmg: false,         // торнадо заряжает падение, но не должно бить циклопа в глаз
    windTossed: false,       // подброшен ураганом — заброшенный за стену не вредит вратам
    hitsLeft: 0,             // сколько мобов ещё может сшибить за этот бросок (скилл «Таран»)
    cycHit: 0,               // таймер: недавно отскочил от циклопа (защита от болтанки между двумя)
    swing: 0,                // пик скорости замаха в руке (затухает) — по нему считается удар об землю/стену
    swingVX: 0, swingVY: 0,  // вектор скорости в момент пика — для броска, если курсор уже притормозил
    walled: false,           // уже упёрся в стену замка (защита от стука каждый кадр)
    roofed: false,           // уже лежит/упёрся в крышу башни
    scream: null,            // крик падения, пока моб летит после ручного броска
    screamDelay: 0,          // отложенный старт крика (для пачек из торнадо)
    burnT: 0, burnTick: 0, burnFx: 0, fireBurstReady: false,
    hasBoulder: type === 'roller', // носильщик идёт с валуном, пока его не отобрали
    flip: Math.random()<.5,
  };
  d.y = GROUND_Y - sizeOf(d);
  // спец-поведение по типу
  if(T.air){
    d.flyY = rnd(T.flyMin, T.flyMax); d.y = d.flyY;              // парит
    d.airHomeX = d.x; d.airHomeY = d.y;                          // точка возврата после хватания/стана
  }
  if(T.burrow){ d.state = 'burrow'; }                            // стартует под землёй
  if(T.fireEvery){ d.fireT = T.fireEvery * rnd(.4, 1); }         // дальний — таймер выстрела
  demons.push(d);
  return d;
}

function screamBaseRate(d){
  const px = TYPES[d.type].px;
  if(d.type === 'small') return 1;
  return Math.max(0.45, Math.min(1, 2.6 / px));
}

function screamRate(d){
  if(d.type === 'small') return 1;
  const doppler = Math.max(0.8, Math.min(1.12, 1 + (-d.vx / 2500)));
  return Math.min(1, screamBaseRate(d) * doppler);
}

const SCREAM_LISTENER = {
  near: 170,
  far: 780,
};
const DEMON_SCREAM_CHANCE = 0.45;
const DEMON_SCREAM_THROW_MIN_SPEED = 260;
const DEMON_SCREAM_TORNADO_STEP = 0.09;
const DEMON_SCREAM_TORNADO_JITTER = 0.035;

function screamVolume(d){
  const s = sizeOf(d);
  const cx0 = d.x + s / 2;
  const cy0 = d.y + s / 2;
  const groundX = Math.max(0, Math.min(W, cx0));
  const dist = Math.hypot(cx0 - groundX, cy0 - GROUND_Y);
  const t = Math.max(0, Math.min(1, (dist - SCREAM_LISTENER.near) / (SCREAM_LISTENER.far - SCREAM_LISTENER.near)));
  return 1 - t * t * (3 - 2 * t);
}

const SCREAMS_ENABLED = true;

function startDemonScream(d){
  if(!SCREAMS_ENABLED) return;
  if(d.scream || d.type === 'titan') return;
  d.screamDelay = 0;
  d.scream = sfx.falling(screamRate(d), screamVolume(d));
}

function scheduleDemonScream(d, delay = 0){
  if(!SCREAMS_ENABLED) return;
  if(d.scream || d.type === 'titan') return;
  d.screamDelay = Math.max(0, delay);
  if(d.screamDelay <= 0) startDemonScream(d);
}

function stopDemonScream(d){
  if(!d) return;
  d.screamDelay = 0;
  if(!d.scream) return;
  d.scream.stop();
  d.scream = null;
}

function stopAllDemonScreams(){
  for(const d of demons){ stopDemonScream(d); }
}

function updateDemonScream(d, dt){
  if(d.screamDelay > 0){
    if(d.state !== 'fly'){
      d.screamDelay = 0;
    } else {
      d.screamDelay -= dt;
      if(d.screamDelay <= 0) startDemonScream(d);
    }
  }
  if(!d.scream) return;
  if(d.state !== 'fly'){
    stopDemonScream(d);
  } else {
    d.scream.setRate(screamRate(d));
    d.scream.setVolume(screamVolume(d));
  }
}

// моб, переживший вылет за край экрана, заходит в бой заново справа (ХП уже снижено при вылете)
function returnFromOffscreen(d){
  const s = sizeOf(d);
  d.state = 'walk';
  d.x = W + 10; d.y = GROUND_Y - s;
  d.vx = d.vy = 0; d.rot = 0; d.rotV = 0;
  d.armed = false; d.noEyeDmg = false; d.hitsLeft = 0; d.noDmg = false; d.grounded = true;
  d.swing = 0; d.walled = false; d.roofed = false; d.windTossed = false;
}

function sendOffscreen(d){
  stopDemonScream(d);
  d.armed = false; d.noEyeDmg = false; d.hitsLeft = 0;
  hurt(d, CFG.offscreen.dmg, 0);
  if(!demons.includes(d)) return false; // не пережил вылет — погиб
  d.state = 'offscreen';
  d.returnT = CFG.offscreen.returnDelay;
  return true;
}

// дальний моб запускает снаряд по вратам (летит влево, урон при достижении стены)
function fireShot(d){
  const T = TYPES[d.type];
  const s = sizeOf(d);
  shots.push({ x: d.x + s*0.12, y: d.y + s*0.42, vx: -T.shotSpeed, dmg: T.shotDmg, len: 26 });
  sfx.throw();
}

// урон от удара: пока всегда 1 — сила броска не влияет.
// Скорость задаёт только порог «засчитался ли удар вообще»:
// медленнее SPD_LIGHT — просто стук без урона.
function impactDamage(speed){
  return speed >= SPD_LIGHT ? 1 : 0;
}

function airTargetY(d, T){
  const base = d.flyY ?? d.y;
  if(T.erratic){
    const y1 = T.erraticY1 ?? 40;
    const y2 = T.erraticY2 ?? 26;
    const y = base + Math.sin(d.t*3.3)*y1 + Math.sin(d.t*1.7+1)*y2;
    return Math.max(24, Math.min(GROUND_Y - sizeOf(d) - 6, y));
  }
  return base + Math.sin(d.t*4)*6;
}

function airWaveOffset(d, T){
  if(T.erratic){
    return Math.sin(d.t*3.3)*(T.erraticY1 ?? 40) + Math.sin(d.t*1.7+1)*(T.erraticY2 ?? 26);
  }
  return Math.sin(d.t*4)*6;
}

function airBaseForY(d, T, y){
  return y - airWaveOffset(d, T);
}

function rememberAirHome(d){
  const T = TYPES[d.type];
  if(!T.air) return;
  const s = sizeOf(d);
  if(d.y + s < GROUND_Y - 8 || d.airHomeX == null){
    d.airHomeX = d.x;
    d.airHomeY = d.y;
  }
}

function startAirReturn(d){
  const T = TYPES[d.type];
  if(!T.air) return false;
  d.state = 'airReturn';
  d.vx = d.vy = 0;
  d.rotV = 0;
  d.armed = false;
  d.noEyeDmg = false;
  d.hitsLeft = 0;
  d.noDmg = false;
  d.grounded = false;
  d.roofed = false;
  return true;
}

function eyeImpactSpeed(d, speed){
  return speed * Math.sqrt(Math.max(1, TYPES[d.type].hp));
}

function eyeDamageFromDemon(d, speed){
  const T = TYPES[d.type];
  const raw = Math.ceil((Math.max(1, d.hp) * speed) / CFG.cyclops.eyeDmgDiv);
  return Math.max(1, Math.min(T.hp, raw)) + sk('throwDmg');
}

function overlapsTowerRoof(d, s){
  return d.x + s > TOWER_ROOF.left && d.x < TOWER_ROOF.right;
}

function hitsTowerRoofFromAbove(d, s, prevY){
  return d.vy >= 0 && overlapsTowerRoof(d, s) &&
    prevY + s <= TOWER_ROOF.y && d.y + s >= TOWER_ROOF.y;
}

function burning(e){
  return (e.burnT || 0) > 0;
}

function flameCol(){
  const c = FIRE.colors;
  return c[(Math.random() * c.length) | 0];
}

function emitFireParticles(x, y, n, power = 1){
  for(let i = 0; i < n; i++){
    particles.push({
      x, y,
      vx: rnd(-220, 220) * power,
      vy: rnd(-360, -60) * power,
      col: flameCol(),
      life: rnd(.35, .85),
      size: rnd(2, 5),
      fire: true,
    });
  }
}

// «Поджигатель» (pyro): дольше горят и шире распространяется огонь
const burnDuration = () => FIRE.duration * (1 + CFG.skills.pyro.mult * sk('pyro'));
const fireSpreadR  = () => FIRE.spreadRadius * (1 + CFG.skills.inferno.mult * sk('inferno')); // «Преисподняя»

function igniteDemon(d, source = 'spread'){
  if(!demons.includes(d) || d.state === 'offscreen' || d.state === 'burrow') return;
  const first = !burning(d);
  const chargeFromBrazier = source === 'brazier' && !d.fireBurstReady;
  d.burnT = Math.max(d.burnT || 0, burnDuration());
  d.burnTick = first ? FIRE.firstTick : (d.burnTick || FIRE.tickEvery);
  d.burnFx = 0;
  if(source === 'brazier') d.fireBurstReady = true;
  const s = sizeOf(d);
  if(first || chargeFromBrazier){
    emitFireParticles(d.x + s/2, d.y + s*0.45, first ? FIRE.igniteParticles : Math.ceil(FIRE.igniteParticles/2), 0.7);
  }
  if(first) floatText(d.x + s/2, d.y - 12, 'ГОРИТ!', FIRE.colors[2] || FIRE.colors[0], 1);
}

function igniteCyclops(c){
  if(!cyclopes.includes(c)) return;
  const first = !burning(c);
  c.burnT = Math.max(c.burnT || 0, burnDuration());
  c.burnTick = first ? FIRE.firstTick : (c.burnTick || FIRE.tickEvery);
  c.burnFx = 0;
  if(first) emitFireParticles(c.x + CYC_W*0.45, c.y + CYC_H*0.35, FIRE.igniteParticles, 0.8);
  if(first) floatText(c.x + CYC_W/2, c.y - 18, 'ГОРИТ!', FIRE.colors[2] || FIRE.colors[0], 1);
}

function updateDemonBurn(d, dt){
  if(!burning(d)) return true;
  d.burnT -= dt;
  d.burnTick -= dt;
  d.burnFx -= dt;
  const s = sizeOf(d);
  if(d.burnFx <= 0){
    d.burnFx = FIRE.trailEvery;
    particles.push({
      x: d.x + s*rnd(.25,.75),
      y: d.y + s*rnd(.1,.55),
      vx: rnd(-35,35),
      vy: rnd(-90,-20),
      col: flameCol(),
      life: rnd(.2,.45),
      size: rnd(2,4),
      fire: true,
    });
  }
  // тёмный дым с горящего моба (почти чёрный, размером от моба)
  d.smokeT = (d.smokeT || 0) - dt;
  if(d.smokeT <= 0){
    const bs = SMOKE.burn;
    d.smokeT = bs.every;
    spawnSmoke(d.x + s*rnd(.35,.65), d.y + s*0.2,
      { dark: bs.dark, size0: s*bs.size0Mul, grow: s*bs.growMul, riseMul: bs.riseMul, life: bs.life });
  }
  while(d.burnTick <= 0 && demons.includes(d)){
    d.burnTick += FIRE.tickEvery;
    hurt(d, FIRE.tickDmg + sk('wildfire'), 220);
  }
  if(!demons.includes(d)) return false;
  if(d.burnT <= 0){
    d.burnT = 0;
    d.fireBurstReady = false;
  }
  return true;
}

function updateCyclopsBurn(c, dt){
  if(!burning(c)) return true;
  c.burnT -= dt;
  c.burnTick -= dt;
  c.burnFx -= dt;
  if(c.burnFx <= 0){
    c.burnFx = FIRE.trailEvery;
    particles.push({
      x: c.x + rnd(CYC_W*.18, CYC_W*.82),
      y: c.y + rnd(CYC_H*.08, CYC_H*.65),
      vx: rnd(-45,45),
      vy: rnd(-110,-25),
      col: flameCol(),
      life: rnd(.2,.5),
      size: rnd(2,5),
      fire: true,
    });
  }
  // тёмный дым с горящего циклопа (крупный — размер от тела босса)
  c.smokeT = (c.smokeT || 0) - dt;
  if(c.smokeT <= 0){
    const bs = SMOKE.burn;
    c.smokeT = bs.every;
    spawnSmoke(c.x + rnd(CYC_W*.3, CYC_W*.7), c.y + CYC_H*0.2,
      { dark: bs.dark, size0: CYC_W*0.12, grow: CYC_W*0.18, riseMul: bs.riseMul, life: bs.life });
  }
  while(c.burnTick <= 0 && cyclopes.includes(c)){
    c.burnTick += FIRE.tickEvery;
    hitCyclops(c, FIRE.tickDmg + sk('wildfire'), true);
  }
  if(!cyclopes.includes(c)) return false;
  if(c.burnT <= 0) c.burnT = 0;
  return true;
}

function circleHitsRect(cx0, cy0, r, x, y, w, h){
  const px = Math.max(x, Math.min(cx0, x + w));
  const py = Math.max(y, Math.min(cy0, y + h));
  return Math.hypot(cx0 - px, cy0 - py) <= r;
}

function overlapsBrazier(d, s){
  if(!braziersLit) return false; // до 2-й минуты жаровни не горят — поджечь нельзя
  for(const bz of BRAZIERS){
    if(circleHitsRect(bz.x, bz.y, FIRE.brazierR, d.x, d.y, s, s)) return true;
  }
  return false;
}

function fireImpactDamage(base, d, wasArmed, sp){
  return wasArmed && burning(d) && sp >= SPD_LIGHT ? base + FIRE.impactBonus + sk('emberSmash') : base;
}

function fireBurst(x, y, src){
  if(!burning(src)) return;
  src.fireBurstReady = false;
  const sr = fireSpreadR();
  emitFireParticles(x, y - 4, FIRE.spreadParticles, 1.15);
  shockwaves.push({x, y, r: 10, max: sr, life: .38});
  shake = Math.max(shake, 8);
  for(const o of [...demons]){
    if(o === src || o.state === 'offscreen' || o.state === 'burrow' || !demons.includes(o)) continue;
    const os = sizeOf(o);
    if(Math.hypot(o.x+os/2 - x, o.y+os/2 - y) <= sr) igniteDemon(o, 'spread');
  }
  for(const c of [...cyclopes]){
    if(Math.hypot(c.x+CYC_W/2 - x, c.y+CYC_H/2 - y) <= sr + CYC_W*0.2) igniteCyclops(c);
  }
}

// удар схваченного моба об пол: бьёт по площади всех, кто МЕНЬШЕ него (по 1 урону).
// Вызывается только при ударе рукой об землю — не при приземлении брошенного.
function slamSmaller(d){
  const S = CFG.slam;
  const lvl = sk('slamWide');
  const radius = S.radius + CFG.skills.slamWide.add * lvl;  // «Сейсмоудар»: шире
  const dmg = S.dmg + (lvl >= 2 ? 1 : 0);                   // и сильнее с 2-го уровня
  const ds = sizeOf(d);
  // «Тяжёлый молот»: задевает и равных по размеру, не только мельче
  const cutoff = sk('slamHard') > 0 ? ds + 0.5 : ds;
  const cx0 = d.x + ds/2;
  let hit = false;
  for(const o of [...demons]){
    if(o === d || o.state==='held' || o.state==='offscreen' || o.state==='burrow' || o.flash>0 || !demons.includes(o)) continue;
    if(sizeOf(o) >= cutoff) continue; // достаётся только тем, кто меньше (с «Молотом» — и равным)
    const os = sizeOf(o);
    if(Math.hypot(o.x+os/2 - cx0, o.y+os/2 - GROUND_Y) <= radius){
      // «Пепелище»: удар горящим мобом поджигает задетых волной
      if(sk('ashSlam') > 0 && burning(d)) igniteDemon(o, 'spread');
      hurt(o, dmg, 400);
      hit = true;
    }
  }
  if(hit){
    shockwaves.push({ x: cx0, y: GROUND_Y, r: 8, max: radius, life: .35 });
    shake = Math.max(shake, 4);
  }
}

function hurt(d, dmg, sp){
  if (dmg <= 0 || d.invuln) return; // титаны орды неуязвимы — их косят только молнии Тора
  d.hp -= dmg;
  if (d.hp <= 0) { splat(d, sp); return; }
  // живой, но получил
  sfx.hurt();
  d.flash = 0.25;
  shake = Math.max(shake, TYPES[d.type].shakeHurt); // фиксированная тряска по типу (без влияния скорости)
  const s = sizeOf(d), px = d.x + s/2, py = d.y + s*0.8;
  const col = bloodCol(d.type);
  for(let i=0;i<5+dmg*3;i++){
    particles.push({x:px, y:py, vx:rnd(-180,180), vy:rnd(-300,-60),
      col, life:rnd(.3,.6), size:rnd(2,4)});
  }
  floatText(px, d.y-8, '-'+dmg+' ХП', '#c0392b', 1);
}

function splat(d, sp){
  stopDemonScream(d);
  sfx.splat();
  shake = Math.max(shake, TYPES[d.type].shakeSplat); // фиксированная тряска по типу (без влияния скорости)
  stats.kills[d.type] = (stats.kills[d.type] || 0) + 1; stats.killsTotal++;
  // «Кладка из костей»: каждые every убийств чинят врата
  if(sk('repairKill') > 0 && ++killSinceRepair >= CFG.skills.repairKill.every){
    killSinceRepair = 0;
    hp = Math.min(100, hp + CFG.skills.repairKill.amount * sk('repairKill'));
    hpFill.style.width = hp + '%';
  }
  // «Заразное пламя»: горящий враг при гибели вспыхивает и поджигает соседей
  if(sk('wildSpread') > 0 && burning(d)){
    const wr = CFG.skills.wildSpread.radius * sk('wildSpread');
    const sw = sizeOf(d), wx = d.x + sw/2, wy = d.y + sw/2;
    emitFireParticles(wx, wy, 16, 1);
    for(const o of [...demons]){
      if(o === d || o.state==='held' || o.state==='offscreen' || o.state==='burrow' || !demons.includes(o)) continue;
      const os = sizeOf(o);
      if(Math.hypot(o.x+os/2 - wx, o.y+os/2 - wy) <= wr) igniteDemon(o, 'spread');
    }
  }
  const pts = TYPES[d.type].score;
  addCrushed();
  gainXP(pts);
  const s = sizeOf(d), px = d.x + s/2, py = d.y + s/2;
  const col = bloodCol(d.type);
  const big = d.type !== 'small';
  // мелкокровные мобы (dog/bat/wisp/caster/mole/small) дают маленькую лужу и мало
  // брызг, как у small. Текст-«хряск» и тряску оставляем по big.
  const bloodBig = !SMALL_BLOOD.has(d.type);
  // размер лужи фиксирован по типу моба — от силы броска не зависит
  const maxR = d.type==='huge' ? rnd(34,46) : bloodBig ? rnd(26,38) : rnd(13,20);
  // разбился ОБ СТЕНУ замка: при ударе моб прижат к стене (d.x === WALL.x) ниже её
  // кромки. Тогда кровь брызгает вертикальным потёком по кладке, а не лужей на полу.
  const onWall = d.x <= WALL.x + 0.5 && d.y + s > WALL.top;
  if(onWall){
    puddles.push({wall:true, x:WALL.x + 4, y:py - 2, r:0, max:maxR, col, life:1, size:bloodSize(d.type)});
  } else {
    puddles.push({x:px, y:GROUND_Y, r:0, max:maxR, col, life:1, size:bloodSize(d.type)});
  }
  for(let i=0; i < (d.type==='huge' ? 30 : bloodBig ? 22 : 12); i++){
    particles.push({
      x:px, y:py,
      vx:rnd(-280,280), vy:rnd(-460,-80),
      col, life:rnd(.4,.9), size:rnd(2, bloodBig?6:4)
    });
  }
  floatText(px, py-24, big?'ХРЯЯЯСЬ!':'хрясь!');
  if (big) floatText(px, py-44, '+'+pts, '#b8860b', 1.2);
  if (held === d) { held = null; cv.classList.remove('grabbing'); }
  demons.splice(demons.indexOf(d),1);
  if (d.type === 'bomber') bomberBoom(px, py); // рвануло — задевает соседей
}

function playImpactSlapIfNonlethal(d, dmg, strength){
  if(dmg > 0 && d.hp <= dmg) return;
  sfx.slap(strength);
}

// взрыв бомбера: урон по площади всем мобам рядом (возможна цепная реакция)
function bomberBoom(x, y){
  const T = TYPES.bomber;
  sfx.explode();
  shake = Math.max(shake, 12);
  // фаербол-вспышка + ударная волна
  blasts.push({ x, y, r: 0, max: T.boomR * 1.15, life: 0.4, maxLife: 0.4 });
  shockwaves.push({x, y: GROUND_Y, r: 10, max: T.boomR, life: .4});
  // огненные искры + разлетающиеся ошмётки
  emitFireParticles(x, y, 22, 1.3);
  for(let i = 0; i < 30; i++){
    particles.push({x, y, vx:rnd(-380,380), vy:rnd(-520,-40),
      col: i%3===0 ? '#2a2024' : (i%2 ? '#ffcf3a' : '#e85b21'), life:rnd(.3,.8), size:rnd(2,6)});
  }
  for(const o of [...demons]){
    if(o.state==='held' || o.state==='offscreen' || o.state==='burrow' || !demons.includes(o)) continue;
    const os = sizeOf(o);
    if(Math.hypot(o.x+os/2 - x, o.y+os/2 - y) <= T.boomR) hurt(o, T.boomDmg, 600);
  }
}

function reachMountain(d){
  sfx.reach();
  // врата неуязвимы (финал/дебаг) ИЛИ моб был заброшен за стену ураганом — без урона вратам
  if(gateImmune() || d.windTossed){
    shake = Math.max(shake, 5);
    for(let i=0;i<8;i++){
      particles.push({x:d.x, y:d.y+sizeOf(d)/2, vx:rnd(-80,180), vy:rnd(-200,-40),
        col:'#7a4a32', life:rnd(.3,.7), size:rnd(2,4)});
    }
    demons.splice(demons.indexOf(d),1);
    return;
  }
  // моб оказался ЗА стеной (центр левее врат) — его «доставили» в город (не просто
  // дошёл до стены спереди): двойной урон, как при перелёте за край (cityBreach)
  const behind = d.x + sizeOf(d)/2 < MOUNTAIN_X;
  const dmgM = mountainDmg(TYPES[d.type].mtnDmg) * (behind ? 2 : 1);
  hp = Math.max(0, hp - dmgM);
  hpFill.style.width = hp + '%';
  shake = 10;
  floatText(d.x+sizeOf(d)/2, d.y, '-'+dmgM, '#c0392b', 1);
  for(let i=0;i<8;i++){
    particles.push({x:d.x, y:d.y+sizeOf(d)/2, vx:rnd(-80,180), vy:rnd(-200,-40),
      col:'#7a4a32', life:rnd(.3,.7), size:rnd(2,4)});
  }
  // первый «заброс» за врата — обучающее предупреждение
  if(behind && tutorialTryMessage('city', CFG.tutorial.cityTitle, CFG.tutorial.citySub, 'click')) msgHi = null;
  demons.splice(demons.indexOf(d),1);
  if (hp <= 0) gameOver();
}

// Моб улетел за ЛЕВЫЙ край — «доставлен» в город за вратами.
// Врата получают ДВОЙНОЙ урон, который этот моб нанёс бы им у стены.
function cityBreach(d){
  sfx.reach();
  // врата неуязвимы (финал/дебаг) — моб улетел в город, но урона вратам нет
  if(gateImmune()){ demons.splice(demons.indexOf(d),1); return; }
  stats.cityBreaches++;
  const dmg = 2 * mountainDmg(TYPES[d.type].mtnDmg);
  hp = Math.max(0, hp - dmg);
  hpFill.style.width = hp + '%';
  shake = 12;
  floatText(MOUNTAIN_X + 30, 130, '-'+dmg, '#c0392b', 1.4);
  demons.splice(demons.indexOf(d),1);
  if(hp <= 0){ gameOver(); return; }
  // первый раз за партию — обучающее предупреждение (затемнение + текст), без подсветки
  if(tutorialTryMessage('city', CFG.tutorial.cityTitle, CFG.tutorial.citySub, 'click')) msgHi = null;
}

// ── одноразовые подсказки про новые типы врагов ──
// msgHi — кого подсветить под активным сообщением (рисует drawMsgHighlight)
let msgHi = null;
let cycTutT = 0; // сколько секунд на сцене есть циклоп (для отложенной подсказки)

// Сканируем сцену: впервые увидели особый тип врага — показываем подсказку и замораживаем
// мир. true = сообщение показано (тогда update прерывается на этот кадр).
function tutorialScan(dt){
  const T = CFG.tutorial;
  // здоровяк — бить об землю (закрытие любым кликом)
  let d = demons.find(m => m.type==='big' && m.state!=='offscreen' && m.state!=='held' && m.state!=='burrow');
  if(d && tutorialTryMessage('big', T.bigTitle, T.bigSub, 'grab')){ msgHi = { demons:[d], grab:{kind:'demon', target:d} }; return true; }
  // носильщик валуна — отобрать валун (закрытие захватом валуна)
  // только роллер, уже ВОШЕДШИЙ на экран (x < W-60): иначе подсказка укажет за край и
  // её нельзя будет закрыть кликом по нему — хардлок
  d = demons.find(m => m.type==='roller' && m.hasBoulder && m.state==='walk' && m.x < W - 60);
  if(d && tutorialTryMessage('roller', T.rollerTitle, T.rollerSub, 'grab')){ msgHi = { demons:[d], boulder:d, grab:{kind:'boulder', target:d} }; return true; }
  // дальний стрелок — хватать быстрее, пока он ещё не дошёл до позиции обстрела
  d = demons.find(m => m.type==='caster' && m.state!=='offscreen' && m.state!=='held' && m.state!=='burrow');
  if(d && tutorialTryMessage('caster', T.casterTitle, T.casterSub, 'grab')){ msgHi = { demons:[d], grab:{kind:'demon', target:d} }; return true; }
  // копатель вынырнул (прошёл половину пути) — ждать, пока вылезет (закрытие кликом)
  d = demons.find(m => m.type==='mole' && m.state!=='burrow' && m.state!=='offscreen' && m.state!=='held');
  if(d && tutorialTryMessage('mole', T.moleTitle, T.moleSub, 'click')){ msgHi = { demons:[d] }; return true; }
  // циклоп: ждём, пока зайдёт поглубже — cyclopsDelay секунд на сцене, потом подсказка
  if(cyclopes.length){
    cycTutT += dt;
    if(cycTutT >= T.cyclopsDelay && tutorialTryMessage('cyclops', T.cyclopsTitle, T.cyclopsSub, 'click')){
      msgHi = { cyc: cyclopes[0] }; return true;
    }
  } else cycTutT = 0;
  // циклоп с деревянным забралом (2-й босс): как обычный циклоп — даём зайти поглубже
  // (cyclopsDelay секунд; cycTutT уже считает его присутствие), потом подсказка с подсветкой
  const cv2 = cyclopes.find(c => c.visor > 0);
  if(cv2 && cycTutT >= T.cyclopsDelay && tutorialTryMessage('visor', T.visorTitle, T.visorSub, 'click')){
    msgHi = { cyc: cv2, visor: true }; return true; // забрало: без подсветки глаза и стрелки
  }
  // дракон (3-й босс) — ловить фаерболы и метать обратно
  // дракон: тутор не сразу — ждём, пока он въедет и постоит CFG.dragon.tutorialDelay секунд
  if(dragons.length && dragons[0].state === 'fight' && dragons[0].t >= (CFG.dragon.tutorialDelay ?? 5) &&
     tutorialTryMessage('dragon', T.dragonTitle, T.dragonSub, 'click')){ msgHi = null; return true; }
  return false;
}

// есть ли у текущего сообщения подсвеченный объект (у «города» — нет)
function tutorialHasObject(){
  return !!(msgHi && ((msgHi.demons && msgHi.demons.length) || msgHi.cyc || msgHi.swirl || msgHi.cloud));
}
// попал ли клик по подсвеченному объекту сообщения (моб — щедрый радиус, циклоп — по корпусу)
function tutorialHitObject(p){
  if(!msgHi) return false;
  if(msgHi.demons) for(const d of msgHi.demons){
    if(!demons.includes(d)) continue;
    const s = sizeOf(d);
    if(Math.hypot(p.x-(d.x+s/2), p.y-(d.y+s/2)) <= Math.max(TYPES[d.type].grabR, s) * 1.4) return true;
  }
  if(msgHi.cyc && cyclopes.includes(msgHi.cyc)){
    const c = msgHi.cyc;
    if(p.x >= c.x && p.x <= c.x+CYC_W && p.y >= c.y && p.y <= c.y+CYC_H) return true;
  }
  return false;
}
// попал ли клик по глазу циклопа (слабое место) — щедрый радиус, чтобы легко попасть
function cyclopsEyeHit(p){
  const c = msgHi && msgHi.cyc;
  if(!c || !cyclopes.includes(c)) return false;
  return Math.hypot(p.x - (c.x+CYC_EYE.x), p.y - (c.y+CYC_EYE.y)) <= CYC_EYE.r * 1.8;
}

// захват цели «grab»-сообщения: попал по цели → выполняем захват и закрываем подсказку
function tutorialGrab(p){
  const g = msgHi && msgHi.grab;
  if(!g || !g.target || !demons.includes(g.target)){ dismissTutorialMessage(); return; }
  const d = g.target, s = sizeOf(d);
  const dist = Math.hypot(p.x-(d.x+s/2), p.y-(d.y+s/2));
  const gr = Math.max(TYPES[d.type].grabR, s) * 1.6; // щедрый радиус — попасть легко
  if(dist > gr) return; // мимо — сообщение остаётся
  if(g.kind === 'boulder'){
    heldBoulder = { x: p.x, y: p.y };
    d.hasBoulder = false;
    floatText(d.x+s/2, d.y-10, 'ВАЛУН!', '#7e828c', 1);
  } else {
    held = d; d.state='held'; d.rotV=0; d.grounded=false; d.noDmg=false; d.swing=0; d.walled=false;
    stopDemonScream(d);
  }
  cv.classList.add('grabbing'); sfx.grab();
  dismissTutorialMessage();
}

// подсветка «героя» сообщения поверх тёмной маски (мягкое свечение + спрайт)
function tutGlow(x, y, r){
  const g = cx.createRadialGradient(x, y, r*0.18, x, y, r);
  g.addColorStop(0, 'rgba(255,247,210,0.22)');
  g.addColorStop(1, 'rgba(255,247,210,0)');
  cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, r, 0, Math.PI*2); cx.fill();
}
function drawMsgHighlight(){
  if(!msgHi) return;
  if(msgHi.demons) for(const d of msgHi.demons){
    if(!demons.includes(d)) continue;
    const s = sizeOf(d), mx = d.x+s/2, my = d.y+s/2;
    tutGlow(mx, my, s*1.7);
    cx.save(); cx.translate(mx, my); if(d.flip) cx.scale(-1,1);
    cx.drawImage(SPRITES[d.type][d.pal], -s/2, -s/2, s, s); cx.restore();
    tutArrowRD(d.x, d.y); // стрелка вниз-вправо, остриём в моба
  }
  if(msgHi.boulder && demons.includes(msgHi.boulder)){
    const d = msgHi.boulder, s = sizeOf(d), br = CFG.spells.boulder.r;
    tutGlow(d.x+s/2, d.y - br*0.3, br*2.4);
    cx.drawImage(SPELL_SPRITES.boulder, d.x+s/2 - br*0.8, d.y - br*1.1, br*1.6, br*1.6);
  }
  if(msgHi.cyc && cyclopes.includes(msgHi.cyc)){
    const c = msgHi.cyc;
    tutGlow(c.x+CYC_W/2, c.y+CYC_H/2, CYC_W*0.85);
    cx.drawImage(CYC_SPRITE, c.x, c.y, CYC_W, CYC_H);
    if(!msgHi.visor){
      // обычный циклоп: мерцающий глаз — «слабое место» — и стрелка на него.
      // У циклопа в забрале (msgHi.visor) глаз НЕ подсвечиваем и стрелку не рисуем.
      const pulse = 0.5 + 0.5*Math.sin(last*0.012);
      cx.globalAlpha = 0.45 + 0.55*pulse;
      cx.fillStyle = '#ff3030';
      cx.beginPath(); cx.arc(c.x+CYC_EYE.x, c.y+CYC_EYE.y, CYC_EYE.r*(1+0.35*pulse), 0, Math.PI*2); cx.fill();
      cx.globalAlpha = 1;
      tutArrowRD(c.x + CYC_EYE.x, c.y + CYC_EYE.y); // стрелка вниз-вправо, остриём в ГЛАЗ циклопа
    }
  }
  if(msgHi.cloud){
    const c = msgHi.cloud;
    tutGlow(c.x + cloudW(c)/2, c.y + cloudH(c)/2, cloudW(c)*0.75);
    if(c.charge) drawChargedCloud(c);                       // ярко перерисовываем тучу поверх маски
    tutArrowUp(c.x + cloudW(c)/2, c.y + cloudH(c) + 6);     // стрелка снизу вверх, остриём в тучу
  }
  if(msgHi.braziers){
    // яркая аддитивная подсветка обеих жаровень + перерисовка самих огоньков поверх маски
    cx.save();
    cx.globalCompositeOperation = 'lighter';
    const pulse = 0.75 + 0.25*Math.sin(last*0.012);
    for(const bz of BRAZIERS){
      const R = FIRE.brazierR * 3;
      const g = cx.createRadialGradient(bz.x, bz.y, 2, bz.x, bz.y, R);
      g.addColorStop(0, 'rgba(255,214,120,'+(0.7*pulse)+')');
      g.addColorStop(0.5, 'rgba(255,150,40,'+(0.3*pulse)+')');
      g.addColorStop(1, 'rgba(255,150,40,0)');
      cx.fillStyle = g; cx.beginPath(); cx.arc(bz.x, bz.y, R, 0, Math.PI*2); cx.fill();
    }
    cx.restore();
    tutArrowLU(BRAZIERS[1].x, BRAZIERS[1].y); // стрелка — на ПРАВУЮ жаровню
  }
  if(msgHi.swirl){
    const sw = msgHi.swirl;
    tutGlow(sw.x, sw.y, SWIRL_R * 2.4);
    drawSwirl(sw);                       // ярко перерисовываем иконку вихря поверх маски
    tutArrowDown(sw.x, sw.y - SWIRL_R);  // стрелка сверху вниз, остриём в вихрь
  }
}
// стрелки-подсказки спрайтами (31×31). Остриё указывает на (tx,ty), сам спрайт смещён
// в сторону хвоста; лёгкое покачивание вдоль диагонали «тычет» в цель.
const ARROW_PX = 31;
function tutArrowRD(tx, ty){ // arrow-right-down (↘): приходит из верх-лево, остриё в правом-нижнем углу
  const img = art.arrowRD; if(!img) return;
  const bob = (Math.sin(last*0.006)+1) * 6;
  const tipX = tx - bob, tipY = ty - bob;
  cx.drawImage(img, Math.round(tipX - ARROW_PX), Math.round(tipY - ARROW_PX), ARROW_PX, ARROW_PX);
}
function tutArrowLU(tx, ty){ // arrow-left-up (↖): приходит из низ-право, остриё в левом-верхнем углу
  const img = art.arrowLU; if(!img) return;
  const bob = (Math.sin(last*0.006)+1) * 6;
  const tipX = tx + bob, tipY = ty + bob;
  cx.drawImage(img, Math.round(tipX), Math.round(tipY), ARROW_PX, ARROW_PX);
}
// стрелка сверху вниз (↓): остриё снизу в (tx,ty), сама стрелка над ним; покачивается.
// Когда будет готов спрайт — положи его в assets как art.arrowDown, и он подхватится.
function tutArrowDown(tx, ty){
  const bob = (Math.sin(last*0.006)+1) * 6;
  const img = art.arrowDown;
  if(img){
    cx.drawImage(img, Math.round(tx - ARROW_PX/2), Math.round(ty - ARROW_PX - bob), ARROW_PX, ARROW_PX);
    return;
  }
  // запасной вариант, пока спрайта нет: простая белая стрелка вниз
  const yTip = ty - bob, len = 30;
  cx.save();
  cx.strokeStyle = '#fff'; cx.fillStyle = '#fff'; cx.lineWidth = 5; cx.lineCap = 'round';
  cx.beginPath(); cx.moveTo(tx, yTip - len); cx.lineTo(tx, yTip - 7); cx.stroke();
  cx.beginPath(); cx.moveTo(tx, yTip); cx.lineTo(tx - 9, yTip - 13); cx.lineTo(tx + 9, yTip - 13); cx.closePath(); cx.fill();
  cx.restore();
}

// стрелка снизу вверх (↑): остриё сверху в (tx,ty), тело ниже; качается снизу к цели.
// Когда будет готов спрайт — положи его в assets как art.arrowUp, и он подхватится.
function tutArrowUp(tx, ty){
  const bob = (Math.sin(last*0.006)+1) * 6;
  const img = art.arrowUp;
  if(img){
    cx.drawImage(img, Math.round(tx - ARROW_PX/2), Math.round(ty + bob), ARROW_PX, ARROW_PX);
    return;
  }
  // запасной вариант, пока спрайта нет: простая белая стрелка вверх
  const yTip = ty + bob, len = 30;
  cx.save();
  cx.strokeStyle = '#fff'; cx.fillStyle = '#fff'; cx.lineWidth = 5; cx.lineCap = 'round';
  cx.beginPath(); cx.moveTo(tx, yTip + len); cx.lineTo(tx, yTip + 7); cx.stroke();
  cx.beginPath(); cx.moveTo(tx, yTip); cx.lineTo(tx - 9, yTip + 13); cx.lineTo(tx + 9, yTip + 13); cx.closePath(); cx.fill();
  cx.restore();
}

function spawnCyclops(opts = {}){
  cyclopes.push({
    x: (opts.x != null ? opts.x : W + 10), y: GROUND_Y - CYC_H,
    hp: CFG.cyclops.hp, t: rnd(0,10), step: 0.8,
    state: 'walk', poundT: 0, eyeFlash: 0, freeze: 0,
    burnT: 0, burnTick: 0, burnFx: 0,
    // деревянное забрало (2-й босс): пока visor>0 — глаз неуязвим, кроме огня
    visor: opts.visor ? CFG.bosses.visorHits : 0,
    visorFlash: 0,
    // boss2 (по смерти запускает дракона) — ТОЛЬКО для сюжетного забрала, не для бесконечного
    boss2: !!opts.visor && !opts.endless,
  });
  floatText(W-90, GROUND_Y - CYC_H - 24, opts.visor ? 'ЦИКЛОП В ЗАБРАЛЕ!' : 'ЦИКЛОП!', '#c0392b', 1.6);
}

// fromFire=true — удар «горящий» (горящий моб / сам циклоп в огне). Деревянное забрало
// 2-го босса рушится ТОЛЬКО такими ударами; любой другой урон по забралу не проходит.
function hitCyclops(c, dmg, fromFire = false){
  if(c.visor > 0){
    if(fromFire){
      c.visor--; c.visorFlash = 0.4;
      sfx.hurt(); shake = Math.max(shake, 7);
      for(let i=0;i<12;i++){
        particles.push({x:c.x+CYC_EYE.x, y:c.y+CYC_EYE.y, vx:rnd(-180,40), vy:rnd(-200,-20),
          col:'#7a4a32', life:rnd(.4,.9), size:rnd(2,5)});
      }
      if(c.visor <= 0){
        floatText(c.x+CYC_EYE.x, c.y+CYC_EYE.y-20, 'ЗАБРАЛО РАЗБИТО!', '#ffcf3a', 1.4);
        c.eyeFlash = 0.5;
      } else {
        floatText(c.x+CYC_EYE.x, c.y+CYC_EYE.y-16, 'ЗАБРАЛО ТРЕЩИТ!', '#e85b21', 1);
      }
    } else {
      // дерево держит обычный удар — клац, без урона
      sfx.thud(); shake = Math.max(shake, 3);
      floatText(c.x+CYC_EYE.x, c.y+CYC_EYE.y-16, 'ЗАБРАЛО ДЕРЖИТ!', '#8a8893', 0.9);
    }
    return;
  }
  c.hp -= dmg;
  c.eyeFlash = 0.35;
  sfx.hurt();
  shake = Math.max(shake, CFG.cyclops.shakeHit);
  floatText(c.x+CYC_EYE.x, c.y+CYC_EYE.y-16, '-'+dmg+' ХП', '#c0392b', 1);
  if(c.hp <= 0){
    if(c.boss2){ boss2Dead = true; dragonTimer = CFG.bosses.dragonDelay; dragonRoared = false; } // следом выйдет дракон
    sfx.splat(); shake = CFG.cyclops.shakeDeath;
    stats.kills.cyclops = (stats.kills.cyclops || 0) + 1; stats.killsTotal++;
    addCrushed();
    gainXP(CFG.cyclops.score);
    const px = c.x + CYC_W/2;
    const cbCol = bloodCol('cyclops');
    puddles.push({x:px, y:GROUND_Y, r:0, max:rnd(55,70), col:cbCol, life:1.4, size:'medium'});
    for(let i=0;i<40;i++){
      particles.push({x:px+rnd(-CYC_W/3,CYC_W/3), y:c.y+rnd(0,CYC_H), vx:rnd(-320,320), vy:rnd(-500,-60),
        col:cbCol, life:rnd(.5,1.1), size:rnd(3,7)});
    }
    floatText(px, c.y, 'ХРЯЯЯСЬ!!!', '#1a1626', 1.4);
    floatText(px, c.y+26, '+'+CFG.cyclops.score, '#b8860b', 1.5);
    cyclopes.splice(cyclopes.indexOf(c),1);
  }
}

// ── контроллер боссов: трое выходят по очереди, каждый один раз ──
// 1) обычный циклоп (момент — stream.cyclopsFirst); 2) циклоп с забралом (bosses.visorAt,
// только когда сцена свободна от прежнего босса); 3) дракон — через bosses.dragonDelay
// после гибели 2-го босса. Победа наступает по смерти дракона (см. hitDragon → winGame).
function updateBosses(dt){
  if(won) return;
  if(!boss1Spawned && gameTime >= CFG.stream.cyclopsFirst && cyclopes.length === 0){
    spawnCyclops(); boss1Spawned = true;
  } else if(boss1Spawned && !boss2Spawned && gameTime >= CFG.bosses.visorAt && cyclopes.length === 0){
    spawnCyclops({ visor: true }); boss2Spawned = true;
  }
  // дракон выходит через dragonDelay секунд ПОСЛЕ гибели 2-го босса (таймер ставит hitCyclops)
  if(boss2Dead && !dragonSpawned){
    if(!dragonRoared && dragonTimer <= (CFG.dragon.roarLead ?? 2)){
      dragonRoared = true;
      sfx.dragonRoar();
    }
    dragonTimer -= dt;
    if(dragonTimer <= 0){ spawnDragon(); dragonSpawned = true; }
  }
}

// поток мобов замирает за wavePause секунд ДО выхода дракона и столько же ПОСЛЕ
// (только в основной игре — в бесконечном волны не паузим)
function dragonWavePause(){
  if(finale === 'endless') return false;
  const w = CFG.dragon.wavePause ?? 5;
  if(boss2Dead && !dragonSpawned && dragonTimer <= w) return true; // вот-вот выйдет
  if(dragons.some(d => d.t <= w)) return true;                      // только что вышел
  return false;
}

// opts.endless — дракон бесконечного режима (по смерти НЕ запускает финал);
// opts.targetX — куда встать (для пары драконов разносим по x)
function spawnDragon(opts = {}){
  const D = CFG.dragon;
  const targetX = opts.targetX != null ? opts.targetX : W - DRG_W - D.margin;
  dragons.push({
    x: W + 60, y: GROUND_Y - DRG_H, hp: D.hp,
    state: 'enter',                 // enter — въезжает к краю; fight — встал и атакует
    targetX,
    t: 0, attackT: D.firstAttackDelay, eyeFlash: 0,
    enrage: false, blink: 0, atkCount: 0,
    endless: !!opts.endless,
  });
  floatText(W - 130, GROUND_Y - DRG_H - 18, 'ДРАКОН!', '#e85b21', 1.8);
  shake = Math.max(shake, 16);
}

// точка вылета фаербола — пасть дракона (голова сверху-слева в позе «годзиллы»)
const dragonMouth = (dr) => ({ x: dr.x + DRG_W*0.12, y: dr.y + DRG_H*0.15 });

function spawnFireball(x, y, vx, vy){
  fireballs.push({ x, y, vx, vy, r: CFG.dragon.fbR, t: 0, hostile: true, held: false, trailT: 0 });
}

// взрыв вражеского фаербола (о землю или о моба): вспышка + поджигает и ранит мобов в радиусе
function explodeFireball(fb){
  const R = 84;                       // радиус взрыва
  const ey = Math.min(fb.y, GROUND_Y); // центр взрыва — точка попадания (но не ниже земли)
  emitFireParticles(fb.x, ey, 18, 1.2);
  shake = Math.max(shake, 7); sfx.thud();
  for(const o of [...demons]){
    if(o.state === 'held' || o.state === 'offscreen' || o.state === 'burrow' || o.flash > 0 || !demons.includes(o)) continue;
    const os = sizeOf(o);
    if(Math.hypot(o.x+os/2 - fb.x, o.y+os/2 - ey) <= R + os*0.4){
      igniteDemon(o, 'spread');
      hurt(o, CFG.dragon.mobDmg, 420);
    }
  }
}

// дракон атакует: чередует три вида (см. CFG.dragon). В ярости каждый второй залп —
// два быстрых прямых фаербола.
function dragonAttack(dr){
  const D = CFG.dragon, m = dragonMouth(dr);
  shake = Math.max(shake, 6); sfx.reach();
  let kind;
  if(dr.enrage && (dr.atkCount % 2 === 1)) kind = 'enrage';
  else kind = (dr.atkCount % 2 === 0) ? 'fast' : 'arc';
  dr.atkCount++;
  if(kind === 'fast'){
    spawnFireball(m.x, m.y, -D.fast.speed, 0);
  } else if(kind === 'arc'){
    for(let i = 0; i < D.arc.count; i++){
      const vy = (i - (D.arc.count - 1) / 2) * D.arc.vyStep;
      spawnFireball(m.x, m.y, -D.arc.speed, vy);
    }
  } else { // enrage: два быстрых прямых с маленькой задержкой
    spawnFireball(m.x, m.y, -D.enrageShot.speed, 0);
    pendingFB.push({ delay: D.enrageShot.gap, dr, vx: -D.enrageShot.speed, vy: 0 });
  }
}

function hitDragon(dr, dmg){
  if(!dr || !dragons.includes(dr)) return;
  const D = CFG.dragon;
  dr.hp -= dmg; dr.eyeFlash = D.eyeFlashTime;
  sfx.hurt(); shake = Math.max(shake, 11);
  floatText(dr.x + DRG_W*0.2, dr.y + DRG_H*0.28, '-'+dmg, '#ffcf3a', 1.2);
  if(!dr.enrage && dr.hp <= D.hp * D.enrageAt){
    dr.enrage = true;
    floatText(dr.x + DRG_W/2, dr.y - 6, 'ДРАКОН В ЯРОСТИ!', '#ff3030', 1.5);
    shake = Math.max(shake, 14);
  }
  if(dr.hp <= 0){
    sfx.splat(); shake = 24;
    addCrushed();
    stats.kills.dragon = (stats.kills.dragon || 0) + 1; stats.killsTotal++;
    const px = dr.x + DRG_W*0.4, py = dr.y + DRG_H*0.45;
    for(let i = 0; i < 60; i++){
      particles.push({x:px+rnd(-DRG_W*0.3,DRG_W*0.3), y:py+rnd(-DRG_H*0.3,DRG_H*0.3),
        vx:rnd(-400,400), vy:rnd(-560,-80),
        col: i%2 ? '#e85b21' : '#1f3d24', life:rnd(.6,1.3), size:rnd(3,8)});
    }
    floatText(px, py, 'ПОВЕРЖЕН!!!', '#ffcf3a', 1.8);
    dragons.splice(dragons.indexOf(dr), 1);
    score += CFG.cyclops.score * 2; scoreEl.textContent = score; // дракон стоит дорого
    // финал запускает ТОЛЬКО смерть основного (сюжетного) дракона; в бесконечном — нет
    if(!dr.endless) beginFinale();
  }
}

function updateDragon(dt){
  // отложенные выстрелы (второй фаербол залпа ярости) — тикают даже без активного боя
  for(const pf of [...pendingFB]){
    pf.delay -= dt;
    if(pf.delay <= 0){
      if(pf.dr && dragons.includes(pf.dr)){ const m = dragonMouth(pf.dr); spawnFireball(m.x, m.y, pf.vx, pf.vy); }
      pendingFB.splice(pendingFB.indexOf(pf), 1);
    }
  }
  const D = CFG.dragon;
  for(const dr of dragons){
    dr.t += dt;
    if(dr.eyeFlash > 0) dr.eyeFlash -= dt;
    if(dr.state === 'enter'){
      dr.x -= D.enterSpeed * dt;
      if(dr.x <= dr.targetX){ dr.x = dr.targetX; dr.state = 'fight'; shake = Math.max(shake, 10); }
      continue;
    }
    if(dr.enrage) dr.blink += dt;
    dr.attackT -= dt;
    if(dr.attackT <= 0){
      dragonAttack(dr);
      const j = D.attackJitter;
      dr.attackT = D.attackEvery * rnd(1 - j*0.5, 1 + j*0.5);
    }
  }
}

// фаерболы: враждебные летят к стене (урон вратам при касании), пойманные/возвращённые —
// бьют дракона (его же огнём) и мобов. Пойманный (held) висит на курсоре — его не двигаем.
function updateFireballs(dt){
  const D = CFG.dragon;
  for(const fb of [...fireballs]){
    if(fb.held){
      // пойманный фаербол коснулся земли — бьём им об пол, как схваченным мобом:
      // взрыв по площади (поджиг + урон мобам в радиусе), фаербол расходуется
      if(fb.y + fb.r >= GROUND_Y){
        explodeFireball(fb);
        fireballs.splice(fireballs.indexOf(fb), 1);
        heldFireball = null;
        cv.classList.remove('grabbing');
      }
      continue;
    }
    fb.t += dt;
    fb.x += fb.vx * dt; fb.y += fb.vy * dt;
    // хвост — дым (как от горящих мобов, но крупнее): поднимается вверх и тает
    fb.trailT -= dt;
    if(fb.trailT <= 0){
      fb.trailT = D.trailEvery;
      spawnSmoke(fb.x, fb.y, { dark: 0.5, size0: 18, grow: 24, riseMul: 1.25, life: 1.2 });
    }

    if(fb.hostile){
      // столкновение с мобом на лету — взрыв на месте (поджиг + урон по площади)
      let onMob = false;
      for(const o of [...demons]){
        if(o.state === 'held' || o.state === 'offscreen' || o.state === 'burrow' || o.flash > 0 || !demons.includes(o)) continue;
        const os = sizeOf(o);
        if(Math.hypot(o.x+os/2 - fb.x, o.y+os/2 - fb.y) < fb.r + os*0.45){ onMob = true; break; }
      }
      if(onMob){ explodeFireball(fb); fireballs.splice(fireballs.indexOf(fb), 1); continue; }
      // долетел до стены — урон вратам (сколизил по камню), вспышка
      if(fb.x - fb.r <= MOUNTAIN_X){
        if(!gateImmune()){
          const dmg = mountainDmg(D.grazeDmg);
          hp = Math.max(0, hp - dmg); hpFill.style.width = hp + '%';
          floatText(MOUNTAIN_X + 20, fb.y, '-'+dmg, '#e85b21', 1.1);
        }
        shake = Math.max(shake, 8); sfx.reach();
        emitFireParticles(fb.x, fb.y, 14, 1);
        fireballs.splice(fireballs.indexOf(fb), 1);
        if(hp <= 0){ gameOver(); return; }
        continue;
      }
      // упал на землю — взрыв: поджигает и ранит мобов в радиусе
      if(fb.y + fb.r >= GROUND_Y){
        explodeFireball(fb);
        fireballs.splice(fireballs.indexOf(fb), 1);
        continue;
      }
    } else {
      // возвращённый фаербол: попал в дракона — единственный способ ранить его
      const drHit = dragons.find(dr => fb.x > dr.x + DRG_W*0.08 && fb.x < dr.x + DRG_W*0.96 &&
                                       fb.y > dr.y + DRG_H*0.02 && fb.y < dr.y + DRG_H*0.92);
      if(drHit){
        hitDragon(drHit, D.hitDmg);
        emitFireParticles(fb.x, fb.y, 16, 1.1);
        fireballs.splice(fireballs.indexOf(fb), 1);
        continue;
      }
      // ...или в мобов (можно метать и в толпу)
      let hitMob = false;
      for(const o of [...demons]){
        if(o.state==='held' || o.state==='offscreen' || o.state==='burrow' || o.flash>0 || !demons.includes(o)) continue;
        const os = sizeOf(o);
        if(Math.hypot(o.x+os/2 - fb.x, o.y+os/2 - fb.y) < fb.r + os*0.45){
          igniteDemon(o, 'spread');
          hurt(o, D.mobDmg, Math.max(Math.hypot(fb.vx, fb.vy), 400));
          hitMob = true; break;
        }
      }
      if(hitMob){
        emitFireParticles(fb.x, fb.y, 10, 0.9);
        fireballs.splice(fireballs.indexOf(fb), 1);
        continue;
      }
    }
    // ушёл за край экрана
    if(fb.x < -70 || fb.x > W + 90 || fb.y > H + 90 || fb.y < -120){
      fireballs.splice(fireballs.indexOf(fb), 1);
    }
  }
}

// ── ФИНАЛ после смерти дракона ──────────────────────────────────────
// Запуск: катарсис (испепеляем всё вокруг, пауза без мобов), дальше машина в updateFinale.
function beginFinale(){
  won = true;                       // боссов больше не спавним (см. updateBosses)
  finale = 'pause'; finaleT = CFG.finale.pauseTime;
  gateInvuln = true;                // врата неуязвимы, пока Тор не выкосит орду
  clearMobsCathartic();             // в момент смерти дракона — все мобы гибнут разом
  fireballs = []; pendingFB = []; heldFireball = null;
  cv.classList.remove('grabbing');
  shake = Math.max(shake, 22);
  music.toCombat();
}

// все текущие мобы гибнут разом — кровь и искры, без звука на каждого (один общий «бум»)
function clearMobsCathartic(){
  sfx.splat();
  for(const d of [...demons]){
    const s = sizeOf(d), px = d.x + s/2, py = d.y + s/2;
    const col = bloodCol(d.type);
    puddles.push({x:px, y:GROUND_Y, r:0, max:rnd(30,55), col, life:1.2, size: d.type==='small'?'mini':'medium'});
    for(let i=0;i<14;i++){
      particles.push({x:px, y:py, vx:rnd(-360,360), vy:rnd(-460,-60),
        col, life:rnd(.4,.9), size:rnd(2,6)});
    }
  }
  demons = [];
}

// финальная орда: фронт — стена неуязвимых титанов, позади — рой мелких прихвостней
function spawnHorde(){
  const F = CFG.finale;
  // титаны (фронт): неуязвимы, но их можно поднять и отшвырнуть недалеко
  for(let i = 0; i < F.hordeCount; i++){
    const d = spawnDemon('titan');
    d.horde = true; d.invuln = true;
    d.x = W + 10 + i * F.hordeGap + rnd(-8, 8);
    d.y = GROUND_Y - sizeOf(d);
  }
  // мелкие прихвостни (позади): обычные мобы, их можно давить
  for(let i = 0; i < F.minionCount; i++){
    const t = F.minionTypes[Math.floor(Math.random() * F.minionTypes.length)];
    const d = spawnDemon(t);
    d.horde = true;
    d.x = W + 40 + Math.random() * F.minionSpread;
    if(!TYPES[t].air) d.y = GROUND_Y - sizeOf(d);
  }
  floatText(W - 140, GROUND_Y - 120, 'ИХ СЛИШКОМ МНОГО!', '#c0392b', 1.6);
  shake = Math.max(shake, 10);
}

// x переднего (ближайшего к вратам) титана; null — если их нет
function leadingHordeX(){
  let m = null;
  for(const d of demons){ if(d.horde && (m === null || d.x < m)) m = d.x; }
  return m;
}

// смертельные молнии Тора с небес: 5 толстых разрядов сверху, выкашивают всю орду
function skyLightningKill(){
  const L = CFG.spells.lightning, F = CFG.finale;
  // разброс молний по протяжённости орды (запас — по центру экрана)
  let minX = W, maxX = 0;
  for(const d of demons){ if(!d.horde) continue; minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x + sizeOf(d)); }
  if(minX > maxX){ minX = MOUNTAIN_X + 40; maxX = W - 80; }
  for(let i = 0; i < F.boltCount; i++){
    const x = minX + (maxX - minX) * (i + 0.5) / F.boltCount + rnd(-14, 14);
    bolts.push({ x0: x + rnd(-20,20), y0: -80, x1: x, y1: GROUND_Y,
      life: L.flash * 1.7, max: L.flash * 1.7, scale: F.boltScale });
  }
  skyFlash = 1.6; shake = 28; sfx.splat();
  // орда мгновенно гибнет — разлетается и взрывается
  for(const d of [...demons]){ if(d.horde) explodeTitan(d); }
  gateInvuln = false; // Тор уничтожил всех врагов — снимаем неуязвимость врат
}

function explodeTitan(d){
  stopDemonScream(d);
  const s = sizeOf(d), px = d.x + s/2, py = d.y + s/2;
  emitFireParticles(px, py, 20, 1.4);
  const col = bloodCol(d.type);
  puddles.push({x:px, y:GROUND_Y, r:0, max:rnd(50,72), col, life:1.3, size:'medium'});
  for(let i = 0; i < 28; i++){
    particles.push({x:px, y:py, vx:rnd(-480,480), vy:rnd(-580,-80),
      col: i%2 ? col : '#ffcf3a', life:rnd(.5,1.2), size:rnd(3,8)});
  }
  demons.splice(demons.indexOf(d), 1);
}

// машина финала: каждый кадр (пока не на паузе диалога). Возвращает после смены фазы.
function updateFinale(dt){
  if(finale === 'pause'){
    finaleT -= dt;
    if(finaleT <= 0){ startDialogue('victoryRaven'); finale = 'dlgVictory'; }
  } else if(finale === 'dlgVictory'){
    if(!dialogueActive()){ spawnHorde(); finale = 'horde'; }
  } else if(finale === 'horde'){
    const lead = leadingHordeX();
    const triggerX = MOUNTAIN_X + (W - MOUNTAIN_X) * CFG.finale.lightningLeftFrac;
    if(lead !== null && lead <= triggerX){
      skyLightningKill();
      finale = 'lightningKill'; finaleT = CFG.finale.killPause;
    }
  } else if(finale === 'lightningKill'){
    finaleT -= dt;
    if(finaleT <= 0){ startDialogue('thor'); finale = 'dlgThor'; }
  } else if(finale === 'dlgThor'){
    if(!dialogueActive()){ showVictory(); finale = 'victoryScreen'; }
  }
}

// общий помощник: погасить игру и показать оверлей
function stopForOverlay(){
  logSession();
  stopAllDemonScreams();
  debugLocation = false;
  setDebugPanelVisible(false);
  running = false; held = null; heldBoulder = null; heldFireball = null;
  choosing = false; pendingLevels = 0; shake = 0;
  music.menu();
  lvlOverlay.classList.add('hidden');
  hideLabel('horn');
  cv.classList.remove('grabbing');
}

// экран победы с двумя кнопками: «оставить имя» (конец) / «бесконечный режим»
function showVictory(){
  stopForOverlay();
  ovTitle.textContent = 'Вы защитили Асгард';
  ovText.innerHTML = 'Дракон повержен, а орду испепелил сам Громовержец.<br>' +
    'Западная стена выстояла — Асгард спасён.';
  ovScore.textContent = 'Раздавлено: ' + score;
  ovScore.classList.remove('hidden');
  ovButtons.classList.add('hidden');         // прячем кнопку рестарта
  endlessBtn.classList.remove('hidden');     // «Бесконечный режим»
  toMenuBtn.classList.remove('hidden');      // «Выйти в меню»
  leaveNameBtn.classList.add('hidden');      // «оставить имя» — только на гибели в endless
  ovWinButtons.classList.remove('hidden');
  overlay.classList.remove('hidden');
}

// «Оставить своё имя в чертогах Одина» — конец игры, возврат на главный экран
function toMainScreen(){
  overlay.classList.add('hidden');
  ovWinButtons.classList.add('hidden');
  ovButtons.classList.remove('hidden');
  ovScore.classList.add('hidden');
  debugLocation = false;
  setDebugPanelVisible(false);
  finale = null; won = false; running = false;
  startScreen.classList.remove('hidden');
  trophyBtn.classList.remove('hidden'); // вернулись в меню — кубок снова доступен
  music.menu();
}

// «Бесконечный режим» — игра продолжается: поток мобов идёт без боссов и финала
function startEndless(){
  overlay.classList.add('hidden');
  ovWinButtons.classList.add('hidden');
  ovButtons.classList.remove('hidden');
  ovScore.classList.add('hidden');
  // первый заход в бесконечный режим открывает в меню старт «без диалогов и тутора»
  try { localStorage.setItem('godilla.endlessReached', '1'); } catch(e){}
  revealEndlessShortcut();
  // РАЗБЛОКИРУЕМ прокачку: в основной игре перков нет, они появляются только здесь.
  // Полный пул из 10 перков, шкала опыта с нуля, полоса навыков становится видимой.
  perksLive = true;
  perkPool = [...CFG.leveling.perks].sort(() => Math.random() - .5);
  player.level = 0; player.xp = 0; player.xpNeed = CFG.leveling.baseXP;
  pendingLevels = 0; choosing = false; currentOfferIds = [];
  lvlHud.style.display = '';
  updateXPBar();
  finale = 'endless';
  // планировщик боссов-пар бесконечного режима: первая пара через endlessBossFirst сек
  endlessT = 0; endlessBossCount = 0; endlessNextBossAt = CFG.endless.bossFirst;
  running = true;
  music.toCombat();
}

// ── бесконечный режим: эскалация + цикл боссов парами ──
// Боссы идут парами по кругу (циклоп → циклоп с забралом → дракон), интервал между
// парами сжимается: bossGap1 (60с) для первого круга, bossGap2 (30с), дальше bossGap3 (15с).
// Мобы при этом идут обычным потоком (см. спавн), а сложность снова растёт (см. эскалацию).
const ENDLESS_BOSS_SEQ = ['cyclops', 'visor', 'dragon'];
function updateEndlessBosses(){
  const E = CFG.endless;
  if(endlessT < endlessNextBossAt) return;
  const kind = ENDLESS_BOSS_SEQ[endlessBossCount % ENDLESS_BOSS_SEQ.length];
  spawnBossPair(kind);
  endlessBossCount++;
  // интервал до следующей пары: первый круг — реже, дальше всё чаще
  const gap = endlessBossCount < 3 ? E.bossGap1 : endlessBossCount < 6 ? E.bossGap2 : E.bossGap3;
  endlessNextBossAt = endlessT + gap;
}
function spawnBossPair(kind){
  if(kind === 'cyclops'){
    spawnCyclops({ endless: true, x: W + 10 });
    spawnCyclops({ endless: true, x: W + 10 + CYC_W + 40 }); // второй чуть правее (за экраном)
  } else if(kind === 'visor'){
    spawnCyclops({ visor: true, endless: true, x: W + 10 });
    spawnCyclops({ visor: true, endless: true, x: W + 10 + CYC_W + 40 });
  } else { // дракон — всегда ОДИН (не пара)
    const D = CFG.dragon;
    spawnDragon({ endless: true, targetX: W - DRG_W - D.margin });
  }
}

// ── поток врагов ───────────────────────────────────────────────────
// Выбор типа очередного моба. Два режима:
//  1) «премьера» — если есть разблокированный по времени тип, которого игрок ещё не
//     видел, и с прошлой премьеры прошло не меньше introGap секунд, то принудительно
//     выпускаем именно его (в порядке разблокировки). Он выходит один, а пока идёт
//     отсчёт introGap — спавнятся только уже знакомые типы, так что рядом с новичком
//     не появится другой незнакомый моб.
//  2) обычный поток — случайный тип из УЖЕ ВИДЕННЫХ с учётом времени:
//     вес = weight + grow*(прошло секунд с разблокировки).
function pickStreamType(){
  lastPickedDebut = false;
  const pool = CFG.stream.pool;
  const unlocked = pool.filter(e => gameTime >= e.from);

  // 1) премьера нового типа — по одному и с паузой между премьерами
  if(gameTime - lastDebutAt >= CFG.stream.introGap){
    const debut = unlocked.find(e => !seenTypes.has(e.type)); // самый ранний невиденный
    if(debut){
      if(TUTORIAL_DEBUT_TYPES.has(debut.type) && demons.some(m => m.state !== 'offscreen')){
        return null;
      }
      seenTypes.add(debut.type);
      lastDebutAt = gameTime;
      lastPickedDebut = true;
      return debut.type;
    }
  }

  // 2) обычный поток — только из уже знакомых типов
  // в бесконечном режиме роллер не чаще раза в endless.rollerEvery секунд (иначе их вал)
  const rollerCool = finale === 'endless' && (gameTime - lastRollerAt) < CFG.endless.rollerEvery;
  const seen = unlocked.filter(e => seenTypes.has(e.type) && !(rollerCool && e.type === 'roller'));
  const w = [];
  let total = 0;
  // вес типа растёт со временем, но не дольше weightGrowEnd — после этого микс мобов плато.
  // В бесконечном режиме плато снимается: вес продолжает расти от плато + время в эндлесе.
  const tw = finale === 'endless'
    ? CFG.stream.weightGrowEnd + endlessT
    : Math.min(gameTime, CFG.stream.weightGrowEnd);
  // пока на сцене циклоп с деревянным забралом — режем вертлявых синих (wisp): момент и так тяжёлый
  const visorFight = cyclopes.some(c => c.visor > 0);
  for(const e of seen){
    let ww = e.weight + e.grow * Math.max(0, tw - e.from);
    if(e.type === 'wisp' && visorFight) ww *= 0.25;
    w.push(ww); total += ww;
  }
  let r = Math.random() * total;
  for(let i = 0; i < seen.length; i++){ r -= w[i]; if(r <= 0) return seen[i].type; }
  return 'small';
}

// текущий интервал спавна: от startEvery к minEvery за rampTime секунд
function curSpawnEvery(){
  const S = CFG.stream;
  // бесконечный режим: интервал снова сжимается со временем (плотность растёт), до жёсткого пола
  if(finale === 'endless'){
    return Math.max(CFG.endless.minEvery, S.minEvery - endlessT * CFG.endless.densityPerSec);
  }
  const k = Math.min(1, gameTime / S.rampTime);
  const base = S.startEvery + (S.minEvery - S.startEvery) * k;
  if(!boss1Spawned) return base * S.preCyclopsSpawnMul;
  return boss2Spawned ? base * S.postVisorSpawnMul : base;
}

// один воздушный вихрь (клик по нему → торнадо). Плывёт влево из-за правого края.
function spawnSwirl(){
  const s = { x: W + 30, y: rnd(80, 190), spd: -rnd(45, 80) };
  swirls.push(s);
  floatText(W - 70, s.y, 'ВЕТЕР — КЛИКНИ!', '#1f7a7a', 1.8);
}

// зарядить грозой облако, поставив его центром над x (чтобы разряд бил в толпу под ним)
function chargeCloudAt(x){
  let best = null, bd = 1e9;
  for(const c of clouds){
    const cxc = c.x + cloudW(c)/2, d = Math.abs(cxc - x);
    if(d < bd){ bd = d; best = c; }
  }
  if(!best) return null;
  best.x = x - cloudW(best)/2;
  best.charge = 'storm';
  floatText(x, best.y + cloudH(best)/2, 'ГРОЗА — КЛИКНИ!', '#2a3a7a', 1.8);
  return best;
}

// ── спец-дебют роллера ──
// Сперва из-за края накатывает большая толпа собак и мелких (без крупных, чтобы её
// нельзя было мгновенно расчистить). Через пару секунд (толпа уходит вперёд) сам роллер
// ПОЯВЛЯЕТСЯ на экране (не выходит из-за края) — и срабатывает его дебют-тутор.
function startRollerDebut(){
  for(let i = 0; i < 16; i++){ const d = spawnDemon('dog');   d.x = W + 20 + i*30 + rnd(-6,6); d.y = GROUND_Y - sizeOf(d); }
  for(let i = 0; i < 12; i++){ const d = spawnDemon('small'); d.x = W + 26 + i*34 + rnd(-6,6); d.y = GROUND_Y - sizeOf(d); }
  rollerDebutT = 2.5; // через столько секунд выйдет сам роллер (толпа успеет уйти вперёд)
}
function updateRollerDebut(dt){
  if(rollerDebutT <= 0) return;
  rollerDebutT -= dt;
  if(rollerDebutT <= 0){
    const d = spawnDemon('roller', true); // true — появляется на экране, не из-за края
    d.x = W - 80; d.y = GROUND_Y - sizeOf(d); // позади ушедшей вперёд толпы
  }
}

// срежиссированное начало (обучение торнадо и молнии). Одноразовые события по времени.
function updateIntroScript(){
  const I = CFG.intro, T = CFG.tutorial;
  // 50с — пачка: 5 мелких + 10 собак, плотной волной из-за правого края
  if(!introPackDone && gameTime >= I.packAt){
    for(let i = 0; i < I.packSmall; i++){
      const d = spawnDemon('small'); d.x = W + 20 + i*22 + rnd(-6,6); d.y = GROUND_Y - sizeOf(d); d.introPack = true;
    }
    for(let i = 0; i < I.packDog; i++){
      const d = spawnDemon('dog');   d.x = W + 30 + i*30 + rnd(-6,6); d.y = GROUND_Y - sizeOf(d); d.introPack = true;
    }
    introPackDone = true;
  }
  // 55с — вихрь СТОИТ там, где мелочь окажется через swirlLeadSec секунд + тутор «бог ветра»
  if(!introSwirlDone && gameTime >= I.swirlAt){
    const smalls = demons.filter(d => d.introPack && d.type === 'small' && d.state !== 'offscreen' && d.state !== 'held');
    let sx = W * 0.45;
    if(smalls.length){
      const ax = smalls.reduce((s,d) => s + d.x + sizeOf(d)/2, 0) / smalls.length;
      const av = smalls.reduce((s,d) => s + d.speed, 0) / smalls.length;
      sx = ax - av * I.swirlLeadSec; // куда они придут через 5 сек (идут влево)
    }
    sx = Math.max(MOUNTAIN_X + 60, Math.min(W - 40, sx));
    const sw = { x: sx, y: rnd(95, 150), spd: 0 }; // неподвижный — метит точку, куда придёт пачка
    swirls.push(sw);
    floatText(sx, 78, 'ВЕТЕР — КЛИКНИ!', '#1f7a7a', 1.8);
    introSwirlDone = true;
    // тутор «бог ветра»: клик по иконке вихря сам запускает торнадо (dismiss:'swirl');
    // текст опущен ниже центра, чтобы не перекрывать иконку и стрелку
    if(tutorialTryMessage('wind', T.windTitle, T.windSub, 'swirl', '60%')) msgHi = { swirl: sw };
  }
  // толпа здоровяков с ЕДИНОЙ скоростью (идут кучей). Помечаем huge как «виденный»,
  // чтобы потом в потоке он не выходил принудительным дебютом
  if(!introHugeDone && gameTime >= I.hugeAt){
    for(let i = 0; i < I.hugeCount; i++){
      const d = spawnDemon('huge');
      d.x = W + 20 + i*44 + rnd(-6,6); d.y = GROUND_Y - sizeOf(d);
      d.speed = I.hugeSpeed; d.introHuge = true;
    }
    seenTypes.add('huge');
    introHugeDone = true;
  }
  // облако над толпой заряжается грозой + тутор «разряди в здоровяков»: клик по туче
  // сам бьёт молнией и закрывает подсказку (как у вихря). Текст опущен ниже.
  if(!introCloudDone && gameTime >= I.cloudAt){
    const hugs = demons.filter(d => d.introHuge && d.state !== 'offscreen' && d.state !== 'held');
    let hx = W * 0.6;
    if(hugs.length) hx = hugs.reduce((s,d) => s + d.x + sizeOf(d)/2, 0) / hugs.length;
    const hc = chargeCloudAt(hx);
    introCloudDone = true;
    if(tutorialTryMessage('storm', T.stormTitle, T.stormSub, 'cloud', '60%')) msgHi = hc ? { cloud: hc } : null;
  }
}

// ── прокачка ───────────────────────────────────────────────────────
// урон по вратам с учётом скилла «Каменная кладка»
function mountainDmg(base){
  // /1.3 — врата на 30% прочнее (урон по ним снижен; полоска по-прежнему 0..100)
  return Math.round(base * (1 - CFG.skills.armor.mult * sk('armor')) / 1.3);
}

// взрывная волна от падения брошенного демона (скилл shockwave)
function spawnShockwave(x, y, src){
  const r = CFG.skills.shockwave.radius + CFG.skills.shockRadius.add * sk('shockRadius');
  const dmg = CFG.skills.shockwave.dmg + sk('shockDmg');
  shockwaves.push({x, y, r: 8, max: r, life: .45});
  sfx.thud();
  for(const o of [...demons]){
    if(o === src || o.state === 'held' || o.state === 'offscreen' || o.state === 'burrow' || !demons.includes(o)) continue;
    const os = sizeOf(o);
    if(Math.hypot(o.x + os/2 - x, o.y + os/2 - y) <= r) hurt(o, dmg, 450);
  }
}

function updateXPBar(){
  lvlEl.textContent = player.level;
  // все 5 перков выбраны — полоса полна, дальше не качаемся
  if(player.level >= CFG.leveling.levels){ xpFill.style.width = '100%'; return; }
  xpFill.style.width = Math.min(100, 100 * player.xp / player.xpNeed) + '%';
}

function gainXP(n){
  if(!perksLive) return; // прокачка спит (включается только в бесконечном режиме)
  player.xp += n;
  // не больше CFG.leveling.levels уровней за забег (пул перков всё равно кончится)
  while(player.xp >= player.xpNeed && player.level < CFG.leveling.levels){
    player.xp -= player.xpNeed;
    player.level++;
    player.xpNeed = Math.round(player.xpNeed * CFG.leveling.growth);
    pendingLevels++;
  }
  updateXPBar();
  if(pendingLevels > 0 && !choosing && running) openSkillChoice();
}

function openSkillChoice(){
  // пул кончился (все перки разобраны) — выборов больше нет
  const eligible = perkPool.filter(perkEligible);
  if(eligible.length < 2){
    if(!firePerksUnlocked()) return; // огненные перки откроются вместе с жаровнями
    pendingLevels = 0; return;
  }
  shake = 0; // игра замирает — тряска камеры тоже
  // аккуратно выпускаем демона из руки
  if(held){
    held.state = 'fly'; held.vx = held.vy = 0;
    held.armed = false; held.noEyeDmg = false; held.noDmg = true;
    held = null; cv.classList.remove('grabbing');
  }
  choosing = true;
  currentOfferIds = eligible.slice(0, 2);
  const offer = currentOfferIds.map(id => ({ id, ...CFG.skills[id] }));
  const holdMs = (CFG.leveling.pickHold ?? 0.5) * 1000;
  skillCards.innerHTML = '';
  for(const s of offer){
    const btn = document.createElement('button');
    btn.className = 'skill-card';
    // .hold-fill — полоска прогресса удержания (растёт слева направо за holdMs)
    btn.innerHTML = '<b>' + s.name + '</b>' + s.desc +
      '<div class="hold-fill"></div>';
    const fill = btn.querySelector('.hold-fill');
    let timer = null;
    // зажатие: запускаем заливку и таймер выбора; выбор происходит по истечении holdMs
    const start = e => {
      e.preventDefault();
      if(timer) return;
      btn.classList.add('holding');
      fill.style.transition = 'transform ' + holdMs + 'ms linear';
      requestAnimationFrame(() => { fill.style.transform = 'scaleX(1)'; });
      timer = setTimeout(() => { timer = null; pickSkill(s.id); }, holdMs);
    };
    // отпустил/увёл курсор раньше времени — отменяем выбор, заливка быстро спадает
    const cancel = () => {
      if(timer){ clearTimeout(timer); timer = null; }
      btn.classList.remove('holding');
      fill.style.transition = 'transform 120ms ease-out';
      fill.style.transform = 'scaleX(0)';
    };
    btn.addEventListener('mousedown', start);
    btn.addEventListener('mouseup', cancel);
    btn.addEventListener('mouseleave', () => { cancel(); perkHover = false; }); // ушёл с карточки
    btn.addEventListener('mouseenter', () => { perkHover = true; });            // курсор-«указатель»
    btn.addEventListener('touchstart', start, { passive:false });
    btn.addEventListener('touchend', cancel);
    btn.addEventListener('touchcancel', cancel);
    skillCards.appendChild(btn);
  }
  perkHover = false; // на открытии выбора курсор нейтральный, пока не навели на карточку
  lvlOverlay.classList.remove('hidden');
}

function pickSkill(id){
  player.skills[id] = 1; // перк взят (все перки одноуровневые)
  // выбранная пара выбывает из забега; огненные перки до появления огня просто ждут в пуле
  const offered = new Set(currentOfferIds);
  perkPool = perkPool.filter(pid => !offered.has(pid));
  currentOfferIds = [];
  pendingLevels--;
  perkHover = false;
  lvlOverlay.classList.add('hidden');
  if(pendingLevels > 0){ openSkillChoice(); return; }
  choosing = false;
  // сбрасываем скорость мыши, чтобы после паузы не было фантомного рывка
  mouse.px = mouse.x; mouse.py = mouse.y; mouse.vx = mouse.vy = 0;
}

// ── заклинания: применяются как события мира (см. triggerCloud / носильщик валуна) ──

// Торнадо в точке centerX: втягивает орду к центру и подбрасывает вверх.
// Струи рождаются спиралью вокруг центра (см. отрисовку windStreaks).
// порция спиральных струй вокруг центра вихря (визуал)
function spawnVortexStreaks(x, n){
  for(let i = 0; i < n; i++){
    windStreaks.push({
      cx: x, baseY: GROUND_Y - rnd(0, 12),
      ang: rnd(0, Math.PI*2),
      rad: rnd(30, 230),
      angV: rnd(5.5, 9),      // все в одну сторону — единый закрут
      radV: -rnd(45, 95),     // втягивание внутрь
      riseV: rnd(120, 270),   // подъём вверх
      t: 0, life: rnd(.5, 1.0),
    });
  }
}

// клик по вихрю ставит торнадо: оно «висит» duration секунд (см. updateTornadoes),
// всё это время втягивая орду к центру и держа её в воздухе
function triggerTornado(centerX){
  const T = CFG.tornado;
  const life = T.duration + CFG.skills.tornadoDur.add * sk('tornadoDur');
  stats.tornado++;
  sfx.tornado(life);
  shake = Math.max(shake, 7);
  const cxC = Math.max(MOUNTAIN_X + 20, Math.min(W - 20, centerX));
  tornadoes.push({
    x: cxC,
    reach:   T.radius * (1 + CFG.skills.tornadoWide.mult * sk('tornadoWide')), // «Большая воронка»
    liftMul: 1 + CFG.skills.tornadoLift.mult * sk('tornadoLift'),              // «Мощный вихрь»
    pullMul: 1 + CFG.skills.gust.mult * sk('gust'),                            // «Порыв»
    life,                                                                    // «Долгая воронка»
    dmgT: CFG.skills.cyclone.every,
  });
  spawnVortexStreaks(cxC, 40); // начальный «вдох»
  for(const c of cyclopes){
    c.freeze = Math.max(c.freeze, CFG.spells.wind.stun);
    floatText(c.x+CYC_W/2, c.y-24, 'ЗАМЕР!', '#1a1626', 1);
  }
}

function debugSpawnUnit(type){
  if(!debugLocation || !running || !TYPES[type] || type === 'titan') return;
  const d = spawnDemon(type);
  seenTypes.add(type);
  d.x = W - 90;
  if(TYPES[type].air){
    d.airHomeX = d.x; d.airHomeY = d.y;
  } else {
    d.y = GROUND_Y - sizeOf(d);
  }
  floatText(d.x + sizeOf(d)/2, d.y - 12, type, '#1a1626', 0.8);
}

function debugCastWind(){
  if(!debugLocation || !running) return;
  triggerTornado(Math.min(W - 180, MOUNTAIN_X + 330));
}

function debugCastLightning(){
  if(!debugLocation || !running) return;
  castLightning(MOUNTAIN_X + 360, 72, 0, 1);
}

function debugSpawnBoss(kind){
  if(!debugLocation || !running) return;
  if(kind === 'cyclops'){
    spawnCyclops();
  } else if(kind === 'visor'){
    spawnCyclops({ visor: true });
  } else if(kind === 'dragon'){
    dragons = []; fireballs = []; pendingFB = []; heldFireball = null;
    spawnDragon();
  }
}

// каждый кадр: пока торнадо живо — крутит струи, втягивает и держит орду в воздухе
function updateTornadoes(dt){
  const T = CFG.tornado;
  for(const tr of [...tornadoes]){
    tr.life -= dt;
    spawnVortexStreaks(tr.x, 5);
    // «Смерч»: периодический урон пойманным
    let dmgNow = false;
    if(sk('cyclone') > 0){ tr.dmgT -= dt; if(tr.dmgT <= 0){ dmgNow = true; tr.dmgT = CFG.skills.cyclone.every; } }
    const caught = [];
    let anyBurning = false;
    let screamOffset = 0;
    for(const d of [...demons]){
      if(d === held || d.state === 'held' || d.state === 'offscreen' || d.state === 'burrow') continue;
      if(Math.abs((d.x + sizeOf(d)/2) - tr.x) > tr.reach) continue;
      if(TYPES[d.type].liftable === false){
        d.state = 'stun'; d.stun = Math.max(d.stun, 0.25); d.vx = d.vy = 0; d.rot = 0;
        continue;
      }
      const firstTornadoCatch = !d.windTossed;
      d.state = 'fly';
      const w = (d.type==='small'||d.type==='dog') ? 1.4 : (d.type==='huge') ? 0.6 : 0.85;
      const dir = (tr.x - (d.x + sizeOf(d)/2)) >= 0 ? 1 : -1;
      d.vx = dir * T.pull * w * tr.pullMul * 0.5;     // втягивает к центру
      const up = -T.lift * w * tr.liftMul * 0.7;       // держим в воздухе, пока вихрь жив
      if(d.vy > up * 0.5) d.vy = up;
      if(!d.rotV) d.rotV = rnd(-8, 8);
      d.armed = true; d.noEyeDmg = true; d.hitsLeft = sk('collide'); d.noDmg = false; d.grounded = false;
      d.windTossed = true; // заброшенный ураганом за стену не нанесёт урон вратам
      if(firstTornadoCatch && Math.random() < DEMON_SCREAM_CHANCE){
        scheduleDemonScream(d, screamOffset + rnd(0, DEMON_SCREAM_TORNADO_JITTER));
        screamOffset += DEMON_SCREAM_TORNADO_STEP;
      }
      if(dmgNow){ hurt(d, CFG.skills.cyclone.dmg, 300); }
      if(demons.includes(d)){ caught.push(d); if(burning(d)) anyBurning = true; }
    }
    // «Огненный смерч»: если в воронке есть горящий — поджигаем всю пойманную орду
    if(sk('fireVortex') > 0 && anyBurning){
      for(const d of caught) igniteDemon(d, 'spread');
    }
    if(tr.life <= 0) tornadoes.splice(tornadoes.indexOf(tr), 1);
  }
}

// рисует спиральный значок завихрения (кликабельный) в небе
function drawSwirl(s){
  const t = last * 0.001;
  const rot = t * 2.2;
  cx.save();
  cx.translate(s.x, s.y);
  cx.lineCap = 'round';
  cx.strokeStyle = '#9adfe8'; cx.lineWidth = 2.5;
  for(let arm = 0; arm < 2; arm++){
    cx.globalAlpha = 0.9;
    cx.beginPath();
    for(let k = 0; k <= 24; k++){
      const f = k/24;
      const a = rot + arm*Math.PI + f*Math.PI*2.2;
      const r = 4 + f*22;
      const x = Math.cos(a)*r, y = Math.sin(a)*r*0.7;
      if(k === 0) cx.moveTo(x, y); else cx.lineTo(x, y);
    }
    cx.stroke();
  }
  cx.globalAlpha = 0.22 + 0.16*Math.sin(t*4);
  cx.strokeStyle = '#cdeef4'; cx.lineWidth = 2;
  cx.beginPath(); cx.arc(0, 0, SWIRL_R, 0, Math.PI*2); cx.stroke();
  cx.restore();
  cx.globalAlpha = 1;
  cx.lineCap = 'butt';
}

// расстояние от точки (px,py) до отрезка (ax,ay)-(bx,by)
function distToSeg(px, py, ax, ay, bx, by){
  const dx = bx-ax, dy = by-ay;
  const l2 = dx*dx + dy*dy || 1;
  let t = ((px-ax)*dx + (py-ay)*dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax+dx*t), py - (ay+dy*t));
}

// молния: мгновенный разряд вдоль вектора броска до земли + сквозной урон + взрыв
function castLightning(sx, sy, vx, vy){
  const L = CFG.spells.lightning;
  // направление броска (вялый бросок → бьём вперёд-вниз)
  let nx = vx, ny = vy;
  const m = Math.hypot(nx, ny);
  if(m < 1){ nx = 1; ny = 0.5; } else { nx /= m; ny /= m; }
  const len = Math.hypot(nx, ny); nx /= len; ny /= len;
  // куда прилетит: до линии земли по лучу; если уходит вверх/в сторону — бьём в землю под точкой выхода
  let ex, ey;
  if(ny > 0.02){
    const d = (GROUND_Y - sy) / ny;
    ex = sx + nx*d; ey = GROUND_Y;
  } else {
    ex = sx + nx*900; ey = GROUND_Y;
  }
  ex = Math.max(-40, Math.min(W+40, ex));
  bolts.push({ x0: sx, y0: sy, x1: ex, y1: ey, life: L.flash, max: L.flash });
  // мгновенный сквозной урон по всей линии разряда
  const pierceR = L.pierceR + CFG.skills.stormWide.add * sk('stormWide');     // «Широкий разряд»
  const lineDmg = L.pierceDmg + CFG.skills.overcharge.add * sk('overcharge'); // «Перегруз»
  for(const o of [...demons]){
    if(o.state === 'held' || o.state === 'offscreen' || o.state === 'burrow' || o.flash > 0 || !demons.includes(o)) continue;
    const os = sizeOf(o);
    if(distToSeg(o.x+os/2, o.y+os/2, sx, sy, ex, ey) < pierceR + os*0.4){
      let dmg = lineDmg;
      if(burning(o)) dmg += CFG.skills.stormConduit.add * sk('stormConduit'); // «Громоотвод»: по горящим
      if(o.state === 'fly') dmg += CFG.skills.skyStrike.add * sk('skyStrike');  // «Гроза с небес»: по парящим
      hurt(o, dmg, 800);
      // «Оглушающий разряд»: выживший на линии замирает
      if(sk('boltStun') > 0 && demons.includes(o) && o.state !== 'burrow'){
        o.state = 'stun'; o.stun = Math.max(o.stun || 0, CFG.skills.boltStun.dur * sk('boltStun'));
        o.vx = o.vy = 0;
      }
    }
  }
  for(const c of [...cyclopes]){
    if(distToSeg(c.x+CYC_EYE.x, c.y+CYC_EYE.y, sx, sy, ex, ey) < CYC_EYE.r + L.pierceR)
      hitCyclops(c, L.eyeDmg);
  }
  // искры вдоль разряда
  for(let i = 0; i < 10; i++){
    const f = Math.random();
    particles.push({ x: sx + (ex-sx)*f, y: sy + (ey-sy)*f,
      vx: rnd(-120,120), vy: rnd(-160,40), col: i%2 ? '#7fb4ff' : '#f4faff',
      life: rnd(.2,.45), size: rnd(1,3) });
  }
  skyFlash = 1;            // вспышка-зарево на всё небо
  shake = Math.max(shake, 11);
  sfx.zap();
  boltBoom({ x: ex });
  if(sk('chain') > 0) chainLightning(ex, ey);   // «Цепная молния»
}

// «Цепная молния»: от точки удара разряд перескакивает на ближайших врагов
function chainLightning(x, y){
  const C = CFG.skills.chain, L = CFG.spells.lightning;
  const radius = C.radius + CFG.skills.chainJump.add * sk('chainJump');
  const hit = new Set();
  let px = x, py = y, hops = C.hops * sk('chain');
  while(hops-- > 0){
    let best = null, bd = radius;
    for(const o of demons){
      if(hit.has(o) || o.state==='held' || o.state==='offscreen' || o.state==='burrow' || !demons.includes(o)) continue;
      const os = sizeOf(o), dd = Math.hypot(o.x+os/2 - px, o.y+os/2 - py);
      if(dd < bd){ best = o; bd = dd; }
    }
    if(!best) break;
    hit.add(best);
    const os = sizeOf(best), bx = best.x+os/2, by = best.y+os/2;
    bolts.push({ x0: px, y0: py, x1: bx, y1: by, life: L.flash, max: L.flash });
    px = bx; py = by;
    hurt(best, C.dmg, 600);
  }
}

// взрыв молнии в точке удара о землю
function boltBoom(b){
  const L = CFG.spells.lightning;
  sfx.boom();
  shake = Math.max(shake, 9);
  const boomR = L.boomR * (1 + CFG.skills.boltWide.mult * sk('boltWide'));   // «Раскат»
  const boomDmg = L.boomDmg + CFG.skills.boltForce.add * sk('boltForce');    // «Громовой удар»
  shockwaves.push({x: b.x, y: GROUND_Y, r: 10, max: boomR, life: .4});
  for(let i = 0; i < 18; i++){
    particles.push({x:b.x, y:GROUND_Y-4, vx:rnd(-260,260), vy:rnd(-420,-60),
      col: i%2 ? '#7fb4ff' : '#f4faff', life:rnd(.3,.7), size:rnd(2,4)});
  }
  for(const o of [...demons]){
    if(o.state === 'held' || o.state === 'offscreen' || o.state === 'burrow' || !demons.includes(o)) continue;
    const os = sizeOf(o);
    if(Math.hypot(o.x+os/2 - b.x, o.y+os/2 - GROUND_Y) <= boomR) hurt(o, boomDmg, 600);
  }
}

// ломаный путь молнии между двумя точками (зигзаг со смещением по нормали)
function jaggedPath(x0, y0, x1, y1, jitter){
  const dx = x1-x0, dy = y1-y0;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = -dy/dist, ny = dx/dist;     // нормаль к линии
  const segs = Math.max(2, Math.round(dist / CFG.spells.lightning.segLen));
  const pts = [{x:x0, y:y0}];
  for(let i = 1; i < segs; i++){
    const f = i/segs;
    const taper = 1 - Math.abs(f-0.5);   // у концов изломов меньше
    const off = (Math.random()*2-1) * jitter * taper;
    pts.push({ x: x0+dx*f + nx*off, y: y0+dy*f + ny*off });
  }
  pts.push({x:x1, y:y1});
  return pts;
}

function strokePath(pts){
  cx.beginPath();
  cx.moveTo(pts[0].x, pts[0].y);
  for(let i = 1; i < pts.length; i++) cx.lineTo(pts[i].x, pts[i].y);
  cx.stroke();
}

function drawLightning(b){
  const L = CFG.spells.lightning;
  const sc = b.scale || 1;                        // небесные молнии Тора — толще/больше
  const t = Math.max(0, b.life / b.max);          // 1 → 0
  const flick = 0.55 + Math.random()*0.45;        // мерцание разряда
  const main = jaggedPath(b.x0, b.y0, b.x1, b.y1, L.jitter * sc);
  cx.save();
  cx.lineJoin = 'round'; cx.lineCap = 'round';
  // мягкое внешнее свечение (холодное, синеватое)
  cx.globalAlpha = 0.22 * t * flick; cx.strokeStyle = '#bcd8ff'; cx.lineWidth = 18 * sc; strokePath(main);
  // сине-голубой ореол
  cx.globalAlpha = 0.55 * t * flick; cx.strokeStyle = '#7fb4ff'; cx.lineWidth = 8 * sc; strokePath(main);
  // ветви
  cx.globalAlpha = 0.5 * t * flick; cx.strokeStyle = '#a7ccff'; cx.lineWidth = 2 * sc;
  for(let i = 1; i < main.length-1; i++){
    if(Math.random() < L.branchChance){
      const p = main[i];
      const bx = p.x + (Math.random()*2-1)*46;
      const by = Math.min(GROUND_Y, p.y + Math.random()*44);
      strokePath(jaggedPath(p.x, p.y, bx, by, L.jitter*0.6));
    }
  }
  // бело-голубое раскалённое ядро
  cx.globalAlpha = t; cx.strokeStyle = '#f4faff'; cx.lineWidth = 2.5 * sc; strokePath(main);
  // вспышка-шар в точке удара о землю
  const gr = 46 * sc;
  const g = cx.createRadialGradient(b.x1, b.y1, 0, b.x1, b.y1, gr);
  g.addColorStop(0, `rgba(244,250,255,${0.75*t})`);
  g.addColorStop(0.4, `rgba(127,180,255,${0.4*t})`);
  g.addColorStop(1, 'rgba(127,180,255,0)');
  cx.globalAlpha = 1; cx.fillStyle = g;
  cx.beginPath(); cx.arc(b.x1, b.y1, gr, 0, Math.PI*2); cx.fill();
  cx.restore();
  cx.globalAlpha = 1;
}

function crumbleBoulder(bl){
  sfx.thud();
  for(let i = 0; i < 16; i++){
    particles.push({x:bl.x, y:bl.y, vx:rnd(-200,200), vy:rnd(-260,-20),
      col: i%2 ? '#7e828c' : '#5d6066', life:rnd(.4,.8), size:rnd(2,5)});
  }
  boulders.splice(boulders.indexOf(bl), 1);
}

// ── управление ─────────────────────────────────────────────────────
function ptr(e){
  const r = cv.getBoundingClientRect();
  const t = e.touches ? e.touches[0] : e;
  return { x:(t.clientX-r.left)*(W/r.width), y:(t.clientY-r.top)*(H/r.height) };
}
function onDown(e){
  if(!running || choosing || settingsOpen) return;
  // тач: гасим браузерные жесты и синтетические mouse-события (иначе тап сработал бы дважды)
  if(e.touches) e.preventDefault();
  // идёт диалог: клик допечатывает реплику / листает дальше, в игру не проходит
  if(dialogueActive()){
    dialogueClick();
    e.preventDefault();
    return;
  }
  const p = ptr(e);
  mouse.x = mouse.px = p.x; mouse.y = mouse.py = p.y;
  mouse.vx = mouse.vy = 0;
  // открыто модальное обучающее сообщение. Тутор проходится кликом по ПОДСВЕЧЕННОМУ
  // объекту (а не любым кликом) — и только спустя skipLock секунд после появления,
  // чтобы случайным нажатием его не пропустить. 'grab'-туторы при этом ещё и хватают
  // цель; у «города» объекта нет — там закрывает любой клик.
  if(tutorialMsgActive()){
    if(tutorialMsgKey() === 'cyclops' || tutorialMsgKey() === 'visor'){
      // циклоп (и босс в забрале): через skipLock(0.5)с — клик по ГЛАЗУ; через cyclopsAnyClickAt(1.5)с — любой клик
      const mt = tutorialMsgTime();
      if(mt >= (CFG.tutorial.cyclopsAnyClickAt ?? 1.5)) dismissTutorialMessage();
      else if(mt >= (CFG.tutorial.skipLock ?? 0) && cyclopsEyeHit(p)) dismissTutorialMessage();
    } else if(tutorialMsgKey() === 'wind'){
      // тутор торнадо: клик по иконке вихря сам запускает торнадо и закрывает подсказку
      if(!tutorialMsgLocked() && msgHi && msgHi.swirl &&
         Math.hypot(p.x - msgHi.swirl.x, p.y - msgHi.swirl.y) <= SWIRL_R){
        triggerTornado(msgHi.swirl.x);
        const i = swirls.indexOf(msgHi.swirl); if(i >= 0) swirls.splice(i, 1);
        dismissTutorialMessage();
      }
    } else if(tutorialMsgKey() === 'storm'){
      // тутор грозы: клик по заряженной туче сам бьёт молнией и закрывает подсказку
      const c = msgHi && msgHi.cloud;
      if(!tutorialMsgLocked() && c &&
         p.x >= c.x && p.x <= c.x + cloudW(c) && p.y >= c.y && p.y <= c.y + cloudH(c)){
        triggerCloud(c);
        dismissTutorialMessage();
      }
    } else if(!tutorialMsgLocked()){
      if(tutorialMsgDismiss() === 'grab') tutorialGrab(p);          // схватить цель → пройдено
      else if(!tutorialHasObject()) dismissTutorialMessage();        // нет объекта (город) — любой клик
      else if(tutorialHitObject(p)) dismissTutorialMessage();        // клик по подсвеченному объекту
    }
    e.preventDefault();
    return;
  }
  // обучение первого моба: проходится захватом подсвеченного моба (после skipLock секунд)
  if(tutorialActive()){
    const d = tutorialDemon();
    if(!tutorialActiveLocked() && d && demons.includes(d) && d.state === 'walk'){
      const s = sizeOf(d);
      const dist = Math.hypot(p.x-(d.x+s/2), p.y-(d.y+s/2));
      // радиус захвата щедрый, чтобы новичок легко попал по подсвеченному мобу
      const gr = Math.max(TYPES[d.type].grabR, s) * 1.4;
      if(dist < gr){
        rememberAirHome(d);
        held = d; d.state='held'; d.rotV = 0;
        stopDemonScream(d);
        d.grounded = false; d.noDmg = false; d.swing = 0; d.walled = false; d.roofed = false;
        cv.classList.add('grabbing');
        sfx.grab();
        tutorialComplete(); // обучение пройдено — мир оживает
        tutDemon = d; afterFirstPending = true; // как добьём этого моба — второй диалог
      }
    }
    e.preventDefault();
    return;
  }
  // 0) клик по воздушному завихрению — торнадо в этой точке
  for(const s of swirls){
    if(Math.hypot(p.x - s.x, p.y - s.y) <= SWIRL_R){
      triggerTornado(s.x);
      swirls.splice(swirls.indexOf(s), 1);
      e.preventDefault();
      return;
    }
  }
  // 1) клик по заряженному облаку — грозовое событие
  for(const c of clouds){
    if(!c.charge) continue;
    if(p.x >= c.x && p.x <= c.x+cloudW(c) && p.y >= c.y && p.y <= c.y+cloudH(c)){
      triggerCloud(c);
      e.preventDefault();
      return;
    }
  }
  // 1.5) клик по летящему фаерболу дракона — ловим его в руку (потом метнём обратно)
  if(!heldFireball){
    let fbBest = null, fbd = 1e9;
    for(const fb of fireballs){
      if(fb.held || !fb.hostile) continue;
      const dist = Math.hypot(p.x - fb.x, p.y - fb.y);
      if(dist <= CFG.dragon.grabR + fb.r && dist < fbd){ fbBest = fb; fbd = dist; }
    }
    if(fbBest){
      fbBest.held = true; fbBest.vx = fbBest.vy = 0;
      heldFireball = fbBest;
      cv.classList.add('grabbing'); sfx.grab();
      floatText(fbBest.x, fbBest.y - 16, 'ПОЙМАЛ!', '#ffcf3a', 1.1);
      e.preventDefault();
      return;
    }
  }
  // 2) хватаешь носильщика — отбираешь у него валун (а не поднимаешь его самого)
  for(const d of demons){
    if(d.type !== 'roller' || !d.hasBoulder || d.state !== 'walk') continue;
    const s = sizeOf(d);
    const dist = Math.hypot(p.x-(d.x+s/2), p.y-(d.y+s/2));
    if(dist < TYPES.roller.grabR * (1 + CFG.skills.grip.mult * sk('grip')) * (usingTouch ? CFG.touchGrabMult : 1)){
      heldBoulder = { x: p.x, y: p.y };
      d.hasBoulder = false;
      cv.classList.add('grabbing');
      sfx.grab();
      floatText(d.x+s/2, d.y-10, 'ВАЛУН!', '#7e828c', 1);
      e.preventDefault();
      return;
    }
  }
  let best=null, bd=1e9;
  for(const d of demons){
    if(d.state==='held' || d.state==='burrow' || TYPES[d.type].liftable === false) continue;
    const s = sizeOf(d);
    const dist = Math.hypot(p.x-(d.x+s/2), p.y-(d.y+s/2));
    const gr = TYPES[d.type].grabR * (1 + CFG.skills.grip.mult * sk('grip')) * (usingTouch ? CFG.touchGrabMult : 1);
    if(dist < gr && dist < bd){ best=d; bd=dist; }
  }
  if(best){
    rememberAirHome(best);
    held = best; best.state='held'; best.rotV = 0;
    stopDemonScream(best);
    best.grounded = false; best.noDmg = false;
    best.swing = 0; best.walled = false; best.roofed = false;
    cv.classList.add('grabbing');
    sfx.grab();
    e.preventDefault();
  } else {
    // ткнули в неподъёмного — огромного демона или циклопа
    let hit = false;
    for(const d of demons){
      if(TYPES[d.type].liftable !== false) continue;
      const s = sizeOf(d);
      if(p.x > d.x && p.x < d.x+s && p.y > d.y && p.y < d.y+s){ hit = true; break; }
    }
    if(!hit){
      for(const c of cyclopes){
        if(p.x > c.x && p.x < c.x+CYC_W && p.y > c.y && p.y < c.y+CYC_H){ hit = true; break; }
      }
    }
    if(hit){
      floatText(p.x, p.y-12, 'НЕ ПОДНЯТЬ!', '#1a1626', 1);
      sfx.thud();
    }
  }
}
function onMove(e){
  const p = ptr(e);
  mouse.x = p.x; mouse.y = p.y;
  if(heldFireball){ heldFireball.x = p.x; heldFireball.y = p.y; }
  if(held || heldBoulder || heldFireball) e.preventDefault();
}
function onUp(){
  if(heldFireball){
    // метаем пойманный фаербол по вектору броска. Вялый бросок — просто роняем вправо
    const D = CFG.dragon, fb = heldFireball;
    let vx = mouse.vx, vy = mouse.vy;
    if(Math.hypot(vx, vy) < D.minReturnSpeed){ vx = 160; vy = -50; }
    fb.vx = vx; fb.vy = vy; fb.hostile = false; fb.held = false; fb.t = 0;
    heldFireball = null;
    cv.classList.remove('grabbing');
    sfx.throw();
    return;
  }
  if(heldBoulder){
    // метаем отобранный валун по вектору броска (вялый бросок — просто роняем)
    const B = CFG.spells.boulder;
    boulders.push({ x: heldBoulder.x, y: heldBoulder.y,
      vx: mouse.vx * B.throwF, vy: mouse.vy * B.throwF, rot: 0 });
    sfx.throw();
    heldBoulder = null;
    cv.classList.remove('grabbing');
    return;
  }
  if(held){
    const T = TYPES[held.type];
    // скорость броска: курсор к моменту отпускания часто уже притормозил
    // (скорость мыши затухает за пару кадров) — если затухающий пик замаха
    // больше текущей скорости, бросаем по вектору пика, чтобы рывок не пропадал
    let vx = mouse.vx, vy = mouse.vy;
    if(held.swing > Math.hypot(vx, vy)){ vx = held.swingVX; vy = held.swingVY; }
    const releaseSpeed = Math.hypot(vx, vy);
    const heldSize = sizeOf(held);
    if(T.air && held.y + heldSize < GROUND_Y - 8 && releaseSpeed < SPD_LIGHT){
      startAirReturn(held);
      held = null;
      cv.classList.remove('grabbing');
      return;
    }
    held.state='fly';
    // скорость броска гасится весом моба
    const tf = T.throwF;
    held.vx = vx * tf; held.vy = vy * tf;
    held.rotV = (Math.abs(held.vx)+Math.abs(held.vy)) * CFG.throwing.spin * (held.vx<0?-1:1) + rnd(-1,1);
    // бросок вдоль земли, когда моб уже стоит на полу: чуть подбрасываем,
    // иначе он «втыкается» в землю на первом же кадре полёта и замирает в стане
    const fl = GROUND_Y - sizeOf(held);
    if(held.y >= fl - 2 && Math.abs(held.vx) > 200 &&
       held.vy > -160 && held.vy < Math.abs(held.vx)*0.5){
      held.vy = -Math.max(200, Math.abs(held.vx)*0.12);
    }
    held.grounded = false;
    held.armed = true; // заряжен до первого касания земли
    held.noEyeDmg = false; // запрет от торнадо не переносится на ручной бросок
    held.hitsLeft = sk('collide'); // без «Тарана» столкновения безвредны
    if(releaseSpeed > DEMON_SCREAM_THROW_MIN_SPEED && Math.random() < DEMON_SCREAM_CHANCE) startDemonScream(held);
    sfx.throw();
    held = null;
  }
  cv.classList.remove('grabbing');
}
cv.addEventListener('mousedown', onDown);
window.addEventListener('mousemove', onMove);
window.addEventListener('mouseup', onUp);
cv.addEventListener('touchstart', onDown, {passive:false});
window.addEventListener('touchmove', onMove, {passive:false});
window.addEventListener('touchend', onUp);

// ── цикл ───────────────────────────────────────────────────────────
let last = 0;
// ── пылинки в воздухе ──────────────────────────────────────────────
// Мелкие искры пыли по всему экрану: лёгкий дрейф + кружение + мерцание.
// Рисуются в режиме 'lighter', поэтому ярко вспыхивают на светлых местах
// (в лучах света из-за облаков) и почти не видны на тёмном — «пляшут в луче».
let dust = [];
function initDust(){
  dust = [];
  for(let i = 0; i < 42; i++){                      // пылинок поменьше
    dust.push({
      x: rnd(0, W), y: rnd(0, H),
      r: rnd(0.6, 2.1),
      vx: rnd(-4, 4), vy: rnd(-3, 2),               // медленный дрейф (в среднем чуть вверх — парят)
      swirl: rnd(0.2, 0.6), swirlAmp: rnd(3, 8),    // спокойное кружение
      t: rnd(0, 99),
      twSpeed: rnd(0.7, 1.8), twPhase: rnd(0, 6.28),// медленное мерцание — пылинка «живёт» дольше
      baseA: rnd(0.25, 0.7),
    });
  }
}
function updateDust(dt){
  for(const p of dust){
    p.t += dt;
    p.x += p.vx*dt + Math.cos(p.t*p.swirl) * p.swirlAmp * dt;
    p.y += p.vy*dt + Math.sin(p.t*p.swirl*1.3) * p.swirlAmp * dt;
    if(p.x < -4) p.x = W+4; else if(p.x > W+4) p.x = -4; // мягкий перенос за краями
    if(p.y < -4) p.y = H+4; else if(p.y > H+4) p.y = -4;
  }
}
// мягкие лучи света из окна (слева сверху на фоне) — два толстых луча-клина,
// расходящихся из одной точки. Неяркие, чуть колышутся. Рисуются под пылью,
// чтобы пылинки мерцали «в луче».
function drawWindowRays(){
  const t = last * 0.001;
  dcx.save();
  dcx.globalCompositeOperation = 'lighter';
  dcx.translate(72, 26);   // общая точка истечения у левого окна
  const len = 780;
  const beams = [
    { ang: 0.42, spread: 190, a: 0.07 },  // верхний луч — положе
    { ang: 0.84, spread: 240, a: 0.06 },  // нижний луч — круче
  ];
  const base = 40; // толщина у самого окна (раньше 8 → 22) — основание лучей толще
  for(const b of beams){
    const a = b.a * (0.82 + 0.18*Math.sin(t*0.6 + b.ang*7)); // лёгкое дыхание яркости
    dcx.save();
    dcx.rotate(b.ang);     // оба из одной точки, но под разными углами — расходятся веером
    const g = dcx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, `rgba(255,238,196,${a})`);
    g.addColorStop(1, 'rgba(255,238,196,0)');
    dcx.fillStyle = g;
    // клин: от толщины base у окна сильно расширяется к дальнему краю
    dcx.beginPath();
    dcx.moveTo(0, -base/2);
    dcx.lineTo(len, -b.spread/2);
    dcx.lineTo(len,  b.spread/2);
    dcx.lineTo(0,  base/2);
    dcx.closePath();
    dcx.fill();
    dcx.restore();
  }
  dcx.restore();
}
function drawDust(){
  dcx.clearRect(0, 0, W, H);
  // пыль и лучи живут только на стартовом экране; после старта он скрыт — рисовать нечего
  if(startScreen.classList.contains('hidden')) return;
  drawWindowRays();
  dcx.save();
  dcx.globalCompositeOperation = 'lighter';
  for(const p of dust){
    const tw = 0.5 + 0.5*Math.sin(p.t*p.twSpeed + p.twPhase); // мерцание 0..1
    dcx.globalAlpha = p.baseA * tw;
    dcx.fillStyle = '#fff4d6'; // тёплый свет пылинки
    // квадратные пиксели разного размера. Размер — целый (1..4 px), но позицию
    // НЕ округляем: иначе на медленном дрейфе пылинка прыгает по целым пикселям
    // (рывки). Дробная позиция даёт плавное движение; края чуть мягче — на 1..4px
    // незаметно.
    const sz = Math.max(1, Math.round(p.r * 2));      // 1..4 px
    dcx.fillRect(p.x - sz/2, p.y - sz/2, sz, sz);
  }
  dcx.restore();
}

function loop(ts){
  const dt = Math.min(.033, (ts-last)/1000 || .016);
  last = ts;
  const active = gameplayActive();
  if(active) updateClouds(dt); // облака — часть игрового мира, на паузе стоят
  updateSmoke(dt);  // дым из труб домиков — тоже всегда
  updateBrzFire(dt);// огонь жаровен (пиксели) — анимируется всегда
  updateDust(dt);   // пылинки парят всегда
  updateCursor(dt); // курсор анимируется всегда, чтобы успеть «сжаться» при хватании
  updateDialogue(dt); // печать реплики во времени (если идёт диалог)
  tutorialTick(dt);   // копит время показа обучающего сообщения (для блокировки пропуска)
  // диалог и обучение замораживают мир (диалог играется первым, до обучения)
  if(active) update(dt);
  else shake = 0; // мир на паузе/стопе — всегда гасим тряску камеры (см. CLAUDE.md)
  draw();
  drawDust(); // пылинки стартового экрана — на своём холсте поверх письма
  // таймер боя + кнопка паузы: видны только в бою.
  // gameTime растёт лишь когда мир не на паузе, поэтому таймер сам замирает на паузе.
  if(running){
    debugTimerEl.classList.remove('hidden');
    pauseBtn.classList.remove('hidden');
    const m = Math.floor(gameTime/60), s = Math.floor(gameTime%60);
    debugTimerEl.textContent = m + ':' + String(s).padStart(2, '0');
  } else if(!debugTimerEl.classList.contains('hidden')){
    debugTimerEl.classList.add('hidden');
    pauseBtn.classList.add('hidden');
  }
  requestAnimationFrame(loop);
}

function gameplayActive(){
  return running && !choosing && !settingsOpen && !paused && !tutorialFrozen() && !dialogueActive();
}

// туториальный моб (которого игрок схватил в обучении) и флаг ещё-не-показанного
// второго диалога ворона — заполняются при захвате в обучении (см. onDown).
// afterFirstTimer — секундная задержка между смертью моба и началом реплик.
let afterFirstPending = false, tutDemon = null, afterFirstTimer = 0;
const AFTER_FIRST_DELAY = 1; // сек от смерти туториального моба до второго диалога

function update(dt){
  // скорость курсора (сглаженная) — для бросков и ударов об землю
  mouse.vx = mouse.vx*0.55 + ((mouse.x-mouse.px)/dt)*0.45*0.9;
  mouse.vy = mouse.vy*0.55 + ((mouse.y-mouse.py)/dt)*0.45*0.9;
  mouse.px = mouse.x; mouse.py = mouse.y;

  // разделались с туториальным мобом (пропал из боя) — заводим секундную задержку
  if(afterFirstPending && tutDemon && !demons.includes(tutDemon)){
    afterFirstPending = false; tutDemon = null;
    afterFirstTimer = AFTER_FIRST_DELAY;
  }
  // задержка истекла — запускаем второй диалог ворона (один раз)
  if(afterFirstTimer > 0){
    afterFirstTimer -= dt;
    if(afterFirstTimer <= 0){ afterFirstTimer = 0; startDialogue('afterFirst'); }
  }

  // непрерывный поток врагов (см. CFG.stream): со временем чаще и злее, без пауз
  gameTime += dt;
  // жаровни на крыше разгораются на 2-й минуте — раньше огня нет (см. CFG.fire.litAt)
  if(!debugLocation && !braziersLit && gameTime >= CFG.fire.litAt){
    braziersLit = true;
    for(const bz of BRAZIERS) emitFireParticles(bz.x, bz.y, 14, 1);
    shake = Math.max(shake, 6);
    if(tutorialTryMessage('brazier', CFG.tutorial.brazierTitle, CFG.tutorial.brazierSub, 'click')) msgHi = { braziers: true };
    if(pendingLevels > 0 && !choosing && running) openSkillChoice();
  }
  // внутренний уровень угрозы для сессионного лога
  const th = Math.floor(gameTime / CFG.stream.threatEvery) + 1;
  if(th !== threat) threat = th;
  // финал после смерти дракона (катарсис → ворон → орда → молнии Тора → победа)
  if(finale) updateFinale(dt);
  // бесконечный режим: копим время (для эскалации) и крутим цикл боссов-пар
  if(finale === 'endless'){ endlessT += dt; updateEndlessBosses(); }
  // обычный поток мобов: идёт в обычной игре и в бесконечном режиме, но НЕ во время
  // финальных сцен (пауза-катарсис, орда, молнии — там спавном рулит финал)
  if(!debugLocation && (!finale || finale === 'endless')){
    updateIntroScript();  // срежиссированные пачки/вихрь/гроза в начале партии
    updateRollerDebut(dt); // спец-дебют роллера: толпа → роллер сам выходит на экране
    // поток замирает в окне вокруг выхода дракона (см. dragonWavePause)
    if(!dragonWavePause()){
      spawnTimer -= dt;
      if(spawnTimer <= 0){
        const type = pickStreamType();
        if(type === 'roller' && lastPickedDebut){
          startRollerDebut();                 // спец-дебют: сперва толпа, потом роллер
          lastRollerAt = gameTime;
          spawnTimer = CFG.stream.tutorialIntroPause;
        } else if(type){
          if(type === 'roller') lastRollerAt = gameTime; // отметка для кулдауна в эндлесе
          // туторные мобы (первый в партии и дебюты с подсказкой) выходят сразу на экране,
          // чтобы стрелка/подсветка указывала на видимого моба; прочие — из-за края экрана
          const wasFirst = firstSpawnPending;
          const tutorMob = firstSpawnPending || (lastPickedDebut && TUTORIAL_DEBUT_TYPES.has(type));
          const d0 = spawnDemon(type, tutorMob);
          firstSpawnPending = false;
          // самый первый (туторный) моб выходит ПАРОЙ — рядом с ним напарник-мелкий
          if(wasFirst){ const c = spawnDemon('small', true); c.x = d0.x + 70; c.y = GROUND_Y - sizeOf(c); }
          spawnTimer = lastPickedDebut && TUTORIAL_DEBUT_TYPES.has(type)
            ? CFG.stream.tutorialIntroPause
            : curSpawnEvery() * rnd(.8, 1.2);
        } else {
          spawnTimer = 0.35; // ждём, пока сцена очистится для туториального дебюта
        }
      }
    }
  }
  // боссы выходят последовательно, каждый по одному разу (см. updateBosses)
  if(!debugLocation) updateBosses(dt);

  // первый моб вышел — запускаем обучение и замораживаем мир до его захвата
  if(tutorialOnFirstDemon(demons)) return;
  // одноразовые подсказки про новые типы врагов (здоровяк, носильщик, циклоп, стрелок, копатель)
  if(tutorialScan(dt)) return;

  for(const d of [...demons]){
    if(!demons.includes(d)) continue;
    updateDemonScream(d, dt);
    d.t += dt;
    if(d.flash > 0) d.flash -= dt;
    if(d.cycHit > 0) d.cycHit -= dt;
    const s = sizeOf(d);

    if(d.state === 'offscreen'){
      // вне экрана: неуязвим, просто ждёт и возвращается в бой
      d.returnT -= dt;
      if(d.returnT <= 0) returnFromOffscreen(d);
      continue;
    }
    if(!updateDemonBurn(d, dt)) continue;
    if(d.state === 'burrow'){
      // роет под землёй — быстро и неуязвимо; на рубеже выныривает и идёт пешком
      d.x -= TYPES[d.type].burrowSpeed * dt * enemySlow();
      d.y = GROUND_Y - s;
      if(d.x <= W * TYPES[d.type].emergeAt){
        d.state = 'walk';
        sfx.thud(); shake = Math.max(shake, 4);
        for(let i=0;i<12;i++) particles.push({x:d.x+s/2, y:GROUND_Y,
          vx:rnd(-150,150), vy:rnd(-260,-40), col:'#7a5a32', life:rnd(.3,.6), size:rnd(2,5)});
      }
    }
    else if(d.state === 'ranged'){
      // стоит на рубеже и обстреливает врата
      d.y = GROUND_Y - s; d.rot = Math.sin(d.t*6)*0.05;
      d.fireT -= dt;
      if(d.fireT <= 0){ fireShot(d); d.fireT = TYPES[d.type].fireEvery * rnd(.85, 1.15); }
    }
    else if(d.state === 'airReturn'){
      const T2 = TYPES[d.type];
      const targetX = d.airHomeX ?? d.x;
      const targetY = d.airHomeY ?? airTargetY(d, T2);
      const dx = targetX - d.x, dy = targetY - d.y;
      const dist = Math.hypot(dx, dy);
      const step = 540 * dt;
      if(dist <= step || dist < 2){
        d.x = targetX; d.y = targetY;
        d.flyY = airBaseForY(d, T2, d.y);
        d.state = 'walk';
      } else {
        d.x += dx / dist * step;
        d.y += dy / dist * step;
      }
      d.rot = Math.sin(d.t*5)*0.12;
      if(d.x < MOUNTAIN_X) reachMountain(d);
    }
    else if(d.state === 'walk'){
      const T2 = TYPES[d.type];
      d.x -= d.speed * dt * enemySlow();   // «Трясина» замедляет
      if(T2.air){
        // парит; эрратик петляет по высоте и рыщет по горизонтали — трудно схватить
        if(T2.erratic){
          d.y = airTargetY(d, T2);
          d.x += Math.sin(d.t*2.6) * (T2.erraticX ?? 48) * dt;
        } else {
          d.y = airTargetY(d, T2);
        }
        d.rot = Math.sin(d.t*5)*0.12;
        if(d.x < MOUNTAIN_X) reachMountain(d);
      } else if(T2.rangeAt && d.x <= W * T2.rangeAt){
        d.state = 'ranged'; d.fireT = 0.5; // дошёл до рубежа — начинает обстрел
      } else {
        const hop = d.type==='big' ? 4 : 7;
        d.y = GROUND_Y - s - Math.abs(Math.sin(d.t*(d.type==='big'?5:7))) * hop;
        d.rot = Math.sin(d.t*7) * (d.type==='big' ? 0.1 : 0.18);
        if(d.x < MOUNTAIN_X) reachMountain(d);
      }
    }
    else if(d.state === 'held'){
      const T = TYPES[d.type];
      // тянемся к курсору (тяжёлые — медленнее, отстают)
      const px0 = d.x; // позиция до шага — чтобы знать, с какой стороны подошли к стене
      const py0 = d.y; // позиция до шага — чтобы ловить удар сверху о крышу башни
      const tx = mouse.x - s/2, ty = mouse.y - s/2;
      d.x += (tx - d.x) * Math.min(1, dt*T.follow);
      d.y += (ty - d.y) * Math.min(1, dt*T.follow);
      d.rot = Math.sin(d.t*14) * 0.45;
      if(overlapsBrazier(d, s)) igniteDemon(d, 'brazier');

      // пик скорости замаха: моб отстаёт от курсора и долетает до земли уже после
      // того, как рука остановилась, — поэтому силу удара меряем не в момент касания,
      // а как затухающий максимум скорости курсора за замах
      const spCur = Math.hypot(mouse.vx, mouse.vy);
      if(spCur >= d.swing){
        d.swing = spCur;
        d.swingVX = mouse.vx; d.swingVY = mouse.vy;
      } else {
        const f = Math.pow(0.5, dt / CFG.impact.swingFade);
        d.swing *= f; d.swingVX *= f; d.swingVY *= f;
      }

      // ── глаз циклопа: можно «бить» зажатым юнитом; после удара он вываливается из рук ──
      let bonked = false;
      for(const c of cyclopes){
        const dEye = Math.hypot(d.x+s/2-(c.x+CYC_EYE.x), d.y+s/2-(c.y+CYC_EYE.y));
        if(dEye < CYC_EYE.r + s*0.48){
          const eyeSp = eyeImpactSpeed(d, d.swing);
          hitCyclops(c, eyeDamageFromDemon(d, eyeSp), burning(d));
          hurt(d, 1, d.swing);          // сам моб получает 1 от удара о глаз
          if(demons.includes(d)){
            // выжил — выпадает из рук и падает
            held = null; cv.classList.remove('grabbing');
            d.state = 'fly'; d.armed = false; d.noEyeDmg = true; d.grounded = false;
            d.swing = 0;
            d.vx = mouse.vx * 0.3; d.vy = Math.max(0, mouse.vy * 0.3);
          }
          bonked = true;
          break;
        }
      }
      if(bonked) continue; // моб уже не в руках (выпал или погиб)

      // ── упор в землю: не проваливается, а стукается ──
      const floor = GROUND_Y - s;
      if(d.y >= floor){
        d.y = floor;
        if(!d.grounded){
          d.grounded = true;
          const dmg = impactDamage(d.swing);
          playImpactSlapIfNonlethal(d, dmg, d.swing); // летальный удар озвучит только splat/shmiak
          if(dmg > 0){
            slamSmaller(d);        // ударная волна по меньшим (до урона себе — d ещё жив)
            fireBurst(d.x + s/2, GROUND_Y, d);
            hurt(d, dmg, d.swing);
            d.swing = 0;
          }
        }
        // лёгкое "вдавливание" — сплющивается
        d.rot = 0;
      } else if (ty < floor - 12){
        // курсор подняли над землёй — следующий удар снова засчитается
        // (раньше ждали подъёма самого моба: тяжёлые не успевали «отлипнуть»,
        // и повторные удары пропадали)
        d.grounded = false;
      }
      // в стены тоже упирается
      d.x = Math.max(4, Math.min(W-s-4, d.x));
      // ── крыша башни: подошёл сверху — стукается как о землю ──
      if(py0 + s <= TOWER_ROOF.y && d.y + s >= TOWER_ROOF.y && overlapsTowerRoof(d, s)){
        d.y = TOWER_ROOF.y - s;
        if(!d.roofed){
          d.roofed = true;
          const dmg = impactDamage(d.swing);
          if(dmg > 0){
            hurt(d, dmg, d.swing);
            d.swing = 0;
            if(!demons.includes(d)) continue;
          } else sfx.thud();
        }
        d.rot = 0;
      } else if(d.y + s < TOWER_ROOF.y - 12 || !overlapsTowerRoof(d, s)){
        d.roofed = false;
      }
      // ── стена замка: подошёл справа ниже кромки — стукается; выше — проносится ──
      if(d.x < WALL.x && d.y + s > WALL.top && px0 >= WALL.x){
        d.x = WALL.x;
        if(!d.walled){
          d.walled = true;
          const dmg = impactDamage(d.swing);
          playImpactSlapIfNonlethal(d, dmg, d.swing); // летальный удар озвучит только splat/shmiak
          if(dmg > 0){ hurt(d, dmg, d.swing); d.swing = 0; }
        }
      } else if(d.x > WALL.x + 12){
        d.walled = false;
      }
    }
    else if(d.state === 'fly'){
      const px0 = d.x; // позиция до шага — для коллизии со стеной замка
      const py0 = d.y; // позиция до шага — для коллизии с крышей башни
      d.vy += GRAV * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.rot += d.rotV * dt * 4;
      const M = CFG.offscreen.margin;
      // улетел за ЛЕВЫЙ край — попал в город за вратами. Если занесло ураганом
      // (windTossed) — не вина игрока: без урона, моб вернётся в поток. Иначе его
      // «доставили» за врата: урон вратам + (в первый раз) обучающее предупреждение.
      if(d.x + s < -M){
        if(d.windTossed) sendOffscreen(d);
        else cityBreach(d);
        continue;
      }
      // улетел за ПРАВЫЙ край — выброшен прочь: получает урон, потом вернётся справа
      if(d.x > W + M){
        sendOffscreen(d);
        continue;
      }

      // ── столкновения с другими демонами: взаимный урон ──
      // открывается скиллом «Таран»; урон наносит только «заряженный» демон —
      // брошенный, не коснувшийся земли и с запасом жертв (hitsLeft)
      let spNow = Math.hypot(d.vx, d.vy);
      if(d.armed && d.hitsLeft > 0 && spNow >= SPD_LIGHT){
        for(const o of [...demons]){
          if(!demons.includes(d)) break;
          if(o===d || !demons.includes(o) || o.state==='held' || o.state==='offscreen' || o.state==='burrow' || o.flash>0) continue;
          const os = sizeOf(o);
          const rel = o.state==='fly' ? Math.hypot(d.vx-o.vx, d.vy-o.vy) : spNow;
          if(rel < SPD_LIGHT) continue;
          const dist = Math.hypot((d.x+s/2)-(o.x+os/2), (d.y+s/2)-(o.y+os/2));
          if(dist > (s+os)*0.38) continue;
          const dmgOut  = impactDamage(rel) + sk('throwDmg');
          // ответный урон не больше макс. ХП жертвы: мелкий вернёт максимум 1
          const dmgBack = Math.min(TYPES[o.type].hp, dmgOut);
          // «Огненный таран»: горящий снаряд поджигает жертву
          if(sk('infernoThrow') > 0 && burning(d)) igniteDemon(o, 'spread');
          hurt(o, dmgOut, rel);
          if(demons.includes(o)){ // жертва выжила — отлетает (но сама уже не «заряжена»)
            o.state='fly'; o.vx = d.vx*0.7; o.vy = -170;
            o.rotV = rnd(-4,4); o.grounded = false; o.armed = false; o.noEyeDmg = false; o.hitsLeft = 0;
          }
          hurt(d, dmgBack, rel);
          d.vx *= 0.55; d.vy *= 0.55;
          spNow = Math.hypot(d.vx, d.vy);
          d.hitsLeft--;
          if(d.hitsLeft <= 0) break;
        }
        if(!demons.includes(d)) continue;
      }

      // ── попадание в глаз циклопа (тело без коллизии — моб пролетает насквозь) ──
      for(const c of cyclopes){
        const sp3 = Math.hypot(d.vx, d.vy);
        const eyeSp = eyeImpactSpeed(d, sp3);
        const dEye = Math.hypot(d.x+s/2-(c.x+CYC_EYE.x), d.y+s/2-(c.y+CYC_EYE.y));
        if(d.armed && !d.noEyeDmg && dEye < CYC_EYE.r + s*0.48 && eyeSp >= SPD_LIGHT){
          const dmg = eyeDamageFromDemon(d, eyeSp);
          hitCyclops(c, dmg, burning(d));
          d.armed = false; d.noEyeDmg = false; // бросок «разряжен» — второй раз глаз не бьёт
          hurt(d, 1, sp3);
          break;
        }
      }
      if(!demons.includes(d)) continue;

      // ── крыша башни: прилетел сверху — стукается как об землю ──
      if(hitsTowerRoofFromAbove(d, s, py0)){
        stopDemonScream(d);
        d.y = TOWER_ROOF.y - s;
        const sp = Math.hypot(d.vx, d.vy);
        const wasArmed = d.armed;
        d.armed = false; d.noEyeDmg = false; // о крышу бросок «разряжается», как об пол
        const dmg = wasArmed ? fireImpactDamage(impactDamage(sp), d, wasArmed, sp) : 0;
        d.rotV *= CFG.throwing.spinFloorDamp;
        if(dmg > 0){
          fireBurst(d.x + s/2, TOWER_ROOF.y, d);
          hurt(d, dmg, sp);
          if(!demons.includes(d)) continue; // разбился о крышу
        } else sfx.thud();
        if(Math.abs(d.vy) > 160){
          d.vy = -d.vy*0.45; d.vx *= .7;
        } else {
          d.state='stun'; d.stun = .8 + (TYPES[d.type].hp - d.hp)*0.2;
          d.vx=d.vy=0; d.rot = 0;
        }
        continue;
      }

      // ── стена замка: прилетел справа ниже кромки — стукается как об землю ──
      // (выше кромки — пролетает и может упасть уже в защищаемой зоне)
      if(d.x < WALL.x && d.y + s > WALL.top && px0 >= WALL.x){
        stopDemonScream(d);
        d.x = WALL.x;
        const sp = Math.hypot(d.vx, d.vy);
        const wasArmed = d.armed;
        d.armed = false; d.noEyeDmg = false; // о стену бросок «разряжается», как об пол
        const dmg = wasArmed ? fireImpactDamage(impactDamage(sp), d, wasArmed, sp) : 0;
        playImpactSlapIfNonlethal(d, dmg, sp); // летальный удар озвучит только splat/shmiak
        if(dmg > 0){
          fireBurst(WALL.x, d.y + s/2, d);
          hurt(d, dmg, sp);
          if(!demons.includes(d)) continue; // разбился о стену
        }
        d.vx = Math.max(140, Math.abs(d.vx)*0.45); // отскок вправо от стены
        d.rotV *= CFG.throwing.spinFloorDamp;
      }

      if(d.y + s >= GROUND_Y){
        stopDemonScream(d);
        d.y = GROUND_Y - s;
        // приземлился справа от врат — снова обычный моб (метка подброса ураганом снимается);
        // если упал ЗА врата (слева) — метка остаётся, и врата не получат урон
        if(d.x + s/2 >= MOUNTAIN_X) d.windTossed = false;
        const sp = Math.hypot(d.vx, d.vy);
        if(d.noDmg){
          // вывалился из рук — падение без урона
          sfx.slap(sp); // удар мобом о землю — по скорости падения
          d.noDmg = false;
          d.state='stun'; d.stun = .5; d.vx=d.vy=0; d.rot = 0;
          continue;
        }
        // урон от пола только при первом касании за бросок; дальше — разряжен
        const wasArmed = d.armed;
        const dmg = wasArmed ? fireImpactDamage(impactDamage(sp), d, wasArmed, sp) : 0;
        playImpactSlapIfNonlethal(d, dmg, sp); // летальный удар озвучит только splat/shmiak
        d.armed = false; d.noEyeDmg = false;
        d.rotV *= CFG.throwing.spinFloorDamp; // об пол вращение гасится
        if(wasArmed && sk('shockwave') > 0 && sp >= SPD_LIGHT){
          spawnShockwave(d.x + s/2, GROUND_Y, d);
        }
        if(dmg > 0){
          fireBurst(d.x + s/2, GROUND_Y, d);
          hurt(d, dmg, sp);
          if(!demons.includes(d)) continue; // разбился
        }
        // выжил: отскок или стан (звук удара уже сыграл slap при контакте с землёй)
        if(Math.abs(d.vy) > 160){
          d.vy = -d.vy*0.45; d.vx *= .7;
        } else {
          d.state='stun'; d.stun = .8 + (TYPES[d.type].hp - d.hp)*0.2;
          d.vx=d.vy=0; d.rot = 0;
        }
      }
    }
    else if(d.state === 'stun'){
      d.stun -= dt;
      d.rot = Math.sin(d.t*30)*.1;
      if(d.stun<=0){
        if(!startAirReturn(d)) d.state='walk';
      }
    }
  }

  // ── отобранный валун тянется за курсором ──
  if(heldBoulder){
    heldBoulder.x += (mouse.x - heldBoulder.x) * Math.min(1, dt*22);
    heldBoulder.y += (mouse.y - heldBoulder.y) * Math.min(1, dt*22);
  }
  // ── воздушные завихрения: стандартно — только после срежиссированного первого
  // вихря (см. updateIntroScript) и не в отладочном режиме локации ──
  if(introSwirlDone && !debugLocation){
    nextSwirl -= dt;
    if(nextSwirl <= 0){
      spawnSwirl();
      // «Эолова длань»: вихри появляются чаще
      nextSwirl = rnd(CFG.tornado.swirlMin, CFG.tornado.swirlMax) / (1 + CFG.skills.windcaller.mult * sk('windcaller'));
    }
  }
  for(const s of [...swirls]){
    s.x += s.spd * dt;
    if(s.x < -40) swirls.splice(swirls.indexOf(s), 1); // уплыло — шанс упущен
  }
  // «Зодчий»: врата медленно чинятся со временем
  if(sk('gateRegen') > 0 && hp > 0 && hp < 100){
    hp = Math.min(100, hp + CFG.skills.gateRegen.perSec * sk('gateRegen') * dt);
    hpFill.style.width = hp + '%';
  }

  // ── молнии (мгновенный разряд — только гаснущая вспышка) ──
  for(const b of [...bolts]){
    b.life -= dt;
    if(b.life <= 0) bolts.splice(bolts.indexOf(b), 1);
  }
  if(skyFlash > 0) skyFlash = Math.max(0, skyFlash - dt * 3.5); // зарево гаснет за ~0.3с

  // ── валуны ──
  const B = CFG.spells.boulder;
  for(const bl of [...boulders]){
    bl.vy += GRAV * B.gravMult * dt;
    bl.x += bl.vx*dt; bl.y += bl.vy*dt;
    bl.rot += bl.vx*dt / B.r; // катится — крутится
    const M = CFG.offscreen.margin;
    if(bl.x + B.r < -M || bl.x - B.r > W + M || bl.y - B.r > H + M){
      boulders.splice(boulders.indexOf(bl), 1);
      continue;
    }
    const spd = Math.hypot(bl.vx, bl.vy);
    // сбивает мобов
    for(const o of [...demons]){
      if(o.state==='held' || o.state==='offscreen' || o.state==='burrow' || o.flash>0 || !demons.includes(o)) continue;
      const os = sizeOf(o);
      if(Math.hypot(o.x+os/2 - bl.x, o.y+os/2 - bl.y) < B.r + os*0.45){
        hurt(o, B.dmg, Math.max(spd, 400));
        if(demons.includes(o)){ // выжил — отлетает
          o.state='fly'; o.vx = bl.vx*0.6; o.vy = -150;
          o.armed = false; o.noEyeDmg = false; o.hitsLeft = 0; o.grounded = false;
        }
      }
    }
    // циклоп: только глаз получает урон (тело без коллизии — валун летит сквозь)
    let gone = false;
    for(const c of cyclopes){
      const dEye = Math.hypot(bl.x-(c.x+CYC_EYE.x), bl.y-(c.y+CYC_EYE.y));
      if(dEye < CYC_EYE.r + B.r){
        hitCyclops(c, B.eyeDmg);
        crumbleBoulder(bl); gone = true;
        break;
      }
    }
    if(gone) continue;
    // земля: отскок и качение (только при падении — из руки валун стартует ниже линии земли)
    if(bl.y + B.r >= GROUND_Y && bl.vy >= 0){
      bl.y = GROUND_Y - B.r;
      if(bl.vy > 140){ sfx.thud(); shake = Math.max(shake, 3); }
      bl.vy = -bl.vy * 0.3;
      bl.vx -= bl.vx * 1.2 * dt; // трение качения
    }
    // остановился на поле — рассыпается и исчезает
    if(bl.y + B.r >= GROUND_Y - 2 && Math.abs(bl.vx) < B.crumbleSpd && Math.abs(bl.vy) < 60){
      crumbleBoulder(bl);
    }
  }

  // ── активные торнадо: держат орду в воздухе, пока живы ──
  updateTornadoes(dt);

  // ── спиральные струи торнадо: вращаются вокруг центра, втягиваются и поднимаются ──
  for(const ws of [...windStreaks]){
    ws.t += dt; ws.life -= dt;
    ws.ang += ws.angV * dt;
    ws.rad = Math.max(2, ws.rad + ws.radV * dt);
    if(ws.life <= 0) windStreaks.splice(windStreaks.indexOf(ws), 1);
  }

  // ── снаряды дальних мобов: летят к вратам, на стене бьют по прочности ──
  for(const sh of [...shots]){
    sh.x += sh.vx * dt;
    if(sh.x <= MOUNTAIN_X){
      if(!gateImmune()){
        const dmg = mountainDmg(sh.dmg);
        stats.gateShots++;
        hp = Math.max(0, hp - dmg); hpFill.style.width = hp + '%';
        floatText(MOUNTAIN_X+20, sh.y, '-'+dmg, '#c0392b', 1);
      }
      shake = Math.max(shake, 6); sfx.reach();
      shots.splice(shots.indexOf(sh), 1);
      if(hp <= 0){ gameOver(); }
      continue;
    }
    if(sh.x < -20) shots.splice(shots.indexOf(sh), 1);
  }

  // ── циклопы ──
  for(const c of [...cyclopes]){
    c.t += dt;
    if(c.eyeFlash > 0) c.eyeFlash -= dt;
    if(c.visorFlash > 0) c.visorFlash -= dt;
    if(!updateCyclopsBurn(c, dt)) continue;
    if(c.freeze > 0){ c.freeze -= dt; } // замер от порыва ветра
    else if(c.state === 'walk'){
      c.x -= CFG.cyclops.speed * dt * enemySlow();
      c.step -= dt;
      if(c.step <= 0){ c.step = 0.8; shake = Math.max(shake, CFG.cyclops.shakeStep); sfx.thud(); }
      if(c.x < MOUNTAIN_X - 20){ c.state = 'pound'; c.poundT = 1; }
    } else {
      // дошёл — крушит врата ударами
      c.poundT -= dt;
      if(c.poundT <= 0){
        c.poundT = CFG.cyclops.poundEvery;
        if(!gateImmune()){
          const pd = mountainDmg(CFG.cyclops.mtnDmg);
          hp = Math.max(0, hp - pd);
          hpFill.style.width = hp + '%';
          floatText(MOUNTAIN_X+40, GROUND_Y-170, '-'+pd, '#c0392b', 1.2);
        }
        shake = CFG.cyclops.shakePound; sfx.reach();
        for(let i=0;i<14;i++){
          particles.push({x:MOUNTAIN_X+rnd(-30,60), y:rnd(180,GROUND_Y-40), vx:rnd(-60,220), vy:rnd(-220,-40),
            col:'#7a4a32', life:rnd(.4,.9), size:rnd(2,5)});
        }
        if(hp <= 0){ gameOver(); return; }
      }
    }
  }

  updateDragon(dt);
  updateFireballs(dt);

  for(const p of [...particles]){
    p.vy += GRAV*dt; p.x += p.vx*dt; p.y += p.vy*dt; p.life -= dt;
    if(p.y > GROUND_Y) { p.y = GROUND_Y; p.vy = 0; p.vx *= .8; }
    if(p.life<=0) particles.splice(particles.indexOf(p),1);
  }
  for(const wv of [...shockwaves]){
    wv.r += (wv.max - wv.r) * Math.min(1, dt*10);
    wv.life -= dt;
    if(wv.life <= 0) shockwaves.splice(shockwaves.indexOf(wv),1);
  }
  for(const bl of [...blasts]){
    bl.r += (bl.max - bl.r) * Math.min(1, dt*14); // быстро раздувается
    bl.life -= dt;
    if(bl.life <= 0) blasts.splice(blasts.indexOf(bl),1);
  }
  for(const pl of [...puddles]){
    if(pl.r < pl.max) pl.r += dt*60;
    pl.life -= dt*0.012;
    if(pl.life<=0) puddles.splice(puddles.indexOf(pl),1);
  }
  // всплывашки (урон/очки) теперь HTML-элементы — анимируются сами, см. uitext.js
  if(shake>0) shake = Math.max(0, shake - dt*40);
}

// ── отрисовка ──────────────────────────────────────────────────────
function draw(){
  cx.save();
  // трясём камеру только во время игры: иначе на экране поражения тряска
  // может «замереть» ненулевой (gameOver зовётся посреди кадра обновления)
  // SHAKE_MUL глобально приглушает тряску камеры (−30%) — применяется ко ВСЕМ источникам разом
  if(running && shake>0){ const s = shake * SHAKE_MUL; cx.translate(rnd(-s,s), rnd(-s,s)); }

  // — небо — (overscan ±20px, чтобы тряска камеры не оголяла края)
  if(art.sky){
    cx.drawImage(art.sky, -20, -20, W+40, H+40);
  } else {
    cx.fillStyle = '#dfe1f4'; cx.fillRect(-20,-20,W+40,H+40);
  }

  // — дальние горы — слой над небом, но под всем остальным (полупрозрачный верх
  //   спрайта оставляет небо видимым). Тот же overscan ±20px, что и у неба.
  if(art.mountains){
    cx.drawImage(art.mountains, -20, -20, W+40, H+40);
  }

  // — гроза от молнии: небо затягивает тёмно-синим на время разряда —
  if(skyFlash > 0){
    const a = skyFlash;
    const sg = cx.createLinearGradient(0, -20, 0, GROUND_Y);
    sg.addColorStop(0,   `rgba(8,12,32,${0.72*a})`);   // вверху почти чёрно-синее
    sg.addColorStop(0.6, `rgba(20,34,74,${0.55*a})`);
    sg.addColorStop(1,   `rgba(40,60,110,${0.28*a})`); // у горизонта светлее
    cx.fillStyle = sg;
    cx.fillRect(-20, -20, W+40, GROUND_Y+40);
  }

  // — облака — (плывут; позиции обновляет updateClouds)
  let anyCloud = false;
  for(const c of clouds){
    const img = art[c.key];
    if(img){ cx.drawImage(img, Math.round(c.x), c.y); anyCloud = true; }
    if(c.charge) drawChargedCloud(c);
  }
  if(!anyCloud){
    cx.strokeStyle = 'rgba(26,22,38,.25)'; cx.lineWidth = 2;
    drawCloud(430, 90); drawCloud(700, 140); drawCloud(260, 170);
  }
  // — воздушные завихрения (кликабельные вихри) —
  for(const s of swirls) drawSwirl(s);

  // — гора/замок — прижат к земле, левый край у x=0.
  // Размер берётся из самой картинки, поэтому рисуй её 1:1 в нужных пикселях.
  if(art.castle){
    cx.drawImage(art.castle, 0, GROUND_Y - art.castle.height + CASTLE_SINK, art.castle.width, art.castle.height);
  } else {
    drawMountain();
  }
  drawSmoke(); // дымок из труб домиков поднимается на фоне башни (огонь жаровен — позже, поверх мобов)

  // — флаг: флагшток (жёсткий) + полотно (колышется) — координаты в FLAG вверху файла
  if(art.flagstock){
    cx.drawImage(art.flagstock, FLAG.stockX, FLAG.stockBottom - art.flagstock.height);
  }
  drawBanner();

  // — земля — рисуется ПОВЕРХ замка, закрывает его базу (стык со стеной)
  if(art.ground){
    cx.drawImage(art.ground, -20, GROUND_Y, W+40, H-GROUND_Y+20);
  } else {
    cx.fillStyle = '#2e8b8b'; cx.fillRect(-20, GROUND_Y, W+40, H-GROUND_Y+20);
    cx.fillStyle = 'rgba(0,0,0,.12)'; cx.fillRect(-20, GROUND_Y, W+40, 5);
  }

  // лужи и взрывные волны — лежат на земле
  for(const pl of puddles){
    cx.globalAlpha = Math.min(1, pl.life)*0.9;
    const spr = bloodSprite(pl.size || 'medium', pl.col);
    if (spr && pl.wall){
      // след на стене: тот же спрайт повёрнут на 90° — длинная ось идёт вертикально
      // вниз по кладке (потёк). Верх закреплён на точке удара (pl.y), а растёт потёк
      // ТОЛЬКО ВНИЗ (после поворота локальная ось x смотрит вниз — рисуем от 0 до len).
      const len = pl.r * 2;                          // длина потёка вдоль стены
      // толщина потёка ограничена сверху (см. MAX_BLOOD_THICK) — длина растёт свободно
      const wide = Math.min(len * (spr.height / spr.width), MAX_BLOOD_THICK);
      cx.save();
      cx.translate(pl.x, pl.y);
      cx.rotate(Math.PI/2);
      cx.drawImage(spr, 0, -wide/2, len, wide);
      cx.restore();
    } else if (spr){
      // спрайт-лужа растекается по полу: ширина растёт с pl.r, низ на линии земли
      const w = pl.r * 2;
      // толщина (высота) ограничена сверху (см. MAX_BLOOD_THICK) — ширина растёт свободно
      const h = Math.min(w * (spr.height / spr.width), MAX_BLOOD_THICK);
      cx.drawImage(spr, pl.x - w/2, pl.y + 3 - h/2, w, h);
    } else {
      // запасной вариант, пока спрайт крови не догрузился
      cx.fillStyle = pl.col;
      cx.beginPath();
      cx.ellipse(pl.x, pl.y+3, pl.r, pl.r*0.32, 0, 0, Math.PI*2);
      cx.fill();
      cx.globalAlpha = Math.min(1, pl.life)*0.5;
      cx.beginPath();
      cx.ellipse(pl.x+pl.r*.5, pl.y+2, pl.r*.35, pl.r*.12, 0, 0, Math.PI*2);
      cx.fill();
    }
    cx.globalAlpha = 1;
  }
  for(const wv of shockwaves){
    cx.globalAlpha = Math.max(0, Math.min(1, wv.life*2.5));
    cx.strokeStyle = '#fffdf5';
    cx.lineWidth = 3;
    cx.beginPath();
    cx.ellipse(wv.x, wv.y+2, wv.r, wv.r*0.3, 0, 0, Math.PI*2);
    cx.stroke();
    cx.globalAlpha = 1;
  }
  // огненные шары взрыва: раскалённое ядро → жёлтый → оранжевый, аддитивно
  for(const bl of blasts){
    const a = Math.max(0, bl.life / bl.maxLife);
    const r = Math.max(1, bl.r);
    const g = cx.createRadialGradient(bl.x, bl.y, 0, bl.x, bl.y, r);
    g.addColorStop(0,    `rgba(255,255,238,${0.95*a})`);
    g.addColorStop(0.35, `rgba(255,205,72,${0.85*a})`);
    g.addColorStop(0.7,  `rgba(232,91,33,${0.5*a})`);
    g.addColorStop(1,    'rgba(232,91,33,0)');
    cx.globalCompositeOperation = 'lighter';
    cx.fillStyle = g;
    cx.beginPath(); cx.arc(bl.x, bl.y, r, 0, Math.PI*2); cx.fill();
    cx.globalCompositeOperation = 'source-over';
    cx.globalAlpha = 1;
  }

  // — трава — поверх земли, качается «волной ветра» вдоль линии земли
  drawGrass();

  // — лучи света из-за облаков, ложатся на замок (мобы ходят перед ними) —
  drawGodRays();

  drawDragon();

  for(const c of cyclopes){
    // тень
    cx.globalAlpha = .25; cx.fillStyle = '#000';
    cx.beginPath();
    cx.ellipse(c.x+CYC_W/2, GROUND_Y+3, CYC_W*0.45, 6, 0, 0, Math.PI*2);
    cx.fill();
    cx.globalAlpha = 1;
    const bob = c.state==='walk' ? Math.abs(Math.sin(c.t*2.5))*4 : 0;
    const lean = c.state==='pound' ? Math.sin(c.poundT*Math.PI)*-0.07 : Math.sin(c.t*2.5)*0.02;
    cx.save();
    cx.translate(c.x+CYC_W/2, c.y+CYC_H/2 - bob);
    cx.rotate(lean);
    cx.drawImage(CYC_SPRITE, -CYC_W/2, -CYC_H/2, CYC_W, CYC_H);
    // вспышка в глазу при попадании
    if(c.eyeFlash > 0){
      cx.globalAlpha = Math.min(1, c.eyeFlash*4)*0.8;
      cx.fillStyle = '#ff4040';
      cx.beginPath();
      cx.arc(CYC_EYE.x - CYC_W/2, CYC_EYE.y - CYC_H/2, CYC_EYE.r, 0, Math.PI*2);
      cx.fill();
      cx.globalAlpha = 1;
    }
    cx.restore();
    // огонь горящего циклопа — пиксельными частицами (см. updateBrzFire), рисуется позже поверх всех
    // деревянное забрало 2-го босса — закрывает глаз, пока цело
    if(c.visor > 0) drawVisor(c);
    // полоска ХП
    cx.fillStyle = 'rgba(26,22,38,.8)';
    cx.fillRect(c.x, c.y-16, CYC_W, 7);
    cx.fillStyle = '#c0392b';
    cx.fillRect(c.x+1, c.y-15, (CYC_W-2)*Math.max(0, c.hp/CFG.cyclops.hp), 5);
    // замер от ветра
    if(c.freeze > 0){
      // '*' вместо '✶': звёздочки-дингбаты в пиксельном шрифте отсутствуют,
      // и браузер рисовал бы их запасным сглаженным шрифтом — снова мыло
      cx.fillStyle='#9adfe8'; cx.font='16px '+FONT;
      cx.fillText('*', c.x+CYC_W/2-16, c.y-22);
      cx.fillText('*', c.x+CYC_W/2+10, c.y-28);
    }
  }

  for(const d of demons){
    if(d.state === 'offscreen') continue; // вне экрана — не рисуем
    const s = sizeOf(d);
    if(d.state === 'burrow'){
      // под землёй — рисуем земляной холмик, который ползёт к центру
      cx.fillStyle = '#5a4326';
      cx.beginPath();
      cx.moveTo(d.x+s/2 - s*0.6, GROUND_Y);
      cx.quadraticCurveTo(d.x+s/2, GROUND_Y - s*0.55, d.x+s/2 + s*0.6, GROUND_Y);
      cx.closePath(); cx.fill();
      cx.fillStyle = '#3a2a16';
      cx.fillRect(d.x+s/2 - s*0.6, GROUND_Y, s*1.2, 3);
      continue;
    }
    // тень
    if(d.state!=='fly' || d.y+s > GROUND_Y-120){
      const sh = Math.max(.15, 1-(GROUND_Y-(d.y+s))/180);
      cx.globalAlpha = .25*sh;
      cx.fillStyle = '#000';
      cx.beginPath();
      cx.ellipse(d.x+s/2, GROUND_Y+2, (s*0.4+4)*sh, 4*sh, 0,0,Math.PI*2);
      cx.fill();
      cx.globalAlpha = 1;
    }
    cx.save();
    cx.translate(d.x + s/2, d.y + s/2);
    cx.rotate(d.rot);
    if(d.flip) cx.scale(-1,1);
    cx.drawImage(SPRITES[d.type][d.pal], -s/2, -s/2, s, s);
    // у бомбера огонь на фитиле — частицы как у жаровни (см. updateBrzFire), здесь не рисуем
    if(d.type==='caster') drawCasterBow(s, d.flip);
    // вспышка при уроне
    if(d.flash > 0){
      cx.globalAlpha = Math.min(1, d.flash*5)*0.7;
      cx.globalCompositeOperation = 'lighter';
      cx.fillStyle = '#fff';
      cx.fillRect(-s/2, -s/2, s, s);
      cx.globalCompositeOperation = 'source-over';
      cx.globalAlpha = 1;
    }
    cx.restore();
    // огонь горящего моба — пиксельными частицами (см. updateBrzFire), рисуется позже поверх всех
    // носильщик ещё несёт валун — рисуем его над мобом, с тёмной обводкой
    if(d.type==='roller' && d.hasBoulder){
      const br = CFG.spells.boulder.r;
      drawBoulderOutlined(d.x+s/2-br*0.8, d.y-br*1.1, br*1.6, br*1.6);
    }
    // полоска ХП крупного моба — показываем, только если он уже ранен
    const mhp = TYPES[d.type].hp;
    if(mhp > 1 && d.hp < mhp && !d.invuln){
      const bw = s, bh = 4;
      cx.fillStyle = 'rgba(26,22,38,.8)';
      cx.fillRect(d.x, d.y-9, bw, bh);
      cx.fillStyle = '#c0392b';
      cx.fillRect(d.x+1, d.y-8, (bw-2)*(d.hp/mhp), bh-2);
    }
    if(d.state==='stun'){
      cx.fillStyle='#ffd76a'; cx.font='8px '+FONT;
      cx.fillText('*', d.x+s/2-14, d.y-4);
      cx.fillText('*', d.x+s/2+8, d.y-8);
    }
  }

  // пиксельный огонь — поверх монстров: жаровни, фитили бомберов, горящие мобы/циклопы
  drawBrzFire();

  // молнии — ломаный разряд с ветвлением и свечением
  for(const b of bolts) drawLightning(b);

  // валуны
  for(const bl of boulders){
    cx.globalAlpha = .25; cx.fillStyle = '#000';
    cx.beginPath();
    cx.ellipse(bl.x, GROUND_Y+2, CFG.spells.boulder.r*0.9, 4, 0, 0, Math.PI*2);
    cx.fill();
    cx.globalAlpha = 1;
    cx.save();
    cx.translate(bl.x, bl.y); cx.rotate(bl.rot);
    const br = CFG.spells.boulder.r;
    cx.drawImage(SPELL_SPRITES.boulder, -br, -br, br*2, br*2);
    cx.restore();
  }

  // снаряды дальних мобов — стрелы
  for(const sh of shots){
    const len = sh.len || 26;
    const tailX = sh.x + len;
    cx.strokeStyle = '#5a3218'; cx.lineWidth = 2; cx.lineCap = 'round';
    cx.beginPath(); cx.moveTo(tailX, sh.y); cx.lineTo(sh.x, sh.y); cx.stroke();
    cx.lineCap = 'butt';
    cx.fillStyle = '#2f3038';
    cx.beginPath();
    cx.moveTo(sh.x - 7, sh.y);
    cx.lineTo(sh.x + 2, sh.y - 4);
    cx.lineTo(sh.x + 2, sh.y + 4);
    cx.closePath();
    cx.fill();
    cx.strokeStyle = '#d8c79a'; cx.lineWidth = 1;
    cx.beginPath();
    cx.moveTo(tailX + 1, sh.y - 4); cx.lineTo(tailX - 6, sh.y);
    cx.lineTo(tailX + 1, sh.y + 4);
    cx.stroke();
  }

  // фаерболы дракона (и пойманный в руке — он остаётся в этом же массиве)
  drawFireballs();

  // струи торнадо — короткие чёрточки по касательной к спирали (закрученный вихрь)
  cx.lineCap = 'round';
  for(const ws of windStreaks){
    const x = ws.cx + Math.cos(ws.ang)*ws.rad;
    const y = ws.baseY - ws.riseV*ws.t - Math.sin(ws.ang)*ws.rad*0.35;
    const tx = -Math.sin(ws.ang), ty = Math.cos(ws.ang)*0.35; // касательная (эллипс)
    const len = 9 + ws.rad*0.08;
    cx.globalAlpha = Math.max(0, ws.life)*0.7;
    cx.strokeStyle = '#cdeef4'; cx.lineWidth = 2;
    cx.beginPath();
    cx.moveTo(x - tx*len, y - ty*len);
    cx.lineTo(x + tx*len, y + ty*len);
    cx.stroke();
    cx.globalAlpha = 1;
  }
  cx.lineCap = 'butt';

  for(const p of particles){
    cx.globalAlpha = Math.min(1,p.life*2);
    cx.fillStyle = p.col;
    cx.fillRect(p.x, p.y, p.size, p.size);
    cx.globalAlpha = 1;
  }

  // всплывашки (урон/очки) рисуются HTML-слоем поверх холста — см. uitext.js

  cx.restore();

  // — вечерний оттенок: поверх всей сцены, но ниже UI (валун в руке, обучение,
  //   диалог, курсор). Рисуется после restore — без тряски камеры, в координатах
  //   экрана, поэтому края не оголяются. Непрозрачность растёт со временем игры.
  if(art.tint){
    const a = tintAlpha();
    if(a > 0){
      cx.globalAlpha = a;
      cx.drawImage(art.tint, 0, 0, W, H);
      cx.globalAlpha = 1;
    }
  }

  // отобранный валун в руке — покачивается у курсора (поверх всего, без тряски)
  if(heldBoulder){
    const br = CFG.spells.boulder.r;
    cx.save();
    cx.translate(heldBoulder.x, heldBoulder.y);
    cx.rotate(Math.sin(last*0.01)*0.2);
    cx.drawImage(SPELL_SPRITES.boulder, -br, -br, br*2, br*2);
    cx.restore();
  }

  // обучающая сцена: затемнение + подсвеченный моб + стрелка + подсказка (поверх всего)
  if(tutorialActive()) drawTutorial(demons, last);
  // модальное сообщение: затемнение + подсветка «героя» (текст — HTML поверх)
  else if(tutorialMsgActive()){ drawTutorialMask(); drawMsgHighlight(); }

  // окно диалога: подложка + печатающийся текст + треугольник (поверх сцены, без затемнения)
  if(dialogueActive()) drawDialogue(last);

  // курсор-рука вместо системного курсора (он скрыт в CSS) — поверх всего
  if(running) drawCursor();
}

// Курсор-рука: спрайт 16×16 в позиции мыши. Системный курсор скрыт (cursor:none),
// поэтому без этой отрисовки над холстом ничего не видно. Три глобальных состояния:
//   idle    → back1  (рука раскрыта, ничего не держим и не на чём)
//   pointer → back5  (мгновенно при наведении на интерактив — готовый Рог или
//             заряженную тучу; так же мгновенно возвращается в idle при уходе)
//   grab    → схватили монстра/валун: анимация сжатия 8 → 7 → 6 → 5 → back12 (держим)
const CURSOR_PX = 16;             // размер на экране (спрайт 16px × 1)
const CURSOR_SEQ = [8, 7, 6, 5];  // кадры сжатия при захвате
const CURSOR_FRAME_DUR = 0.035;   // сек на кадр сжатия — быстро
const CURSOR_HELD = 12;           // кадр удержания
const CURSOR_POINTER = 5;         // кадр-указатель над интерактивом
let cursorState = { phase: 'idle', i: 0, t: 0 };
let cursorEl = null;
let usingTouch = false; // тач-устройство: рисованную «руку» не показываем (палец сам и есть курсор)
// как только был любой тач — переходим в тач-режим (ловим и нажатие по кнопкам меню)
window.addEventListener('touchstart', () => {
  if(usingTouch) return;
  usingTouch = true;
  if(cursorEl) cursorEl.style.display = 'none';
}, { passive: true });
let perkHover = false; // курсор над карточкой перка → показываем кадр-«указатель»
let btnHover = false;  // курсор над любой HTML-кнопкой → тоже кадр-«указатель»
// делегирование: при наведении на кнопку (в меню, оверлеях, HUD) включаем «указатель»
document.addEventListener('mouseover', e => {
  btnHover = !!(e.target.closest && e.target.closest('button'));
});

function ensureCursorEl(){
  if(cursorEl) return cursorEl;
  const wrap = document.getElementById('wrap');
  if(!wrap) return null;
  cursorEl = document.createElement('img');
  cursorEl.alt = '';
  cursorEl.style.cssText =
    'position:absolute; left:0; top:0; width:'+CURSOR_PX+'px; height:'+CURSOR_PX+'px;'+
    'image-rendering:pixelated; image-rendering:crisp-edges; pointer-events:none;'+
    'z-index:80; transform:translate(-50%,-50%); display:none;';
  wrap.appendChild(cursorEl);
  return cursorEl;
}

// курсор над кликабельным объектом? (завихрение ветра или заряженная туча)
function cursorOverInteractive(){
  for(const s of swirls){
    if(Math.hypot(mouse.x - s.x, mouse.y - s.y) <= SWIRL_R) return true;
  }
  for(const c of clouds){
    if(!c.charge) continue;
    if(mouse.x >= c.x && mouse.x <= c.x + cloudW(c) &&
       mouse.y >= c.y && mouse.y <= c.y + cloudH(c)) return true;
  }
  return false;
}

// Зовётся каждый кадр из loop(). Захват (held/heldBoulder) — главный приоритет и
// единственное состояние с анимацией; указатель и айдл переключаются мгновенно.
function updateCursor(dt){
  // во время обучения рука нейтральная, НО в туторах ветра/грозы над целью — указатель
  if(tutorialFrozen()){
    let over = false;
    if(tutorialMsgActive() && msgHi){
      if(tutorialMsgKey() === 'wind' && msgHi.swirl){
        over = Math.hypot(mouse.x - msgHi.swirl.x, mouse.y - msgHi.swirl.y) <= SWIRL_R;
      } else if(tutorialMsgKey() === 'storm' && msgHi.cloud){
        const c = msgHi.cloud;
        over = mouse.x >= c.x && mouse.x <= c.x + cloudW(c) && mouse.y >= c.y && mouse.y <= c.y + cloudH(c);
      }
    }
    cursorState.phase = over ? 'pointer' : 'idle';
    cursorState.i = 0; cursorState.t = 0;
    updateCursorElement();
    return;
  }
  const grabbing = !!(held || heldBoulder);
  if(grabbing){
    if(cursorState.phase !== 'close' && cursorState.phase !== 'held'){
      cursorState.phase = 'close'; cursorState.i = 0; cursorState.t = 0;
    }
    if(cursorState.phase === 'close'){
      cursorState.t += dt;
      while(cursorState.phase === 'close' && cursorState.t >= CURSOR_FRAME_DUR){
        cursorState.t -= CURSOR_FRAME_DUR;
        if(++cursorState.i >= CURSOR_SEQ.length) cursorState.phase = 'held';
      }
    }
    updateCursorElement();
    return;
  }
  // указатель — над тучей/вихрем ИЛИ над карточкой перка на экране выбора
  cursorState.phase = (cursorOverInteractive() || perkHover || btnHover) ? 'pointer' : 'idle';
  cursorState.i = 0; cursorState.t = 0;
  updateCursorElement();
}
function cursorFrameNum(){
  if(cursorState.phase === 'close')   return CURSOR_SEQ[Math.min(cursorState.i, CURSOR_SEQ.length-1)];
  if(cursorState.phase === 'held')    return CURSOR_HELD;
  if(cursorState.phase === 'pointer') return CURSOR_POINTER;
  return 1;
}
function drawCursor(){
  updateCursorElement();
}
function updateCursorElement(){
  if(usingTouch){ if(cursorEl) cursorEl.style.display = 'none'; return; } // на тач-устройстве руку не рисуем
  const el = ensureCursorEl();
  if(!el) return;
  const img = cursorFrames[cursorFrameNum()];
  if(!img){
    el.style.display = 'none';
    return;
  }
  if(el.src !== img.src) el.src = img.src;
  el.style.display = 'block';
  el.style.left = Math.round(mouse.x)+'px';
  el.style.top = Math.round(mouse.y)+'px';
}

// лучи света: вытянутые четырёхугольники от источника за облаками к замку,
// с градиентом (тают к земле), мягко покачиваются и «дышат» яркостью
function drawGodRays(){
  if(GODRAYS.alpha <= 0) return;
  const t = last * 0.001;
  cx.save();
  cx.globalCompositeOperation = 'lighter'; // свет складывается с картинкой
  for(const b of GODRAYS.beams){
    const sway = Math.sin(t*GODRAYS.swaySpeed + b.phase) * GODRAYS.sway;
    const a = GODRAYS.alpha * (0.75 + 0.25*Math.sin(t*GODRAYS.pulseSpeed + b.phase));
    const sx = GODRAYS.src.x, sy = GODRAYS.src.y;
    const tx = b.x + sway, ty = GROUND_Y + 4;
    const g = cx.createLinearGradient(sx, sy, tx, ty);
    g.addColorStop(0,    `rgba(${GODRAYS.color}, ${a})`);
    g.addColorStop(0.75, `rgba(${GODRAYS.color}, ${a*0.45})`);
    g.addColorStop(1,    `rgba(${GODRAYS.color}, 0)`);
    cx.fillStyle = g;
    cx.beginPath();
    cx.moveTo(sx - b.srcW, sy);
    cx.lineTo(sx + b.srcW, sy);
    cx.lineTo(tx + b.w, ty);
    cx.lineTo(tx - b.w, ty);
    cx.closePath();
    cx.fill();
  }
  cx.restore();
}


// слоты заклинаний + предмет в руке (поверх всего, без тряски камеры).
// ОТКЛЮЧЕНО: ввод заклинаний заменён небесными событиями (заряженные тучи),
// валуном у носильщика-roller и рогом Гьяллархорн. Функция и её данные
// (spellSlots/heldSpell) оставлены в коде на случай возврата панели — нигде не вызывается.
function drawSpellUI(){
  const tNow = last * 0.001;
  cx.textAlign = 'center';
  cx.font = '8px '+FONT;
  cx.fillStyle = 'rgba(26,22,38,.65)';
  // дефис вместо длинного тире: тире в Press Start 2P нет, рисовалось бы запасным шрифтом
  cx.fillText('ЗАКЛИНАНИЯ - ХВАТАЙ И БРОСАЙ', W/2, SLOT_Y - 8);
  spellSlots.forEach((s, i) => {
    const x = SLOT_X + i*(SLOT + SLOT_GAP), y = SLOT_Y;
    const ready = s.cd <= 0;
    const inHand = heldSpell && heldSpell.slot === i;
    const hov = ready && !inHand && !heldSpell && !held &&
      mouse.x > x && mouse.x < x+SLOT && mouse.y > y && mouse.y < y+SLOT;
    cx.fillStyle = hov ? 'rgba(255,253,245,.95)' : 'rgba(255,253,245,.75)';
    cx.fillRect(x, y, SLOT, SLOT);
    // пунктирная рамка — намёк «можно взять»
    cx.strokeStyle = '#1a1626'; cx.lineWidth = 2;
    cx.setLineDash([5,4]);
    cx.strokeRect(x, y, SLOT, SLOT);
    cx.setLineDash([]);
    if(ready && !inHand){
      // иконка подпрыгивает, на наведении — тянется вверх
      const bob = Math.sin(tNow*3 + i*2)*3 - (hov ? 5 : 0);
      cx.drawImage(SPELL_SPRITES[s.id], x+SLOT/2-18, y+SLOT/2-18+bob, 36, 36);
    }
    if(!ready){
      // перезарядка: тёмная шторка + секунды
      const hgt = SLOT * Math.min(1, s.cd / CFG.spells[s.id].cd);
      cx.fillStyle = 'rgba(26,22,38,.45)';
      cx.fillRect(x, y+SLOT-hgt, SLOT, hgt);
      cx.fillStyle = '#fffdf5';
      cx.font = '16px '+FONT;
      cx.fillText(Math.ceil(s.cd), x+SLOT/2, y+SLOT/2+5);
      cx.font = '8px '+FONT;
    }
    cx.fillStyle = '#1a1626';
    cx.fillText(SPELL_NAMES[s.id], x+SLOT/2, y+SLOT+11);
  });
  // заклинание в руке — покачивается у курсора
  if(heldSpell){
    cx.save();
    cx.translate(heldSpell.x, heldSpell.y);
    cx.rotate(Math.sin(tNow*10)*0.2);
    cx.drawImage(SPELL_SPRITES[heldSpell.id], -18, -18, 36, 36);
    cx.restore();
  }
  cx.textAlign = 'left';
}

// полотно флага: слегка колышется. Режем на горизонтальные ломтики и сдвигаем
// каждый по горизонтали по синусу — рябь сильнее у свободного низа, ноль у крепления к штоку.
function drawBanner(){
  const b = art.flagmatter;
  if(!b) return;
  const t = last * 0.001;
  const x = FLAG.bannerX, yTop = FLAG.bannerBottom - b.height;
  const SLICE = 3;
  for(let sy = 0; sy < b.height; sy += SLICE){
    const h = Math.min(SLICE, b.height - sy);
    const k = sy / b.height;                       // 0 у штока (верх), 1 у низа
    const off = Math.sin(t*2.4 + sy*0.07) * 4 * k; // чем ниже — тем сильнее
    cx.drawImage(b, 0, sy, b.width, h, x + off, yTop + sy, b.width, h);
  }
}

// трава: тонкая полоса вдоль земли, качается «волной ветра».
// Рисуем вертикальными ломтиками, каждый сдвинут по горизонтали
// по синусу от своего x и времени — по траве бежит рябь.
function drawGrass(){
  const g = art.grass;
  if(!g) return;
  const t = last * 0.001;
  const yTop = GROUND_Y - g.height; // низ травы — ровно на линии земли
  const SLICE = 8;
  for(let sx = 0; sx < g.width; sx += SLICE){
    const w = Math.min(SLICE, g.width - sx);
    const off = Math.sin(t*1.8 + sx*0.035) * 2.5; // сдвиг ломтика вбок
    cx.drawImage(g, sx, 0, w, g.height, sx + off, yTop, w + 1, g.height);
  }
}

// тёмная версия облака (силуэт по форме картинки), кэшируется на облаке
function darkCloudOf(c){
  const img = art[c.key];
  if(!img) return null;
  if(c._dark) return c._dark;
  const off = document.createElement('canvas');
  off.width = img.width; off.height = img.height;
  const g = off.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in'; // заливаем только непрозрачные пиксели облака
  g.fillStyle = '#172038';
  g.fillRect(0, 0, off.width, off.height);
  c._dark = off;
  return off;
}

// грозовая туча: темнеет по своей форме + по ней пробегают электрические разряды
function drawChargedCloud(c){
  const w = cloudW(c), h = cloudH(c);
  const t = last * 0.001;
  const pulse = 0.5 + 0.5*Math.sin(t*5 + c.x);
  const dark = darkCloudOf(c);
  cx.save();
  // 1) затемняем само облако (по силуэту), слегка пульсируя
  if(dark){
    cx.globalAlpha = 0.6 + 0.22*pulse;
    cx.drawImage(dark, Math.round(c.x), c.y);
  }
  // 2) электрические разряды бегут по облаку (мерцают каждый кадр)
  cx.globalCompositeOperation = 'lighter';
  cx.lineJoin = cx.lineCap = 'round';
  for(let i = 0; i < 3; i++){
    if(Math.random() < 0.45) continue;
    const ax = c.x + w*rnd(0.18, 0.5),  ay = c.y + h*rnd(0.3, 0.7);
    const bx = c.x + w*rnd(0.5, 0.86),  by = c.y + h*rnd(0.3, 0.7);
    const path = jaggedPath(ax, ay, bx, by, 7);
    cx.globalAlpha = 0.45; cx.strokeStyle = '#9cc4ff'; cx.lineWidth = 3.5; strokePath(path);
    cx.globalAlpha = 0.95; cx.strokeStyle = '#f4faff'; cx.lineWidth = 1.3; strokePath(path);
  }
  // редкая искра-вспышка внутри тучи
  if(pulse > 0.9){
    cx.globalAlpha = 0.5; cx.fillStyle = '#cfe2ff';
    cx.beginPath(); cx.arc(c.x + w*0.5, c.y + h*0.5, 10, 0, Math.PI*2); cx.fill();
  }
  cx.restore();
  cx.globalAlpha = 1;
}

function drawCloud(x,y){
  cx.beginPath();
  cx.moveTo(x,y);
  cx.bezierCurveTo(x+15,y-18, x+45,y-14, x+55,y);
  cx.bezierCurveTo(x+75,y-8, x+90,y+4, x+70,y+8);
  cx.bezierCurveTo(x+40,y+14, x+5,y+10, x,y);
  cx.stroke();
}

function drawMountain(){
  cx.fillStyle = '#7a4a32';
  cx.beginPath();
  cx.moveTo(-20, GROUND_Y+10);
  cx.lineTo(-20, 140);
  let x=-20, y=140;
  const steps=[[30,20],[20,30],[35,25],[20,40],[30,30],[15,45],[25,40],[20,50],[15,60]];
  for(const [dx,dy] of steps){ x+=dx; cx.lineTo(x,y); y+=dy; cx.lineTo(x,y); }
  cx.lineTo(x, GROUND_Y+10);
  cx.closePath();
  cx.fill();
  cx.fillStyle='rgba(0,0,0,.15)';
  cx.fillRect(-20,140, 40, GROUND_Y-130);
}


// деревянное забрало 2-го босса — доски с железными скобами поверх глаза
function drawVisor(c){
  const ex = c.x + CYC_EYE.x, ey = c.y + CYC_EYE.y;
  const pw = CYC_EYE.r * 3.0, ph = CYC_EYE.r * 3.8;
  cx.save();
  if(c.visorFlash > 0) cx.translate(rnd(-2, 2), rnd(-1, 1)); // дрожит при ударе
  cx.fillStyle = '#6e4a2a';
  cx.fillRect(ex - pw/2, ey - ph/2, pw, ph);
  cx.fillStyle = '#5a3a20'; // прожилки между досками
  for(let i = 1; i < 3; i++) cx.fillRect(ex - pw/2, ey - ph/2 + i*ph/3, pw, 2);
  cx.fillStyle = '#3a3a44'; // железные скобы по краям
  cx.fillRect(ex - pw/2, ey - ph/2, 3, ph);
  cx.fillRect(ex + pw/2 - 3, ey - ph/2, 3, ph);
  // трещины по мере разрушения
  const dmgTaken = CFG.bosses.visorHits - c.visor;
  if(dmgTaken > 0){
    cx.strokeStyle = '#2a1c10'; cx.lineWidth = 1.5;
    cx.beginPath(); cx.moveTo(ex - pw/3, ey - ph/2); cx.lineTo(ex + 2, ey + ph/4); cx.stroke();
    if(dmgTaken > 1){ cx.beginPath(); cx.moveTo(ex + pw/3, ey - ph/3); cx.lineTo(ex - 2, ey + ph/3); cx.stroke(); }
  }
  if(c.visorFlash > 0){
    cx.globalAlpha = Math.min(1, c.visorFlash*3) * 0.6;
    cx.fillStyle = '#ffcf3a';
    cx.fillRect(ex - pw/2, ey - ph/2, pw, ph);
    cx.globalAlpha = 1;
  }
  cx.restore();
}

// дракон (3-й босс) — рисуется процедурно (контуры). Стоит у правого края, мордой влево.
let _dragonRed = null; // красная перекраска спрайта дракона (для мерцания в ярости), кэш
function drawDragon(){
  for(const dr of dragons) drawOneDragon(dr);
}
function drawOneDragon(dr){
  const D = CFG.dragon;
  const bx = dr.x, by = dr.y, w = DRG_W, h = DRG_H, t = last*0.001;
  const breath = Math.sin(t*1.6) * 3;
  // тень на земле
  cx.globalAlpha = 0.25; cx.fillStyle = '#000';
  cx.beginPath(); cx.ellipse(bx + w*0.5, GROUND_Y + 4, w*0.42, 9, 0, 0, Math.PI*2); cx.fill();
  cx.globalAlpha = 1;
  // пиксельный спрайт дракона (запечён из карты DRAGON_MAP, как циклоп/титан)
  cx.drawImage(DRAGON_SPRITE, bx, by + breath, w, h);
  // в ярости — лёгкое красное мерцание ПОВЕРХ силуэта (не уход в прозрачность):
  // красная перекраска того же спрайта, наложенная с пульсирующей прозрачностью
  if(dr.enrage){
    if(!_dragonRed) _dragonRed = tint(DRAGON_SPRITE, '#e22018');
    cx.globalAlpha = 0.42 * Math.abs(Math.sin(dr.blink*9));
    cx.drawImage(_dragonRed, bx, by + breath, w, h);
    cx.globalAlpha = 1;
  }
  // раскалённая пасть — мягкое пульсирующее свечение (точка вылета фаербола, голова сверху-слева)
  cx.save(); cx.globalCompositeOperation = 'lighter';
  const glow = 0.5 + 0.4*Math.sin(t*6);
  cx.globalAlpha = 0.45 + glow*0.4; cx.fillStyle = '#ff6a1a';
  cx.beginPath(); cx.arc(bx + w*0.1, by + h*0.155 + breath, 9, 0, Math.PI*2); cx.fill();
  cx.restore();
  cx.globalAlpha = 1;
  // полоска ХП над драконом
  const bw = w*0.7, bxx = bx + w*0.15;
  cx.fillStyle = 'rgba(26,22,38,.8)'; cx.fillRect(bxx, by - 6, bw, 8);
  cx.fillStyle = dr.enrage ? '#ff3030' : '#e85b21';
  cx.fillRect(bxx + 1, by - 5, (bw - 2)*Math.max(0, dr.hp/D.hp), 6);
}

// фаерболы — светящиеся огненные сгустки (ядро + два ореола), режим 'lighter'
function drawFireballs(){
  const t = last*0.001;
  cx.save();
  cx.globalCompositeOperation = 'lighter';
  for(const fb of fireballs){
    const r = fb.r;
    cx.globalAlpha = 0.5; cx.fillStyle = '#e85b21';
    cx.beginPath(); cx.arc(fb.x, fb.y, r*(1.1 + 0.15*Math.sin(t*12 + fb.x)), 0, Math.PI*2); cx.fill();
    cx.globalAlpha = 0.8; cx.fillStyle = '#ffcf3a';
    cx.beginPath(); cx.arc(fb.x, fb.y, r*0.85, 0, Math.PI*2); cx.fill();
    cx.globalAlpha = 1; cx.fillStyle = '#fff2a8';
    cx.beginPath(); cx.arc(fb.x, fb.y, r*0.5, 0, Math.PI*2); cx.fill();
  }
  cx.globalAlpha = 1;
  cx.restore();
}

// Лук кастера — пиксельный (квадратиками), как остальные мобы. Рисуется в локальных
// координатах с центром (0,0); вызывается уже внутри translate/rotate/flip.
// Дуга — ряд пиксельных квадратиков, выгнутых наружу (от тела); тетива — прямой
// ряд тонких квадратиков по внутренней стороне между концами дуги.
function drawCasterBow(s, flipped){
  const dir = flipped ? 1 : -1;
  const p = Math.max(2, Math.round(s*0.09));   // размер «пикселя» лука
  const cxp = dir*s*0.34, cyp = -s*0.08;        // центр лука сбоку от тела
  const half = s*0.3;                            // половина высоты дуги
  const n = Math.max(6, Math.round(half*2 / (p*0.8))); // частые сегменты — без разрывов
  // дуга — тёмное дерево, середина выгнута наружу (в сторону dir)
  cx.fillStyle = '#5a3218';
  for(let i=0;i<=n;i++){
    const tt = i/n;                              // 0..1 сверху вниз
    const yy = cyp - half + tt*half*2;
    const bow = Math.sin(tt*Math.PI)*s*0.16;     // выгиб наружу в середине
    const xx = cxp + dir*bow;
    cx.fillRect(Math.round(xx - p/2), Math.round(yy - p/2), p, p);
  }
  // тетива — тонкий прямой ряд между концами дуги (по внутренней стороне)
  const sp = Math.max(1, Math.round(p*0.5));
  cx.fillStyle = '#e0d0a2';
  for(let i=0;i<=n;i++){
    const yy = cyp - half + (i/n)*half*2;
    cx.fillRect(Math.round(cxp - sp/2), Math.round(yy - sp/2), sp, sp);
  }
}

// Валун с тёмной обводкой (для того, что несёт roller — чтобы был контрастнее).
// Обводка: тёмный силуэт того же спрайта (цвет панели победы #2e2316), смещённый
// на o пикселей в 8 сторон, поверх — сам валун. Силуэт кэшируется.
let _boulderOutline = null;
function drawBoulderOutlined(x, y, w, h){
  const spr = SPELL_SPRITES.boulder;
  if(!_boulderOutline) _boulderOutline = tint(spr, '#2e2316');
  const o = Math.max(1, Math.round(w * 0.09));   // толщина обводки ~9% ширины
  for(const [ox, oy] of [[-o,0],[o,0],[0,-o],[0,o],[-o,-o],[o,-o],[-o,o],[o,o]]){
    cx.drawImage(_boulderOutline, x+ox, y+oy, w, h);
  }
  cx.drawImage(spr, x, y, w, h);
}

// ── HUD / overlay ──────────────────────────────────────────────────
const scoreEl = document.getElementById('score');
const debugTimerEl = document.getElementById('debugTimer'); // ВРЕМЕННЫЙ дебаг-таймер боя
const hpFill = document.getElementById('hpfill');
const lvlEl = document.getElementById('lvl');
const xpFill = document.getElementById('xpfill');
const lvlOverlay = document.getElementById('lvlOverlay');
const skillCards = document.getElementById('skillCards');
const lvlHud = document.getElementById('lvlHud');
if(!CFG.leveling.enabled) lvlHud.style.display = 'none'; // прокачка выключена — полоса опыта скрыта
const overlay = document.getElementById('overlay');
const ovTitle = document.getElementById('ov-title');
const ovText = document.getElementById('ov-text');
const ovScore = document.getElementById('ov-score');
const startBtn = document.getElementById('startBtn');
const startScreen = document.getElementById('startScreen'); // письмо от матери — только при первом запуске
const debugPanel = buildDebugPanel();
const debugAudioLog = buildDebugAudioLog();
const debugAudioRows = [];
setSfxDebugSink(logMobSfx);
// кнопки финала: стандартный набор рестарта vs набор победы (оставить имя / бесконечный)
const ovButtons = document.getElementById('ov-buttons');
const ovWinButtons = document.getElementById('ov-win-buttons');
const leaveNameBtn = document.getElementById('leaveNameBtn');
const endlessBtn = document.getElementById('endlessBtn');
const toMenuBtn = document.getElementById('toMenuBtn');
// «Оставить имя» — на экране гибели в бесконечном — ведёт во ввод имени в зал славы.
// Очки берём из текущего score (число раздавленных мобов).
leaveNameBtn.addEventListener('click', () => {
  sfx.tap();
  overlay.classList.add('hidden');
  ovWinButtons.classList.add('hidden');
  openLeaderboardEntry(score);
});
endlessBtn.addEventListener('click', startEndless);
// «Выйти в меню» — на экране победы: вернуться на стартовый экран
toMenuBtn.addEventListener('click', () => { sfx.tap(); toMainScreen(); });

function buildDebugPanel(){
  const wrap = document.getElementById('wrap');
  const panel = document.createElement('div');
  panel.id = 'debugSpawnPanel';
  panel.className = 'hidden';
  const title = document.createElement('div');
  title.className = 'debug-title';
  title.textContent = 'DEBUG';
  panel.appendChild(title);
  const unitNames = {
    small:'small', dog:'dog', big:'big', bat:'bat', wisp:'wisp',
    bomber:'bomber', caster:'caster', huge:'huge', mole:'mole', roller:'roller',
  };
  for(const type of Object.keys(TYPES)){
    if(type === 'titan') continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = unitNames[type] || type;
    btn.addEventListener('click', () => debugSpawnUnit(type));
    panel.appendChild(btn);
  }
  const bossTitle = document.createElement('div');
  bossTitle.className = 'debug-title';
  bossTitle.textContent = 'BOSS';
  panel.appendChild(bossTitle);
  const bosses = [
    ['циклоп', 'cyclops'],
    ['забрало', 'visor'],
    ['дракон', 'dragon'],
  ];
  for(const [label, kind] of bosses){
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', () => debugSpawnBoss(kind));
    panel.appendChild(btn);
  }
  const windBtn = document.createElement('button');
  windBtn.type = 'button';
  windBtn.textContent = 'ветер';
  windBtn.addEventListener('click', () => debugCastWind());
  panel.appendChild(windBtn);
  const lightningBtn = document.createElement('button');
  lightningBtn.type = 'button';
  lightningBtn.textContent = 'молния';
  lightningBtn.addEventListener('click', () => debugCastLightning());
  panel.appendChild(lightningBtn);
  wrap.appendChild(panel);
  return panel;
}

function buildDebugAudioLog(){
  const wrap = document.getElementById('wrap');
  const panel = document.createElement('div');
  panel.id = 'debugAudioLog';
  panel.className = 'hidden';
  const title = document.createElement('div');
  title.className = 'debug-title';
  title.textContent = 'MOB SFX';
  panel.appendChild(title);
  wrap.appendChild(panel);
  return panel;
}

function logMobSfx(ev){
  if(!debugLocation || !debugAudioLog) return;
  const row = document.createElement('div');
  row.className = 'debug-audio-row';
  row.textContent = ev.kind + ': ' + ev.name + (ev.extra ? ' | ' + ev.extra : '');
  debugAudioLog.insertBefore(row, debugAudioLog.children[1] || null);
  debugAudioRows.unshift(row);
  while(debugAudioRows.length > 10){
    const old = debugAudioRows.pop();
    if(old && old.parentNode) old.parentNode.removeChild(old);
  }
}

function clearDebugAudioLog(){
  while(debugAudioRows.length){
    const row = debugAudioRows.pop();
    if(row && row.parentNode) row.parentNode.removeChild(row);
  }
}

function setDebugPanelVisible(on){
  if(debugPanel) debugPanel.classList.toggle('hidden', !on);
  if(debugAudioLog) debugAudioLog.classList.toggle('hidden', !on);
  if(!on) clearDebugAudioLog();
}

// кнопка звука (слева внизу)
// ── настройки (шестерёнка): пауза + мут музыки/звуков отдельно + мастер-громкость ──
const settingsBtn   = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const settingsClose = document.getElementById('settingsClose');
const masterVolEl = document.getElementById('masterVol'), masterVal = document.getElementById('masterVal');
const musicVolEl  = document.getElementById('musicVol'),  musicVal  = document.getElementById('musicVal');
const sfxVolEl    = document.getElementById('sfxVol'),    sfxVal    = document.getElementById('sfxVal');

// сохранённые громкости (0..1): общая, музыка, звуки
const loadVol = (key, def) => {
  try { const v = localStorage.getItem(key); return v !== null ? Math.max(0, Math.min(1, parseFloat(v) || 0)) : def; }
  catch(e){ return def; }
};
let masterVolume = loadVol('godilla.masterVol', 1);
let musicVolume  = loadVol('godilla.musicVol', 1);
let sfxVolume    = loadVol('godilla.sfxVol', 1);

function refreshSettingsUI(){
  masterVolEl.value = Math.round(masterVolume*100); masterVal.textContent = Math.round(masterVolume*100)+'%';
  musicVolEl.value  = Math.round(musicVolume*100);  musicVal.textContent  = Math.round(musicVolume*100)+'%';
  sfxVolEl.value    = Math.round(sfxVolume*100);    sfxVal.textContent    = Math.round(sfxVolume*100)+'%';
}
// общая громкость множится на громкость каждой дорожки; мьют теперь — ползунок в 0
function applyAudioSettings(){
  music.setVolume(masterVolume * musicVolume);
  setMasterVolume(masterVolume * sfxVolume);
  music.setMuted(false); setSfxMuted(false);
}
applyAudioSettings();
refreshSettingsUI();

let settingsOpen = false;
let paused = false; // пауза по кнопке у таймера — замораживает бой (см. gameplayActive)
function openSettings(){
  if(settingsOpen) return;
  settingsOpen = true; shake = 0;
  refreshSettingsUI();
  settingsPanel.classList.remove('hidden');
}
function closeSettings(){
  settingsOpen = false;
  settingsPanel.classList.add('hidden');
  mouse.px = mouse.x; mouse.py = mouse.y; mouse.vx = mouse.vy = 0; // без фантомного рывка после паузы
}
settingsBtn.addEventListener('click', () => { sfx.tap(); openSettings(); settingsBtn.blur(); });
// кнопка паузы (рядом с дебаг-таймером): замораживает бой через флаг paused
const pauseBtn = document.getElementById('pauseBtn');
function togglePause(){
  paused = !paused;
  pauseBtn.textContent = paused ? '▶' : '⏸';
  pauseBtn.title = paused ? 'Продолжить' : 'Пауза';
  if(!paused){ mouse.px = mouse.x; mouse.py = mouse.y; mouse.vx = mouse.vy = 0; } // без рывка после паузы
  pauseBtn.blur();
}
pauseBtn.addEventListener('click', () => { sfx.tap(); togglePause(); });
settingsClose.addEventListener('click', () => { sfx.tap(); closeSettings(); });
masterVolEl.addEventListener('input', () => {
  masterVolume = Math.max(0, Math.min(1, masterVolEl.value / 100));
  try { localStorage.setItem('godilla.masterVol', String(masterVolume)); } catch(e){}
  applyAudioSettings(); masterVal.textContent = Math.round(masterVolume*100)+'%';
});
musicVolEl.addEventListener('input', () => {
  musicVolume = Math.max(0, Math.min(1, musicVolEl.value / 100));
  try { localStorage.setItem('godilla.musicVol', String(musicVolume)); } catch(e){}
  applyAudioSettings(); musicVal.textContent = Math.round(musicVolume*100)+'%';
});
sfxVolEl.addEventListener('input', () => {
  sfxVolume = Math.max(0, Math.min(1, sfxVolEl.value / 100));
  try { localStorage.setItem('godilla.sfxVol', String(sfxVolume)); } catch(e){}
  applyAudioSettings(); sfxVal.textContent = Math.round(sfxVolume*100)+'%';
  sfx.tap(); // подтверждение громкости звуков
});

// ── зал славы (лидерборд) ──────────────────────────────────────────
// Общий сетевой лидерборд на Supabase. Принцип «выстрелил и забыл»: результат
// отправляется без всяких проверок — дошёл/не дошёл неважно, у кого не отправился,
// тому просто не повезло. Чтение топ-10 при любой осечке тихо падает на локальную
// копию в этом браузере (та же копия — режим работы, пока ключи не вписаны).
//
// ┌─ НАСТРОЙКА: вставь сюда два значения из Supabase → Settings → API ──────────┐
// │  SUPA_URL — Project URL,  вид: https://xxxxxxxx.supabase.co                  │
// │  SUPA_KEY — anon public key (длинная строка, начинается с eyJ...)            │
// └─────────────────────────────────────────────────────────────────────────────┘
const SUPA_URL = 'https://qdamypwjtswwacqtkhlu.supabase.co';   // ← адрес проекта Supabase
const SUPA_KEY = 'sb_publishable_AuRa5zSVFhNKp9R5jRSPLA_ZNGxjvG-';   // ← публичный (anon) ключ
const SUPA_TABLE = 'leaderboard';
const SUPA_ON = !!(SUPA_URL && SUPA_KEY);

const LB_KEY = 'godilla.leaderboard'; // ключ локальной копии (запасной путь без сети)
const LB_MAX = 10;                    // сколько имён показываем
const leaderboardPanel = document.getElementById('leaderboardPanel');
const lbList    = document.getElementById('lb-list');
const lbEntry   = document.getElementById('lb-entry');
const lbName    = document.getElementById('lb-name');
const lbSave    = document.getElementById('lb-save');
const lbClose   = document.getElementById('lb-close');
const lbEmpty   = document.getElementById('lb-empty');
const trophyBtn = document.getElementById('trophyBtn');
let lbReturnToMenu = false;           // закрытие зала ведёт на главный экран (после партии)
let lbPendingKills = 0;               // результат, ожидающий ввода имени

// — локальная копия (запасной путь, когда сети нет или ключи не вписаны) —
function lbLoadLocal(){
  try {
    const arr = JSON.parse(localStorage.getItem(LB_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter(e => e && typeof e.name === 'string' && typeof e.kills === 'number') : [];
  } catch(e){ return []; }
}
function lbSaveLocal(name, kills){
  const arr = lbLoadLocal();
  arr.push({ name, kills, ts: Date.now() });
  arr.sort((a, b) => b.kills - a.kills || a.ts - b.ts);
  try { localStorage.setItem(LB_KEY, JSON.stringify(arr.slice(0, LB_MAX))); } catch(e){}
}

// — сеть (Supabase REST) —
// отправка результата: выстрелил и забыл, любые ошибки молча глотаем
function lbPostRemote(name, kills){
  if(!SUPA_ON) return;
  try {
    fetch(SUPA_URL + '/rest/v1/' + SUPA_TABLE, {
      method: 'POST',
      headers: {
        'apikey': SUPA_KEY,
        'Authorization': 'Bearer ' + SUPA_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ name, kills }),
    }).catch(() => {});
  } catch(e){}
}
// чтение топ-10; при любой осечке — локальная копия
async function lbFetchTop(){
  if(!SUPA_ON) return lbLoadLocal();
  try {
    const r = await fetch(SUPA_URL + '/rest/v1/' + SUPA_TABLE +
      '?select=name,kills&order=kills.desc&limit=' + LB_MAX, {
      headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY },
    });
    if(!r.ok) return lbLoadLocal();
    const arr = await r.json();
    return Array.isArray(arr) ? arr : lbLoadLocal();
  } catch(e){ return lbLoadLocal(); }
}

// — отрисовка —
function lbRenderList(arr, highlightKey){
  lbList.innerHTML = '';
  lbEmpty.classList.toggle('hidden', arr.length > 0);
  arr.slice(0, LB_MAX).forEach((e, i) => {
    const li = document.createElement('li');
    if(highlightKey && (e.name + '|' + e.kills) === highlightKey) li.classList.add('lb-me');
    if(i < 3) li.classList.add('lb-top');
    const rank = document.createElement('span'); rank.className = 'lb-rank'; rank.textContent = (i + 1) + '.';
    const nm = document.createElement('span'); nm.className = 'lb-nm'; nm.textContent = e.name || '???';
    const kl = document.createElement('span'); kl.className = 'lb-kills'; kl.textContent = e.kills;
    li.append(rank, nm, kl);
    lbList.appendChild(li);
  });
}
function lbShowLoading(){
  lbEmpty.classList.add('hidden');
  lbList.innerHTML = '';
  const li = document.createElement('li');
  li.style.justifyContent = 'center';
  li.textContent = 'Загрузка…';
  lbList.appendChild(li);
}
// подмешать свою строку, если сервер ещё не успел её вернуть — чтобы игрок увидел себя
function lbMergeMine(arr, name, kills){
  const key = name + '|' + kills;
  if(arr.some(e => (e.name + '|' + e.kills) === key)) return arr;
  const merged = arr.concat([{ name, kills }]);
  merged.sort((a, b) => b.kills - a.kills);
  return merged.slice(0, LB_MAX);
}

// открыть зал в режиме просмотра (из меню, по кубку)
async function openLeaderboardView(){
  lbReturnToMenu = false;
  lbEntry.classList.add('hidden');
  lbClose.textContent = 'Закрыть';
  lbShowLoading();
  leaderboardPanel.classList.remove('hidden');
  lbRenderList(await lbFetchTop());
}
// открыть зал с вводом имени (после победы / гибели в бесконечном режиме)
async function openLeaderboardEntry(kills){
  lbPendingKills = kills;
  lbReturnToMenu = true;
  lbEntry.classList.remove('hidden');
  lbClose.textContent = 'В главное меню';
  lbName.value = '';
  lbShowLoading();
  leaderboardPanel.classList.remove('hidden');
  setTimeout(() => { try { lbName.focus(); } catch(e){} }, 60);
  lbRenderList(await lbFetchTop()); // показать текущий топ под полем ввода
}
async function submitLeaderboardName(){
  if(lbEntry.classList.contains('hidden')) return; // имя уже вписано
  const name = ((lbName.value || '').trim() || 'Безымянный герой').slice(0, 16);
  const kills = lbPendingKills;
  lbSaveLocal(name, kills);    // локальная копия
  lbPostRemote(name, kills);   // на сервер: выстрелил и забыл
  lbEntry.classList.add('hidden');
  lbShowLoading();
  const top = lbMergeMine(await lbFetchTop(), name, kills);
  lbRenderList(top, name + '|' + kills);
}
function closeLeaderboard(){
  leaderboardPanel.classList.add('hidden');
  if(lbReturnToMenu){ lbReturnToMenu = false; toMainScreen(); }
}
trophyBtn.addEventListener('click', () => { sfx.tap(); openLeaderboardView(); trophyBtn.blur(); });
lbSave.addEventListener('click', () => { sfx.tap(); submitLeaderboardName(); });
lbName.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); submitLeaderboardName(); } });
lbClose.addEventListener('click', () => { sfx.tap(); closeLeaderboard(); });

// Старт партии. Флаги (любой можно выключить независимо):
//   skipTutorial — обучение выключено на всю партию (тумблер конфига игнорируется)
//   skipDialogue — вступительный диалог ворона не запускается
//   debug — пустая локация с ручными кнопками спавна
function start({ skipTutorial = false, skipDialogue = false, debug = false } = {}){
  debugLocation = !!debug;
  stopAllDemonScreams();
  demons=[]; puddles=[]; particles=[]; cyclopes=[]; shockwaves=[]; blasts=[];
  bolts=[]; boulders=[]; windStreaks=[]; shots=[]; tornadoes=[]; heldBoulder=null; skyFlash=0;
  // боссы, дракон и финал
  fireballs=[]; pendingFB=[]; heldFireball=null; dragons=[]; braziersLit=false;
  boss1Spawned=false; boss2Spawned=false; boss2Dead=false;
  dragonSpawned=false; dragonTimer=0; dragonRoared=false; won=false;
  finale=null; finaleT=0; gateInvuln=false;
  ovWinButtons.classList.add('hidden'); ovButtons.classList.remove('hidden');
  swirls=[]; nextSwirl = rnd(CFG.tornado.swirlMin, CFG.tornado.swirlMax);
  for(const c of clouds){ c.charge = null; }
  nextCharge = rnd(CFG.sky.chargeMin, CFG.sky.chargeMax);
  score=0; hp=100; held=null;
  paused=false; pauseBtn.textContent='⏸'; pauseBtn.title='Пауза'; // снять паузу при старте
  gameTime=0; spawnTimer=0.5; cyclopsTimer=CFG.stream.cyclopsFirst; threat=1;
  hugeSeen=false;
  seenTypes = new Set(); lastDebutAt = -999; lastPickedDebut = false; firstSpawnPending = true;
  introPackDone = false; introSwirlDone = false; introHugeDone = false; introCloudDone = false;
  rollerDebutT = 0;
  player = { level: 0, xp: 0, xpNeed: CFG.leveling.baseXP, skills: {} };
  pendingLevels = 0; choosing = false; currentOfferIds = [];
  perkPool = [...CFG.leveling.perks].sort(() => Math.random() - .5); // тасуем перки на забег
  // прокачка спит: в основной игре перков нет (включается только в бесконечном режиме).
  // CFG.leveling.enabled оставлен мастер-тумблером для отладки.
  perksLive = !!CFG.leveling.enabled;
  lvlHud.style.display = perksLive ? '' : 'none';
  killSinceRepair = 0; usedSecondWind = false;
  afterFirstPending = false; tutDemon = null; afterFirstTimer = 0; // второй диалог ворона ещё не показан
  stats = newStats();
  resetTutorial(skipTutorial ? false : CFG.tutorial.enabled);
  msgHi = null; cycTutT = 0;
  scoreEl.textContent='0'; hpFill.style.width='100%';
  updateXPBar();
  setDebugPanelVisible(debugLocation);
  overlay.classList.add('hidden');
  startScreen.classList.add('hidden'); // письмо больше не показываем — после старта только overlay-геймовер
  lvlOverlay.classList.add('hidden');
  trophyBtn.classList.add('hidden');   // кубок зала славы — только в меню, в бою прячем
  running = true;
  // музыка: с самого старта играет вступительный трек (см. music.js). Переключится
  // на боевой при появлении первого «huge». Старт здесь — внутри клика по кнопке
  // «Играть»/«Ещё раз», т.е. жест пользователя есть и автоплей разрешён.
  music.startGame();
  // вступительный диалог: пока он идёт, мир заморожен (см. цикл). Кончится —
  // выйдет первый моб и подхватит обучение. Тумблер — DIALOGUE_CFG.enabled.
  if(!debugLocation && !skipDialogue) startDialogue('intro');
}
// сводка партии → game/sessions.jsonl (dev-эндпоинт из vite.config.js). В сборке тихо падает.
function logSession(){
  try {
    fetch('/__session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ts: new Date().toISOString(),
        durationSec: Math.round(gameTime),
        threat, score, level: player.level,
        skills: player.skills,
        kills: stats.kills, killsTotal: stats.killsTotal,
        lightning: stats.lightning, tornado: stats.tornado,
        gateShots: stats.gateShots, cityBreaches: stats.cityBreaches,
      }),
    }).catch(() => {});
  } catch(e){}
}

function gameOver(){
  // «Второе дыхание»: один раз за партию врата не падают, а восстанавливаются
  if(sk('secondWind') > 0 && !usedSecondWind){
    usedSecondWind = true;
    hp = CFG.skills.secondWind.to; hpFill.style.width = hp + '%';
    floatText(MOUNTAIN_X, 200, 'ВТОРОЕ ДЫХАНИЕ!', '#2f6e3c', 1.6);
    shake = Math.max(shake, 14);
    return;
  }
  // в бесконечном режиме врата рано или поздно неминуемо падают — там свой экран
  // с единственной кнопкой «оставить имя» (Асгард уже спасён, это просто финал партии)
  if(finale === 'endless'){
    stopForOverlay();
    ovTitle.textContent = 'ВЫ СОВЕРШИЛИ ПОДВИГ!';
    ovText.innerHTML = 'Ваше имя будут помнить через легенды.<br>' +
      'Асгард ты уже спас — а эта нескончаемая орда лишь множит твою славу.';
    ovScore.textContent = 'Раздавлено: ' + score;
    ovScore.classList.remove('hidden');
    ovButtons.classList.add('hidden');
    endlessBtn.classList.add('hidden');     // только «оставить имя»
    toMenuBtn.classList.add('hidden');
    leaveNameBtn.classList.remove('hidden');
    ovWinButtons.classList.remove('hidden');
    overlay.classList.remove('hidden');
    return;
  }
  logSession();
  stopAllDemonScreams();
  debugLocation = false;
  setDebugPanelVisible(false);
  running = false; held = null; heldBoulder = null; heldFireball = null;
  choosing = false; pendingLevels = 0;
  shake = 0; // игра остановилась — гасим тряску, иначе экран дёргается на экране поражения
  music.menu(); // экран конца игры — это меню: игровая музыка гаснет, меню-трек возвращается
  lvlOverlay.classList.add('hidden');
  hideLabel('horn'); // рог больше не рисуется — убираем его HTML-подпись
  cv.classList.remove('grabbing');
  // на случай возврата после экрана победы — вернуть стандартный набор кнопок
  ovWinButtons.classList.add('hidden');
  ovButtons.classList.remove('hidden');
  ovTitle.textContent = 'Врата пали…';
  ovText.innerHTML = 'Демоны ворвались в Асгард прямо посреди пира.<br>' +
    'Один разочарованно отставил кубок: к его столу ты пока не готов.<br>' +
    'Но сколько луж ты после себя оставил!';
  ovScore.textContent = 'Раздавлено: ' + score;
  ovScore.classList.remove('hidden');
  overlay.classList.remove('hidden');
}
// Переход меню→игра через чёрную шторку: медленный наплыв черноты на меню
// (фейд-ин, 0.6с) и более быстрый уход в игровой мир (фейд-аут, 0.35с).
const fade = document.getElementById('fade');
let fading = false;
function startWithFade(opts){
  if(fading) return;                          // защита от повторного клика во время перехода
  fading = true;
  music.leaveMenu();                          // меню-трек начинает гаснуть сразу по клику
  fade.style.pointerEvents = 'auto';          // глушим клики, пока идёт переход
  fade.style.transition = 'opacity .6s ease-in';
  fade.style.opacity = '1';                   // меню плавно затемняется
  setTimeout(() => {
    start(opts);                              // мир запускается под чернотой, меню уже скрыто
    fade.style.transition = 'opacity .35s ease-out';
    fade.style.opacity = '0';                 // игровой мир проявляется быстрее
    setTimeout(() => { fade.style.pointerEvents = 'none'; fading = false; }, 350);
  }, 600);
}

function loadDebugLocation(){
  if(fading) return;
  fading = false;
  fade.style.opacity = '0';
  fade.style.pointerEvents = 'none';
  settingsOpen = false;
  settingsPanel.classList.add('hidden');
  music.leaveMenu();
  start({ skipTutorial: true, skipDialogue: true, debug: true });
  floatText(MOUNTAIN_X + 90, 92, 'DEBUG ЛОКАЦИЯ', '#7a1f1f', 1.2);
}

window.addEventListener('keydown', (e) => {
  if(e.code !== 'Backquote') return;
  debugTildeHits++;
  if(debugTildeTimer) clearTimeout(debugTildeTimer);
  debugTildeTimer = setTimeout(() => { debugTildeHits = 0; debugTildeTimer = null; }, 1200);
  if(debugTildeHits >= 4){
    debugTildeHits = 0;
    if(debugTildeTimer){ clearTimeout(debugTildeTimer); debugTildeTimer = null; }
    loadDebugLocation();
  }
});

// звук тапа на ЛЮБОЕ нажатие кнопки UI — один делегированный обработчик (ловит и
// динамические кнопки: карточки скиллов). Поэтому в обработчиках кнопок ниже tap
// отдельно не зовём — иначе сыграет дважды.
document.addEventListener('click', (e) => {
  if(e.target.closest('button')) sfx.tap();
});
// экран проигрыша: единственная кнопка — полный рестарт
startBtn.addEventListener('click', () => startWithFade({}));
// кнопки на письме (стартовый экран): обычный старт и «без диалогов и тутора»
// (вторая видна только после первого захода в бесконечный режим — см. revealEndlessShortcut)
document.getElementById('startWallBtn').addEventListener('click', () => startWithFade({}));
document.getElementById('startWallDebugBtn').addEventListener('click', () => startWithFade({ skipTutorial: true, skipDialogue: true }));
// старт «без диалогов и тутора» в меню открыт только тем, кто хоть раз дошёл до бесконечного режима
function revealEndlessShortcut(){
  let reached = false;
  try { reached = localStorage.getItem('godilla.endlessReached') === '1'; } catch(e){}
  document.getElementById('startWallDebugBtn').classList.toggle('hidden', !reached);
}
revealEndlessShortcut();

initDust();             // насыпать пылинки до первого кадра
music.menu();           // в главном меню зациклено и приглушённо играет меню-трек
requestAnimationFrame(loop);
