import { cloud } from './cloud.js';
import { runtime, ALL_TABLES } from '@platform';
import { FACETS, GOAL_CATEGORIES, entryFacets, facetLabels, goalCatOf } from './facets.js';

/* ---------------- 全量导出 ---------------- */

/* 分页拉全量：列表接口都有 limit，导出必须自己翻页，否则只导出一部分 */
async function fetchAll(table, { order = 'id', pageSize = 500 } = {}) {
  const out = [];
  let from = 0;
  for (let guard = 0; guard < 200; guard += 1) {
    const { data, error } = await cloud.database
      .from(table)
      .select('*')
      .order(order, { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

export const EXPORT_VERSION = 1;

/**
 * 汇总当前账号的全部数据。
 * 返回一个自解释的对象：别人（或别的 agent）拿到后不需要问就能看懂字段含义。
 */
export async function collectAll({ includeMeta = true } = {}) {
  /* 原版只导出 6 张表，人物卡、任务、待办、生辰、八字问答等都漏了——
     「完整备份」名不副实。现在全部表都导出。 */
  const lists = await Promise.all(ALL_TABLES.map((t) => fetchAll(t).catch(() => [])));
  const all = Object.fromEntries(ALL_TABLES.map((t, i) => [t, lists[i]]));
  const { entries, transactions, rules, goals, budgets, accounts } = all;

  const user = (await cloud.auth.getSession().catch(() => null))?.data?.user || null;

  return {
    app: '个人APP',
    exportVersion: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    account: includeMeta
      ? {
          name: user?.name || null,
          phone: user?.phone || null,
          email: user?.email || null,
          userId: user?.id || null
        }
      : undefined,
    counts: Object.fromEntries(ALL_TABLES.map((t) => [t, all[t].length])),
    schema: {
      entries: {
        description: '日记。content 是用户原文，永不改写；summary/key_points/topics/digest 是 AI 提炼结果',
        fields: {
          id: 'number 主键',
          entry_date: 'string YYYY-MM-DD 日记所属日期',
          title: 'string 标题，可为空',
          content: 'string 原文正文（完整，未删改）',
          mood: 'string|null happy|calm|tired|sad|anxious',
          tags: 'string 用户手打标签，空格分隔',
          facets: 'string[]|null 所属维度，取值见 exports.facets',
          summary: 'string|null AI 摘要',
          key_points: 'string[]|null AI 提炼的要点',
          topics: 'string[]|null AI 提炼的主题词',
          digest: 'object|null {todos: string[], people: string[], money: string}',
          ai_at: 'string|null 提炼时间 ISO',
          created_at: 'string ISO',
          updated_at: 'string ISO'
        }
      },
      transactions: {
        description: '账单流水。amount 恒为正数，收支方向看 direction',
        fields: {
          id: 'number 主键',
          tx_date: 'string YYYY-MM-DD',
          tx_time: 'string HH:mm:ss，可为空',
          merchant: 'string 交易对方/商户',
          description: 'string 商品说明',
          amount: 'number 金额（正数）',
          direction: 'string in=收入 out=支出',
          category: 'string 分类',
          currency: 'string 币种，默认 CNY',
          source: 'string 来源 alipay|wechat|bank|manual',
          note: 'string 备注',
          ai_categorized: 'boolean 分类是否由 AI 给出',
          created_at: 'string ISO'
        }
      },
      rules: {
        description: '用户自定义的分类规则，keyword 命中则归入 category',
        fields: { keyword: 'string', category: 'string' }
      },
      goals: {
        description: '未来目标。progress 为 0-100 的完成度，status=done 表示已完成',
        fields: {
          id: 'number 主键',
          title: 'string 目标',
          detail: 'string 具体做法/备注',
          category: 'string career|money|health|relation|growth|life',
          target_date: 'string|null YYYY-MM-DD 想完成的日期',
          progress: 'number 0-100',
          status: 'string active|done',
          created_at: 'string ISO',
          updated_at: 'string ISO'
        }
      },
      budgets: {
        description: '分类月度预算上限。month 为空串表示「每月通用」，非空则只对该月生效',
        fields: {
          id: 'number 主键',
          category: 'string 支出分类',
          month: 'string YYYY-MM 或空串',
          amount: 'number 上限金额',
          updated_at: 'string ISO'
        }
      },
      accounts: {
        description: '账户与余额。净资产 = is_liability=false 的余额之和 − is_liability=true 的余额之和',
        fields: {
          id: 'number 主键',
          name: 'string 账户名',
          kind: 'string bank|credit|cash|alipay|wechat|invest|loan',
          balance: 'number 当前余额',
          currency: 'string 币种',
          is_liability: 'boolean true=负债（信用卡/贷款），计入净资产时取负',
          note: 'string|null',
          updated_at: 'string ISO'
        }
      }
    },
    facets: {
      description: '日记维度的取值说明（entries.facets 里存的是 key）',
      values: Object.fromEntries(FACETS.map((f) => [f.k, f.label]))
    },
    goalCategories: Object.fromEntries(GOAL_CATEGORIES.map((c) => [c.k, c.label])),
    data: all
  };
}

/* ---------------- 文件生成 ---------------- */

export async function download(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  /* 在 claude.ai 里：普通的 <a download> 在嵌入页里会被拦，走平台的下载能力（会弹确认） */
  if (runtime.downloads) {
    try {
      await runtime.downloads.save({ filename, data: blob });
      return true;
    } catch (e) {
      if (e && (e.code === 'declined' || e.code === 'cancelled')) return false;
      console.warn('[download]', e);
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* CSV 转义：含逗号、引号、换行的格子要包引号 */
function cell(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(rows, headers) {
  const head = headers.map((h) => cell(h.label)).join(',');
  const body = rows
    .map((r) => headers.map((h) => cell(typeof h.get === 'function' ? h.get(r) : r[h.key])).join(','))
    .join('\r\n');
  return '\ufeff' + head + '\r\n' + body;
}

export function entriesCsv(entries) {
  return toCsv(entries, [
    { label: '日期', key: 'entry_date' },
    { label: '时间', get: (r) => (r.created_at ? new Date(r.created_at).toLocaleTimeString('zh-CN', { hour12: false }) : '') },
    { label: '标题', key: 'title' },
    { label: '原文', key: 'content' },
    { label: '心情', key: 'mood' },
    { label: '标签', key: 'tags' },
    { label: '维度', get: (r) => facetLabels(entryFacets(r)).join(' / ') },
    { label: 'AI摘要', key: 'summary' },
    { label: '重点', get: (r) => (Array.isArray(r.key_points) ? r.key_points.join(' / ') : '') },
    { label: '主题', get: (r) => (Array.isArray(r.topics) ? r.topics.join(' / ') : '') }
  ]);
}

export function txCsv(tx) {
  return toCsv(tx, [
    { label: '日期', key: 'tx_date' },
    { label: '时间', key: 'tx_time' },
    { label: '商户', key: 'merchant' },
    { label: '说明', key: 'description' },
    { label: '金额', key: 'amount' },
    { label: '方向', get: (r) => (r.direction === 'in' ? '收入' : '支出') },
    { label: '分类', key: 'category' },
    { label: '币种', key: 'currency' },
    { label: '来源', key: 'source' },
    { label: '备注', key: 'note' }
  ]);
}

/* 给 AI / 其他 agent 直接读的纯文本摘要，塞进对话就能用 */
function fmtMoneyLite(n) {
  return '¥' + (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function toPlainText(bundle) {
  const { data, counts } = bundle;
  const L = [];
  L.push(`个人APP导出 · ${new Date(bundle.exportedAt).toLocaleString('zh-CN')}`);
  L.push(`日记 ${counts.entries} 篇，账单 ${counts.transactions} 笔，分类规则 ${counts.rules} 条，目标 ${counts.goals || 0} 个`);
  L.push('');
  L.push('=== 日记 ===');
  data.entries.forEach((e) => {
    const fs = facetLabels(entryFacets(e));
    L.push(`[${e.entry_date}] ${e.title || ''}${e.mood ? `（心情:${e.mood}）` : ''}${fs.length ? `（${fs.join('/')}）` : ''}`);
    L.push(e.content || '');
    if (e.summary) L.push(`摘要：${e.summary}`);
    if (Array.isArray(e.key_points) && e.key_points.length) L.push('重点：' + e.key_points.join('；'));
    L.push('');
  });
  L.push('=== 账单 ===');
  data.transactions.forEach((t) => {
    const parts = [
      t.tx_date,
      t.tx_time || '',
      t.merchant || '',
      (t.description || '').replace(/\s+/g, ' '),
      t.amount,
      t.direction === 'in' ? '收入' : '支出',
      t.category || '',
      t.source || ''
    ];
    L.push('- ' + parts.join(' | '));
  });
  if (Array.isArray(data.goals) && data.goals.length) {
    L.push('');
    L.push('=== 目标 ===');
    data.goals.forEach((g) => {
      const c = goalCatOf(g.category);
      L.push(`- [${g.status === 'done' ? '已完成' : g.progress + '%'}] ${g.title}（${c.label}${g.target_date ? '，' + g.target_date : ''}）${g.detail ? ' — ' + g.detail : ''}`);
    });
  }
  if (Array.isArray(data.accounts) && data.accounts.length) {
    L.push('');
    L.push('=== 账户 ===');
    let assets = 0;
    let debts = 0;
    data.accounts.forEach((a) => {
      const v = Number(a.balance) || 0;
      if (a.is_liability) debts += v;
      else assets += v;
      L.push(`- ${a.name}（${a.kind}）${fmtMoneyLite(v)}${a.is_liability ? ' [负债]' : ''}`);
    });
    L.push(`资产合计 ${fmtMoneyLite(assets)}，负债合计 ${fmtMoneyLite(debts)}，净资产 ${fmtMoneyLite(assets - debts)}`);
  }
  if (Array.isArray(data.budgets) && data.budgets.length) {
    L.push('');
    L.push('=== 预算 ===');
    data.budgets.forEach((b) => {
      L.push(`- ${b.category}${b.month ? '（' + b.month + '）' : '（每月）'} 上限 ${fmtMoneyLite(b.amount)}`);
    });
  }
  return L.join('\n');
}
