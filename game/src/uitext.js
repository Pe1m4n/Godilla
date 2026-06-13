// ────────────────────────────────────────────────────────────────────
// HTML-текст поверх холста.
//
// ПРАВИЛО ПРОЕКТА: любой читаемый игровой текст рисуем как HTML-элемент в этом
// слое, а НЕ через cx.fillText на холсте. Холст 960×540 растягивается на окно
// дробным множителем (см. screen.js), и текст, нарисованный на нём, мылится как
// растровая картинка. HTML — векторный шрифт, браузер масштабирует его резко при
// любом множителе (так же чёткий, как HUD).
//
// Слой лежит внутри #wrap и масштабируется вместе с холстом, поэтому координаты
// здесь — те же «дизайнерские» (0..960 / 0..540), что и в игровой логике.
//
// Два вида текста:
//   floatText(x,y,txt,col,life) — всплывашка (урон, очки): поднимается и гаснет,
//                                  сама удаляется. Замена прежним floaties.
//   label(id,x,y,txt,col,size)  — постоянная подпись по ключу (рог, и т.п.):
//                                  создаётся один раз, дальше обновляется; hideLabel(id) прячет.
// ────────────────────────────────────────────────────────────────────

const FONT = '"Press Start 2P", monospace';
const SHADOW = 'none';   // тень у всплывашек/подписей убрана; вернуть — '2px 2px 0 #0a0812'

// поведение всплывашек — те же числа, что были у floaties на холсте
const FLOAT_RISE = 40;   // px/сек вверх
const FLOAT_RATE = 1.2;  // скорость убывания life (life=1 → ~0.83с жизни)

let layer = null;
const labels = new Map();

export function initUIText(){
  if(layer) return;
  const wrap = document.getElementById('wrap');
  if(!wrap) return;
  layer = document.createElement('div');
  layer.style.cssText =
    'position:absolute; inset:0; overflow:hidden; pointer-events:none; z-index:5;';
  wrap.appendChild(layer);
}

// всплывающий текст: поднимается на FLOAT_RISE·время и гаснет в конце срока
export function floatText(x, y, txt, col = '#1a1626', life = 1){
  if(!layer) return;
  const dur = life / FLOAT_RATE;                 // сек жизни
  const rise = FLOAT_RISE * dur;                 // на сколько поднимется
  const fadeFrac = Math.min(1, (1/3) / life);    // последняя доля времени — угасание

  const el = document.createElement('div');
  el.textContent = txt;
  el.style.cssText =
    'position:absolute; left:'+x+'px; top:'+y+'px; white-space:nowrap;'+
    'font:16px '+FONT+'; color:'+col+'; text-shadow:'+SHADOW+';';
  layer.appendChild(el);

  const anim = el.animate([
    { transform:'translate(-50%,-50%) translateY(0)',          opacity:1, offset:0 },
    { opacity:1, offset: 1 - fadeFrac },
    { transform:'translate(-50%,-50%) translateY(-'+rise+'px)', opacity:0, offset:1 },
  ], { duration: dur*1000, easing:'linear', fill:'forwards' });
  anim.onfinish = () => el.remove();
}

// постоянная подпись по ключу: первый вызов создаёт элемент, дальше обновляет
export function label(id, x, y, txt, col = '#fffdf5', size = 12){
  if(!layer) return;
  let el = labels.get(id);
  if(!el){
    el = document.createElement('div');
    el.style.cssText =
      'position:absolute; white-space:nowrap; transform:translate(-50%,-50%);'+
      'text-shadow:'+SHADOW+';';
    layer.appendChild(el);
    labels.set(id, el);
  }
  el.style.left = x+'px';
  el.style.top  = y+'px';
  el.style.color = col;
  el.style.font = 'bold '+size+'px '+FONT;
  el.style.display = 'block';
  txt = String(txt);
  if(el.textContent !== txt) el.textContent = txt;
}

export function hideLabel(id){
  const el = labels.get(id);
  if(el) el.style.display = 'none';
}
