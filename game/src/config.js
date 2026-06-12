// ══════════════ КОНФИГ МОНСТРОВ И БАЛАНСА ══════════════
// Всё, что влияет на баланс, собрано здесь — правь смело.
export const CFG = {
  gravity: 1400,

  // Пороги урона от скорости удара (px/сек).
  // Работают для броска, падения и ударов об землю прямо в руке.
  // Высота падения учитывается сама собой: чем выше упал, тем больше скорость у земли.
  impact: {
    light: 520,   // медленнее — вообще без урона (раньше 300; теперь надо разогнать сильнее)
    med:   1000,  // 1 урон
    hard:  1550,  // 2 урона; быстрее этого и строго вниз — 3 урона
  },

  // Что происходит, когда моба зашвырнули далеко за край экрана вбок:
  // он не гибнет и не получает урон, а через returnDelay секунд заходит снова справа.
  offscreen: {
    margin: 60,        // на сколько px за край должен улететь, чтобы считаться «вне экрана»
    returnDelay: 5,    // через сколько секунд вернётся в бой
  },

  monsters: {
    //  px         — размер (множитель пиксельного спрайта 9x9)
    //  hp         — здоровье
    //  mtnDmg     — урон по вратам Асгарда, если дошёл
    //  speedMin/speedMax — скорость передвижения
    //  grabR      — радиус, в котором можно схватить мышкой
    //  score      — очки за убийство
    //  throwF     — «вес»: множитель скорости броска (меньше = тяжелее, тяни быстрее)
    //  follow     — как шустро тянется за курсором в руке
    //  liftable: false — моба нельзя поднять вообще (сейчас таких нет; великан тяжёлый, но поднимаемый)
    //  shakeHurt / shakeSplat — потолок тряски камеры при ранении / смерти
    small: { px: 2.5, hp: 1, mtnDmg: 10, speedMin: 30, speedMax: 48, grabR: 26, score: 1,
             throwF: 0.25,   follow: 22, shakeHurt: 6,  shakeSplat: 10 },
    big:   { px: 4,   hp: 3, mtnDmg: 20, speedMin: 18, speedMax: 28, grabR: 36, score: 3,
             throwF: 0.175,  follow: 14, shakeHurt: 10, shakeSplat: 16 },
    huge:  { px: 6,   hp: 5, mtnDmg: 30, speedMin: 10, speedMax: 16, grabR: 50, score: 5,
             throwF: 0.1125, follow: 8,  shakeHurt: 12, shakeSplat: 20 },
  },

  cyclops: {
    px: 9,            // масштаб спрайта (высота ≈ четверть экрана)
    maxAlive: 1,      // босс/мини-босс: больше одного на экране не появляется
    hp: 20,
    speed: 12,        // скорость передвижения
    mtnDmg: 25,       // урон по вратам за один удар
    poundEvery: 2,    // секунд между ударами по вратам
    score: 15,        // очки за убийство
    eyeDmgDiv: 900,   // урон в глаз = ХП моба × скорость / eyeDmgDiv (меньше = больнее)
    shakeStep: 2.5,   // тряска камеры: шаг при ходьбе
    shakeHit: 8,      //   попадание в глаз
    shakePound: 16,   //   удар по вратам
    shakeDeath: 20,   //   смерть
  },

  // ── бросок ──
  throwing: {
    spin: 0.004,          // скорость вращения от силы броска
    spinFloorDamp: 0.45,  // во сколько раз гаснет вращение при ударе об пол
  },

  // ── уровни игрока ──
  // Опыт за убийство = очки (score) монстра.
  leveling: {
    enabled: false, // прокачка пока выключена: опыт не копится, выбора скиллов нет
    baseXP: 10,    // сколько опыта нужно до 2-го уровня
    growth: 1.35,  // во сколько раз растёт требование с каждым уровнем
  },

  // ── заклинания (3 слота внизу экрана, применяются броском) ──
  spells: {
    slotSize: 56,       // размер квадратика-слота
    cancelSpeed: 150,   // отпустил медленнее — заклинание вернулось в слот
    lightning: {
      cd: 6,            // перезарядка, сек
      flash: 0.28,      // сколько секунд виден разряд (мгновенный удар, не снаряд)
      segLen: 20,       // длина одного звена зигзага, px
      jitter: 16,       // амплитуда излома молнии, px
      branchChance: 0.4,// вероятность ветки на каждом узле
      pierceDmg: 8,     // мощный точечный урон по линии разряда (великан = 5 HP — выносит)
      pierceR: 26,      // полуширина линии поражения
      boomDmg: 4,       // урон взрыва в точке удара о землю (добивает кучу у земли)
      boomR: 75,        // радиус взрыва
      eyeDmg: 8,        // урон циклопу при попадании разряда в глаз (босс 20 HP — 3 точных удара)
    },
    boulder: {
      cd: 8,
      throwF: 0.8,      // «вес» при броске
      gravMult: 1.8,    // тяжёлый — падает быстрее обычного
      r: 14,            // радиус валуна
      dmg: 2,           // урон мобу при контакте
      eyeDmg: 3,        // урон циклопу при попадании в глаз
      crumbleSpd: 70,   // катится медленнее — рассыпается и исчезает
    },
    wind: {
      cd: 10,
      push: 700,        // сила откидывания мобов вдоль вектора броска
      stun: 1.5,        // на сколько секунд замирают неподъёмные (huge и циклоп)
    },
  },

  // ── скиллы прокачки ──
  // max — сколько раз можно взять; requires — без какого скилла не выпадает
  skills: {
    collide:     { name:'Таран',           desc:'Брошенный демон наносит урон тому, в кого врезался. Уровень = сколько жертв за один бросок', max:4 },
    throwDmg:    { name:'Тяжёлая рука',    desc:'+1 урон от брошенных демонов: столкновения и глаз циклопа', max:2 },
    strongArm:   { name:'Могучий замах',   desc:'Броски на 15% сильнее — тяжёлых кидать легче', max:3, mult:0.15 },
    grip:        { name:'Цепкая хватка',   desc:'+30% к радиусу хватания демонов', max:2, mult:0.3 },
    armor:       { name:'Каменная кладка', desc:'Врата получают на 15% меньше урона', max:2, mult:0.15 },
    shockwave:   { name:'Взрывная волна',  desc:'Брошенный демон при падении бьёт волной по площади', max:1, dmg:1, radius:60 },
    shockRadius: { name:'Широкая волна',   desc:'+35 к радиусу взрывной волны', max:3, requires:'shockwave', add:35 },
    shockDmg:    { name:'Злая волна',      desc:'+1 урон взрывной волны', max:2, requires:'shockwave' },
  },

  // ── волны: сколько, каких мобов и в каком порядке идёт ──
  // every — интервал между выходами (сек); order — точная очередь выхода.
  // Когда список кончился, последняя волна повторяется по кругу,
  // ускоряясь на loopSpeedup за каждый повтор.
  waves: {
    pauseBetween: 2.5,   // передышка между волнами, сек
    speedPerWave: 3,     // прибавка скорости демонам за каждую волну
    loopSpeedup: 0.9,    // множитель интервала за каждый повтор последней волны
    minEvery: 0.45,      // чаще этого не спавнит
    list: [
      { every: 1.5, order: ['small','small','small','small','small','small','small'] },
      { every: 1.3, order: ['small','small','big','small','small','small','big','small','small'] },
      { every: 1.2, order: ['big','small','small','huge','small','small','big','small','small','big','small'] },
      { every: 1.0, order: ['small','small','cyclops','small','big','small','small','huge','small','big','small','small','big','small'] },
      { every: 0.85, order: ['huge','small','small','big','small','cyclops','small','small','huge','big','small','small','big','small','huge','small','small','big','small'] },
    ],
  },
};
// ═══════════════════════════════════════════════════════

// ── производные константы (чистая математика, без канваса) ──
export const GRAV = CFG.gravity;
export const TYPES = CFG.monsters;
export const SPD_LIGHT = CFG.impact.light;
export const SPD_MED   = CFG.impact.med;
export const SPD_HARD  = CFG.impact.hard;

// ── пиксельная карта демона (9 x 9) ───────────────────────────────
export const DEMON_MAP = [
  "..h...h..",
  "..h...h..",
  ".bbbbbbb.",
  ".bWbbbWb.",
  ".bbbmbbb.",
  "..bbbbb..",
  "...b.b...",
  "..bb.bb..",
  ".........",
];
// расцветки мелких
export const PALS_SMALL = [
  {b:'#8d2840', h:'#3c1020', W:'#ffe9a8', m:'#2a0a14'},
  {b:'#5b2a6e', h:'#2a1136', W:'#ffd0f0', m:'#1c0a26'},
  {b:'#314f8d', h:'#16233f', W:'#cfe6ff', m:'#0e1a30'},
  {b:'#2f6e3c', h:'#143019', W:'#dcffc9', m:'#0d2412'},
];
// расцветки здоровяков — темнее и злее
export const PALS_BIG = [
  {b:'#3d1f2e', h:'#c0392b', W:'#ff5c5c', m:'#120608'},
  {b:'#241a38', h:'#8d4fd1', W:'#d9a6ff', m:'#0c0716'},
];
// расцветки огромных — почти чёрные, с горящими глазами
export const PALS_HUGE = [
  {b:'#5e1212', h:'#1c0606', W:'#ffb347', m:'#140202'},
  {b:'#1f3d44', h:'#0a1b1f', W:'#9dfce0', m:'#061214'},
];
export const PALS = { small: PALS_SMALL, big: PALS_BIG, huge: PALS_HUGE };

// ── циклоп ─────────────────────────────────────────────────────────
// идёт боком (в профиль), глаз смотрит влево — в сторону врат
export const CYC_MAP = [
  "...hh.........",
  "..hh..........",
  "..bbbbbbbb....",
  ".bbbbbbbbbb...",
  ".bbbbbbbbbbb..",
  "WWWbbbbbbbbb..",
  "WeWbbbbbbbbbb.",
  "WWWbbbbbbbbbb.",
  ".bbbbbbbbbbbb.",
  ".mmmbbbbbbbbb.",
  ".bbbbbbbbbbbb.",
  "..bbbbbbbbbbb.",
  "..bbbbbbbbbb..",
  "...bbb...bbb..",
  "...bbb...bbb..",
  "..bbbb...bbbb.",
];
export const CYC_PAL = {b:'#4a3550', W:'#fff3d0', e:'#c0392b', m:'#1c0a26', h:'#d9b380'};
export const CYC_PX = CFG.cyclops.px;
export const CYC_W = CYC_MAP[0].length * CYC_PX;
export const CYC_H = CYC_MAP.length * CYC_PX;
// глаз — единственное уязвимое место (центр и радиус в координатах спрайта)
export const CYC_EYE = { x: 1.5*CYC_PX, y: 6.5*CYC_PX, r: 2*CYC_PX };

// ── заклинания: пиксельные иконки ──────────────────────────────────
export const SPELL_MAPS = {
  lightning: [
    "....ww...",
    "...www...",
    "..www....",
    ".wwwww...",
    "...www...",
    "..www....",
    ".www.....",
    ".ww......",
    "ww.......",
  ],
  boulder: [
    "..bbbb...",
    ".bBBbbb..",
    "bBBbbbbb.",
    "bBbbbbbb.",
    "bbbbbbbb.",
    "bbbbbbbb.",
    ".bbbbbb..",
    "..bbbb...",
    ".........",
  ],
  wind: [
    ".........",
    ".wwwww...",
    "......w..",
    "wwwwwww..",
    ".........",
    "..wwwwww.",
    ".......w.",
    "...wwww..",
    ".........",
  ],
};
export const SPELL_PALS = {
  lightning: {w:'#ffd000'},
  boulder:   {b:'#7e828c', B:'#b3b8c2'},
  wind:      {w:'#9adfe8'},
};
export const SPELL_NAMES = { lightning:'МОЛНИЯ', boulder:'ВАЛУН', wind:'ВЕТЕР' };
