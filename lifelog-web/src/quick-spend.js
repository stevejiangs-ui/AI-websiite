/* 快速记消费：任何页面右下角的「＋」，3 秒记一笔花销。
   金额 → 点分类 → 保存，商家 / 备注 / 日期选填。写进原来的 transactions 表（source=manual），
   和账单页「记一笔」是同一条路，账单、财富总览、消费记录、首页都能看到。 */
import { h, render, toast, state, todayStr } from './store.js';
import { addTransaction, listTransactions, applyRules, fmtMoney, errText, EXPENSE_CATEGORIES, CATEGORY_COLORS } from './cloud.js';

/* 最常用的放前面，其余在「更多分类」里 */
const MAIN_CATS = ['餐饮', '买菜', '交通', '购物', '娱乐', '医疗', '人情', '住房'];

let qs = null;
let spent = { date: '', today: null, month: null };

export function openQuickSpend() {
  qs = { amount: '', category: '', merchant: '', date: todayStr(), busy: false, more: false };
  render();
  refreshSpent();
  setTimeout(() => {
    const el = document.getElementById('qs-amount');
    if (el) el.focus();
  }, 60);
}

function close() {
  qs = null;
  render();
}

async function refreshSpent() {
  try {
    const today = todayStr();
    /* 和首页「今日支出」同一口径：不是收入就算支出（老数据里有 expense / 空方向） */
    const rows = ((await listTransactions({ month: today.slice(0, 7), limit: 2000 })) || []).filter((t) => t.direction !== 'in');
    const sum = (list) => list.reduce((a, t) => a + Math.abs(Number(t.amount) || 0), 0);
    spent = { date: today, today: sum(rows.filter((t) => String(t.tx_date) === today)), month: sum(rows) };
    if (qs) render();
  } catch (e) {
    /* 读不到不影响记账 */
  }
}

async function save() {
  if (!qs || qs.busy) return;
  const amt = Math.round(parseFloat(String(qs.amount).replace(/[,，¥￥\s]/g, '')) * 100) / 100;
  if (!amt || amt <= 0) {
    toast('先输入金额', 'err');
    return;
  }
  if (amt > 10000000) {
    toast('金额太大了，检查一下', 'err');
    return;
  }
  const merchant = qs.merchant.trim();
  const category = qs.category || (merchant ? applyRules(merchant, 'out') : '') || '其他';
  qs.busy = true;
  render();
  try {
    await addTransaction({ tx_date: qs.date || todayStr(), merchant: merchant || category, description: '快速记账', amount: amt, direction: 'out', category }, state.session);
    toast(`已记：${category} ${fmtMoney(amt)}`);
    qs = null;
    render();
    /* 通知当前页面刷新（首页 / 账单 / 财富 / 消费记录） */
    window.dispatchEvent(new CustomEvent('lifelog-tx-changed'));
    refreshSpent();
  } catch (e) {
    qs.busy = false;
    toast('没记上：' + errText(e), 'err');
    render();
  }
}

/** 右下角浮动按钮。聊天 / 专家页底部有输入框，不显示；有弹层打开时也不显示。 */
export function quickSpendFab() {
  if (qs || ['chat', 'expert'].includes(state.view) || state.moreOpen || state.entryEditor || state.goalEditor) return null;
  return h('button', { class: 'qs-fab', id: 'qs-fab', title: '记一笔消费', 'aria-label': '记一笔消费', onclick: openQuickSpend }, h('span', { class: 'qs-plus' }, '＋'), h('span', { class: 'qs-fab-t' }, '记消费'));
}

function chip(c) {
  const on = qs.category === c;
  return h('button', { class: 'chip qs-chip' + (on ? ' on' : ''), style: on ? '' : `border-color:${CATEGORY_COLORS[c] || 'var(--line)'}`, onclick: () => ((qs.category = on ? '' : c), render()) }, c);
}

export function quickSpendSheet() {
  if (!qs) return null;
  const others = EXPENSE_CATEGORIES.filter((c) => !MAIN_CATS.includes(c));
  const showMore = qs.more || others.includes(qs.category);
  const sp = spent.date === todayStr() && spent.today != null ? `今天已花 ${fmtMoney(spent.today)} · 本月 ${fmtMoney(spent.month)}` : '';
  return h(
    'div',
    { class: 'editor qs-wrap', onclick: (ev) => ev.target.classList.contains('qs-wrap') && close() },
    h(
      'div',
      { class: 'editor-panel editor-panel-narrow qs-panel' },
      h('div', { class: 'editor-head' }, h('span', {}, '💳 记一笔消费'), h('div', { style: 'flex:1' }), h('button', { class: 'btn btn-sm btn-ghost', onclick: close }, '关闭')),
      h(
        'div',
        { class: 'editor-body' },
        h(
          'div',
          { class: 'qs-amount-row' },
          h('span', { class: 'qs-cur' }, '¥'),
          h('input', {
            class: 'qs-amount',
            id: 'qs-amount',
            type: 'text',
            inputmode: 'decimal',
            autocomplete: 'off',
            placeholder: '0.00',
            value: qs.amount,
            oninput: (ev) => (qs.amount = ev.target.value),
            onkeydown: (ev) => ev.key === 'Enter' && save()
          })
        ),
        sp ? h('div', { class: 'muted', style: 'font-size:12px;text-align:center;margin:-4px 0 12px' }, sp) : null,
        h('div', { class: 'chip-row', style: 'margin-bottom:8px' }, ...MAIN_CATS.map(chip), showMore ? null : h('button', { class: 'chip', onclick: () => ((qs.more = true), render()) }, '更多分类…')),
        showMore ? h('div', { class: 'chip-row', style: 'margin-bottom:8px' }, ...others.map(chip)) : null,
        h(
          'div',
          { class: 'row', style: 'gap:8px;margin-top:10px' },
          h('input', { class: 'input', id: 'qs-merchant', placeholder: '商家 / 买了什么（选填）', value: qs.merchant, oninput: (ev) => (qs.merchant = ev.target.value), onkeydown: (ev) => ev.key === 'Enter' && save() }),
          h('input', { class: 'input qs-date', id: 'qs-date', type: 'date', value: qs.date, max: todayStr(), onchange: (ev) => (qs.date = ev.target.value) })
        ),
        h('div', { class: 'muted', style: 'font-size:11.5px;margin-top:8px' }, '不选分类会按商家自动归类；收入、转账请到「账单 / 导入」页记。')
      ),
      h('div', { class: 'editor-foot' }, h('button', { class: 'btn btn-accent qs-save', id: 'qs-save', disabled: qs.busy, onclick: save }, qs.busy ? h('span', { class: 'spinner spinner-sm' }) : '保存'))
    )
  );
}
