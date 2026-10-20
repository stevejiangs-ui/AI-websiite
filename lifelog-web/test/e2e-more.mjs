import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const ROOT = new URL('..', import.meta.url).pathname;
const APP = process.env.APP_URL || 'file://' + ROOT + 'dist/' + encodeURIComponent('个人APP.html');
const SHOTS = ROOT + 'test/shots/';
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript({ path: ROOT + 'test/mock-claude.js' });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 300)));
const ok = (c, msg) => console.log((c ? '✓ ' : '✗ ') + msg);
const nav = async (label) => { await page.evaluate((l) => [...document.querySelectorAll('.nav-item')].find((x) => x.textContent.trim().endsWith(l)).click(), label); await page.waitForTimeout(600); };
const count = (t) => page.evaluate((t) => Object.keys(window.__mockStore).filter((k) => k.includes('/t/' + t + '/')).length, t);

await page.goto(APP);
// 首次打开：注册账号 → 确认已保存恢复码 → 进入
await page.waitForSelector('#reg-email');
await page.fill('#reg-email', 'test.user@example.com');
await page.fill('#reg-pass', 'secret123');
await page.fill('#reg-pass2', 'secret123');
await page.click('button:has-text("创建并进入")');
await page.waitForSelector('#code-saved');
await page.check('#code-saved');
await page.click('button:has-text("进入应用")');
await page.waitForSelector('.shell');
await page.waitForTimeout(600);

// 记一笔（手机表单）
await nav('账单');
await page.click('text=+ 记一笔');
await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + 'flow2-txform.png' });
const box = await page.locator('input[placeholder="例如 美团"]').boundingBox();
ok(box && box.width > 120, '手机上商户输入框宽度正常（' + Math.round(box?.width) + 'px）');

// 导入 + 去重
await nav('导入');
await page.setInputFiles('#file-input', ROOT + 'test/sample-alipay.csv');
await page.waitForTimeout(1200);
await page.click('button:has-text("确认导入 6 笔")');
await page.waitForTimeout(1500);
const n1 = await count('transactions');
ok(n1 === 6, '导入 6 笔写入云端（' + n1 + '）');
await nav('导入');
await page.setInputFiles('#file-input', ROOT + 'test/sample-alipay.csv');
await page.waitForTimeout(1200);
const confirmBtn = page.locator('button:has-text("确认导入")').first();
if (await confirmBtn.count()) { await confirmBtn.click(); await page.waitForTimeout(1500); }
const n2 = await count('transactions');
ok(n2 === 6, '同一文件再导入不重复（' + n2 + '）');
await nav('导入');
await page.setInputFiles('#file-input', ROOT + 'test/wechat.csv');
await page.waitForTimeout(1200);
await page.screenshot({ path: SHOTS + 'flow2-wechat.png' });
const wbtn = page.locator('button:has-text("确认导入")').first();
if (await wbtn.count()) { await wbtn.click(); await page.waitForTimeout(1500); }
ok((await count('transactions')) > 6, '微信账单导入（共 ' + (await count('transactions')) + ' 笔）');

// 财务页
await nav('财务');
await page.screenshot({ path: SHOTS + 'flow2-finance.png' });

// 生辰 → 运势
await nav('运势');
await page.click('button:has-text("填生辰八字")');
await page.waitForTimeout(400);
for (const [k, v] of [['year', '1990'], ['month', '6'], ['day', '20'], ['hour', '8'], ['minute', '30']]) {
  const el = page.locator('#birth-' + k);
  if (await el.count()) { await el.fill(v); }
}
await page.screenshot({ path: SHOTS + 'flow2-birth.png' });
const city = page.locator('#birth-city');
if (await city.count()) { await city.fill('顺德'); await page.waitForTimeout(400); const opt = page.locator('text=顺德').nth(1); if (await opt.count()) await opt.click().catch(()=>{}); }
await page.click('.editor .seg button:has-text("男")');
await page.locator('.editor button:has-text("保存")').last().click();
await page.waitForTimeout(1200);
ok((await count('birth_info')) === 1, '生辰写入云端');
await page.screenshot({ path: SHOTS + 'flow2-fortune.png' });
ok(await page.isVisible('text=大运'), '运势页显示大运');

await nav('八字');
await page.waitForTimeout(500);
await page.screenshot({ path: SHOTS + 'flow2-bazi.png' });

// 人物卡
await nav('圈子');
await page.click('text=+ 新卡片');
await page.waitForTimeout(400);
await page.locator('.editor input').first().fill('妈妈');
await page.locator('.editor button:has-text("保存")').click();
await page.waitForTimeout(800);
ok((await count('people')) === 1, '人物卡写入云端');

// 目标 + 任务
await nav('目标/任务/日程');
await page.click('text=+ 立个目标');
await page.waitForTimeout(300);
await page.fill('textarea[placeholder^="目标是什么"], input[placeholder^="目标是什么"]', '三个月存 3 万');
await page.click('.editor button:has-text("立下")');
await page.waitForTimeout(800);
ok((await count('goals')) === 1, '目标写入云端');
await page.screenshot({ path: SHOTS + 'flow2-goals.png' });

// 专家
await nav('专家');
await page.screenshot({ path: SHOTS + 'flow2-expert.png' });

// 首页汇总
await nav('首页');
await page.screenshot({ path: SHOTS + 'flow2-home.png', fullPage: false });

console.log('\nconsole errors:', errs.length);
errs.forEach((e) => console.log('  ', e));
await browser.close();
