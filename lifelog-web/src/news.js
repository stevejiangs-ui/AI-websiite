/* 新闻关注：固定关注的公司、地方和宏观话题。
   数据不另建表，存在现有的 signals 表里，source 字段以「关注:<话题key>」开头作标记：
     source = '关注:au_home'            （没填来源）
     source = '关注:au_home · 澳洲金融评论'（填了来源）
   这样 WorkBuddy 不用建表、备份 / 恢复自动包含，老的利好消息一条不动。
   status：new 未读 / acted 已跟进 / archived 已读。
   纯数据和纯函数，可以直接 node 跑（test/verify-news.mjs）。 */

export const NEWS_TOPICS = [
  {
    k: 'gd_cj',
    label: '广东长江食品',
    full: '广东长江食品有限公司',
    emoji: '🏭',
    kind: 'company',
    q: '广东长江食品有限公司',
    watch: '经营动态、招投标与合作、工商变更、司法与行政处罚、食品抽检结果'
  },
  {
    k: 'ts_cj',
    label: '台山长江食品',
    full: '台山市长江食品有限公司',
    emoji: '🏭',
    kind: 'company',
    q: '台山市长江食品有限公司',
    watch: '经营动态、工商变更、司法与行政处罚、食品抽检结果、台山本地产业政策'
  },
  {
    k: 'lj_cj',
    label: '伦教长江中心',
    full: '伦教长江中心（佛山顺德）',
    emoji: '🏢',
    kind: 'place',
    q: '伦教长江中心',
    watch: '招商与出租、周边规划和交通、顺德伦教商业地产行情、物业管理'
  },
  {
    k: 'au_econ',
    label: '澳洲经济',
    full: '澳大利亚经济',
    emoji: '🇦🇺',
    kind: 'macro',
    q: '澳大利亚 经济',
    qEn: 'Australia economy',
    watch: 'RBA 利率决议、通胀 CPI、就业、澳元汇率、财政预算',
    official: [
      { label: '澳联储 RBA', url: 'https://www.rba.gov.au/' },
      { label: '澳统计局 ABS', url: 'https://www.abs.gov.au/' }
    ]
  },
  {
    k: 'us_econ',
    label: '美国经济',
    full: '美国经济',
    emoji: '🇺🇸',
    kind: 'macro',
    q: '美国 经济',
    qEn: 'US economy',
    watch: '美联储利率、CPI、非农就业、美元与美债收益率、关税政策',
    official: [
      { label: '美联储 Fed', url: 'https://www.federalreserve.gov/' },
      { label: '美劳工统计局 BLS', url: 'https://www.bls.gov/' }
    ]
  },
  {
    k: 'au_home',
    label: '澳洲房市',
    full: '澳大利亚房地产市场',
    emoji: '🏠',
    kind: 'macro',
    q: '澳洲 房价',
    qEn: 'Australia housing market',
    watch: '各首府城市房价指数、清盘率、租金与空置率、贷款政策、外国买家规定',
    official: [
      { label: 'Domain 新闻', url: 'https://www.domain.com.au/news/' },
      { label: 'realestate.com.au 新闻', url: 'https://www.realestate.com.au/news/' }
    ]
  }
];

const TAG = '关注:';

export function newsTopic(k) {
  return NEWS_TOPICS.find((t) => t.k === k) || null;
}

/** 这条 signals 记录是不是新闻关注里的（不是就是普通利好消息） */
export function isNewsItem(row) {
  return !!row && String(row.source || '').startsWith(TAG);
}

/** 从 source 里拆出话题 key 和用户自己填的来源 */
export function parseNewsSource(source) {
  const s = String(source || '');
  if (!s.startsWith(TAG)) return { topic: '', source: s };
  const rest = s.slice(TAG.length);
  const i = rest.indexOf(' · ');
  return i < 0 ? { topic: rest.trim(), source: '' } : { topic: rest.slice(0, i).trim(), source: rest.slice(i + 3).trim() };
}

export function makeNewsSource(topic, source) {
  const src = String(source || '').trim();
  return TAG + topic + (src ? ' · ' + src : '');
}

/** 搜最新新闻的入口。按时间排序的新闻搜索，国内能打开的放前面。 */
export function searchLinks(t) {
  const q = encodeURIComponent(t.q);
  const links = [
    { label: '百度资讯', url: `https://www.baidu.com/s?tn=news&rtt=4&word=${q}` },
    { label: '必应新闻', url: `https://cn.bing.com/news/search?q=${q}&qft=sortbydate%3d%221%22` }
  ];
  if (t.kind === 'company') {
    links.push({ label: '企查查', url: `https://www.qcc.com/web/search?key=${q}` });
    links.push({ label: '天眼查', url: `https://www.tianyancha.com/search?key=${q}` });
  }
  if (t.qEn) {
    const qe = encodeURIComponent(t.qEn);
    links.push({ label: 'Google News', url: `https://news.google.com/search?q=${qe}&hl=en-AU&gl=AU&ceid=AU:en` });
  } else {
    links.push({ label: 'Google 新闻', url: `https://news.google.com/search?q=${q}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans` });
  }
  return [...links, ...(t.official || [])];
}

/** 按话题分组，每组按时间新到旧 */
export function groupNews(rows) {
  const out = {};
  NEWS_TOPICS.forEach((t) => (out[t.k] = []));
  (rows || []).forEach((r) => {
    const { topic } = parseNewsSource(r.source);
    if (out[topic]) out[topic].push(r);
  });
  Object.values(out).forEach((list) => list.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || (b.id || 0) - (a.id || 0)));
  return out;
}

/** 专家 / AI 用的文字版：每个话题最近几条 */
export function newsDigestText(rows, { perTopic = 6, onlyTopic = '' } = {}) {
  const g = groupNews(rows);
  const lines = [];
  NEWS_TOPICS.filter((t) => !onlyTopic || t.k === onlyTopic).forEach((t) => {
    const list = g[t.k].slice(0, perTopic);
    lines.push(`【${t.full}】（关注点：${t.watch}）`);
    if (!list.length) lines.push('  （还没收藏这个话题的新闻）');
    list.forEach((r) => {
      const { source } = parseNewsSource(r.source);
      const date = String(r.created_at || '').slice(0, 10);
      const body = String(r.content || '').replace(/\s+/g, ' ').slice(0, 220);
      lines.push(`  - ${date} ${r.title}${source ? '（' + source + '）' : ''}${body ? '：' + body : ''}`);
      if (r.ai_take) lines.push(`    AI 判断：${String(r.ai_take).split('\n')[0]}`);
    });
  });
  return lines.join('\n');
}
