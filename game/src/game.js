import {
  CFG, GRAV, TYPES, SPD_LIGHT,
  PALS, CYC_PAL, CYC_PX, CYC_W, CYC_H, CYC_EYE, SPELL_NAMES,
} from './config.js';
import { SPRITES, CYC_SPRITE, SPELL_SPRITES } from './sprites.js';
import { sfx, toggleMute } from './audio.js';
import { art } from './assets.js';

const cv = document.getElementById('game');
const cx = cv.getContext('2d');
cx.imageSmoothingEnabled = false;

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

// слоты заклинаний — внизу экрана по центру
const SLOT = CFG.spells.slotSize, SLOT_GAP = 16;
const SLOT_X = (W - (SLOT*3 + SLOT_GAP*2)) / 2;
const SLOT_Y = H - SLOT - 18;

// размер моба в пикселях экрана
const sizeOf = d => 9 * TYPES[d.type].px;

// ── облака: плывут на фоне (x,y в дизайн-координатах, spd — px/сек, минус = влево) ──
const clouds = [
  { key:'cloud1', x: 240, y: 64,  spd: -9  },
  { key:'cloud2', x: 560, y: 120, spd: -6  },
  { key:'cloud3', x: 830, y: 52,  spd: -12 },
];
function updateClouds(dt){
  for(const c of clouds){
    const w = art[c.key] ? art[c.key].width : 210;
    c.x += c.spd * dt;
    if(c.x + w < -40) c.x = W + 40;       // уплыло влево — заводим справа
    else if(c.x > W + 40) c.x = -w - 40;
  }
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

// ── состояние ──────────────────────────────────────────────────────
let demons = [], puddles = [], particles = [], floaties = [], cyclopes = [], shockwaves = [];
let bolts = [], boulders = [], windStreaks = [];
let spellSlots = [{id:'lightning', cd:0}, {id:'boulder', cd:0}, {id:'wind', cd:0}];
let heldSpell = null; // заклинание в руке: {id, slot, x, y}
let score = 0, hp = 100;
let waveIdx = 0, spawnQueue = [], spawnTimer = 0, betweenTimer = 0, curEvery = 1.5;
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
    speed: rnd(T.speedMin, T.speedMax) + waveIdx * CFG.waves.speedPerWave,
    pal: (Math.random()*SPRITES[type].length)|0,
    t: rnd(0,10),
    state: 'walk',           // walk | held | fly | stun | offscreen
    returnT: 0,              // таймер возврата, пока state==='offscreen'
    rot: 0, rotV: 0,
    stun: 0,
    flash: 0,                // вспышка при уроне
    grounded: true,          // для драг-ударов об землю
    armed: false,            // «заряжен» броском: наносит урон, пока не коснулся земли
    hitsLeft: 0,             // сколько мобов ещё может сшибить за этот бросок (скилл «Таран»)
    cycHit: 0,               // таймер: недавно отскочил от циклопа (защита от болтанки между двумя)
    swing: 0,                // пик скорости замаха в руке (затухает) — по нему считается удар об землю/стену
    swingVX: 0, swingVY: 0,  // вектор скорости в момент пика — для броска, если курсор уже притормозил
    walled: false,           // уже упёрся в стену замка (защита от стука каждый кадр)
    flip: Math.random()<.5,
  };
  d.y = GROUND_Y - sizeOf(d);
  demons.push(d);
}

// моб, улетевший за край экрана, заходит в бой заново справа (с теми же ХП)
function returnFromOffscreen(d){
  const s = sizeOf(d);
  d.state = 'walk';
  d.x = W + 10; d.y = GROUND_Y - s;
  d.vx = d.vy = 0; d.rot = 0; d.rotV = 0;
  d.armed = false; d.hitsLeft = 0; d.noDmg = false; d.grounded = true;
  d.swing = 0; d.walled = false;
}

// урон от удара: пока всегда 1 — сила броска не влияет.
// Скорость задаёт только порог «засчитался ли удар вообще»:
// медленнее SPD_LIGHT — просто стук без урона.
function impactDamage(speed){
  return speed >= SPD_LIGHT ? 1 : 0;
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
  const col = PALS[d.type][d.pal].b;
  for(let i=0;i<5+dmg*3;i++){
    particles.push({x:px, y:py, vx:rnd(-180,180), vy:rnd(-300,-60),
      col, life:rnd(.3,.6), size:rnd(2,4)});
  }
  floaties.push({x:px, y:d.y-8, txt:'-'+dmg+' ХП', life:1, col:'#c0392b'});
}

function splat(d, sp){
  sfx.splat();
  shake = Math.min(TYPES[d.type].shakeSplat, 6 + sp/120);
  const pts = TYPES[d.type].score;
  score += pts; scoreEl.textContent = score;
  gainXP(pts);
  const s = sizeOf(d), px = d.x + s/2, py = d.y + s/2;
  const col = PALS[d.type][d.pal].b;
  const big = d.type !== 'small';
  // размер лужи фиксирован по типу моба — от силы броска не зависит
  const maxR = d.type==='huge' ? rnd(34,46) : big ? rnd(26,38) : rnd(13,20);
  puddles.push({x:px, y:GROUND_Y, r:0, max:maxR, col, life:1});
  for(let i=0; i < (d.type==='huge' ? 30 : big ? 22 : 12); i++){
    particles.push({
      x:px, y:py,
      vx:rnd(-280,280), vy:rnd(-460,-80),
      col, life:rnd(.4,.9), size:rnd(2, big?6:4)
    });
  }
  floaties.push({x:px, y:py-24, txt: big?'ХРЯЯЯСЬ!':'хрясь!', life:1});
  if (big) floaties.push({x:px, y:py-44, txt:'+'+pts, life:1.2, col:'#b8860b'});
  if (held === d) { held = null; cv.classList.remove('grabbing'); }
  demons.splice(demons.indexOf(d),1);
}

function reachMountain(d){
  sfx.reach();
  const dmgM = mountainDmg(TYPES[d.type].mtnDmg);
  hp = Math.max(0, hp - dmgM);
  hpFill.style.width = hp + '%';
  shake = 10;
  floaties.push({x:d.x+sizeOf(d)/2, y:d.y, txt:'-'+dmgM, life:1, col:'#c0392b'});
  for(let i=0;i<8;i++){
    particles.push({x:d.x, y:d.y+sizeOf(d)/2, vx:rnd(-80,180), vy:rnd(-200,-40),
      col:'#7a4a32', life:rnd(.3,.7), size:rnd(2,4)});
  }
  demons.splice(demons.indexOf(d),1);
  if (hp <= 0) gameOver();
}

function spawnCyclops(){
  cyclopes.push({
    x: W + 10, y: GROUND_Y - CYC_H,
    hp: CFG.cyclops.hp, t: rnd(0,10), step: 0.8,
    state: 'walk', poundT: 0, eyeFlash: 0, freeze: 0,
  });
  floaties.push({x: W-90, y: GROUND_Y - CYC_H - 24, txt:'ЦИКЛОП!', life:1.6, col:'#c0392b'});
}

function hitCyclops(c, dmg){
  c.hp -= dmg;
  c.eyeFlash = 0.35;
  sfx.hurt();
  shake = Math.max(shake, CFG.cyclops.shakeHit);
  floaties.push({x:c.x+CYC_EYE.x, y:c.y+CYC_EYE.y-16, txt:'-'+dmg+' ХП', life:1, col:'#c0392b'});
  if(c.hp <= 0){
    sfx.splat(); shake = CFG.cyclops.shakeDeath;
    score += CFG.cyclops.score; scoreEl.textContent = score;
    gainXP(CFG.cyclops.score);
    const px = c.x + CYC_W/2;
    puddles.push({x:px, y:GROUND_Y, r:0, max:rnd(55,70), col:CYC_PAL.b, life:1.4});
    for(let i=0;i<40;i++){
      particles.push({x:px+rnd(-CYC_W/3,CYC_W/3), y:c.y+rnd(0,CYC_H), vx:rnd(-320,320), vy:rnd(-500,-60),
        col:CYC_PAL.b, life:rnd(.5,1.1), size:rnd(3,7)});
    }
    floaties.push({x:px, y:c.y, txt:'ХРЯЯЯСЬ!!!', life:1.4});
    floaties.push({x:px, y:c.y+26, txt:'+'+CFG.cyclops.score, life:1.5, col:'#b8860b'});
    cyclopes.splice(cyclopes.indexOf(c),1);
  }
}

// ── волны ──────────────────────────────────────────────────────────
function startWave(i){
  waveIdx = i;
  const list = CFG.waves.list;
  const w = list[Math.min(i, list.length - 1)];
  const loops = Math.max(0, i - (list.length - 1)); // сколько раз зациклили последнюю
  curEvery = Math.max(CFG.waves.minEvery, w.every * Math.pow(CFG.waves.loopSpeedup, loops));
  spawnQueue = w.order.slice();
  spawnTimer = 0.6;
  waveEl.textContent = i + 1;
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
    if(o === src || o.state === 'held' || !demons.includes(o)) continue;
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
    held.armed = false; held.noDmg = true;
    held = null; cv.classList.remove('grabbing');
  }
  const pool = availableSkills();
  if(pool.length === 0){
    // всё прокачано — вместо скилла чиним врата
    pendingLevels--;
    hp = Math.min(100, hp + 15); hpFill.style.width = hp + '%';
    floaties.push({x: MOUNTAIN_X, y: 200, txt: '+15 ВРАТАМ', life: 1.4, col: '#2f6e3c'});
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

// ── заклинания ─────────────────────────────────────────────────────
// индекс слота под точкой (или -1)
function slotAt(x, y){
  for(let i = 0; i < spellSlots.length; i++){
    const sx = SLOT_X + i*(SLOT + SLOT_GAP);
    if(x > sx && x < sx+SLOT && y > SLOT_Y && y < SLOT_Y+SLOT) return i;
  }
  return -1;
}

function castSpell(hs, vx, vy){
  const id = hs.id;
  if(id === 'lightning'){
    castLightning(hs.x, hs.y, vx, vy);
  } else if(id === 'boulder'){
    const B = CFG.spells.boulder;
    boulders.push({ x: hs.x, y: hs.y, vx: vx*B.throwF, vy: vy*B.throwF, rot: 0 });
    sfx.throw();
  } else if(id === 'wind'){
    castWind(vx, vy);
  }
}

// порыв ветра вдоль вектора броска (vx, vy)
function castWind(vx, vy){
  sfx.wind();
  shake = Math.max(shake, 5);
  const len = Math.hypot(vx, vy) || 1;
  const nx = vx/len, ny = vy/len; // направление броска (единичный вектор)
  const P = CFG.spells.wind.push;
  // визуальные потоки летят в ту же сторону
  for(let i = 0; i < 30; i++){
    const spd = rnd(700, 1100);
    windStreaks.push({
      x: rnd(0, W), y: rnd(40, GROUND_Y - 6),
      vx: nx*spd, vy: ny*spd, life: rnd(.35, .7),
    });
  }
  for(const d of demons){
    if(d.state === 'held' || d.state === 'offscreen') continue;
    if(TYPES[d.type].liftable === false){
      // неподъёмные не сдвигаются — просто замирают
      d.state = 'stun'; d.stun = Math.max(d.stun, CFG.spells.wind.stun);
      d.vx = d.vy = 0; d.rot = 0;
      continue;
    }
    d.state = 'fly';
    // лёгких сдувает сильнее тяжёлых
    const w = d.type === 'small' ? 1.4 : d.type === 'big' ? 0.8 : 1;
    d.vx = nx * P * w * rnd(.85, 1.15);
    d.vy = ny * P * w * rnd(.85, 1.15) - 120; // небольшой подброс, чтобы красиво летели
    d.rotV = rnd(-6, 6);
    // заряжаем как при броске рукой: впечатавшись в землю на скорости — получат урон
    d.armed = true; d.hitsLeft = sk('collide'); d.noDmg = false; d.grounded = false;
  }
  for(const c of cyclopes){
    c.freeze = Math.max(c.freeze, CFG.spells.wind.stun);
    floaties.push({x:c.x+CYC_W/2, y:c.y-24, txt:'ЗАМЕР!', life:1, col:'#1a1626'});
  }
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
    if(o.state === 'held' || o.flash > 0 || !demons.includes(o)) continue;
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
    if(o.state === 'held' || !demons.includes(o)) continue;
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
  const p = ptr(e);
  mouse.x = mouse.px = p.x; mouse.y = mouse.py = p.y;
  mouse.vx = mouse.vy = 0;
  // сперва слоты заклинаний
  const si = slotAt(p.x, p.y);
  if(si !== -1 && spellSlots[si].cd <= 0 && !held){
    heldSpell = { id: spellSlots[si].id, slot: si, x: p.x, y: p.y };
    cv.classList.add('grabbing');
    sfx.grab();
    e.preventDefault();
    return;
  }
  let best=null, bd=1e9;
  for(const d of demons){
    if(d.state==='held' || TYPES[d.type].liftable === false) continue;
    const s = sizeOf(d);
    const dist = Math.hypot(p.x-(d.x+s/2), p.y-(d.y+s/2));
    const gr = TYPES[d.type].grabR * (1 + CFG.skills.grip.mult * sk('grip'));
    if(dist < gr && dist < bd){ best=d; bd=dist; }
  }
  if(best){
    held = best; best.state='held'; best.rotV = 0;
    best.grounded = false; best.noDmg = false;
    best.swing = 0; best.walled = false;
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
      floaties.push({x:p.x, y:p.y-12, txt:'НЕ ПОДНЯТЬ!', life:1, col:'#1a1626'});
      sfx.thud();
    }
  }
}
function onMove(e){
  const p = ptr(e);
  mouse.x = p.x; mouse.y = p.y;
  if(held || heldSpell) e.preventDefault();
}
function onUp(){
  if(heldSpell){
    const sp = Math.hypot(mouse.vx, mouse.vy);
    if(sp >= CFG.spells.cancelSpeed){
      castSpell(heldSpell, mouse.vx, mouse.vy);
      spellSlots[heldSpell.slot].cd = CFG.spells[heldSpell.id].cd;
    } // иначе — просто вернулось в слот
    heldSpell = null;
    cv.classList.remove('grabbing');
    return;
  }
  if(held){
    const T = TYPES[held.type];
    held.state='fly';
    // скорость броска: курсор к моменту отпускания часто уже притормозил
    // (скорость мыши затухает за пару кадров) — если затухающий пик замаха
    // больше текущей скорости, бросаем по вектору пика, чтобы рывок не пропадал
    let vx = mouse.vx, vy = mouse.vy;
    if(held.swing > Math.hypot(vx, vy)){ vx = held.swingVX; vy = held.swingVY; }
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
  if(running && !choosing) update(dt);
  draw();
  requestAnimationFrame(loop);
}

function update(dt){
  // скорость курсора (сглаженная) — для бросков и ударов об землю
  mouse.vx = mouse.vx*0.55 + ((mouse.x-mouse.px)/dt)*0.45*0.9;
  mouse.vy = mouse.vy*0.55 + ((mouse.y-mouse.py)/dt)*0.45*0.9;
  mouse.px = mouse.x; mouse.py = mouse.y;

  // спавн по очереди текущей волны (см. CFG.waves)
  if(spawnQueue.length){
    spawnTimer -= dt;
    if(spawnTimer <= 0){
      // циклоп — мини-босс: пока он жив, его выход откладываем, но остальная
      // волна продолжает идти — выпускаем следующего НЕ-циклопа из очереди
      let idx = 0;
      if(spawnQueue[0] === 'cyclops' && cyclopes.length >= CFG.cyclops.maxAlive){
        idx = spawnQueue.findIndex(x => x !== 'cyclops');
      }
      if(idx === -1){
        spawnTimer = 0.8; // в очереди остались только циклопы — ждём смерти текущего
      } else {
        const t = spawnQueue.splice(idx, 1)[0];
        t === 'cyclops' ? spawnCyclops() : spawnDemon(t);
        spawnTimer = curEvery * rnd(.85, 1.15);
      }
    }
  } else {
    betweenTimer += dt;
    if(betweenTimer >= CFG.waves.pauseBetween){
      betweenTimer = 0;
      startWave(waveIdx + 1);
    }
  }

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
    if(d.state === 'walk'){
      d.x -= d.speed * dt;
      const hop = d.type==='big' ? 4 : 7;
      d.y = GROUND_Y - s - Math.abs(Math.sin(d.t*(d.type==='big'?5:7))) * hop;
      d.rot = Math.sin(d.t*7) * (d.type==='big' ? 0.1 : 0.18);
      if(d.x < MOUNTAIN_X) reachMountain(d);
    }
    else if(d.state === 'held'){
      const T = TYPES[d.type];
      // тянемся к курсору (тяжёлые — медленнее, отстают)
      const px0 = d.x; // позиция до шага — чтобы знать, с какой стороны подошли к стене
      const tx = mouse.x - s/2, ty = mouse.y - s/2;
      d.x += (tx - d.x) * Math.min(1, dt*T.follow);
      d.y += (ty - d.y) * Math.min(1, dt*T.follow);
      d.rot = Math.sin(d.t*14) * 0.45;

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
          if(dmg > 0){ hurt(d, dmg, d.swing); d.swing = 0; }
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
      d.vy += GRAV * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.rot += d.rotV * dt * 4;
      // улетел далеко вбок за экран — не гибнет, уходит «на возврат»
      const M = CFG.offscreen.margin;
      if(d.x > W + M || d.x + s < -M){
        d.state = 'offscreen';
        d.returnT = CFG.offscreen.returnDelay;
        d.armed = false; d.hitsLeft = 0;
        continue;
      }

      // ── столкновения с другими демонами: взаимный урон ──
      // открывается скиллом «Таран»; урон наносит только «заряженный» демон —
      // брошенный, не коснувшийся земли и с запасом жертв (hitsLeft)
      let spNow = Math.hypot(d.vx, d.vy);
      if(d.armed && d.hitsLeft > 0 && spNow >= SPD_LIGHT){
        for(const o of [...demons]){
          if(!demons.includes(d)) break;
          if(o===d || !demons.includes(o) || o.state==='held' || o.flash>0) continue;
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
            o.rotV = rnd(-4,4); o.grounded = false; o.armed = false; o.hitsLeft = 0;
          }
          hurt(d, dmgBack, rel);
          d.vx *= 0.55; d.vy *= 0.55;
          spNow = Math.hypot(d.vx, d.vy);
          d.hitsLeft--;
          if(d.hitsLeft <= 0) break;
        }
        if(!demons.includes(d)) continue;
      }

      // ── попадание в циклопа ──
      for(const c of cyclopes){
        if(d.x+s < c.x+CYC_PX || d.x > c.x+CYC_W-CYC_PX || d.y+s < c.y || d.y > c.y+CYC_H) continue;
        const sp3 = Math.hypot(d.vx, d.vy);
        const dEye = Math.hypot(d.x+s/2-(c.x+CYC_EYE.x), d.y+s/2-(c.y+CYC_EYE.y));
        if(d.armed && dEye < CYC_EYE.r + s*0.3 && sp3 >= SPD_LIGHT){
          // обмен ударами: моб наносит циклопу 1 урона и сам получает 1
          // (раньше урон считался по скорости, а моб разбивался о глаз насмерть)
          hitCyclops(c, 1);
          d.armed = false; // бросок «разряжен» — второй раз глаз не бьёт
          hurt(d, 1, sp3);
          if(demons.includes(d)){ // выжил — отлетает от глаза, как от корпуса
            const fromLeft = d.x+s/2 < c.x+CYC_W/2;
            d.x = fromLeft ? c.x - s + CYC_PX : c.x + CYC_W - CYC_PX;
            d.vx = (fromLeft ? -1 : 1) * Math.max(140, Math.abs(d.vx)*0.45);
            d.cycHit = 0.25;
          }
        } else if(d.cycHit <= 0){
          // корпус — демон отскакивает в сторону, урона нет.
          // НЕ толкаем вверх (иначе зависает в воздухе) и ставим таймер,
          // чтобы между двумя циклопами не было бесконечной болтанки и стука.
          const fromLeft = d.x+s/2 < c.x+CYC_W/2;
          d.x = fromLeft ? c.x - s + CYC_PX : c.x + CYC_W - CYC_PX;
          d.vx = (fromLeft ? -1 : 1) * Math.max(120, Math.abs(d.vx)*0.45);
          d.cycHit = 0.25;
          sfx.thud();
        }
        break;
      }
      if(!demons.includes(d)) continue;

      // ── стена замка: прилетел справа ниже кромки — стукается как об землю ──
      // (выше кромки — пролетает и может упасть уже в защищаемой зоне)
      if(d.x < WALL.x && d.y + s > WALL.top && px0 >= WALL.x){
        d.x = WALL.x;
        const sp = Math.hypot(d.vx, d.vy);
        const wasArmed = d.armed;
        d.armed = false; // о стену бросок «разряжается», как об пол
        const dmg = wasArmed ? impactDamage(sp) : 0;
        if(dmg > 0){
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
        const dmg = wasArmed ? impactDamage(sp) : 0;
        d.armed = false;
        d.rotV *= CFG.throwing.spinFloorDamp; // об пол вращение гасится
        if(wasArmed && sk('shockwave') > 0 && sp >= SPD_LIGHT){
          spawnShockwave(d.x + s/2, GROUND_Y, d);
        }
        if(dmg > 0){
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
      if(d.stun<=0){ d.state='walk'; }
    }
  }

  // ── заклинания: перезарядка и предмет в руке ──
  for(const s of spellSlots) if(s.cd > 0) s.cd -= dt;
  if(heldSpell){
    heldSpell.x += (mouse.x - heldSpell.x) * Math.min(1, dt*20);
    heldSpell.y += (mouse.y - heldSpell.y) * Math.min(1, dt*20);
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
    const spd = Math.hypot(bl.vx, bl.vy);
    // сбивает мобов
    for(const o of [...demons]){
      if(o.state==='held' || o.flash>0 || !demons.includes(o)) continue;
      const os = sizeOf(o);
      if(Math.hypot(o.x+os/2 - bl.x, o.y+os/2 - bl.y) < B.r + os*0.45){
        hurt(o, B.dmg, Math.max(spd, 400));
        if(demons.includes(o)){ // выжил — отлетает
          o.state='fly'; o.vx = bl.vx*0.6; o.vy = -150;
          o.armed = false; o.hitsLeft = 0; o.grounded = false;
        }
      }
    }
    // циклоп: в глаз — урон, в корпус — отскок
    let gone = false;
    for(const c of cyclopes){
      if(bl.x+B.r < c.x+CYC_PX || bl.x-B.r > c.x+CYC_W-CYC_PX || bl.y+B.r < c.y || bl.y-B.r > c.y+CYC_H) continue;
      const dEye = Math.hypot(bl.x-(c.x+CYC_EYE.x), bl.y-(c.y+CYC_EYE.y));
      if(dEye < CYC_EYE.r + B.r){
        hitCyclops(c, B.eyeDmg);
        crumbleBoulder(bl); gone = true;
      } else {
        bl.x = bl.x < c.x+CYC_W/2 ? c.x - B.r : c.x + CYC_W + B.r;
        bl.vx = -bl.vx*0.5;
        sfx.thud();
      }
      break;
    }
    if(gone) continue;
    // земля: отскок и качение (только при падении — из руки валун стартует ниже линии земли)
    if(bl.y + B.r >= GROUND_Y && bl.vy >= 0){
      bl.y = GROUND_Y - B.r;
      if(bl.vy > 140){ sfx.thud(); shake = Math.max(shake, 3); }
      bl.vy = -bl.vy * 0.3;
      bl.vx -= bl.vx * 1.2 * dt; // трение качения
    }
    // врата и правая стена — отскок
    if(bl.x < MOUNTAIN_X + 50){ bl.x = MOUNTAIN_X + 50; bl.vx = Math.abs(bl.vx)*0.5; }
    if(bl.x > W - B.r){ bl.x = W - B.r; bl.vx = -Math.abs(bl.vx)*0.5; }
    // остановился на поле — рассыпается и исчезает
    if(bl.y + B.r >= GROUND_Y - 2 && Math.abs(bl.vx) < B.crumbleSpd && Math.abs(bl.vy) < 60){
      crumbleBoulder(bl);
    }
  }

  // ── потоки ветра ──
  for(const ws of [...windStreaks]){
    ws.x += ws.vx*dt; ws.y += ws.vy*dt; ws.life -= dt;
    if(ws.life <= 0) windStreaks.splice(windStreaks.indexOf(ws),1);
  }

  // ── циклопы ──
  for(const c of [...cyclopes]){
    c.t += dt;
    if(c.eyeFlash > 0) c.eyeFlash -= dt;
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
        floaties.push({x:MOUNTAIN_X+40, y:GROUND_Y-170, txt:'-'+pd, life:1.2, col:'#c0392b'});
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
  for(const f of [...floaties]){
    f.y -= 40*dt; f.life -= dt*1.2;
    if(f.life<=0) floaties.splice(floaties.indexOf(f),1);
  }
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
  }
  if(!anyCloud){
    cx.strokeStyle = 'rgba(26,22,38,.25)'; cx.lineWidth = 2;
    drawCloud(430, 90); drawCloud(700, 140); drawCloud(260, 170);
  }

  // — гора/замок — прижат к земле, левый край у x=0.
  // Размер берётся из самой картинки, поэтому рисуй её 1:1 в нужных пикселях.
  if(art.castle){
    cx.drawImage(art.castle, 0, GROUND_Y - art.castle.height + CASTLE_SINK, art.castle.width, art.castle.height);
  } else {
    drawMountain();
  }

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
    cx.fillStyle = pl.col;
    cx.beginPath();
    cx.ellipse(pl.x, pl.y+3, pl.r, pl.r*0.32, 0, 0, Math.PI*2);
    cx.fill();
    cx.globalAlpha = Math.min(1, pl.life)*0.5;
    cx.beginPath();
    cx.ellipse(pl.x+pl.r*.5, pl.y+2, pl.r*.35, pl.r*.12, 0, 0, Math.PI*2);
    cx.fill();
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
    // полоска ХП
    cx.fillStyle = 'rgba(26,22,38,.8)';
    cx.fillRect(c.x, c.y-16, CYC_W, 7);
    cx.fillStyle = '#c0392b';
    cx.fillRect(c.x+1, c.y-15, (CYC_W-2)*Math.max(0, c.hp/CFG.cyclops.hp), 5);
    // замер от ветра
    if(c.freeze > 0){
      cx.fillStyle='#9adfe8'; cx.font='14px monospace';
      cx.fillText('✶', c.x+CYC_W/2-16, c.y-22);
      cx.fillText('✶', c.x+CYC_W/2+10, c.y-28);
      cx.font='10px monospace';
    }
  }

  for(const d of demons){
    if(d.state === 'offscreen') continue; // вне экрана — не рисуем
    const s = sizeOf(d);
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
    // полоска ХП здоровяка — показываем только если он уже ранен
    if(d.type==='big' && d.hp < TYPES.big.hp){
      const bw = s, bh = 4;
      cx.fillStyle = 'rgba(26,22,38,.8)';
      cx.fillRect(d.x, d.y-9, bw, bh);
      cx.fillStyle = '#c0392b';
      cx.fillRect(d.x+1, d.y-8, (bw-2)*(d.hp/TYPES.big.hp), bh-2);
    }
    if(d.state==='stun'){
      cx.fillStyle='#ffd76a'; cx.font='10px monospace';
      cx.fillText('✶', d.x+s/2-14, d.y-4);
      cx.fillText('✶', d.x+s/2+8, d.y-8);
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

  // потоки ветра — чёрточки вдоль направления порыва
  for(const ws of windStreaks){
    const m = Math.hypot(ws.vx, ws.vy) || 1;
    cx.globalAlpha = Math.max(0, ws.life)*0.7;
    cx.strokeStyle = '#cdeef4'; cx.lineWidth = 2;
    cx.beginPath();
    cx.moveTo(ws.x, ws.y);
    cx.lineTo(ws.x - ws.vx/m*30, ws.y - ws.vy/m*30);
    cx.stroke();
    cx.globalAlpha = 1;
  }

  for(const p of particles){
    cx.globalAlpha = Math.min(1,p.life*2);
    cx.fillStyle = p.col;
    cx.fillRect(p.x, p.y, p.size, p.size);
    cx.globalAlpha = 1;
  }

  cx.font = 'bold 16px monospace'; cx.textAlign='center';
  for(const f of floaties){
    cx.globalAlpha = Math.max(0,f.life);
    cx.fillStyle = f.col || '#1a1626';
    cx.fillText(f.txt, f.x, f.y);
    cx.globalAlpha = 1;
  }
  cx.textAlign='left';

  cx.restore();

  drawSpellUI();
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


// слоты заклинаний + предмет в руке (поверх всего, без тряски камеры)
function drawSpellUI(){
  const tNow = last * 0.001;
  cx.textAlign = 'center';
  cx.font = '10px monospace';
  cx.fillStyle = 'rgba(26,22,38,.65)';
  cx.fillText('ЗАКЛИНАНИЯ — ХВАТАЙ И БРОСАЙ', W/2, SLOT_Y - 8);
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
      cx.font = 'bold 16px monospace';
      cx.fillText(Math.ceil(s.cd), x+SLOT/2, y+SLOT/2+5);
      cx.font = '10px monospace';
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

// ── HUD / overlay ──────────────────────────────────────────────────
const scoreEl = document.getElementById('score');
const waveEl = document.getElementById('wave');
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

function start(){
  demons=[]; puddles=[]; particles=[]; floaties=[]; cyclopes=[]; shockwaves=[];
  bolts=[]; boulders=[]; windStreaks=[]; heldSpell=null; skyFlash=0;
  for(const s of spellSlots) s.cd = 0;
  score=0; hp=100; held=null; betweenTimer=0;
  player = { level: 1, xp: 0, xpNeed: CFG.leveling.baseXP, skills: {} };
  pendingLevels = 0; choosing = false;
  scoreEl.textContent='0'; hpFill.style.width='100%';
  updateXPBar();
  startWave(0);
  overlay.classList.add('hidden');
  lvlOverlay.classList.add('hidden');
  running = true;
}
function gameOver(){
  running = false; held = null; heldSpell = null;
  choosing = false; pendingLevels = 0;
  shake = 0; // игра остановилась — гасим тряску, иначе экран дёргается на экране поражения
  lvlOverlay.classList.add('hidden');
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
startBtn.addEventListener('click', start);

requestAnimationFrame(loop);
