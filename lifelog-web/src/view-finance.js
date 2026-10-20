/* 财务视图：趋势 / 预算 / 账户 / 洞察。
   一个页面回答四个问题：钱去哪了、我还有多少、有没有超、接下来怎么办。 */

import { h, setState, render, toast, state, ask } from './store.js';
import { fmtMoney, EXPENSE_CATEGORIES, CATEGORY_COLORS, INCOME_CATEGORIES } from './cloud.js';
import { incomeMix, debtSummary, incomeCard } from './view-income.js';
import {
  listAllTransactions,
  trendSeries,
  byMonth,
  compare,
  categoryShift,
  listBudgets,
  saveBudget,
  budgetStatus,
  listAccounts,
  saveAccount,
  deleteAccount,
  netWorth,
  insights,
  recurringHits,
  outliers,
  monthLabel,
  shiftMonth,
  recentMonths,
  accountKind,
  ACCOUNT_KINDS
} from './finance.js';

/* 本页局部 UI 状态（不进全局 store，避免污染） */
let fin = {
  month: '',
  range: 12,
  editingBudget: '',
  budgetDraft: '',
  editingAccount: null
};

function curMonth() {
  return new Date().toISOString().slice(0, 7);
}

function M() {
  return fin.month || curMonth();
}

/* ---------------- 加载 ---------------- */

export async function loadFinance() {
  setState({ loading: true });
  try {
    const [rows, budgets, accounts] = await Promise.all([listAllTransactions(), listBudgets(''), listAccounts()]);
    fin.rows = rows;
    fin.budgets = budgets;
    fin.accounts = accounts;
    setState({ loading: false });
    render();
  } catch (e) {
    setState({ loading: false });
    toast('财务数据加载失败：' + (e.message || e), 'err');
  }
}

function ready() {
  return Array.isArray(fin.rows);
}

/* ---------------- 视图 ---------------- */

export function financeView() {
  if (!ready()) {
    return h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, '财务'), h('p', { class: 'desc' }, '正在读取…')));
  }

  const month = M();
  const series = trendSeries(fin.rows, fin.range, month);
  const agg = byMonth(fin.rows);
  const monthAgg = agg.find((b) => b.month === month) || { income: 0, expense: 0, cats: {}, days: {}, count: 0 };
  const cmp = compare(series);
  const shift = categoryShift(fin.rows, month, shiftMonth(month, -1));
  const budget = budgetStatus(fin.budgets || [], monthAgg);
  const nw = netWorth(fin.accounts || []);
  const ins = insights({ series, shift, budget });
  const monthRows = fin.rows.filter((t) => String(t.tx_date).startsWith(month));
  const mix = incomeMix(fin.rows, month);
  const debt = debtSummary(fin.accounts || []);

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, '财务'), h('p', { class: 'desc' }, `${monthLabel(month)} · 共 ${fin.rows.length} 笔流水`)),
      h(
        'div',
        { class: 'toolbar' },
        h('input', {
          type: 'month',
          class: 'input',
          style: 'width:150px;height:34px',
          value: month,
          onchange: (ev) => {
            fin.month = ev.target.value || curMonth();
            render();
          }
        }),
        h(
          'button',
          {
            class: 'btn btn-sm btn-ghost',
            onclick: () => import('./view-expert.js').then((m) => m.openExpert('finance'))
          },
          '🧑‍💼 问财务师'
        ),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { setState({ view: 'tx' }); } }, '看流水明细'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { setState({ view: 'import' }); } }, '导入账单')
      )
    ),

    /* KPI */
    h(
      'div',
      { class: 'fin-kpi-row' },
      finKpi('本月支出', fmtMoney(monthAgg.expense), cmp?.mom, monthAgg.count ? `${monthAgg.count} 笔` : '暂无记录', '#b4552f'),
      finKpi('本月收入', fmtMoney(monthAgg.income), null, incomeHint(monthAgg), '#3f8c5e'),
      finKpi('本月结余', fmtMoney(monthAgg.income - monthAgg.expense), null, saveRateText(monthAgg), monthAgg.income >= monthAgg.expense ? '#3f8c5e' : '#b4552f'),
      finKpi('净资产', fmtMoney(nw.net), null, `资产 ${fmtMoney(nw.assets)} / 负债 ${fmtMoney(nw.debts)}`, '#4a6fa5')
    ),

    /* 洞察 */
    h(
      'div',
      { class: 'insight-card' },
      ...ins.map((i) =>
        h('div', { class: 'insight-item' }, h('span', { class: 'insight-dot ' + i.tone }), h('span', {}, i.text))
      )
    ),

    /* 趋势 */
    trendCard(series, month),

    /* 收入四分法 + 负债 */
    incomeCard({
      mix,
      debt,
      onOpenAccounts: () => {
        /* 滚到账户卡 */
        const el = document.querySelector('.card-acct');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }),

    /* 预算 + 分类变化 */
    h(
      'div',
      { class: 'grid g2', style: 'margin-bottom:16px' },
      budgetCard(budget, month),
      shiftCard(shift)
    ),

    /* 账户 */
    accountCard(nw),

    /* 订阅 + 异常 */
    h(
      'div',
      { class: 'grid g2', style: 'margin-bottom:16px' },
      recurringCard(fin.rows),
      outlierCard(monthRows)
    )
  );
}

/* ---------------- KPI ---------------- */

function finKpi(label, value, deltaPct, sub, color) {
  const up = deltaPct != null && deltaPct > 0;
  const show = deltaPct != null && Math.abs(deltaPct) >= 0.5;
  return h(
    'div',
    { class: 'fin-kpi' },
    h('div', { class: 'lbl' }, label),
    h('div', { class: 'val', style: `color:${color}` }, value),
    h(
      'div',
      { class: 'sub' },
      show
        ? h(
            'span',
            { class: up ? 'delta up' : 'delta down' },
            up ? '▲' : '▼',
            ` ${Math.abs(deltaPct).toFixed(0)}% 环比`
          )
        : h('span', { class: 'delta flat' }, sub || '')
    )
  );
}

function incomeHint(a) {
  if (!a.income) return '本月还没有收入记录';
  const cats = Object.entries(a.cats || {}).length;
  return cats ? `支出覆盖 ${cats} 个分类` : '暂无支出';
}

function saveRateText(a) {
  if (!a.income) return a.expense ? '只有支出，没有收入' : '暂无记录';
  const r = ((a.income - a.expense) / a.income) * 100;
  return r >= 0 ? `存下收入的 ${r.toFixed(0)}%` : `超出收入的 ${Math.abs(r).toFixed(0)}%`;
}

/* ---------------- 趋势折线（手绘 SVG，不引图表库） ---------------- */

function trendCard(series, month) {
  const w = 640;
  const hgt = 180;
  const padL = 8;
  const padB = 24;
  const max = Math.max(...series.map((s) => Math.max(s.income, s.expense)), 1);
  const innerW = w - padL * 2;
  const innerH = hgt - padB - 10;
  const step = series.length > 1 ? innerW / (series.length - 1) : innerW;

  const pt = (i, v) => [padL + i * step, 10 + innerH - (v / max) * innerH];
  const line = (key) =>
    series
      .map((s, i) => {
        const [x, y] = pt(i, s[key]);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  /* 结余为负时用虚线单独表示，避免压到支出线上 */
  const balancePts = series.map((s, i) => {
    const maxAbs = Math.max(...series.map((x) => Math.abs(x.balance)), 1);
    const mid = 10 + innerH / 2;
    return [padL + i * step, mid - (s.balance / maxAbs) * (innerH / 2)];
  });

  return h(
    'div',
    { class: 'card', style: 'margin-bottom:16px' },
    h(
      'h3',
      { class: 'card-title' },
      '收支趋势',
      h(
        'div',
        { class: 'seg seg-sm' },
        ...[6, 12, 24].map((n) =>
          h(
            'button',
            {
              class: fin.range === n ? 'on' : '',
              onclick: () => {
                fin.range = n;
                render();
              }
            },
            `${n} 个月`
          )
        )
      )
    ),
    h(
      'div',
      { class: 'legend' },
      legendDot('#3f8c5e', '收入'),
      legendDot('#b4552f', '支出'),
      legendDot('#5aa9a3', '结余（中点虚线）')
    ),
    h(
      'svg',
      { class: 'trend-svg', viewBox: `0 0 ${w} ${hgt}`, preserveAspectRatio: 'none' },
      /* 网格 */
      ...[0, 0.5, 1].map((r) =>
        h('line', {
          x1: padL,
          y1: (10 + innerH * r).toFixed(1),
          x2: w - padL,
          y2: (10 + innerH * r).toFixed(1),
          stroke: '#ececf0',
          'stroke-width': '1'
        })
      ),
      /* 结余虚线 */
      h('polyline', {
        points: balancePts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '),
        fill: 'none',
        stroke: '#5aa9a3',
        'stroke-width': '1.2',
        'stroke-dasharray': '4 3',
        opacity: '0.75'
      }),
      /* 收入 / 支出 */
      h('path', { d: line('income'), fill: 'none', stroke: '#3f8c5e', 'stroke-width': '1.8', 'stroke-linejoin': 'round' }),
      h('path', { d: line('expense'), fill: 'none', stroke: '#b4552f', 'stroke-width': '1.8', 'stroke-linejoin': 'round' }),
      /* 数据点 */
      ...series.flatMap((s, i) => {
        const [xi, yi] = pt(i, s.income);
        const [xe, ye] = pt(i, s.expense);
        return [
          h('circle', { cx: xi.toFixed(1), cy: yi.toFixed(1), r: '2.6', fill: '#3f8c5e' }),
          h('circle', { cx: xe.toFixed(1), cy: ye.toFixed(1), r: '2.6', fill: '#b4552f' })
        ];
      })
    ),
    h(
      'div',
      { class: 'trend-axis' },
      ...series.map((s) =>
        h('span', { class: s.month === month ? 'on' : '' }, String(Number(s.month.slice(5))) + '月')
      )
    )
  );
}

function legendDot(color, label) {
  return h('span', { class: 'legend-item' }, h('i', { style: `background:${color}` }), label);
}

/* ---------------- 预算 ---------------- */

function budgetCard(budget, month) {
  const rows = budget.rows;
  return h(
    'div',
    { class: 'card' },
    h(
      'h3',
      { class: 'card-title' },
      '预算',
      rows.length
        ? h('span', { class: 'muted' }, `已用 ${fmtMoney(budget.totalUsed)} / ${fmtMoney(budget.totalCap)}`)
        : h('span', { class: 'muted' }, '还没设')
    ),
    rows.length
      ? h(
          'div',
          {},
          ...rows.map((r) =>
            h(
              'div',
              { class: 'budget-row' },
              h('div', { class: 'budget-head' }, h('span', {}, r.category), h('span', { class: 'mono muted' }, `${r.pct.toFixed(0)}%`)),
              h(
                'div',
                { class: 'bar-track' },
                h('div', {
                  class: 'bar-fill',
                  style: `width:${Math.min(r.pct, 100)}%;background:${r.state === 'over' ? '#c0392b' : r.state === 'warn' ? '#d99a33' : r.color}`
                })
              ),
              h(
                'div',
                { class: 'budget-foot' },
                h('span', { class: 'muted' }, `${fmtMoney(r.used)} / ${fmtMoney(r.cap)}`),
                h(
                  'span',
                  { class: r.state === 'over' ? 'amt-over' : 'muted' },
                  r.state === 'over' ? `超 ${fmtMoney(-r.left)}` : `剩 ${fmtMoney(r.left)}`
                ),
                h(
                  'button',
                  {
                    class: 'link-btn',
                    onclick: () => {
                      fin.editingBudget = r.category;
                      fin.budgetDraft = String(r.cap);
                      render();
                    }
                  },
                  '改'
                )
              )
            )
          )
        )
      : h('div', { class: 'muted', style: 'margin-bottom:10px' }, '给几个常花钱的分类设个上限，超了会在这里标红。'),

    /* 设置入口 */
    fin.editingBudget
      ? h(
          'div',
          { class: 'budget-edit' },
          h('div', { class: 'muted', style: 'margin-bottom:6px' }, `「${fin.editingBudget}」每月上限`),
          h(
            'div',
            { class: 'row' },
            h('input', {
              class: 'input',
              type: 'number',
              step: '1',
              placeholder: '例如 2000（填 0 表示取消）',
              value: fin.budgetDraft,
              oninput: (ev) => {
                fin.budgetDraft = ev.target.value;
              }
            }),
            h('button', { class: 'btn btn-accent btn-sm', onclick: () => commitBudget(fin.editingBudget) }, '保存'),
            h('button', {
              class: 'btn btn-ghost btn-sm',
              onclick: () => {
                fin.editingBudget = '';
                render();
              }
            }, '取消')
          )
        )
      : h(
          'div',
          { class: 'row', style: 'margin-top:6px' },
          h(
            'select',
            {
              class: 'input',
              style: 'height:32px',
              onchange: (ev) => {
                if (!ev.target.value) return;
                fin.editingBudget = ev.target.value;
                const hit = rows.find((r) => r.category === ev.target.value);
                fin.budgetDraft = hit ? String(hit.cap) : '';
                render();
              }
            },
            h('option', { value: '' }, '+ 给分类设预算'),
            ...EXPENSE_CATEGORIES.map((c) => h('option', { value: c }, c))
          )
        )
  );
}

async function commitBudget(category) {
  const amt = parseFloat(fin.budgetDraft);
  if (Number.isNaN(amt) || amt < 0) {
    toast('填一个数字', 'err');
    return;
  }
  try {
    await saveBudget(category, '', amt);
    fin.editingBudget = '';
    const bs = await listBudgets('');
    fin.budgets = bs;
    toast(amt > 0 ? `「${category}」预算已设为 ${fmtMoney(amt)}` : `已取消「${category}」预算`);
    render();
  } catch (e) {
    toast('保存失败：' + (e.message || e), 'err');
  }
}

/* ---------------- 分类变化 ---------------- */

function shiftCard(shift) {
  const list = (shift || []).slice(0, 8);
  const maxAbs = Math.max(...list.map((r) => Math.abs(r.delta)), 1);
  return h(
    'div',
    { class: 'card' },
    h('h3', { class: 'card-title' }, '分类变化', h('span', { class: 'muted' }, '对比上月')),
    list.length
      ? h(
          'div',
          {},
          ...list.map((r) =>
            h(
              'div',
              { class: 'shift-row' },
              h('span', { class: 'shift-name' }, r.name),
              h(
                'div',
                { class: 'shift-bar' },
                h('div', {
                  class: 'shift-fill ' + (r.delta >= 0 ? 'up' : 'down'),
                  style: `width:${(Math.abs(r.delta) / maxAbs) * 50}%`
                })
              ),
              h(
                'span',
                { class: 'shift-amt ' + (r.delta >= 0 ? 'up' : 'down') },
                (r.delta >= 0 ? '+' : '−') + fmtMoney(Math.abs(r.delta)).replace('¥', '')
              )
            )
          )
        )
      : h('div', { class: 'muted' }, '没有可比数据')
  );
}

/* ---------------- 账户 ---------------- */

function accountCard(nw) {
  const list = fin.accounts || [];
  const e = fin.editingAccount;
  return h(
    'div',
    { class: 'card card-acct', style: 'margin-bottom:16px' },
    h(
      'h3',
      { class: 'card-title' },
      '账户',
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'muted' }, `净资产 ${fmtMoney(nw.net)}`),
        h(
          'button',
          {
            class: 'btn btn-sm btn-ghost',
            onclick: () => {
              fin.editingAccount = { name: '', kind: 'bank', balance: '', is_liability: false, note: '' };
              render();
            }
          },
          '+ 添加账户'
        )
      )
    ),

    list.length
      ? h(
          'div',
          { class: 'acc-grid' },
          ...list.map((a) =>
            h(
              'div',
              { class: a.is_liability ? 'acc-item liab' : 'acc-item' },
              h('div', { class: 'acc-top' }, h('b', {}, a.name), h('span', { class: 'acc-kind' }, accountKind(a.kind).label)),
              h('div', { class: 'acc-bal' }, fmtMoney(a.balance)),
              h(
                'div',
                { class: 'acc-act' },
                h(
                  'button',
                  {
                    class: 'link-btn',
                    onclick: () => {
                      fin.editingAccount = { ...a, balance: String(a.balance) };
                      render();
                    }
                  },
                  '编辑'
                ),
                h(
                  'button',
                  {
                    class: 'link-btn danger',
                    onclick: async () => {
                      if (!(await ask(`删除账户「${a.name}」？`))) return;
                      try {
                        await deleteAccount(a.id);
                        fin.accounts = await listAccounts();
                        toast('已删除');
                        render();
                      } catch (err) {
                        toast('删除失败：' + (err.message || err), 'err');
                      }
                    }
                  },
                  '删除'
                )
              )
            )
          )
        )
      : h('div', { class: 'muted', style: 'margin-bottom:8px' }, '记下每张卡的余额，才能算出你真正的净资产。'),

    e
      ? h(
          'div',
          { class: 'acc-edit' },
          h(
            'div',
            { class: 'grid', style: 'grid-template-columns:1.4fr 1fr 1fr;gap:10px;margin-bottom:10px' },
            labeled('名称', h('input', {
              class: 'input',
              placeholder: '例如 招商银行',
              value: e.name,
              oninput: (ev) => { e.name = ev.target.value; }
            })),
            labeled('类型', h(
              'select',
              {
                class: 'input',
                onchange: (ev) => {
                  e.kind = ev.target.value;
                  e.is_liability = ['credit', 'loan'].includes(ev.target.value);
                  render();
                }
              },
              ...ACCOUNT_KINDS.map((k) => h('option', { value: k.k, selected: e.kind === k.k }, k.label))
            )),
            labeled('余额', h('input', {
              class: 'input',
              type: 'number',
              step: '0.01',
              placeholder: '0.00',
              value: e.balance,
              oninput: (ev) => { e.balance = ev.target.value; }
            }))
          ),
          h(
            'label',
            { class: 'check-line' },
            h('input', {
              type: 'checkbox',
              checked: e.is_liability,
              onchange: (ev) => { e.is_liability = ev.target.checked; }
            }),
            '这是负债（信用卡欠款、贷款），会从净资产里扣掉'
          ),
          h(
            'div',
            { class: 'row', style: 'margin-top:10px' },
            h('button', { class: 'btn btn-accent btn-sm', onclick: commitAccount }, '保存'),
            h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { fin.editingAccount = null; render(); } }, '取消')
          )
        )
      : null
  );
}

async function commitAccount() {
  const e = fin.editingAccount;
  if (!e || !String(e.name || '').trim()) {
    toast('填个账户名称', 'err');
    return;
  }
  try {
    await saveAccount({ ...e, balance: Number(e.balance) || 0 });
    fin.accounts = await listAccounts();
    fin.editingAccount = null;
    toast('账户已保存');
    render();
  } catch (err) {
    toast('保存失败：' + (err.message || err), 'err');
  }
}

function labeled(label, node) {
  return h('div', {}, h('div', { class: 'muted', style: 'margin-bottom:5px' }, label), node);
}

/* ---------------- 订阅 / 异常 ---------------- */

function recurringCard(rows) {
  const hits = recurringHits(rows);
  return h(
    'div',
    { class: 'card' },
    h('h3', { class: 'card-title' }, '疑似固定扣款', h('span', { class: 'muted' }, '跨月金额稳定')),
    hits.length
      ? h(
          'div',
          { class: 'list' },
          ...hits.map((r) =>
            h(
              'div',
              { class: 'list-item', style: 'padding:7px 4px' },
              h('div', { class: 'li-main' }, h('b', {}, r.name), h('div', { class: 'muted', style: 'font-size:11px' }, `${r.months} 个月共 ${r.times} 次 · ${r.category || '未分类'}`)),
              h('span', { class: 'li-amt' }, fmtMoney(r.avg))
            )
          )
        )
      : h('div', { class: 'muted' }, '还没识别出固定扣款（需要至少两个月的记录）')
  );
}

function outlierCard(monthRows) {
  const list = outliers(monthRows);
  return h(
    'div',
    { class: 'card' },
    h('h3', { class: 'card-title' }, '异常大额', h('span', { class: 'muted' }, '超过均值 3 倍')),
    list.length
      ? h(
          'div',
          { class: 'list' },
          ...list.map((t) =>
            h(
              'div',
              { class: 'list-item', style: 'padding:7px 4px' },
              h('div', { class: 'li-main' }, h('b', {}, t.merchant || '未知'), h('div', { class: 'muted', style: 'font-size:11px' }, `${t.tx_date} · ${t.category || '未分类'}`)),
              h('span', { class: 'li-amt' }, fmtMoney(t.amount))
            )
          )
        )
      : h('div', { class: 'muted' }, '本月没有明显异常的单笔支出')
  );
}
