/* 利好消息：看到对自己可能有利的外部信息（新闻、政策、行情、招聘、合作、人脉消息…）
   就粘贴进来。AI 结合你的目标判断「对我有没有利、该怎么行动」，
   你按 新 → 已行动 → 归档 管理，不让好机会溜走。
   说明：应用不能自己上网抓新闻，内容需要你粘贴（标题 + 正文 / 摘要 + 链接）。 */
import { h, render, toast, state, ask } from './store.js';
import { listSignals, saveSignal, deleteSignal, listGoals, SIGNAL_AREAS, signalArea, errText, isMissingTable } from './cloud.js';
import { askJSON } from './ai.js';
import { luckyLine } from './lucky.js';
import { setupCard } from './view-setup.js';

let sg = { loaded: false, items: [], missing: false, tab: 'new', area: '', form: null, busy: false, analyzing: {} };

export async function loadSignals() {
  try {
    /* 旧版「新闻关注」收藏的条目（source 以「关注:」开头）也在这张表里，不显示 */
    sg.items = ((await listSignals()) || []).filter((x) => !String(x.source || '').startsWith('关注:'));
    sg.missing = false;
  } catch (e) {
    if (isMissingTable(e)) sg.missing = true;
    else throw e;
  }
  sg.loaded = true;
  render();
}

/** 首页用 */
export function signalsSummary() {
  const fresh = (sg.items || []).filter((x) => x.status === 'new');
  const top = [...fresh].sort((a, b) => (b.ai_score ?? -9) - (a.ai_score ?? -9)).slice(0, 3);
  return { loaded: sg.loaded, missing: sg.missing, newCount: fresh.length, top };
}

const SCORE = {
  2: { label: '很有利', cls: 'good2' },
  1: { label: '有利', cls: 'good1' },
  0: { label: '中性', cls: 'neutral' },
  '-1': { label: '要留神', cls: 'bad1' },
  '-2': { label: '不利', cls: 'bad2' }
};

export function scoreBadge(s) {
  if (s == null) return null;
  const k = Math.max(-2, Math.min(2, Math.round(Number(s))));
  const m = SCORE[k];
  return h('span', { class: 'sg-score ' + m.cls }, m.label);
}

/* ---------- AI 分析 ---------- */

export async function analyzeSignal(item) {
  let goals = [];
  try {
    goals = ((await listGoals()) || []).filter((g) => g.status !== 'done').slice(0, 12);
  } catch (e) {
    goals = [];
  }
  const sp = state.selfProfile || {};
  const j = await askJSON(
    `判断下面这条外部消息对我是否有利，并给出行动建议。
关于我：${[sp.job && '职业 ' + sp.job, sp.city && '城市 ' + sp.city].filter(Boolean).join('，') || '（没填）'}。
我在推进的目标：
${goals.map((g) => `- [${g.category}] ${g.title}（进度 ${g.progress || 0}%）`).join('\n') || '- （还没设目标）'}
${luckyLine()}

消息标题：${item.title || ''}
来源：${item.source || ''} ${item.url || ''}
内容：
${String(item.content || '').slice(0, 3500)}

输出 JSON：
{"score": -2 到 2 的整数（2 很有利，1 有利，0 中性，-1 要留神，-2 不利）,
 "area": "money|work|family|health|life 之一（主要影响哪方面）",
 "verdict": "一句话结论，30 字以内",
 "why": "为什么，结合我的目标说，80 字以内",
 "actions": ["具体可执行的下一步，1-3 条，每条 30 字以内"],
 "deadline": "如果有时间窗口（截止日期、窗口期）写出来，没有就空字符串"}`
  );
  const score = Number.isFinite(Number(j.score)) ? Math.max(-2, Math.min(2, Math.round(Number(j.score)))) : 0;
  const actions = Array.isArray(j.actions) ? j.actions.map(String).filter(Boolean).slice(0, 3) : [];
  const take = [
    String(j.verdict || '').trim(),
    j.why ? '原因：' + String(j.why).trim() : '',
    actions.length ? '行动：\n' + actions.map((a, i) => `${i + 1}. ${a}`).join('\n') : '',
    j.deadline ? '时间窗口：' + String(j.deadline).trim() : ''
  ]
    .filter(Boolean)
    .join('\n');
  const area = SIGNAL_AREAS.some((a) => a.k === j.area) ? j.area : item.area;
  return { ai_score: score, ai_take: take, ai_at: new Date().toISOString(), area };
}

async function runAnalyze(item) {
  if (sg.analyzing[item.id]) return;
  sg.analyzing[item.id] = true;
  render();
  try {
    const r = await analyzeSignal(item);
    await saveSignal({ ...item, ...r, area: item.area || r.area });
    await loadSignals();
  } catch (e) {
    toast('AI 分析没成功：' + (e.message || e), 'err');
  }
  delete sg.analyzing[item.id];
  render();
}

/* ---------- 新增 ---------- */

function openForm() {
  sg.form = { title: '', content: '', url: '', source: '', area: sg.area || 'money', analyze: true };
  render();
}

async function submit() {
  const f = sg.form;
  if (!f.title.trim() && !f.content.trim()) {
    toast('粘贴标题或内容', 'err');
    return;
  }
  sg.busy = true;
  render();
  try {
    const rows = await saveSignal(f);
    const saved = Array.isArray(rows) ? rows[0] : rows;
    sg.form = null;
    toast('已保存');
    await loadSignals();
    if (f.analyze && saved?.id) runAnalyze({ ...saved });
  } catch (e) {
    toast('保存失败：' + errText(e), 'err');
  }
  sg.busy = false;
  render();
}

async function setStatus(item, status) {
  try {
    await saveSignal({ ...item, status });
    toast(status === 'acted' ? '已标记「已行动」' : status === 'archived' ? '已归档' : '已移回「新」');
    await loadSignals();
  } catch (e) {
    toast('操作失败：' + errText(e), 'err');
  }
}

async function remove(item) {
  if (!(await ask('删除这条消息？'))) return;
  try {
    await deleteSignal(item.id);
    await loadSignals();
  } catch (e) {
    toast('删除失败：' + errText(e), 'err');
  }
}

function formSheet() {
  const f = sg.form;
  if (!f) return null;
  return h(
    'div',
    { class: 'editor', onclick: (ev) => ev.target.classList.contains('editor') && ((sg.form = null), render()) },
    h(
      'div',
      { class: 'editor-panel editor-panel-narrow' },
      h('div', { class: 'editor-head' }, h('span', {}, '存一条利好消息'), h('div', { style: 'flex:1' }), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ((sg.form = null), render()) }, '关闭')),
      h(
        'div',
        { class: 'editor-body' },
        h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:6px' }, '主要关系到'),
        h('div', { class: 'chip-row', style: 'margin-bottom:12px' }, ...SIGNAL_AREAS.map((a) => h('button', { class: 'chip' + (f.area === a.k ? ' on' : ''), onclick: () => ((f.area = a.k), render()) }, a.label))),
        h('input', { class: 'input', id: 'sg-title', placeholder: '标题，例如：悉尼某区明年规划新地铁站', value: f.title, oninput: (ev) => (f.title = ev.target.value) }),
        h('textarea', { class: 'input', id: 'sg-content', rows: 6, style: 'margin-top:8px;resize:vertical', placeholder: '把新闻 / 公众号文章 / 群消息的内容粘贴进来（摘要也行）', value: f.content, oninput: (ev) => (f.content = ev.target.value) }),
        h('div', { class: 'row', style: 'gap:8px;margin-top:8px' }, h('input', { class: 'input', id: 'sg-source', placeholder: '来源（选填）', value: f.source, oninput: (ev) => (f.source = ev.target.value) }), h('input', { class: 'input', id: 'sg-url', type: 'url', placeholder: '链接（选填）', value: f.url, oninput: (ev) => (f.url = ev.target.value) })),
        h('label', { class: 'row', style: 'gap:8px;margin-top:12px;font-size:13px;cursor:pointer' }, h('input', { type: 'checkbox', id: 'sg-analyze', checked: f.analyze, onchange: (ev) => (f.analyze = ev.target.checked) }), '保存后让 AI 分析对我有没有利')
      ),
      h('div', { class: 'editor-foot' }, h('div', { class: 'row' }, h('div', { style: 'flex:1' }), h('button', { class: 'btn btn-sm btn-accent', disabled: sg.busy, onclick: submit }, sg.busy ? h('span', { class: 'spinner spinner-sm' }) : '保存')))
    )
  );
}

/* ---------- 列表 ---------- */

/* created_at 是 UTC 时间戳，按本地日期显示（否则悉尼早上会显示成前一天） */
function localDate(iso) {
  const d = new Date(iso || '');
  if (Number.isNaN(d.getTime())) return String(iso || '').slice(0, 10);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function card(item) {
  const a = signalArea(item.area);
  const busy = !!sg.analyzing[item.id];
  return h(
    'div',
    { class: 'card sg-card' },
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;margin-bottom:6px' }, h('span', { class: 'sg-area', style: `color:${a.color};border-color:${a.color}` }, a.label), scoreBadge(item.ai_score), h('span', { class: 'muted', style: 'font-size:11.5px;margin-left:auto' }, localDate(item.created_at))),
    h('div', { class: 'sg-title' }, item.title),
    item.source || item.url ? h('div', { class: 'muted', style: 'font-size:12px;word-break:break-all;margin-top:2px' }, [item.source, item.url].filter(Boolean).join(' · ')) : null,
    item.ai_take
      ? h('div', { class: 'ai-text', style: 'margin-top:10px' }, item.ai_take)
      : busy
      ? h('div', { class: 'muted', style: 'margin-top:10px;font-size:12.5px' }, h('span', { class: 'spinner spinner-sm' }), ' AI 正在分析…')
      : item.content
      ? h('div', { class: 'muted sg-content' }, String(item.content).slice(0, 160) + (String(item.content).length > 160 ? '…' : ''))
      : null,
    h(
      'div',
      { class: 'row', style: 'gap:6px;margin-top:12px;flex-wrap:wrap' },
      item.status !== 'acted' ? h('button', { class: 'btn btn-xs', onclick: () => setStatus(item, 'acted') }, '✓ 已行动') : null,
      item.status !== 'archived' ? h('button', { class: 'btn btn-xs btn-ghost', onclick: () => setStatus(item, 'archived') }, '归档') : null,
      item.status !== 'new' ? h('button', { class: 'btn btn-xs btn-ghost', onclick: () => setStatus(item, 'new') }, '移回「新」') : null,
      h('button', { class: 'btn btn-xs btn-ghost', disabled: busy, onclick: () => runAnalyze(item) }, item.ai_take ? '重新分析' : 'AI 分析'),
      h('button', { class: 'btn btn-xs btn-ghost', style: 'margin-left:auto;color:var(--red)', onclick: () => remove(item) }, '删除')
    )
  );
}

export function signalsView() {
  const head = h(
    'div',
    { class: 'page-head' },
    h('div', {}, h('h1', {}, '利好消息'), h('p', { class: 'desc' }, '对我有利的外部信息，一条都不放过')),
    sg.missing ? null : h('button', { class: 'btn btn-accent', onclick: openForm }, '+ 存一条')
  );
  if (!sg.loaded) return h('div', {}, head, h('div', { class: 'card muted' }, h('span', { class: 'spinner spinner-sm' }), ' 正在读取…'));
  if (sg.missing) return h('div', {}, head, setupCard('利好消息'));
  const count = (st) => sg.items.filter((x) => x.status === st).length;
  const list = sg.items
    .filter((x) => (sg.tab === 'all' ? true : x.status === sg.tab))
    .filter((x) => !sg.area || x.area === sg.area)
    .sort((a, b) => (sg.tab === 'new' ? (b.ai_score ?? -9) - (a.ai_score ?? -9) || b.id - a.id : b.id - a.id));
  return h(
    'div',
    {},
    head,
    h(
      'div',
      { class: 'row', style: 'gap:8px;flex-wrap:wrap;margin-bottom:12px' },
      h('div', { class: 'seg' }, ...[['new', `新 ${count('new')}`], ['acted', `已行动 ${count('acted')}`], ['archived', '归档'], ['all', '全部']].map(([k, l]) => h('button', { class: sg.tab === k ? 'on' : '', onclick: () => ((sg.tab = k), render()) }, l))),
      h('select', { class: 'input', id: 'sg-area-filter', style: 'width:auto;height:32px', onchange: (ev) => ((sg.area = ev.target.value), render()) }, h('option', { value: '', selected: !sg.area }, '全部方面'), ...SIGNAL_AREAS.map((a) => h('option', { value: a.k, selected: sg.area === a.k }, a.label)))
    ),
    list.length
      ? h('div', { class: 'sg-list' }, ...list.map(card))
      : h('div', { class: 'empty' }, h('div', { class: 'big' }, '📰'), h('p', {}, sg.tab === 'new' ? '没有待处理的消息。看到对你可能有利的新闻、政策、行情、机会，就点「+ 存一条」粘贴进来。' : '这里还是空的。')),
    formSheet()
  );
}
