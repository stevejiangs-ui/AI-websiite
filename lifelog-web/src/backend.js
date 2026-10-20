/* ============================================================
   数据后端（替代原来的 WorkBuddy 云 SDK）

   对外暴露和原 SDK 一样的形状：
     cloud.database.from(table).select().eq().order().limit() …  → { data, error }
     cloud.auth.getSession() / signOut()
     cloud.llm.models.list() / cloud.llm.chat.completions.create({stream:true})

   这样 cloud.js 和各个页面几乎不用改。

   存储有两种模式，启动时自动选择：
     1. 云端同步（在 claude.ai 里打开时）：用 artifact 的 db 能力，
        数据存在你自己账号的私有目录 data/users/<你的id>/ 下，
        别人（包括被分享的人）都看不到；手机、电脑打开同一个链接就是同一份数据。
     2. 本机模式（脱离 claude.ai 直接打开 HTML 时）：存浏览器 localStorage，
        只在这台设备这个浏览器里有。

   AI：在 claude.ai 里用 sample 能力（用你自己的 Claude 额度），
       第一次调用会弹窗问你是否允许。
   ============================================================ */

const LS_PREFIX = 'lifelog.local.v1.';

/* ---------------- 运行时探测 ---------------- */

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
}

async function useCap(name) {
  try {
    if (typeof window === 'undefined' || !window.claude || typeof window.claude.use !== 'function') return null;
    return await withTimeout(window.claude.use(name), 12000);
  } catch (e) {
    return null;
  }
}

export const runtime = {
  mode: 'local', // 'cloud' | 'local'
  uid: null,
  name: '',
  email: '',
  db: null,
  sample: null,
  downloads: null,
  isOwner: false
};

let readyPromise = null;

export function backendReady() {
  if (!readyPromise) readyPromise = init();
  return readyPromise;
}

async function init() {
  const hasClaude = typeof window !== 'undefined' && window.claude && typeof window.claude.use === 'function';
  if (!hasClaude) return runtime;
  const [db, user, sample, downloads] = await Promise.all([
    useCap('db'),
    useCap('user'),
    useCap('sample'),
    useCap('downloads')
  ]);
  runtime.sample = sample || null;
  runtime.downloads = downloads || null;
  if (user) {
    try {
      runtime.uid = await user.id();
    } catch (e) {
      runtime.uid = null;
    }
    try {
      const me = await user.me();
      runtime.name = (me && me.name) || '';
      runtime.email = (me && me.email) || '';
    } catch (e) {
      /* ignore */
    }
    try {
      runtime.isOwner = !!user.isOwner();
    } catch (e) {
      /* ignore */
    }
  }
  if (db && runtime.uid) {
    runtime.db = db;
    runtime.mode = 'cloud';
  }
  return runtime;
}

/* ---------------- 存储适配器 ---------------- */

/* 本机：一张表一个 localStorage key */
const localAdapter = {
  async load(table) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + table);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  },
  async putMany(table, rows, all) {
    persistLocal(table, all);
  },
  async delMany(table, ids, all) {
    persistLocal(table, all);
  }
};

function persistLocal(table, all) {
  try {
    localStorage.setItem(LS_PREFIX + table, JSON.stringify(all));
  } catch (e) {
    throw new Error('本机存储空间不够了（浏览器限制约 5MB）。请在 claude.ai 里打开以使用云端同步。');
  }
}

/* 云端：data/users/<uid>/t（文档）/<table>（集合）/<id>（文档）
   每行一条文档 —— 多台设备同时改不同的行不会互相覆盖。 */
function tableRef(table) {
  return runtime.db.doc('data/users/' + runtime.uid + '/t').collection(table);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function retrying(fn) {
  let wait = 300;
  for (let i = 0; i < 5; i += 1) {
    try {
      return await fn();
    } catch (e) {
      const code = e && e.code;
      if (code !== 'unavailable' && code !== 'resource_exhausted') throw e;
      await sleep(wait + Math.random() * 200);
      wait *= 2;
    }
  }
  return fn();
}

/* 并发上限：一次批量导入几百条时不至于一条条串行等太久，也不打爆配额 */
async function pool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i;
      i += 1;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

function dbErr(e) {
  if (!e) return e;
  if (e instanceof Error) return e;
  const map = {
    quota_exceeded: '云端存储已满（每个应用最多约 25,000 条记录），请删除一些旧数据后再试',
    revoked: '访问权限已变更，请刷新页面',
    not_granted: '没有授予数据存储权限',
    invalid_argument: '写入被拒绝（数据格式不对或没有写权限）'
  };
  const err = new Error(map[e.code] || e.message || String(e.code || e));
  err.code = e.code;
  return err;
}

const cloudAdapter = {
  async load(table) {
    const out = [];
    let last = null;
    for (let guard = 0; guard < 100; guard += 1) {
      let q = tableRef(table).orderBy('id', 'asc').limit(1000);
      if (last != null) q = q.where('id', '>', last);
      const snap = await retrying(() => q.get()).catch((e) => {
        throw dbErr(e);
      });
      const rows = snap.docs.map((d) => ({ ...d.data() }));
      out.push(...rows);
      if (rows.length < 1000) break;
      last = rows[rows.length - 1].id;
    }
    return out;
  },
  async putMany(table, rows) {
    const ref = tableRef(table);
    await pool(rows, 6, (row) =>
      retrying(() => ref.doc(String(row.id)).set(JSON.parse(JSON.stringify(row)))).catch((e) => {
        throw dbErr(e);
      })
    );
  },
  async delMany(table, ids) {
    const ref = tableRef(table);
    await pool(ids, 6, (id) =>
      retrying(() => ref.doc(String(id)).delete()).catch((e) => {
        throw dbErr(e);
      })
    );
  }
};

function adapter() {
  return runtime.mode === 'cloud' ? cloudAdapter : localAdapter;
}

/* ---------------- 表缓存 ----------------
   每张表第一次用到时整表拉下来，之后在内存里查询；写入同时落到存储。
   切回页面（手机从后台回来）时把缓存标记为过期，下次查询重新拉，
   这样在电脑上改的东西，手机切回来就能看到。 */

const cache = new Map(); // table -> { rows, at }
const loading = new Map();
const STALE_MS = 60 * 1000;

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      for (const v of cache.values()) v.at = 0;
    }
  });
}

async function getTable(table) {
  await backendReady();
  const c = cache.get(table);
  if (c && Date.now() - c.at < STALE_MS) return c.rows;
  if (c && runtime.mode === 'local') {
    c.at = Date.now();
    return c.rows;
  }
  if (loading.has(table)) return loading.get(table);
  const p = adapter()
    .load(table)
    .then((rows) => {
      cache.set(table, { rows, at: Date.now() });
      return rows;
    })
    .finally(() => loading.delete(table));
  loading.set(table, p);
  return p;
}

export function invalidateAll() {
  for (const v of cache.values()) v.at = 0;
}

/* 数字 id：时间戳 × 1000 + 序号，跨设备基本不会撞，也保持「新的大」的顺序 */
let lastId = 0;
function newId() {
  const base = Date.now() * 1000;
  lastId = Math.max(base, lastId + 1);
  return lastId;
}

/* ---------------- 查询构造器（Supabase 风格） ---------------- */

function likeToRegex(pattern, ci) {
  const esc = String(pattern)
    .split('%')
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.'))
    .join('.*');
  return new RegExp('^' + esc + '$', ci ? 'is' : 's');
}

function cmp(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) - Number(b);
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function parseOr(expr) {
  /* 只需要支持 "col.op.value,col.op.value" 这种简单形式 */
  return String(expr)
    .split(',')
    .map((part) => {
      const m = part.match(/^([^.]+)\.(eq|neq|like|ilike|gt|gte|lt|lte)\.(.*)$/);
      if (!m) return () => false;
      const [, col, op, val] = m;
      return (row) => testOp(row[col], op, val);
    });
}

function testOp(v, op, val) {
  switch (op) {
    case 'eq':
      return v == val; // eslint-disable-line eqeqeq
    case 'neq':
      return v != val; // eslint-disable-line eqeqeq
    case 'gt':
      return v != null && cmp(v, val) > 0;
    case 'gte':
      return v != null && cmp(v, val) >= 0;
    case 'lt':
      return v != null && cmp(v, val) < 0;
    case 'lte':
      return v != null && cmp(v, val) <= 0;
    case 'like':
      return v != null && likeToRegex(val, false).test(String(v));
    case 'ilike':
      return v != null && likeToRegex(val, true).test(String(v));
    case 'in':
      return Array.isArray(val) && val.some((x) => x == v); // eslint-disable-line eqeqeq
    case 'is':
      return val === null ? v == null : v === val;
    default:
      return true;
  }
}

class Query {
  constructor(table) {
    this.table = table;
    this.action = 'select';
    this.filters = [];
    this.orders = [];
    this.lim = null;
    this.rangeFrom = null;
    this.rangeTo = null;
    this.payload = null;
    this.opts = {};
    this.wantRows = false;
    this.cols = '*';
  }

  select(cols) {
    if (this.action === 'select') this.cols = cols || '*';
    else this.wantRows = true;
    return this;
  }
  insert(rows) {
    this.action = 'insert';
    this.payload = rows;
    return this;
  }
  upsert(rows, opts) {
    this.action = 'upsert';
    this.payload = rows;
    this.opts = opts || {};
    return this;
  }
  update(patch) {
    this.action = 'update';
    this.payload = patch;
    return this;
  }
  delete() {
    this.action = 'delete';
    return this;
  }

  _f(col, op, val) {
    this.filters.push((row) => testOp(row[col], op, val));
    return this;
  }
  eq(c, v) {
    return this._f(c, 'eq', v);
  }
  neq(c, v) {
    return this._f(c, 'neq', v);
  }
  gt(c, v) {
    return this._f(c, 'gt', v);
  }
  gte(c, v) {
    return this._f(c, 'gte', v);
  }
  lt(c, v) {
    return this._f(c, 'lt', v);
  }
  lte(c, v) {
    return this._f(c, 'lte', v);
  }
  like(c, v) {
    return this._f(c, 'like', v);
  }
  ilike(c, v) {
    return this._f(c, 'ilike', v);
  }
  in(c, v) {
    return this._f(c, 'in', v);
  }
  is(c, v) {
    return this._f(c, 'is', v);
  }
  match(obj) {
    Object.entries(obj || {}).forEach(([c, v]) => this.eq(c, v));
    return this;
  }
  or(expr) {
    const tests = parseOr(expr);
    this.filters.push((row) => tests.some((t) => t(row)));
    return this;
  }
  order(col, opts = {}) {
    this.orders.push({ col, asc: opts.ascending !== false, nullsFirst: opts.nullsFirst });
    return this;
  }
  limit(n) {
    this.lim = n;
    return this;
  }
  range(from, to) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  single() {
    this.one = true;
    return this;
  }
  maybeSingle() {
    this.one = true;
    return this;
  }

  then(resolve, reject) {
    return this._run().then(resolve, reject);
  }

  _match(row) {
    return this.filters.every((f) => f(row));
  }

  _sort(rows) {
    if (!this.orders.length) return rows;
    return rows.sort((a, b) => {
      for (const o of this.orders) {
        const va = a[o.col];
        const vb = b[o.col];
        const na = va == null || va === '';
        const nb = vb == null || vb === '';
        if (na || nb) {
          if (na && nb) continue;
          /* Postgres 默认：升序 nulls last，降序 nulls first */
          const nullsFirst = o.nullsFirst != null ? o.nullsFirst : !o.asc;
          return (na ? -1 : 1) * (nullsFirst ? 1 : -1);
        }
        const c = cmp(va, vb);
        if (c !== 0) return o.asc ? c : -c;
      }
      return 0;
    });
  }

  _project(rows) {
    if (!this.cols || this.cols === '*') return rows.map((r) => ({ ...r }));
    const cols = this.cols.split(',').map((s) => s.trim()).filter(Boolean);
    return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
  }

  async _run() {
    try {
      const data = await this._exec();
      return { data, error: null };
    } catch (e) {
      console.error('[db]', this.table, this.action, e);
      return { data: null, error: e instanceof Error ? e : dbErr(e) };
    }
  }

  async _exec() {
    const all = await getTable(this.table);
    const now = new Date().toISOString();
    const ad = adapter();

    if (this.action === 'select') {
      let rows = this._sort(all.filter((r) => this._match(r)));
      if (this.rangeFrom != null) rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
      if (this.lim != null) rows = rows.slice(0, this.lim);
      rows = this._project(rows);
      return this.one ? rows[0] || null : rows;
    }

    if (this.action === 'insert' || this.action === 'upsert') {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      const keys = this.action === 'upsert' && this.opts.onConflict
        ? this.opts.onConflict.split(',').map((s) => s.trim())
        : null;
      const written = [];
      const fresh = [];
      list.forEach((input) => {
        const row = { ...input };
        if (row.owner_id == null) row.owner_id = runtime.uid || 'local';
        let hit = null;
        if (keys) {
          hit = all.find((r) => keys.every((k) => String(r[k] ?? '') === String(row[k] ?? '')));
          /* 同一批里也可能有重复 */
          if (!hit) hit = fresh.find((r) => keys.every((k) => String(r[k] ?? '') === String(row[k] ?? '')));
        }
        if (hit) {
          if (this.opts.ignoreDuplicates) return;
          Object.assign(hit, row, { id: hit.id, updated_at: row.updated_at || now });
          written.push(hit);
          return;
        }
        if (row.id == null) row.id = newId();
        if (!row.created_at) row.created_at = now;
        fresh.push(row);
        written.push(row);
      });
      all.push(...fresh);
      await ad.putMany(this.table, written, all);
      return this._project(written);
    }

    if (this.action === 'update') {
      const hits = all.filter((r) => this._match(r));
      const patch = { ...this.payload };
      delete patch.id;
      hits.forEach((r) => Object.assign(r, patch));
      if (hits.length) await ad.putMany(this.table, hits, all);
      return this._project(hits);
    }

    if (this.action === 'delete') {
      const hits = all.filter((r) => this._match(r));
      const ids = hits.map((r) => r.id);
      const keep = all.filter((r) => !hits.includes(r));
      all.length = 0;
      all.push(...keep);
      if (ids.length) await ad.delMany(this.table, ids, all);
      return this._project(hits);
    }
    return [];
  }
}

/* ---------------- AI（Claude） ---------------- */

/* 把 OpenAI 风格的 messages 转成 sample 需要的回合：
   system 放到开头一个 user 回合里；必须以 user 开头、以 user 结尾。 */
function toTurns(messages) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const rest = messages
    .filter((m) => m.role !== 'system' && String(m.content || '').trim())
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }));
  const turns = [];
  if (sys) turns.push({ role: 'user', content: '【背景与要求，请严格遵守】\n' + sys });
  turns.push(...rest);
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== 'user') turns.push({ role: 'user', content: '请继续。' });
  return turns;
}

const SAMPLE_ERR = {
  not_granted: '你没有允许这个页面使用 Claude（可在页面权限里重新打开）',
  sampling_disabled: '当前账号不能使用 Claude',
  rate_limited: 'Claude 调用太频繁或额度已用完，稍后再试',
  session_expired: 'claude.ai 登录已过期，请刷新页面重新登录',
  refused: 'Claude 拒绝回答这个问题',
  prompt_too_large: '发给 AI 的内容太长了，请缩小范围',
  empty_completion: 'AI 没有给出回答，请换个问法',
  upstream_error: 'AI 服务暂时出错，请重试'
};

function sampleError(e) {
  if (e && e.code === 'cancelled') {
    const err = new Error('已停止');
    err.name = 'AbortError';
    return err;
  }
  const err = new Error((e && SAMPLE_ERR[e.code]) || (e && e.message) || 'AI 调用失败');
  err.code = e && e.code;
  err.partial = e && e.text;
  return err;
}

/* 把 sample 的回调式流转成 for-await 可迭代的 OpenAI 风格 chunk */
function createCompletion({ model, messages, signal }) {
  const queue = [];
  let done = false;
  let failure = null;
  let wake = null;
  const push = (x) => {
    queue.push(x);
    if (wake) {
      wake();
      wake = null;
    }
  };

  (async () => {
    if (!runtime.sample) {
      failure = new Error('AI 只在 claude.ai 里打开时可用（当前是本机模式）');
      done = true;
      push(null);
      return;
    }
    try {
      const opts = {
        cache: false,
        onText: ({ delta }) => push({ choices: [{ delta: { content: delta } }] })
      };
      if (signal) opts.signal = signal;
      if (model === 'claude-quick') opts.modelTier = 'quick';
      await runtime.sample(toTurns(messages), opts);
    } catch (e) {
      failure = sampleError(e);
    }
    done = true;
    push(null);
  })();

  return {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (queue.length) {
          const x = queue.shift();
          if (x) {
            yield x;
            continue;
          }
        }
        if (done && !queue.length) {
          if (failure) throw failure;
          return;
        }
        await new Promise((r) => (wake = r));
      }
    }
  };
}

/* ---------------- 对外：和原 SDK 同形 ---------------- */

function sessionObj() {
  const local = runtime.mode !== 'cloud';
  return {
    accessToken: 'claude',
    user: {
      id: runtime.uid || 'local',
      name: runtime.name || (local ? '我' : ''),
      email: runtime.email || '',
      provider: local ? 'local' : 'claude'
    }
  };
}

export const cloud = {
  database: {
    from: (table) => new Query(table)
  },
  auth: {
    async getSession() {
      await backendReady();
      const s = sessionObj();
      return { data: s, error: null };
    },
    async signOut() {
      return { error: null };
    }
  },
  llm: {
    models: {
      async list() {
        await backendReady();
        if (!runtime.sample) return [];
        return [
          { id: 'claude', isDefault: true },
          { id: 'claude-quick' }
        ];
      }
    },
    chat: {
      completions: {
        create: (args) => createCompletion(args)
      }
    }
  }
};

/* ---------------- 备份恢复 / 清空 ---------------- */

export const ALL_TABLES = [
  'entries',
  'todos',
  'transactions',
  'rules',
  'goals',
  'tasks',
  'budgets',
  'accounts',
  'birth_info',
  'people',
  'self_profile',
  'places',
  'looks',
  'bazi_qa'
];

/** 把一份 JSON 备份（本应用或旧版 WorkBuddy 版导出的）写进当前存储。
    同 id 的行会被覆盖，不会重复。 */
export async function restoreTables(dataByTable, onProgress) {
  await backendReady();
  const report = {};
  for (const table of Object.keys(dataByTable)) {
    if (!ALL_TABLES.includes(table)) continue;
    const rows = (dataByTable[table] || []).filter((r) => r && typeof r === 'object');
    if (!rows.length) continue;
    const all = await getTable(table);
    const byId = new Map(all.map((r) => [String(r.id), r]));
    const written = [];
    rows.forEach((src) => {
      const row = { ...src, owner_id: runtime.uid || 'local' };
      if (row.id == null) row.id = newId();
      const hit = byId.get(String(row.id));
      if (hit) Object.assign(hit, row);
      else {
        all.push(row);
        byId.set(String(row.id), row);
      }
      written.push(hit || row);
    });
    if (onProgress) onProgress(table, written.length);
    await adapter().putMany(table, written, all);
    report[table] = written.length;
  }
  return report;
}
