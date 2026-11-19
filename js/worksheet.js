// 考卷的純函式：整理 Claude 出的題目、排成 A4 頁面、產生 PDF 與 Word。畫面在 worksheet-ui.js。
import { splitMath, texToText } from './rich.js';

export const MAX_PHOTOS = 8;
export const WORKSHEET_COUNTS = [10, 15, 20, 30];
const MAX_QUESTIONS = 120; // 保留原題時，8 張照片的題目都要放得下
export const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];
const OPTION_PREFIX = /^\(?[A-Fa-f][.)、]\s*/;

// 紙本不跑 MathJax：數學式轉成純文字，重點記號拿掉。
const plain = (value, max) => typeof value !== 'string' ? '' : splitMath(value)
  .map(part => part.math ? texToText(part.s) : part.s).join('').replaceAll('**', '').trim().slice(0, max);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

function parseQuestion(raw) {
  const question = plain(raw?.question, 800), answer = plain(raw?.answer, 400);
  if (!question || !answer) throw new Error('考卷有題目缺少答案，請重新出題。');
  const options = (Array.isArray(raw?.options) ? raw.options : [])
    .map(option => plain(option, 200).replace(OPTION_PREFIX, '')).filter(Boolean);
  if (!options.length) return { question, options, answer, correct: -1 };
  const label = OPTION_LABELS.indexOf(answer.replace(/[().、\s]/g, '').toUpperCase());
  const named = options.findIndex(option => same(option, answer.replace(OPTION_PREFIX, '')));
  const correct = named >= 0 ? named : label < options.length ? label : -1;
  if (options.length < 2 || options.length > OPTION_LABELS.length || new Set(options.map(o => o.toLowerCase())).size !== options.length || correct < 0) {
    throw new Error('考卷的選擇題選項有誤，請重新出題。');
  }
  return { question, options, answer: options[correct], correct };
}

export function parseWorksheet(value) {
  const error = plain(value?.error, 200);
  if (error) throw new Error(error);
  let left = MAX_QUESTIONS;
  const sections = (Array.isArray(value?.sections) ? value.sections : []).map(section => {
    const questions = (Array.isArray(section?.questions) ? section.questions : []).slice(0, left).map(parseQuestion);
    left -= questions.length;
    return { title: plain(section?.title, 60), passage: plain(section?.passage, 4000), questions };
  }).filter(section => section.questions.length);
  if (!sections.length) throw new Error('考卷沒有題目，請重新出題。');
  return { title: plain(value?.title, 40) || '考卷', subject: plain(value?.subject, 12), sections };
}

/* ---------- A4 排版（150 dpi） ---------- */

export const PAGE = { w: 1240, h: 1754, margin: 110 };
const SIZE = { title: 50, section: 36, body: 32, small: 24 };
const INK = '#1e2924', MUTED = '#5d6c64', RULE = '#9aa8a0', ACCENT = '#2c6a4f';
const CJK = '\\u2E80-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFFEF\\u3000-\\u303F';
const TOKENS = new RegExp(`[${CJK}]|\\s+|[^\\s${CJK}]+`, 'g');

// 英文整字換行、中文逐字換行；比一行還長的字才拆開。
export function wrapText(text, width, measure) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const token of paragraph.match(TOKENS) || []) {
      if (measure((line + token).trimEnd()) <= width) { line += token; continue; }
      if (line.trim()) lines.push(line.trimEnd());
      line = '';
      if (!token.trim()) continue;
      for (const char of token) {
        if (line && measure(line + char) > width) { lines.push(line); line = ''; }
        line += char;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

const questionTotal = sheet => sheet.sections.reduce((sum, section) => sum + section.questions.length, 0);

// measure(text, size, bold) → 寬度。回傳每頁的繪圖指令，畫布和測試共用。
export function layoutWorksheet(sheet, measure, { answers = true } = {}) {
  const left = PAGE.margin, right = PAGE.w - PAGE.margin, width = right - left, bottom = PAGE.h - PAGE.margin - 40;
  const lineHeight = size => Math.round(size * 1.45);
  const text = (s, x, y, size = SIZE.body, { bold = false, color = INK } = {}) => ({ type: 'text', s, x, y, size, bold, color });
  const rule = (x1, y1, x2, y2 = y1, color = RULE, lineWidth = 2) => ({ type: 'line', x1, y1, x2, y2, color, width: lineWidth });
  const wrap = (s, w, size = SIZE.body, bold = false) => wrapText(s, w, part => measure(part, size, bold));
  const digits = '0'.repeat(Math.max(2, String(questionTotal(sheet)).length));

  const titleBlock = (title, size) => {
    const lines = wrap(title, width, size, true), h = lines.length * lineHeight(size) + 16;
    return { h, keep: true, ops: top => lines.map((line, i) => text(line, (PAGE.w - measure(line, size, true)) / 2, top + size + i * lineHeight(size), size, { bold: true })) };
  };
  const nameBlock = () => ({ h: 104, ops: top => ['姓名', '日期', '得分'].flatMap((label, i) => {
    const x = left + i * width / 3, y = top + 60, end = x + measure(label, SIZE.body) + 12;
    return [text(label, x, y), rule(end, y + 6, x + width / 3 - 28)];
  }) });
  const sectionBlock = title => {
    const lines = wrap(title, width, SIZE.section, true), h = 28 + lines.length * lineHeight(SIZE.section) + 22;
    return { h, keep: true, ops: top => [
      ...lines.map((line, i) => text(line, left, top + 28 + SIZE.section + i * lineHeight(SIZE.section), SIZE.section, { bold: true, color: ACCENT })),
      rule(left, top + h - 10, right, top + h - 10, ACCENT, 3),
    ] };
  };
  const passageBlocks = passage => wrap(passage, width - 32).map(line => ({
    h: lineHeight(SIZE.body), ops: top => [rule(left + 4, top, left + 4, top + lineHeight(SIZE.body), '#c5d6cb', 6), text(line, left + 32, top + SIZE.body)],
  }));
  const questionBlock = (q, number) => {
    const choice = q.options.length > 0;
    const prefix = choice ? `(      ) ${number}.` : `${number}.`;
    const indent = Math.ceil(measure(choice ? `(      ) ${digits}. ` : `${digits}. `, SIZE.body));
    const lines = wrap(q.question, width - indent), lh = lineHeight(SIZE.body), area = width - indent;
    const labelled = q.options.map((option, i) => `${OPTION_LABELS[i]}. ${option}`);
    const columns = [labelled.length, 2].find(n => labelled.every(label => measure(label, SIZE.body) <= area / n - 16)) || 1;
    const optionLines = columns > 1 ? labelled.map(label => [label]) : labelled.map(label => wrap(label, area));
    const rows = columns > 1 ? Math.ceil(labelled.length / columns) : optionLines.flat().length;
    const writeLine = !choice && !q.question.includes('__');
    const h = lines.length * lh + rows * lh + (writeLine ? 70 : 0) + 30;
    return { h, ops: top => {
      const ops = [text(prefix, left, top + SIZE.body), ...lines.map((line, i) => text(line, left + indent, top + SIZE.body + i * lh))];
      let y = top + lines.length * lh + SIZE.body;
      if (columns > 1) labelled.forEach((label, i) => ops.push(text(label, left + indent + (i % columns) * area / columns, y + Math.floor(i / columns) * lh)));
      else optionLines.flat().forEach((line, i) => ops.push(text(line, left + indent, y + i * lh)));
      if (writeLine) { y += 58; ops.push(rule(left + indent, y, right)); }
      return ops;
    } };
  };
  const answerBlock = (q, number) => {
    const label = q.correct >= 0 ? `${OPTION_LABELS[q.correct]}. ${q.answer}` : q.answer;
    const indent = Math.ceil(measure(`${digits}. `, SIZE.body)), lines = wrap(label, width - indent), lh = lineHeight(SIZE.body);
    return { h: lines.length * lh + 8, ops: top => [text(`${number}.`, left, top + SIZE.body), ...lines.map((line, i) => text(line, left + indent, top + SIZE.body + i * lh))] };
  };

  const pages = [[]];
  let y = PAGE.margin;
  const place = blocks => blocks.forEach((block, i) => {
    const need = block.h + (block.keep ? blocks[i + 1]?.h || 0 : 0);
    if (y + need > bottom && y > PAGE.margin) { pages.push([]); y = PAGE.margin; }
    pages.at(-1).push(...block.ops(y));
    y += block.h;
  });

  let number = 0;
  place([titleBlock(sheet.title, SIZE.title), nameBlock(), ...sheet.sections.flatMap(section => [
    ...(section.title ? [sectionBlock(section.title)] : []),
    ...(section.passage ? [...passageBlocks(section.passage), { h: 24, ops: () => [] }] : []),
    ...section.questions.map(q => questionBlock(q, ++number)),
  ])]);
  if (answers) {
    pages.push([]); y = PAGE.margin; number = 0;
    place([titleBlock(`${sheet.title}　答案`, SIZE.title), ...sheet.sections.flatMap(section => [
      ...(section.title ? [sectionBlock(section.title)] : []),
      ...section.questions.map(q => answerBlock(q, ++number)),
    ])]);
  }
  return pages.map((ops, i) => {
    const footer = `${i + 1} / ${pages.length}`;
    return [...ops, text(footer, (PAGE.w - measure(footer, SIZE.small)) / 2, PAGE.h - 70, SIZE.small, { color: MUTED })];
  });
}

/* ---------- PDF：每頁一張 JPEG，中文不必內嵌字型 ---------- */

function concat(chunks) {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}

export function buildPdf(images) {
  const encoder = new TextEncoder(), chunks = [], offsets = [];
  let length = 0;
  const add = data => { const bytes = typeof data === 'string' ? encoder.encode(data) : data; chunks.push(bytes); length += bytes.length; };
  const object = (id, ...parts) => { offsets[id] = length; add(`${id} 0 obj\n`); parts.forEach(add); add('\nendobj\n'); };
  add('%PDF-1.4\n');
  const kids = images.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>`);
  images.forEach((image, i) => {
    const id = 3 + i * 3, content = 'q 595.28 0 0 841.89 0 0 cm /Im0 Do Q';
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
    object(id + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    object(id + 2, `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`, image.bytes, '\nendstream');
  });
  const start = length, count = images.length * 3 + 3;
  add(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) add(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  add(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
  return concat(chunks);
}

/* ---------- Word：不壓縮的 zip，不需要外部套件 ---------- */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xEDB88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
export function zipStore(files) {
  const encoder = new TextEncoder(), body = [], directory = [];
  let offset = 0;
  const header = (size, write) => { const bytes = new Uint8Array(size); write(new DataView(bytes.buffer)); return bytes; };
  for (const [name, content] of files) {
    const nameBytes = encoder.encode(name), data = encoder.encode(content), crc = crc32(data);
    const common = (view, at) => {
      view.setUint16(at, 20, true); view.setUint16(at + 2, 0x0800, true); view.setUint16(at + 4, 0, true);
      view.setUint16(at + 6, 0, true); view.setUint16(at + 8, 0x21, true); view.setUint32(at + 10, crc, true);
      view.setUint32(at + 14, data.length, true); view.setUint32(at + 18, data.length, true); view.setUint16(at + 22, nameBytes.length, true);
    };
    const local = header(30, view => { view.setUint32(0, 0x04034b50, true); common(view, 4); });
    directory.push(header(46, view => {
      view.setUint32(0, 0x02014b50, true); view.setUint16(4, 20, true); common(view, 6); view.setUint32(42, offset, true);
    }), nameBytes);
    body.push(local, nameBytes, data);
    offset += local.length + nameBytes.length + data.length;
  }
  const size = directory.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = header(22, view => {
    view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.length, true); view.setUint16(10, files.length, true);
    view.setUint32(12, size, true); view.setUint32(16, offset, true);
  });
  return concat([...body, ...directory, end]);
}

const xml = value => String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function run(value, { bold = false, size = 28, color = '' } = {}) {
  const props = `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft JhengHei" w:cs="Arial"/>${bold ? '<w:b/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
  const inner = String(value).split(/(\n|\t)/).map(part => part === '\n' ? '<w:br/>' : part === '\t' ? '<w:tab/>' : part ? `<w:t xml:space="preserve">${xml(part)}</w:t>` : '').join('');
  return `<w:r>${props}${inner}</w:r>`;
}
function paragraph(runs, { keep = false, pageBreak = false, border = '', shade = false, tabs = [], before = 0, after = 120, left = 0, hanging = 0, center = false } = {}) {
  return `<w:p><w:pPr>${keep ? '<w:keepNext/>' : ''}<w:keepLines/>${pageBreak ? '<w:pageBreakBefore/>' : ''}${border ? `<w:pBdr>${border}</w:pBdr>` : ''}${shade ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF4F0"/>' : ''}${tabs.length ? `<w:tabs>${tabs.map(pos => `<w:tab w:val="left" w:pos="${pos}"/>`).join('')}</w:tabs>` : ''}<w:spacing w:before="${before}" w:after="${after}"/>${left ? `<w:ind w:left="${left}"${hanging ? ` w:hanging="${hanging}"` : ''}/>` : ''}${center ? '<w:jc w:val="center"/>' : ''}</w:pPr>${[].concat(runs).join('')}</w:p>`;
}

const DOCX_TEXT_WIDTH = 9638; // A4 寬 11906 減左右邊界各 1134

export function buildDocx(sheet, { answers = true } = {}) {
  const line = '<w:bottom w:val="single" w:sz="6" w:space="1" w:color="9AA8A0"/>';
  const heading = title => paragraph(run(title, { bold: true, size: 32, color: '2C6A4F' }), { keep: true, before: 280, after: 120, border: '<w:bottom w:val="single" w:sz="12" w:space="2" w:color="2C6A4F"/>' });
  const body = [
    paragraph(run(sheet.title, { bold: true, size: 44 }), { center: true, keep: true }),
    paragraph(run('姓名：____________\t日期：____________\t得分：________'), { tabs: [3400, 6800], after: 200 }),
  ];
  let number = 0;
  const wide = questionTotal(sheet) >= 100 ? 160 : 0; // 三位數題號要多留一點縮排
  for (const section of sheet.sections) {
    if (section.title) body.push(heading(section.title));
    if (section.passage) body.push(paragraph(run(section.passage), { shade: true, before: 60, after: 200, border: '<w:left w:val="single" w:sz="24" w:space="8" w:color="C5D6CB"/>' }));
    for (const q of section.questions) {
      number++;
      const choice = q.options.length > 0, indent = (choice ? 1400 : 560) + wide;
      body.push(paragraph(run(`${choice ? '(        ) ' : ''}${number}.\t${q.question}`), { keep: choice, tabs: [indent], left: indent, hanging: indent, before: 120, after: 80 }));
      if (choice) {
        const labelled = q.options.map((option, i) => `${OPTION_LABELS[i]}. ${option}`);
        // 14 pt 的英文約 125 twips 一字、中文 280；放不進同一欄就一行一個選項，且不跨頁。
        const column = Math.floor((DOCX_TEXT_WIDTH - indent) / labelled.length);
        const fits = labelled.every(label => [...label].reduce((sum, c) => sum + (c.charCodeAt(0) > 0x2E7F ? 280 : 125), 0) <= column - 150);
        if (fits) body.push(paragraph(run(labelled.join('\t')), { left: indent, tabs: labelled.slice(1).map((_, i) => indent + (i + 1) * column) }));
        else labelled.forEach((label, i) => body.push(paragraph(run(label), { left: indent, after: 40, keep: i < labelled.length - 1 })));
      } else if (!q.question.includes('__')) body.push(paragraph(run(' '), { left: indent, border: line, after: 160 }));
    }
  }
  if (answers) {
    number = 0;
    body.push(paragraph(run(`${sheet.title}　答案`, { bold: true, size: 44 }), { center: true, pageBreak: true, keep: true }));
    for (const section of sheet.sections) {
      if (section.title) body.push(heading(section.title));
      for (const q of section.questions) {
        number++;
        body.push(paragraph(run(`${number}.\t${q.correct >= 0 ? `${OPTION_LABELS[q.correct]}. ` : ''}${q.answer}`, { size: 26 }), { tabs: [560 + wide], left: 560 + wide, hanging: 560 + wide, after: 0 }));
      }
    }
  }
  const page = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';
  return zipStore([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}${page}</w:body></w:document>`],
  ]);
}
