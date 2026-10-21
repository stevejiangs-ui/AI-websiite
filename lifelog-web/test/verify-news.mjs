/* 新闻关注的纯函数：话题标记的读写、分组、搜索链接 */
import { NEWS_TOPICS, isNewsItem, parseNewsSource, makeNewsSource, searchLinks, groupNews, newsDigestText } from '../src/news.js';

let pass = 0;
let total = 0;
const ok = (c, msg) => {
  total++;
  if (c) pass++;
  else console.log('✗ ' + msg);
};

ok(NEWS_TOPICS.length === 6, '6 个话题');
ok(new Set(NEWS_TOPICS.map((t) => t.k)).size === 6, '话题 key 不重复');
['广东长江食品有限公司', '台山市长江食品有限公司', '伦教长江中心', '澳大利亚经济', '美国经济', '澳大利亚房地产市场'].forEach((n) =>
  ok(NEWS_TOPICS.some((t) => t.full.startsWith(n)), '话题包含 ' + n)
);

ok(makeNewsSource('au_home', '') === '关注:au_home', '无来源');
ok(makeNewsSource('au_home', ' Domain ') === '关注:au_home · Domain', '有来源');
ok(JSON.stringify(parseNewsSource('关注:au_home · Domain · 周报')) === JSON.stringify({ topic: 'au_home', source: 'Domain · 周报' }), '来源里带分隔符也能拆');
ok(JSON.stringify(parseNewsSource('关注:us_econ')) === JSON.stringify({ topic: 'us_econ', source: '' }), '只有话题');
ok(JSON.stringify(parseNewsSource('财新')) === JSON.stringify({ topic: '', source: '财新' }), '普通利好消息的来源原样返回');
ok(isNewsItem({ source: '关注:gd_cj' }) && !isNewsItem({ source: '财新' }) && !isNewsItem({ source: null }) && !isNewsItem(null), 'isNewsItem');

NEWS_TOPICS.forEach((t) => {
  const links = searchLinks(t);
  ok(links.length >= 3 && links.every((l) => /^https:\/\//.test(l.url)), t.label + ' 搜索链接都是 https');
  ok(links[0].url.includes(encodeURIComponent(t.q)), t.label + ' 百度资讯带关键词');
});
ok(searchLinks(NEWS_TOPICS[0]).some((l) => l.label === '企查查'), '公司话题有企查查');
ok(!searchLinks(NEWS_TOPICS[3]).some((l) => l.label === '企查查'), '宏观话题没有企查查');

const rows = [
  { id: 1, title: 'A', source: '关注:au_home', created_at: '2026-10-01T00:00:00Z', status: 'new' },
  { id: 2, title: 'B', source: '关注:au_home · Domain', created_at: '2026-10-03T00:00:00Z', status: 'new', ai_take: '有利\n原因：…' },
  { id: 3, title: 'C', source: '关注:不存在的话题', created_at: '2026-10-02T00:00:00Z' },
  { id: 4, title: 'D', source: '财新', created_at: '2026-10-02T00:00:00Z' }
];
const g = groupNews(rows);
ok(g.au_home.map((x) => x.title).join('') === 'BA', '分组并按时间新到旧');
ok(Object.values(g).flat().length === 2, '未知话题和普通消息不进分组');
const txt = newsDigestText(rows, { onlyTopic: 'au_home' });
ok(txt.includes('澳大利亚房地产市场') && txt.includes('B（Domain）') && txt.includes('AI 判断：有利') && !txt.includes('美国经济'), '文字摘要');
ok(newsDigestText([]).includes('还没收藏'), '空数据提示');

console.log(`新闻关注 ${total} 项中通过 ${pass} 项`);
console.log(pass === total ? '全部通过 ✓' : '有失败 ✗');
if (pass !== total) process.exit(1);
