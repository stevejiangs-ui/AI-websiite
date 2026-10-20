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
const nav = async (label) => { await page.evaluate((l) => [...document.querySelectorAll('.nav-item')].find((x) => x.textContent.trim().endsWith(l)).click(), label); await page.waitForTimeout(500); };
const toastText = () => page.evaluate(() => document.querySelector('.toast')?.textContent || '');
const mockKeys = () => page.evaluate(() => Object.keys(window.__mockStore));

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

// 1. 首页待办
await page.fill('#home-new-todo', '给妈妈打电话');
await page.press('#home-new-todo', 'Enter');
await page.waitForTimeout(600);
ok(await page.isVisible('text=给妈妈打电话'), '首页添加待办');
ok((await mockKeys()).some((k) => k.includes('/t/todos/')), '待办写入云端 db');

// 滚动保持：滚到中间、勾选待办后不应回到顶部
await page.evaluate(() => { document.getElementById('main-scroll').scrollTop = 120; });
const cb = await page.$('.todo-check, input[type=checkbox]');
if (cb) { await cb.click(); await page.waitForTimeout(500); }
const st = await page.evaluate(() => document.getElementById('main-scroll').scrollTop);
ok(st > 0, '勾选待办后滚动位置保持（scrollTop=' + st + '）');

// 2. 日记
await nav('日记');
await page.click('text=+ 写一篇');
await page.waitForSelector('#entry-content');
await page.fill('#entry-title', '平常的一天');
await page.fill('#entry-content', '今天去了公司开会，晚上和小王吃了兰州拉面，花了 18 块。明天要交报告。');
await page.click('text=记下');
await page.waitForTimeout(1500);
await page.screenshot({ path: SHOTS + 'flow-diary.png' });
ok(await page.isVisible('text=平常的一天'), '日记保存并出现在列表');
const sampled = await page.evaluate(() => window.__mockCalls.sample);
ok(sampled > 0, '保存后自动 AI 提炼被调用（sample 次数 ' + sampled + '）');
ok(await page.isVisible('text=今天去了公司，晚上吃了兰州拉面'), '提炼摘要显示');

// 3. 记一笔
await nav('账单');
await page.click('text=+ 记一笔');
await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + 'flow-txform.png' });
await page.fill('input[placeholder="例如 美团"]', '兰州拉面馆');
await page.fill('input[placeholder="0.00"]', '18');
await page.click('.card button:has-text("保存")');
await page.waitForTimeout(800);
ok(await page.isVisible('text=兰州拉面馆'), '手工记账出现在列表');
ok((await page.textContent('.main')).includes('18.00'), '金额统计 18.00');

// 4. 导入账单 CSV
await nav('导入');
const fi = await page.$('#file-input');
await fi.setInputFiles([ROOT + 'test/sample-alipay.csv']);
await page.waitForTimeout(1500);
await page.screenshot({ path: SHOTS + 'flow-import.png', fullPage: false });
const importBtn = await page.$('button:has-text("导入")>>nth=-1');
const btns = await page.$$eval('button', (bs) => bs.map((b) => b.textContent.trim()).filter((t) => /导入|确认|入库/.test(t)));
console.log('   导入页按钮：', btns.join(' | '));

// 5. 设置导出
await nav('设置');
await page.click('text=完整备份 JSON');
await page.waitForTimeout(1500);
const saves = await page.evaluate(() => window.__mockCalls.save.map((s) => s.filename + ' ' + s.size));
ok(saves.length === 1, '导出走 downloads 能力：' + saves.join(','));
const backup = await page.evaluate(() => window.__mockCalls.save[0]?.text || '');
const b = backup ? JSON.parse(backup) : null;
ok(b && b.data.entries.length === 1 && b.data.todos.length >= 1, '备份包含日记/待办（所有表：' + (b ? Object.keys(b.data).length : 0) + ' 张）');

// 6. 删除日记（应用内确认框）
await nav('日记');
await page.click('text=平常的一天');
await page.waitForTimeout(400);
const delBtn = await page.$('.editor button:has-text("删除")');
if (delBtn) {
  await delBtn.click();
  await page.waitForSelector('.dlg');
  ok(true, '删除弹出应用内确认框');
  await page.click('.dlg button:has-text("确定")');
  await page.waitForTimeout(800);
  ok(!(await page.isVisible('text=平常的一天')), '日记已删除');
} else ok(false, '找不到日记删除按钮');

// 7. 从备份恢复
await nav('设置');
const fs = await import('node:fs');
fs.writeFileSync(SHOTS + 'backup.json', backup);
await page.setInputFiles('input[type=file][accept*="json"]', SHOTS + 'backup.json');
await page.waitForSelector('.dlg');
await page.click('.dlg button:has-text("开始恢复")');
await page.waitForTimeout(1500);
ok((await page.textContent('.main')).includes('恢复完成'), '恢复备份完成');
await nav('日记');
ok(await page.isVisible('text=平常的一天'), '恢复后日记回来了');

// 8. 问问账本
await nav('问问账本');
await page.fill('#chat-text', '这个月花了多少钱？');
await page.press('#chat-text', 'Enter');
await page.waitForTimeout(1500);
ok((await page.textContent('#chat-log')).includes('模拟的 Claude 回答'), 'AI 对话流式回答显示');

// 9. 刷新后数据仍在（从云端 db 重新读取）
await page.reload();
await page.waitForSelector('.shell');
await page.waitForTimeout(800);
await nav('账单');
ok(await page.isVisible('text=兰州拉面馆'), '刷新后账单仍在（云端读取）');

console.log('\nconsole errors:', errs.length);
errs.forEach((e) => console.log('  ', e));
await browser.close();
