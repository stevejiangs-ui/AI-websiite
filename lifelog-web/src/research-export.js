/* 「给 Claude 研究」导出
   ------------------------------------------------------------------
   把全量备份（exporter.collectAll 的结果）整理成一份 Markdown，
   专门给 AI 读来研究「我这个人」、辅助以后做决定。

   和「纯文本」导出的区别：
   - 覆盖全部表（人物、健康、利好消息、任务、八字…纯文本只有日记/账单/目标/账户/预算）
   - 账单先按月汇总、按分类排名，最近 3 个月才列明细 —— 几千笔流水直接贴给 AI 只会淹没重点
   - 开头写好「请你怎么分析」的说明，上传到 Claude 项目就能直接用
   - 日记里打了「决策」标签的单独成一节：当时怎么想的 → 后来结果如何，这是最值钱的数据
   - 隐私：不导出邮箱/手机号/账号 ID、经纬度；人物卡标了「敏感/别提」的只留名字和关系

   纯函数，不碰数据库，方便测试。 */

import { facetLabels, entryFacets, goalCatOf } from './facets.js';

export const DECISION_TAG = '决策';

const REL = { family: '亲人', friend: '朋友', work: '同事/合作', dislike: '不喜欢的人', other: '其他' };
const AREA = { money: '财富', work: '工作', family: '家庭', health: '健康', life: '生活' };

const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (n, cur) => {
  const s = num(n).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return cur && cur !== 'CNY' ? `${s} ${cur}` : `¥${s}`;
};
const oneLine = (s, max = 0) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return max && t.length > max ? t.slice(0, max) + '…' : t;
};
const avg = (xs) => {
  const v = xs.map(Number).filter((x) => Number.isFinite(x) && x > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const fix1 = (x) => (x == null ? '—' : (Math.round(x * 10) / 10).toString());

export function hasDecisionTag(entry) {
  return String(entry?.tags || '')
    .split(/[\s,，#]+/)
    .some((t) => t === DECISION_TAG);
}

function dateRange(entries, tx) {
  const ds = [...entries.map((e) => e.entry_date), ...tx.map((t) => t.tx_date)].filter(Boolean).sort();
  return ds.length ? `${ds[0]} 至 ${ds[ds.length - 1]}` : '（暂无记录）';
}

/* 按月汇总收支 + 每月支出前三分类 */
function monthlyTable(tx) {
  const byMonth = new Map();
  for (const t of tx) {
    const m = String(t.tx_date || '').slice(0, 7);
    if (!m) continue;
    if (!byMonth.has(m)) byMonth.set(m, { inc: 0, out: 0, cats: new Map() });
    const r = byMonth.get(m);
    const a = num(t.amount);
    if (t.direction === 'in') r.inc += a;
    else {
      r.out += a;
      const c = t.category || '未分类';
      r.cats.set(c, (r.cats.get(c) || 0) + a);
    }
  }
  const months = [...byMonth.keys()].sort().reverse();
  if (!months.length) return ['（暂无账单）'];
  const L = ['| 月份 | 收入 | 支出 | 结余 | 支出前三 |', '|---|---|---|---|---|'];
  for (const m of months) {
    const r = byMonth.get(m);
    const top = [...r.cats.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([c, v]) => `${c} ${money(v)}`)
      .join('；');
    L.push(`| ${m} | ${money(r.inc)} | ${money(r.out)} | ${money(r.inc - r.out)} | ${top || '—'} |`);
  }
  return L;
}

function categoryRanking(tx) {
  const m = new Map();
  for (const t of tx) {
    if (t.direction === 'in') continue;
    const c = t.category || '未分类';
    const r = m.get(c) || { sum: 0, n: 0 };
    r.sum += num(t.amount);
    r.n += 1;
    m.set(c, r);
  }
  const rows = [...m.entries()].sort((a, b) => b[1].sum - a[1].sum);
  if (!rows.length) return [];
  const total = rows.reduce((s, [, r]) => s + r.sum, 0) || 1;
  return [
    '| 分类 | 合计 | 笔数 | 占比 |',
    '|---|---|---|---|',
    ...rows.map(([c, r]) => `| ${c} | ${money(r.sum)} | ${r.n} | ${Math.round((r.sum / total) * 100)}% |`)
  ];
}

function recentTxLines(tx, today) {
  const cut = new Date(today);
  cut.setMonth(cut.getMonth() - 3);
  const cutStr = cut.toISOString().slice(0, 10);
  const recent = tx.filter((t) => (t.tx_date || '') >= cutStr).sort((a, b) => (b.tx_date || '').localeCompare(a.tx_date || ''));
  return recent.map(
    (t) =>
      `- ${t.tx_date} ${t.direction === 'in' ? '收入' : '支出'} ${money(t.amount, t.currency)} · ${t.category || '未分类'} · ${oneLine(
        t.merchant,
        30
      )}${t.description ? ' · ' + oneLine(t.description, 40) : ''}${t.note ? '（' + oneLine(t.note, 40) + '）' : ''}`
  );
}

function entryBlock(e, todosByEntry) {
  const L = [];
  const fs = facetLabels(entryFacets(e));
  const meta = [e.mood ? `心情:${e.mood}` : '', fs.length ? fs.join('/') : '', e.tags ? `标签:${oneLine(e.tags)}` : '']
    .filter(Boolean)
    .join(' · ');
  L.push(`### ${e.entry_date}${e.title ? ' ' + oneLine(e.title) : ''}`);
  if (meta) L.push(`*${meta}*`);
  L.push('');
  L.push(String(e.content || '').trim() || '（空）');
  const todos = todosByEntry.get(e.id) || [];
  if (todos.length) L.push('', '待办：' + todos.map((t) => `${t.status === 'done' ? '✓' : '□'}${t.title}`).join('；'));
  L.push('');
  return L;
}

/**
 * @param bundle collectAll() 的返回值
 * @param opts.today 'YYYY-MM-DD'，测试用；默认今天
 */
export function toResearchMarkdown(bundle, opts = {}) {
  const d = bundle?.data || {};
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const entries = arr(d.entries).slice().sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date)));
  const tx = arr(d.transactions);
  const todos = arr(d.todos);
  const todosByEntry = new Map();
  for (const t of todos) {
    if (t.entry_id == null) continue;
    if (!todosByEntry.has(t.entry_id)) todosByEntry.set(t.entry_id, []);
    todosByEntry.get(t.entry_id).push(t);
  }

  const L = [];
  const H = (s) => L.push('', `## ${s}`, '');

  L.push(`# 个人APP · 研究资料（${today}）`);
  L.push('');
  L.push(`记录跨度：${dateRange(entries, tx)}。日记 ${entries.length} 篇，账单 ${tx.length} 笔。`);
  L.push('');
  L.push('> **给 Claude 的说明**');
  L.push('> 这是我（Steve）个人APP的完整导出，我用它记录生活、钱、家人、健康和机会。');
  L.push('> 我的目标：发财、家庭幸福、开心、身体健康、形象得体。');
  L.push('> 请你把这份资料当作研究「我这个人」的一手数据：');
  L.push('> 1. 找出我的习惯、花钱规律、情绪和精力的周期、反复出现的人和事；');
  L.push('> 2. 对照「决策记录」：我当时怎么想、后来结果如何，总结我哪类决定准、哪类容易冲动；');
  L.push('> 3. 我来问具体决定时，引用这里的真实记录说话，指出我的盲点，不要只顺着我；');
  L.push('> 4. 八字是我的参考框架之一，可以结合，但不要用它替代对数据的判断。');

  /* ---- 决策记录 ---- */
  const decisions = entries.filter(hasDecisionTag);
  H(`决策记录（日记标签「${DECISION_TAG}」，${decisions.length} 条）`);
  if (decisions.length) decisions.forEach((e) => L.push(...entryBlock(e, todosByEntry)));
  else L.push(`（还没有。以后做重要决定时写一篇日记，标签填「${DECISION_TAG}」：选项、金额、理由、直觉；事后在同一篇补上结果。）`);

  /* ---- 目标与任务 ---- */
  H('目标');
  const goals = arr(d.goals);
  if (goals.length) {
    goals
      .slice()
      .sort((a, b) => (a.status === 'done') - (b.status === 'done'))
      .forEach((g) =>
        L.push(
          `- [${g.status === 'done' ? '已完成' : num(g.progress) + '%'}] ${oneLine(g.title)}（${goalCatOf(g.category).label}${
            g.target_date ? '，目标 ' + g.target_date : ''
          }）${g.detail ? ' — ' + oneLine(g.detail, 200) : ''}`
        )
      );
  } else L.push('（暂无）');

  const tasks = arr(d.tasks).filter((t) => t.status !== 'done');
  const looseTodos = todos.filter((t) => t.status !== 'done');
  if (tasks.length || looseTodos.length) {
    H('未完成的任务和待办');
    tasks.forEach((t) =>
      L.push(`- ${t.due_date ? t.due_date + ' ' : ''}${oneLine(t.title)}${t.priority && t.priority !== 'normal' ? `（${t.priority}）` : ''}`)
    );
    looseTodos.forEach((t) => L.push(`- ${t.source_date ? t.source_date + ' ' : ''}${oneLine(t.title)}（来自日记）`));
  }

  /* ---- 财务 ---- */
  H('财务');
  const accounts = arr(d.accounts);
  if (accounts.length) {
    let assets = 0;
    let debts = 0;
    L.push('**账户**');
    accounts.forEach((a) => {
      const v = num(a.balance);
      if (a.is_liability) debts += v;
      else assets += v;
      L.push(`- ${oneLine(a.name)}（${a.kind}）${money(v, a.currency)}${a.is_liability ? ' [负债]' : ''}`);
    });
    L.push(`- 资产 ${money(assets)}，负债 ${money(debts)}，净资产 ${money(assets - debts)}（多币种未换算，仅供参考）`);
    L.push('');
  }
  L.push('**每月收支**', '', ...monthlyTable(tx));
  const rank = categoryRanking(tx);
  if (rank.length) L.push('', '**支出分类排名（全部时间）**', '', ...rank);
  const budgets = arr(d.budgets);
  if (budgets.length) {
    L.push('', '**预算**');
    budgets.forEach((b) => L.push(`- ${b.category}${b.month ? `（${b.month}）` : '（每月）'} 上限 ${money(b.amount)}`));
  }
  const recent = recentTxLines(tx, today);
  if (recent.length) L.push('', `**最近 3 个月明细（${recent.length} 笔）**`, '', ...recent);

  /* ---- 利好消息 ---- */
  const signals = arr(d.signals).filter((s) => s.status !== 'archived');
  if (signals.length) {
    H('收集的外部机会 / 消息');
    signals.forEach((s) => {
      const score = s.ai_score == null ? '' : ` · AI评分 ${s.ai_score > 0 ? '+' : ''}${s.ai_score}`;
      L.push(`- [${AREA[s.area] || s.area || '生活'}${s.status === 'acted' ? ' · 已行动' : ''}${score}] ${oneLine(s.title)}${s.content ? ' — ' + oneLine(s.content, 200) : ''}`);
      if (s.ai_take) L.push(`  - AI看法：${oneLine(s.ai_take, 240)}`);
    });
  }

  /* ---- 健康 ---- */
  const health = arr(d.health_logs).slice().sort((a, b) => String(b.log_date).localeCompare(String(a.log_date)));
  if (health.length) {
    H('身体与精力');
    const last30 = health.slice(0, 30);
    L.push(
      `最近 ${last30.length} 次打卡平均：睡眠 ${fix1(avg(last30.map((h) => h.sleep_hours)))} 小时，心情 ${fix1(
        avg(last30.map((h) => h.mood))
      )}/5，精力 ${fix1(avg(last30.map((h) => h.energy)))}/5，运动 ${fix1(avg(last30.map((h) => h.exercise_min)))} 分钟，步数 ${fix1(
        avg(last30.map((h) => h.steps))
      )}，体重 ${fix1(avg(last30.map((h) => h.weight_kg)))} kg`
    );
    L.push('', '| 日期 | 睡眠 | 心情 | 精力 | 运动 | 步数 | 体重 | 备注 |', '|---|---|---|---|---|---|---|---|');
    health.forEach((h) =>
      L.push(
        `| ${h.log_date} | ${h.sleep_hours ?? ''} | ${h.mood ?? ''} | ${h.energy ?? ''} | ${h.exercise_min ?? ''} | ${h.steps ?? ''} | ${
          h.weight_kg ?? ''
        } | ${oneLine(h.note, 60).replace(/\|/g, '/')} |`
      )
    );
  }

  /* ---- 人 ---- */
  const people = arr(d.people);
  if (people.length) {
    H('身边的人');
    people.forEach((p) => {
      const rel = p.relation_label || REL[p.relation] || p.relation || '';
      const head = `- **${oneLine(p.name)}**（${rel}，亲近度 ${p.closeness ?? '—'}/5${p.last_contact ? '，上次联系 ' + p.last_contact : ''}）`;
      if (p.sensitive || p.not_mention) {
        L.push(head + ' ［标记为敏感，细节未导出］');
        return;
      }
      const extra = [
        p.birthday ? `生日 ${p.birthday}` : '',
        p.likes ? `喜欢 ${oneLine(p.likes, 80)}` : '',
        p.dislikes ? `不喜欢 ${oneLine(p.dislikes, 80)}` : '',
        p.notes ? `备注 ${oneLine(p.notes, 160)}` : ''
      ].filter(Boolean);
      L.push(head + (extra.length ? ' — ' + extra.join('；') : ''));
    });
  }

  /* ---- 八字 ---- */
  const birth = arr(d.birth_info)[0];
  const qa = arr(d.bazi_qa);
  if (birth || qa.length) {
    H('八字');
    if (birth) {
      L.push(
        `出生：${birth.cal === 'lunar' ? '农历' : '公历'} ${birth.year}-${birth.month}-${birth.day} ${String(birth.hour).padStart(2, '0')}:${String(
          birth.minute || 0
        ).padStart(2, '0')}${birth.place ? '，' + birth.place : ''}`
      );
    }
    qa.slice(-30).forEach((q) => {
      L.push('', `**问（${q.day_key || ''}${q.day_gz ? ' ' + q.day_gz : ''}）**：${oneLine(q.question, 200)}`);
      if (q.answer) L.push(`答：${oneLine(q.answer, 400)}`);
    });
  }

  /* ---- 穿搭 / 常去地点 ---- */
  const looks = arr(d.looks);
  if (looks.length) {
    H(`穿搭记录（${looks.length} 条，只导出文字）`);
    looks.slice(0, 40).forEach((l) => {
      const kind = { photo: '照片', outfit: '穿搭', idea: '想买', note: '记录' }[l.kind] || '';
      const txt = [String(l.taken_at || '').slice(0, 10), kind, l.title || '', l.note || '', l.tags || ''].map((s) => oneLine(s, 80)).filter(Boolean);
      if (txt.length) L.push('- ' + txt.join(' · '));
    });
  }
  const places = arr(d.places);
  if (places.length) {
    H('常在地点');
    places.forEach((p) =>
      L.push(`- ${oneLine(p.label)}：${[p.city, p.region, p.country].filter(Boolean).join('，')}${p.is_home ? '（家）' : ''}${p.is_work ? '（工作）' : ''}`)
    );
  }

  /* ---- 日记全文 ---- */
  H(`日记全文（${entries.length} 篇，新的在前）`);
  if (entries.length) entries.forEach((e) => L.push(...entryBlock(e, todosByEntry)));
  else L.push('（暂无）');

  return L.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
