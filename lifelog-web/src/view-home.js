/* 首页（今日概览）：仿手机卡片式布局。
   上：三张统计卡（今日待办 / 今日支出 / 未来计划）+ 一句提示；
   中：今日待办、接下来的计划两张内容卡；
   下：功能磁贴两列，每个磁贴可进页面，也可点旁边的专家直接求助。 */

import { h, setState, render, toast, state, todayStr } from './store.js';
import { fmtMoney, listTodos, setTodoDone, addTodo } from './cloud.js';
import { entryFacets } from './facets.js';
import { EXPERTS, expertOf } from './experts.js';
import { openExpert } from './view-expert.js';

/* 首页自己的数据缓存（离开页面不清，进页面刷新） */
let home = { loaded: '', rows: [], tx: [], goals: [], todos: [] };

/* 测试用：直接灌一份数据，让渲染路径（尤其是列表行）真的被执行。
   没有这个口子，空数据下列表渲染代码一次都不会跑，
   连「渲染函数被写成 async」这种错都测不出来。 */
export function __setHomeForTest(data) {
  home = { loaded: '', rows: [], tx: [], goals: [], todos: [], ...data };
}

export async function loadHome() {
  const today = todayStr();
  setState({ loading: true });
  try {
    const { cloud } = await import('./cloud.js');
    const month = today.slice(0, 7);
    const [entries, tx, goals, todos] = await Promise.all([
      cloud.database
        .from('entries')
        .select('id,entry_date,title,summary,digest,facets,tags,ai_at')
        .order('entry_date', { ascending: false })
        .limit(120),
      cloud.database.from('transactions').select('*').gte('tx_date', month + '-01').lte('tx_date', today),
      cloud.database.from('goals').select('*').order('status', { ascending: true }),
      /* 待办读真实表，完成状态服务端持久化。表还没建时不能把整个首页拖崩，单独兜住。 */
      listTodos().catch(() => [])
    ]);
    home = {
      loaded: today,
      rows: entries.data || [],
      tx: tx.data || [],
      goals: goals.data || [],
      todos: Array.isArray(todos) ? todos : []
    };
    setState({ loading: false });
    render();
  } catch (e) {
    setState({ loading: false });
    toast('首页数据读取失败：' + (e.message || e), 'err');
  }
}

/* ---------- 数据加工 ---------- */

function weekdayCn(d) {
  return ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
}

/* 待办：读 todos 表。未办好的排在前面，同一天内按新到旧。
   兼容老数据：todos 表为空时，退回从最近 14 天日记的 digest.todos 取（只读展示）。 */
function todosOf() {
  const rows = (home.todos || []).filter((t) => t && t.title);
  if (rows.length) {
    const open = rows.filter((t) => t.status !== 'done');
    const done = rows
      .filter((t) => t.status === 'done')
      .sort((a, b) => String(b.done_at || '').localeCompare(String(a.done_at || '')))
      .slice(0, 5);
    return { open, done, list: [...open, ...done] };
  }
  const cut = new Date();
  cut.setDate(cut.getDate() - 14);
  const p2 = (x) => String(x).padStart(2, '0');
  const cutStr = `${cut.getFullYear()}-${p2(cut.getMonth() + 1)}-${p2(cut.getDate())}`;
  const out = [];
  (home.rows || [])
    .filter((r) => String(r.entry_date) >= cutStr)
    .forEach((r) => {
      const arr = r.digest && Array.isArray(r.digest.todos) ? r.digest.todos : [];
      arr.forEach((t) => out.push({ id: null, title: String(t), source_date: r.entry_date, entry_id: r.id, status: 'todo' }));
    });
  return { open: out.slice(0, 8), done: [], list: out.slice(0, 8) };
}

/* 一条待办。左边是圆形勾选框（点了就打勾、划掉），右边保留日期和删除。
   上一版只有一个「✓ 办好」小按钮，视觉上跟文字没区别，所以看不清能点——
   这里改成待办清单的通用形态：勾选框本身就是操作入口。 */
/* 注意：这个函数必须是同步的。它返回的是一棵 DOM 描述树，
   一旦写成 async 就变成 Promise，h() 会把它当普通子节点，
   buildTree 拿到 node.tag === undefined → createElement 抛错 → 整个首页白屏。 */
function todoRow(t, onChanged) {
  const done = t.status === 'done';
  /* 防连点：闭包里的 done 是渲染时的快照，连点两次两次都读到同一个值，
     会把用户想「取消」的操作又写回「完成」。这里加个进行中标记。 */
  let pending = false;
  const toggle = async () => {
    if (pending) return;
    if (!t.id) {
      toast('这条来自旧日记，去日记里重新提炼一次就能勾选了', 'err');
      return;
    }
    pending = true;
    try {
      await setTodoDone(t.id, !done);
      toast(done ? '已恢复为待办' : '已完成 ✓');
      await onChanged();
    } catch (e) {
      toast('没记上：' + (e.message || e), 'err');
    }
    pending = false;
  };
  return h(
    'div',
    { class: 'todo-line' + (done ? ' is-done' : '') },
    h(
      'button',
      {
        class: 'todo-check' + (done ? ' on' : ''),
        title: done ? '撤销完成' : '标记为已完成',
        onclick: toggle,
        'aria-label': done ? '撤销完成' : '标记为已完成'
      },
      done ? h('span', { class: 'todo-tick' }, '✓') : null
    ),
    h('span', { class: 'todo-title', onclick: toggle }, t.title),
    h('span', { class: 'muted mono todo-date' }, String(t.source_date || '').slice(5)),
    h(
      'button',
      { class: 'todo-del', title: '删除这条待办', onclick: async () => {
          if (!t.id) return;
          try {
            const { deleteTodo } = await import('./cloud.js');
            await deleteTodo(t.id);
            toast('已删除');
            await onChanged();
          } catch (e) {
            toast('删除失败：' + (e.message || e), 'err');
          }
        } },
      '×'
    )
  );
}

/* 今日支出：transactions 当天 direction=out 合计 */
function todaySpend() {
  const today = todayStr();
  return (home.tx || [])
    .filter((t) => String(t.tx_date) === today && (t.direction === 'out' || t.direction === 'expense' || !t.direction))
    .reduce((a, t) => a + Math.abs(Number(t.amount) || 0), 0);
}

/* 未来计划：进行中、有截止日在今天以后的目标 */
function upcomingGoals() {
  const today = todayStr();
  return (home.goals || [])
    .filter((g) => g.status !== 'done')
    .sort((a, b) => {
      const ad = a.target_date || '9999-99-99';
      const bd = b.target_date || '9999-99-99';
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    })
    .slice(0, 5);
}

/* ---------- 功能磁贴 ---------- */

const TILES = [
  { icon: '💼', label: '每日工作', view: 'life', expert: 'diary', expertTip: '日记整理师' },
  { icon: '📝', label: '琐碎事·随手记', view: 'diary', expert: 'diary', expertTip: '日记整理师' },
  { icon: '💰', label: '平时花销', view: 'tx', expert: 'finance', expertTip: '财务分析师' },
  { icon: '🏦', label: '银行账目', view: 'import', expert: 'finance', expertTip: '财务分析师' },
  { icon: '👔', label: '形象', view: 'life', expert: 'health', expertTip: '健康顾问' },
  { icon: '❤️', label: '日常关系', view: 'life', expert: 'relation', expertTip: '关系顾问' },
  { icon: '☯️', label: '八字命理', view: 'bazi', expert: 'bazi', expertTip: '子平命理师' },
  { icon: '🎯', label: '未来目标', view: 'goals', expert: 'goal', expertTip: '目标教练' }
];

/* ---------- 视图 ---------- */

/* 新增待办：不用弹窗，直接在卡片底部一行输入框，回车即加 */
let newTodo = { text: '', busy: false };

export function homeView() {
  const d = new Date();
  const dateLabel = `${d.getMonth() + 1}月${d.getDate()}日星期${weekdayCn(d)}`;
  const todoSet = todosOf();
  const todos = todoSet.open;
  const spend = todaySpend();
  const plans = upcomingGoals();

  const greeting =
    d.getHours() < 6 ? '夜深了' : d.getHours() < 11 ? '早上好' : d.getHours() < 14 ? '中午好' : d.getHours() < 19 ? '下午好' : '晚上好';

  return h(
    'div',
    { class: 'home' },
    /* 头部 */
    h(
      'div',
      { class: 'home-head' },
      h('h1', {}, '今日概览'),
      h('span', { class: 'muted' }, dateLabel)
    ),

    /* 三张统计卡 */
    h(
      'div',
      { class: 'stat-row' },
      statCard('待办 · 未完成', String(todos.length), todos.length ? '有新待办' : '清清爽爽', () => goTile('diary')),
      statCard('今日支出', fmtMoney(spend), spend > 0 ? '今天已消费' : '今天还没花钱', () => goTile('tx')),
      statCard('未来计划', String(plans.length), plans.length ? '进行中' : '还没有计划', () => goTile('goals'))
    ),

    /* 提示条 */
    h(
      'div',
      { class: 'home-tip' },
      todos.length ? `📌 有 ${todos.length} 条待办在等你，做完点左边的圆圈` : '🎉 今日暂无待办，保持节奏'
    ),

    /* 今日待办 */
    h(
      'div',
      { class: 'home-card' },
      h('div', { class: 'home-card-title' }, '🗓️ 今日待办'),
      todos.length || todoSet.done.length
        ? h(
            'div',
            {},
            todos.map((t) => todoRow(t, loadHome)),
            /* 已完成：默认收起来，避免做完的事还占视线 */
            todoSet.done.length
              ? h(
                  'div',
                  { style: 'margin-top:10px' },
                  h(
                    'div',
                    { class: 'muted', style: 'font-size:11.5px;margin-bottom:4px' },
                    `已完成 ${todoSet.done.length} 条（点勾可撤销）`
                  ),
                  todoSet.done.map((t) => todoRow(t, loadHome))
                )
              : null
          )
        : h(
            'div',
            { class: 'home-empty' },
            '暂无待办，保持节奏 🎉',
            h('div', { style: 'margin-top:12px' }, expertLink('goal', '没有头绪？找目标教练聊聊'))
          ),

      /* 直接加一条：不用去日记里写 */
      h(
        'div',
        { class: 'todo-add' },
        h('input', {
          class: 'input',
          id: 'home-new-todo',
          placeholder: '加一条待办，回车保存',
          value: newTodo.text,
          oninput: (ev) => {
            newTodo.text = ev.target.value;
          },
          onkeydown: async (ev) => {
            if (ev.key !== 'Enter' || newTodo.busy) return;
            const text = newTodo.text.trim();
            if (!text) return;
            newTodo.busy = true;
            try {
              await addTodo({ title: text });
              newTodo.text = '';
              toast('已加入待办');
              await loadHome();
            } catch (e) {
              toast('没加上：' + (e.message || e), 'err');
            }
            newTodo.busy = false;
          }
        }),
        h(
          'button',
          {
            class: 'btn btn-sm btn-accent',
            disabled: newTodo.busy,
            onclick: async () => {
              const text = newTodo.text.trim();
              if (!text || newTodo.busy) return;
              newTodo.busy = true;
              try {
                await addTodo({ title: text });
                newTodo.text = '';
                toast('已加入待办');
                await loadHome();
              } catch (e) {
                toast('没加上：' + (e.message || e), 'err');
              }
              newTodo.busy = false;
            }
          },
          '添加'
        )
      )
    ),

    /* 接下来的计划 */
    h(
      'div',
      { class: 'home-card' },
      h('div', { class: 'home-card-title' }, '🔭 接下来的计划'),
      plans.length
        ? h(
            'div',
            {},
            plans.map((g) =>
              h(
                'div',
                { class: 'plan-line' },
                h('div', { style: 'flex:1;min-width:0' }, h('div', { class: 'plan-name' }, g.title), h('div', { class: 'muted', style: 'font-size:11px' }, g.target_date ? '截止 ' + g.target_date : '没有截止日')),
                h('div', { class: 'plan-pct' }, (g.progress || 0) + '%')
              )
            ),
            h('div', { style: 'margin-top:12px' }, expertLink('goal', '让目标教练帮你拆第一步'))
          )
        : h(
            'div',
            { class: 'home-empty' },
            '还没有后续计划',
            h('div', { style: 'margin-top:12px' }, expertLink('goal', '想立个目标？找目标教练'))
          )
    ),

    /* 功能磁贴 */
    h(
      'div',
      { class: 'tile-grid' },
      ...TILES.map((t) =>
        h(
          'div',
          { class: 'tile' },
          h(
            'button',
            { class: 'tile-main', onclick: () => goTile(t.view) },
            h('span', { class: 'tile-ic' }, t.icon),
            h('span', { class: 'tile-label' }, t.label)
          ),
          h(
            'button',
            {
              class: 'tile-expert',
              title: '找' + t.expertTip + '辅助',
              onclick: () => openExpert(t.expert)
            },
            '🧑‍💼 ',
            t.expertTip
          )
        )
      )
    ),

    /* 专家中心 */
    h(
      'div',
      { class: 'home-card', style: 'margin-top:4px' },
      h('div', { class: 'home-card-title' }, '🧑‍💼 专家中心'),
      h('p', { class: 'muted', style: 'margin:4px 0 14px;font-size:12.5px;line-height:1.7' }, '每位专家都带着你的真实数据工作：财务分析师读得到你的账单，命理师傅拿的是你的四柱排盘。'),
      h(
        'div',
        { class: 'expert-grid' },
        ...EXPERTS.map((e) =>
          h(
            'button',
            { class: 'expert-card', onclick: () => openExpert(e.id) },
            h('span', { class: 'em' }, e.emoji),
            h('span', { class: 'nm' }, e.name),
            h('span', { class: 'tip' }, e.tip)
          )
        )
      )
    )
  );
}

function statCard(label, value, sub, onclick) {
  return h(
    'button',
    { class: 'stat-card', onclick },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' }, value),
    h('div', { class: 'stat-sub' }, sub)
  );
}

function expertLink(id, text) {
  const e = expertOf(id);
  if (!e) return null;
  return h(
    'button',
    { class: 'expert-inline', onclick: () => openExpert(id) },
    e.emoji + ' ',
    text
  );
}

async function goTile(view) {
  const { go } = await import('./main.js');
  go(view);
}
