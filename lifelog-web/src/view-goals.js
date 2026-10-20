import { h, setState, render, toast, state, ask } from './store.js';
import { listGoals, saveGoal, deleteGoal, listTasks, saveTask, deleteTask, errText } from './cloud.js';
import { GOAL_CATEGORIES, goalCatOf } from './facets.js';

/* 三个子视图：目标（长期）/ 任务（要做完的事）/ 日程（有时间的安排） */
let gtab = 'goals';
export function goalsTab() {
  return gtab;
}
export function setGoalsTab(t) {
  gtab = t;
  state.tasksTab = t;
  render();
}

export async function loadGoals() {
  try {
    const rows = await listGoals();
    setState({ goals: rows || [], goalsErr: '' });
  } catch (e) {
    /* 说清楚是「读不到」而不是「没有」——否则空状态会误导用户以为数据丢了 */
    const msg = errText(e);
    state.goalsErr = msg;
    setState({ goals: state.goals || [] });
    toast('目标加载失败：' + msg, 'err');
  }
}

export async function loadTasks() {
  try {
    const rows = await listTasks();
    setState({ tasks: rows || [], tasksErr: '' });
  } catch (e) {
    const msg = errText(e);
    state.tasksErr = msg;
    setState({ tasks: state.tasks || [] });
    toast('任务加载失败：' + msg, 'err');
  }
}

function openEditor(goal) {
  setState({
    goalEditor: goal
      ? { ...goal }
      : { title: '', detail: '', category: 'life', target_date: '', progress: 0, status: 'active' }
  });
}

function closeEditor() {
  setState({ goalEditor: null });
}

function openTaskEditor(t, kind) {
  setState({
    taskEditor: t
      ? { ...t }
      : {
          kind: kind || 'task',
          title: '',
          detail: '',
          goal_id: null,
          category: 'life',
          due_date: '',
          due_time: '',
          priority: 'normal',
          status: 'todo'
        }
  });
}

function closeTaskEditor() {
  setState({ taskEditor: null });
}

async function commit() {
  const g = state.goalEditor;
  if (!g) return;
  if (!String(g.title || '').trim()) {
    toast('先写个目标名字', 'err');
    return;
  }
  /* 防重复提交：连点「立下」会插两条一模一样的记录 */
  if (state.goalSaving) return;
  state.goalSaving = true;
  render();
  try {
    await saveGoal(g);
    toast(g.id ? '已更新' : '目标已立下');
    setState({ goalEditor: null });
    await loadGoals();
  } catch (e) {
    /* 失败时把面板留着，别把用户写的东西丢了 */
    toast('保存失败：' + (e.message || e), 'err');
  } finally {
    state.goalSaving = false;
    render();
  }
}

async function commitTask() {
  const t = state.taskEditor;
  if (!t) return;
  if (!String(t.title || '').trim()) {
    toast(t.kind === 'event' ? '先写个日程名字' : '先写个任务名字', 'err');
    return;
  }
  if (state.taskSaving) return;
  state.taskSaving = true;
  render();
  try {
    await saveTask(t);
    toast(t.id ? '已更新' : t.kind === 'event' ? '日程已加入' : '任务已添加');
    setState({ taskEditor: null });
    await loadTasks();
  } catch (e) {
    toast('保存失败：' + (e.message || e), 'err');
  } finally {
    state.taskSaving = false;
    render();
  }
}

async function remove(id) {
  if (!(await ask('删除这个目标？相关的任务会保留，但不再挂在目标下。'))) return;
  try {
    await deleteGoal(id);
    toast('已删除');
    await loadGoals();
  } catch (e) {
    toast('删除失败：' + (e.message || e), 'err');
  }
}

async function removeTask(id) {
  if (!(await ask('删除这一条？'))) return;
  try {
    await deleteTask(id);
    toast('已删除');
    await loadTasks();
  } catch (e) {
    toast('删除失败：' + (e.message || e), 'err');
  }
}

async function bumpProgress(g, delta) {
  const next = Math.max(0, Math.min(100, (Number(g.progress) || 0) + delta));
  if (next === (Number(g.progress) || 0)) return;
  /* 连点 +10 会并发写同一行，后到的覆盖先到的，进度就卡住不动 —— 加锁 */
  if (state.goalBusy) return;
  state.goalBusy = true;
  try {
    await saveGoal({ ...g, progress: next, status: next >= 100 ? 'done' : 'active' });
    await loadGoals();
  } catch (e) {
    toast('更新失败：' + (e.message || e), 'err');
  } finally {
    state.goalBusy = false;
  }
}

async function toggleTask(t) {
  if (state.taskBusy) return;
  state.taskBusy = true;
  try {
    await saveTask({ ...t, status: t.status === 'done' ? 'todo' : 'done', done_at: t.status === 'done' ? null : new Date().toISOString() });
    await loadTasks();
  } catch (e) {
    toast('更新失败：' + (e.message || e), 'err');
  } finally {
    state.taskBusy = false;
  }
}

function daysLeft(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

/**
 * 节奏判断：把「时间过去了多少」和「进度走了多少」对照。
 * 目标失败往往不是没做，而是做得太慢却没察觉。
 * 返回 { state, need, text }：state = ahead | on | behind | stuck | done
 */
export function pace(g) {
  const p = Number(g.progress) || 0;
  if (g.status === 'done' || p >= 100) return { state: 'done', text: '已完成' };
  const dl = daysLeft(g.target_date);
  if (dl == null) return { state: 'none', text: '' };
  if (dl < 0) return { state: 'behind', text: `已逾期 ${-dl} 天，进度 ${p}%` };

  /* 已用时间占比：从创建日到今天，占「创建日→目标日」的比例 */
  const start = g.created_at ? new Date(g.created_at) : new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(g.target_date + 'T00:00:00');
  const totalDays = Math.max(1, Math.round((end - start) / 86400000));
  const usedDays = Math.max(0, Math.round((new Date().setHours(0, 0, 0, 0) - start) / 86400000));
  const expected = Math.min(100, Math.round((usedDays / totalDays) * 100));

  if (p === 0) {
    /* 刚立下的目标给几天宽限。否则用户一建目标就看到「还没开始」，
       这种提示不但没帮助，还会让人不想再打开这个页面。 */
    if (usedDays < 3) return { state: 'on', expected, text: '刚立下，先动起来' };
    return { state: 'stuck', expected, text: `时间已过 ${expected}%，还没开始` };
  }
  if (p + 8 < expected) return { state: 'behind', expected, text: `时间已过 ${expected}%，进度落后 ${expected - p}%` };
  if (p >= expected + 8) return { state: 'ahead', expected, text: `快于计划（时间 ${expected}%）` };
  return { state: 'on', expected, text: '节奏正常' };
}

/* ---------------- 目标卡 ---------------- */

function goalCard(g) {
  const cat = goalCatOf(g.category);
  const dl = daysLeft(g.target_date);
  const done = g.status === 'done' || g.progress >= 100;
  const pc = pace(g);
  const tasks = (state.tasks || []).filter((t) => String(t.goal_id) === String(g.id));
  const openTasks = tasks.filter((t) => t.status !== 'done').length;
  return h(
    'div',
    { class: 'goal-card' + (done ? ' done' : '') + (pc.state === 'behind' ? ' lag' : '') },
    h(
      'div',
      { class: 'goal-head' },
      h('span', { class: 'goal-cat', style: `background:${cat.color}18;color:${cat.color}` }, cat.label),
      h('div', { style: 'flex:1' }),
      dl != null && !done
        ? h(
            'span',
            { class: 'goal-days' + (dl < 0 ? ' overdue' : dl <= 7 ? ' soon' : '') },
            dl < 0 ? `逾期 ${-dl} 天` : dl === 0 ? '就是今天' : `还剩 ${dl} 天`
          )
        : null
    ),
    h('div', { class: 'goal-title' }, g.title),
    g.detail ? h('div', { class: 'goal-detail' }, g.detail) : null,
    /* 进度条上叠一条「计划进度」参考线，一眼看出快了还是慢了 */
    h(
      'div',
      { class: 'goal-bar' },
      h('div', { class: 'goal-bar-fill', style: `width:${g.progress || 0}%;background:${cat.color}` }),
      pc.expected != null && !done
        ? h('div', { class: 'goal-bar-mark', style: `left:${pc.expected}%`, title: `按时间应到 ${pc.expected}%` })
        : null
    ),
    pc.text
      ? h(
          'div',
          { class: 'goal-pace ' + pc.state },
          h('span', { class: 'pace-dot' }),
          pc.text
        )
      : null,
    tasks.length
      ? h(
          'div',
          { class: 'muted', style: 'font-size:12px;margin-top:8px' },
          `关联任务 ${tasks.length - openTasks}/${tasks.length} 已完成`,
          openTasks ? `（还有 ${openTasks} 件没做）` : ''
        )
      : null,
    h(
      'div',
      { class: 'goal-foot' },
      h('span', { class: 'muted', style: 'font-size:12px' }, `${g.progress || 0}%`),
      h('div', { style: 'flex:1' }),
      done
        ? null
        : h(
            'div',
            { class: 'row', style: 'gap:6px' },
            h('button', { class: 'btn btn-sm btn-ghost', onclick: () => bumpProgress(g, -10) }, '−10'),
            h('button', { class: 'btn btn-sm btn-ghost', onclick: () => bumpProgress(g, 10) }, '+10'),
            h('button', { class: 'btn btn-sm', onclick: () => bumpProgress(g, 100 - (g.progress || 0)) }, '完成')
          ),
      h('button', { class: 'link', style: 'font-size:12px;margin-left:10px', onclick: () => openEditor(g) }, '编辑')
    )
  );
}

/* ---------------- 页面骨架 ---------------- */

function tabBar() {
  const tabs = [
    { k: 'goals', l: '目标', icon: '🎯' },
    { k: 'tasks', l: '任务', icon: '☑' },
    { k: 'schedule', l: '日程', icon: '🗓' }
  ];
  const tasks = state.tasks || [];
  const openTasks = tasks.filter((t) => t.kind !== 'event' && t.status !== 'done').length;
  return h(
    'div',
    { class: 'bs-tabs' },
    ...tabs.map((t) =>
      h(
        'button',
        {
          class: 'bs-tab' + (gtab === t.k ? ' on' : ''),
          onclick: () => setGoalsTab(t.k)
        },
        h('span', { class: 'ic' }, t.icon),
        t.l,
        t.k === 'tasks' && openTasks ? h('span', { class: 'chip-n' }, String(openTasks)) : null
      )
    )
  );
}

export function goalsView() {
  if (state.tasksTab && state.tasksTab !== gtab) gtab = state.tasksTab;
  const all = state.goals || [];
  const active = all.filter((g) => g.status !== 'done');
  const done = all.filter((g) => g.status === 'done');

  const titles = { goals: '未来目标', tasks: '任务', schedule: '日程' };
  const descs = {
    goals: active.length ? `${active.length} 个在推进，${done.length} 个已完成` : '还没立目标。想清楚要去哪，比走得快更重要。',
    tasks: (() => {
      const t = (state.tasks || []).filter((x) => x.kind !== 'event');
      const o = t.filter((x) => x.status !== 'done').length;
      return t.length ? `${o} 件没做完，共 ${t.length} 件` : '把要做的事写下来，一件一件划掉。';
    })(),
    schedule: (() => {
      const e = (state.tasks || []).filter((x) => x.kind === 'event');
      return e.length ? `${e.length} 个安排` : '有具体时间的安排放这里：会议、约人、出行。';
    })()
  };

  const head = h(
    'div',
    { class: 'page-head' },
    h('div', {}, h('h1', {}, titles[gtab]), h('p', { class: 'desc' }, descs[gtab])),
    h(
      'div',
      { class: 'toolbar' },
      h(
        'button',
        { class: 'btn btn-ghost', onclick: () => import('./view-expert.js').then((m) => m.openExpert('goal')) },
        '🧑‍💼 目标教练'
      ),
      gtab === 'goals'
        ? h('button', { class: 'btn btn-accent', onclick: () => openEditor(null) }, '+ 立个目标')
        : h('button', { class: 'btn btn-accent', onclick: () => openTaskEditor(null, gtab === 'schedule' ? 'event' : 'task') },
            gtab === 'schedule' ? '+ 加日程' : '+ 加任务')
    )
  );

  const body = gtab === 'goals' ? goalsBody(active, done) : gtab === 'tasks' ? tasksBody() : scheduleBody();

  return h('div', {}, head, tabBar(), body);
}

function goalsBody(active, done) {
  const all = state.goals || [];

  /* 读取失败时明确告知，不能伪装成「还没有目标」 */
  const errBanner = state.goalsErr
    ? h(
        'div',
        { class: 'card', style: 'border-color:#e0b4a8;background:#fdf6f4;margin-bottom:16px' },
        h('div', { style: 'font-size:13px;color:#a4432c;line-height:1.7' }, `目标没读出来：${state.goalsErr}`),
        h(
          'button',
          {
            class: 'btn btn-sm btn-ghost',
            style: 'margin-top:8px',
            onclick: () => {
              state.goalsErr = '';
              loadGoals();
            }
          },
          '重试'
        )
      )
    : null;

  if (!all.length) {
    return h(
      'div',
      {},
      errBanner,
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'big' }, '◎'),
        h('p', {}, state.goalsErr ? '数据没读出来，先点上面的重试。' : '目标可以先写得粗一点，边做边改。'),
        h('button', { class: 'btn btn-ghost', onclick: () => openEditor(null) }, '写下第一个目标')
      )
      /* 编辑面板不再挂在这里 —— 已提升到 shell() 全局层渲染（main.js） */
    );
  }

  return h(
    'div',
    {},
    errBanner,
    summaryStrip(active, done),
    !active.length
      ? h(
          'div',
          { class: 'card', style: 'margin-bottom:16px;text-align:center;padding:22px 16px' },
          h('div', { style: 'font-size:24px;line-height:1.2' }, '🎉'),
          h('p', { style: 'margin:8px 0 12px;font-size:13.5px' }, `${done.length} 个目标都完成了。`),
          h('button', { class: 'btn btn-sm btn-accent', onclick: () => openEditor(null) }, '再立一个')
        )
      : h('div', { class: 'goal-grid' }, ...active.map(goalCard)),
    done.length
      ? h(
          'div',
          { style: 'margin-top:28px' },
          h('div', { class: 'section-label' }, '已完成'),
          h('div', { class: 'goal-grid' }, ...done.map(goalCard))
        )
      : null
  );
}

/* ---------------- 任务 ---------------- */

const PRIORITY = [
  { k: 'high', l: '重要', color: '#c05a4a' },
  { k: 'normal', l: '一般', color: '#8a8a8c' },
  { k: 'low', l: '有空再说', color: '#9a958c' }
];

function prioOf(k) {
  return PRIORITY.find((p) => p.k === k) || PRIORITY[1];
}

function goalTitleOf(id) {
  if (!id) return '';
  return (state.goals || []).find((g) => String(g.id) === String(id))?.title || '';
}

function dueLabel(dateStr) {
  const d = daysLeft(dateStr);
  if (d == null) return { text: '没定日期', cls: '' };
  if (d < 0) return { text: `逾期 ${-d} 天`, cls: 'overdue' };
  if (d === 0) return { text: '今天', cls: 'soon' };
  if (d === 1) return { text: '明天', cls: 'soon' };
  if (d <= 7) return { text: `${d} 天后`, cls: 'soon' };
  return { text: dateStr.slice(5), cls: '' };
}

function taskRow(t) {
  const done = t.status === 'done';
  const due = dueLabel(t.due_date);
  const pr = prioOf(t.priority);
  const gt = goalTitleOf(t.goal_id);
  return h(
    'div',
    { class: 'task-row' + (done ? ' done' : '') },
    h(
      'button',
      {
        class: 'task-check' + (done ? ' on' : ''),
        onclick: () => toggleTask(t),
        title: done ? '标记为未完成' : '标记完成'
      },
      done ? '✓' : ''
    ),
    h(
      'div',
      { style: 'flex:1;min-width:0' },
      h('div', { class: 'task-title' }, t.title),
      h(
        'div',
        { class: 'task-meta' },
        h('span', { class: 'task-due ' + due.cls }, due.text),
        pr.k !== 'normal' ? h('span', { class: 'task-prio', style: `color:${pr.color}` }, pr.l) : null,
        gt ? h('span', { class: 'task-goal' }, `→ ${gt}`) : null,
        t.detail ? h('span', { class: 'muted' }, t.detail.slice(0, 24)) : null
      )
    ),
    h(
      'div',
      { class: 'row', style: 'gap:4px;flex-shrink:0' },
      h('button', { class: 'link-btn', onclick: () => openTaskEditor(t) }, '改'),
      h('button', { class: 'link-btn danger', onclick: () => removeTask(t.id) }, '删')
    )
  );
}

function tasksBody() {
  const all = (state.tasks || []).filter((t) => t.kind !== 'event');
  const open = all.filter((t) => t.status !== 'done');
  const done = all.filter((t) => t.status === 'done');

  /* 排序：逾期最前，然后按日期，最后没日期的 */
  const rank = (t) => {
    const d = daysLeft(t.due_date);
    return d == null ? 9999 : d;
  };
  open.sort((a, b) => {
    const pa = a.priority === 'high' ? 0 : a.priority === 'low' ? 2 : 1;
    const pb = b.priority === 'high' ? 0 : b.priority === 'low' ? 2 : 1;
    if (pa !== pb) return pa - pb;
    return rank(a) - rank(b);
  });

  if (state.tasksErr) {
    return h(
      'div',
      { class: 'card', style: 'border-color:#e0b4a8;background:#fdf6f4' },
      h('div', { style: 'font-size:13px;color:#a4432c' }, `任务没读出来：${state.tasksErr}`),
      h('button', { class: 'btn btn-sm btn-ghost', style: 'margin-top:8px', onclick: () => { state.tasksErr = ''; loadTasks(); } }, '重试')
    );
  }

  return h(
    'div',
    {},
    state.tasks === undefined
      ? h('div', { class: 'muted', style: 'padding:20px 0' }, h('span', { class: 'spinner spinner-sm' }), ' 读取中…')
      : !all.length
        ? h(
            'div',
            { class: 'empty' },
            h('div', { class: 'big' }, '☑'),
            h('p', {}, '还没有任务。把「要做什么」写下来，做完划掉。'),
            h('button', { class: 'btn btn-ghost', onclick: () => openTaskEditor(null, 'task') }, '加第一件事')
          )
        : h(
            'div',
            {},
            h(
              'div',
              { class: 'card', style: 'padding:6px 16px' },
              open.length ? open.map(taskRow) : h('div', { class: 'muted', style: 'padding:16px 0;font-size:13px' }, '全部做完了 🎉')
            ),
            done.length
              ? h(
                  'div',
                  { style: 'margin-top:20px' },
                  h('div', { class: 'section-label' }, `已完成（${done.length}）`),
                  h('div', { class: 'card', style: 'padding:6px 16px' }, ...done.slice(0, 20).map(taskRow))
                )
              : null
          )
  );
}

/* ---------------- 日程 ---------------- */

function scheduleBody() {
  const all = (state.tasks || []).filter((t) => t.kind === 'event');
  if (state.tasksErr) return h('div', { class: 'card' }, `日程没读出来：${state.tasksErr}`);
  if (state.tasks === undefined) return h('div', { class: 'muted' }, h('span', { class: 'spinner spinner-sm' }), ' 读取中…');

  if (!all.length) {
    return h(
      'div',
      { class: 'empty' },
      h('div', { class: 'big' }, '🗓'),
      h('p', {}, '还没有日程。会议、约人、出行这类有时间的安排放这里。'),
      h('button', { class: 'btn btn-ghost', onclick: () => openTaskEditor(null, 'event') }, '加第一个日程')
    );
  }

  /* 按日期分组 */
  const groups = new Map();
  all
    .slice()
    .sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')) || String(a.due_time || '').localeCompare(String(b.due_time || '')))
    .forEach((t) => {
      const k = t.due_date || '未定日期';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    });

  return h(
    'div',
    {},
    ...[...groups.entries()].map(([date, items]) => {
      const d = date === '未定日期' ? { text: date, cls: '' } : dueLabel(date);
      const wd = date !== '未定日期' ? new Date(date + 'T00:00:00').toLocaleDateString('zh-CN', { weekday: 'short' }) : '';
      return h(
        'div',
        { style: 'margin-bottom:18px' },
        h(
          'div',
          { class: 'sched-day' },
          h('span', { class: 'sched-date' }, date === '未定日期' ? date : `${date.slice(5)} ${wd}`),
          h('span', { class: 'task-due ' + d.cls, style: 'margin-left:8px' }, d.text)
        ),
        h(
          'div',
          { class: 'card', style: 'padding:6px 16px' },
          ...items.map((t) =>
            h(
              'div',
              { class: 'task-row' + (t.status === 'done' ? ' done' : '') },
              h('div', { class: 'sched-time' }, t.due_time || '全天'),
              h(
                'div',
                { style: 'flex:1;min-width:0' },
                h('div', { class: 'task-title' }, t.title),
                h(
                  'div',
                  { class: 'task-meta' },
                  goalTitleOf(t.goal_id) ? h('span', { class: 'task-goal' }, `→ ${goalTitleOf(t.goal_id)}`) : null,
                  t.detail ? h('span', { class: 'muted' }, t.detail.slice(0, 40)) : null
                )
              ),
              h(
                'div',
                { class: 'row', style: 'gap:4px;flex-shrink:0' },
                h('button', { class: 'link-btn', onclick: () => openTaskEditor(t) }, '改'),
                h('button', { class: 'link-btn danger', onclick: () => removeTask(t.id) }, '删')
              )
            )
          )
        )
      );
    })
  );
}

/* 顶部概览：一眼看出哪些目标在落后 */
function summaryStrip(active, done) {
  if (!active.length) return null;
  const behind = active.filter((g) => pace(g).state === 'behind');
  const stuck = active.filter((g) => pace(g).state === 'stuck');
  const avg = Math.round(active.reduce((a, g) => a + (Number(g.progress) || 0), 0) / active.length);
  const tasks = state.tasks || [];
  const openTasks = tasks.filter((t) => t.kind !== 'event' && t.status !== 'done');
  const overdue = openTasks.filter((t) => (daysLeft(t.due_date) ?? 99) < 0);
  return h(
    'div',
    { class: 'goal-sum' },
    h('div', { class: 'gs-item' }, h('span', { class: 'gs-n' }, `${avg}%`), h('span', { class: 'gs-l' }, '平均进度')),
    h('div', { class: 'gs-item' }, h('span', { class: 'gs-n' }, String(active.length)), h('span', { class: 'gs-l' }, '在推进')),
    h(
      'div',
      { class: 'gs-item' },
      h('span', { class: 'gs-n ' + (behind.length ? 'bad' : '') }, String(behind.length)),
      h('span', { class: 'gs-l' }, '进度落后')
    ),
    h(
      'div',
      { class: 'gs-item' },
      h('span', { class: 'gs-n ' + (overdue.length ? 'warn' : '') }, String(overdue.length)),
      h('span', { class: 'gs-l' }, '任务逾期')
    ),
    behind.length || overdue.length
      ? h(
          'div',
          { class: 'gs-tip' },
          behind.length ? `${behind[0].title} 落后于计划` : `${overdue[0].title} 已逾期`,
          behind.length + overdue.length > 1 ? ` 等 ${behind.length + overdue.length} 项` : ''
        )
      : h('div', { class: 'gs-tip ok' }, '都在节奏上')
  );
}

/* ---------------- 目标编辑面板 ---------------- */

export function goalEditorView() {
  const g = state.goalEditor;
  if (!g) return null;
  return h(
    'div',
    { class: 'editor', onclick: (ev) => ev.target.classList.contains('editor') && closeEditor() },
    h(
      'div',
      { class: 'editor-panel editor-panel-narrow' },
      h(
        'div',
        { class: 'editor-head' },
        h('span', {}, g.id ? '编辑目标' : '新的目标'),
        h('div', { style: 'flex:1' }),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: closeEditor }, '关闭')
      ),
      h(
        'div',
        { class: 'editor-body' },
        h('input', {
          class: 'title-input',
          placeholder: '目标是什么？例如：三个月内存下 3 万',
          value: g.title || '',
          oninput: (ev) => {
            state.goalEditor.title = ev.target.value;
          }
        }),
        h('textarea', {
          class: 'content-input',
          style: 'min-height:90px',
          placeholder: '为什么想做到？打算怎么开始？（可以留空）',
          value: g.detail || '',
          oninput: (ev) => {
            state.goalEditor.detail = ev.target.value;
          }
        }),
        h(
          'div',
          { style: 'margin-top:16px' },
          h('div', { class: 'muted', style: 'margin-bottom:8px' }, '归类'),
          h(
            'div',
            { class: 'chip-row' },
            ...GOAL_CATEGORIES.map((c) =>
              h(
                'button',
                {
                  class: 'chip' + (g.category === c.k ? ' on' : ''),
                  style: g.category === c.k ? `border-color:${c.color};color:${c.color};background:${c.color}12` : '',
                  onclick: () => {
                    state.goalEditor.category = c.k;
                    render();
                  }
                },
                c.label
              )
            )
          )
        ),
        h(
          'div',
          { class: 'row', style: 'margin-top:18px;gap:16px' },
          h(
            'div',
            { style: 'flex:1' },
            h('div', { class: 'muted', style: 'margin-bottom:6px' }, '目标日期'),
            h('input', {
              class: 'input',
              type: 'date',
              value: g.target_date || '',
              oninput: (ev) => {
                state.goalEditor.target_date = ev.target.value;
              }
            })
          ),
          h(
            'div',
            { style: 'flex:1' },
            /* 用 id 定位而不是 previousSibling：那个假设一改 DOM 结构就会静默失效 */
            h('div', { class: 'muted', id: 'goal-progress-label', style: 'margin-bottom:6px' }, `进度 ${g.progress || 0}%`),
            h('input', {
              class: 'range',
              type: 'range',
              min: '0',
              max: '100',
              step: '5',
              value: g.progress || 0,
              oninput: (ev) => {
                state.goalEditor.progress = Number(ev.target.value);
                const lbl = document.getElementById('goal-progress-label');
                if (lbl) lbl.textContent = `进度 ${ev.target.value}%`;
              }
            })
          )
        )
      ),
      h(
        'div',
        { class: 'editor-foot' },
        h(
          'div',
          { class: 'row' },
          g.id
            ? h(
                'button',
                {
                  class: 'btn btn-sm btn-ghost danger-text',
                  onclick: () => {
                    remove(g.id);
                    closeEditor();
                  }
                },
                '删除'
              )
            : null,
          h('button', { class: 'btn btn-sm btn-accent', onclick: commit, disabled: !!state.goalSaving }, state.goalSaving ? '保存中…' : g.id ? '保存' : '立下')
        )
      )
    )
  );
}

/* ---------------- 任务 / 日程编辑面板 ---------------- */

export function taskEditorView() {
  const t = state.taskEditor;
  if (!t) return null;
  const isEvent = t.kind === 'event';
  const goals = state.goals || [];

  return h(
    'div',
    { class: 'editor', onclick: (ev) => ev.target.classList.contains('editor') && closeTaskEditor() },
    h(
      'div',
      { class: 'editor-panel editor-panel-narrow' },
      h(
        'div',
        { class: 'editor-head' },
        h('span', {}, t.id ? (isEvent ? '编辑日程' : '编辑任务') : isEvent ? '新的日程' : '新的任务'),
        h('div', { style: 'flex:1' }),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: closeTaskEditor }, '关闭')
      ),
      h(
        'div',
        { class: 'editor-body' },
        h('input', {
          class: 'title-input',
          placeholder: isEvent ? '什么安排？例如：周三下午和客户开会' : '要做什么？例如：整理上个月的账单',
          value: t.title || '',
          oninput: (ev) => {
            state.taskEditor.title = ev.target.value;
          }
        }),
        h('textarea', {
          class: 'content-input',
          style: 'min-height:70px',
          placeholder: '补充说明（可以留空）',
          value: t.detail || '',
          oninput: (ev) => {
            state.taskEditor.detail = ev.target.value;
          }
        }),
        h(
          'div',
          { class: 'row', style: 'margin-top:16px;gap:12px' },
          h(
            'div',
            { style: 'flex:1' },
            h('div', { class: 'muted', style: 'margin-bottom:6px' }, isEvent ? '日期' : '截止日期'),
            h('input', {
              class: 'input',
              type: 'date',
              value: t.due_date || '',
              oninput: (ev) => {
                state.taskEditor.due_date = ev.target.value;
              }
            })
          ),
          h(
            'div',
            { style: isEvent ? 'flex:1' : 'flex:1;opacity:.55' },
            h('div', { class: 'muted', style: 'margin-bottom:6px' }, isEvent ? '时间' : '时间（日程用）'),
            h('input', {
              class: 'input',
              type: 'time',
              value: t.due_time || '',
              oninput: (ev) => {
                state.taskEditor.due_time = ev.target.value;
              }
            })
          )
        ),
        !isEvent
          ? h(
              'div',
              { style: 'margin-top:16px' },
              h('div', { class: 'muted', style: 'margin-bottom:8px' }, '优先级'),
              h(
                'div',
                { class: 'chip-row' },
                ...PRIORITY.map((p) =>
                  h(
                    'button',
                    {
                      class: 'chip' + (t.priority === p.k ? ' on' : ''),
                      style: t.priority === p.k ? `border-color:${p.color};color:${p.color}` : '',
                      onclick: () => {
                        state.taskEditor.priority = p.k;
                        render();
                      }
                    },
                    p.l
                  )
                )
              )
            )
          : null,
        goals.length
          ? h(
              'div',
              { style: 'margin-top:16px' },
              h('div', { class: 'muted', style: 'margin-bottom:8px' }, '关联到目标（可选）'),
              h(
                'div',
                { class: 'chip-row' },
                h(
                  'button',
                  {
                    class: 'chip' + (!t.goal_id ? ' on' : ''),
                    onclick: () => {
                      state.taskEditor.goal_id = null;
                      render();
                    }
                  },
                  '不关联'
                ),
                ...goals.slice(0, 8).map((g) =>
                  h(
                    'button',
                    {
                      class: 'chip' + (String(t.goal_id) === String(g.id) ? ' on' : ''),
                      onclick: () => {
                        state.taskEditor.goal_id = g.id;
                        render();
                      }
                    },
                    g.title.slice(0, 12)
                  )
                )
              )
            )
          : null
      ),
      h(
        'div',
        { class: 'editor-foot' },
        h(
          'div',
          { class: 'row' },
          t.id
            ? h(
                'button',
                {
                  class: 'btn btn-sm btn-ghost danger-text',
                  onclick: () => {
                    removeTask(t.id);
                    closeTaskEditor();
                  }
                },
                '删除'
              )
            : null,
          h(
            'button',
            { class: 'btn btn-sm btn-accent', onclick: commitTask, disabled: !!state.taskSaving },
            state.taskSaving ? '保存中…' : t.id ? '保存' : isEvent ? '加入日程' : '添加'
          )
        )
      )
    )
  );
}
