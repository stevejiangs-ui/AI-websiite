import { h, setState, render, toast, state, ask } from './store.js';
import {
  listTransactions,
  updateTransaction,
  deleteTransaction,
  addTransaction,
  computeStats,
  fmtMoney,
  CATEGORIES,
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  categoriesFor,
  CATEGORY_COLORS,
  todayStr,
  currentMonth,
  learnRule,
  applyRules
} from './cloud.js';

let adding = null;

export async function loadTx() {
  setState({ loading: true });
  try {
    const rows = await listTransactions({
      month: state.txMonth,
      category: state.txFilter.category || undefined,
      keyword: state.txFilter.keyword || undefined,
      direction: state.txFilter.direction || undefined,
      limit: 400
    });
    setState({ tx: rows || [], stats: computeStats(rows || []), loading: false });
  } catch (e) {
    setState({ loading: false });
    toast('账单加载失败：' + (e.message || e), 'err');
  }
}

export async function changeMonth(m) {
  setState({ txMonth: m });
  await loadTx();
}

export function setFilter(patch) {
  Object.assign(state.txFilter, patch);
  loadTx();
}

export async function changeCategory(id, oldCat, newCat, merchant) {
  try {
    await updateTransaction({ id, category: newCat, merchant });
    toast(`已改为「${newCat}」`);
    if (merchant && merchant.length >= 2 && merchant.length <= 12) {
      await learnRule(merchant, newCat);
    }
    await loadTx();
  } catch (e) {
    toast('修改失败：' + (e.message || e), 'err');
  }
}

export async function removeTx(id) {
  if (!(await ask('删除这条记录？'))) return;
  try {
    await deleteTransaction(id);
    toast('已删除');
    await loadTx();
  } catch (e) {
    toast('删除失败：' + (e.message || e), 'err');
  }
}

export function startAdd() {
  adding = { tx_date: todayStr(), merchant: '', amount: '', direction: 'out', category: '', note: '' };
  render();
}

export function cancelAdd() {
  adding = null;
  render();
}

export function addField(k, v) {
  if (adding) adding[k] = v;
}

export async function commitAdd() {
  if (!adding) return;
  const amt = parseFloat(adding.amount);
  if (!adding.merchant || !amt || amt <= 0) {
    toast('填写商家和金额', 'err');
    return;
  }
  try {
    const cat = adding.category || applyRules(adding.merchant, adding.direction);
    await addTransaction(
      { ...adding, amount: amt, category: cat },
      state.session
    );
    toast('已记一笔');
    adding = null;
    await loadTx();
  } catch (e) {
    toast('添加失败：' + (e.message || e), 'err');
  }
}

/* ---------- 视图 ---------- */

export function txView() {
  const stats = state.stats || { totals: { in: 0, out: 0 }, catList: [], topMerchants: [] };
  const list = state.tx || [];
  const monthLabel = state.txMonth;

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, '账单'), h('p', { class: 'desc' }, `${monthLabel} · ${list.length} 笔记录`)),
      h(
        'div',
        { class: 'toolbar' },
        h('input', {
          type: 'month',
          class: 'input',
          style: 'width:150px;height:34px',
          value: state.txMonth,
          onchange: (ev) => changeMonth(ev.target.value || currentMonth())
        }),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => setState({ view: 'import' }) }, '导入账单'),
        h('button', { class: 'btn btn-sm btn-accent', onclick: startAdd }, '+ 记一笔')
      )
    ),

    /* 记一笔的表单放在最上面：手机上原来排在三张统计卡下面，点了按钮要往下翻才看得到 */
    adding ? addForm() : null,

    h(
      'div',
      { class: 'grid g3', style: 'margin-bottom:16px' },
      kpi('本月支出', fmtMoney(stats.totals.out), 'out', `${countOf(list, 'out')} 笔`),
      kpi('本月收入', fmtMoney(stats.totals.in), 'in', `${countOf(list, 'in')} 笔`),
      kpi('结余', fmtMoney(stats.totals.in - stats.totals.out), '', avgPerDay(list, stats) )
    ),

    h(
      'div',
      { class: 'grid g2', style: 'margin-bottom:16px' },
      categoryCard(stats),
      incomeCard(stats)
    ),

    merchantCard(stats),

    h('div', { style: 'height:16px' }),

    h(
      'div',
      { style: 'display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap' },
      h(
        'div',
        { class: 'seg' },
        ...[
          { k: '', l: '全部' },
          { k: 'out', l: '支出' },
          { k: 'in', l: '收入' }
        ].map((o) =>
          h(
            'button',
            { class: state.txFilter.direction === o.k ? 'on' : '', onclick: () => setFilter({ direction: o.k }) },
            o.l
          )
        )
      ),
      catFilter(),
      h('input', {
        class: 'input',
        style: 'width:200px;height:34px;margin-left:auto',
        placeholder: '搜索商家 / 备注',
        value: state.txFilter.keyword,
        onkeydown: (ev) => {
          if (ev.key === 'Enter') setFilter({ keyword: ev.target.value.trim() });
        }
      })
    ),

    list.length ? txTable(list) : h('div', { class: 'empty' }, h('div', { class: 'big' }, '⌗'), h('p', {}, '这个月还没有账单，导入或手工记一笔吧'))
  );
}

function kpi(label, value, cls, sub) {
  return h(
    'div',
    { class: 'kpi' },
    h('div', { class: 'lbl' }, label),
    h('div', { class: 'val ' + cls }, value),
    sub ? h('div', { class: 'sub' }, sub) : null
  );
}

function countOf(list, dir) {
  return list.filter((t) => t.direction === dir).length;
}

function avgPerDay(list, stats) {
  const days = new Set(list.map((t) => t.tx_date)).size || 1;
  return `日均支出 ${fmtMoney(stats.totals.out / days)}`;
}

function categoryCard(stats) {
  const total = stats.catList.reduce((a, b) => a + b.value, 0) || 1;
  if (!stats.catList.length) {
    return h('div', { class: 'card' }, h('h3', { class: 'card-title' }, '支出构成'), h('div', { class: 'muted' }, '暂无数据'));
  }
  return h(
    'div',
    { class: 'card' },
    h('h3', { class: 'card-title' }, '支出构成', h('span', { class: 'muted' }, `${stats.catList.length} 个分类`)),
    h(
      'div',
      {},
      ...stats.catList.slice(0, 8).map((c) =>
        h(
          'div',
          { class: 'bar-row' },
          h('span', {}, c.name),
          h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `width:${(c.value / total) * 100}%;background:${CATEGORY_COLORS[c.name] || '#9a978f'}` })),
          h('span', { class: 'amt' }, fmtMoney(c.value))
        )
      )
    )
  );
}

function incomeCard(stats) {
  const list = stats.incomeList || [];
  const total = list.reduce((a, b) => a + b.value, 0) || 1;
  if (!list.length) {
    return h('div', { class: 'card' }, h('h3', { class: 'card-title' }, '收入构成'), h('div', { class: 'muted' }, '本月还没有收入记录'));
  }
  return h(
    'div',
    { class: 'card' },
    h('h3', { class: 'card-title' }, '收入构成', h('span', { class: 'muted' }, `合计 ${fmtMoney(total)}`)),
    ...list.slice(0, 8).map((c) =>
      h(
        'div',
        { class: 'bar-row' },
        h('span', {}, c.name),
        h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `width:${(c.value / total) * 100}%;background:${CATEGORY_COLORS[c.name] || '#6fa88f'}` })),
        h('span', { class: 'amt' }, fmtMoney(c.value))
      )
    )
  );
}

function merchantCard(stats) {
  if (!stats.topMerchants.length) {
    return h('div', { class: 'card' }, h('h3', { class: 'card-title' }, '花钱最多的地方'), h('div', { class: 'muted' }, '暂无数据'));
  }
  return h(
    'div',
    { class: 'card' },
    h('h3', { class: 'card-title' }, '花钱最多的地方'),
    h(
      'div',
      { class: 'list' },
      ...stats.topMerchants.slice(0, 7).map((m, i) =>
        h(
          'div',
          { class: 'list-item', style: 'padding:8px 6px' },
          h('span', { class: 'muted mono', style: 'width:16px' }, String(i + 1)),
          h('div', { class: 'li-main' }, h('b', {}, m.name)),
          h('span', { class: 'li-amt' }, fmtMoney(m.value))
        )
      )
    )
  );
}

function catFilter() {
  return h(
    'select',
    {
      class: 'input',
      style: 'width:120px;height:34px',
      onchange: (ev) => setFilter({ category: ev.target.value })
    },
    h('option', { value: '', selected: !state.txFilter.category }, '全部分类'),
    h('optgroup', { label: '支出' }, ...EXPENSE_CATEGORIES.map((c) => h('option', { value: c, selected: state.txFilter.category === c }, c))),
    h('optgroup', { label: '收入' }, ...INCOME_CATEGORIES.map((c) => h('option', { value: c, selected: state.txFilter.category === c }, c)))
  );
}

function txTable(list) {
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', {}, '日期'),
          h('th', {}, '商户'),
          h('th', {}, '分类'),
          h('th', { style: 'text-align:right' }, '金额'),
          h('th', { style: 'width:44px' }, '')
        )
      ),
      h(
        'tbody',
        {},
        ...list.slice(0, 200).map((t) =>
          h(
            'tr',
            {},
            h('td', { class: 'mono', style: 'white-space:nowrap' }, t.tx_date + (t.tx_time ? ' ' + t.tx_time.slice(0, 5) : '')),
            h(
              'td',
              {},
              h('div', { style: 'font-weight:500' }, t.merchant || '未知商户'),
              t.description ? h('div', { class: 'muted', style: 'font-size:11.5px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, t.description) : null
            ),
            h(
              'td',
              {},
              h(
                'select',
                {
                  class: 'cat-select',
                  style: `color:${CATEGORY_COLORS[t.category] || '#5c5852'}`,
                  onchange: (ev) => changeCategory(t.id, t.category, ev.target.value, t.merchant)
                },
                ...categoriesFor(t.direction).map((c) => h('option', { value: c, selected: t.category === c }, c))
              )
            ),
            h('td', { class: 'num ' + (t.direction === 'in' ? '' : '') },
              h('span', { style: t.direction === 'in' ? 'color:var(--green)' : '' }, (t.direction === 'in' ? '+' : '-') + fmtMoney(t.amount).replace('¥', '')),
              h('div', { class: 'muted', style: 'font-size:11px' }, t.direction === 'in' ? '收入' : '支出')
            ),
            h(
              'td',
              {},
              h('button', { class: 'btn btn-sm', style: 'background:none;color:var(--ink-3);padding:0 6px', title: '删除', onclick: () => removeTx(t.id) }, '×')
            )
          )
        )
      )
    )
  );
}

function addForm() {
  const a = adding;
  return h(
    'div',
    { class: 'card', style: 'margin-bottom:16px' },
    h('h3', { class: 'card-title' }, '记一笔'),
    h(
      'div',
      { class: 'grid tx-add-grid' },
      field('日期', h('input', {
        class: 'input',
        type: 'date',
        value: a.tx_date,
        oninput: (ev) => addField('tx_date', ev.target.value)
      })),
      field('商户', h('input', {
        class: 'input',
        placeholder: '例如 美团',
        value: a.merchant,
        oninput: (ev) => addField('merchant', ev.target.value)
      })),
      field('金额', h('input', {
        class: 'input',
        type: 'number',
        step: '0.01',
        placeholder: '0.00',
        value: a.amount,
        oninput: (ev) => addField('amount', ev.target.value)
      })),
      field(
        '收支',
        h(
          'select',
          {
            class: 'input',
            onchange: (ev) => {
              addField('direction', ev.target.value);
              addField('category', '');
              render();
            }
          },
          h('option', { value: 'out', selected: a.direction === 'out' }, '支出'),
          h('option', { value: 'in', selected: a.direction === 'in' }, '收入')
        )
      ),
      field(
        '分类',
        h(
          'select',
          { class: 'input', onchange: (ev) => addField('category', ev.target.value) },
          h('option', { value: '', selected: !a.category }, '自动识别'),
          ...categoriesFor(a.direction).map((c) => h('option', { value: c, selected: a.category === c }, c))
        )
      ),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn btn-accent', onclick: commitAdd }, '保存'),
        h('button', { class: 'btn btn-ghost', onclick: cancelAdd }, '取消')
      )
    )
  );
}

function field(label, node) {
  return h('div', {}, h('div', { class: 'muted', style: 'margin-bottom:5px' }, label), node);
}
