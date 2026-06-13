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
const sndUrls = import.meta.glob('../assets/sounds/*.{wav,mp3,ogg}',
  { eager: true, query: '?url', import: 'default' });
const SND = {};
for (const [path, url] of Object.entries(sndUrls)) {
  const name = path.split('/').pop().replace(/\.[^.]+$/, '');
  SND[name] = url;
}
if (SND['478284__joao_janz__finger-tap-2_2']) SND['finger-tap'] = SND['478284__joao_janz__finger-tap-2_2'];

let AC = null;
let muted = false;
const buffers = {};   // имя → декодированный AudioBuffer (заполняется асинхронно)

export function toggleMute(){ muted = !muted; return muted; }
export function isMuted(){ return muted; }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rnd = (a, b) => a + Math.random() * (b - a);

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
  g.gain.value = vol;
  src.connect(g).connect(ac.destination);
  // trim — сколько секунд отрезать из начала файла (тишина перед звуком)
  const off = clamp(trim, 0, Math.max(0, buf.duration - 0.02));
  src.start(0, off);
  return true;
}

function beep(freq, dur, type = 'square', vol = 0.08){
  if(muted) return;
  const ac = ctx();
  if(!ac) return;
  try{
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    o.connect(g).connect(ac.destination);
    o.start(); o.stop(ac.currentTime + dur);
  }catch(e){}
}

export const sfx = {
  grab:  () => beep(620, .08, 'square'),
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
    if(!playSample(name, vol, rate, C.pitchJitter)){ beep(140, .12, 'sawtooth', .12); }
  },
  // нажатие кнопки в меню / в конце игры
  tap: () => {
    const C = SFX_CFG.tap;
    if(!playSample(C.name, C.vol, 1, C.pitchJitter)) beep(700, .05, 'square', .08);
  },
  splat: () => { beep(140, .18, 'sawtooth', .12); beep(90, .25, 'triangle', .1); },
  hurt:  () => { beep(220, .1, 'sawtooth', .1); },
  reach: () => beep(110, .3, 'square', .1),
  thud:  () => beep(200, .06, 'triangle', .06),
  zap:   () => { beep(1400, .1, 'sawtooth', .07); beep(700, .18, 'square', .06); },
  boom:  () => { beep(120, .25, 'sawtooth', .12); beep(60, .35, 'triangle', .1); },
  wind:  () => { beep(500, .35, 'sine', .07); beep(320, .45, 'sine', .05); },
};
