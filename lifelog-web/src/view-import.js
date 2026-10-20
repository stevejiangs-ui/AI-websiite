import { h, setState, render, toast, state } from './store.js';
import { applyRules, CATEGORIES, categoriesFor, INCOME_CATEGORIES, EXPENSE_CATEGORIES, CATEGORY_COLORS, fmtMoney, batchInsertTransactions } from './cloud.js';
import { parseFile } from './importer.js';
import { categorizeWithAI } from './ai.js';
import { loadTx } from './view-tx.js';

const S = { preview: null, busy: false, source: 'auto', useAI: true, progress: '', parsed: null };

export function importView() {
  const p = S.preview;
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, '导入账单'), h('p', { class: 'desc' }, '支持支付宝 / 微信支付导出的 CSV，以及银行 App 导出的 CSV、Excel')),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => setState({ view: 'tx' }) }, '← 返回账单')
    ),

    p ? previewCard(p) : dropCard(),

    h('div', { class: 'card', style: 'margin-top:16px' },
      h('h3', { class: 'card-title' }, '怎么导出账单？'),
      h('div', { class: 'grid g3' },
        tipCard('支付宝', '我的 → 账单 → 右上角「···」→ 开具交易流水证明 → 选择时间范围 → 发送到邮箱 → 下载 CSV'),
        tipCard('微信支付', '我 → 服务 → 钱包 → 账单 → 常见问题 → 下载账单 → 用于个人对账 → 邮箱接收 → 解压得到 CSV'),
        tipCard('银行 App', '各银行 App 的「交易明细 / 流水」页面都有导出功能，选 CSV 或 Excel 即可')
      ),
      h('p', { class: 'muted', style: 'margin:14px 0 0' }, '提示：导入时会按「商户 + 金额 + 时间」自动去重，重复导入同一份文件不会产生重复记录。')
    )
  );
}

function tipCard(title, text) {
  return h(
    'div',
    { style: 'padding:14px;border-radius:10px;background:var(--surface-2)' },
    h('div', { style: 'font-weight:500;margin-bottom:6px' }, title),
    h('div', { class: 'muted', style: 'line-height:1.7' }, text)
  );
}

function dropCard() {
  return h(
    'div',
    { class: 'card' },
    h(
      'div',
      {
        class: 'drop',
        onclick: () => pickFile(),
        ondragover: (ev) => {
          ev.preventDefault();
          ev.currentTarget.classList.add('over');
        },
        ondragleave: (ev) => ev.currentTarget.classList.remove('over'),
        ondrop: async (ev) => {
          ev.preventDefault();
          ev.currentTarget.classList.remove('over');
          const f = ev.dataTransfer.files?.[0];
          if (f) await handleFile(f);
        }
      },
      h('div', { class: 'big' }, '⇪'),
      h('b', {}, S.busy ? '正在解析…' : '点击选择文件，或把账单拖到这里'),
      h('span', {}, '支持 .csv / .xlsx（旧版 .xls 请先另存为 csv）')
    ),
    h('input', {
      type: 'file',
      id: 'file-input',
      accept: '.csv,.txt,.xlsx',
      style: 'display:none',
      onchange: async (ev) => {
        const f = ev.target.files?.[0];
        if (f) await handleFile(f);
      }
    }),
    S.progress ? h('div', { class: 'muted', style: 'margin-top:12px;text-align:center' }, S.progress) : null
  );
}

function pickFile() {
  document.getElementById('file-input')?.click();
}

async function handleFile(file) {
  if (S.busy) return;
  S.busy = true;
  S.progress = '正在读取文件…';
  render();
  try {
    const result = await parseFile(file, applyRules);
    if (result.error) {
      toast(result.error, 'err');
      S.busy = false;
      S.progress = '';
      render();
      return;
    }
    if (!result.records.length) {
      toast('没有解析到有效记录，请检查文件格式', 'err');
      S.busy = false;
      S.progress = '';
      render();
      return;
    }
    S.parsed = result;
    S.preview = { records: result.records, stats: result.stats, fileName: file.name };
    S.busy = false;
    S.progress = '';
    render();

    if (S.useAI) {
      await runAI();
    }
  } catch (e) {
    toast('解析失败：' + (e.message || e), 'err');
    S.busy = false;
    S.progress = '';
    render();
  }
}

async function runAI() {
  if (!S.preview) return;
  const records = S.preview.records;
  const todo = records.filter((r) => !r.ai);
  if (!todo.length) return;
  S.busy = true;
  S.progress = `AI 正在为 ${todo.length} 笔交易自动分类…`;
  render();
  try {
    const out = await categorizeWithAI(todo, CATEGORIES);
    const map = new Map(out.map((r) => [r.raw_hash, r]));
    S.preview.records = records.map((r) => {
      const hit = map.get(r.raw_hash);
      return hit && hit.ai ? { ...r, category: hit.category, ai: true } : r;
    });
    S.progress = '';
  } catch (e) {
    toast('AI 分类失败，已保留规则分类：' + (e.message || e), 'err');
    S.progress = '';
  } finally {
    S.busy = false;
    render();
  }
}

function previewCard(p) {
  const s = p.stats;
  const aiCount = p.records.filter((r) => r.ai).length;
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'grid g4', style: 'margin-bottom:16px' },
      kpi('识别到', String(s.count) + ' 笔', `${p.fileName}`),
      kpi('支出合计', fmtMoney(s.expense), s.expense > 0 ? 'color:var(--red)' : ''),
      kpi('收入合计', fmtMoney(s.income), s.income > 0 ? 'color:var(--green)' : ''),
      kpi('时间范围', s.dateRange ? `${s.dateRange[0].slice(5)} ~ ${s.dateRange[1].slice(5)}` : '-', s.dateRange ? s.dateRange[0].slice(0, 4) : '')
    ),
    h(
      'div',
      { class: 'card', style: 'margin-bottom:16px' },
      h(
        'div',
        { class: 'row-between' },
        h(
          'div',
          {},
          h('h3', { class: 'card-title', style: 'margin:0' }, '分类结果'),
          h('div', { class: 'muted', style: 'margin-top:4px' }, aiCount ? `AI 已自动处理 ${aiCount} 笔，可直接修改` : '基于关键词规则分类，可手动调整')
        ),
        h(
          'div',
          { class: 'row' },
          h(
            'button',
            { class: 'btn btn-sm btn-ghost', disabled: S.busy, onclick: () => runAI() },
            S.busy ? h('span', { class: 'spinner' }) : 'AI 重新分类'
          ),
          h(
            'button',
            { class: 'btn btn-accent', disabled: S.busy, onclick: commitImport },
            `确认导入 ${p.records.length} 笔`
          )
        )
      ),
      S.progress ? h('div', { class: 'muted', style: 'margin-top:10px' }, S.progress) : null
    ),
    h(
      'div',
      { class: 'table-wrap', style: 'max-height:460px;overflow:auto' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, '日期'), h('th', {}, '商户'), h('th', {}, '分类'), h('th', { style: 'text-align:right' }, '金额'))),
        h(
          'tbody',
          {},
          ...p.records.slice(0, 300).map((r, i) =>
            h(
              'tr',
              {},
              h('td', { class: 'mono' }, r.tx_date),
              h(
                'td',
                {},
                h('div', { style: 'font-weight:500' }, r.merchant),
                r.description ? h('div', { class: 'muted', style: 'font-size:11.5px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, r.description) : null
              ),
              h(
                'td',
                {},
                h(
                  'select',
                  {
                    class: 'cat-select',
                    style: `color:${CATEGORY_COLORS[r.category] || '#5c5852'}`,
                    onchange: (ev) => {
                      S.preview.records[i].category = ev.target.value;
                      render();
                    }
                  },
                  ...categoriesFor(r.direction).map((c) => h('option', { value: c, selected: r.category === c }, c))
                )
              ),
              h(
                'td',
                { class: 'num', style: r.direction === 'in' ? 'color:var(--green)' : '' },
                (r.direction === 'in' ? '+' : '-') + r.amount.toFixed(2)
              )
            )
          )
        )
      )
    ),
    h(
      'div',
      { class: 'row', style: 'margin-top:16px' },
      h(
        'button',
        {
          class: 'btn btn-ghost',
          onclick: () => {
            S.preview = null;
            S.parsed = null;
            render();
          }
        },
        '换一个文件'
      ),
      h('button', { class: 'btn btn-accent', disabled: S.busy, onclick: commitImport }, '确认导入')
    )
  );
}

function kpi(label, value, color) {
  return h(
    'div',
    { class: 'kpi' },
    h('div', { class: 'lbl' }, label),
    h('div', { class: 'val', style: `font-size:20px;${color || ''}` }, value)
  );
}

async function commitImport() {
  if (!S.preview || S.busy) return;
  S.busy = true;
  S.progress = '正在写入云端…';
  render();
  try {
    const lastDate = S.preview.stats?.dateRange?.[1];
    const res = await batchInsertTransactions(S.preview.records, state.session);
    toast(`导入完成：新增 ${res.inserted} 笔${res.skipped ? `，跳过重复 ${res.skipped} 笔` : ''}`);
    S.preview = null;
    S.parsed = null;
    S.progress = '';
    S.busy = false;
    setState({ view: 'tx', txMonth: lastDate ? lastDate.slice(0, 7) : state.txMonth });
    await loadTx();
  } catch (e) {
    S.busy = false;
    S.progress = '';
    render();
    toast('导入失败：' + (e.message || e), 'err');
  }
}
