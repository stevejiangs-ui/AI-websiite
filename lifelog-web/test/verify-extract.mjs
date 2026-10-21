/* 多格式文字提取回归：docx / pdf / 纯文本 / 不支持的格式。

   跑法：node test/verify-extract.mjs
   这些解析器有一个通病：出错时不会抛异常，而是安静地吐出空字符串，
   页面上表现为「导入了但什么都没进来」。所以每一条都得断言实际内容。
*/

import { deflateRawSync } from 'node:zlib';
import { docxXmlToText, pdfContentToText, unescapePdfString, extractText, extOf, canExtractText } from '../src/doc-extract.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + extra : ''));
  }
};

/* ---------- 1. docx 正文解析 ---------- */
console.log('\n[docx]');
{
  const xml = `<?xml version="1.0"?><w:document><w:body>
    <w:p><w:r><w:t>7月10日 和老婆去了墨尔本</w:t></w:r></w:p>
    <w:p><w:r><w:t>花了 380 澳元</w:t></w:r><w:r><w:t xml:space="preserve"> 住宿</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>日期</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>金额</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body></w:document>`;
  const text = docxXmlToText(xml);
  ok('取到第一段', text.includes('7月10日 和老婆去了墨尔本'), text.slice(0, 60));
  ok('同一段的两截拼起来', text.includes('花了 380 澳元 住宿'), text.slice(0, 80));
  ok('段落之间有换行', text.split('\n').filter(Boolean).length >= 3, text.split('\n').length);
  ok('表格单元格用制表符分隔', text.includes('日期\t金额'), JSON.stringify(text.split('\n').slice(-2)));
  ok('实体被还原', docxXmlToText('<w:p><w:r><w:t>a &amp; b &lt;c&gt;</w:t></w:r></w:p>') === 'a & b <c>');
  ok('w:br 变换行', docxXmlToText('<w:p><w:r><w:t>上</w:t><w:br/><w:t>下</w:t></w:r></w:p>') === '上\n下');
}

/* ---------- 2. PDF 字符串与内容流 ---------- */
console.log('\n[pdf]');
{
  ok('转义括号', unescapePdfString('a \\(b\\) c') === 'a (b) c');
  ok('八进制转义', unescapePdfString('\\101\\102') === 'AB', unescapePdfString('\\101\\102'));
  ok('换行转义', unescapePdfString('a\\nb') === 'a\nb');

  const content = 'BT /F1 12 Tf 100 700 Td (2023-07-10 墨尔本 380) Tj T* (2023-07-11 越南粉 15) Tj ET';
  const text = pdfContentToText(content);
  ok('Tj 抽出两行', text.split('\n').length === 2, JSON.stringify(text));
  ok('内容正确', text.includes('墨尔本 380') && text.includes('越南粉 15'));
  ok('TJ 数组也能抽', pdfContentToText('BT [(abc) -20 (def)] TJ ET').includes('abcdef'), pdfContentToText('BT [(abc) -20 (def)] TJ ET'));
  ok('不是文字的操作符不抽', pdfContentToText('BT 1 0 0 1 10 10 cm ET') === '');
}

/* ---------- 3. 真·zip 解压（docx 本质是 zip） ---------- */
console.log('\n[zip / 端到端]');
{
  /* 手工造一个最小 zip：本地文件头 + deflate 数据。读取器是按 PK\\x03\\x04 顺扫的，
     不需要中央目录，所以这样造出来的能直接读。 */
  function makeZip(files) {
    const chunks = [];
    for (const [name, content] of Object.entries(files)) {
      const nameBuf = Buffer.from(name, 'utf8');
      const raw = Buffer.from(content, 'utf8');
      const comp = deflateRawSync(raw);
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0);
      head.writeUInt16LE(20, 4);
      head.writeUInt16LE(0, 6);
      head.writeUInt16LE(8, 8); /* deflate */
      head.writeUInt32LE(comp.length, 18);
      head.writeUInt32LE(raw.length, 22);
      head.writeUInt16LE(nameBuf.length, 26);
      head.writeUInt16LE(0, 28);
      chunks.push(head, nameBuf, comp);
    }
    return Buffer.concat(chunks);
  }

  const docXml = '<w:document><w:body><w:p><w:r><w:t>2024年2月14日 情人节吃饭 120 澳元</w:t></w:r></w:p></w:body></w:document>';
  const zip = makeZip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': docXml });
  const file = new File([zip], '旧日记.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

  const r = await extractText(file);
  ok('docx 端到端读到正文', !r.error && r.text.includes('情人节吃饭 120 澳元'), r.error || r.text);

  /* PDF：未压缩内容流，能直接抽 */
  /* PDF 的字符串是字节流，中文都走 CID 字体，这里用 ASCII 内容验证「能抽出来」 */
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n2 0 obj << /Length 90 >>\nstream\nBT /F1 12 Tf (2022-01-05 grocery 66.50) Tj T* (2022-01-06 taxi 23.00) Tj ET\nendstream\nendobj\ntrailer << >>\n%%EOF',
    'latin1'
  );
  const pr = await extractText(new File([pdf], 'bill.pdf', { type: 'application/pdf' }));
  ok('PDF 未压缩流读到文字', !pr.error && pr.text.includes('grocery') && pr.text.includes('taxi'), pr.error || pr.text);

  /* 扫描件模拟：内容里没有文字 → 必须给出可操作的提示，而不是空结果 */
  const blank = Buffer.from('%PDF-1.4\nstream\nq 100 0 0 100 0 0 cm /Im0 Do Q\nendstream\n%%EOF', 'latin1');
  const br = await extractText(new File([blank], '扫描件.pdf', { type: 'application/pdf' }));
  ok('读不出字时给明确提示', !!br.error && /扫描|子集|转成/.test(br.error), br.error);

  /* 纯文本：UTF-8 与 GBK 都要认 */
  const txt = await extractText(new File([Buffer.from('2021-06-01 吃饭 88\n2021-06-02 加油 200', 'utf8')], 'a.txt'));
  ok('UTF-8 纯文本', txt.text.includes('吃饭 88'));

  const doc = await extractText(new File([Buffer.from('abc', 'utf8')], 'old.doc'));
  ok('老 .doc 给转格式提示', !!doc.error && /docx/.test(doc.error), doc.error);
}

/* ---------- 4. 格式判断 ---------- */
console.log('\n[格式判断]');
{
  ok('extOf 取扩展名', extOf('a.B.DOCX') === '.docx', extOf('a.B.DOCX'));
  ok('没有扩展名返回空', extOf('readme') === '');
  ok('docx 可抠文字', canExtractText('x.docx'));
  ok('pdf 可抠文字', canExtractText('x.pdf'));
  ok('xlsx 不在这里处理', !canExtractText('x.xlsx'));
  ok('doc 不在这里处理（走提示）', !canExtractText('x.doc'));
}

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail ? 1 : 0);
