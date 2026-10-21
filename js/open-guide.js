// 首次開啟的瀏覽器指引：LINE 等 App 內建瀏覽器無法加到主畫面，先請使用者改用 Safari／瀏覽器；
// 手機瀏覽器第一次用連結登入後，提示怎麼加到主畫面（Android 支援時一鍵安裝）。
const $ = id => document.getElementById(id);
const IN_APP = [
  [/\bLine\//i, 'LINE'], [/Instagram/i, 'Instagram'], [/MessengerForiOS|FBAN\/Messenger|\bOrca-Android\b/i, 'Messenger'],
  [/FBAN|FBAV|FB_IAB/i, 'Facebook'], [/MicroMessenger/i, '微信'], [/Barcelona/i, 'Threads'],
  [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok'],
];
const EXTERNAL = 'openExternalBrowser';
const NOTICED = 'inapp-noticed', DISMISSED = 'install-dismissed';
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

/**
 * 從內建瀏覽器改用外部瀏覽器開啟同一個網址（保留 #k=）。
 * LINE 認得 ?openExternalBrowser=1；iPhone 其他 App 用 iOS 17 起的 x-safari-https://；
 * Android 其他 App 用 intent:// 指定 Chrome（Android 取最後一個 # 之後當 intent 參數）。
 */
export function externalUrl(href, info) {
  const url = new URL(href);
  if (info.app === 'LINE') { url.searchParams.set(EXTERNAL, '1'); return url.href; }
  if (info.ios) return 'x-safari-' + url.href;
  return `intent://${url.host}${url.pathname}${url.search}${url.hash}#Intent;scheme=${url.protocol.slice(0, -1)};package=com.android.chrome;end`;
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
  $('inapp-note').textContent = `${name} 內無法加到主畫面。` + (line ? '' : `沒反應時點右上角 ⋯ 改用${browser}。`);
  const open = $('inapp-open');
  open.textContent = `用 ${browser} 開啟`;
  open.href = externalUrl(location.href, info);
  copyButton($('inapp-copy'), location.href, `已複製，到 ${browser} 貼上網址`);
  // LINE 直接轉去外部瀏覽器；回到這一頁（已帶參數）時不再自動轉，留卡片給使用者選。
  if (line && !new URL(location.href).searchParams.has(EXTERNAL)) location.replace(externalUrl(location.href, info));
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

/* ---------- 加到主畫面 ---------- */

// Android Chrome 等符合安裝條件時給 beforeinstallprompt，留著讓「安裝」按鈕叫出系統安裝視窗。
let installPrompt = null, onPrompt = null;
if (typeof window !== 'undefined') {
  addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; onPrompt?.(); });
  addEventListener('appinstalled', () => { installPrompt = null; hideTip(); });
}
function hideTip() {
  const tip = $('install-tip');
  if (tip) tip.hidden = true;
  onPrompt = null;
}
function dismissed(set) {
  try { if (set) localStorage.setItem(DISMISSED, '1'); return !!localStorage.getItem(DISMISSED); } catch { return false; }
}
function androidMenu(ua) {
  if (/SamsungBrowser/.test(ua)) return '點下方 ☰ →「新增頁面至」→「主螢幕」';
  if (/Chrome\//.test(ua) && !/EdgA|OPR|Firefox/.test(ua)) return '點右上角 ⋮ →「加到主畫面」';
  return '從瀏覽器選單選「加到主畫面」';
}

/**
 * 登入後提示加到主畫面。iPhone 只在第一次用連結登入時提示：主畫面與 Safari 分開儲存，
 * 從主畫面第一次開啟要貼上連結，所以附「複製連結」。Android 共用登入，可一鍵安裝時就提示（關掉後不再出現）。
 */
export function installTip(info, { fresh = false, link = '', ua = navigator.userAgent } = {}) {
  if (info.standalone || info.app || (!info.ios && !info.android)) return;
  const tip = $('install-tip'), text = $('install-text'), copyLink = $('install-copy'), install = $('install-go');
  $('install-close').onclick = () => { dismissed(true); hideTip(); };
  if (info.ios) {
    if (!fresh) return;
    text.textContent = '點分享 →「加入主畫面」';
    copyLink.hidden = !link;
    if (link) copyButton(copyLink, link, '已複製');
    install.hidden = true;
    tip.hidden = false;
    return;
  }
  copyLink.hidden = true;
  const draw = () => {
    install.hidden = !installPrompt;
    text.textContent = installPrompt ? '加到主畫面，下次一點就開' : androidMenu(ua);
    tip.hidden = false;
  };
  install.onclick = async () => {
    const prompt = installPrompt;
    if (!prompt) return;
    installPrompt = null;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'dismissed') dismissed(true);
    hideTip();
  };
  if (dismissed() && !fresh) return;
  if (installPrompt || fresh) draw();
  onPrompt = draw; // 安裝條件晚一點才成立時，補上按鈕
}
