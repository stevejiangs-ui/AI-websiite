/* 2.3 新功能端到端（claude.ai 版 + 模拟运行时）：快速记消费、新闻关注、九位专家、
   以及「老数据不受影响」：已有的利好消息和账单在升级后照常显示 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const ROOT = new URL('..', import.meta.url).pathname;
const APP = process.env.APP_URL || 'file://' + ROOT + 'dist/' + encodeURIComponent('个人APP.html');
const SHOTS = ROOT + 'test/shots/';
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript({ path: ROOT + 'test/mock-claude.js' });
/* 预置老数据：一条利好消息、一笔老账 */
await ctx.addInitScript(() => {
  if (window.__seeded) return;
  window.__seeded = true;
  const base = 'data/users/user_test123/t/';
  if (!window.__mockStore) return;
  window.__mockStore[base + 'signals/501'] = { id: 501, owner_id: 'user_test123', title: '老的利好消息', content: '原来的内容', source: '财新', url: '', area: 'money', status: 'new', created_at: '2026-10-01T00:00:00Z' };
  const d = new Date().toLocaleDateString('sv');
  window.__mockStore[base + 'transactions/601'] = { id: 601, owner_id: 'user_test123', tx_date: d, tx_time: '', merchant: '老账', amount: 20, direction: 'out', category: '餐饮', source: 'manual', raw_hash: 'old-1' };
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? '✓ ' : '✗ ') + msg); };
const rowsOf = (t) => page.evaluate((t) => Object.entries(window.__mockStore).filter(([k]) => k.includes('/t/' + t + '/')).map(([, v]) => v), t);
const openMore = async (label) => {
  await page.click('.mobile-nav button:has-text("更多")');
  await page.waitForTimeout(300);
  await page.click(`.more-item:has-text("${label}")`);
  await page.waitForTimeout(800);
};

await page.goto(APP);
await page.waitForSelector('#reg-email');
await page.fill('#reg-email', 'test.user@example.com');
await page.fill('#reg-pass', 'secret123');
await page.fill('#reg-pass2', 'secret123');
await page.click('button:has-text("创建并进入")');
await page.waitForSelector('#code-saved');
await page.check('#code-saved');
await page.click('button:has-text("进入应用")');
await page.waitForSelector('.pillar-grid');
await page.waitForTimeout(900);

/* ---------- 九位专家 ---------- */
ok((await page.$$('.home .expert-grid .expert-card')).length === 9, '首页专家 9 位');
ok((await page.textContent('.home')).includes('经济与房产顾问'), '新增：经济与房产顾问');

/* ---------- 快速记消费 ---------- */
ok((await page.textContent('.qs-home')).includes('20.00'), '首页「今天花了」包含老账 ¥20');
ok(!!(await page.$('#qs-fab')), '右下角有「＋」');
await page.click('#qs-fab');
await page.waitForSelector('#qs-amount');
await page.waitForTimeout(300);
ok((await page.textContent('.qs-panel')).includes('今天已花'), '弹层显示今天已花');
await page.screenshot({ path: SHOTS + 'v23-quick-spend.png' });
await page.click('#qs-save');
await page.waitForTimeout(300);
ok((await rowsOf('transactions')).length === 1, '没填金额不保存');
await page.fill('#qs-amount', '38.5');
await page.click('.qs-chip:has-text("交通")');
await page.fill('#qs-merchant', '打车');
await page.click('#qs-save');
await page.waitForTimeout(900);
const tx = await rowsOf('transactions');
const added = tx.find((x) => x.merchant === '打车');
ok(tx.length === 2 && added && added.amount === 38.5 && added.category === '交通' && added.direction === 'out', '记上一笔：交通 打车 38.5');
ok(!!(await page.$('#qs-fab')) && !(await page.$('#qs-amount')), '保存后弹层关闭');
ok((await page.textContent('.qs-home')).includes('58.50'), '首页今天花了自动刷新为 58.50');
/* 只填金额：自动归「其他」 */
await page.click('#home-qs');
await page.waitForSelector('#qs-amount');
await page.fill('#qs-amount', '12');
await page.press('#qs-amount', 'Enter');
await page.waitForTimeout(900);
const tx2 = await rowsOf('transactions');
ok(tx2.length === 3 && tx2.some((x) => x.amount === 12 && x.category === '其他'), '只填金额回车也能记，归到「其他」');

/* ---------- 新闻关注 ---------- */
ok((await page.textContent('.home')).includes('新闻关注'), '首页有新闻关注卡');
await openMore('新闻关注');
ok((await page.textContent('.page-head h1')) === '新闻关注', '进入新闻关注页');
ok((await page.$$('.nw-topic')).length === 6, '6 个话题卡');
await page.click('.nw-topic:has-text("澳洲房市")');
await page.waitForTimeout(300);
const links = await page.$$eval('.nw-panel a.btn', (as) => as.map((a) => a.textContent + '|' + a.href));
ok(links.length >= 4 && links[0].includes('baidu.com') && links.every((l) => l.includes('https://')), '一键搜最新：' + links.map((l) => l.split('|')[0]).join(' / '));
await page.screenshot({ path: SHOTS + 'v23-news-topic.png' });

await page.click('#nw-add');
await page.waitForSelector('#nw-title');
await page.fill('#nw-title', '悉尼十月清盘率回升');
await page.fill('#nw-content', '周末清盘率回到 70% 以上');
await page.fill('#nw-source', 'Domain');
await page.click('#nw-save');
await page.waitForTimeout(1500);
let sig = await rowsOf('signals');
const news1 = sig.find((x) => x.title === '悉尼十月清盘率回升');
ok(news1 && news1.source === '关注:au_home · Domain', '收藏存进 signals，带话题标记');
ok(news1 && news1.ai_score === 2 && String(news1.ai_take).includes('对你的投资目标很有利'), '保存后 AI 自动分析');
ok((await page.textContent('.sg-list')).includes('悉尼十月清盘率回升'), '列表里显示');

/* 整页粘贴 → AI 拆条 → 保存 */
await page.click('#nw-add');
await page.waitForSelector('#nw-title');
await page.click('.editor-body .seg button:has-text("整页粘贴")');
await page.fill('#nw-bulk', '澳联储维持利率不变 ABC 2026-10-20 …… 悉尼房价连续第三个月上涨 Domain ……');
await page.click('#nw-parse');
await page.waitForSelector('.nw-pick');
ok((await page.$$('.nw-pick')).length === 2, 'AI 拆出 2 条');
await page.click('#nw-bulk-save');
await page.waitForTimeout(900);
sig = await rowsOf('signals');
ok(sig.filter((x) => String(x.source).startsWith('关注:au_home')).length === 3, '批量收藏 2 条');
/* 同一页再粘一次不翻倍 */
await page.click('#nw-add');
await page.waitForSelector('#nw-title');
await page.click('.editor-body .seg button:has-text("整页粘贴")');
await page.fill('#nw-bulk', '同一页再粘贴一次 ………………');
await page.click('#nw-parse');
await page.waitForSelector('.nw-pick');
await page.click('#nw-bulk-save');
await page.waitForTimeout(900);
sig = await rowsOf('signals');
ok(sig.filter((x) => String(x.source).startsWith('关注:au_home')).length === 3, '重复粘贴同标题不翻倍');

/* 已读、专题简报 */
await page.click('.sg-card button:has-text("✓ 已读")');
await page.waitForTimeout(600);
sig = await rowsOf('signals');
ok(sig.filter((x) => x.status === 'archived').length === 1, '标为已读');
await page.click('#nw-brief');
await page.waitForTimeout(1200);
ok((await page.textContent('.nw-panel')).includes('模拟的 Claude 回答'), 'AI 专题简报生成');
ok(JSON.stringify(await page.evaluate(() => window.__lastSample)).includes('悉尼十月清盘率回升'), '简报带上了收藏的新闻');

/* ---------- 老数据不受影响，新闻不混进利好消息 ---------- */
await openMore('利好消息');
const sgText = await page.textContent('.main');
ok(sgText.includes('老的利好消息'), '老的利好消息还在');
ok(!sgText.includes('悉尼十月清盘率回升'), '新闻不会混进利好消息页');
ok((await rowsOf('signals')).find((x) => x.id === 501)?.content === '原来的内容', '老数据内容一字未改');

/* 转到利好消息 */
await openMore('新闻关注');
await page.click('.chip:has-text("全部")');
await page.click('.seg button:has-text("全部")');
await page.waitForTimeout(300);
await page.click('.sg-card:has-text("悉尼十月清盘率回升") button:has-text("转到利好消息")');
await page.waitForTimeout(700);
ok((await rowsOf('signals')).find((x) => x.title === '悉尼十月清盘率回升')?.source === 'Domain', '转到利好消息后去掉话题标记、保留来源');

/* ---------- 经济与房产顾问带着新闻 ---------- */
await page.click('.chip:has-text("澳洲房市")');
await page.waitForTimeout(300);
await page.click('.nw-panel button:has-text("问经济与房产顾问")');
await page.waitForTimeout(800);
ok((await page.textContent('.page-head h1')).includes('经济与房产顾问'), '打开经济与房产顾问');
await page.fill('#chat-text', '澳洲房市怎么样？');
await page.press('#chat-text', 'Enter');
await page.waitForTimeout(1200);
const sys = JSON.stringify(await page.evaluate(() => window.__lastSample));
ok(sys.includes('澳联储维持利率不变') && sys.includes('不预测具体价格'), '顾问拿到了收藏的新闻和自己的原则');
ok(!(await page.$('#qs-fab')), '专家对话页不显示「＋」，不挡输入框');

console.log('console errors:', errs.length, errs.slice(0, 3));
ok(errs.length === 0, '没有控制台报错');
await browser.close();
console.log(fails ? `✗ ${fails} 项失败` : '全部通过 ✓');
process.exit(fails ? 1 : 0);
