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
  const scale = Math.min(window.innerWidth / cv.width, window.innerHeight / cv.height);
  wrap.style.transform = `scale(${scale})`;
}
window.addEventListener('resize', fit);
document.addEventListener('fullscreenchange', fit);
fit();
// Полноэкранный режим — через встроенную кнопку itch.io (галка «Enable fullscreen button»).
