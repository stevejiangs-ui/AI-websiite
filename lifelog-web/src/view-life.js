/* 生活视图：把散在日记里的工作、关系、形象三类内容集中起来看。
   不新建数据表——它们本来就是日记的维度（facets），这里只做汇总与时间线。
   朋友关系额外从 AI 提炼的 digest.people 里抽取人名，形成「最近和谁」的清单。 */

import { h, setState, render, toast, state, todayStr } from './store.js';
import { fmtMoney, setTodoDone, listTodos } from './cloud.js';
import { FACETS, facetOf, entryFacets } from './facets.js';

/* 三个可聚类的维度 */
export const LIFE_TABS = [
  { k: 'work', label: '工作', color: '#4a6fa5', tip: '当天的工作进展、会议、卡点' },
  { k: 'relation', label: '朋友关系', color: '#cf7a5e', tip: '和家人、朋友、同事的相处' },
  { k: 'appearance', label: '形象', color: '#c4738f', tip: '穿着、打理、体重外形' }
];

let local = { tab: 'work', range: 90, todos: [] };

/* 测试用：灌一份数据把时间线、待办、密度条这些分支真的跑一遍 */
export function __setLifeForTest(data) {
  local = { tab: 'work', range: 90, todos: [], rows: [], ...data };
}

function tabOf(k) {
  return LIFE_TABS.find((t) => t.k === k) || LIFE_TABS[0];
}

/* ---------------- 加载 ---------------- */

/* 一次拉足够长的历史，供三个维度共用；按日期距今过滤在本地做 */
export async function loadLife() {
  setState({ loading: true });
  try {
    const { cloud } = await import('./cloud.js');
    const { data, error } = await cloud.database
      .from('entries')
      .select('id,entry_date,title,content,summary,key_points,digest,facets,tags,mood,ai_at')
      .order('entry_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(600);
    if (error) throw error;
    local.rows = data || [];
    /* 待办以 todos 表为准（有完成状态）；表为空时才退回日记里的旧数据 */
    local.todos = await listTodos().catch(() => []);
    setState({ loading: false });
    render();
  } catch (e) {
    setState({ loading: false });
    toast('读取失败：' + (e.message || e), 'err');
    render();
  }
}

function rowsIn(rangeDays) {
  const all = local.rows || [];
  if (!rangeDays) return all;
  const cut = new Date();
  cut.setDate(cut.getDate() - rangeDays);
  const cutStr = localDate(cut);
  return all.filter((r) => String(r.entry_date) >= cutStr);
}

/* 某个维度的日记 */
export function entriesOf(facetKey, rangeDays) {
  return rowsIn(rangeDays).filter((r) => entryFacets(r).includes(facetKey));
}

/* ---------------- 统计 ---------------- */

/* 连续天数：从今天往前，看有多少天写过该维度的内容 */
export function streak(facetKey) {
  const set = new Set(entriesOf(facetKey, 0).map((r) => r.entry_date));
  let n = 0;
  const d = new Date();
  for (let i = 0; i < 400; i += 1) {
    /* 用本地日期，不用 toISOString —— 后者是 UTC，东八区 0–8 点会算成前一天，
       连续记录会莫名其妙断档。 */
    const key = localDate(d);
    if (set.has(key)) n += 1;
    else if (i > 0) break;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/* 本地时区的 YYYY-MM-DD */
function localDate(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* 按月分布，用于热度条 */
export function monthDensity(facetKey, months = 6) {
  const list = entriesOf(facetKey, 0);
  const out = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ month: key, n: list.filter((r) => String(r.entry_date).startsWith(key)).length });
  }
  return out;
}

/* 从关系类日记里抽人名：优先用 AI 提炼的 people，退回原文里的书名号/引号内的称呼 */
export function peopleFrom(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const names = new Set();
    const dg = r.digest;
    if (dg && Array.isArray(dg.people)) dg.people.forEach((p) => p && names.add(String(p).trim()));
    /* 没有提炼结果时，用「和XX」「跟XX」这类句式兜底，只在有明确引导词时取，
       避免把普通名词误当成名字 */
    if (!names.size) {
      const text = String(r.content || '');
      const re = /(?:和|跟|与|同)([\u4e00-\u9fa5]{2,3})(?:一起|吃饭|聊|见面|说|通电话)/g;
      let m;
      while ((m = re.exec(text)) && names.size < 6) names.add(m[1]);
    }
    names.forEach((n) => {
      if (n.length < 2 || n.length > 6) return;
      if (!map.has(n)) map.set(n, { name: n, count: 0, last: '', dates: [] });
      const hit = map.get(n);
      hit.count += 1;
      if (r.entry_date > hit.last) hit.last = r.entry_date;
      hit.dates.push({ id: r.id, date: r.entry_date, title: r.title || '', gist: r.summary || '' });
    });
  });
  return [...map.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last));
}

/* 工作类：把提炼出的待办汇总成清单 */
export function todosFrom(rows) {
  const out = [];
  rows.forEach((r) => {
    const list = r.digest && Array.isArray(r.digest.todos) ? r.digest.todos : [];
    list.forEach((t) => {
      const text = String(t || '').trim();
      if (text) out.push({ text, date: r.entry_date, entryId: r.id });
    });
  });
  return out.slice(0, 40);
}

/* 形象类：从原文里找体重、穿搭这类可量化的记录，做成小趋势 */
export function weightSeries(rows) {
  const out = [];
  (rows || []).forEach((r) => {
    if (!r || !r.entry_date) return; // 没日期就没法画趋势，跳过而不是崩
    const text = String(r.content || '');
    const m = text.match(/(\d{2,3}(?:\.\d)?)\s*(?:kg|公斤|斤)/i);
    if (!m) return;
    let v = parseFloat(m[1]);
    if (/斤/.test(m[0]) && !/公斤/.test(m[0])) v = v / 2;
    if (v > 25 && v < 250) out.push({ date: String(r.entry_date), value: +v.toFixed(1) });
  });
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/* ---------------- 视图 ---------------- */

export function lifeView() {
  const tab = tabOf(local.tab);
  const rows = entriesOf(tab.k, local.range);
  const st = streak(tab.k);
  const dens = monthDensity(tab.k);
  const maxDens = Math.max(...dens.map((d) => d.n), 1);

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, '生活'), h('p', { class: 'desc' }, '工作、关系、形象——从日记里自动归拢，不用另外记一遍')),
      h(
        'div',
        { class: 'toolbar' },
        h(
          'div',
          { class: 'seg' },
          ...[{ k: 30, l: '近一月' }, { k: 90, l: '近三月' }, { k: 0, l: '全部' }].map((o) =>
            h(
              'button',
              {
                class: local.range === o.k ? 'on' : '',
                onclick: () => {
                  local.range = o.k;
                  render();
                }
              },
              o.l
            )
          )
        ),
        h(
          'button',
          {
            class: 'btn btn-sm btn-accent',
            onclick: () => {
              setState({ view: 'diary' });
              setTimeout(() => {
                const ev = new CustomEvent('lifelog-new-entry', { detail: { facets: [local.tab] } });
                window.dispatchEvent(ev);
              }, 60);
            }
          },
          '+ 写一条'
        )
      )
    ),

    /* 维度切换 */
    h(
      'div',
      { class: 'life-tabs' },
      ...LIFE_TABS.map((t) =>
        h(
          'button',
          {
            class: 'life-tab' + (local.tab === t.k ? ' on' : ''),
            style: local.tab === t.k ? `border-color:${t.color};color:${t.color}` : '',
            onclick: () => {
              local.tab = t.k;
              render();
            }
          },
          h('span', { class: 'life-tab-dot', style: `background:${t.color}` }),
          h('span', {}, t.label),
          h('span', { class: 'chip-n' }, String(entriesOf(t.k, local.range).length))
        )
      )
    ),

    /* 小统计 */
    h(
      'div',
      { class: 'life-stats' },
      h(
        'div',
        { class: 'life-stat' },
        h('div', { class: 'lbl' }, '连续记录'),
        h('div', { class: 'val', style: `color:${tab.color}` }, `${st} 天`),
        h('div', { class: 'sub' }, st ? '保持住' : '今天写一条就开始计数')
      ),
      h(
        'div',
        { class: 'life-stat' },
        h('div', { class: 'lbl' }, `近${local.range ? local.range + '天' : '全部'}`),
        h('div', { class: 'val', style: `color:${tab.color}` }, `${rows.length} 篇`),
        h('div', { class: 'sub' }, tab.tip)
      ),
      h(
        'div',
        { class: 'life-stat' },
        h('div', { class: 'lbl' }, '近 6 个月密度'),
        h(
          'div',
          { class: 'density' },
          ...dens.map((d) =>
            h(
              'div',
              { class: 'density-col', title: `${d.month}：${d.n} 篇` },
              h('div', { class: 'density-bar', style: `height:${Math.max((d.n / maxDens) * 34, 2)}px;background:${tab.color}` }),
              h('span', {}, String(Number(d.month.slice(5))) + '月')
            )
          )
        ),
        null
      )
    ),

    /* 维度专属面板 */
    tab.k === 'work' ? workPanel(rows) : null,
    tab.k === 'relation' ? relationPanel(rows) : null,
    tab.k === 'appearance' ? appearancePanel(rows) : null,

    /* 时间线 */
    h('h3', { class: 'section-title' }, '时间线'),
    rows.length
      ? h('div', { class: 'timeline' }, ...rows.map((r) => timelineItem(r, tab)))
      : h(
          'div',
          { class: 'empty' },
          h('div', { class: 'big' }, tab.k === 'work' ? '◇' : tab.k === 'relation' ? '♡' : '✧'),
          h('p', {}, `这段时间还没有${tab.label}的记录`),
          h(
            'button',
            {
              class: 'btn btn-accent',
              onclick: () => {
                setState({ view: 'diary' });
                setTimeout(() => {
                  window.dispatchEvent(new CustomEvent('lifelog-new-entry', { detail: { facets: [local.tab] } }));
                }, 60);
              }
            },
            `写一条${tab.label}`
          )
        )
  );
}

/* ---------------- 工作面板 ---------------- */

function workPanel(rows) {
  /* 优先用 todos 表的未完成项（跨日记汇总，带 id 可勾选）；表为空时退回日记提炼结果 */
  const fromTable = (local.todos || [])
    .filter((t) => t && t.status !== 'done')
    .map((t) => ({ text: t.title, date: t.source_date, todoId: t.id }));
  const todos = fromTable.length ? fromTable.slice(0, 40) : todosFrom(rows);
  if (!todos.length) {
    return h(
      'div',
      { class: 'card', style: 'margin-bottom:16px' },
      h('h3', { class: 'card-title' }, '待办汇总'),
      h('p', { class: 'muted', style: 'margin:0' }, '日记里做了「提炼重点」之后，提到的待办会自动收在这里。')
    );
  }
  return h(
    'div',
    { class: 'card', style: 'margin-bottom:16px' },
    h('h3', { class: 'card-title' }, '待办汇总', h('span', { class: 'muted' }, `${todos.length} 条，来自提炼结果`)),
    h(
      'div',
      {},
      ...todos.slice(0, 12).map((t) =>
        h(
          'div',
          { class: 'todo-line' },
          h('span', { class: 'todo-dot' }),
          h('span', { class: 'todo-text' }, t.text),
          h('span', { class: 'muted mono todo-date' }, String(t.date || '').slice(5)),
          h(
            'button',
            {
              class: 'todo-check',
              title: '标记为已完成',
              onclick: async () => {
                if (!t.todoId) {
                  toast('这条来自旧日记，去日记里重新提炼一次就能勾选了', 'err');
                  return;
                }
                try {
                  await setTodoDone(t.todoId, true);
                  toast('已完成 ✓');
                  await loadLife();
                } catch (e) {
                  toast('没记上：' + (e.message || e), 'err');
                }
              }
            },
            null
          )
        )
      )
    )
  );
}

/* ---------------- 关系面板 ---------------- */

function relationPanel(rows) {
  const people = peopleFrom(rows);
  if (!people.length) {
    return h(
      'div',
      { class: 'card', style: 'margin-bottom:16px' },
      h('h3', { class: 'card-title' }, '最近和谁'),
      h('p', { class: 'muted', style: 'margin:0' }, '关系类日记做了提炼后，里面提到的人会出现在这里，能看到多久没联系了。')
    );
  }
  return h(
    'div',
    { class: 'card', style: 'margin-bottom:16px' },
    h('h3', { class: 'card-title' }, '最近和谁', h('span', { class: 'muted' }, `${people.length} 个人`)),
    h(
      'div',
      { class: 'people-grid' },
      ...people.slice(0, 12).map((p) => {
        const gap = daysSince(p.last);
        return h(
          'div',
          { class: 'person' },
          h('div', { class: 'person-avatar' }, p.name.slice(0, 1)),
          h('div', { class: 'person-main' }, h('b', {}, p.name), h('div', { class: 'muted' }, `提过 ${p.count} 次 · 最近 ${p.last.slice(5)}`)),
          h('span', { class: 'person-gap ' + (gap > 30 ? 'stale' : '') }, gap === 0 ? '今天' : `${gap} 天前`)
        );
      })
    )
  );
}

function daysSince(dateStr) {
  if (!dateStr) return 999;
  const a = new Date(dateStr + 'T00:00:00');
  const b = new Date(todayStr() + 'T00:00:00');
  return Math.max(0, Math.round((b - a) / 86400000));
}

/* ---------------- 形象面板 ---------------- */

function appearancePanel(rows) {
  const w = weightSeries(rows);
  let body;
  if (w.length >= 2) {
    const first = w[0];
    const last = w[w.length - 1];
    const d = +(last.value - first.value).toFixed(1);
    const min = Math.min(...w.map((x) => x.value));
    const max = Math.max(...w.map((x) => x.value));
    body = h(
      'div',
      {},
      h(
        'div',
        { class: 'row', style: 'gap:16px;align-items:baseline;margin-bottom:10px' },
        h('span', { style: 'font-size:22px;font-weight:600;font-variant-numeric:tabular-nums' }, `${last.value} kg`),
        h('span', { class: d === 0 ? 'muted' : 'delta ' + (d > 0 ? 'up' : 'down') }, `${d > 0 ? '+' : ''}${d} kg`),
        h('span', { class: 'muted', style: 'font-size:12px' }, `区间 ${min}–${max} kg`)
      ),
      weightSpark(w)
    );
  } else {
    body = h('p', { class: 'muted', style: 'margin:0' }, '在日记里写下体重（例如「今天 68.5kg」），这里会自动画出变化。');
  }
  return h(
    'div',
    { class: 'card', style: 'margin-bottom:16px' },
    h('h3', { class: 'card-title' }, '外形记录'),
    body
  );
}

function weightSpark(list) {
  const w = 620;
  const hgt = 90;
  const vals = list.map((x) => x.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const step = list.length > 1 ? w / (list.length - 1) : w;
  const pts = list.map((x, i) => {
    const px = i * step;
    const py = hgt - 8 - ((x.value - min) / span) * (hgt - 20);
    return `${px.toFixed(1)},${py.toFixed(1)}`;
  });
  return h(
    'svg',
    { class: 'spark-svg', viewBox: `0 0 ${w} ${hgt}`, preserveAspectRatio: 'none' },
    h('polyline', { points: pts.join(' '), fill: 'none', stroke: '#c4738f', 'stroke-width': '1.6', 'stroke-linejoin': 'round' }),
    ...list.map((x, i) => {
      const [px, py] = pts[i].split(',');
      return h('circle', { cx: px, cy: py, r: '2.4', fill: '#c4738f' });
    })
  );
}

/* ---------------- 时间线条目 ---------------- */

function timelineItem(r, tab) {
  const fs = entryFacets(r);
  return h(
    'div',
    { class: 'tl-item' },
    h('div', { class: 'tl-date' }, r.entry_date.slice(5)),
    h('div', { class: 'tl-dot', style: `background:${tab.color}` }),
    h(
      'div',
      { class: 'tl-body' },
      h('div', { class: 'tl-title' }, r.title || (r.summary ? r.summary.slice(0, 22) : '无标题')),
      r.summary ? h('div', { class: 'tl-sum' }, r.summary) : h('div', { class: 'tl-sum muted' }, String(r.content || '').slice(0, 70)),
      h(
        'div',
        { class: 'tl-meta' },
        ...fs.map((k) => {
          const f = facetOf(k);
          return f ? h('span', { class: 'tag-facet', style: `color:${f.color}` }, `${f.icon} ${f.label}`) : null;
        }),
        h(
          'button',
          {
            class: 'link-btn',
            style: 'margin-left:auto',
            onclick: () => {
              setState({ view: 'diary' });
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent('lifelog-open-entry', { detail: { id: r.id } }));
              }, 60);
            }
          },
          '打开'
        )
      )
    )
  );
}
