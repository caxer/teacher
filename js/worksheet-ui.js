// 考卷：選多張課本照片 → Claude 出題 → 預覽 → 存成 PDF 或 Word。
import { studyTask, currentSecrets, modelName, EFFORT } from './ai.js';
import { currentSettings } from './settings.js';
import { logEvent } from './logger.js';
import { preparePhoto, exportJPEG } from './photo.js';
import { MAX_PHOTOS, WORKSHEET_COUNTS, OPTION_LABELS, PAGE, layoutWorksheet, buildPdf, buildDocx } from './worksheet.js';

const FONT = '"Helvetica Neue", Arial, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function worksheetFiles(sheet, answers) {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE.w; canvas.height = PAGE.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法建立考卷頁面，請關閉其他分頁後重試。');
  const font = (size, bold) => { ctx.font = `${bold ? 700 : 400} ${size}px ${FONT}`; };
  const pages = layoutWorksheet(sheet, (text, size, bold) => { font(size, bold); return ctx.measureText(text).width; }, { answers });
  const images = [];
  try {
    for (const ops of pages) {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PAGE.w, PAGE.h);
      for (const op of ops) {
        if (op.type === 'text') { font(op.size, op.bold); ctx.fillStyle = op.color; ctx.fillText(op.s, op.x, op.y); continue; }
        ctx.strokeStyle = op.color; ctx.lineWidth = op.width;
        ctx.beginPath(); ctx.moveTo(op.x1, op.y1); ctx.lineTo(op.x2, op.y2); ctx.stroke();
      }
      images.push({ bytes: new Uint8Array(await (await exportJPEG(canvas)).arrayBuffer()), width: PAGE.w, height: PAGE.h });
    }
  } finally { canvas.width = canvas.height = 0; }
  const name = sheet.title.replace(/[\\/:*?"<>|]/g, ' ').trim() || '考卷';
  return {
    pdf: new File([buildPdf(images)], `${name}.pdf`, { type: 'application/pdf' }),
    docx: new File([buildDocx(sheet, { answers })], `${name}.docx`, { type: DOCX }),
  };
}

// 手機走系統分享（可存到「檔案」）；不支援該檔案類型或電腦版就直接下載。
async function saveFile(file) {
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: file.name }); return; }
    catch (error) { if (error.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file), link = document.createElement('a');
  link.href = url; link.download = file.name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function initWorksheet(bridge) {
  const host = document.createElement('div');
  host.innerHTML = `
  <dialog class="study-dialog" id="worksheet">
    <form method="dialog" class="study-heading"><h2 title="選課本照片，老師依內容出新題目，可存成 PDF 或 Word。">考卷</h2><button class="btn">關閉</button></form>
    <section id="ws-setup">
      <div class="ws-photos" id="ws-photos"></div>
      <div class="entry-settings"><label title="保留全部原題：收錄照片裡的每一題，看圖題改用文字描述圖片。">出題方式<select id="ws-mode"><option value="new">出新題目</option><option value="keep">保留全部原題</option></select></label><label id="ws-count-field">題數<select id="ws-count"></select></label></div>
      <div class="study-actions"><button class="btn primary" id="ws-start" type="button" disabled>開始出題</button></div>
    </section>
    <section id="ws-result" hidden>
      <div class="ws-preview" id="ws-preview"></div>
      <label class="ws-check"><input type="checkbox" id="ws-answers" checked>含答案</label>
      <div class="study-actions"><button class="btn primary" id="ws-pdf" type="button" disabled>存 PDF</button><button class="btn primary" id="ws-docx" type="button" disabled>存 Word</button><button class="btn" id="ws-again" type="button">重新出題</button></div>
    </section>
    <p id="ws-status" role="status"></p>
    <input type="file" id="ws-file" accept="image/*" multiple hidden>
  </dialog>`;
  document.body.append(host);
  const $ = id => document.getElementById(id);
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  let photos = [], reading = false, sheet = null, files = null, request = null, build = 0;

  $('ws-count').replaceChildren(...WORKSHEET_COUNTS.map(count => new Option(`${count} 題`, count)));
  $('ws-count').value = '15';
  $('ws-mode').onchange = () => { $('ws-count-field').hidden = $('ws-mode').value === 'keep'; };

  function renderPhotos() {
    const tiles = photos.map((photo, i) => {
      const tile = el('div', undefined, 'ws-photo'), image = el('img'), remove = el('button', '×');
      image.src = photo.thumb; image.alt = `第 ${i + 1} 張`;
      remove.type = 'button'; remove.setAttribute('aria-label', `移除第 ${i + 1} 張`);
      remove.onclick = () => { photos = photos.filter(item => item !== photo); renderPhotos(); };
      tile.append(image, remove);
      return tile;
    });
    if (photos.length < MAX_PHOTOS) {
      const add = el('button', '＋', 'ws-add');
      add.type = 'button'; add.disabled = reading; add.title = `加入課本照片，最多 ${MAX_PHOTOS} 張`; add.setAttribute('aria-label', '加入照片');
      add.onclick = () => $('ws-file').click();
      tiles.push(add);
    }
    $('ws-photos').replaceChildren(...tiles);
    $('ws-start').disabled = reading || Boolean(request) || !photos.length;
  }
  $('ws-file').onchange = async event => {
    const picked = [...event.target.files], room = MAX_PHOTOS - photos.length;
    event.target.value = '';
    if (!picked.length) return;
    reading = true; renderPhotos();
    $('ws-status').textContent = '正在讀取照片…';
    let problem = picked.length > room ? `最多 ${MAX_PHOTOS} 張，多的沒有加入。` : '';
    for (const file of picked.slice(0, room)) {
      try { photos.push(await preparePhoto(file)); renderPhotos(); }
      catch (error) { problem = error.message; break; }
    }
    reading = false; renderPhotos();
    $('ws-status').textContent = problem;
  };

  function renderPreview() {
    const withAnswers = $('ws-answers').checked;
    const nodes = [el('h3', sheet.title)];
    let number = 0;
    for (const section of sheet.sections) {
      if (section.title) nodes.push(el('h4', section.title));
      if (section.passage) nodes.push(el('p', section.passage, 'ws-passage'));
      for (const q of section.questions) {
        const item = el('p', `${++number}. ${q.question}`);
        if (q.options.length) item.append(el('span', q.options.map((option, i) => `${OPTION_LABELS[i]}. ${option}`).join('　'), 'ws-options'));
        if (withAnswers) item.append(el('span', `答案：${q.correct >= 0 ? `${OPTION_LABELS[q.correct]}. ` : ''}${q.answer}`, 'ws-key'));
        nodes.push(item);
      }
    }
    $('ws-preview').replaceChildren(...nodes);
  }
  // 先做好檔案：iPhone 的分享必須在按下按鈕的當下呼叫。
  async function prepareFiles() {
    const mine = ++build;
    files = null; $('ws-pdf').disabled = $('ws-docx').disabled = true;
    $('ws-status').textContent = '正在製作檔案…';
    try {
      const made = await worksheetFiles(sheet, $('ws-answers').checked);
      if (mine !== build) return;
      files = made; $('ws-pdf').disabled = $('ws-docx').disabled = false;
      $('ws-status').textContent = '';
    } catch (error) { if (mine === build) $('ws-status').textContent = error.message; }
  }
  function showStep(result) { $('ws-setup').hidden = result; $('ws-result').hidden = !result; }

  $('ws-start').onclick = async () => {
    if (!photos.length || request || !bridge.ready()) return;
    const ac = request = new AbortController(), model = bridge.model(), profile = currentSettings(), started = Date.now();
    const mode = $('ws-mode').value, context = mode === 'keep' ? { mode } : { mode, count: Number($('ws-count').value) };
    let outcome = { status: 'cancelled' };
    renderPhotos();
    $('ws-status').textContent = mode === 'keep' ? '老師正在整理課本題目…' : '老師正在看課本出題…';
    try {
      const result = await studyTask({ task: 'worksheet', context, images: photos.map(photo => photo.blob), model, profile, signal: ac.signal });
      outcome = { status: 'done', usage: result.usage, usedModel: result.model, text: result.text };
      if (ac.signal.aborted || !$('worksheet').open) return;
      sheet = result.value; showStep(true); renderPreview(); await prepareFiles();
    } catch (error) {
      if (error.name === 'AbortError') return;
      outcome = { status: 'error', error: error.message, usage: error.usage, usedModel: error.model };
      $('ws-status').textContent = error.message;
      if (error.code === 'login') { $('worksheet').close(); bridge.login(error.message); }
    } finally {
      if (request === ac) request = null;
      renderPhotos();
      logEvent(currentSecrets(), { kind: 'practice', note: '照片考卷', problem: `${photos.length} 張照片，${mode === 'keep' ? '保留全部原題' : `${context.count} 題`}`, model: modelName(bridge.modelId(model)), effort: EFFORT, profile, ms: Date.now() - started, ...outcome });
    }
  };
  $('ws-answers').onchange = () => { renderPreview(); prepareFiles(); };
  for (const [id, kind] of [['ws-pdf', 'pdf'], ['ws-docx', 'docx']]) $(id).onclick = () => {
    if (files) saveFile(files[kind]).catch(error => { $('ws-status').textContent = error.message; });
  };
  $('ws-again').onclick = () => { build++; sheet = files = null; $('ws-status').textContent = ''; showStep(false); };
  $('worksheet').addEventListener('close', () => { request?.abort(); $('ws-status').textContent = ''; });
  $('open-worksheet').onclick = () => {
    if (!bridge.ready()) return;
    bridge.pause(); renderPhotos(); $('worksheet').showModal();
  };
}
