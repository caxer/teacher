// 首次開啟的瀏覽器指引：LINE 等 App 內建瀏覽器無法加到主畫面，先請使用者改用 Safari／瀏覽器；
// 手機瀏覽器第一次用連結登入後，提示怎麼加到主畫面。
const $ = id => document.getElementById(id);
const IN_APP = [
  [/\bLine\//i, 'LINE'], [/Instagram/i, 'Instagram'], [/MessengerForiOS|FBAN\/Messenger|\bOrca-Android\b/i, 'Messenger'],
  [/FBAN|FBAV|FB_IAB/i, 'Facebook'], [/MicroMessenger/i, '微信'], [/Barcelona/i, 'Threads'],
  [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok'],
];
const EXTERNAL = 'openExternalBrowser';
const NOTICED = 'inapp-noticed';
// 第一次回傳 true；無法記住時每次都 true。
function markNoticed() {
  try { if (localStorage.getItem(NOTICED)) return false; localStorage.setItem(NOTICED, '1'); } catch { /* 無法記住 */ }
  return true;
}

/** 判斷目前的瀏覽器；app 是內建瀏覽器的 App 名稱，一般瀏覽器為空字串。 */
export function browserInfo(ua = navigator.userAgent, {
  touch = navigator.maxTouchPoints > 1,
  standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches,
} = {}) {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch);
  const android = /Android/.test(ua);
  if (standalone || (!ios && !android)) return { ios, android, standalone, app: '' };
  let app = IN_APP.find(([pattern]) => pattern.test(ua))?.[1] || '';
  // 其他 App 的 WebView：Android 帶 "; wv)"，iOS 沒有 Safari 字樣。
  if (!app && (android ? /; wv\)/.test(ua) : !/Safari\//.test(ua))) app = 'App';
  return { ios, android, standalone: false, app };
}

/** LINE 認得 ?openExternalBrowser=1，會改用系統預設瀏覽器開啟（保留 #k=）。 */
export function externalUrl(href) {
  const url = new URL(href);
  url.searchParams.set(EXTERNAL, '1');
  return url.href;
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const area = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.append(area); area.select();
    try { return document.execCommand('copy'); } catch { return false; } finally { area.remove(); }
  }
}

function copyButton(button, text, done) {
  const label = button.textContent;
  button.onclick = async () => {
    button.textContent = await copy(text) ? done : '無法複製，請長按網址列複製';
    setTimeout(() => { button.textContent = label; }, 4000);
  };
}

/** 外部瀏覽器開啟後拿掉 LINE 的參數，不影響 #k=。 */
export function cleanExternalParam() {
  const url = new URL(location.href);
  if (!url.searchParams.has(EXTERNAL)) return;
  url.searchParams.delete(EXTERNAL);
  try { history.replaceState(history.state, '', url.pathname + url.search + url.hash); } catch { /* 留著也無妨 */ }
}

/**
 * 內建瀏覽器帶著專屬連結開啟時，先不讀金鑰，顯示改用瀏覽器的卡片。
 * 使用者選「先在這裡使用」才 resolve；改用瀏覽器開啟時這一頁就停在卡片。
 */
export function guideInApp(info) {
  const browser = info.ios ? 'Safari' : '瀏覽器', line = info.app === 'LINE';
  const name = info.app === 'App' ? '這個 App' : info.app;
  markNoticed();
  $('login-main').hidden = true;
  $('login-inapp').hidden = false;
  $('inapp-title').textContent = `請用 ${browser} 開啟`;
  $('inapp-note').textContent = line ? `${name} 內無法加到主畫面。` : `${name} 內無法加到主畫面。點右上角 ⋯ 選「用${browser}開啟」。`;
  const open = $('inapp-open'), copyLink = $('inapp-copy');
  open.hidden = !line;
  open.textContent = `用 ${browser} 開啟`;
  open.onclick = () => { location.href = externalUrl(location.href); };
  copyLink.className = line ? 'text-button' : 'login-primary';
  copyButton(copyLink, location.href, `已複製，到 ${browser} 貼上網址`);
  // LINE 直接轉去外部瀏覽器；回到這一頁（已帶參數）時不再自動轉，留卡片給使用者選。
  if (line && !new URL(location.href).searchParams.has(EXTERNAL)) location.replace(externalUrl(location.href));
  return new Promise(resolve => {
    $('inapp-stay').onclick = () => {
      $('login-inapp').hidden = true;
      $('login-main').hidden = false;
      resolve();
    };
  });
}

/** 已登入但在內建瀏覽器裡：提醒一次（每台裝置；看過指引卡也算）。 */
export function inAppNotice(info, notice) {
  if (!markNoticed()) return;
  const name = info.app === 'App' ? '這個 App' : info.app;
  notice(`${name} 內無法加到主畫面，建議改用 ${info.ios ? 'Safari' : '瀏覽器'} 開啟專屬連結。`);
}

/**
 * 手機瀏覽器第一次用連結登入後，提示加到主畫面。
 * iPhone 主畫面與 Safari 分開儲存，從主畫面第一次開啟要貼上連結，所以附「複製連結」。
 */
export function installTip(info, link) {
  if (info.standalone || info.app || (!info.ios && !info.android)) return;
  $('install-text').textContent = info.ios ? '點分享 →「加入主畫面」' : '點右上角 ⋮ →「加到主畫面」';
  const copyLink = $('install-copy');
  copyLink.hidden = !info.ios || !link;
  if (info.ios && link) copyButton(copyLink, link, '已複製');
  $('install-close').onclick = () => { $('install-tip').hidden = true; copyLink.onclick = null; };
  $('install-tip').hidden = false;
}
