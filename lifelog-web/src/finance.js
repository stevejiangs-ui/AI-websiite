/* 个人财务：趋势、预算、账户、洞察。
   与 view-tx.js（看单月流水）互补——这里回答「钱去哪了 / 我还有多少 / 超没超」。 */

import { cloud } from './cloud.js';
import { fmtMoney, EXPENSE_CATEGORIES, CATEGORY_COLORS } from './cloud.js';

/* ---------------- 时间工具 ---------------- */

export function monthOf(dateStr) {
  return String(dateStr || '').slice(0, 7);
}

export function monthLabel(m) {
  const [y, mm] = String(m || '').split('-');
  return y && mm ? `${y} 年 ${Number(mm)} 月` : m;
}

export function shiftMonth(m, delta) {
  const [y, mm] = String(m || '').split('-').map(Number);
  if (!y || !mm) return m;
  const d = new Date(y, mm - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* 近 n 个月，从旧到新 */
export function recentMonths(n, endMonth) {
  const end = endMonth || new Date().toISOString().slice(0, 7);
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(shiftMonth(end, -i));
  return out;
}

/* ---------------- 趋势：一次拉全部年份的流水，本地按月聚合 ---------------- */

export async function listAllTransactions(limit = 5000) {
  const { data, error } = await cloud.database
    .from('transactions')
    .select('id,tx_date,tx_time,merchant,description,amount,direction,category,source')
    .order('tx_date', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/* 按月聚合：收入 / 支出 / 结余 / 每日支出 */
export function byMonth(rows) {
  const map = new Map();
  rows.forEach((t) => {
    const m = monthOf(t.tx_date);
    if (!m) return;
    if (!map.has(m)) map.set(m, { month: m, income: 0, expense: 0, count: 0, cats: {}, days: {} });
    const b = map.get(m);
    const amt = Number(t.amount) || 0;
    b.count += 1;
    if (t.direction === 'in') {
      b.income += amt;
    } else {
      b.expense += amt;
      const c = t.category || '其他';
      b.cats[c] = (b.cats[c] || 0) + amt;
      b.days[t.tx_date] = (b.days[t.tx_date] || 0) + amt;
    }
  });
  return [...map.values()]
    .map((b) => ({
      ...b,
      income: +b.income.toFixed(2),
      expense: +b.expense.toFixed(2),
      balance: +(b.income - b.expense).toFixed(2)
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/* 趋势序列补齐空月，供折线使用 */
export function trendSeries(rows, n = 12, endMonth) {
  const agg = byMonth(rows);
  const index = new Map(agg.map((b) => [b.month, b]));
  return recentMonths(n, endMonth).map((m) => {
    const hit = index.get(m);
    return {
      month: m,
      income: hit ? hit.income : 0,
      expense: hit ? hit.expense : 0,
      balance: hit ? hit.balance : 0,
      count: hit ? hit.count : 0
    };
  });
}

/* 同比 / 环比 */
export function compare(series) {
  if (!series.length) return null;
  const cur = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : null;
  const sameLastYear = series.find((s) => s.month === shiftMonth(cur.month, -12)) || null;
  return {
    cur,
    prev,
    mom: prev && prev.expense > 0 ? ((cur.expense - prev.expense) / prev.expense) * 100 : null,
    yoy: sameLastYear && sameLastYear.expense > 0 ? ((cur.expense - sameLastYear.expense) / sameLastYear.expense) * 100 : null,
    prevLabel: prev ? monthLabel(prev.month) : '',
    sameLastYearLabel: sameLastYear ? monthLabel(sameLastYear.month) : ''
  };
}

/* 分类同比：找出「这个月哪一项比上月涨得最凶」 */
export function categoryShift(rows, curMonth, baseMonth) {
  const agg = byMonth(rows);
  const cur = agg.find((b) => b.month === curMonth);
  const base = agg.find((b) => b.month === baseMonth);
  if (!cur) return [];
  const keys = new Set([...Object.keys(cur.cats), ...Object.keys(base?.cats || {})]);
  return [...keys]
    .map((name) => {
      const now = +(cur.cats[name] || 0).toFixed(2);
      const was = +(base?.cats?.[name] || 0).toFixed(2);
      return { name, now, was, delta: +(now - was).toFixed(2) };
    })
    .filter((r) => r.now > 0 || r.was > 0)
    .sort((a, b) => b.delta - a.delta);
}

/* ---------------- 预算 ---------------- */

export async function listBudgets(month) {
  const { data, error } = await cloud.database.from('budgets').select('*').eq('month', month || '');
  if (error) throw error;
  return data || [];
}

/* 一条分类一个月只留一条，用 upsert 覆盖。amount=0 视为删除 */
export async function saveBudget(category, month, amount) {
  const amt = Number(amount) || 0;
  if (amt <= 0) {
    const { error } = await cloud.database.from('budgets').delete().eq('category', category).eq('month', month || '');
    if (error) throw error;
    return;
  }
  const { error } = await cloud.database
    .from('budgets')
    .upsert({ category, month: month || '', amount: amt }, { onConflict: 'owner_id,category,month' });
  if (error) throw error;
}

/* 预算执行情况：把本月支出映射到预算上 */
export function budgetStatus(budgets, monthAgg) {
  const spent = monthAgg?.cats || {};
  const rows = budgets
    .map((b) => {
      const used = +(spent[b.category] || 0).toFixed(2);
      const cap = Number(b.amount) || 0;
      const pct = cap > 0 ? (used / cap) * 100 : 0;
      return {
        category: b.category,
        cap,
        used,
        left: +(cap - used).toFixed(2),
        pct,
        state: pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok',
        color: CATEGORY_COLORS[b.category] || '#9a978f'
      };
    })
    .sort((a, b) => b.pct - a.pct);
  const totalCap = rows.reduce((a, b) => a + b.cap, 0);
  const totalUsed = rows.reduce((a, b) => a + b.used, 0);
  return { rows, totalCap, totalUsed, totalLeft: +(totalCap - totalUsed).toFixed(2) };
}

/* ---------------- 账户 ---------------- */

export const ACCOUNT_KINDS = [
  { k: 'bank', label: '储蓄卡' },
  { k: 'credit', label: '信用卡' },
  { k: 'cash', label: '现金' },
  { k: 'alipay', label: '支付宝' },
  { k: 'wechat', label: '微信' },
  { k: 'invest', label: '投资' },
  { k: 'loan', label: '贷款' }
];

export function accountKind(k) {
  return ACCOUNT_KINDS.find((a) => a.k === k) || { k, label: k || '其他' };
}

export async function listAccounts() {
  const { data, error } = await cloud.database.from('accounts').select('*').order('id', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function saveAccount(a) {
  const payload = {
    name: a.name,
    kind: a.kind || 'bank',
    balance: Number(a.balance) || 0,
    currency: a.currency || 'CNY',
    is_liability: !!a.is_liability,
    note: a.note || null,
    updated_at: new Date().toISOString()
  };
  if (a.id) {
    const { error } = await cloud.database.from('accounts').update(payload).eq('id', a.id);
    if (error) throw error;
    return;
  }
  const { error } = await cloud.database.from('accounts').insert(payload);
  if (error) throw error;
}

export async function deleteAccount(id) {
  const { error } = await cloud.database.from('accounts').delete().eq('id', id);
  if (error) throw error;
}

/* 净资产 = 资产 − 负债 */
export function netWorth(accounts) {
  let assets = 0;
  let debts = 0;
  accounts.forEach((a) => {
    const v = Number(a.balance) || 0;
    if (a.is_liability) debts += v;
    else assets += v;
  });
  return {
    assets: +assets.toFixed(2),
    debts: +debts.toFixed(2),
    net: +(assets - debts).toFixed(2)
  };
}

/* ---------------- 洞察：不依赖 AI，纯规则给出可解释的结论 ---------------- */

export function insights({ series, shift, budget }) {
  const out = [];
  const cur = series[series.length - 1];
  const prev = series[series.length - 2];

  if (cur && prev) {
    const d = +(cur.expense - prev.expense).toFixed(2);
    const pct = prev.expense > 0 ? Math.abs((d / prev.expense) * 100) : 0;
    if (Math.abs(pct) >= 10) {
      out.push({
        tone: d > 0 ? 'bad' : 'good',
        text: `${monthLabel(cur.month)}支出比上月${d > 0 ? '多' : '少'} ${fmtMoney(Math.abs(d))}（${pct.toFixed(0)}%）`
      });
    }
  }

  const top = (shift || []).filter((r) => r.delta > 0).slice(0, 1)[0];
  if (top && top.delta > 50) {
    out.push({ tone: 'bad', text: `涨得最凶的是「${top.name}」，多了 ${fmtMoney(top.delta)}` });
  }

  if (budget && budget.rows.length) {
    const over = budget.rows.filter((r) => r.state === 'over');
    if (over.length) {
      out.push({
        tone: 'bad',
        text: `${over.map((r) => r.category).join('、')} 已超预算，合计超出 ${fmtMoney(over.reduce((a, b) => a + (b.used - b.cap), 0))}`
      });
    } else {
      const near = budget.rows.filter((r) => r.state === 'warn');
      if (near.length) out.push({ tone: 'warn', text: `${near.map((r) => r.category).join('、')} 已用掉八成预算，注意收着点` });
    }
  }

  if (cur && cur.income > 0) {
    const rate = ((cur.income - cur.expense) / cur.income) * 100;
    out.push({
      tone: rate >= 20 ? 'good' : rate >= 0 ? 'warn' : 'bad',
      text: rate >= 0 ? `本月结余率 ${rate.toFixed(0)}%（存下 ${fmtMoney(cur.income - cur.expense)}）` : `本月入不敷出 ${fmtMoney(cur.expense - cur.income)}`
    });
  }

  if (!out.length) out.push({ tone: 'ok', text: '本月支出平稳，没有明显异常' });
  return out;
}

/* ---------------- 订阅/重复扣款检测 ---------------- */

export function recurringHits(rows) {
  const map = new Map();
  rows
    .filter((t) => t.direction === 'out')
    .forEach((t) => {
      const key = String(t.merchant || '').trim();
      if (!key) return;
      const amt = Number(t.amount) || 0;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ date: t.tx_date, amount: amt, category: t.category });
    });
  const out = [];
  map.forEach((list, name) => {
    const months = new Set(list.map((x) => monthOf(x.date)));
    if (months.size < 2 || list.length < 2) return;
    /* 金额相近（±10%）且跨月重复出现，判为疑似订阅 */
    const avg = list.reduce((a, b) => a + b.amount, 0) / list.length;
    const stable = list.filter((x) => Math.abs(x.amount - avg) / (avg || 1) < 0.1).length;
    if (stable >= 2) out.push({ name, months: months.size, times: list.length, avg: +avg.toFixed(2), category: list[0].category });
  });
  return out.sort((a, b) => b.times - a.times).slice(0, 8);
}

/* 单笔异常：超过本月均值 3 倍且金额不小 */
export function outliers(monthRows, threshold = 200) {
  const outs = monthRows.filter((t) => t.direction === 'out');
  if (outs.length < 5) return [];
  const avg = outs.reduce((a, b) => a + (Number(b.amount) || 0), 0) / outs.length;
  return outs
    .filter((t) => Number(t.amount) > Math.max(avg * 3, threshold))
    .sort((a, b) => Number(b.amount) - Number(a.amount))
    .slice(0, 5);
}
