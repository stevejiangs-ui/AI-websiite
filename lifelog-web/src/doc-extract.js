/* 从各种文件里把「文字」抠出来。

   为什么要自己写：账单导入原来只认 CSV / XLSX，用户手里还有 Word、PDF、
   备忘录导出的 txt。与其让用户去转格式，不如在浏览器里直接读。

   支持的格式与靠谱程度：
     .txt / .md / .csv   —— 纯文本，直接读（自动识别 UTF-8 / GBK）
     .docx               —— 本质是 zip + word/document.xml，解压后抠 w:t
     .pdf                —— 只能读「文字型 PDF」的文本流；扫描件、字体做了
                            子集编码的 PDF 读不出来，会明确告诉你转格式
     .xlsx               —— 表格不在这里处理（有结构化解析器，见 importer.js）
     .doc / .wps         —— 老二进制格式，浏览器里解不了，提示另存

   关键实现点：解压用的是浏览器内置 DecompressionStream('deflate-raw')，
   不引第三方库，省几百 KB，也避免 CDN 依赖。
*/

import { readZip } from './importer.js';

const dec = (buf, enc) => new TextDecoder(enc, { fatal: false }).decode(buf);

/* ---------------- 纯文本 ---------------- */

function decodeTextSmart(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return dec(buf.slice(3), 'utf-8');
  const utf8 = dec(buf, 'utf-8');
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    const gbk = dec(buf, 'gbk');
    /* GBK 解出来如果替换符更少，就认为原文件是 GBK */
    if ((gbk.match(/\uFFFD/g) || []).length < (utf8.match(/\uFFFD/g) || []).length) return gbk;
  } catch (e) {
    /* 有些内核没有 gbk，退回 utf-8 */
  }
  return utf8;
}

/* ---------------- docx ---------------- */

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

/* docx 正文转文字。
   顺序很重要：先把「段落 / 换行 / 单元格」这些结构标签换成 \n \t，
   再整体剥掉剩下的标签。早先是只挑 <w:t> 出来拼，结果结构标签夹在两段
   文字中间时，换行和制表符被吞掉，表格会糊成一行。 */
export function docxXmlToText(xml) {
  const withBreaks = String(xml)
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<w:tab[^>]*\/>/g, '\t')
    /* 单元格里最后一个段落结束后紧跟 </w:tc>：这里不能算换行，
       否则一行表格会被拆成好几行，制表符也失效 */
    .replace(/<\/w:p>\s*<\/w:tc>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:tc>/g, '\t');

  const text = decodeXmlEntities(withBreaks.replace(/<[^>]*>/g, ''));
  return text
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\t+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractDocx(buf) {
  const entries = await readZip(buf);
  const key = Object.keys(entries).find((n) => /^word\/document\.xml$/i.test(n));
  if (!key) return { error: '这个 .docx 里没有正文（可能是加密文档或改了扩展名）' };
  const text = docxXmlToText(dec(entries[key], 'utf-8'));
  if (!text) return { error: '.docx 里没读到文字' };
  return { text };
}

/* ---------------- pdf ---------------- */

/* PDF 里的字符串： (...) 里可以有 \( \) \\ 和八进制 \ddd */
export function unescapePdfString(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = s[i + 1];
    if (n === undefined) break;
    if (n === 'n') {
      out += '\n';
      i++;
    } else if (n === 'r') {
      out += '\n';
      i++;
    } else if (n === 't') {
      out += '\t';
      i++;
    } else if (n === 'b') {
      out += '\b';
      i++;
    } else if (n === 'f') {
      out += '\f';
      i++;
    } else if (n === '(' || n === ')' || n === '\\') {
      out += n;
      i++;
    } else if (/[0-7]/.test(n)) {
      let oct = '';
      let j = i + 1;
      while (j < s.length && oct.length < 3 && /[0-7]/.test(s[j])) {
        oct += s[j];
        j++;
      }
      out += String.fromCharCode(parseInt(oct, 8));
      i = j - 1;
    } else {
      out += n;
      i++;
    }
  }
  return out;
}

/* 从解压后的内容流里抽文字。
   规则：只认 BT…ET 里的字符串；这些字符串要么紧跟 Tj / ' / "，
   要么在 [...] TJ 数组里。早先只看「紧跟 Tj」，TJ 数组里的字会被逐个丢掉，
   只剩最后一个。 */
export function pdfContentToText(content) {
  const L = [];
  let line = '';
  const flush = () => {
    if (line.trim()) L.push(line.trim());
    line = '';
  };

  let i = 0;
  let inText = false;
  let inArray = 0;
  let inStr = false;
  let depth = 0;
  let buf = '';

  const isWordChar = (c) => /[A-Za-z]/.test(c || '');

  while (i < content.length) {
    const c = content[i];

    if (!inStr) {
      /* 指令：BT / ET 决定「是不是文字块」 */
      if (c === 'B' && content[i + 1] === 'T' && !isWordChar(content[i - 1])) {
        inText = true;
        i += 2;
        continue;
      }
      if (c === 'E' && content[i + 1] === 'T' && !isWordChar(content[i - 1])) {
        flush();
        inText = false;
        i += 2;
        continue;
      }
      if (c === '[') {
        inArray++;
        i++;
        continue;
      }
      if (c === ']') {
        if (inArray > 0) inArray--;
        i++;
        continue;
      }
      if (c === 'T' && content[i + 1] === '*') {
        flush();
        i += 2;
        continue;
      }
      if (c === 'T' && (content[i + 1] === 'd' || content[i + 1] === 'D')) {
        flush();
        i += 2;
        continue;
      }
      if (c === '(') {
        inStr = true;
        buf = '';
        depth = 1;
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (c === '\\') {
      buf += c + (content[i + 1] || '');
      i += 2;
      continue;
    }
    if (c === '(') {
      depth++;
      buf += c;
      i++;
      continue;
    }
    if (c === ')') {
      depth--;
      if (depth === 0) {
        inStr = false;
        const text = unescapePdfString(buf);
        const rest = content.slice(i + 1, i + 10);
        const shown = /^\s*(Tj|TJ|'|")/.test(rest);
        if (inText && (shown || inArray > 0)) line += text;
        i++;
        continue;
      }
      depth--;
      buf += c;
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return L.join('\n');
}

function textQuality(text) {
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const digits = (text.match(/\d/g) || []).length;
  return { cjk, latin, digits, total: cjk + latin + digits };
}

async function inflate(buf) {
  if (typeof DecompressionStream === 'undefined') throw new Error('这个浏览器不支持解压 PDF 内容');
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function extractPdf(buf) {
  const raw = dec(buf, 'latin1');
  const streams = [];
  /* 逐个 stream…endstream，按字典里有没有 FlateDecode 决定要不要解压 */
  const re = /stream\r?\n?/g;
  let m;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    const dictStart = raw.lastIndexOf('<<', m.index);
    const dict = dictStart >= 0 ? raw.slice(dictStart, m.index) : '';
    const chunk = buf.slice(start, end);
    streams.push({ dict, chunk });
    re.lastIndex = end;
  }

  const texts = [];
  for (const s of streams) {
    let content = '';
    if (/FlateDecode/.test(s.dict)) {
      try {
        content = dec(await inflate(s.chunk), 'latin1');
      } catch (e) {
        continue;
      }
    } else if (/Filter/.test(s.dict)) {
      continue; /* 其它压缩方式（LZW / JPX）不处理 */
    } else {
      content = dec(s.chunk, 'latin1');
    }
    const t = pdfContentToText(content);
    if (t) texts.push(t);
  }

  const text = texts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const q = textQuality(text);
  /* 账单类 PDF 常常是「日期 + 金额」为主，纯数字也算有效内容，
     所以不能只看汉字/字母数量。 */
  if (q.total < 12) {
    return {
      error:
        '这份 PDF 读不出文字：扫描件、或字体做了子集编码（很常见）。请用「另存为 / 导出」转成 Excel、Word 或 CSV 再传，也可以截图后在这里手打或粘贴。'
    };
  }
  return { text, warn: q.cjk === 0 && /[\u4e00-\u9fa5]/.test(text) ? '' : '' };
}

/* ---------------- 对外 ---------------- */

const TEXT_EXT = ['.txt', '.md', '.markdown', '.text', '.log'];

export function extOf(name) {
  const n = String(name || '').toLowerCase();
  const i = n.lastIndexOf('.');
  return i >= 0 ? n.slice(i) : '';
}

/** 这个文件能不能用「抠文字」的方式读 */
export function canExtractText(name) {
  const e = extOf(name);
  return e === '.docx' || e === '.pdf' || TEXT_EXT.includes(e);
}

/**
 * 读文件 → { text } 或 { error }
 * 只做「变成文字」这一步，怎么理解文字交给调用方（结构化解析或 AI）。
 */
export async function extractText(file) {
  const name = file.name || '';
  const ext = extOf(name);
  const buf = new Uint8Array(await file.arrayBuffer());

  if (ext === '.docx') return extractDocx(buf);
  if (ext === '.pdf') return extractPdf(buf);
  if (TEXT_EXT.includes(ext)) {
    const text = decodeTextSmart(buf);
    if (!text.trim()) return { error: '文件是空的' };
    return { text };
  }
  if (ext === '.doc' || ext === '.wps' || ext === '.wpt') {
    return { error: '旧版 .doc / .wps 是二进制格式，浏览器读不了。请在 Word / WPS 里「另存为」.docx 或 .txt 后再传。' };
  }
  return { error: `暂不支持 ${ext || '这种'} 格式` };
}
