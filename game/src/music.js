// ────────────────────────────────────────────────────────────────────
// МУЗЫКАЛЬНЫЙ КОНТРОЛЛЕР — единственное место, где живёт логика фоновой музыки.
// Файлы лежат в game/assets/music/ и подхватываются автоматически (по имени файла).
//
// Сценарий (его дёргает game.js — сам контроллер ничего не решает про игру):
//   • startGame()  — с начала партии играет ВСТУПИТЕЛЬНЫЙ трек (intro), зациклен.
//   • toCombat()   — кроссфейд: intro гаснет, БОЕВОЙ трек (combat) нарастает из тишины.
//                    Зовётся в момент появления первого «huge».
//   • onVictory()  — combat плавно гаснет, но НЕ в ноль, а до victoryFrac (20%) громкости.
//   • onDefeat()   — combat плавно гаснет в тишину.
//   • setMuted(b)  — глушит/возвращает музыку (кнопка звука).
//
// Все правки (какой трек где, громкости, длительности фейдов) — в блоке MUSIC_CFG ниже.
// ────────────────────────────────────────────────────────────────────

// ── НАСТРОЙКИ ──────────────────────────────────────────────────────────
// Имена треков — это имена файлов в assets/music/ БЕЗ расширения (регистр важен).
// Доступные файлы сейчас:
//   • maksymmalko-medieval-irish-celtic-ireland-music-311693
//   • Blackmoor Tides Loop
//   • Blackmoor Tides Loop (No Chants)   ← альтернатива боевого, без хора
export const MUSIC_CFG = {
  // true — играет ТОЛЬКО вступительный трек и звучит всю партию (переходы на боевой,
  // победный/проигрышный фейды отключены). false — вернётся полный сценарий ниже.
  onlyIntro: true,

  menu:    'desifreemusic-nordic-serenity-315546',                   // играет в главном меню / на экране конца
  intro:   'maksymmalko-medieval-irish-celtic-ireland-music-311693', // играет от старта до первого «huge»
  combat:  'Blackmoor Tides Loop',                                   // играет от первого «huge» до конца
  ambient: 'ambient_wind',                                           // фоновый шум ветра — всю партию поверх музыки

  menuVol:     0.35,  // громкость меню-трека (приглушённо)
  introVol:    0.7,   // громкость вступительного трека (0..1)
  combatVol:   0.7,   // громкость боевого трека (0..1)
  ambientVol:  0.3,   // громкость фонового ветра (0..1)
  victoryFrac: 0.2,   // на победе боевой трек приглушается до этой доли своей громкости (0.2 = 20%)

  fadeIn:  1.5,   // сек — нарастание трека из тишины
  fadeOut: 2.5,   // сек — затухание трека
  muteFade: 0.3,  // сек — скорость глушения/возврата по кнопке звука
};
// ───────────────────────────────────────────────────────────────────────

// все файлы из assets/music → карта «имя файла без расширения» → адрес (Vite сам хеширует).
// glob спокойно тянет имена с пробелами и скобками — не нужно их экранировать в import.
const urls = import.meta.glob('../assets/music/*.{mp3,wav,ogg}',
  { eager: true, query: '?url', import: 'default' });
const TRACKS = {};
for (const [path, url] of Object.entries(urls)) {
  const name = path.split('/').pop().replace(/\.[^.]+$/, '');
  TRACKS[name] = url;
}

const players  = {};   // имя трека → HTMLAudioElement (создаётся лениво)
const intended = {};   // имя трека → желаемая громкость БЕЗ учёта mute (0..1)
const slope    = {};   // имя трека → скорость текущего перехода (громкость/сек)
let muted = false;
let masterVol = 1;     // общий множитель громкости музыки (ползунок), 0..1
let raf = 0, lastT = 0;

const clamp01 = v => Math.max(0, Math.min(1, v));

// восстановить сохранённую громкость музыки
try { const s = localStorage.getItem('godilla.masterVol'); if(s !== null) masterVol = clamp01(parseFloat(s) || 0); } catch(e){}

// эффективная (реальная) громкость трека: цель × мастер, или 0 при муте
function effVol(name){ return muted ? 0 : (intended[name] || 0) * masterVol; }

// лениво создаём <audio> под трек: зациклен, начинается с нулевой громкости
function ensure(name) {
  if (players[name]) return players[name];
  const url = TRACKS[name];
  if (!url) { console.warn('[music] нет файла трека:', name, '— проверь имя в MUSIC_CFG'); return null; }
  const a = new Audio(url);
  a.loop = true; a.preload = 'auto'; a.volume = 0;
  players[name] = a;
  return a;
}

// плавно подвести трек к громкости vol за seconds секунд (0 = мгновенно)
function fadeTo(name, vol, seconds) {
  const a = ensure(name);
  if (!a) return;
  intended[name] = vol;
  const eff = effVol(name);
  slope[name] = seconds > 0 ? Math.max(1e-4, Math.abs(a.volume - eff) / seconds) : 1e9;
  if (eff > 0 && !muted) a.play().catch(() => {}); // вызвано из обработчика клика — жест есть
  startTick();
}

function startTick() { if (!raf) raf = requestAnimationFrame(tick); }

// единый цикл доводки громкостей к целям; сам себя гасит, когда все доехали
function tick(t) {
  const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
  lastT = t;
  let active = false;
  for (const name in intended) {
    const a = players[name];
    if (!a) continue;
    const eff = effVol(name);
    if (eff > 0 && a.paused) a.play().catch(() => {});
    if (Math.abs(a.volume - eff) > 0.002) {
      const dir = Math.sign(eff - a.volume);
      a.volume = clamp01(a.volume + dir * slope[name] * dt);
      active = true;
    } else {
      a.volume = eff;
      if (eff === 0 && !a.paused) a.pause(); // дошёл до тишины — снимаем с проигрывания
    }
  }
  if (active) raf = requestAnimationFrame(tick);
  else { raf = 0; lastT = 0; }
}

export const music = {
  // главное меню (и экран конца игры): зациклить меню-трек приглушённо, остальное — погасить
  menu() {
    const m = ensure(MUSIC_CFG.menu);
    fadeTo(MUSIC_CFG.intro, 0, MUSIC_CFG.fadeOut);
    fadeTo(MUSIC_CFG.combat, 0, MUSIC_CFG.fadeOut);
    fadeTo(MUSIC_CFG.ambient, 0, MUSIC_CFG.fadeOut);
    fadeTo(MUSIC_CFG.menu, MUSIC_CFG.menuVol, MUSIC_CFG.fadeIn);
    // если меню-трек ещё ни разу не играл — начнём с начала
    if (m && m.paused && m.currentTime === 0) m.currentTime = 0;
  },

  // клик «в игру»: меню-трек начинает плавно гаснуть прямо сейчас (до запуска партии).
  // Вступительный трек подхватится позже, в startGame() — «после этого».
  leaveMenu() {
    fadeTo(MUSIC_CFG.menu, 0, MUSIC_CFG.fadeOut);
  },

  // старт партии (и «Ещё раз»): меню-трек уводим в фейд, вступительный — с начала,
  // боевой — выключить, фоновый ветер — зациклить с начала и держать всю партию
  startGame() {
    fadeTo(MUSIC_CFG.menu, 0, MUSIC_CFG.fadeOut); // меню-трек плавно гаснет
    const intro = ensure(MUSIC_CFG.intro);
    const combat = players[MUSIC_CFG.combat];
    if (combat) { combat.pause(); combat.volume = 0; }
    intended[MUSIC_CFG.combat] = 0; slope[MUSIC_CFG.combat] = 1e9;
    if (intro) intro.currentTime = 0;
    fadeTo(MUSIC_CFG.intro, MUSIC_CFG.introVol, MUSIC_CFG.fadeIn);
    const ambient = ensure(MUSIC_CFG.ambient);
    if (ambient) ambient.currentTime = 0;
    fadeTo(MUSIC_CFG.ambient, MUSIC_CFG.ambientVol, MUSIC_CFG.fadeIn);
  },

  // появился первый «huge»: вступительный гаснет, боевой нарастает из тишины
  toCombat() {
    if (MUSIC_CFG.onlyIntro) return; // режим «только вступительный» — не переключаемся
    fadeTo(MUSIC_CFG.intro, 0, MUSIC_CFG.fadeOut);
    const combat = ensure(MUSIC_CFG.combat);
    if (combat) combat.currentTime = 0;
    fadeTo(MUSIC_CFG.combat, MUSIC_CFG.combatVol, MUSIC_CFG.fadeIn);
  },

  // победа: боевой трек приглушается до victoryFrac громкости (не в ноль)
  onVictory() {
    fadeTo(MUSIC_CFG.ambient, 0, MUSIC_CFG.fadeOut); // фоновый ветер всегда гаснет
    if (MUSIC_CFG.onlyIntro) return; // режим «только вступительный» — трек играет дальше
    fadeTo(MUSIC_CFG.combat, MUSIC_CFG.combatVol * MUSIC_CFG.victoryFrac, MUSIC_CFG.fadeOut);
    fadeTo(MUSIC_CFG.intro, 0, MUSIC_CFG.fadeOut);
  },

  // поражение: вся музыка плавно гаснет в тишину
  onDefeat() {
    fadeTo(MUSIC_CFG.ambient, 0, MUSIC_CFG.fadeOut); // фоновый ветер всегда гаснет
    if (MUSIC_CFG.onlyIntro) return; // режим «только вступительный» — трек играет дальше
    fadeTo(MUSIC_CFG.combat, 0, MUSIC_CFG.fadeOut);
    fadeTo(MUSIC_CFG.intro, 0, MUSIC_CFG.fadeOut);
  },

  // кнопка звука: глушим/возвращаем музыку, сохраняя намеченные громкости
  setMuted(m) {
    muted = m;
    for (const name in intended) {
      const a = players[name];
      if (!a) continue;
      const eff = effVol(name);
      slope[name] = Math.max(1e-4, Math.abs(a.volume - eff) / MUSIC_CFG.muteFade);
    }
    startTick();
  },

  // ползунок громкости музыки: общий множитель для всех треков (0..1), мгновенно
  setVolume(v) {
    masterVol = clamp01(v);
    try { localStorage.setItem('godilla.masterVol', String(masterVol)); } catch(e){}
    for (const name in intended) {
      const a = players[name];
      if (!a) continue;
      const eff = effVol(name);
      if (eff > 0 && !muted && a.paused) a.play().catch(() => {});
      a.volume = clamp01(eff);
      if (eff === 0 && !a.paused) a.pause();
    }
  },
  volume() { return masterVol; },
};

// Автоплей: браузер не даёт играть звук до первого «жеста» пользователя. На старте
// страницы menu() пытается завести меню-трек, но play() может быть отклонён. Ловим
// первый клик/нажатие клавиши и до-запускаем все треки, которые должны звучать.
function unlock(){
  for (const name in intended){
    const a = players[name];
    if (a && !muted && intended[name] > 0 && a.paused) a.play().catch(() => {});
  }
  startTick();
}
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);
