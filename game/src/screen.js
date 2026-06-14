// ────────────────────────────────────────────────────────────────────
// Масштабирование экрана.
// Игра всегда рисуется в «дизайнерском» разрешении холста (960×540, ровно 16:9).
// Здесь мы целиком масштабируем блок #wrap (холст + интерфейс + оверлеи)
// под размер окна, сохраняя пропорции. Пиксели остаются чёткими
// благодаря image-rendering:pixelated в стилях.
// Логику игры это не трогает — она ничего не знает про реальный размер на экране.
// ────────────────────────────────────────────────────────────────────

const wrap = document.getElementById('wrap');
const cv = document.getElementById('game');

// подгоняем масштаб под окно (берём минимум, чтобы влезло целиком, без обрезки)
function fit(){
  const w = window.innerWidth, h = window.innerHeight;
  // ВАЖНО: на itch (особенно мобильный) игра живёт во вложенном iframe, который
  // получает реальный размер уже ПОСЛЕ загрузки. Если в этот момент w/h ещё 0,
  // Math.min(0,0)=0 даст scale(0) — и вся игра схлопнется в чёрный экран навсегда
  // (события resize может и не прийти). Поэтому при нулевых размерах ничего не трогаем
  // (остаётся масштаб 1, игра видна), а как только размер появится — пересчитаем.
  if(!w || !h) return;
  const scale = Math.min(w / cv.width, h / cv.height);
  if(scale > 0) wrap.style.transform = `scale(${scale})`;
}
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', fit);
window.addEventListener('load', fit);
if(window.visualViewport) window.visualViewport.addEventListener('resize', fit);
document.addEventListener('fullscreenchange', fit);
// iframe на itch получает финальный размер позже первого кадра — ResizeObserver
// надёжно поймает это даже без события resize.
if(window.ResizeObserver){ try { new ResizeObserver(fit).observe(document.documentElement); } catch(e){} }
fit();
// добиваем несколько раз после загрузки — на случай позднего ресайза вложенного окна
requestAnimationFrame(fit);
setTimeout(fit, 100);
setTimeout(fit, 500);
setTimeout(fit, 1500);
// Полноэкранный режим — через встроенную кнопку itch.io (галка «Enable fullscreen button»).
