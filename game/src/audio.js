// ────────────────────────────────────────────────────────────────────
// СЕЙЧАС звук синтезируется на лету через Web Audio (beep).
// Когда появятся настоящие звуки: кладёшь файлы в game/assets/sounds/,
// грузишь их в буферы и в объекте sfx меняешь тело каждой функции
// на проигрывание нужного файла. Остальной код зовёт sfx.grab(),
// sfx.splat() и т.д. — эти вызовы менять не нужно.
// ────────────────────────────────────────────────────────────────────

let AC = null;
function beep(freq, dur, type = 'square', vol = 0.08){
  try{
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
    o.connect(g).connect(AC.destination);
    o.start(); o.stop(AC.currentTime + dur);
  }catch(e){}
}

export const sfx = {
  grab:  () => beep(620, .08, 'square'),
  throw: () => beep(300, .12, 'sawtooth'),
  splat: () => { beep(140, .18, 'sawtooth', .12); beep(90, .25, 'triangle', .1); },
  hurt:  () => { beep(220, .1, 'sawtooth', .1); },
  reach: () => beep(110, .3, 'square', .1),
  thud:  () => beep(200, .06, 'triangle', .06),
  zap:   () => { beep(1400, .1, 'sawtooth', .07); beep(700, .18, 'square', .06); },
  boom:  () => { beep(120, .25, 'sawtooth', .12); beep(60, .35, 'triangle', .1); },
  wind:  () => { beep(500, .35, 'sine', .07); beep(320, .45, 'sine', .05); },
};
