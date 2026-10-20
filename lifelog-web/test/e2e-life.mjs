/* 2.2 新功能端到端（claude.ai 版 + 模拟运行时）：一句话记、今日建议、六大板块、
   身体健康、穿搭形象、利好消息、家人提醒 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const ROOT = new URL('..', import.meta.url).pathname;
const APP = process.env.APP_URL || 'file://' + ROOT + 'dist/' + encodeURIComponent('个人APP.html');
const SHOTS = ROOT + 'test/shots/';
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript({ path: ROOT + 'test/mock-claude.js' });
/* 预置一位家人：3 天后生日、很久没联系 */
await ctx.addInitScript(() => {
  if (window.__seeded) return;
  window.__seeded = true;
  const d = new Date();
  d.setDate(d.getDate() + 3);
  const p = (n) => String(n).padStart(2, '0');
  const bd = `1960-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const key = 'data/users/user_test123/t/people/101';
  if (window.__mockStore && !window.__mockStore[key]) {
    window.__mockStore[key] = { id: 101, owner_id: 'user_test123', name: '妈妈', relation: 'family', relation_label: '母亲', birthday: bd, last_contact: '2026-09-01', closeness: 5 };
  }
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? '✓ ' : '✗ ') + msg); };
const nav = async (l) => { await page.evaluate((l) => [...document.querySelectorAll('.nav-item')].find((x) => x.textContent.trim().endsWith(l)).click(), l); await page.waitForTimeout(700); };
const count = (t) => page.evaluate((t) => Object.keys(window.__mockStore).filter((k) => k.includes('/t/' + t + '/')).length, t);

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
await page.waitForTimeout(800);
await page.screenshot({ path: SHOTS + 'life-home.png' });
const pill = await page.$$eval('.pillar .pillar-t', (els) => els.map((e) => e.textContent));
ok(pill.join(',') === '财富,家庭,开心,健康,形象,利好消息', '首页六大板块：' + pill.join(' / '));
ok((await page.textContent('.main')).includes('妈妈') && (await page.textContent('.main')).includes('3 天后生日'), '家人提醒：妈妈 3 天后生日');
await page.click('.fam-line button:has-text("今天联系了")');
await page.waitForTimeout(800);
const mom = await page.evaluate(() => window.__mockStore['data/users/user_test123/t/people/101']);
ok(mom.last_contact === new Date().toLocaleDateString('sv'), '点「今天联系了」更新联系日期');

// 一句话记
await page.fill('#quick-text', '今天陪家人吃了顿好饭，很开心，花了 300 块');
await page.click('#quick-save');
await page.waitForTimeout(1800);
const entries = await page.evaluate(() => Object.entries(window.__mockStore).filter(([k]) => k.includes('/t/entries/')).map(([, v]) => v));
ok(entries.length === 1 && entries[0].content.includes('陪家人'), '一句话记存成一篇记录');
ok(entries[0] && Array.isArray(entries[0].facets) && entries[0].facets.includes('joy'), 'AI 自动归类：' + JSON.stringify(entries[0]?.facets));
ok(!!entries[0]?.summary, '归类后摘要没有被覆盖');
ok((await page.textContent('.pillar-grid')).includes('开心事'), '开心板块统计到开心事');

// 今日建议
await page.click('#brief-btn');
await page.waitForTimeout(1200);
ok((await page.textContent('.brief-card')).includes('模拟的 Claude 回答'), '今日建议生成');
const briefPrompt = await page.evaluate(() => JSON.stringify(window.__lastSample));
ok(briefPrompt.includes('妈妈') && briefPrompt.includes('本月收支'), '今日建议带上了家人、收支等数据');

// 板块跳转
await page.click('.pillar:has-text("健康")');
await page.waitForSelector('#hl-sleep');
ok(true, '点健康板块进入「身体健康」');

// 健康打卡
await page.click('.hl-scale >> nth=0 >> .hl-pick >> nth=3');
await page.fill('#hl-sleep', '7.5');
await page.fill('#hl-weight', '70.2');
await page.fill('#hl-ex', '40');
await page.click('button:has-text("打卡")');
await page.waitForTimeout(900);
const hl = await page.evaluate(() => Object.entries(window.__mockStore).filter(([k]) => k.includes('/t/health_logs/')).map(([, v]) => v));
ok(hl.length === 1 && hl[0].sleep_hours === 7.5 && hl[0].mood === 4 && hl[0].weight_kg === 70.2, '健康打卡写入：睡 7.5h 心情 4 体重 70.2');
await page.fill('#hl-sleep', '8');
await page.click('button:has-text("更新这天的打卡")');
await page.waitForTimeout(900);
ok((await count('health_logs')) === 1, '同一天再打卡是更新，不重复');
await page.click('button:has-text("看看我的状态")');
await page.waitForTimeout(1200);
ok((await page.textContent('.main')).includes('模拟的 Claude 回答'), 'AI 健康建议');
await page.screenshot({ path: SHOTS + 'life-health.png' });

// 穿搭
await nav('穿搭形象');
await page.click('button:has-text("+ 记一套")');
await page.setInputFiles('#lk-file', ROOT + 'public/icon-512.png');
await page.waitForSelector('.lk-photo img');
await page.click('.editor .chip:has-text("见客户")');
await page.fill('#lk-title', '白衬衫 + 深蓝西裤');
await page.click('.editor button:has-text("保存")');
await page.waitForTimeout(900);
const looks = await page.evaluate(() => Object.entries(window.__mockStore).filter(([k]) => k.includes('/t/looks/')).map(([, v]) => v));
ok(looks.length === 1 && looks[0].url.startsWith('data:image/jpeg') && looks[0].url.length < 200000, '穿搭照片压缩后保存（' + Math.round((looks[0]?.url.length || 0) / 1024) + 'KB）');
ok(looks[0]?.tags.includes('见客户'), '场合标签保存');
await page.click('.card .chip:has-text("约会")');
await page.click('button:has-text("让 AI 给建议")');
await page.waitForTimeout(1200);
ok((await page.textContent('.main')).includes('模拟的 Claude 回答'), 'AI 穿搭建议');
await page.screenshot({ path: SHOTS + 'life-looks.png' });

// 利好消息
await nav('利好消息');
await page.click('button:has-text("+ 存一条")');
await page.fill('#sg-title', '悉尼西区新地铁站规划公布');
await page.fill('#sg-content', '州政府宣布 2027 年动工……附近物业预计受益。');
await page.click('.editor button:has-text("保存")');
await page.waitForTimeout(2000);
const sg = await page.evaluate(() => Object.entries(window.__mockStore).filter(([k]) => k.includes('/t/signals/')).map(([, v]) => v));
ok(sg.length === 1 && sg[0].ai_score === 2 && sg[0].ai_take.includes('行动'), 'AI 分析利好消息：很有利 + 行动建议');
ok(await page.isVisible('.sg-score.good2'), '显示「很有利」标记');
await page.screenshot({ path: SHOTS + 'life-signals.png' });
await page.click('button:has-text("✓ 已行动")');
await page.waitForTimeout(800);
ok((await page.evaluate(() => Object.entries(window.__mockStore).find(([k]) => k.includes('/t/signals/'))[1].status)) === 'acted', '标记已行动');

// 回首页看板块更新
await nav('首页');
await page.waitForTimeout(1200);
const ptxt = await page.textContent('.pillar-grid');
ok(ptxt.includes('今天已打卡') && ptxt.includes('白衬衫'), '首页板块同步：已打卡、最近穿搭');
await page.screenshot({ path: SHOTS + 'life-home2.png', fullPage: false });

// 手机底栏
const tabs = await page.$$eval('.mobile-nav button', (b) => b.map((x) => x.textContent.trim()));
ok(tabs.join('|').includes('财富') && tabs.join('|').includes('身心'), '手机底栏：' + tabs.join(' / '));

console.log('\nconsole errors:', errs.length, errs.slice(0, 5));
await browser.close();
process.exit(fails ? 1 : 0);
