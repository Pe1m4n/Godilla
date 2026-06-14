// ────────────────────────────────────────────────────────────────────
// ЗВУК. Часть звуков — настоящие сэмплы (файлы в game/assets/sounds/),
// остальные пока синтезируются на лету через Web Audio (beep).
//
// Сэмплы проигрываются с ВАРИАЦИЯМИ: случайный питч (playbackRate), разброс
// громкости, выбор случайного варианта из нескольких файлов. Громкость/питч
// удара (slap) зависят от силы удара. Всё это крутится в блоке SFX_CFG ниже.
//
// Остальной код зовёт sfx.throw(), sfx.slap(), sfx.tap() и т.д. — менять
// вызовы не нужно, только тело здесь.
// ────────────────────────────────────────────────────────────────────

// ── НАСТРОЙКИ ЗВУКА (тюнинг тут) ───────────────────────────────────────
const SFX_CFG = {
  throw: { names: ['whoosh_1', 'whoosh_2'], vol: 0.55, pitchJitter: 0.12 }, // бросок: случайный вуш + разброс питча
  tap:   { name: 'finger-tap',              vol: 1.0,  pitchJitter: 0.08 }, // нажатие любой кнопки UI
  // печать текста диалога: тот же тап, но тише и со случайным питчем (каждые 3 буквы)
  type:  { name: 'finger-tap',              vol: 0.42, pitchJitter: 0.04, rateMin: 0.85, rateMax: 1.5 },
  lightning: { name: 'lightning', vol: 0.85, pitchJitter: 0.07, trim: 1.0 }, // разряд: стартуем с 1-й секунды файла
  tornado:   { name: 'wind',      vol: 1.2375, pitchJitter: 0.05, trim: 1.0, fadeOut: 2.0 }, // ветер: старт с 1с + огибающая
  // падение: случайный короткий крик из small/Shreak_*. Для мелких играется как есть,
  // для более тяжёлых юнитов вызывающий опускает playbackRate.
  falling:   { fallback: 'Falling', vol: 0.55, pitchJitter: 0, fadeIn: 0.01, fadeOut: 0.08 },
  // фитиль бомбера: шипит петлёй, пока моб жив (ping-pong средней части — без стыка)
  fuse:    { name: 'fuse',      vol: 0.4,  pitchJitter: 0.05, fadeIn: 0.05, fadeOut: 0.1,
             loopFrom: 0.12, loopTo: 0.88, pingpong: true },
  // взрыв бомбера при гибели (одиночный)
  explode: { name: 'explosion', vol: 0.7,  pitchJitter: 0.08 },
  // кровавый шмяк при гибели моба: случайный вариант из assets/sounds/Shmiak
  splat: { vol: 0.75, pitchJitter: 0.045 },
  // урон по мобу: случайный punch из assets/sounds/Punch
  hurt: { vol: 0.55, pitchJitter: 0.055 },
  // удар: несколько вариаций сэмпла (разный питч/тембр) — берём случайную, плюс
  // питч ещё подкручивается силой удара. Файлы уже обрезаны от тишины в начале.
  slap:  { names: ['slap_1', 'slap_2', 'slap_3', 'slap_4'],
           volMin: 0.18, volMax: 0.5,   // громкость от силы удара (приглушено)
           rateMax: 1.1, rateMin: 0.78, // питч: лёгкий удар выше, тяжёлый ниже
           refLo: 300, refHi: 1600,     // диапазон силы удара (скорость), на который мапим
           pitchJitter: 0.06 },
};
// ───────────────────────────────────────────────────────────────────────

// карта «имя файла без расширения» → адрес (Vite). Имя 478284__..._finger-tap-2_2
// длинное — даём ему короткий псевдоним 'finger-tap' для удобства в SFX_CFG.
const sndUrls = import.meta.glob('../assets/sounds/**/*.{wav,mp3,ogg}',
  { eager: true, query: '?url', import: 'default' });
const SND = {};
for (const [path, url] of Object.entries(sndUrls)) {
  const name = path.split('/').pop().replace(/\.[^.]+$/, '');
  SND[name] = url;
  const shmiakFile = path.match(/\/Shmiak\/(shmiak\d+\.wav)$/i)?.[1];
  if(shmiakFile) SND['Shmiak/' + shmiakFile] = url;
  const punchFile = path.match(/\/Punch\/(Punch_\d+\.wav)$/i)?.[1];
  if(punchFile) SND['Punch/' + punchFile] = url;
}
if (SND['478284__joao_janz__finger-tap-2_2']) SND['finger-tap'] = SND['478284__joao_janz__finger-tap-2_2'];
const SMALL_FALLING_NAMES = Object.keys(SND)
  .filter(name => /^Shreak_\d+$/i.test(name))
  .sort((a, b) => parseInt(a.replace(/\D+/g, ''), 10) - parseInt(b.replace(/\D+/g, ''), 10));
const SHMIAK_NAMES = Object.keys(SND)
  .filter(name => /^Shmiak\/shmiak\d+\.wav$/i.test(name))
  .sort((a, b) => parseInt(a.replace(/\D+/g, ''), 10) - parseInt(b.replace(/\D+/g, ''), 10));
const PUNCH_NAMES = Object.keys(SND)
  .filter(name => /^Punch\/Punch_\d+\.wav$/i.test(name))
  .sort((a, b) => parseInt(a.replace(/\D+/g, ''), 10) - parseInt(b.replace(/\D+/g, ''), 10));

let AC = null;
let muted = false;
let masterVol = 1;    // общий множитель громкости звуков (мастер-ползунок), 0..1
try { const s = localStorage.getItem('godilla.masterVol'); if(s !== null) masterVol = Math.max(0, Math.min(1, parseFloat(s) || 0)); } catch(e){}
try { muted = localStorage.getItem('godilla.sfxMuted') === '1'; } catch(e){}
const buffers = {};   // имя → декодированный AudioBuffer (заполняется асинхронно)
const loopBuffers = {}; // имя → предсобранный бесшовный буфер для петли (кэш)
let debugSink = null;

export function toggleMute(){ muted = !muted; return muted; }
export function setMuted(b){ muted = b; }           // мут звуков (отдельно от музыки)
export function isMuted(){ return muted; }
export function setMasterVolume(v){ masterVol = Math.max(0, Math.min(1, v)); } // мастер-громкость звуков
export function setSfxDebugSink(fn){ debugSink = typeof fn === 'function' ? fn : null; }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rnd = (a, b) => a + Math.random() * (b - a);

function debugSfx(kind, name, extra = ''){
  if(!debugSink) return;
  try{ debugSink({ kind, name, extra }); }catch(e){}
}

// общий аудио-контекст; создаётся лениво и сразу начинает грузить сэмплы.
// Резюмируем при каждом обращении — браузер держит контекст «спящим» до жеста.
function ctx(){
  if(!AC){
    try{ AC = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){ return null; }
    loadSamples();
  }
  if(AC.state === 'suspended') AC.resume().catch(() => {});
  return AC;
}

// Предзагрузка: создаём контекст и заранее декодируем сэмплы. Декодирование работает
// и на «спящем» контексте (жест не нужен), поэтому к первому клику по кнопке сэмпл
// тапа уже готов — играет он, а не запасной beep. Звук всё равно не зазвучит до
// первого жеста (браузер держит контекст спящим), но клик его и разбудит.
export function preloadAudio(){ ctx(); }

function loadSamples(){
  for(const [name, url] of Object.entries(SND)){
    if(buffers[name]) continue;
    fetch(url).then(r => r.arrayBuffer())
      .then(b => AC.decodeAudioData(b))
      .then(buf => { buffers[name] = buf; })
      .catch(() => {});
  }
}

// проиграть сэмпл по имени с заданными громкостью и питчем (+ необязательный разброс).
// Вернёт false, если выключен звук или сэмпл ещё не догрузился — тогда вызвавший
// может сыграть запасной beep.
function playSample(name, vol = 0.6, rate = 1, jitter = 0, trim = 0){
  if(muted) return false;
  const ac = ctx();
  if(!ac) return false;
  const buf = buffers[name];
  if(!buf) return false;
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = Math.max(0.05, rate * (1 + (jitter ? rnd(-jitter, jitter) : 0)));
  const g = ac.createGain();
  g.gain.value = vol * masterVol;
  src.connect(g).connect(ac.destination);
  // trim — сколько секунд отрезать из начала файла (тишина перед звуком)
  const off = clamp(trim, 0, Math.max(0, buf.duration - 0.02));
  src.start(0, off);
  return true;
}

function playFadedSample(name, {
  vol = 0.6,
  rate = 1,
  jitter = 0,
  fadeIn = 0.4,
  fadeOut = 0.4,
  trim = 0,
  loop = false,
} = {}){
  if(muted) return false;
  const ac = ctx();
  if(!ac) return false;
  const buf = buffers[name];
  if(!buf) return false;
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  src.playbackRate.value = Math.max(0.05, rate * (1 + (jitter ? rnd(-jitter, jitter) : 0)));
  const g = ac.createGain();
  const now = ac.currentTime;
  const dur = Math.max(0.02, fadeIn);
  const out = Math.max(0.02, fadeOut);
  const peak = vol * masterVol;
  g.gain.setValueAtTime(0.001, now);
  g.gain.linearRampToValueAtTime(Math.max(0.001, peak), now + dur);
  g.gain.linearRampToValueAtTime(0.001, now + dur + out);
  src.connect(g).connect(ac.destination);
  const off = clamp(trim, 0, Math.max(0, buf.duration - 0.05));
  src.start(now, off);
  src.stop(now + dur + out + 0.05);
  return true;
}

// строит PING-PONG буфер для петли: сегмент [fromFrac..toFrac] исходника проигрывается
// вперёд, затем задом наперёд (без дублей на концах). В обеих точках разворота соседние
// сэмплы совпадают по значению, поэтому петля бесшовна для любого материала. Кэшируется.
function getLoopBuffer(name, ac, fromFrac, toFrac){
  if(loopBuffers[name]) return loopBuffers[name];
  const buf = buffers[name];
  if(!buf) return null;
  const sr = buf.sampleRate, ch = buf.numberOfChannels;
  const start = Math.floor(buf.length * clamp(fromFrac, 0, 1));
  const end   = Math.floor(buf.length * clamp(toFrac, 0, 1));
  const N = end - start;
  if(N < 64) return null;
  const M = 2 * N - 2;                   // вперёд (N) + назад без концов (N-2)
  const out = ac.createBuffer(ch, M, sr);
  for(let c = 0; c < ch; c++){
    const inD = buf.getChannelData(c);
    const outD = out.getChannelData(c);
    for(let i = 0; i < N; i++) outD[i] = inD[start + i];              // вперёд: s[0..N-1]
    for(let i = 1; i < N - 1; i++) outD[N - 1 + i] = inD[start + N - 1 - i]; // назад: s[N-2..1]
  }
  loopBuffers[name] = out;
  return out;
}

function playLoopHandle(name, {
  vol = 0.6,
  rate = 1,
  jitter = 0,
  fadeIn = 0.05,
  fadeOut = 0.1,
  trim = 0,
  loopFrom = 0,   // доля файла, с которой начинается петля (0..1)
  loopTo = 0,     // доля файла, на которой петля заворачивается; 0 — петля по всему файлу
  pingpong = false, // true — бесшовная ping-pong петля среднего сегмента (вперёд+назад)
} = {}){
  if(muted) return null;
  const ac = ctx();
  if(!ac) return null;
  let buf = buffers[name];
  if(!buf) return null;
  // бесшовная петля: один раз строим ping-pong буфер сегмента и крутим его целиком
  let seamless = false;
  if(pingpong && loopTo > loopFrom){
    const lb = getLoopBuffer(name, ac, loopFrom, loopTo);
    if(lb){ buf = lb; seamless = true; }
  }
  const src = ac.createBufferSource();
  const g = ac.createGain();
  let stopped = false;
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = Math.max(0.05, rate * (1 + (jitter ? rnd(-jitter, jitter) : 0)));
  let startOff = clamp(trim, 0, Math.max(0, buf.duration - 0.05));
  if(seamless){
    startOff = 0;                 // весь буфер уже и есть бесшовная петля
  } else if(loopTo > loopFrom){   // запасной вариант: нативная петля по среднему сегменту
    src.loopStart = buf.duration * clamp(loopFrom, 0, 1);
    src.loopEnd   = buf.duration * clamp(loopTo, 0, 1);
    startOff = src.loopStart;
  }
  const now = ac.currentTime;
  const peak = vol * masterVol;
  g.gain.setValueAtTime(0.001, now);
  g.gain.linearRampToValueAtTime(Math.max(0.001, peak), now + Math.max(0.01, fadeIn));
  src.connect(g).connect(ac.destination);
  src.start(now, startOff);
  return {
    setRate(nextRate){
      if(stopped) return;
      const t = ac.currentTime;
      src.playbackRate.setTargetAtTime(Math.max(0.05, nextRate), t, 0.05);
    },
    stop(){
      if(stopped) return;
      stopped = true;
      const t = ac.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(Math.max(0.001, g.gain.value), t);
      g.gain.linearRampToValueAtTime(0.001, t + Math.max(0.02, fadeOut));
      try{ src.stop(t + Math.max(0.02, fadeOut) + 0.03); }catch(e){}
    },
  };
}

function playOneShotHandle(name, {
  vol = 0.6,
  level = 1,
  rate = 1,
  jitter = 0,
  fadeIn = 0.01,
  fadeOut = 0.08,
  trim = 0,
} = {}){
  if(muted) return null;
  const ac = ctx();
  if(!ac) return null;
  const buf = buffers[name];
  if(!buf) return null;
  const src = ac.createBufferSource();
  const g = ac.createGain();
  let stopped = false;
  src.buffer = buf;
  src.playbackRate.value = Math.max(0.05, rate * (1 + (jitter ? rnd(-jitter, jitter) : 0)));
  const now = ac.currentTime;
  const peak = vol * masterVol * clamp(level, 0, 1);
  g.gain.setValueAtTime(0.001, now);
  g.gain.linearRampToValueAtTime(Math.max(0.001, peak), now + Math.max(0.005, fadeIn));
  src.connect(g).connect(ac.destination);
  const off = clamp(trim, 0, Math.max(0, buf.duration - 0.02));
  src.start(now, off);
  src.onended = () => { stopped = true; };
  return {
    setRate(nextRate){
      if(stopped) return;
      const t = ac.currentTime;
      src.playbackRate.setTargetAtTime(Math.max(0.05, nextRate), t, 0.05);
    },
    setVolume(nextLevel){
      if(stopped) return;
      const t = ac.currentTime;
      g.gain.setTargetAtTime(Math.max(0.001, vol * masterVol * clamp(nextLevel, 0, 1)), t, 0.06);
    },
    stop(){
      if(stopped) return;
      stopped = true;
      const t = ac.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(Math.max(0.001, g.gain.value), t);
      g.gain.linearRampToValueAtTime(0.001, t + Math.max(0.02, fadeOut));
      try{ src.stop(t + Math.max(0.02, fadeOut) + 0.03); }catch(e){}
    },
  };
}

function beep(freq, dur, type = 'square', vol = 0.08){
  if(muted) return;
  const ac = ctx();
  if(!ac) return;
  try{
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol * masterVol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    o.connect(g).connect(ac.destination);
    o.start(); o.stop(ac.currentTime + dur);
  }catch(e){}
}

export const sfx = {
  // поднятие моба — тот же тап-сэмпл, что и на кнопках (finger-tap), с разбросом питча
  grab:  () => { const C = SFX_CFG.tap; if(!playSample(C.name, C.vol, 1, C.pitchJitter)) beep(620, .08, 'square'); },
  // бросок: случайный вариант вуша со сдвигом питча; пока сэмпл не готов — старый beep
  throw: () => {
    const C = SFX_CFG.throw;
    const name = C.names[(Math.random() * C.names.length) | 0];
    if(!playSample(name, C.vol, 1, C.pitchJitter)) beep(300, .12, 'sawtooth');
  },
  // удар мобом о землю: громкость и питч зависят от силы удара (скорости)
  slap: (strength = 0) => {
    const C = SFX_CFG.slap;
    const k = clamp((strength - C.refLo) / (C.refHi - C.refLo), 0, 1); // 0=лёгкий, 1=тяжёлый
    const vol  = C.volMin + (C.volMax - C.volMin) * k;
    const rate = C.rateMax + (C.rateMin - C.rateMax) * k; // чем сильнее, тем ниже
    const name = C.names[(Math.random() * C.names.length) | 0]; // случайная вариация
    if(playSample(name, vol, rate, C.pitchJitter)){
      debugSfx('mob slap', name, 'rate ' + rate.toFixed(2));
    } else {
      debugSfx('mob slap', 'fallback beep');
      beep(140, .12, 'sawtooth', .12);
    }
  },
  // нажатие кнопки в меню / в конце игры
  tap: () => {
    const C = SFX_CFG.tap;
    if(!playSample(C.name, C.vol, 1, C.pitchJitter)) beep(700, .05, 'square', .08);
  },
  // звук печати реплики: тап с разным питчем (зовётся каждые 3 буквы из dialogue-ui)
  type: () => {
    const C = SFX_CFG.type;
    const rate = C.rateMin + Math.random() * (C.rateMax - C.rateMin);
    if(!playSample(C.name, C.vol, rate, C.pitchJitter)) beep(700, .03, 'square', .04);
  },
  splat: () => {
    const C = SFX_CFG.splat;
    const name = SHMIAK_NAMES[(Math.random() * SHMIAK_NAMES.length) | 0];
    if(name && playSample(name, C.vol, 1, C.pitchJitter)){
      debugSfx('mob splat', name);
    } else {
      debugSfx('mob splat', 'fallback beep');
      beep(140, .18, 'sawtooth', .12); beep(90, .25, 'triangle', .1);
    }
  },
  hurt:  () => {
    const C = SFX_CFG.hurt;
    const name = PUNCH_NAMES[(Math.random() * PUNCH_NAMES.length) | 0];
    if(name && playSample(name, C.vol, 1, C.pitchJitter)){
      debugSfx('mob hurt', name);
    } else {
      debugSfx('mob hurt', 'fallback beep');
      beep(220, .1, 'sawtooth', .1);
    }
  },
  reach: () => beep(110, .3, 'square', .1),
  thud:  () => { debugSfx('mob thud', 'fallback beep'); beep(200, .06, 'triangle', .06); },
  zap:   () => {
    const C = SFX_CFG.lightning;
    if(!playSample(C.name, C.vol, 1, C.pitchJitter, C.trim)){
      beep(1400, .1, 'sawtooth', .07); beep(700, .18, 'square', .06);
    }
  },
  boom:  () => { beep(120, .25, 'sawtooth', .12); beep(60, .35, 'triangle', .1); },
  tornado: (duration = 0.5) => {
    const C = SFX_CFG.tornado;
    if(!playFadedSample(C.name, {
      vol: C.vol,
      rate: 1,
      jitter: C.pitchJitter,
      fadeIn: duration,
      fadeOut: C.fadeOut,
      trim: C.trim,
      loop: true,
    })){
      beep(500, .35, 'sine', .07); beep(320, .45, 'sine', .05);
    }
  },
  wind:  (duration) => sfx.tornado(duration),
  falling: (rate = 1, level = 1) => {
    const C = SFX_CFG.falling;
    const name = SMALL_FALLING_NAMES.length
      ? SMALL_FALLING_NAMES[(Math.random() * SMALL_FALLING_NAMES.length) | 0]
      : C.fallback;
    const handle = playOneShotHandle(name, {
      vol: C.vol,
      level,
      rate,
      jitter: C.pitchJitter,
      fadeIn: C.fadeIn,
      fadeOut: C.fadeOut,
    });
    if(handle) debugSfx('mob falling', name, 'rate ' + rate.toFixed(2));
    return handle;
  },
  // фитиль бомбера: возвращает хэндл петли ({setRate, stop}) — звучит, пока моб жив
  fuse: () => {
    const C = SFX_CFG.fuse;
    const handle = playLoopHandle(C.name, {
      vol: C.vol, rate: 1, jitter: C.pitchJitter,
      fadeIn: C.fadeIn, fadeOut: C.fadeOut,
      loopFrom: C.loopFrom, loopTo: C.loopTo, pingpong: C.pingpong,
    });
    if(handle) debugSfx('mob fuse', C.name);
    return handle;
  },
  // взрыв бомбера (одиночный сэмпл; если не догрузился — запасные beep как у boom)
  explode: () => {
    const C = SFX_CFG.explode;
    if(playSample(C.name, C.vol, 1, C.pitchJitter)){
      debugSfx('mob explode', C.name);
    } else {
      debugSfx('mob explode', 'fallback beep');
      beep(120, .25, 'sawtooth', .12); beep(60, .35, 'triangle', .1);
    }
  },
};
