import { getLines, DIALOGUE_CFG } from './dialogue.js';
import { art } from './assets.js';

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

// ── размеры подложки (натуральные пиксели спрайта; запас = реальные дим, пока грузится) ──
const sprW = () => art.dialogBox ? art.dialogBox.width  : 148;
const sprH = () => art.dialogBox ? art.dialogBox.height :  44;

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
}

// HTML-элемент текста: лежит ровно над текстовой зоной окна (внутри #wrap, который
// масштабируется вместе с холстом). CSS сам переносит строки по ширине и центрирует
// блок по вертикали (flex). Тень отключена (правило: вектор, без полупрозрачностей).
function buildTextEl(){
  if(textEl) return;
  const wrap = document.getElementById('wrap');
  if(!wrap) return;
  const c = DIALOGUE_CFG;
  const { bx, by } = boxGeom();
  const left   = bx + c.pad.left * c.scale;
  const top    = by + c.pad.top  * c.scale;
  const width  = (sprW() - c.pad.left - c.pad.right) * c.scale;
  const height = (sprH() - c.pad.top  - c.pad.bottom) * c.scale;
  textEl = document.createElement('div');
  textEl.style.cssText =
    'position:absolute; pointer-events:none; z-index:6; display:none;'+
    'left:'+left+'px; top:'+top+'px; width:'+width+'px; height:'+height+'px;'+
    'align-items:center; justify-content:flex-start;'+   // flex включаем при показе
    'font-family:'+FONT+'; font-size:'+c.fontPx+'px; line-height:'+c.lineHeight+';'+
    'color:'+c.color+'; text-shadow:none; word-break:break-word; overflow:hidden;';
  wrap.appendChild(textEl);
}
function showText(on){
  if(textEl) textEl.style.display = on ? 'flex' : 'none';
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
  if(shown < totalChars){
    shown = Math.min(totalChars, shown + DIALOGUE_CFG.charsPerSec * dt);
    syncText();
  }
}

// подготовить новую реплику к печати
function beginLine(){
  curText = lines[idx].text;
  totalChars = curText.length;
  shown = 0;
  syncText();
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

  // треугольник «дальше» справа внизу — только когда реплика допечатана; качается
  if(shown >= totalChars){
    const bob = (Math.sin(last*0.008) + 1) * 2;                 // 0..4 px вверх-вниз
    const tipX = bx + (sprW() - c.pad.right) * c.scale - 4;     // у правого края текстовой зоны
    const topY = by + bh - 16 - c.pad.bottom + bob;
    cx.fillStyle = c.color;
    cx.beginPath();
    cx.moveTo(tipX - 11, topY);
    cx.lineTo(tipX,      topY);
    cx.lineTo(tipX - 5.5, topY + 8);
    cx.closePath();
    cx.fill();
  }
}
