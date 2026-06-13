import {
  // SPD_MED/SPD_HARD не импортируем: наша боёвка (combat rework) даёт ровный урон,
  // пороги по скорости из dev не используются. SPELL_NAMES нужен законсервированной панели.
  CFG, GRAV, TYPES, SPD_LIGHT,
  CYC_PAL, CYC_PX, CYC_W, CYC_H, CYC_EYE, SPELL_NAMES,
} from './config.js';
import { SPRITES, CYC_SPRITE, SPELL_SPRITES, tint } from './sprites.js';
import { sfx, toggleMute } from './audio.js';
import { art, cursorFrames } from './assets.js';
import {
  initTutorial, resetTutorial, tutorialActive, tutorialDemon,
  tutorialOnFirstDemon, tutorialComplete, drawTutorial,
  tutorialFrozen, tutorialMsgActive, tutorialCityBreach,
  dismissTutorialMessage, drawTutorialMask,
} from './tutorial.js';
import { initUIText, floatText, label, hideLabel } from './uitext.js';
import {
  initDialogue, startDialogue, dialogueActive, dialogueClick, updateDialogue, drawDialogue,
} from './dialogue-ui.js';

const cv = document.getElementById('game');
const cx = cv.getContext('2d');
cx.imageSmoothingEnabled = false;

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
const BRAZIER = FIRE.brazier;

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
  { key:'cloud1', x: 240, y: 64,  spd: -27, charge:null },
  { key:'cloud2', x: 560, y: 120, spd: -18, charge:null },
  { key:'cloud3', x: 830, y: 52,  spd: -36, charge:null },
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
  // время от времени заряжаем спокойное облако (только в бою; нужно место до башни)
  if(running && !choosing){
    nextCharge -= dt;
    if(nextCharge <= 0){
      const idle = clouds.filter(c => !c.charge && c.x + cloudW(c)/2 > WALL.x + 140);
      if(idle.length){
        const c = idle[(Math.random()*idle.length)|0];
        c.charge = 'storm';
        floatText(c.x + cloudW(c)/2, c.y + cloudH(c)/2, 'ГРОЗА — КЛИКНИ!', '#2a3a7a', 1.8);
      }
      nextCharge = rnd(CFG.sky.chargeMin, CFG.sky.chargeMax);
    }
  }
}

// клик по грозовой туче: бьёт молнией строго вниз
function triggerCloud(c){
  const cxp = c.x + cloudW(c)/2, cyp = c.y + cloudH(c)*0.6;
  castLightning(cxp, cyp, 0, 1);
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
// Цвет крови по типу моба (по умолчанию — из CFG.blood).
function bloodCol(type){ return CFG.blood.byType[type] || CFG.blood.defaultCol; }
// Какой спрайт лужи: мелкие мобы (px<=2.5) — mini, остальные — medium.
function bloodSize(type){ return (TYPES[type]?.px ?? 4) <= 2.5 ? 'mini' : 'medium'; }
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
let bolts = [], boulders = [], windStreaks = [], shots = [];
let heldBoulder = null; // отобранный у носильщика валун в руке: {x, y}
// данные законсервированной панели заклинаний (см. drawSpellUI — сейчас не вызывается)
let spellSlots = [{id:'lightning', cd:0}, {id:'boulder', cd:0}, {id:'wind', cd:0}];
let heldSpell = null;   // заклинание в руке: {id, slot, x, y}
// воздушные завихрения в небе: кликни — встаёт торнадо. {x, y, spd}
let swirls = [];
let nextSwirl = rnd(CFG.tornado.swirlMin, CFG.tornado.swirlMax);
const SWIRL_R = 30;     // радиус клика/иконки завихрения
let score = 0, hp = 100;
let gameTime = 0, spawnTimer = 0, cyclopsTimer = 0, threat = 1;
let player = { level: 1, xp: 0, xpNeed: CFG.leveling.baseXP, skills: {} };
let pendingLevels = 0, choosing = false;
let running = false, held = null;
const sk = id => player.skills[id] || 0; // уровень скилла игрока
let mouse = {x:0,y:0,px:0,py:0,vx:0,vy:0};
let shake = 0;
let skyFlash = 0; // зарево на небо в момент удара молнии (1 → 0)

function rnd(a,b){ return a + Math.random()*(b-a); }

function spawnDemon(type){
  const T = TYPES[type];
  const d = {
    type,
    hp: T.hp,
    x: W - 60 + rnd(-10,10),
    y: 0,
    vx: 0, vy: 0,
    speed: rnd(T.speedMin, T.speedMax) + gameTime * CFG.stream.speedPerSec,
    pal: (Math.random()*SPRITES[type].length)|0,
    t: rnd(0,10),
    state: 'walk',           // walk | held | fly | stun | offscreen
    returnT: 0,              // таймер возврата, пока state==='offscreen'
    rot: 0, rotV: 0,
    stun: 0,
    flash: 0,                // вспышка при уроне
    grounded: true,          // для драг-ударов об землю
    armed: false,            // «заряжен» броском: наносит урон, пока не коснулся земли
    noEyeDmg: false,         // торнадо заряжает падение, но не должно бить циклопа в глаз
    hitsLeft: 0,             // сколько мобов ещё может сшибить за этот бросок (скилл «Таран»)
    cycHit: 0,               // таймер: недавно отскочил от циклопа (защита от болтанки между двумя)
    swing: 0,                // пик скорости замаха в руке (затухает) — по нему считается удар об землю/стену
    swingVX: 0, swingVY: 0,  // вектор скорости в момент пика — для броска, если курсор уже притормозил
    walled: false,           // уже упёрся в стену замка (защита от стука каждый кадр)
    roofed: false,           // уже лежит/упёрся в крышу башни
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
}

// моб, переживший вылет за край экрана, заходит в бой заново справа (ХП уже снижено при вылете)
function returnFromOffscreen(d){
  const s = sizeOf(d);
  d.state = 'walk';
  d.x = W + 10; d.y = GROUND_Y - s;
  d.vx = d.vy = 0; d.rot = 0; d.rotV = 0;
  d.armed = false; d.noEyeDmg = false; d.hitsLeft = 0; d.noDmg = false; d.grounded = true;
  d.swing = 0; d.walled = false; d.roofed = false;
}

// дальний моб запускает снаряд по вратам (летит влево, урон при достижении стены)
function fireShot(d){
  const T = TYPES[d.type];
  const s = sizeOf(d);
  shots.push({ x: d.x, y: d.y + s*0.4, vx: -T.shotSpeed, dmg: T.shotDmg });
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

function igniteDemon(d, source = 'spread'){
  if(!demons.includes(d) || d.state === 'offscreen' || d.state === 'burrow') return;
  const first = !burning(d);
  const chargeFromBrazier = source === 'brazier' && !d.fireBurstReady;
  d.burnT = Math.max(d.burnT || 0, FIRE.duration);
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
  c.burnT = Math.max(c.burnT || 0, FIRE.duration);
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
  while(d.burnTick <= 0 && demons.includes(d)){
    d.burnTick += FIRE.tickEvery;
    hurt(d, FIRE.tickDmg, 220);
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
  while(c.burnTick <= 0 && cyclopes.includes(c)){
    c.burnTick += FIRE.tickEvery;
    hitCyclops(c, FIRE.tickDmg);
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
  return circleHitsRect(BRAZIER.x, BRAZIER.y, BRAZIER.r, d.x, d.y, s, s);
}

function fireImpactDamage(base, d, wasArmed, sp){
  return wasArmed && burning(d) && sp >= SPD_LIGHT ? base + FIRE.impactBonus : base;
}

function fireBurst(x, y, src){
  if(!src.fireBurstReady) return;
  src.fireBurstReady = false;
  emitFireParticles(x, y - 4, FIRE.spreadParticles, 1.15);
  shockwaves.push({x, y, r: 10, max: FIRE.spreadRadius, life: .38});
  shake = Math.max(shake, 8);
  for(const o of [...demons]){
    if(o === src || o.state === 'offscreen' || o.state === 'burrow' || !demons.includes(o)) continue;
    const os = sizeOf(o);
    if(Math.hypot(o.x+os/2 - x, o.y+os/2 - y) <= FIRE.spreadRadius) igniteDemon(o, 'spread');
  }
  for(const c of [...cyclopes]){
    if(Math.hypot(c.x+CYC_W/2 - x, c.y+CYC_H/2 - y) <= FIRE.spreadRadius + CYC_W*0.2) igniteCyclops(c);
  }
}

// удар схваченного моба об пол: бьёт по площади всех, кто МЕНЬШЕ него (по 1 урону).
// Вызывается только при ударе рукой об землю — не при приземлении брошенного.
function slamSmaller(d){
  const S = CFG.slam;
  const ds = sizeOf(d);
  const cx0 = d.x + ds/2;
  let hit = false;
  for(const o of [...demons]){
    if(o === d || o.state==='held' || o.state==='offscreen' || o.state==='burrow' || o.flash>0 || !demons.includes(o)) continue;
    if(sizeOf(o) >= ds) continue; // достаётся только меньшим
    const os = sizeOf(o);
    if(Math.hypot(o.x+os/2 - cx0, o.y+os/2 - GROUND_Y) <= S.radius){
      hurt(o, S.dmg, 400);
      hit = true;
    }
  }
  if(hit){
    shockwaves.push({ x: cx0, y: GROUND_Y, r: 8, max: S.radius, life: .35 });
    shake = Math.max(shake, 4);
  }
}

function hurt(d, dmg, sp){
  if (dmg <= 0) return;
  d.hp -= dmg;
  if (d.hp <= 0) { splat(d, sp); return; }
  // живой, но получил
  sfx.hurt();
  d.flash = 0.25;
  shake = Math.min(TYPES[d.type].shakeHurt, 3 + sp/200);
  const s = sizeOf(d), px = d.x + s/2, py = d.y + s*0.8;
  const col = bloodCol(d.type);
  for(let i=0;i<5+dmg*3;i++){
    particles.push({x:px, y:py, vx:rnd(-180,180), vy:rnd(-300,-60),
      col, life:rnd(.3,.6), size:rnd(2,4)});
  }
  floatText(px, d.y-8, '-'+dmg+' ХП', '#c0392b', 1);
}

function splat(d, sp){
  sfx.splat();
  shake = Math.min(TYPES[d.type].shakeSplat, 6 + sp/120);
  const pts = TYPES[d.type].score;
  score += pts; scoreEl.textContent = score;
  gainXP(pts);
  const s = sizeOf(d), px = d.x + s/2, py = d.y + s/2;
  const col = bloodCol(d.type);
  const big = d.type !== 'small';
  // размер лужи фиксирован по типу моба — от силы броска не зависит
  const maxR = d.type==='huge' ? rnd(34,46) : big ? rnd(26,38) : rnd(13,20);
  // разбился ОБ СТЕНУ замка: при ударе моб прижат к стене (d.x === WALL.x) ниже её
  // кромки. Тогда кровь брызгает вертикальным потёком по кладке, а не лужей на полу.
  const onWall = d.x <= WALL.x + 0.5 && d.y + s > WALL.top;
  if(onWall){
    puddles.push({wall:true, x:WALL.x + 4, y:py - 2, r:0, max:maxR, col, life:1, size:bloodSize(d.type)});
  } else {
    puddles.push({x:px, y:GROUND_Y, r:0, max:maxR, col, life:1, size:bloodSize(d.type)});
  }
  for(let i=0; i < (d.type==='huge' ? 30 : big ? 22 : 12); i++){
    particles.push({
      x:px, y:py,
      vx:rnd(-280,280), vy:rnd(-460,-80),
      col, life:rnd(.4,.9), size:rnd(2, big?6:4)
    });
  }
  floatText(px, py-24, big?'ХРЯЯЯСЬ!':'хрясь!');
  if (big) floatText(px, py-44, '+'+pts, '#b8860b', 1.2);
  if (held === d) { held = null; cv.classList.remove('grabbing'); }
  demons.splice(demons.indexOf(d),1);
  if (d.type === 'bomber') bomberBoom(px, py); // рвануло — задевает соседей
}

// взрыв бомбера: урон по площади всем мобам рядом (возможна цепная реакция)
function bomberBoom(x, y){
  const T = TYPES.bomber;
  sfx.boom();
  shake = Math.max(shake, 12);
  shockwaves.push({x, y: GROUND_Y, r: 10, max: T.boomR, life: .4});
  for(let i = 0; i < 24; i++){
    particles.push({x, y, vx:rnd(-300,300), vy:rnd(-460,-40),
      col: i%2 ? '#ffcf3a' : '#c0392b', life:rnd(.3,.7), size:rnd(2,5)});
  }
  for(const o of [...demons]){
    if(o.state==='held' || o.state==='offscreen' || o.state==='burrow' || !demons.includes(o)) continue;
    const os = sizeOf(o);
    if(Math.hypot(o.x+os/2 - x, o.y+os/2 - y) <= T.boomR) hurt(o, T.boomDmg, 600);
  }
}

function reachMountain(d){
  sfx.reach();
  const dmgM = mountainDmg(TYPES[d.type].mtnDmg);
  hp = Math.max(0, hp - dmgM);
  hpFill.style.width = hp + '%';
  shake = 10;
  floatText(d.x+sizeOf(d)/2, d.y, '-'+dmgM, '#c0392b', 1);
  for(let i=0;i<8;i++){
    particles.push({x:d.x, y:d.y+sizeOf(d)/2, vx:rnd(-80,180), vy:rnd(-200,-40),
      col:'#7a4a32', life:rnd(.3,.7), size:rnd(2,4)});
  }
  demons.splice(demons.indexOf(d),1);
  if (hp <= 0) gameOver();
}

// Моб улетел за ЛЕВЫЙ край — «доставлен» в город за вратами.
// Врата получают ДВОЙНОЙ урон, который этот моб нанёс бы им у стены.
function cityBreach(d){
  sfx.reach();
  const dmg = 2 * mountainDmg(TYPES[d.type].mtnDmg);
  hp = Math.max(0, hp - dmg);
  hpFill.style.width = hp + '%';
  shake = 12;
  floatText(MOUNTAIN_X + 30, 130, '-'+dmg, '#c0392b', 1.4);
  demons.splice(demons.indexOf(d),1);
  if(hp <= 0){ gameOver(); return; }
  tutorialCityBreach(); // первый раз за партию — обучающее предупреждение (затемнение + текст)
}

function spawnCyclops(){
  cyclopes.push({
    x: W + 10, y: GROUND_Y - CYC_H,
    hp: CFG.cyclops.hp, t: rnd(0,10), step: 0.8,
    state: 'walk', poundT: 0, eyeFlash: 0, freeze: 0,
    burnT: 0, burnTick: 0, burnFx: 0,
  });
  floatText(W-90, GROUND_Y - CYC_H - 24, 'ЦИКЛОП!', '#c0392b', 1.6);
}

function hitCyclops(c, dmg){
  c.hp -= dmg;
  c.eyeFlash = 0.35;
  sfx.hurt();
  shake = Math.max(shake, CFG.cyclops.shakeHit);
  floatText(c.x+CYC_EYE.x, c.y+CYC_EYE.y-16, '-'+dmg+' ХП', '#c0392b', 1);
  if(c.hp <= 0){
    sfx.splat(); shake = CFG.cyclops.shakeDeath;
    score += CFG.cyclops.score; scoreEl.textContent = score;
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

// ── поток врагов ───────────────────────────────────────────────────
// случайный тип из пула с учётом времени: тип доступен после from,
// его вес = weight + grow*(прошло секунд с разблокировки)
function pickStreamType(){
  const pool = CFG.stream.pool;
  const w = [];
  let total = 0;
  for(const e of pool){
    const ww = gameTime < e.from ? 0 : e.weight + e.grow * (gameTime - e.from);
    w.push(ww); total += ww;
  }
  let r = Math.random() * total;
  for(let i = 0; i < pool.length; i++){ r -= w[i]; if(r <= 0) return pool[i].type; }
  return 'small';
}

// текущий интервал спавна: от startEvery к minEvery за rampTime секунд
function curSpawnEvery(){
  const S = CFG.stream;
  const k = Math.min(1, gameTime / S.rampTime);
  return S.startEvery + (S.minEvery - S.startEvery) * k;
}

// ── прокачка ───────────────────────────────────────────────────────
// урон по вратам с учётом скилла «Каменная кладка»
function mountainDmg(base){
  return Math.round(base * (1 - CFG.skills.armor.mult * sk('armor')));
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
  xpFill.style.width = Math.min(100, 100 * player.xp / player.xpNeed) + '%';
}

function gainXP(n){
  if(!CFG.leveling.enabled) return; // прокачка выключена
  player.xp += n;
  while(player.xp >= player.xpNeed){
    player.xp -= player.xpNeed;
    player.level++;
    player.xpNeed = Math.round(player.xpNeed * CFG.leveling.growth);
    pendingLevels++;
  }
  updateXPBar();
  if(pendingLevels > 0 && !choosing && running) openSkillChoice();
}

// скиллы, доступные к выпадению: не на максимуме и с выполненными требованиями
function availableSkills(){
  return Object.entries(CFG.skills)
    .filter(([id, sd]) => sk(id) < sd.max && (!sd.requires || sk(sd.requires) > 0))
    .map(([id, sd]) => ({id, ...sd}));
}

function openSkillChoice(){
  shake = 0; // игра замирает — тряска камеры тоже
  // аккуратно выпускаем демона из руки
  if(held){
    held.state = 'fly'; held.vx = held.vy = 0;
    held.armed = false; held.noEyeDmg = false; held.noDmg = true;
    held = null; cv.classList.remove('grabbing');
  }
  const pool = availableSkills();
  if(pool.length === 0){
    // всё прокачано — вместо скилла чиним врата
    pendingLevels--;
    hp = Math.min(100, hp + 15); hpFill.style.width = hp + '%';
    floatText(MOUNTAIN_X, 200, '+15 ВРАТАМ', '#2f6e3c', 1.4);
    if(pendingLevels > 0) openSkillChoice();
    return;
  }
  choosing = true;
  const offer = pool.sort(() => Math.random() - .5).slice(0, 3);
  skillCards.innerHTML = '';
  for(const s of offer){
    const btn = document.createElement('button');
    btn.className = 'skill-card';
    btn.innerHTML = '<b>' + s.name + '</b>' + s.desc +
      '<div class="lvl-tag">уровень ' + (sk(s.id)+1) + '/' + s.max + '</div>';
    btn.addEventListener('click', () => pickSkill(s.id));
    skillCards.appendChild(btn);
  }
  lvlOverlay.classList.remove('hidden');
}

function pickSkill(id){
  player.skills[id] = sk(id) + 1;
  pendingLevels--;
  lvlOverlay.classList.add('hidden');
  if(pendingLevels > 0){ openSkillChoice(); return; }
  choosing = false;
  // сбрасываем скорость мыши, чтобы после паузы не было фантомного рывка
  mouse.px = mouse.x; mouse.py = mouse.y; mouse.vx = mouse.vy = 0;
}

// ── заклинания: применяются как события мира (см. triggerCloud / носильщик валуна) ──

// Торнадо в точке centerX: втягивает орду к центру и подбрасывает вверх.
// Струи рождаются спиралью вокруг центра (см. отрисовку windStreaks).
function triggerTornado(centerX){
  const T = CFG.tornado;
  sfx.wind();
  shake = Math.max(shake, 7);
  const cxC = Math.max(MOUNTAIN_X + 20, Math.min(W - 20, centerX));
  // спиральные струи у земли вокруг центра вихря
  for(let i = 0; i < 48; i++){
    windStreaks.push({
      cx: cxC, baseY: GROUND_Y - rnd(0, 12),
      ang: rnd(0, Math.PI*2),
      rad: rnd(30, 230),
      angV: rnd(5.5, 9),      // все в одну сторону — единый закрут
      radV: -rnd(45, 95),     // втягивание внутрь
      riseV: rnd(120, 270),   // подъём вверх
      t: 0, life: rnd(.6, 1.2),
    });
  }
  for(const d of demons){
    if(d.state === 'held' || d.state === 'offscreen' || d.state === 'burrow') continue;
    // действует только в зоне под завихрением (широкой, но не вся карта)
    if(Math.abs((d.x + sizeOf(d)/2) - cxC) > T.radius) continue;
    if(TYPES[d.type].liftable === false){
      // неподъёмные не взлетают — просто замирают
      d.state = 'stun'; d.stun = Math.max(d.stun, CFG.spells.wind.stun);
      d.vx = d.vy = 0; d.rot = 0;
      continue;
    }
    d.state = 'fly';
    // лёгких подбрасывает выше тяжёлых
    const w = (d.type==='small'||d.type==='dog') ? 1.4
            : (d.type==='huge') ? 0.6 : 0.85;
    const dir = (cxC - (d.x + sizeOf(d)/2)) >= 0 ? 1 : -1;
    d.vx = dir * T.pull * w * rnd(.6, 1.0);     // втягивает к центру вихря
    d.vy = -T.lift * w * rnd(.85, 1.15);        // вверх — сильно
    d.rotV = rnd(-8, 8);
    // заряжаем как при броске рукой: впечатавшись в землю на скорости — получат урон
    d.armed = true; d.noEyeDmg = true; d.hitsLeft = sk('collide'); d.noDmg = false; d.grounded = false;
  }
  for(const c of cyclopes){
    c.freeze = Math.max(c.freeze, CFG.spells.wind.stun);
    floatText(c.x+CYC_W/2, c.y-24, 'ЗАМЕР!', '#1a1626', 1);
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
  for(const o of [...demons]){
    if(o.state === 'held' || o.state === 'offscreen' || o.state === 'burrow' || o.flash > 0 || !demons.includes(o)) continue;
    const os = sizeOf(o);
    if(distToSeg(o.x+os/2, o.y+os/2, sx, sy, ex, ey) < L.pierceR + os*0.4)
      hurt(o, L.pierceDmg, 800);
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
}

// взрыв молнии в точке удара о землю
function boltBoom(b){
  const L = CFG.spells.lightning;
  sfx.boom();
  shake = Math.max(shake, 9);
  shockwaves.push({x: b.x, y: GROUND_Y, r: 10, max: L.boomR, life: .4});
  for(let i = 0; i < 18; i++){
    particles.push({x:b.x, y:GROUND_Y-4, vx:rnd(-260,260), vy:rnd(-420,-60),
      col: i%2 ? '#7fb4ff' : '#f4faff', life:rnd(.3,.7), size:rnd(2,4)});
  }
  for(const o of [...demons]){
    if(o.state === 'held' || o.state === 'offscreen' || o.state === 'burrow' || !demons.includes(o)) continue;
    const os = sizeOf(o);
    if(Math.hypot(o.x+os/2 - b.x, o.y+os/2 - GROUND_Y) <= L.boomR) hurt(o, L.boomDmg, 600);
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
  const t = Math.max(0, b.life / b.max);          // 1 → 0
  const flick = 0.55 + Math.random()*0.45;        // мерцание разряда
  const main = jaggedPath(b.x0, b.y0, b.x1, b.y1, L.jitter);
  cx.save();
  cx.lineJoin = 'round'; cx.lineCap = 'round';
  // мягкое внешнее свечение (холодное, синеватое)
  cx.globalAlpha = 0.22 * t * flick; cx.strokeStyle = '#bcd8ff'; cx.lineWidth = 18; strokePath(main);
  // сине-голубой ореол
  cx.globalAlpha = 0.55 * t * flick; cx.strokeStyle = '#7fb4ff'; cx.lineWidth = 8; strokePath(main);
  // ветви
  cx.globalAlpha = 0.5 * t * flick; cx.strokeStyle = '#a7ccff'; cx.lineWidth = 2;
  for(let i = 1; i < main.length-1; i++){
    if(Math.random() < L.branchChance){
      const p = main[i];
      const bx = p.x + (Math.random()*2-1)*46;
      const by = Math.min(GROUND_Y, p.y + Math.random()*44);
      strokePath(jaggedPath(p.x, p.y, bx, by, L.jitter*0.6));
    }
  }
  // бело-голубое раскалённое ядро
  cx.globalAlpha = t; cx.strokeStyle = '#f4faff'; cx.lineWidth = 2.5; strokePath(main);
  // вспышка-шар в точке удара о землю
  const g = cx.createRadialGradient(b.x1, b.y1, 0, b.x1, b.y1, 46);
  g.addColorStop(0, `rgba(244,250,255,${0.75*t})`);
  g.addColorStop(0.4, `rgba(127,180,255,${0.4*t})`);
  g.addColorStop(1, 'rgba(127,180,255,0)');
  cx.globalAlpha = 1; cx.fillStyle = g;
  cx.beginPath(); cx.arc(b.x1, b.y1, 46, 0, Math.PI*2); cx.fill();
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
  if(!running || choosing) return;
  // идёт диалог: клик допечатывает реплику / листает дальше, в игру не проходит
  if(dialogueActive()){
    dialogueClick();
    e.preventDefault();
    return;
  }
  // открыто модальное предупреждение (заброс в город) — клик закрывает его
  if(tutorialMsgActive()){
    dismissTutorialMessage();
    e.preventDefault();
    return;
  }
  const p = ptr(e);
  mouse.x = mouse.px = p.x; mouse.y = mouse.py = p.y;
  mouse.vx = mouse.vy = 0;
  // обучение: можно только схватить выделенного моба — это и завершает обучение
  if(tutorialActive()){
    const d = tutorialDemon();
    if(d && demons.includes(d) && d.state === 'walk'){
      const s = sizeOf(d);
      const dist = Math.hypot(p.x-(d.x+s/2), p.y-(d.y+s/2));
      // радиус захвата щедрый, чтобы новичок легко попал по подсвеченному мобу
      const gr = Math.max(TYPES[d.type].grabR, s) * 1.4;
      if(dist < gr){
        rememberAirHome(d);
        held = d; d.state='held'; d.rotV = 0;
        d.grounded = false; d.noDmg = false; d.swing = 0; d.walled = false; d.roofed = false;
        cv.classList.add('grabbing');
        sfx.grab();
        tutorialComplete(); // обучение пройдено — мир оживает
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
  // 2) хватаешь носильщика — отбираешь у него валун (а не поднимаешь его самого)
  for(const d of demons){
    if(d.type !== 'roller' || !d.hasBoulder || d.state !== 'walk') continue;
    const s = sizeOf(d);
    const dist = Math.hypot(p.x-(d.x+s/2), p.y-(d.y+s/2));
    if(dist < TYPES.roller.grabR * (1 + CFG.skills.grip.mult * sk('grip'))){
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
    const gr = TYPES[d.type].grabR * (1 + CFG.skills.grip.mult * sk('grip'));
    if(dist < gr && dist < bd){ best=d; bd=dist; }
  }
  if(best){
    rememberAirHome(best);
    held = best; best.state='held'; best.rotV = 0;
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
  if(held || heldBoulder) e.preventDefault();
}
function onUp(){
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
    // тяжёлых надо швырять быстрее: скорость броска гасится весом (+ скилл «Могучий замах»)
    const tf = T.throwF * (1 + CFG.skills.strongArm.mult * sk('strongArm'));
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
function loop(ts){
  const dt = Math.min(.033, (ts-last)/1000 || .016);
  last = ts;
  updateClouds(dt); // плывут всегда, даже в меню и на паузе
  updateCursor(dt); // курсор анимируется всегда, чтобы успеть «сжаться» при хватании
  updateDialogue(dt); // печать реплики во времени (если идёт диалог)
  // диалог и обучение замораживают мир (диалог играется первым, до обучения)
  if(running && !choosing && !tutorialFrozen() && !dialogueActive()) update(dt);
  else shake = 0; // мир на паузе/стопе — всегда гасим тряску камеры (см. CLAUDE.md)
  draw();
  requestAnimationFrame(loop);
}

function update(dt){
  // скорость курсора (сглаженная) — для бросков и ударов об землю
  mouse.vx = mouse.vx*0.55 + ((mouse.x-mouse.px)/dt)*0.45*0.9;
  mouse.vy = mouse.vy*0.55 + ((mouse.y-mouse.py)/dt)*0.45*0.9;
  mouse.px = mouse.x; mouse.py = mouse.y;

  // непрерывный поток врагов (см. CFG.stream): со временем чаще и злее, без пауз
  gameTime += dt;
  // уровень угрозы для HUD
  const th = Math.floor(gameTime / CFG.stream.threatEvery) + 1;
  if(th !== threat){ threat = th; threatEl.textContent = threat; }
  // обычные мобы — идут всегда, не дожидаясь смерти циклопа
  spawnTimer -= dt;
  if(spawnTimer <= 0){
    spawnDemon(pickStreamType());
    spawnTimer = curSpawnEvery() * rnd(.8, 1.2);
  }
  // циклоп — мини-босс, спавнится НЕЗАВИСИМО по своему таймеру (если есть место)
  cyclopsTimer -= dt;
  if(cyclopsTimer <= 0){
    if(cyclopes.length < CFG.cyclops.maxAlive){
      spawnCyclops();
      cyclopsTimer = CFG.stream.cyclopsEvery * rnd(.85, 1.15);
    } else {
      cyclopsTimer = 3; // место занято — проверим чуть позже
    }
  }

  // первый моб вышел — запускаем обучение и замораживаем мир до его захвата
  if(tutorialOnFirstDemon(demons)) return;

  for(const d of [...demons]){
    if(!demons.includes(d)) continue;
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
      d.x -= TYPES[d.type].burrowSpeed * dt;
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
      d.x -= d.speed * dt;
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

      // ── упор в землю: не проваливается, а стукается ──
      const floor = GROUND_Y - s;
      if(d.y >= floor){
        d.y = floor;
        if(!d.grounded){
          d.grounded = true;
          const dmg = impactDamage(d.swing);
          if(dmg > 0){
            slamSmaller(d);        // ударная волна по меньшим (до урона себе — d ещё жив)
            hurt(d, dmg, d.swing);
            d.swing = 0;
          }
          else sfx.thud();
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
          if(dmg > 0){ hurt(d, dmg, d.swing); d.swing = 0; }
          else sfx.thud();
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
      // улетел ВЛЕВО за врата — «доставлен» в город: врата получают двойной урон, моб пропал
      if(d.x + s < -M){ cityBreach(d); continue; }
      // улетел далеко ВПРАВО — выброшен прочь: получает урон, выжил → «на возврат», нет → гибнет
      if(d.x > W + M){
        d.armed = false; d.noEyeDmg = false; d.hitsLeft = 0;
        hurt(d, CFG.offscreen.dmg, 0);
        if(!demons.includes(d)) continue; // не пережил вылет — погиб
        d.state = 'offscreen';
        d.returnT = CFG.offscreen.returnDelay;
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
          hitCyclops(c, dmg);
          d.armed = false; d.noEyeDmg = false; // бросок «разряжен» — второй раз глаз не бьёт
          hurt(d, 1, sp3);
          break;
        }
      }
      if(!demons.includes(d)) continue;

      // ── крыша башни: прилетел сверху — стукается как об землю ──
      if(hitsTowerRoofFromAbove(d, s, py0)){
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
        d.x = WALL.x;
        const sp = Math.hypot(d.vx, d.vy);
        const wasArmed = d.armed;
        d.armed = false; d.noEyeDmg = false; // о стену бросок «разряжается», как об пол
        const dmg = wasArmed ? fireImpactDamage(impactDamage(sp), d, wasArmed, sp) : 0;
        if(dmg > 0){
          fireBurst(WALL.x, d.y + s/2, d);
          hurt(d, dmg, sp);
          if(!demons.includes(d)) continue; // разбился о стену
        } else sfx.thud();
        d.vx = Math.max(140, Math.abs(d.vx)*0.45); // отскок вправо от стены
        d.rotV *= CFG.throwing.spinFloorDamp;
      }

      if(d.y + s >= GROUND_Y){
        d.y = GROUND_Y - s;
        if(d.noDmg){
          // вывалился из рук — падение без урона
          d.noDmg = false;
          sfx.thud();
          d.state='stun'; d.stun = .5; d.vx=d.vy=0; d.rot = 0;
          continue;
        }
        const sp = Math.hypot(d.vx, d.vy);
        // урон от пола только при первом касании за бросок; дальше — разряжен
        const wasArmed = d.armed;
        const dmg = wasArmed ? fireImpactDamage(impactDamage(sp), d, wasArmed, sp) : 0;
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
        // выжил: отскок или стан
        if(Math.abs(d.vy) > 160){
          d.vy = -d.vy*0.45; d.vx *= .7;
          if(dmg===0) sfx.thud();
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
  // ── воздушные завихрения: появляются периодически, плывут влево, кликом → торнадо ──
  nextSwirl -= dt;
  if(nextSwirl <= 0){
    const s = { x: W + 30, y: rnd(80, 190), spd: -rnd(45, 80) };
    swirls.push(s);
    floatText(W - 70, s.y, 'ВЕТЕР — КЛИКНИ!', '#1f7a7a', 1.8);
    nextSwirl = rnd(CFG.tornado.swirlMin, CFG.tornado.swirlMax);
  }
  for(const s of [...swirls]){
    s.x += s.spd * dt;
    if(s.x < -40) swirls.splice(swirls.indexOf(s), 1); // уплыло — шанс упущен
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
      const dmg = mountainDmg(sh.dmg);
      hp = Math.max(0, hp - dmg); hpFill.style.width = hp + '%';
      shake = Math.max(shake, 6); sfx.reach();
      floatText(MOUNTAIN_X+20, sh.y, '-'+dmg, '#c0392b', 1);
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
    if(!updateCyclopsBurn(c, dt)) continue;
    if(c.freeze > 0){ c.freeze -= dt; } // замер от порыва ветра
    else if(c.state === 'walk'){
      c.x -= CFG.cyclops.speed * dt;
      c.step -= dt;
      if(c.step <= 0){ c.step = 0.8; shake = Math.max(shake, CFG.cyclops.shakeStep); sfx.thud(); }
      if(c.x < MOUNTAIN_X - 20){ c.state = 'pound'; c.poundT = 1; }
    } else {
      // дошёл — крушит врата ударами
      c.poundT -= dt;
      if(c.poundT <= 0){
        c.poundT = CFG.cyclops.poundEvery;
        const pd = mountainDmg(CFG.cyclops.mtnDmg);
        hp = Math.max(0, hp - pd);
        hpFill.style.width = hp + '%';
        shake = CFG.cyclops.shakePound; sfx.reach();
        floatText(MOUNTAIN_X+40, GROUND_Y-170, '-'+pd, '#c0392b', 1.2);
        for(let i=0;i<14;i++){
          particles.push({x:MOUNTAIN_X+rnd(-30,60), y:rnd(180,GROUND_Y-40), vx:rnd(-60,220), vy:rnd(-220,-40),
            col:'#7a4a32', life:rnd(.4,.9), size:rnd(2,5)});
        }
        if(hp <= 0){ gameOver(); return; }
      }
    }
  }

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
  if(running && shake>0) cx.translate(rnd(-shake,shake), rnd(-shake,shake));

  // — небо — (overscan ±20px, чтобы тряска камеры не оголяла края)
  if(art.sky){
    cx.drawImage(art.sky, -20, -20, W+40, H+40);
  } else {
    cx.fillStyle = '#dfe1f4'; cx.fillRect(-20,-20,W+40,H+40);
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
  drawBrazier();

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
      const wide = len * (spr.height / spr.width);   // толщина потёка
      cx.save();
      cx.translate(pl.x, pl.y);
      cx.rotate(Math.PI/2);
      cx.drawImage(spr, 0, -wide/2, len, wide);
      cx.restore();
    } else if (spr){
      // спрайт-лужа растекается по полу: ширина растёт с pl.r, низ на линии земли
      const w = pl.r * 2;
      const h = w * (spr.height / spr.width);
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

  // — трава — поверх земли, качается «волной ветра» вдоль линии земли
  drawGrass();

  // — лучи света из-за облаков, ложатся на замок (мобы ходят перед ними) —
  drawGodRays();

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
    if(burning(c)) drawEntityFire(c.x, c.y, CYC_W, CYC_H, 1.4);
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
    if(burning(d)) drawEntityFire(d.x, d.y, s, s, 1);
    // носильщик ещё несёт валун — рисуем его над мобом
    if(d.type==='roller' && d.hasBoulder){
      const br = CFG.spells.boulder.r;
      cx.drawImage(SPELL_SPRITES.boulder, d.x+s/2-br*0.8, d.y-br*1.1, br*1.6, br*1.6);
    }
    // бомбер — пульсирующий раскалённый фитиль
    if(d.type==='bomber'){
      const gl = 0.45 + 0.45*Math.sin(last*0.02);
      cx.globalAlpha = gl;
      cx.fillStyle = '#ffcf3a';
      cx.beginPath(); cx.arc(d.x+s/2, d.y-3, 3, 0, Math.PI*2); cx.fill();
      cx.globalAlpha = 1;
    }
    // полоска ХП крупного моба — показываем, только если он уже ранен
    const mhp = TYPES[d.type].hp;
    if(mhp > 1 && d.hp < mhp){
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

  // снаряды дальних мобов — тёмно-фиолетовые сгустки со свечением
  for(const sh of shots){
    cx.globalAlpha = .4; cx.fillStyle = '#b06bff';
    cx.beginPath(); cx.arc(sh.x, sh.y, 9, 0, Math.PI*2); cx.fill();
    cx.globalAlpha = 1; cx.fillStyle = '#d9b3ff';
    cx.beginPath(); cx.arc(sh.x, sh.y, 5, 0, Math.PI*2); cx.fill();
  }

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
  // модальное предупреждение (заброс в город): только затемнение, текст — HTML
  else if(tutorialMsgActive()) drawTutorialMask();

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
  // во время обучения рука нейтральная (рог под маской не должен включать «указатель»)
  if(tutorialFrozen()){ cursorState.phase = 'idle'; cursorState.i = 0; cursorState.t = 0; return; }
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
    return;
  }
  cursorState.phase = cursorOverInteractive() ? 'pointer' : 'idle';
  cursorState.i = 0; cursorState.t = 0;
}
function cursorFrameNum(){
  if(cursorState.phase === 'close')   return CURSOR_SEQ[Math.min(cursorState.i, CURSOR_SEQ.length-1)];
  if(cursorState.phase === 'held')    return CURSOR_HELD;
  if(cursorState.phase === 'pointer') return CURSOR_POINTER;
  return 1;
}
function drawCursor(){
  const img = cursorFrames[cursorFrameNum()];
  if(!img) return;           // кадры ещё не догрузились
  // центр кадра — в точке курсора (по ней же считается захват демонов)
  cx.drawImage(img, Math.round(mouse.x - CURSOR_PX/2), Math.round(mouse.y - CURSOR_PX/2),
               CURSOR_PX, CURSOR_PX);
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

function drawBrazier(){
  const t = last * 0.001;
  const x = BRAZIER.x, y = BRAZIER.y;
  cx.save();
  cx.globalAlpha = 0.3;
  cx.fillStyle = '#000';
  cx.beginPath();
  cx.ellipse(x, TOWER_ROOF.y + 3, BRAZIER.w*0.55, 5, 0, 0, Math.PI*2);
  cx.fill();
  cx.globalAlpha = 1;
  // чаша: тёмный пиксельный силуэт с тёплой кромкой
  cx.fillStyle = '#201824';
  cx.fillRect(Math.round(x - BRAZIER.w/2), Math.round(y + 7), BRAZIER.w, BRAZIER.h);
  cx.fillStyle = '#4a2a26';
  cx.fillRect(Math.round(x - BRAZIER.w/2 + 3), Math.round(y + 7), BRAZIER.w - 6, 3);
  cx.fillStyle = '#8a4a24';
  cx.fillRect(Math.round(x - BRAZIER.w/2 + 6), Math.round(y + 4), BRAZIER.w - 12, 5);
  cx.globalCompositeOperation = 'lighter';
  for(let i = 0; i < 3; i++){
    const phase = t*7 + i*2.1;
    const fx = x + (i-1)*7 + Math.sin(phase)*2;
    const h = 18 + Math.sin(phase*1.3)*5;
    cx.fillStyle = FIRE.colors[i % FIRE.colors.length];
    cx.beginPath();
    cx.moveTo(fx, y + 6 - h);
    cx.lineTo(fx - 7, y + 7);
    cx.lineTo(fx + 7, y + 7);
    cx.closePath();
    cx.fill();
  }
  cx.globalCompositeOperation = 'source-over';
  cx.restore();
}

function drawEntityFire(x, y, w, h, scale){
  const t = last * 0.001;
  cx.save();
  cx.globalCompositeOperation = 'lighter';
  const n = Math.max(2, Math.round(3 * scale));
  for(let i = 0; i < n; i++){
    const phase = t*9 + i*1.7 + x*0.03;
    const fx = x + w*(0.25 + 0.5*((i+0.5)/n)) + Math.sin(phase)*w*0.08;
    const fy = y + h*(0.18 + 0.25*Math.abs(Math.sin(phase*.7)));
    const fh = (10 + 7*Math.sin(phase*1.2 + 1)) * scale;
    const fw = (5 + 2*Math.cos(phase)) * scale;
    cx.fillStyle = FIRE.colors[i % FIRE.colors.length];
    cx.globalAlpha = 0.55 + 0.25*Math.sin(phase);
    cx.beginPath();
    cx.moveTo(fx, fy - fh);
    cx.lineTo(fx - fw, fy);
    cx.lineTo(fx + fw, fy);
    cx.closePath();
    cx.fill();
  }
  cx.globalAlpha = 1;
  cx.globalCompositeOperation = 'source-over';
  cx.restore();
}

// ── HUD / overlay ──────────────────────────────────────────────────
const scoreEl = document.getElementById('score');
const threatEl = document.getElementById('threat');
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

// кнопка звука (слева внизу)
const muteBtn = document.getElementById('muteBtn');
muteBtn.addEventListener('click', () => {
  const m = toggleMute();
  muteBtn.textContent = m ? '🔇' : '🔊';
  muteBtn.classList.toggle('muted', m);
  muteBtn.blur(); // снять фокус, чтобы пробел/Enter не «нажимали» кнопку снова
});

// skipNarrative — отладочный старт «без диалогов и туторов»: вступительный диалог
// не запускается, обучение выключено на всю партию (тумблеры конфига игнорируются).
function start(skipNarrative = false){
  demons=[]; puddles=[]; particles=[]; cyclopes=[]; shockwaves=[];
  bolts=[]; boulders=[]; windStreaks=[]; shots=[]; heldBoulder=null; skyFlash=0;
  swirls=[]; nextSwirl = rnd(CFG.tornado.swirlMin, CFG.tornado.swirlMax);
  for(const c of clouds){ c.charge = null; }
  nextCharge = rnd(CFG.sky.chargeMin, CFG.sky.chargeMax);
  score=0; hp=100; held=null;
  gameTime=0; spawnTimer=0.6; cyclopsTimer=CFG.stream.cyclopsFirst; threat=1;
  player = { level: 1, xp: 0, xpNeed: CFG.leveling.baseXP, skills: {} };
  pendingLevels = 0; choosing = false;
  resetTutorial(skipNarrative ? false : CFG.tutorial.enabled);
  scoreEl.textContent='0'; hpFill.style.width='100%'; threatEl.textContent='1';
  updateXPBar();
  overlay.classList.add('hidden');
  lvlOverlay.classList.add('hidden');
  running = true;
  // вступительный диалог: пока он идёт, мир заморожен (см. цикл). Кончится —
  // выйдет первый моб и подхватит обучение. Тумблер — DIALOGUE_CFG.enabled.
  // При отладочном старте диалог не запускаем — игра начинается сразу.
  if(!skipNarrative) startDialogue('intro');
}
function gameOver(){
  running = false; held = null; heldBoulder = null;
  choosing = false; pendingLevels = 0;
  shake = 0; // игра остановилась — гасим тряску, иначе экран дёргается на экране поражения
  lvlOverlay.classList.add('hidden');
  hideLabel('horn'); // рог больше не рисуется — убираем его HTML-подпись
  cv.classList.remove('grabbing');
  ovTitle.textContent = 'Врата пали…';
  ovText.innerHTML = 'Демоны ворвались в Асгард прямо посреди пира.<br>' +
    'Один разочарованно отставил кубок: к его столу ты пока не готов.<br>' +
    'Но сколько луж ты после себя оставил!';
  ovScore.textContent = 'Очки: ' + score;
  ovScore.classList.remove('hidden');
  startBtn.textContent = 'Ещё раз';
  overlay.classList.remove('hidden');
}
// обёртки-стрелки, чтобы в start() не прилетел объект события как skipNarrative
startBtn.addEventListener('click', () => start(false));
// отладочная кнопка: старт без вступительного диалога и обучения
const startNoNarrativeBtn = document.getElementById('startNoNarrativeBtn');
startNoNarrativeBtn.addEventListener('click', () => start(true));

requestAnimationFrame(loop);
