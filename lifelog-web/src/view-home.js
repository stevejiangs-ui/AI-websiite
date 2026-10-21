/* 首页 = 人生仪表盘。围绕五件事：财富、家庭、开心、健康、形象，外加外部机会。
   上：一句话记（AI 自动归类）+ 今日建议；
   中：六大板块卡片，一眼看清今天的状态；
   下：家人提醒、今日待办、接下来的计划、专家。 */

import { h, setState, render, toast, state, todayStr } from './store.js';
import { fmtMoney, listTodos, setTodoDone, addTodo, listPeople, savePerson, saveEntry, getSelfProfile, MOOD_SCALE, errText } from './cloud.js';
import { entryFacets } from './facets.js';
import { EXPERTS, expertOf } from './experts.js';
import { openExpert } from './view-expert.js';
import { loadHealth, healthSummary } from './view-health.js';
import { loadSignals, signalsSummary } from './view-signals.js';
import { loadNews, newsSummary, focusNewsTopic } from './view-news.js';
import { openQuickSpend } from './quick-spend.js';
import { loadLooks, looksRecent } from './view-looks.js';
import { runDigest } from './view-diary.js';
import { askAI } from './ai.js';
import { luckyToday, luckyLine } from './lucky.js';
import { ensureBirth } from './view-fortune.js';

/* 首页自己的数据缓存（离开页面不清，进页面刷新） */
let home = { loaded: '', rows: [], tx: [], goals: [], todos: [], people: [] };

/* 测试用：直接灌一份数据，让渲染路径（尤其是列表行）真的被执行。
   没有这个口子，空数据下列表渲染代码一次都不会跑，
   连「渲染函数被写成 async」这种错都测不出来。 */
export function __setHomeForTest(data) {
  home = { loaded: '', rows: [], tx: [], goals: [], todos: [], people: [], ...data };
}

export async function loadHome() {
  const today = todayStr();
  setState({ loading: true });
  try {
    const { cloud } = await import('./cloud.js');
    const month = today.slice(0, 7);
    const [entries, tx, goals, todos, people] = await Promise.all([
      cloud.database
        .from('entries')
        .select('id,entry_date,title,content,summary,digest,facets,tags,mood,ai_at')
        .order('entry_date', { ascending: false })
        .limit(120),
      cloud.database.from('transactions').select('*').gte('tx_date', month + '-01').lte('tx_date', today),
      cloud.database.from('goals').select('*').order('status', { ascending: true }),
      /* 待办读真实表，完成状态服务端持久化。表还没建时不能把整个首页拖崩，单独兜住。 */
      listTodos().catch(() => []),
      listPeople().catch(() => [])
    ]);
    home = {
      loaded: today,
      rows: entries.data || [],
      tx: tx.data || [],
      goals: goals.data || [],
      todos: Array.isArray(todos) ? todos : [],
      people: Array.isArray(people) ? people : []
    };
    setState({ loading: false });
    render();
  } catch (e) {
    setState({ loading: false });
    toast('首页数据读取失败：' + (e.message || e), 'err');
  }
  /* 各板块自己的数据：分别加载，互不拖累（某张表没建也不影响首页） */
  try {
    ensureBirth();
  } catch (e) {
    /* 没填生辰 */
  }
  if (state.selfProfile === undefined) {
    getSelfProfile()
      .then((row) => {
        state.selfProfile = row ? row.data || {} : {};
        render();
      })
      .catch(() => {});
  }
  await Promise.all([loadHealth().catch(() => {}), loadSignals().catch(() => {}), loadLooks().catch(() => {}), loadNews().catch(() => {})]);
  render();
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

/* ---------- 板块数据 ---------- */

function monthMoney() {
  let inc = 0;
  let out = 0;
  (home.tx || []).forEach((t) => {
    const amt = Math.abs(Number(t.amount) || 0);
    if (t.direction === 'in') inc += amt;
    else out += amt;
  });
  return { inc, out, net: inc - out };
}

/* 生日：只看月日，算出离今天还有几天 */
function daysToBirthday(b) {
  if (!b) return null;
  const m = String(b).match(/(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const now = new Date(todayStr() + 'T00:00:00');
  let next = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]));
  if (next < now) next = new Date(now.getFullYear() + 1, Number(m[1]) - 1, Number(m[2]));
  return Math.round((next - now) / 86400000);
}

function daysSince(d) {
  if (!d) return null;
  const now = new Date(todayStr() + 'T00:00:00');
  const x = new Date(String(d).slice(0, 10) + 'T00:00:00');
  return Math.round((now - x) / 86400000);
}

/* 家人提醒：30 天内生日、14 天以上没联系（只看亲人；敏感卡不显示） */
function familyAlerts() {
  const fam = (home.people || []).filter((p) => p.relation === 'family' && !p.sensitive);
  const birthdays = fam
    .map((p) => ({ p, d: daysToBirthday(p.birthday) }))
    .filter((x) => x.d != null && x.d <= 30)
    .sort((a, b) => a.d - b.d);
  const quiet = fam
    .map((p) => ({ p, d: daysSince(p.last_contact) }))
    .filter((x) => x.d == null || x.d >= 14)
    .sort((a, b) => (b.d ?? 999) - (a.d ?? 999));
  return { fam, birthdays, quiet };
}

const ENTRY_MOOD = { happy: 5, calm: 4, tired: 2, anxious: 2, sad: 1 };

/* 开心指数：近 7 天健康打卡里的心情 + 日记心情，取平均 */
function joyIndex() {
  const vals = [];
  const cut = daysAgoStr(6);
  const hs = healthSummary();
  if (hs.mood) vals.push(hs.mood);
  (home.rows || []).forEach((r) => {
    if (String(r.entry_date) >= cut && ENTRY_MOOD[r.mood]) vals.push(ENTRY_MOOD[r.mood]);
  });
  const joys = (home.rows || []).filter((r) => String(r.entry_date) >= daysAgoStr(29) && entryFacets(r).includes('joy'));
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  return { avg, joys };
}

function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---------- 一句话记 ---------- */

let quick = { text: '', busy: false };

async function saveQuick() {
  const text = quick.text.trim();
  if (!text || quick.busy) return;
  quick.busy = true;
  render();
  try {
    const rows = await saveEntry({ entry_date: todayStr(), title: '', content: text, facets: [] }, state.session);
    const entry = Array.isArray(rows) ? rows[0] : rows;
    quick.text = '';
    toast('记下了，AI 正在归类…');
    if (entry && entry.id && state.aiOk !== false) {
      runDigest(entry)
        .catch(() => {})
        .finally(() => loadHome());
    } else {
      await loadHome();
    }
  } catch (e) {
    toast('没记上：' + errText(e), 'err');
  }
  quick.busy = false;
  render();
}

function quickCard() {
  return h(
    'div',
    { class: 'quick-card' },
    h('textarea', {
      class: 'input',
      id: 'quick-text',
      rows: 2,
      placeholder: '一句话记下今天的小事：花了什么钱、见了谁、穿了什么、身体怎样、什么让你开心…',
      value: quick.text,
      oninput: (ev) => (quick.text = ev.target.value),
      onkeydown: (ev) => {
        if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) saveQuick();
      }
    }),
    h(
      'div',
      { class: 'row-between', style: 'margin-top:8px;gap:8px' },
      h('span', { class: 'muted', style: 'font-size:11.5px' }, 'AI 会自动归到财富 / 家庭 / 开心 / 健康 / 形象等板块'),
      h('button', { class: 'btn btn-sm btn-accent', id: 'quick-save', disabled: quick.busy, onclick: saveQuick }, quick.busy ? h('span', { class: 'spinner spinner-sm' }) : '记下')
    )
  );
}

/* ---------- 今日建议 ---------- */

const BRIEF_KEY = 'lifelog.brief.v1';
let brief = { busy: false, text: '', date: '' };
try {
  const saved = JSON.parse(localStorage.getItem(BRIEF_KEY) || 'null');
  if (saved && saved.date === todayStr()) brief = { busy: false, ...saved };
} catch (e) {
  /* 没有缓存 */
}

async function makeBrief() {
  if (brief.busy) return;
  brief.busy = true;
  render();
  try {
    const m = monthMoney();
    const hs = healthSummary();
    const sg = signalsSummary();
    const fa = familyAlerts();
    const todos = todosOf().open.slice(0, 8);
    const goals = upcomingGoals();
    const joy = joyIndex();
    const recent = (home.rows || []).slice(0, 8).map((r) => `${r.entry_date} ${r.summary || String(r.content || '').slice(0, 80)}`);
    const text = await askAI(
      `今天是 ${todayStr()}。请根据我的情况，写一份「今日建议」，帮我今天在 发财、家庭幸福、开心、健康、形象 上各进一步。
格式：先一句话总基调；然后按「💰 财富 / 🏠 家庭 / 😊 开心 / 💪 健康 / 👔 形象」各给 1 条今天就能做的具体行动（引用我的数据，没数据的板块给通用但具体的建议）；最后「⚡ 今天最重要的一件事」。250 字以内，不要客套。

本月收支：收入 ${m.inc.toFixed(0)}，支出 ${m.out.toFixed(0)}，结余 ${m.net.toFixed(0)}。
目标：${goals.map((g) => `${g.title}(${g.progress || 0}%${g.target_date ? '，截止' + g.target_date : ''})`).join('；') || '无'}
待办：${todos.map((t) => t.title).join('；') || '无'}
家人：${fa.birthdays.map((x) => `${x.p.name}${x.d === 0 ? '今天' : x.d + '天后'}生日`).join('；') || '近期无生日'}；${fa.quiet.slice(0, 3).map((x) => `${x.p.name}${x.d == null ? '没记录联系' : x.d + '天没联系'}`).join('；') || '联系都正常'}
健康：今天${hs.today ? '已' : '未'}打卡；近7天平均睡眠 ${hs.sleep ? hs.sleep.toFixed(1) + 'h' : '无数据'}，运动 ${hs.exercise || 0} 分钟，心情 ${joy.avg ? joy.avg.toFixed(1) + '/5' : '无数据'}。
利好消息：${sg.top.map((x) => x.title).join('；') || '无'}
最近的事：
${recent.join('\n') || '无'}
${luckyLine()}`
    );
    brief = { busy: false, text, date: todayStr() };
    try {
      localStorage.setItem(BRIEF_KEY, JSON.stringify({ text, date: brief.date }));
    } catch (e) {
      /* 存不了就算了 */
    }
  } catch (e) {
    brief.busy = false;
    toast('AI 暂时用不了：' + (e.message || e), 'err');
  }
  render();
}

function briefCard() {
  const l = luckyToday();
  return h(
    'div',
    { class: 'home-card brief-card' },
    h(
      'div',
      { class: 'row-between', style: 'gap:10px' },
      h('div', { class: 'home-card-title', style: 'margin:0' }, '☀️ 今日建议'),
      h('button', { class: 'btn btn-sm ' + (brief.text ? 'btn-ghost' : 'btn-accent'), id: 'brief-btn', disabled: brief.busy, onclick: makeBrief }, brief.busy ? h('span', { class: 'spinner spinner-sm' }) : brief.text ? '刷新' : '生成')
    ),
    l ? h('div', { class: 'muted', style: 'font-size:12px;margin-top:6px' }, `今天 ${l.dayGz} 日 · 幸运色 ${l.colors.join('、')}${l.dirs.length ? ' · 利 ' + l.dirs.join('、') + ' 方' : ''}`) : null,
    brief.text
      ? h('div', { class: 'ai-text', style: 'margin-top:10px' }, brief.text)
      : h('div', { class: 'muted', style: 'font-size:12.5px;margin-top:8px;line-height:1.7' }, '综合你的收支、目标、待办、家人、健康、利好消息和八字，告诉你今天在每个方面做什么最有利。')
  );
}

/* ---------- 六大板块 ---------- */

function pillar(icon, title, value, sub, view, tone = '') {
  return h(
    'button',
    { class: 'pillar' + (tone ? ' ' + tone : ''), onclick: () => goTile(view) },
    h('div', { class: 'pillar-top' }, h('span', { class: 'pillar-ic' }, icon), h('span', { class: 'pillar-t' }, title)),
    h('div', { class: 'pillar-v' }, value),
    h('div', { class: 'pillar-s' }, sub)
  );
}

function pillars() {
  const m = monthMoney();
  const fa = familyAlerts();
  const joy = joyIndex();
  const hs = healthSummary();
  const sg = signalsSummary();
  const looks = looksRecent(1);
  const moodEm = joy.avg ? MOOD_SCALE[Math.max(0, Math.min(4, Math.round(joy.avg) - 1))].em : '';
  const famSub = fa.birthdays.length
    ? `${fa.birthdays[0].p.name}${fa.birthdays[0].d === 0 ? '今天生日 🎂' : ' ' + fa.birthdays[0].d + ' 天后生日'}`
    : fa.quiet.length
    ? `${fa.quiet.length} 位家人很久没联系了`
    : fa.fam.length
    ? '都联系着，很好'
    : '在「家人与圈子」里添加家人';
  return h(
    'div',
    { class: 'pillar-grid' },
    pillar('💰', '财富', fmtMoney(m.net), `本月收入 ${fmtMoney(m.inc)} · 支出 ${fmtMoney(m.out)}`, 'finance', m.net < 0 ? 'warn' : ''),
    pillar('🏠', '家庭', fa.fam.length ? `${fa.fam.length} 位家人` : '—', famSub, 'people', fa.birthdays.length || fa.quiet.length ? 'warn' : ''),
    pillar('😊', '开心', joy.avg ? `${moodEm} ${joy.avg.toFixed(1)}` : '—', joy.joys.length ? `近 30 天 ${joy.joys.length} 件开心事` : '记下让你开心的小事', 'diary'),
    pillar('💪', '健康', hs.missing ? '待开通' : hs.today ? '今天已打卡' : '今天未打卡', hs.sleep ? `近 7 天睡 ${hs.sleep.toFixed(1)}h · 动 ${hs.exercise} 分钟` : '每天 30 秒打卡', 'health', hs.missing || hs.today ? '' : 'warn'),
    pillar('👔', '形象', looks[0] ? h('img', { class: 'pillar-img', src: looks[0].url, alt: '最近穿搭' }) : '—', looks[0] ? '最近：' + (looks[0].title || String(looks[0].taken_at || '').slice(5)) : '拍下今天的穿搭', 'looks'),
    pillar('📰', '利好消息', sg.missing ? '待开通' : `${sg.newCount} 条新`, sg.top[0] ? sg.top[0].title : '看到好消息就存进来', 'signals', sg.newCount ? 'hot' : '')
  );
}

/* ---------- 今日消费 ---------- */

function spendCard() {
  const m = monthMoney();
  return h(
    'div',
    { class: 'home-card qs-home' },
    h(
      'div',
      { style: 'flex:1;min-width:0' },
      h('div', { class: 'muted', style: 'font-size:12px' }, '今天花了'),
      h('div', { class: 'qs-home-v' }, fmtMoney(todaySpend())),
      h('div', { class: 'muted', style: 'font-size:11.5px' }, `本月支出 ${fmtMoney(m.out)}`)
    ),
    h('button', { class: 'btn btn-sm', onclick: () => goTile('records') }, '明细'),
    h('button', { class: 'btn btn-sm btn-accent', id: 'home-qs', onclick: openQuickSpend }, '＋ 记消费')
  );
}

/* ---------- 新闻关注 ---------- */

function newsCard() {
  const ns = newsSummary();
  if (!ns.loaded || ns.missing) return null;
  return h(
    'div',
    { class: 'home-card' },
    h('div', { class: 'row-between' }, h('div', { class: 'home-card-title', style: 'margin:0' }, `🗞️ 新闻关注${ns.unread ? ' · ' + ns.unread + ' 条未读' : ''}`), h('button', { class: 'link', style: 'font-size:12px', onclick: () => goTile('news') }, '全部 ›')),
    h(
      'div',
      { class: 'nw-home' },
      ...ns.topics.map((x) =>
        h(
          'button',
          {
            class: 'nw-home-item',
            onclick: () => {
              focusNewsTopic(x.t.k);
              goTile('news');
            }
          },
          h('span', {}, x.t.emoji),
          h('div', { style: 'flex:1;min-width:0' }, h('b', {}, x.t.label), h('div', { class: 'muted nw-home-latest' }, x.latest ? x.latest.title : '点一下搜最新')),
          x.unread ? h('span', { class: 'nw-dot' }, x.unread) : null
        )
      )
    )
  );
}

/* ---------- 家人提醒 ---------- */

async function contacted(p) {
  try {
    await savePerson({ ...p, last_contact: todayStr() });
    toast(`记下了：今天联系了${p.name}`);
    await loadHome();
  } catch (e) {
    toast('没记上：' + errText(e), 'err');
  }
}

function familyCard() {
  const fa = familyAlerts();
  const items = [
    ...fa.birthdays.map((x) => ({ p: x.p, text: x.d === 0 ? '今天生日 🎂 记得祝福' : `${x.d} 天后生日（${String(x.p.birthday).slice(5)}），准备一下`, hot: x.d <= 3 })),
    ...fa.quiet.filter((x) => !fa.birthdays.some((b) => b.p.id === x.p.id)).slice(0, 4).map((x) => ({ p: x.p, text: x.d == null ? '还没记录过联系' : `${x.d} 天没联系了`, hot: false }))
  ];
  if (!items.length) return null;
  return h(
    'div',
    { class: 'home-card' },
    h('div', { class: 'home-card-title' }, '🏠 家人提醒'),
    ...items.map((it) =>
      h(
        'div',
        { class: 'fam-line' + (it.hot ? ' hot' : '') },
        h('div', { style: 'flex:1;min-width:0' }, h('b', {}, it.p.name), h('span', { class: 'muted' }, ' ' + (it.p.relation_label || '')), h('div', { class: 'muted', style: 'font-size:12px' }, it.text)),
        h('button', { class: 'btn btn-xs', onclick: () => contacted(it.p) }, '今天联系了')
      )
    )
  );
}

/* ---------- 视图 ---------- */

/* 新增待办：不用弹窗，直接在卡片底部一行输入框，回车即加 */
let newTodo = { text: '', busy: false };

async function addNewTodo() {
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

export function homeView() {
  const d = new Date();
  const dateLabel = `${d.getMonth() + 1}月${d.getDate()}日 星期${weekdayCn(d)}`;
  const todoSet = todosOf();
  const todos = todoSet.open;
  const plans = upcomingGoals();
  const name = state.session?.user?.name && state.session.user.name !== '我' ? state.session.user.name : '';
  const greeting =
    d.getHours() < 6 ? '夜深了' : d.getHours() < 11 ? '早上好' : d.getHours() < 14 ? '中午好' : d.getHours() < 19 ? '下午好' : '晚上好';

  return h(
    'div',
    { class: 'home' },
    h('div', { class: 'home-head' }, h('h1', {}, `${greeting}${name ? '，' + name : ''}`), h('span', { class: 'muted' }, dateLabel)),

    quickCard(),
    briefCard(),
    spendCard(),
    pillars(),
    familyCard(),
    newsCard(),

    /* 今日待办 */
    h(
      'div',
      { class: 'home-card' },
      h('div', { class: 'home-card-title' }, `🗓️ 待办${todos.length ? ' · ' + todos.length : ''}`),
      todos.length || todoSet.done.length
        ? h(
            'div',
            {},
            todos.map((t) => todoRow(t, loadHome)),
            todoSet.done.length
              ? h(
                  'div',
                  { style: 'margin-top:10px' },
                  h('div', { class: 'muted', style: 'font-size:11.5px;margin-bottom:4px' }, `已完成 ${todoSet.done.length} 条（点勾可撤销）`),
                  todoSet.done.map((t) => todoRow(t, loadHome))
                )
              : null
          )
        : h('div', { class: 'home-empty' }, '暂无待办，保持节奏 🎉'),
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
          onkeydown: (ev) => {
            if (ev.key === 'Enter') addNewTodo();
          }
        }),
        h('button', { class: 'btn btn-sm btn-accent', disabled: newTodo.busy, onclick: addNewTodo }, '添加')
      )
    ),

    /* 接下来的计划 */
    h(
      'div',
      { class: 'home-card' },
      h('div', { class: 'home-card-title' }, '🎯 目标'),
      plans.length
        ? h(
            'div',
            {},
            plans.map((g) =>
              h(
                'button',
                { class: 'plan-line', style: 'width:100%;text-align:left', onclick: () => goTile('goals') },
                h('div', { style: 'flex:1;min-width:0' }, h('div', { class: 'plan-name' }, g.title), h('div', { class: 'muted', style: 'font-size:11px' }, g.target_date ? '截止 ' + g.target_date : '没有截止日')),
                h('div', { class: 'plan-pct' }, (g.progress || 0) + '%')
              )
            ),
            h('div', { style: 'margin-top:12px' }, expertLink('goal', '让目标教练帮你拆第一步'))
          )
        : h('div', { class: 'home-empty' }, '还没有目标', h('div', { style: 'margin-top:12px' }, expertLink('goal', '想立个目标？找目标教练')))
    ),

    /* 专家中心 */
    h(
      'div',
      { class: 'home-card', style: 'margin-top:4px' },
      h('div', { class: 'home-card-title' }, '🧑‍💼 专家'),
      h(
        'div',
        { class: 'expert-grid' },
        ...EXPERTS.map((e) => h('button', { class: 'expert-card', onclick: () => openExpert(e.id) }, h('span', { class: 'em' }, e.emoji), h('span', { class: 'nm' }, e.name), h('span', { class: 'tip' }, e.tip)))
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

/* 跳转页面：发事件给 main.js（原版这里从 main.js 动态导入一个没导出的 go，点了只会报错） */
function goTile(view) {
  window.dispatchEvent(new CustomEvent('lifelog-go', { detail: view }));
}
