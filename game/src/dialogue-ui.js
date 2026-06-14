import { getLines, DIALOGUE_CFG } from './dialogue.js';
import { art } from './assets.js';
import { sfx } from './audio.js';

// ────────────────────────────────────────────────────────────────────
// ОКНО ДИАЛОГА — рантайм и отрисовка (текст реплик лежит в dialogue.js).
//
// Поведение:
//   • Пока идёт диалог — мир на паузе (БЕЗ затемнения, в отличие от обучения).
//   • Текст печатается посимвольно, довольно быстро (скорость в DIALOGUE_CFG).
//   • 1-й клик мышью — мгновенно допечатать текущую реплику.
//   • Повторный клик (когда уже допечатано) — следующая реплика.
//   • Справа внизу окна качается треугольник «нажми, чтобы продолжить».
//   • Кончились реплики — диалог закрывается, мир оживает (дальше включается
//     обучение, см. tutorial.js).
//
// ТЕКСТ — HTML-элемент поверх холста, а НЕ на холсте (правило проекта, см.
// Godilla/CLAUDE.md и uitext.js): холст 960×540 растягивается дробным множителем,
// и любой текст на нём мылится. HTML — векторный шрифт, режется резко при любом
// масштабе. Перенос строк и вертикальное центрирование делает сам CSS.
// Подложка-спрайт и треугольник — на холсте (это не читаемый текст).
//
// Связь с game.js (как у tutorial.js):
//   1) один раз: initDialogue({cx, W, H, FONT})
//   2) в start(): startDialogue('intro')
//   3) в цикле: updateDialogue(dt) + замораживать мир, пока dialogueActive()
//   4) клик мыши: если dialogueActive() — отдать клик в dialogueClick()
//   5) в draw(): drawDialogue(last)
// ────────────────────────────────────────────────────────────────────

let cx, W, H, FONT;        // контекст отрисовки, приходит из game.js
let active = false;        // идёт ли диалог (мир на паузе)
let lines = [];            // очередь реплик текущей группы (имена уже подставлены)
let idx = 0;               // индекс текущей реплики
let curText = '';          // полный текст текущей реплики
let totalChars = 0;        // длина текущей реплики (символов)
let shown = 0;             // сколько уже «напечатано» (дробное — растёт по времени)
let textEl = null;         // HTML-элемент с текстом реплики (см. buildTextEl)
let nameEl = null;         // HTML-элемент с именем говорящего у портрета

// ── подскоки ворона «прыг-прыг» в начале каждой реплики ──
// hop — вертикальное смещение (px, минус = вверх), hopV — его скорость (пружина).
// В начале реплики даём crow.hops толчков вверх с паузой crow.hopGap, потом ворон
// плавно оседает к нулю. От печати/букв НЕ зависит.
let hop = 0, hopV = 0, hopKicksLeft = 0, hopKickT = 0;
const HOP_STIFF = 200;     // жёсткость пружины (выше — быстрее возврат)
const HOP_DAMP  = 13;      // затухание (выше — меньше дрожит)

// ── размеры подложки (натуральные пиксели спрайта; запас = реальные дим, пока грузится) ──
const sprW = () => art.dialogBox ? art.dialogBox.width  : 432;
const sprH = () => art.dialogBox ? art.dialogBox.height :  88;

// геометрия окна в «дизайнерских» координатах (0..960 / 0..540)
function boxGeom(){
  const c = DIALOGUE_CFG;
  const bw = sprW() * c.scale, bh = sprH() * c.scale;
  const bx = Math.round((W - bw) / 2);
  const by = Math.round(H - bh - c.marginBottom);
  return { bx, by, bw, bh };
}

export function initDialogue(env){
  ({ cx, W, H, FONT } = env);
  buildTextEl();
  buildNameEl();
}

// HTML-элемент текста: лежит ровно над текстовой зоной окна (внутри #wrap, который
// масштабируется вместе с холстом). CSS сам переносит строки по ширине и центрирует
// блок по вертикали (flex). Тень отключена (правило: вектор, без полупрозрачностей).
function buildTextEl(){
  if(textEl) return;
  const wrap = document.getElementById('wrap');
  if(!wrap) return;
  const c = DIALOGUE_CFG;
  textEl = document.createElement('div');
  // align-items:flex-start — текст прижат к верху зарезервированного блока, поэтому
  // первая строка стоит на месте, а вторая дописывается под ней (не прыгает вверх).
  textEl.style.cssText =
    'position:absolute; pointer-events:none; z-index:6; display:none;'+
    'align-items:flex-start; justify-content:flex-start;'+
    'font-family:'+FONT+'; font-size:'+c.fontPx+'px; line-height:'+c.lineHeight+';'+
    'color:'+c.color+'; text-shadow:none; word-break:break-word; overflow:hidden;';
  wrap.appendChild(textEl);
  positionTextEl();
}

// Имя говорящего у портрета — HTML, с тенью (сдвиг на целый пиксель, без полупрозрачности).
function buildNameEl(){
  if(nameEl) return;
  const wrap = document.getElementById('wrap');
  if(!wrap) return;
  const c = DIALOGUE_CFG;
  nameEl = document.createElement('div');
  nameEl.style.cssText =
    'position:absolute; pointer-events:none; z-index:6; display:none; white-space:nowrap;'+
    'transform:translate(-50%,-50%); font-family:'+FONT+'; font-size:'+c.name.size+'px;'+
    'color:'+c.name.color+'; text-shadow:2px 2px 0 #1c140e;';
  wrap.appendChild(nameEl);
  positionTextEl();
}

// Поставить текст и имя по окну. Зовём при старте диалога — к этому моменту спрайт
// уже загружен, и геометрия считается по его РЕАЛЬНЫМ размерам (на init картинки
// ещё может не быть — тогда взялись бы запасные дим).
function positionTextEl(){
  const c = DIALOGUE_CFG;
  const { bx, by } = boxGeom();
  if(textEl){
    // блок резервируем под maxLines строк и центрируем по вертикали ОДИН раз —
    // тогда печать не сдвигает уже написанное при переходе на новую строку
    const innerTop = by + c.pad.top * c.scale;
    const innerH   = (sprH() - c.pad.top - c.pad.bottom) * c.scale;
    const blockH   = c.maxLines * c.fontPx * c.lineHeight;
    textEl.style.left   = (bx + c.pad.left * c.scale) + 'px';
    textEl.style.top    = (innerTop + Math.max(0, (innerH - blockH) / 2)) + 'px';
    textEl.style.width  = ((sprW() - c.pad.left - c.pad.right) * c.scale) + 'px';
    textEl.style.height = blockH + 'px';
  }
  if(nameEl){
    nameEl.style.left = (bx + c.name.cx * c.scale) + 'px';
    nameEl.style.top  = (by + c.name.cy * c.scale) + 'px';
  }
}
function showText(on){
  if(textEl) textEl.style.display = on ? 'flex' : 'none';
  if(nameEl) nameEl.style.display = (on && DIALOGUE_CFG.name.show) ? 'block' : 'none';
}
// показать на экране ровно столько символов, сколько уже «напечатано»
function syncText(){
  if(!textEl) return;
  const vis = curText.slice(0, Math.floor(shown));
  if(textEl.textContent !== vis) textEl.textContent = vis;
}

export const dialogueActive = () => active;

// Запустить группу реплик по ключу (например 'intro'). Если диалоги выключены
// тумблером или группа пустая — ничего не показываем и мир сразу идёт дальше.
export function startDialogue(key){
  if(!DIALOGUE_CFG.enabled) return false;
  const ls = getLines(key);
  if(!ls.length) return false;
  lines = ls; idx = 0; active = true;
  positionTextEl();   // спрайт уже загружен — ставим по его реальным размерам
  showText(true);
  beginLine();
  return true;
}

// Клик мыши во время диалога: сперва — допечатать, потом — следующая реплика.
export function dialogueClick(){
  if(!active) return;
  if(shown < totalChars){ shown = totalChars; syncText(); return; } // 1-й клик — дописать
  idx++;                                                            // иначе — дальше
  if(idx >= lines.length){ active = false; lines = []; showText(false); return; }
  beginLine();
}

// Печать текущей реплики во времени (зовётся каждый кадр, пока active).
export function updateDialogue(dt){
  if(!active) return;
  const c = DIALOGUE_CFG;
  if(shown < totalChars){
    const prev = shown;
    shown = Math.min(totalChars, shown + c.charsPerSec * dt);
    syncText();
    // звук печати: тап со случайным питчем каждые 3 напечатанных символа
    if(Math.floor(shown / 3) > Math.floor(prev / 3)) sfx.type();
  }
  // подскоки «прыг-прыг» в начале реплики: пускаем crow.hops толчков с паузой hopGap
  if(hopKicksLeft > 0){
    hopKickT -= dt;
    if(hopKickT <= 0){
      hopV -= c.crow.hopAmp * Math.sqrt(HOP_STIFF); // толчок под нужную высоту прыжка
      hopKicksLeft--;
      hopKickT = c.crow.hopGap;
    }
  }
  // пружина (всегда, пока активен) — между и после толчков ворон плавно оседает к нулю
  hopV += (-HOP_STIFF * hop - HOP_DAMP * hopV) * dt;
  hop  += hopV * dt;
}

// подготовить новую реплику к печати
function beginLine(){
  curText = lines[idx].text;
  totalChars = curText.length;
  shown = 0;
  hop = 0; hopV = 0; hopKicksLeft = DIALOGUE_CFG.crow.hops; hopKickT = 0; // запустить «прыг-прыг»
  syncText();
  if(nameEl) nameEl.textContent = lines[idx].name; // имя говорящего у портрета
}

// ── отрисовка подложки и треугольника (текст — отдельный HTML-элемент) ──
export function drawDialogue(last){
  if(!active) return;
  const c = DIALOGUE_CFG;
  const { bx, by, bw, bh } = boxGeom();

  // подложка-спрайт (пока не загружена — простая рамка, чтобы окно было видно)
  if(art.dialogBox){
    cx.drawImage(art.dialogBox, bx, by, bw, bh);
  } else {
    cx.fillStyle = 'rgba(20,16,30,0.92)'; cx.fillRect(bx, by, bw, bh);
    cx.strokeStyle = '#e8dcc0'; cx.lineWidth = 2; cx.strokeRect(bx+2, by+2, bw-4, bh-4);
  }

  // портрет говорящего поверх пустой рамки. Ворон подскакивает и кренится на печать
  // (hop/hopV); прочие портреты (Тор) стоят неподвижно.
  const portraitKey = lines[idx]?.portrait ?? 'crow';
  const portrait = art[portraitKey] || art.crow;
  if(portrait){
    const cr = c.crow;
    const isCrow = portraitKey === 'crow';
    // ворон рисуется в рамке 30×30 (×2 от 15×15) и прыгает; прочие портреты (Тор) —
    // в натуральную величину × portraitScale (нарисованы под нужный масштаб), без прыжка.
    const ps = c.portraitScale ?? 1;
    const pw = (isCrow ? cr.w : portrait.width  * ps) * c.scale;
    const ph = (isCrow ? cr.h : portrait.height * ps) * c.scale;
    const off = isCrow ? hop * c.scale : (c.portraitOffsetY ?? 0) * c.scale;
    const cwx = bx + (cr.x + cr.w / 2) * c.scale;          // центр места портрета
    const cwy = by + (cr.y + cr.h / 2) * c.scale + off;
    const rot = isCrow ? Math.max(-cr.rotAmp, Math.min(cr.rotAmp, hopV * cr.rotAmp / 110)) : 0;
    cx.save();
    cx.translate(cwx, cwy);
    cx.rotate(rot);
    cx.drawImage(portrait, -pw / 2, -ph / 2, pw, ph);
    cx.restore();
  }

  // спрайт-треугольник «дальше» справа внизу — только когда реплика допечатана; качается
  if(shown >= totalChars && art.triangle){
    const bob = (Math.sin(last*0.008) + 1) * 2;                 // 0..4 px вверх-вниз
    const tw = art.triangle.width  * c.scale;
    const th = art.triangle.height * c.scale;
    const tx = bx + (sprW() - c.pad.right) * c.scale - tw;      // у правого края текстовой зоны
    const ty = by + bh - c.pad.bottom * c.scale - th - 12 + bob; // -12 px: чуть выше
    cx.drawImage(art.triangle, tx, ty, tw, th);
  }
}
