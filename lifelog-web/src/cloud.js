/* 数据后端：原来是 WorkBuddy 云 SDK，现在换成 backend.js（claude.ai 云端同步 / 本机存储）。
   backend.js 对外的形状与原 SDK 一致，下面所有函数无需改动。 */
import { cloud, backendReady, runtime } from '@platform';
export { cloud };

/** 解包 { data, error } */
export function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

/** 统一错误文案 */
export function errText(e) {
  if (!e) return '未知错误';
  if (typeof e === 'string') return e;
  if (e.kind === 'unauthenticated') return '登录已失效，请重新登录';
  if (e.code === '23505') return '这条记录已经存在了';
  if (e.code === '42501') return '没有权限执行该操作';
  if (e.code === '42P01') return '这个功能的数据表还没建好（WorkBuddy 版需要先按 migrations/ 里的说明建表）';
  return e.message || String(e);
}

/* 本地日期（不用 toISOString —— 那是 UTC，东八区 0-8 点会算成前一天）。
   声明必须在 todayStr 之前：today 是 const 箭头函数，不享受函数提升。 */
const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const nowIso = () => new Date().toISOString();

export function todayStr() {
  return today();
}

export { today };

/* ---------------- 日记 ---------------- */

export async function listEntries({ month, limit = 60 } = {}) {
  let q = cloud.database.from('entries').select('*');
  if (month) q = q.like('entry_date', `${month}%`);
  return unwrap(await q.order('entry_date', { ascending: false }).order('id', { ascending: false }).limit(limit));
}

/* 提炼字段：content 永远是原文，这里只存 AI 的整理结果 */
function digestFields(entry) {
  const out = {};
  if (entry.summary !== undefined) out.summary = entry.summary || null;
  if (entry.key_points !== undefined) out.key_points = entry.key_points?.length ? entry.key_points : null;
  if (entry.topics !== undefined) out.topics = entry.topics?.length ? entry.topics : null;
  if (entry.ai_at !== undefined) out.ai_at = entry.ai_at || null;
  return out;
}

export async function saveEntry(entry, session) {
  if (entry.id) {
    return unwrap(
      await cloud.database
        .from('entries')
        .update({
          entry_date: entry.entry_date,
          title: entry.title || '',
          content: entry.content || '',
          mood: entry.mood || null,
          tags: entry.tags || '',
          facets: Array.isArray(entry.facets) && entry.facets.length ? entry.facets : null,
          weather: entry.weather || '',
          location: entry.location || '',
          updated_at: nowIso(),
          ...digestFields(entry)
        })
        .eq('id', entry.id)
        .select()
    );
  }
  const me = await currentUserId();
  const rows = unwrap(
    await cloud.database
      .from('entries')
      .insert({
        ...(me ? { owner_id: me } : {}),
        entry_date: entry.entry_date,
        title: entry.title || '',
        content: entry.content || '',
        mood: entry.mood || null,
        tags: entry.tags || '',
        facets: Array.isArray(entry.facets) && entry.facets.length ? entry.facets : null,
        weather: entry.weather || '',
        location: entry.location || '',
        owner_name: session?.user?.name ?? null,
        ...digestFields(entry)
      })
      .select()
  );
  return rows;
}

/* 只更新提炼结果，不碰原文。digest 存完整结构，summary/key_points/topics 存常用字段便于查询。 */
export async function saveDigest(id, digest) {
  return unwrap(
    await cloud.database
      .from('entries')
      .update({
        summary: digest.summary || null,
        key_points: digest.points?.length ? digest.points : null,
        topics: digest.topics?.length ? digest.topics : null,
        digest: {
          todos: digest.todos || [],
          people: digest.people || [],
          money: digest.money || ''
        },
        ai_at: nowIso()
      })
      .eq('id', id)
      .select()
  );
}

export async function deleteEntry(id) {
  const rows = unwrap(await cloud.database.from('entries').delete().eq('id', id).select());
  return Array.isArray(rows) ? rows.length > 0 : false;
}

/* ---------------- 待办 ----------------
   待办原先只存在日记的 digest.todos 字符串数组里，没有「完成」这个概念。
   现在独立成 todos 表：完成状态可查、可撤销、跨设备一致。
   日记提炼仍会写 digest.todos，那一侧只作为原文记录，不再驱动界面的完成状态。 */

export async function listTodos({ onlyOpen = false } = {}) {
  let q = cloud.database.from('todos').select('*');
  if (onlyOpen) q = q.eq('status', 'todo');
  return unwrap(await q.order('source_date', { ascending: false }).order('id', { ascending: false }).limit(200));
}

/* 把某篇日记里的待办同步进 todos 表：digest.todos 里新出现的插入，
   已经在表里的不动（保住完成状态），避免每次提炼把已办好的又翻出来。 */
export async function syncTodosFromEntry(entryId, entryDate, titles) {
  const clean = [...new Set((titles || []).map((t) => String(t || '').trim()).filter(Boolean))];
  if (!clean.length) return [];
  const existing = unwrap(await cloud.database.from('todos').select('id,title').eq('entry_id', entryId));
  const have = new Set((existing || []).map((r) => r.title));
  const add = clean.filter((t) => !have.has(t));
  if (!add.length) return [];
  const me = await currentUserId();
  const rows = add.map((title) => ({ owner_id: me, title, entry_id: entryId, source_date: entryDate, status: 'todo' }));
  return unwrap(await cloud.database.from('todos').insert(rows).select());
}

/* 标记完成 / 撤销完成 */
export async function setTodoDone(id, done) {
  return unwrap(
    await cloud.database
      .from('todos')
      .update({ status: done ? 'done' : 'todo', done_at: done ? nowIso() : null })
      .eq('id', id)
      .select()
  );
}

export async function addTodo({ title, entryId = null, sourceDate = null }) {
  const me = await currentUserId();
  const body = String(title || '').trim();
  if (!body) throw new Error('待办内容不能为空');
  return unwrap(
    await cloud.database
      .from('todos')
      .insert({ owner_id: me, title: body, entry_id: entryId, source_date: sourceDate || today(), status: 'todo' })
      .select()
  );
}

export async function deleteTodo(id) {
  const rows = unwrap(await cloud.database.from('todos').delete().eq('id', id).select());
  return Array.isArray(rows) ? rows.length > 0 : false;
}

/* ---------------- 交易 ---------------- */

export async function listTransactions({ month, category, direction, keyword, limit = 300 } = {}) {
  let q = cloud.database.from('transactions').select('*');
  if (month) q = q.like('tx_date', `${month}%`);
  if (category) q = q.eq('category', category);
  if (direction) q = q.eq('direction', direction);
  if (keyword) q = q.or(`merchant.ilike.%${keyword}%,description.ilike.%${keyword}%`);
  return unwrap(await q.order('tx_date', { ascending: false }).order('tx_time', { ascending: false }).limit(limit));
}

export async function addTransaction(t, session) {
  const hash = `${t.tx_date}|${t.tx_time || ''}|${t.merchant}|${t.amount}|${t.direction}|manual|${cryptoRandom()}`;
  /* owner_id 显式带上，不依赖列默认值 auth.uid() —— 见 saveGoal 的注释，
     这条默认值在 insert 后回读的路径上曾给出过 owner_id 为空的行。 */
  const me = await currentUserId();
  const rows = unwrap(
    await cloud.database
      .from('transactions')
      .insert({
        ...(me ? { owner_id: me } : {}),
        tx_date: t.tx_date,
        tx_time: t.tx_time || '',
        merchant: t.merchant || '',
        description: t.description || '',
        amount: t.amount,
        direction: t.direction,
        category: t.category || guessCategoryStatic(`${t.merchant} ${t.description || ''}`, t.direction),
        source: 'manual',
        raw_hash: hash,
        owner_name: session?.user?.name ?? null
      })
      .select()
  );
  return rows;
}

export async function updateTransaction(t) {
  const rows = unwrap(
    await cloud.database
      .from('transactions')
      .update({
        category: t.category,
        merchant: t.merchant,
        note: t.note ?? ''
      })
      .eq('id', t.id)
      .select()
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function deleteTransaction(id) {
  const rows = unwrap(await cloud.database.from('transactions').delete().eq('id', id).select());
  return Array.isArray(rows) ? rows.length > 0 : false;
}

/* 流水去重键。表上 (owner_id, raw_hash) 唯一，且 raw_hash 是 NOT NULL ——
   任何自己拼记录、不走导入器的调用方（比如「档案」导入）都必须带上它，
   否则整批插入会被 Postgres 直接拒掉（not-null violation）。
   放这里而不是只放导入器里，是为了让 batchInsertTransactions 自己兜住。 */
export function txRawHash(r) {
  const str = [
    r.tx_date || '',
    r.tx_time || '',
    String(r.merchant || '').trim(),
    Number(r.amount) || 0,
    r.direction === 'in' ? 'in' : 'out',
    r.source || 'manual'
  ].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16) + '_' + str.length;
}

export async function batchInsertTransactions(records, session) {
  if (!records.length) return { inserted: 0, skipped: 0 };
  const name = session?.user?.name ?? null;
  /* upsert 的冲突键是 (owner_id, raw_hash)，payload 里必须真带上 owner_id，
     否则冲突判定依赖列默认值，同一笔流水会被重复插入。 */
  const me = await currentUserId();
  const payload = records.map((r) => ({
    ...(me ? { owner_id: me } : {}),
    tx_date: r.tx_date,
    tx_time: r.tx_time || '',
    merchant: r.merchant || '',
    description: r.description || '',
    amount: r.amount,
    direction: r.direction,
    category: r.category || guessCategoryStatic(`${r.merchant} ${r.description || ''}`, r.direction),
    source: r.source || 'file',
    raw_hash: r.raw_hash || txRawHash(r),
    owner_name: name
  }));
  let inserted = 0;
  const chunkSize = 200;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const rows = unwrap(
      await cloud.database.from('transactions').upsert(chunk, { onConflict: 'owner_id,raw_hash', ignoreDuplicates: true }).select('id')
    );
    inserted += Array.isArray(rows) ? rows.length : 0;
  }
  return { inserted, skipped: payload.length - inserted };
}

function cryptoRandom() {
  try {
    return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    return String(Math.random()).slice(2);
  }
}

/* ---------------- 分类规则 ---------------- */

export const DEFAULT_RULES = {
  餐饮: '美团|饿了么|肯德基|麦当劳|星巴克|瑞幸|咖啡|餐厅|饭店|火锅|烧烤|外卖|奶茶|喜茶|蜜雪|食堂|面馆|小吃|汉堡|披萨|老乡鸡',
  买菜: '超市|生鲜|菜市场|盒马|永辉|华润万家|沃尔玛|山姆|叮咚|朴朴|便利店|罗森|全家|7-11|钱大妈',
  交通: '滴滴|高德|地铁|公交|出租|打车|加油|中石油|中石化|停车|etc|高速|12306|铁路|机票|航空|哈啰|青桔|摩拜|曹操',
  购物: '淘宝|天猫|京东|拼多多|唯品会|抖音商城|小米|苹果|apple|华为|苏宁|优衣库|服饰|商场|百货|shein',
  住房: '房租|物业|水费|电费|燃气|供暖|保洁|家政|租房',
  通讯: '话费|中国移动|中国联通|中国电信|宽带|流量',
  医疗: '医院|药房|药店|诊所|体检|挂号|医保|牙科|口腔',
  娱乐: '电影|影院|ktv|演出|门票|游戏|steam|网易云|qq音乐|视频会员|爱奇艺|腾讯视频|b站|哔哩|剧本杀',
  学习: '书店|图书|当当|课程|培训|学费|考试|得到|知识|网课',
  订阅: '订阅|icloud|netflix|spotify|chatgpt|claude|openai|apple store|会员续费',
  人情: '红包|礼金|礼物|随礼|份子',
  还款: '信用卡还款|花呗|借呗|白条|贷款|分期',
  理财: '基金|股票|证券|理财|余额宝|定期|保险',
  办公: '办公|电脑|显示器|键盘|鼠标|打印|文具|工位|软件|服务器|云服务|域名|设备',
  差旅: '酒店|住宿|出差|高铁|动车|航班|行程|民宿',
  工资: '工资|薪资|薪酬|月薪|代发工资',
  奖金: '奖金|绩效|年终奖|提成|分红',
  租金: '租金|房租收入|收租|租赁|租客|房租款',
  报销: '报销|差旅报销|费用报销'
};

let rulesCache = null;

export function applyRules(text, direction) {
  const lower = String(text || '').toLowerCase();
  if (!text) return direction === 'in' ? '其他收入' : '其他';
  // 用户学到的规则优先级最高
  if (rulesCache) {
    for (const r of rulesCache) {
      if (lower.includes(String(r.keyword).toLowerCase())) return r.category;
    }
  }
  for (const [cat, kws] of Object.entries(DEFAULT_RULES)) {
    if (kws.split('|').some((k) => lower.includes(k.toLowerCase()))) return cat;
  }
  return direction === 'in' ? '其他收入' : '其他';
}

function guessCategoryStatic(text, direction) {
  return applyRules(text, direction);
}

export async function loadRules() {
  try {
    rulesCache = unwrap(await cloud.database.from('rules').select('*'));
  } catch (e) {
    rulesCache = null;
  }
  return rulesCache || [];
}

export async function learnRule(keyword, category) {
  try {
    unwrap(
      await cloud.database
        .from('rules')
        .insert({ keyword, category })
        .select()
    );
    if (rulesCache) rulesCache.push({ keyword, category });
  } catch (e) {
    /* 忽略重复 */
  }
}

/* 收入四分法（用户要求按来源分开看）：
   工作收入 / 物业收入 / 投资收入 / 其他，负债在 accounts 里用 is_liability 标记。
   原有细分类保留，靠 INCOME_GROUPS 做映射，不破坏历史数据。 */
export const INCOME_GROUPS = [
  { k: 'work', label: '工作收入', color: '#3f9e63', cats: ['工资', '奖金', '报销'] },
  { k: 'property', label: '物业收入', color: '#7a6a4f', cats: ['租金'] },
  { k: 'invest', label: '投资收入', color: '#4f9d78', cats: ['理财'] },
  { k: 'other', label: '其他收入', color: '#6fa88f', cats: ['其他收入'] }
];

export function incomeGroupOf(category) {
  const hit = INCOME_GROUPS.find((g) => g.cats.includes(category));
  return hit ? hit.k : 'other';
}

export function incomeGroupLabel(k) {
  return INCOME_GROUPS.find((g) => g.k === k)?.label || '其他收入';
}

export const INCOME_CATEGORIES = ['工资', '奖金', '租金', '报销', '理财', '其他收入'];
export const EXPENSE_CATEGORIES = ['餐饮', '买菜', '交通', '购物', '住房', '通讯', '医疗', '娱乐', '学习', '订阅', '人情', '还款', '理财', '办公', '差旅', '其他'];
export const CATEGORIES = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];

export function categoriesFor(direction) {
  return direction === 'in' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

export const CATEGORY_COLORS = {
  餐饮: '#e8833a',
  买菜: '#7aa95c',
  交通: '#4a8fd4',
  购物: '#c4738f',
  住房: '#8a7ab8',
  通讯: '#5aa9a3',
  医疗: '#d4665c',
  娱乐: '#d99a33',
  学习: '#5b8ec9',
  订阅: '#9b7fb5',
  人情: '#cf7a5e',
  还款: '#a0846b',
  理财: '#4f9d78',
  办公: '#7d8f6b',
  差旅: '#4f9bb0',
  工资: '#3f9e63',
  奖金: '#4aa86c',
  租金: '#52a87d',
  报销: '#5aa98a',
  其他收入: '#6fa88f',
  收入: '#3f9e63',
  其他: '#9a978f'
};

/* ---------------- 统计 ---------------- */

export function computeStats(list) {
  const totals = { in: 0, out: 0 };
  const byCat = {};
  const byIncome = {};
  const byDay = {};
  const merchants = {};
  list.forEach((t) => {
    const amt = Number(t.amount) || 0;
    totals[t.direction] = (totals[t.direction] || 0) + amt;
    if (t.direction === 'out') {
      byCat[t.category || '其他'] = (byCat[t.category || '其他'] || 0) + amt;
      merchants[t.merchant || '未知'] = (merchants[t.merchant || '未知'] || 0) + amt;
    } else {
      byIncome[t.category || '其他收入'] = (byIncome[t.category || '其他收入'] || 0) + amt;
    }
    byDay[t.tx_date] = (byDay[t.tx_date] || 0) + (t.direction === 'out' ? amt : 0);
  });
  const catList = Object.entries(byCat)
    .map(([name, value]) => ({ name, value: +value.toFixed(2) }))
    .sort((a, b) => b.value - a.value);
  const topMerchants = Object.entries(merchants)
    .map(([name, value]) => ({ name, value: +value.toFixed(2) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const incomeList = Object.entries(byIncome)
    .map(([name, value]) => ({ name, value: +value.toFixed(2) }))
    .sort((a, b) => b.value - a.value);
  const days = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]));
  return { totals, catList, incomeList, topMerchants, days };
}

export function fmtMoney(n) {
  return '¥' + (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* ---------------- 未来目标 ---------------- */

export async function listGoals() {
  return unwrap(
    await cloud.database
      .from('goals')
      .select('*')
      .order('status', { ascending: true })
      .order('target_date', { ascending: true, nullsFirst: false })
      .order('id', { ascending: false })
  );
}

/* ---------------- 任务 / 日程 ----------------
   同一张表用 kind 区分：task = 要做完的事，event = 有具体时间的安排。
   两者都能挂到某个目标下（goal_id），日程也可以只是单纯的安排。 */

export async function listTasks() {
  return unwrap(
    await cloud.database
      .from('tasks')
      .select('*')
      .order('status', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('id', { ascending: false })
  );
}

export async function saveTask(t) {
  const base = {
    kind: t.kind === 'event' ? 'event' : 'task',
    title: String(t.title || '').trim(),
    detail: t.detail || '',
    goal_id: t.goal_id || null,
    category: t.category || 'life',
    due_date: t.due_date || null,
    due_time: t.due_time || null,
    priority: t.priority || 'normal',
    status: t.status || 'todo',
    done_at: t.status === 'done' ? t.done_at || nowIso() : null,
    updated_at: nowIso()
  };
  if (t.id) {
    return unwrap(await cloud.database.from('tasks').update(base).eq('id', t.id).select());
  }
  const me = await currentUserId();
  return unwrap(await cloud.database.from('tasks').insert(me ? { ...base, owner_id: me } : base).select());
}

export async function deleteTask(id) {
  const rows = unwrap(await cloud.database.from('tasks').delete().eq('id', id).select());
  return Array.isArray(rows) && rows.length > 0;
}

/** 当前账号 id。写入时显式带上 owner_id。
    若这个登录身份在 account_links 里登记为某个主账号的成员（旧版 WorkBuddy 的
    「配对码关联」功能），返回主账号 id，这样所有写入仍归到同一个账本。缓存 60 秒。 */
let ownerCache = { uid: '', owner: '', at: 0 };
async function currentUserId() {
  await backendReady();
  const uid = runtime.uid;
  if (!uid) return 'local';
  const now = Date.now();
  if (ownerCache.uid === uid && now - ownerCache.at < 60000) return ownerCache.owner;
  let owner = uid;
  try {
    const rows = unwrap(await cloud.database.from('account_links').select('owner').eq('member', uid).limit(1));
    if (Array.isArray(rows) && rows[0]?.owner) owner = rows[0].owner;
  } catch (e) {
    /* 表不存在或未关联 → 就用自己 */
  }
  ownerCache = { uid, owner, at: now };
  return owner;
}

export async function saveGoal(g) {
  const base = {
    title: String(g.title || '').trim(),
    detail: g.detail || '',
    category: g.category || 'life',
    target_date: g.target_date || null,
    progress: Math.max(0, Math.min(100, Number(g.progress) || 0)),
    status: g.status || 'active',
    updated_at: nowIso()
  };
  if (!base.title) throw new Error('目标名字不能为空');
  if (g.id) {
    return unwrap(await cloud.database.from('goals').update(base).eq('id', g.id).select());
  }
  /* owner_id 显式带上：默认值 auth.uid() 在部分 SDK 路径（尤其是
     insert 后 .select() 回读）不稳定，会给出一条 owner_id 为空的行 ——
     表现是「提示保存成功，但列表里没有」，也就是用户说的「点了没反应」。
     其它表（people/places/looks）已经踩过这个坑，这里对齐。 */
  const me = await currentUserId();
  return unwrap(await cloud.database.from('goals').insert(me ? { ...base, owner_id: me } : base).select());
}

export async function deleteGoal(id) {
  const rows = unwrap(await cloud.database.from('goals').delete().eq('id', id).select());
  return Array.isArray(rows) && rows.length > 0;
}

/* ---------------- 生辰信息（八字用） ----------------
   一人一条，靠 owner_id 唯一约束。跨设备同步很重要：
   在手机上填过生辰，桌面上就不用再填一遍。 */

export async function loadBirthInfo() {
  const rows = unwrap(await cloud.database.from('birth_info').select('*').limit(1));
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const r = rows[0];
  return {
    year: r.year,
    month: r.month,
    day: r.day,
    hour: r.hour,
    minute: r.minute ?? 0,
    lon: r.lon != null ? Number(r.lon) : null,
    place: r.place || '',
    cal: r.cal || 'solar',
    leap: !!r.leap
  };
}

export async function saveBirthInfo(b) {
  const base = {
    year: Number(b.year),
    month: Number(b.month),
    day: Number(b.day),
    hour: Number(b.hour) || 0,
    minute: Number(b.minute) || 0,
    lon: b.lon != null && b.lon !== '' ? Number(b.lon) : null,
    place: b.place || '',
    cal: b.cal || 'solar',
    leap: !!b.leap,
    updated_at: nowIso()
  };
  /* upsert 需要 owner_id 参与冲突判定，但 owner_id 有默认值 auth.uid()，
     这里显式带上，避免「新用户首次插入」时冲突键缺失。 */
  const me = await currentUserId();
  const payload = me ? { ...base, owner_id: me } : base;
  return unwrap(
    await cloud.database
      .from('birth_info')
      .upsert(payload, { onConflict: 'owner_id' })
      .select()
  );
}

/* ---------------- 人物卡（朋友圈） ----------------
   relation：family 亲人 / friend 朋友 / work 同事 / dislike 不喜欢的人 / other
   sensitive + not_mention 两个标记：
     sensitive   → 界面折叠显示，避免被人瞥见
     not_mention → AI 回答时不主动提这个人 */
export const RELATION_KINDS = [
  { k: 'family', label: '亲人', color: '#cf7a5e' },
  { k: 'friend', label: '朋友', color: '#4a8fa5' },
  { k: 'work', label: '同事 / 合作伙伴', color: '#4a6fa5' },
  { k: 'dislike', label: '不喜欢的人', color: '#9a6b6b' },
  { k: 'other', label: '其他', color: '#9a958c' }
];

export function relationLabel(k) {
  return RELATION_KINDS.find((r) => r.k === k)?.label || '其他';
}

export async function listPeople() {
  return unwrap(await cloud.database.from('people').select('*').order('relation', { ascending: true }).order('id', { ascending: true }));
}

export async function savePerson(p) {
  const base = {
    name: p.name,
    relation: p.relation || 'friend',
    relation_label: p.relation_label || '',
    closeness: Math.max(1, Math.min(5, Number(p.closeness) || 3)),
    sensitive: !!p.sensitive,
    not_mention: !!p.not_mention,
    birthday: p.birthday || null,
    likes: p.likes || '',
    dislikes: p.dislikes || '',
    hobbies: p.hobbies || '',
    notes: p.notes || '',
    last_contact: p.last_contact || null,
    updated_at: nowIso()
  };
  if (p.id) {
    return unwrap(await cloud.database.from('people').update(base).eq('id', p.id).select());
  }
  const me = await currentUserId();
  return unwrap(await cloud.database.from('people').insert(me ? { ...base, owner_id: me } : base).select());
}

export async function deletePerson(id) {
  const rows = unwrap(await cloud.database.from('people').delete().eq('id', id).select());
  return Array.isArray(rows) && rows.length > 0;
}

/* ---------------- 本人基本信息 ----------------
   存 self_profile 表一条 JSON：性别/血型/身高体重/职业/城市/联系方式等。
   用 JSON 而不是一列一个字段 —— 以后想加字段不用动数据库。 */
export async function getSelfProfile() {
  const rows = unwrap(await cloud.database.from('self_profile').select('*').limit(1));
  return rows && rows[0] ? rows[0] : null;
}

export async function saveSelfProfile(data) {
  const clean = JSON.parse(JSON.stringify(data || {}));
  const me = await currentUserId();
  const existing = await getSelfProfile();
  if (existing?.id) {
    return unwrap(
      await cloud.database.from('self_profile').update({ data: clean, updated_at: nowIso() }).eq('id', existing.id).select()
    );
  }
  /* 首次保存可能被两个页面几乎同时触发（人物页和命理页都会写），
     两边都查到空、都走 insert 会留下两行，之后 limit(1) 只认其中一行，
     另一行成为改不掉的孤儿。这里用 upsert 让第二次变成更新。 */
  if (me) {
    try {
      return unwrap(
        await cloud.database
          .from('self_profile')
          .upsert({ owner_id: me, data: clean }, { onConflict: 'owner_id' })
          .select()
      );
    } catch (e) {
      /* 表上没建 owner_id 唯一约束时 upsert 会失败，退回普通插入 */
    }
  }
  return unwrap(
    await cloud.database.from('self_profile').insert(me ? { data: clean, owner_id: me } : { data: clean }).select()
  );
}

/* ---------------- 位置 ----------------
   只在用户点「获取当前位置」时写入，不做后台轨迹记录。 */
export async function listPlaces() {
  return unwrap(await cloud.database.from('places').select('*').order('updated_at', { ascending: false }).limit(20));
}

export async function savePlace(pl) {
  const base = {
    label: pl.label || '当前位置',
    city: pl.city || '',
    region: pl.region || '',
    country: pl.country || '',
    lat: pl.lat != null ? Number(pl.lat) : null,
    lon: pl.lon != null ? Number(pl.lon) : null,
    accuracy: pl.accuracy != null ? Number(pl.accuracy) : null,
    is_home: !!pl.is_home,
    is_work: !!pl.is_work,
    note: pl.note || '',
    updated_at: nowIso()
  };
  if (pl.id) {
    return unwrap(await cloud.database.from('places').update(base).eq('id', pl.id).select());
  }
  const me = await currentUserId();
  return unwrap(await cloud.database.from('places').insert(me ? { ...base, owner_id: me } : base).select());
}

export async function deletePlace(id) {
  const rows = unwrap(await cloud.database.from('places').delete().eq('id', id).select());
  return Array.isArray(rows) && rows.length > 0;
}

/* ---------------- 外形素材 ----------------
   kind：photo 照片 / outfit 穿搭 / idea 想买的 / note 记录 */
export async function listLooks() {
  return unwrap(await cloud.database.from('looks').select('*').order('id', { ascending: false }).limit(100));
}

export async function saveLook(l) {
  const base = {
    kind: l.kind || 'photo',
    title: l.title || '',
    url: l.url || null,
    note: l.note || '',
    tags: l.tags || '',
    taken_at: l.taken_at || null,
    updated_at: nowIso()
  };
  if (l.id) {
    return unwrap(await cloud.database.from('looks').update(base).eq('id', l.id).select());
  }
  const me = await currentUserId();
  return unwrap(await cloud.database.from('looks').insert(me ? { ...base, owner_id: me } : base).select());
}

export async function deleteLook(id) {
  const rows = unwrap(await cloud.database.from('looks').delete().eq('id', id).select());
  return Array.isArray(rows) && rows.length > 0;
}


/* ---------------- 身体健康：每日打卡 ----------------
   一天一条（按 log_date），重复保存就是更新。 */

export const MOOD_SCALE = [
  { v: 1, label: '很差', em: '😣' },
  { v: 2, label: '一般', em: '😕' },
  { v: 3, label: '还行', em: '🙂' },
  { v: 4, label: '不错', em: '😊' },
  { v: 5, label: '很开心', em: '😄' }
];

export async function listHealth({ days = 120 } = {}) {
  const from = new Date();
  from.setDate(from.getDate() - days);
  const p = (n) => String(n).padStart(2, '0');
  const fromStr = `${from.getFullYear()}-${p(from.getMonth() + 1)}-${p(from.getDate())}`;
  return unwrap(await cloud.database.from('health_logs').select('*').gte('log_date', fromStr).order('log_date', { ascending: false }).limit(400));
}

export async function saveHealthLog(rec) {
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const base = {
    log_date: rec.log_date || today(),
    sleep_hours: num(rec.sleep_hours),
    weight_kg: num(rec.weight_kg),
    exercise_min: num(rec.exercise_min),
    steps: num(rec.steps),
    mood: num(rec.mood),
    energy: num(rec.energy),
    water_cups: num(rec.water_cups),
    note: rec.note || '',
    updated_at: nowIso()
  };
  const existing = unwrap(await cloud.database.from('health_logs').select('id').eq('log_date', base.log_date).limit(1));
  if (Array.isArray(existing) && existing[0]?.id) {
    return unwrap(await cloud.database.from('health_logs').update(base).eq('id', existing[0].id).select());
  }
  const me = await currentUserId();
  return unwrap(await cloud.database.from('health_logs').insert({ ...base, owner_id: me }).select());
}

/* ---------------- 利好消息 / 机会 ----------------
   看到对自己可能有利的外部信息（新闻、政策、行情、招聘、人脉消息…）就存进来，
   AI 结合你的目标判断利弊、给出行动建议。status：new 新 / acted 已行动 / archived 归档 */

export const SIGNAL_AREAS = [
  { k: 'money', label: '财富', color: '#b4552f' },
  { k: 'work', label: '事业', color: '#4a6fa5' },
  { k: 'family', label: '家庭', color: '#cf7a5e' },
  { k: 'health', label: '健康', color: '#3f8c5e' },
  { k: 'life', label: '生活', color: '#5aa9a3' }
];

export function signalArea(k) {
  return SIGNAL_AREAS.find((a) => a.k === k) || SIGNAL_AREAS[4];
}

export async function listSignals() {
  /* 旧版「新闻关注」的条目也在这张表里（source 以「关注:」开头），由页面过滤掉，
     上限放宽到 1000，免得它们把利好消息挤出列表 */
  return unwrap(await cloud.database.from('signals').select('*').order('id', { ascending: false }).limit(1000));
}

export async function saveSignal(s) {
  const base = {
    title: String(s.title || '').trim(),
    content: s.content || '',
    url: s.url || '',
    source: s.source || '',
    area: s.area || 'life',
    status: s.status || 'new',
    ai_take: s.ai_take ?? null,
    ai_score: s.ai_score ?? null,
    ai_at: s.ai_at ?? null,
    updated_at: nowIso()
  };
  if (!base.title && !base.content) throw new Error('标题和内容至少填一个');
  if (!base.title) base.title = base.content.slice(0, 40);
  if (s.id) return unwrap(await cloud.database.from('signals').update(base).eq('id', s.id).select());
  const me = await currentUserId();
  return unwrap(await cloud.database.from('signals').insert({ ...base, owner_id: me }).select());
}

export async function deleteSignal(id) {
  const rows = unwrap(await cloud.database.from('signals').delete().eq('id', id).select());
  return Array.isArray(rows) && rows.length > 0;
}

/** 表还没建（WorkBuddy 新功能需要先建表）时返回 true，页面据此显示建表提示 */
export function isMissingTable(e) {
  return !!e && (e.code === '42P01' || /does not exist|relation .* not exist|未创建|not found.*table/i.test(String(e.message || '')));
}
