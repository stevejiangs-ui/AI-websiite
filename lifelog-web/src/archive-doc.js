/* 档案文档的生成逻辑（纯函数，不碰 DOM、不碰网络）。

   单独拆出来是为了能直接用 node 跑测试：文档是按月拼出来的一大段字符串，
   错一个月、漏一类数据，在页面上很难一眼看出来，只能靠断言钉住。
*/

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD...' → 'YYYY-MM-DD'；拿不到就返回空串 */
export function dayOf(d) {
  const s = String(d || '');
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export function ymOf(d) {
  const day = dayOf(d);
  return day ? day.slice(0, 7) : '';
}

export function moneyText(n) {
  const v = Number(n) || 0;
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 消费小结：支出/收入合计、分类排行、大额明细 */
export function spendSummary(list) {
  let outSum = 0;
  let inSum = 0;
  const byCat = new Map();
  (list || []).forEach((t) => {
    const amt = Number(t.amount) || 0;
    if (t.direction === 'in') {
      inSum += amt;
      return;
    }
    outSum += amt;
    const k = t.category || '其他';
    byCat.set(k, (byCat.get(k) || 0) + amt);
  });
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const big = (list || [])
    .filter((t) => t.direction !== 'in' && (Number(t.amount) || 0) >= 200)
    .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))
    .slice(0, 8);
  return { outSum, inSum, cats, big };
}

/** 按年月归堆：{ '2026-10': { entries, events, places, tx } } */
export function groupByMonth({ entries = [], tasks = [], places = [], tx = [] } = {}) {
  const map = new Map();
  const bucket = (ym) => {
    const k = ym || '未标注日期';
    if (!map.has(k)) map.set(k, { entries: [], events: [], places: [], tx: [] });
    return map.get(k);
  };

  entries.forEach((e) => bucket(ymOf(e.entry_date)).entries.push(e));
  tasks
    .filter((t) => t.kind === 'event' && t.due_date)
    .forEach((t) => bucket(ymOf(t.due_date)).events.push(t));
  places
    .filter((p) => p.created_at || p.visited_at)
    .forEach((p) => bucket(ymOf(p.visited_at || p.created_at)).places.push(p));
  tx.forEach((t) => bucket(ymOf(t.tx_date)).tx.push(t));

  return map;
}

/** 生成整份 Markdown 文档 */
export function composeDoc(
  { entries = [], tasks = [], places = [], tx = [] } = {},
  { now = new Date() } = {}
) {
  const groups = groupByMonth({ entries, tasks, places, tx });
  const months = [...groups.keys()].filter((k) => k !== '未标注日期').sort().reverse();
  const undated = groups.get('未标注日期');
  if (undated) months.push('未标注日期');

  const L = [];
  const totalWords = entries.reduce((a, e) => a + String(e.content || '').length, 0);
  const totalOut = tx.filter((t) => t.direction !== 'in').reduce((a, t) => a + (Number(t.amount) || 0), 0);
  const eventCount = tasks.filter((t) => t.kind === 'event').length;

  L.push('# 我的生活档案');
  L.push('');
  L.push(`生成时间：${now.toLocaleString('zh-CN')}`);
  L.push(
    `收录：经历 ${entries.length} 篇（约 ${totalWords} 字）· 行程 ${eventCount + places.length} 条 · 消费 ${tx.length} 笔（支出合计 ${moneyText(totalOut)}）`
  );
  L.push('');
  L.push('> 这份文档可以打印成 PDF 存档，也可以用「档案 → 导入资料」整份导回应用。');
  L.push('');

  if (!months.length) {
    L.push('（还没有任何记录）');
    return L.join('\n');
  }

  months.forEach((ym) => {
    const g = groups.get(ym);
    L.push('---');
    L.push('');
    L.push(ym === '未标注日期' ? '## 未标注日期' : `## ${ym.replace('-', ' 年 ')} 月`);
    L.push('');

    if (g.entries.length) {
      L.push('### 经历');
      L.push('');
      g.entries
        .slice()
        .sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)))
        .forEach((e) => {
          const tags = [
            e.mood ? `心情 ${e.mood}` : '',
            e.tags ? `#${String(e.tags).split(/[,，\s]+/).filter(Boolean).join(' #')}` : ''
          ]
            .filter(Boolean)
            .join(' · ');
          L.push(`#### ${dayOf(e.entry_date)}${e.title ? ' · ' + e.title : ''}`);
          if (tags) L.push(`*${tags}*`);
          L.push('');
          L.push(String(e.content || '').trim() || '（无正文）');
          if (e.summary) L.push('', `> 摘要：${e.summary}`);
          if (Array.isArray(e.key_points) && e.key_points.length) L.push(`> 重点：${e.key_points.join('；')}`);
          L.push('');
        });
    }

    const tripLines = [];
    g.events
      .slice()
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
      .forEach((t) => {
        tripLines.push(
          `- ${dayOf(t.due_date)}${t.due_time ? ' ' + String(t.due_time).slice(0, 5) : ''} ${t.title || ''}${t.detail ? '｜' + t.detail : ''}`
        );
      });
    g.places.forEach((p) => {
      const when = dayOf(p.visited_at || p.created_at);
      tripLines.push(`- ${when} 到过 ${p.label || '某地'}${p.city ? '（' + [p.city, p.region].filter(Boolean).join(' ') + '）' : ''}`);
    });
    if (tripLines.length) {
      L.push('### 行程');
      L.push('');
      L.push(...tripLines);
      L.push('');
    }

    if (g.tx.length) {
      const s = spendSummary(g.tx);
      L.push('### 消费');
      L.push('');
      L.push(`合计支出 **${moneyText(s.outSum)}**${s.inSum ? `，收入 ${moneyText(s.inSum)}` : ''}，共 ${g.tx.length} 笔。`);
      if (s.cats.length) {
        L.push('');
        L.push('分类：' + s.cats.map(([k, v]) => `${k} ${moneyText(v)}`).join('、'));
      }
      if (s.big.length) {
        L.push('');
        L.push('较大的几笔：');
        s.big.forEach((t) => {
          L.push(`- ${dayOf(t.tx_date)} ${t.merchant || t.description || '（未命名）'} ${moneyText(t.amount)}${t.category ? '｜' + t.category : ''}`);
        });
      }
      L.push('');
    }
  });

  return L.join('\n');
}

/** 结构化备份：导回来用这个才一条不差 */
export function composeJson({ entries = [], tasks = [], places = [], tx = [] } = {}, { now = new Date() } = {}) {
  return {
    kind: 'lifelog-archive',
    version: 1,
    exportedAt: now.toISOString(),
    counts: { entries: entries.length, tasks: tasks.length, places: places.length, transactions: tx.length },
    entries: entries.map((e) => ({
      entry_date: dayOf(e.entry_date),
      title: e.title || '',
      content: e.content || '',
      mood: e.mood || '',
      tags: e.tags || '',
      summary: e.summary || '',
      key_points: e.key_points || null
    })),
    tasks: tasks.map((t) => ({
      kind: t.kind,
      title: t.title || '',
      detail: t.detail || '',
      due_date: t.due_date || null,
      due_time: t.due_time || null,
      status: t.status || 'todo'
    })),
    places: places.map((p) => ({
      label: p.label || '',
      city: p.city || '',
      region: p.region || '',
      country: p.country || '',
      lat: p.lat,
      lon: p.lon
    })),
    transactions: tx.map((t) => ({
      tx_date: dayOf(t.tx_date),
      tx_time: t.tx_time || '',
      merchant: t.merchant || '',
      description: t.description || '',
      amount: Number(t.amount) || 0,
      direction: t.direction === 'in' ? 'in' : 'out',
      category: t.category || '其他'
    }))
  };
}
