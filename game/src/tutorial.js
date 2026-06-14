import { CFG } from './config.js';
import { SPRITES } from './sprites.js';
import { art } from './assets.js';

// ────────────────────────────────────────────────────────────────────
// Обучающая сцена — отключаемый модуль (см. CFG.tutorial).
//
// Когда выходит первый моб, мир замирает, экран затемняется, моб подсвечивается
// поверх маски, к нему ведёт белая стрелка с подсказкой. Гаснет, как только игрок
// схватит моба.
//
// Это UI/логика обучения — отдельно от dialogue.js (там нарративные реплики ворона).
// Игровой код (game.js):
//   1) один раз отдаёт контекст отрисовки — initTutorial({cx,W,H,FONT,sizeOf})
//   2) в start() зовёт resetTutorial()
//   3) в цикле замораживает мир, пока tutorialActive()
//   4) при появлении первого моба зовёт tutorialOnFirstDemon(demons)
//   5) при захвате подсвеченного моба зовёт tutorialComplete()
//   6) в draw() рисует поверх всего: drawTutorial(demons, last)
// Сам захват моба (правка held и т.п.) остаётся в game.js — это игровая логика.
// ────────────────────────────────────────────────────────────────────

let cx, W, H, FONT, sizeOf; // контекст отрисовки, приходит из game.js
let active = false;   // мир заморожен, показываем затемнение и подсказку (первый моб)
let pending = false;  // обучение ещё не запускалось в этой партии
let demon = null;     // моб, которого подсвечиваем и на которого указываем
let textEl = null;    // HTML-подсказка поверх холста (см. ниже, почему не на холсте)

// Модальное обучающее сообщение: затемнение + текст по центру. Закрывается либо любым
// кликом (dismiss:'click'), либо когда игрок схватит цель (dismiss:'grab' — закрытие
// инициирует game.js, вызывая dismissTutorialMessage). Каждое сообщение показывается
// раз за партию (ключ в shownOnce). Подсветку «героя» сообщения (моб/циклоп/валун)
// рисует game.js — у него все спрайты и render-код.
let msgActive = false;       // показываем сообщение, мир заморожен
let msgKey = null;           // какое именно сообщение (game.js по нему подсвечивает)
let msgDismiss = 'click';    // 'click' — любой клик; 'grab' — захват цели (закрывает game.js)
let msgT = 0;                // сколько секунд сообщение на экране (для блокировки пропуска)
let actT = 0;                // сколько секунд показывается тутор первого моба (та же блокировка)
let enabledThisRun = true;   // включено ли обучение в этой партии
const shownOnce = new Set(); // какие одноразовые сообщения уже показывали
let msgEl = null, msgTitleEl = null, msgSubEl = null; // HTML-элемент сообщения и его строки

export function initTutorial(env){
  ({ cx, W, H, FONT, sizeOf } = env);
  buildTextEl(); buildMsgEl();
}

// Текст подсказки — отдельный HTML-элемент поверх холста, а НЕ на самом холсте.
// Холст 960×540 растягивается на окно дробным множителем (см. screen.js), и любой
// текст, нарисованный на нём, мылится как растровая картинка. HTML же — векторный
// шрифт, его браузер масштабирует резко при любом множителе (как HUD). Позиционируем
// в дизайн-координатах внутри #wrap — он масштабируется целиком вместе с холстом.
function buildTextEl(){
  if(textEl) return;
  const wrap = document.getElementById('wrap');
  if(!wrap) return;
  textEl = document.createElement('div');
  textEl.style.cssText =
    'position:absolute; left:0; right:0; top:'+Math.round(H*0.3)+'px;'+
    'text-align:center; pointer-events:none; z-index:5; display:none;'+
    'font-family:'+FONT+'; color:#fff7d2; line-height:1.6;'+
    'text-shadow:2px 2px 0 #0a0812;';
  const main = document.createElement('div');
  main.style.cssText = 'font-size:16px; max-width:760px; margin:0 auto; text-wrap:balance;';
  main.textContent = CFG.tutorial.text;
  textEl.appendChild(main);
  if(CFG.tutorial.text2){
    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:10px; color:#cfd2e6; margin:10px auto 0; max-width:680px; text-wrap:balance;';
    sub.textContent = CFG.tutorial.text2;
    textEl.appendChild(sub);
  }
  wrap.appendChild(textEl);
}
function showText(on){ if(textEl) textEl.style.display = on ? 'block' : 'none'; }

// Модальное сообщение по центру: заголовок + пояснение, переносится по строкам.
// Тоже HTML (тот же резон, что и подсказка). Текст задаётся при показе (showMessage),
// поэтому одно окно переиспользуется под разные подсказки (город, здоровяк, …).
function buildMsgEl(){
  if(msgEl) return;
  const wrap = document.getElementById('wrap');
  if(!wrap) return;
  msgEl = document.createElement('div');
  msgEl.style.cssText =
    'position:absolute; left:50%; top:40%; transform:translate(-50%,-50%);'+
    'width:600px; max-width:88%; text-align:center; pointer-events:none; z-index:5; display:none;'+
    'font-family:'+FONT+'; line-height:1.7; text-shadow:2px 2px 0 #0a0812;';
  msgTitleEl = document.createElement('div');
  // text-wrap:balance — браузер сам делит на ровные строки по реальной ширине шрифта,
  // без «слов-сирот» на отдельной строке (раньше жёсткий \n из splitTwoLines их плодил)
  msgTitleEl.style.cssText = 'font-size:13px; color:#ffe14d; text-wrap:balance;';
  msgEl.appendChild(msgTitleEl);
  msgSubEl = document.createElement('div');
  msgSubEl.style.cssText = 'font-size:9px; color:#cfd2e6; line-height:1.9; margin-top:18px; text-wrap:balance;';
  msgEl.appendChild(msgSubEl);
  wrap.appendChild(msgEl);
}
function showMsg(on){ if(msgEl) msgEl.style.display = on ? 'block' : 'none'; }

// сброс под новую партию (в start())
// enabled — включать ли обучение в этой партии. По умолчанию берём из конфига;
// отладочный старт «без диалогов и туторов» передаёт false и выключает обучение целиком.
export function resetTutorial(enabled = CFG.tutorial.enabled){
  enabledThisRun = enabled;
  pending = enabled; active = false; demon = null; showText(false);
  shownOnce.clear();
  msgActive = false; msgKey = null; showMsg(false);
}

export const tutorialActive = () => active;
// мир заморожен (подсказка про первого моба ИЛИ модальное сообщение)
export const tutorialFrozen    = () => active || msgActive;
export const tutorialMsgActive = () => msgActive;
export const tutorialMsgKey     = () => msgKey;     // game.js по нему рисует подсветку
export const tutorialMsgDismiss = () => msgDismiss; // 'click' | 'grab'
export const tutorialDemon      = () => demon;
// первые skipLock секунд по объекту нельзя кликнуть — защита от случайного нажатия
export const tutorialMsgLocked    = () => msgActive && msgT < (CFG.tutorial.skipLock ?? 0);
export const tutorialMsgTime      = () => msgT; // сколько секунд сообщение на экране
export const tutorialActiveLocked = () => active   && actT < (CFG.tutorial.skipLock ?? 0);

// тикает каждый кадр (даже на паузе) — копит время показа тутора/сообщения
export function tutorialTick(dt){
  if(msgActive) msgT += dt;
  if(active) actT += dt;
}

// Показать одноразовое модальное сообщение (раз за партию, по ключу). Замораживает мир.
// dismiss: 'click' — любой клик закрывает; 'grab' — закрытие делает game.js при захвате цели.
// true = показали; false = выключено / уже идёт обучение / уже показывали этот ключ.
export function tutorialTryMessage(key, title, sub, dismiss = 'click', top = '40%'){
  if(!enabledThisRun || active || msgActive || shownOnce.has(key)) return false;
  shownOnce.add(key);
  msgKey = key; msgDismiss = dismiss; msgT = 0;
  if(msgEl) msgEl.style.top = top; // по умолчанию по центру (40%); можно опустить ниже
  if(msgTitleEl) msgTitleEl.textContent = title || ''; // перенос — CSS text-wrap:balance
  if(msgSubEl){ msgSubEl.textContent = sub || ''; msgSubEl.style.display = sub ? 'block' : 'none'; }
  msgActive = true; showMsg(true);
  return true;
}
// закрыть модальное сообщение — мир оживает
export function dismissTutorialMessage(){
  if(!msgActive) return;
  msgActive = false; msgKey = null; showMsg(false);
}

// первый моб вышел — заморозить мир и взять его целью. true = обучение началось
export function tutorialOnFirstDemon(demons){
  if(!pending || !demons.length) return false;
  active = true; pending = false; demon = demons[0]; actT = 0; showText(true);
  return true;
}

// обучение пройдено (игрок схватил подсвеченного моба)
export function tutorialComplete(){ active = false; showText(false); }

// подсветка моба поверх маски: мягкое свечение + сам спрайт. Возвращает центр/размер.
function highlightDemon(d){
  const s = sizeOf(d);
  const mx = d.x + s/2, my = d.y + s/2;
  const glow = cx.createRadialGradient(mx, my, s*0.3, mx, my, s*1.7);
  glow.addColorStop(0, 'rgba(255,247,210,0.22)');
  glow.addColorStop(1, 'rgba(255,247,210,0)');
  cx.fillStyle = glow;
  cx.beginPath(); cx.arc(mx, my, s*1.7, 0, Math.PI*2); cx.fill();
  cx.save();
  cx.translate(mx, my);
  if(d.flip) cx.scale(-1, 1);
  cx.drawImage(SPRITES[d.type][d.pal], -s/2, -s/2, s, s);
  cx.restore();
  return { mx, my, s };
}

// тёмная маска под модальное сообщение (текст — HTML msgEl, подсветку «героя» рисует game.js)
export function drawTutorialMask(){
  cx.fillStyle = 'rgba(8,6,16,0.74)';
  cx.fillRect(0, 0, W, H);
}

// Тёмная маска на весь экран; поверх неё заново рисуем моба (так он подсвечен),
// к нему ведёт покачивающаяся белая стрелка, ниже — подсказка из CFG.tutorial.
export function drawTutorial(demons, last){
  // тёмная маска
  cx.fillStyle = 'rgba(8,6,16,0.74)';
  cx.fillRect(0, 0, W, H);

  const d = demon;
  if(!d || !demons.includes(d)) return;
  highlightDemon(d);

  // стрелка-спрайт arrow-right-down (↘): остриё (правый-нижний угол) у верх-лев угла
  // моба, сама стрелка смещена в верх-лево; покачивается по диагонали — «тычет» в моба
  const img = art.arrowRD;
  if(img){
    const sz = 31, bob = (Math.sin(last*0.006)+1) * 6;
    const tipX = d.x - bob, tipY = d.y - bob;
    cx.drawImage(img, Math.round(tipX - sz), Math.round(tipY - sz), sz, sz);
  }
  // текст-подсказка — это HTML-элемент textEl поверх холста (см. buildTextEl)
}
