/* 收入四分法 + 负债
   ------------------------------------------------------------------
   用户要求把自己的钱分四块看：
     1. 工作收入   2. 物业收入   3. 投资收入   4. 负债

   实现要点：
   · 不新建表、不改历史数据。收入靠 INCOME_GROUPS 把原有细分类
     （工资/奖金/报销/租金/理财/其他收入）映射到四个大块。
   · 负债用 accounts 表里 is_liability = true 的账户，跟资产一起算净资产。
   · 每块给出「占比 + 环比 + 一句话判断」，不做成一堆数字。
*/

import { h, render } from './store.js';
import { fmtMoney, INCOME_GROUPS, incomeGroupOf } from './cloud.js';
import { monthLabel, shiftMonth, recentMonths } from './finance.js';

/** 把一个月、一年的流水按四块聚合 */
export function groupIncome(rows) {
  const byMonthMap = new Map();
  rows.forEach((t) => {
    if (t.direction !== 'in') return;
    const m = String(t.tx_date || '').slice(0, 7);
    if (!m) return;
    if (!byMonthMap.has(m)) byMonthMap.set(m, { month: m, total: 0, groups: {} });
    const b = byMonthMap.get(m);
    const g = incomeGroupOf(t.category);
    const amt = Number(t.amount) || 0;
    b.groups[g] = (b.groups[g] || 0) + amt;
    b.total += amt;
  });
  return [...byMonthMap.values()]
    .map((b) => ({
      ...b,
      total: +b.total.toFixed(2),
      groups: Object.fromEntries(Object.entries(b.groups).map(([k, v]) => [k, +v.toFixed(2)]))
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** 收入结构分析：四块的占比、环比、稳定性 */
export function incomeMix(rows, month) {
  const agg = groupIncome(rows);
  const cur = agg.find((b) => b.month === month) || { month, total: 0, groups: {} };
  const prev = agg.find((b) => b.month === shiftMonth(month, -1)) || { groups: {}, total: 0 };

  /* 最近 6 个月每块的均值，用来看「稳定收入」占多少 —— 这比单月数字有用得多 */
  const last6 = recentMonths(6, month).map((m) => agg.find((b) => b.month === m)).filter(Boolean);

  const groups = INCOME_GROUPS.map((g) => {
    const amt = +(cur.groups[g.k] || 0).toFixed(2);
    const prevAmt = +(prev.groups[g.k] || 0).toFixed(2);
    const avg = last6.length ? +(last6.reduce((a, b) => a + (b.groups[g.k] || 0), 0) / last6.length).toFixed(2) : 0;
    const mom = prevAmt > 0 ? +(((amt - prevAmt) / prevAmt) * 100).toFixed(0) : null;
    return {
      ...g,
      amount: amt,
      prevAmount: prevAmt,
      avg,
      mom,
      share: cur.total > 0 ? +((amt / cur.total) * 100).toFixed(1) : 0,
      /* 连续几个月都有 → 算稳定 */
      monthsPresent: last6.filter((b) => (b.groups[g.k] || 0) > 0).length,
      stable: last6.length >= 3 && last6.filter((b) => (b.groups[g.k] || 0) > 0).length >= Math.ceil(last6.length * 0.75)
    };
  }).filter((g) => g.amount > 0 || g.prevAmount > 0 || g.avg > 0);

  const passive = groups.filter((g) => g.k === 'property' || g.k === 'invest').reduce((a, b) => a + b.amount, 0);
  const passivePct = cur.total > 0 ? +((passive / cur.total) * 100).toFixed(1) : 0;

  return { month, total: cur.total, prevTotal: prev.total, groups, passive, passivePct, last6 };
}

/** 负债：从 accounts 里挑 is_liability=true 的 */
export function debtSummary(accounts) {
  const list = (accounts || []).filter((a) => a.is_liability);
  const total = list.reduce((a, b) => a + Math.abs(Number(b.balance) || 0), 0);
  const assets = (accounts || []).filter((a) => !a.is_liability).reduce((a, b) => a + (Number(b.balance) || 0), 0);
  return {
    list,
    total: +total.toFixed(2),
    assets: +assets.toFixed(2),
    net: +(assets - total).toFixed(2),
    /* 负债率 = 负债 / 总资产，超过 60% 就要提一句 */
    ratio: assets > 0 ? +((total / assets) * 100).toFixed(1) : null
  };
}

/* ---------------- 界面 ---------------- */

function bar(groups) {
  const total = groups.reduce((a, b) => a + b.amount, 0);
  if (total <= 0) return null;
  return h(
    'div',
    { class: 'mix-bar' },
    ...groups
      .filter((g) => g.amount > 0)
      .map((g) =>
        h('div', {
          class: 'mix-seg',
          style: `flex:${g.amount};background:${g.color}`,
          title: `${g.label} ${fmtMoney(g.amount)}（${g.share}%）`
        })
      )
  );
}

export function incomeCard({ mix, debt, onOpenAccounts }) {
  const max = Math.max(...mix.groups.map((g) => g.amount), 1);

  return h(
    'div',
    { class: 'card', style: 'margin-bottom:16px' },
    h(
      'div',
      { class: 'row-between' },
      h('h3', { class: 'card-title', style: 'margin:0' }, '收入结构'),
      h('span', { class: 'muted', style: 'font-size:12px' }, `${monthLabel(mix.month)} · 合计 ${fmtMoney(mix.total)}`)
    ),

    bar(mix.groups),

    h(
      'div',
      { style: 'margin-top:14px' },
      ...mix.groups.map((g) =>
        h(
          'div',
          { class: 'mix-row' },
          h('span', { class: 'mix-dot', style: `background:${g.color}` }),
          h(
            'span',
            { class: 'mix-name' },
            g.label,
            g.stable ? h('span', { class: 'mix-tag' }, '稳定') : null
          ),
          h(
            'span',
            { class: 'mix-track' },
            h('span', { class: 'mix-fill', style: `width:${(g.amount / max) * 100}%;background:${g.color}` })
          ),
          h('span', { class: 'mix-amt' }, fmtMoney(g.amount)),
          h(
            'span',
            { class: 'mix-pct ' + (g.mom == null ? '' : g.mom >= 0 ? 'up' : 'down') },
            g.share ? `${g.share}%` : '—',
            g.mom != null ? h('span', { class: 'mix-mom' }, ` ${g.mom >= 0 ? '▲' : '▼'}${Math.abs(g.mom)}%`) : null
          )
        )
      )
    ),

    mix.groups.length === 0
      ? h('p', { class: 'muted', style: 'margin:12px 0 0' }, '这个月还没有收入记录。记一笔工资或租金，这里就会分块显示。')
      : h(
          'p',
          { class: 'muted', style: 'margin:12px 0 0;font-size:12.5px;line-height:1.75' },
          mix.passivePct > 0
            ? `被动收入（物业 + 投资）占 ${mix.passivePct}%。` +
              (mix.passivePct >= 30
                ? '超过三成，结构算不错。'
                : mix.passivePct >= 10
                  ? '有一点底子，但主要还是靠工钱。'
                  : '占比很低，停下来就断了，这是最该改善的一项。')
            : '目前收入全部来自工作，没有物业或投资进项。'
        ),

    /* 负债 */
    h(
      'div',
      { style: 'margin-top:18px;padding-top:14px;border-top:1px solid var(--line)' },
      h(
        'div',
        { class: 'row-between' },
        h('div', { style: 'font-weight:600;font-size:13.5px' }, '负债'),
        h(
          'span',
          { style: 'font-size:15px;font-weight:600;color:#b4552f' },
          debt.total > 0 ? fmtMoney(debt.total) : '无'
        )
      ),
      debt.list.length === 0
        ? h(
            'p',
            { class: 'muted', style: 'margin:8px 0 0;font-size:12.5px' },
            '没有登记负债。信用卡、房贷、车贷、借款都可以在「账户」里勾上「负债」记进来。'
          )
        : h(
            'div',
            { style: 'margin-top:8px' },
            debt.list.map((a) =>
              h(
                'div',
                { class: 'debt-row' },
                h('span', {}, a.name || '未命名'),
                h('span', { class: 'muted', style: 'font-size:12px' }, a.kind || ''),
                h('span', { style: 'margin-left:auto;color:#b4552f;font-weight:600' }, fmtMoney(Math.abs(Number(a.balance) || 0)))
              )
            )
          ),
      debt.ratio != null
        ? h(
            'p',
            { class: 'muted', style: 'margin:10px 0 0;font-size:12.5px;line-height:1.7' },
            `负债率 ${debt.ratio}%（负债 / 资产）。` +
              (debt.ratio >= 60
                ? '偏高，先把高息的那笔清掉，别再加杠杆。'
                : debt.ratio >= 30
                  ? '中等，注意月供占收入的比例。'
                  : '健康区间。')
          )
        : null,
      onOpenAccounts
        ? h(
            'button',
            { class: 'btn btn-sm btn-ghost', style: 'margin-top:10px', onclick: onOpenAccounts },
            '管理账户与负债'
          )
        : null
    )
  );
}
