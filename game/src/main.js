// Точка входа. Пока просто запускает игру.
// Сюда позже добавится предзагрузка картинок/звуков перед стартом.
import './screen.js'; // масштабирование под окно + кнопка полного экрана
import { loadArt } from './assets.js';
import { preloadAudio } from './audio.js';
import './game.js';

// картинки стартового экрана — их грузит CSS как background, поэтому здесь импортируем
// те же файлы, чтобы дождаться их загрузки перед снятием загрузочного экрана.
import startBgUrl from '../assets/sprites/start-screen-blured.png';
import letterUrl  from '../assets/sprites/ui-start-screen-letter.png';

// подгружаем фоновые картинки из public/bg/ — появятся в кадре, как только готовы
loadArt();

// заранее декодируем звуковые сэмплы, чтобы первый же клик по кнопке играл тапом,
// а не запасным beep (контекст до первого жеста спит — это нормально)
preloadAudio();

// Заранее тянем пиксельный шрифт для канваса: браузер грузит вебшрифты лениво,
// и без этого первые надписи в игре рисовались бы запасным системным шрифтом.
// Канвас перерисовывается каждый кадр, так что как только шрифт готов — текст чёткий.
document.fonts.load('16px "Press Start 2P"');

// ── Загрузочный экран ──
// Прячем #boot, когда готовы шрифты заголовка/текста и обе картинки стартового экрана —
// иначе игрок на долю секунды видит «голую» раскладку без фона, письма и нужного шрифта.
// Гонка с таймаутом 5с: что бы ни залипло (медленный шрифт, картинка) — лоадер всё равно
// уйдёт, игра не зависнет на загрузочном экране.
function loadImg(src){
  return new Promise(res => { const i = new Image(); i.onload = i.onerror = () => res(); i.src = src; });
}
function hideBoot(){
  const boot = document.getElementById('boot');
  if(!boot) return;
  boot.classList.add('hide');
  setTimeout(() => boot.remove(), 600); // убрать из DOM после затухания (.5s в CSS)
}
const ready = Promise.all([
  document.fonts.load('1em "Metamorphous"'),
  document.fonts.load('1em "Press Start 2P"'),
  loadImg(startBgUrl),
  loadImg(letterUrl),
]);
const safety = new Promise(res => setTimeout(res, 5000));
Promise.race([ready, safety]).then(hideBoot);
