/* 消费记录：所有消费/收入在一页看完，并且能把各种格式的旧账导进来。

   两个标签：
     记录 —— 按月筛选的全量台账：收支合计、分类排行、逐笔明细；可导出成
             Markdown / Excel 能开的 CSV，也可以顺手导出整份生活档案。
     导入 —— 直接复用账单页那套导入器（Excel / CSV / Word / PDF / 纯文本），
             一份实现两处用，不搞两套逻辑。

   与「账单」页的分工：账单页管「这个月花了什么、记账和改分类」，
   这里管「从头到尾的所有记录 + 把外面那些账搬进来」。
*/

import { h, render, toast, state, ask } from './store.js';
import { listTransactions, computeStats, fmtMoney, CATEGORY_COLORS, currentMonth } from './cloud.js';
import { importBody } from './view-import.js';
import { composeDoc } from './archive-doc.js';
import { download, stamp, toCsv } from './exporter.js';

const S = {
  tab: 'list', /* list | import */
  loading: false,
  loaded: false,
  err: '',
  month: '', /* '' = 全部 */
  rows: [],
  stats: null
};

/* ---------------- 数据 ---------------- */

/* 导入器在别的页面写完成之后会发这个事件：当前停在这一页就刷新一下，
   不用手动退出去再进来。 */
if (typeof window !== 'undefined') {
  window.addEventListener('lifelog-tx-changed', () => {
    if (state.view === 'records' || state.view === 'archive') loadRecords();
  });
}

export async function loadRecords() {
  S.loading = true;
  render();
  try {
    const rows = await listTransactions({ month: S.month || undefined, limit: 800 });
    S.rows = rows || [];
    S.stats = computeStats(S.rows);
    S.loaded = true;
    S.err = '';
  } catch (e) {
    S.err = e.message || String(e);
  } finally {
    S.loading = false;
    render();
  }
}

function setMonth(m) {
  S.month = m;
  loadRecords();
}

function switchTab(t) {
  S.tab = t;
  render();
}

/* ---------------- 导出 ---------------- */

function mdOf(list) {
  const L = [];
  const s = computeStats(list);
  L.push(`# 消费记录${S.month ? '（' + S.month + '）' : '（全部）'}`);
  L.push('');
  L.push(`导出时间：${new Date().toLocaleString('zh-CN')}`);
  L.push(`共 ${list.length} 笔，支出 ${fmtMoney(s.totals.out)}，收入 ${fmtMoney(s.totals.in)}，结余 ${fmtMoney(s.totals.in - s.totals.out)}`);
  L.push('');
  if (s.catList.length) {
    L.push('## 分类');
    L.push('');
    const outTotal = s.totals.out || 0;
    s.catList.forEach((c) => {
      const pct = outTotal ? Math.round((c.value / outTotal) * 100) : 0;
      L.push(`- ${c.name}：${fmtMoney(c.value)}（占支出 ${pct}%）`);
    });
    L.push('');
  }
  L.push('## 明细');
  L.push('');
  list
    .slice()
    .sort((a, b) => String(b.tx_date).localeCompare(String(a.tx_date)))
    .forEach((t) => {
      L.push(
        `- ${t.tx_date}${t.tx_time ? ' ' + String(t.tx_time).slice(0, 5) : ''} ${t.merchant || t.description || '（未命名）'} ${
          t.direction === 'in' ? '+' : '-'
        }${fmtMoney(t.amount)}${t.category ? '｜' + t.category : ''}${t.source === 'doc' ? '（文档导入）' : ''}`
      );
    });
  return L.join('\n');
}

function downloadMd() {
  download(`消费记录-${stamp()}.md`, new Blob([mdOf(S.rows)], { type: 'text/markdown;charset=utf-8' }));
  toast('已导出 Markdown');
}

function downloadCsv() {
  const csv = toCsv(S.rows, [
    { label: '日期', key: 'tx_date' },
    { label: '时间', key: 'tx_time' },
    { label: '商户', key: 'merchant' },
    { label: '说明', key: 'description' },
    { label: '金额', key: 'amount' },
    { label: '方向', get: (r) => (r.direction === 'in' ? '收入' : '支出') },
    { label: '分类', key: 'category' },
    { label: '来源', key: 'source' }
  ]);
  download(`消费记录-${stamp()}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  toast('已导出 CSV，Excel 直接打开');
}

/* 整份生活档案（含经历与行程）—— 之前「档案」页的能力，留在这里不丢 */
function downloadLifeDoc() {
  const entries = state.entries || [];
  const tasks = state.tasks || [];
  const doc = composeDoc({ entries, tasks, places: state.places || [], tx: S.rows });
  download(`生活档案-${stamp()}.md`, new Blob([doc], { type: 'text/markdown;charset=utf-8' }));
  toast('已导出生活档案（含经历 / 行程 / 消费）');
}

/* ---------------- 界面 ---------------- */

export function recordsView() {
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        {},
        h('h1', {}, '消费记录'),
        h(
          'p',
          { class: 'desc' },
          S.loaded ? `${S.month || '全部时间'} · ${S.rows.length} 笔` : '所有消费和收入，一页看完；旧账可以整份导进来'
        )
      ),
      h(
        'div',
        { class: 'toolbar' },
        h(
          'div',
          { class: 'seg' },
          ...[
            { k: 'list', l: '记录' },
            { k: 'import', l: '导入' }
          ].map((t) => h('button', { class: S.tab === t.k ? 'on' : '', onclick: () => switchTab(t.k) }, t.l))
        )
      )
    ),

    S.err ? h('div', { class: 'err', style: 'margin-bottom:12px' }, S.err) : null,

    S.tab === 'import' ? importBody() : listPanel()
  );
}

function listPanel() {
  const s = S.stats || { totals: { in: 0, out: 0 }, catList: [] };
  const list = S.rows || [];
  const maxCat = stillMax(s.catList);

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'toolbar', style: 'margin-bottom:14px;flex-wrap:wrap;gap:8px' },
      h('input', {
        type: 'month',
        class: 'input',
        style: 'width:150px;height:34px',
        value: S.month,
        onchange: (ev) => setMonth(ev.target.value)
      }),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => setMonth('') }, '全部时间'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => setMonth(currentMonth()) }, '本月'),
      h('div', { style: 'flex:1' }),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: downloadCsv }, '导出 CSV'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: downloadMd }, '导出 Markdown'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: downloadLifeDoc }, '整份生活档案')
    ),

    h(
      'div',
      { class: 'grid g3', style: 'margin-bottom:16px' },
      kpi('支出合计', fmtMoney(s.totals.out), 'out', `${list.filter((t) => t.direction !== 'in').length} 笔`),
      kpi('收入合计', fmtMoney(s.totals.in), 'in', `${list.filter((t) => t.direction === 'in').length} 笔`),
      kpi('结余', fmtMoney(s.totals.in - s.totals.out), '', list.length ? `${list.length} 笔合计` : '还没有记录')
    ),

    s.catList && s.catList.length
      ? h(
          'div',
          { class: 'card', style: 'margin-bottom:16px' },
          h('h3', { class: 'card-title' }, '分类占比'),
          h(
            'div',
            { style: 'margin-top:10px' },
            ...s.catList.slice(0, 10).map((c) =>
              h(
                'div',
                { style: 'margin-bottom:10px' },
                h(
                  'div',
                  { class: 'row-between', style: 'font-size:12.5px;margin-bottom:4px' },
                  h('span', {}, c.name),
                  h(
                    'span',
                    { class: 'muted' },
                    `${fmtMoney(c.value)}${s.totals.out ? ' · ' + Math.round((c.value / s.totals.out) * 100) + '%' : ''}`
                  )
                ),
                h(
                  'div',
                  { style: 'height:6px;border-radius:3px;background:var(--surface-2);overflow:hidden' },
                  h('div', {
                    style: `height:100%;width:${maxCat ? Math.round((c.value / maxCat) * 100) : 0}%;background:${
                      CATEGORY_COLORS[c.name] || '#b5762a'
                    }`
                  })
                )
              )
            )
          )
        )
      : null,

    list.length
      ? h(
          'div',
          { class: 'card' },
          h('h3', { class: 'card-title' }, '逐笔明细'),
          h(
            'div',
            { style: 'margin-top:8px;max-height:560px;overflow:auto' },
            ...list
              .slice()
              .sort((a, b) => String(b.tx_date).localeCompare(String(a.tx_date)) || String(b.id).localeCompare(String(a.id)))
              .slice(0, 300)
              .map((t) =>
                h(
                  'div',
                  {
                    class: 'row-between',
                    style: 'padding:9px 0;border-bottom:1px solid var(--line);font-size:13px;gap:10px'
                  },
                  h(
                    'div',
                    { style: 'min-width:0' },
                    h('div', { style: 'font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, t.merchant || t.description || '未命名'),
                    h(
                      'div',
                      { class: 'muted', style: 'font-size:11.5px' },
                      `${t.tx_date}${t.category ? ' · ' + t.category : ''}${t.source === 'doc' ? ' · 文档导入' : ''}`
                    )
                  ),
                  h(
                    'div',
                    {
                      style: `white-space:nowrap;font-variant-numeric:tabular-nums;color:${t.direction === 'in' ? '#4f8f4a' : 'var(--ink)'}`
                    },
                    (t.direction === 'in' ? '+' : '-') + fmtMoney(t.amount)
                  )
                )
              )
          ),
          list.length > 300 ? h('p', { class: 'muted', style: 'margin:10px 0 0;font-size:12px' }, '只显示最近 300 笔；导出可拿全量。') : null
        )
      : h(
          'div',
          { class: 'card' },
          h('div', { class: 'empty' }, h('div', { class: 'big' }, '🧾'), h('p', {}, '这段时间还没有记录')),
          h(
            'button',
            { class: 'btn btn-accent', style: 'margin-top:8px', onclick: () => switchTab('import') },
            '去导入旧账'
          )
        )
  );
}

function stillMax(catList) {
  if (!catList || !catList.length) return 0;
  return Math.max(...catList.map((c) => c.value));
}

function kpi(label, value, cls, sub) {
  return h(
    'div',
    { class: 'card', style: 'padding:14px 16px' },
    h('div', { class: 'muted', style: 'font-size:12px' }, label),
    h(
      'div',
      {
        style: `font-size:22px;font-weight:600;margin:6px 0 2px;font-variant-numeric:tabular-nums;color:${
          cls === 'in' ? '#4f8f4a' : cls === 'out' ? '#b5623a' : 'var(--ink)'
        }`
      },
      value
    ),
    h('div', { class: 'muted', style: 'font-size:11.5px' }, sub || '')
  );
}
