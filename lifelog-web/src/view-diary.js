import { cloud } from './cloud.js';
import { h, setState, render, toast, state, todayStr, ask } from './store.js';
import { listEntries, saveEntry, saveDigest, deleteEntry, syncTodosFromEntry } from './cloud.js';
import { digestEntry } from './ai.js';
import { FACETS, facetOf, entryFacets } from './facets.js';

const MOODS = [
  { k: 'happy', e: '😊', label: '开心', color: '#e0a33c' },
  { k: 'calm', e: '😌', label: '平静', color: '#5b9c8a' },
  { k: 'tired', e: '😮‍💨', label: '疲惫', color: '#8a8a9c' },
  { k: 'sad', e: '😔', label: '低落', color: '#6d7fa8' },
  { k: 'anxious', e: '😰', label: '焦虑', color: '#b17a8e' }
];

export function moodOf(k) {
  return MOODS.find((m) => m.k === k);
}

export async function loadEntries() {
  setState({ loading: true });
  try {
    const rows = await listEntries({ month: state.diaryMonth, limit: 100 });
    setState({ entries: rows || [], loading: false });
  } catch (e) {
    setState({ loading: false });
    toast('日记加载失败：' + (e.message || e), 'err');
  }
}

export async function switchDiaryMonth(month) {
  setState({ diaryMonth: month });
  await loadEntries();
}

export function openEditor(entry) {
  setState({
    entryEditor: entry
      ? { ...entry, facets: entryFacets(entry), _origContent: entry.content }
      : { entry_date: todayStr(), title: '', content: '', mood: '', tags: '', facets: state.diaryFacet ? [state.diaryFacet] : [] }
  });
}

export function closeEditor() {
  setState({ entryEditor: null });
}

export function editField(key, value) {
  if (!state.entryEditor) return;
  state.entryEditor[key] = value;
}

/* 提炼状态：{ busy, err, entryId } —— 只用于编辑器里的进度与重试提示 */
let digestTask = { busy: false, err: '', entryId: null };

/* 对指定日记做一次提炼并落库。原文 content 不动。 */
export async function runDigest(entry) {
  if (!entry || !entry.id) return null;
  digestTask = { busy: true, err: '', entryId: entry.id };
  if (state.entryEditor && state.entryEditor.id === entry.id) render();
  try {
    const result = await digestEntry({
      title: entry.title,
      content: entry.content,
      entry_date: entry.entry_date
    });
    await saveDigest(entry.id, result);
    /* 提炼出的待办同步进 todos 表，首页/工作页读的是那张表。
       已在表里的不重复插入，所以重新提炼不会把已完成的又翻出来。 */
    try {
      await syncTodosFromEntry(entry.id, entry.entry_date, result.todos || []);
    } catch (e) {
      /* 待办落表失败不该影响提炼本身，静默降级 */
    }
    // 本地同步一份，避免重新拉列表前界面还是旧的
    const hit = (state.entries || []).find((x) => x.id === entry.id);
    if (hit) {
      hit.summary = result.summary;
      hit.key_points = result.points;
      hit.topics = result.topics;
      hit.digest = { todos: result.todos, people: result.people, money: result.money };
    }
    if (state.entryEditor && state.entryEditor.id === entry.id) {
      Object.assign(state.entryEditor, {
        summary: result.summary,
        key_points: result.points,
        topics: result.topics,
        digest: { todos: result.todos, people: result.people, money: result.money }
      });
    }
    digestTask = { busy: false, err: '', entryId: entry.id };
    if (state.entryEditor && state.entryEditor.id === entry.id) render();
    return result;
  } catch (e) {
    digestTask = { busy: false, err: e.message || String(e), entryId: entry.id };
    if (state.entryEditor && state.entryEditor.id === entry.id) render();
    return null;
  }
}

export async function commitEditor() {
  const e = state.entryEditor;
  if (!e) return;
  if (!String(e.content || '').trim() && !String(e.title || '').trim()) {
    toast('写点什么再保存吧', 'err');
    return;
  }
  const isNew = !e.id;
  const contentChanged = isNew || String(e.content || '') !== String(e._origContent || '');
  try {
    const saved = await saveEntry(
      {
        id: e.id,
        entry_date: e.entry_date || todayStr(),
        title: e.title,
        content: e.content,
        mood: e.mood,
        tags: e.tags,
        facets: Array.isArray(e.facets) ? e.facets : []
      },
      state.session
    );
    const savedRow = Array.isArray(saved) ? saved[0] : saved;
    toast(isNew ? '已记下' : '已更新');
    setState({ entryEditor: null });
    await loadEntries();
    // 内容有变化（或新日记）就自动提炼；提炼失败不影响原文保存
    if (contentChanged && savedRow) {
      const result = await runDigest(savedRow);
      if (result) {
        toast('已提炼重点');
        await loadEntries();
      } else {
        toast('原文已保存，提炼失败（可稍后在日记里重试）', 'err');
      }
    }
  } catch (err) {
    toast('保存失败：' + (err.message || err), 'err');
  }
}

export async function removeEntry(id) {
  if (!(await ask('删除这篇日记？删除后无法恢复。'))) return;
  try {
    await deleteEntry(id);
    toast('已删除');
    await loadEntries();
  } catch (e) {
    toast('删除失败：' + (e.message || e), 'err');
  }
}

/* ---------- 视图 ---------- */

export function diaryView() {
  const monthLabel = monthText(state.diaryMonth);
  const all = state.entries || [];
  const activeFacet = state.diaryFacet || '';
  const list = activeFacet ? all.filter((e) => entryFacets(e).includes(activeFacet)) : all;

  const head = h(
    'div',
    { class: 'page-head' },
    h(
      'div',
      {},
      h('h1', {}, '日记'),
      h(
        'p',
        { class: 'desc' },
        activeFacet
          ? `${monthLabel} · ${facetOf(activeFacet)?.label || ''} ${list.length} 篇 / 共 ${all.length} 篇`
          : `${monthLabel} · 共 ${all.length} 篇`
      )
    ),
    h(
      'div',
      { class: 'toolbar' },
      h(
        'div',
        { class: 'seg' },
        ...shiftMonths(state.diaryMonth, 2).map((m) =>
          h(
            'button',
            {
              class: m.value === state.diaryMonth ? 'on' : '',
              onclick: () => switchDiaryMonth(m.value)
            },
            m.label
          )
        )
      ),
      h(
        'button',
        { class: 'btn btn-ghost', onclick: () => import('./view-expert.js').then((m) => m.openExpert('diary')) },
        '🧑‍💼 整理师'
      ),
      h(
        'button',
        { class: 'btn btn-accent', onclick: () => openEditor(null) },
        '+ 写一篇'
      )
    )
  );

  // 维度筛选：只在有数据时显示，避免空页面太吵
  const facetBar = all.length
    ? h(
        'div',
        { class: 'facet-bar' },
        h(
          'button',
          {
            class: 'chip' + (!activeFacet ? ' on' : ''),
            onclick: () => setState({ diaryFacet: '' })
          },
          `全部 ${all.length}`
        ),
        ...FACETS.map((f) => {
          const n = all.filter((e) => entryFacets(e).includes(f.k)).length;
          if (!n) return null;
          const on = activeFacet === f.k;
          return h(
            'button',
            {
              class: 'chip' + (on ? ' on' : ''),
              style: on ? `border-color:${f.color};color:${f.color};background:${f.color}12` : '',
              onclick: () => setState({ diaryFacet: on ? '' : f.k })
            },
            h('span', { style: 'opacity:.7;margin-right:4px' }, f.icon),
            f.label,
            h('span', { class: 'chip-n' }, n)
          );
        })
      )
    : null;

  if (!list.length) {
    return h(
      'div',
      {},
      head,
      facetBar,
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'big' }, '✎'),
        h('p', {}, state.loading ? '正在读取…' : activeFacet ? '这个月这一类还没有记录。' : '这个月还没有记录。'),
        h('button', { class: 'btn btn-ghost', onclick: () => openEditor(null) }, '写下今天发生的事')
      )
    );
  }

  const groups = groupByDate(list);

  return h(
    'div',
    {},
    head,
    facetBar,
    ...groups.map((g) =>
      h(
        'div',
        { style: 'margin-bottom:22px' },
        h(
          'div',
          { class: 'row', style: 'margin-bottom:10px;gap:8px' },
          h('span', { class: 'muted', style: 'font-variant-numeric:tabular-nums' }, g.date),
          h('span', { class: 'muted' }, dayLabel(g.date))
        ),
        h('div', { class: 'entry-grid' }, ...g.items.map(entryCard))
      )
    )
  );
}

/* 展开状态：记录哪些卡片显示原文 */
let expanded = new Set();

function entryCard(e) {
  const mood = moodOf(e.mood);
  const points = Array.isArray(e.key_points) ? e.key_points : [];
  const topics = Array.isArray(e.topics) ? e.topics : [];
  const hasDigest = !!e.summary;
  const open = expanded.has(e.id);

  return h(
    'div',
    {
      class: 'entry-card' + (open ? ' open' : ''),
      onclick: (ev) => {
        // 点展开按钮只切换原文，不进编辑器
        if (ev.target.closest('[data-toggle]')) {
          ev.stopPropagation();
          if (open) expanded.delete(e.id);
          else expanded.add(e.id);
          render();
          return;
        }
        openEditor(e);
      }
    },
    h(
      'div',
      { class: 'entry-date' },
      h('span', {}, timeOf(e.created_at)),
      mood
        ? h(
            'span',
            {},
            h('i', { class: 'mood-dot', style: `background:${mood.color}` }),
            mood.label
          )
        : h('span', {})
    ),
    e.title ? h('div', { class: 'entry-title' }, e.title) : null,

    hasDigest
      ? h(
          'div',
          { class: 'digest' },
          h('div', { class: 'digest-label' }, '重点'),
          h('div', { class: 'digest-summary' }, e.summary),
          points.length
            ? h(
                'ul',
                { class: 'digest-points' },
                ...points.map((p) => h('li', {}, p))
              )
            : null,
          digestExtras(e)
        )
      : null,

    hasDigest
      ? open
        ? h('div', { class: 'entry-body entry-body-open' }, e.content || '')
        : h(
            'div',
            { class: 'raw-toggle', 'data-toggle': '1' },
            '查看原文',
            h('span', { class: 'raw-more' }, String(e.content || '').slice(0, 26).replace(/\n/g, ' ') + '…')
          )
      : h('div', { class: 'entry-body' }, e.content || ''),

    h(
      'div',
      { class: 'entry-tags' },
      ...entryFacets(e).map((k) => {
        const f = facetOf(k);
        return h(
          'span',
          { class: 'tag tag-facet', style: `color:${f?.color || 'inherit'};border-color:${f?.color || '#e8e4dc'}40;background:${f?.color || '#999'}0f` },
          (f?.icon || '') + ' ' + (f?.label || k)
        );
      }),
      ...topics.slice(0, 3).map((t) => h('span', { class: 'tag tag-ai' }, '#' + t)),
      ...String(e.tags || '')
        .split(/[,，\s]+/)
        .filter(Boolean)
        .filter((t) => !topics.includes(t))
        .slice(0, 3)
        .map((t) => h('span', { class: 'tag' }, '#' + t))
    ),

    !hasDigest && String(e.content || '').trim().length >= 20
      ? h(
          'button',
          {
            class: 'digest-run',
            onclick: (ev) => {
              ev.stopPropagation();
              rerunDigest(e);
            }
          },
          '✦ 提炼重点'
        )
      : null
  );
}

async function rerunDigest(e) {
  toast('正在提炼…');
  const r = await runDigest(e);
  if (r) {
    toast('已提炼重点');
    render();
  } else {
    toast('提炼失败：' + (digestTask.err || '未知错误'), 'err');
  }
}

/* 提炼出来的附加信息：待办 / 人物 / 金额 */
function digestExtras(e) {
  const d = e.digest || {};
  const todos = Array.isArray(d.todos) ? d.todos : [];
  const people = Array.isArray(d.people) ? d.people : [];
  const money = d.money ? String(d.money).trim() : '';
  if (!todos.length && !people.length && !money) return null;

  const row = (label, value) =>
    h(
      'div',
      { class: 'digest-extra' },
      h('span', { class: 'digest-extra-k' }, label),
      h('span', { class: 'digest-extra-v' }, value)
    );

  return h(
    'div',
    { class: 'digest-extras' },
    todos.length ? row('待办', todos.join('；')) : null,
    people.length ? row('人物', people.join('、')) : null,
    money ? row('钱', money) : null
  );
}

/* 编辑器里的「已提炼 / 提炼中 / 提炼失败」区块 */
function digestPanel(e) {
  const busy = digestTask.busy && digestTask.entryId === e.id;
  const err = !digestTask.busy && digestTask.entryId === e.id ? digestTask.err : '';
  const points = Array.isArray(e.key_points) ? e.key_points : [];
  const topics = Array.isArray(e.topics) ? e.topics : [];

  if (busy) {
    return h(
      'div',
      { class: 'digest-panel' },
      h('div', { class: 'digest-label' }, h('span', { class: 'spinner spinner-sm' }), ' 正在提炼重点…')
    );
  }

  if (err) {
    return h(
      'div',
      { class: 'digest-panel' },
      h('div', { class: 'digest-label err' }, '提炼失败：' + err),
      h('div', { class: 'muted', style: 'font-size:12px;margin-top:4px' }, '原文已保存，不影响使用。可再点一次「保存并重新提炼」。')
    );
  }

  if (!e.summary) return null;

  return h(
    'div',
    { class: 'digest-panel' },
    h('div', { class: 'digest-label' }, '重点提炼'),
    h('div', { class: 'digest-summary' }, e.summary),
    points.length ? h('ul', { class: 'digest-points' }, ...points.map((p) => h('li', {}, p))) : null,
    digestExtras(e),
    topics.length
      ? h('div', { class: 'entry-tags', style: 'margin-top:10px' }, ...topics.map((t) => h('span', { class: 'tag tag-ai' }, '#' + t)))
      : null
  );
}

/* 编辑器 */
export function editorView() {
  const e = state.entryEditor;
  if (!e) return null;

  return h(
    'div',
    { class: 'editor', onclick: (ev) => ev.target.classList.contains('editor') && closeEditor() },
    h(
      'div',
      { class: 'editor-panel' },
      h(
        'div',
        { class: 'editor-head' },
        h('input', {
          type: 'date',
          value: e.entry_date || todayStr(),
          oninput: (ev) => editField('entry_date', ev.target.value)
        }),
        h('div', { style: 'flex:1' }),
        h('span', { class: 'muted' }, e.id ? `编辑中` : '新的一篇'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: closeEditor }, '关闭')
      ),
      h(
        'div',
        { class: 'editor-body' },
        h('input', {
          class: 'title-input',
          id: 'entry-title',
          placeholder: '标题（可以留空）',
          value: e.title || '',
          oninput: (ev) => {
            editField('title', ev.target.value);
          }
        }),
        h('textarea', {
          class: 'content-input',
          id: 'entry-content',
          placeholder: '今天发生了什么？',
          value: e.content || '',
          oninput: (ev) => {
            editField('content', ev.target.value);
          }
        }),
        h(
          'div',
          { style: 'display:flex;justify-content:space-between;align-items:center;margin-top:8px' },
          h('span', { class: 'muted', style: 'font-size:12px' }, '这一段是原文，会完整保存，不会被摘要替换'),
          e.id
            ? h(
                'button',
                {
                  class: 'btn btn-sm btn-ghost',
                  disabled: digestTask.busy && digestTask.entryId === e.id,
                  onclick: async () => {
                    await commitEditor();
                  }
                },
                '保存并重新提炼'
              )
            : null
        ),
        digestPanel(e),
        h(
          'div',
          { style: 'margin-top:18px' },
          h('div', { class: 'muted', style: 'margin-bottom:8px' }, '这属于哪方面？（可多选）'),
          h(
            'div',
            { class: 'chip-row' },
            ...FACETS.map((f) => {
              const on = (e.facets || []).includes(f.k);
              return h(
                'button',
                {
                  class: 'chip' + (on ? ' on' : ''),
                  style: on ? `border-color:${f.color};color:${f.color};background:${f.color}12` : '',
                  title: f.desc,
                  onclick: () => {
                    const cur = Array.isArray(e.facets) ? [...e.facets] : [];
                    const i = cur.indexOf(f.k);
                    if (i >= 0) cur.splice(i, 1);
                    else cur.push(f.k);
                    editField('facets', cur);
                    render();
                  }
                },
                h('span', { style: 'opacity:.7;margin-right:4px' }, f.icon),
                f.label
              );
            })
          )
        ),
        h(
          'div',
          { style: 'margin-top:16px' },
          h('div', { class: 'muted', style: 'margin-bottom:6px' }, '自定义标签'),
          h('input', {
            class: 'input',
            style: 'height:36px',
            placeholder: '用空格分隔，例如：复盘 装修',
            value: e.tags || '',
            oninput: (ev) => editField('tags', ev.target.value)
          })
        )
      ),
      h(
        'div',
        { class: 'editor-foot' },
        h(
          'div',
          { class: 'mood-picker' },
          ...MOODS.map((m) =>
            h(
              'button',
              {
                class: 'mood-btn' + (e.mood === m.k ? ' on' : ''),
                title: m.label,
                onclick: () => {
                  editField('mood', e.mood === m.k ? '' : m.k);
                  render();
                }
              },
              m.e
            )
          )
        ),
        h(
          'div',
          { class: 'row' },
          e.id
            ? h(
                'button',
                {
                  class: 'btn btn-sm btn-ghost danger-text',
                  onclick: () => {
                    removeEntry(e.id);
                    closeEditor();
                  }
                },
                '删除'
              )
            : null,
          h('button', { class: 'btn btn-sm btn-accent', onclick: commitEditor }, e.id ? '保存修改' : '记下')
        )
      )
    )
  );
}

/* 工具 */
function groupByDate(list) {
  const map = new Map();
  list.forEach((e) => {
    const d = e.entry_date;
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(e);
  });
  return [...map.entries()].map(([date, items]) => ({ date, items }));
}

function monthText(ym) {
  const [y, m] = ym.split('-');
  return `${y} 年 ${Number(m)} 月`;
}

function shiftMonths(ym, back) {
  const [y, m] = ym.split('-').map(Number);
  const out = [];
  for (let i = back; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: i === 0 ? '本月' : `${d.getMonth() + 1}月`
    });
  }
  out.reverse();
  return out;
}

function timeOf(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return week;
}
