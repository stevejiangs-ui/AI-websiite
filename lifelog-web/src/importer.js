/* 账单解析：支付宝 / 微信 / 银行 App 导出的 CSV、XLSX */

function readTextSmart(buf) {
  // UTF-8 BOM
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf.slice(3));
  }
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch (e) {
    return utf8;
  }
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuote = false;
      } else cur += ch;
    } else if (ch === '"') inQuote = true;
    else if (ch === ',' || ch === '\t') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function splitRows(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);
}

const DATE_KEYS = ['交易时间', '交易日期', '记账日期', '日期', '交易创建时间', '支付时间', '入账日期', '时间'];
const AMOUNT_KEYS = ['金额', '发生额', '交易金额', '收支金额', '支出', '收入', '交易额'];

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    const joined = rows[i];
    const hasDate = DATE_KEYS.some((k) => joined.includes(k));
    const hasAmount = AMOUNT_KEYS.some((k) => joined.includes(k)) || /金额|价|收支/.test(joined);
    if (hasDate && hasAmount) return i;
  }
  return -1;
}

function normDate(s) {
  if (!s) return null;
  const t = String(s).trim().replace(/\//g, '-');
  let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = t.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function normTime(s) {
  const m = String(s || '').match(/(\d{1,2}):(\d{2})(:(\d{2}))?/);
  return m ? `${String(m[1]).padStart(2, '0')}:${m[2]}:${m[4] || '00'}` : '';
}

function normAmount(s) {
  if (s === null || s === undefined) return null;
  const cleaned = String(s)
    .replace(/[¥￥,\s元]/g, '')
    .replace(/[（(]/g, '-')
    .replace(/[)）]/g, '');
  const v = parseFloat(cleaned);
  if (isNaN(v)) return null;
  return Math.abs(v);
}

function hash(s) {
  // 简单稳定的字符串哈希（FNV-1a 变体），够用于去重
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16) + '_' + s.length;
}

function extractRecord(header, cells, guess) {
  const H = header.map((h) => String(h || '').replace(/\s/g, ''));

  // 精确匹配优先，再退化到包含匹配，避免「最近修改时间」抢走日期列
  const resolve = (n) => {
    const clean = n.replace(/\s/g, '');
    let idx = H.findIndex((h) => h === clean);
    if (idx >= 0) return idx;
    const noUnit = (s) => s.replace(/[（(][^）)]*[）)]/g, '');
    idx = H.findIndex((h) => noUnit(h) === clean);
    if (idx >= 0) return idx;
    idx = H.findIndex((h) => h.startsWith(clean));
    if (idx >= 0) return idx;
    idx = H.findIndex((h) => h.includes(clean));
    return idx;
  };

  // 列名优先级高于值优先级：先按列名顺序找第一个能取到有效值的列
  const get = (...names) => {
    for (const n of names) {
      const idx = resolve(n);
      if (idx < 0) continue;
      const raw = cells[idx];
      if (raw === undefined) continue;
      const v = String(raw).trim();
      if (!v) continue;
      if (DATE_KEYS.includes(n) && !/\d{4}[-年\/]\d/.test(v)) continue;
      return v;
    }
    return '';
  };

  const rawDate = get('交易时间', '交易日期', '记账日期', '日期', '支付时间', '入账日期', '时间');
  const date = normDate(rawDate);
  if (!date) return null;
  const time = normTime(rawDate);

  let amount = normAmount(get('金额', '发生额', '交易金额', '收支金额'));
  const dirText = get('收/支', '收支', '收支类型', '资金流向');
  const typeText = get('交易类型', '类型', '交易分类', '业务类型');

  if (amount === null) {
    const outAmt = normAmount(get('支出', '支出金额', '付款金额'));
    const inAmt = normAmount(get('收入', '收入金额', '收款金额'));
    if (outAmt) amount = outAmt;
    else if (inAmt) amount = inAmt;
    else return null;
  }
  if (!amount || amount <= 0) return null;

  let direction = 'out';
  const dt = String(dirText || '');
  if (/^收|收入|转入|入账|收款/.test(dt)) direction = 'in';
  if (/不计收支/.test(dt)) return null;
  if (!dt) {
    const inAmt = normAmount(get('收入', '收入金额', '收款金额'));
    if (inAmt && !normAmount(get('支出', '支出金额', '付款金额'))) direction = 'in';
  }
  if (/退款|退款成功|退货/.test(typeText || '')) direction = 'in';

  const merchant = get('交易对方', '商户名称', '对方', '收款方', '对方名称', '商户') || get('商品', '商品名称', '商品说明');
  const desc = get('商品说明', '商品', '备注', '交易说明', '摘要', '用途') || '';
  const payMethod = get('收/付款方式', '支付方式', '付款方式', '银行卡') || '';
  const sourceTag = /支付宝/.test(header.join('')) || /支付宝/.test(desc) ? 'alipay' : /微信/.test(header.join('')) ? 'wechat' : 'bank';
  const merchantName = merchant || (desc || '未知').slice(0, 24);

  return {
    tx_date: date,
    tx_time: time,
    merchant: merchantName,
    description: [desc, payMethod].filter(Boolean).join(' · ').slice(0, 200),
    amount: +amount.toFixed(2),
    direction,
    category: guess(`${merchantName} ${desc}`, direction),
    source: sourceTag,
    raw_hash: hash(`${date}|${time}|${merchantName}|${amount}|${direction}|${sourceTag}`)
  };
}


function findNextSig(buf, from) {
  for (let k = from; k < buf.length - 4; k++) {
    if (buf[k] === 0x50 && buf[k + 1] === 0x4b) return k;
  }
  return -1;
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractSharedStrings(xml) {
  const out = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) {
    const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXml(x[1]));
    out.push(texts.join(''));
  }
  return out;
}

function extractSheetRows(xml, shared) {
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const cells = [];
    const cellRe = /<c([^>]*)>([\s\S]*?)<\/c>/g;
    let cm;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1];
      const body = cm[2];
      const tMatch = attrs.match(/t="([^"]+)"/);
      const type = tMatch ? tMatch[1] : 'n';
      const vMatch = body.match(/<v>([\s\S]*?)<\/v>/);
      const isMatch = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
      let val = '';
      if (type === 's' && vMatch) val = shared[parseInt(vMatch[1], 10)] || '';
      else if (type === 'inlineStr' && isMatch) val = decodeXml(isMatch[1]);
      else if (vMatch) val = decodeXml(vMatch[1]);
      cells.push(val);
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/* 对外：解析文件 → 交易记录数组 */
export async function parseFile(file, guess) {
  const name = file.name.toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());
  let rows = [];

  if (name.endsWith('.xlsx')) {
    const entries = await readZipEntriesAsync(buf);
    const dec = new TextDecoder('utf-8');
    const shared = entries['xl/sharedStrings.xml'] ? extractSharedStrings(dec.decode(entries['xl/sharedStrings.xml'])) : [];
    const sheetName =
      Object.keys(entries).find((n) => /^xl\/worksheets\/sheet1\.xml$/.test(n)) ||
      Object.keys(entries).find((n) => /^xl\/worksheets\//.test(n));
    if (!sheetName) return { records: [], error: '未能读取 Excel 工作表' };
    rows = extractSheetRows(dec.decode(entries[sheetName]), shared);
  } else if (name.endsWith('.xls')) {
    return { records: [], error: '旧版 .xls 格式请在 Excel/WPS 中另存为 .csv 或 .xlsx 后再导入' };
  } else {
    const text = readTextSmart(buf);
    rows = splitRows(text).map(parseCsvLine);
  }

  const hi = findHeaderRow(rows.map((r) => r.join(',')));
  if (hi < 0) {
    return { records: [], error: '没找到账单表头（需要同时包含日期和金额列），请确认导出的是账单明细文件' };
  }
  const header = rows[hi];
  const records = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const cells = rows[i];
    if (!cells || cells.length < 3) continue;
    const rec = extractRecord(header, cells, guess);
    if (rec) records.push(rec);
  }

  const income = records.filter((r) => r.direction === 'in').reduce((a, b) => a + b.amount, 0);
  const expense = records.filter((r) => r.direction === 'out').reduce((a, b) => a + b.amount, 0);
  const byCategory = {};
  records.forEach((r) => {
    byCategory[r.category] = (byCategory[r.category] || 0) + r.amount;
  });
  const dates = records.map((r) => r.tx_date).sort();

  return {
    records,
    header,
    stats: {
      count: records.length,
      income: +income.toFixed(2),
      expense: +expense.toFixed(2),
      byCategory,
      dateRange: dates.length ? [dates[0], dates[dates.length - 1]] : null
    }
  };
}

/* 解压 zip 里的 deflate-raw 数据。
   浏览器原生支持：DecompressionStream('deflate-raw')，不需要引第三方库。
   旧内核不支持时给出明确错误，由调用方决定怎么提示。 */
async function inflateRawAsync(data) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器不支持解压 xlsx（需要 Chrome/Edge 103+ 或 Safari 16.4+）');
  }
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data]).stream().pipeThrough(ds);
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

async function readZipEntriesAsync(buf) {
  const out = {};
  let i = 0;
  while (i < buf.length - 4) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const dv = new DataView(buf.buffer, buf.byteOffset + i);
      const method = dv.getUint16(8, true);
      let compSize = dv.getUint32(18, true);
      const nameLen = dv.getUint16(26, true);
      const extraLen = dv.getUint16(28, true);
      const name = new TextDecoder('utf-8').decode(buf.slice(i + 30, i + 30 + nameLen));
      const dataStart = i + 30 + nameLen + extraLen;
      if (compSize === 0) {
        const next = findNextSig(buf, dataStart);
        compSize = next > 0 ? next - dataStart : 0;
      }
      const data = buf.slice(dataStart, dataStart + compSize);
      try {
        out[name] = method === 0 ? data : await inflateRawAsync(data);
      } catch (e) {
        out[name] = new Uint8Array(0);
      }
      i = dataStart + compSize;
    } else i++;
  }
  return out;
}
