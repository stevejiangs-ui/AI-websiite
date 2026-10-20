/* WorkBuddy 版端到端（模拟 SDK）：先 node test/build-wb-test.mjs，再用 http 服务 test/wb-dist/ 跑
   WB_URL=http://127.0.0.1:8766/index.html node test/e2e-wb.mjs */
import { chromium } from 'playwright';
const ROOT = new URL('..', import.meta.url).pathname;
const APP = process.env.WB_URL || 'file://' + ROOT + 'test/wb-dist/index.html';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? '✓ ' : '✗ ') + msg); };
const nav = async (l) => { await page.evaluate((l) => [...document.querySelectorAll('.nav-item')].find((x) => x.textContent.trim().endsWith(l)).click(), l); await page.waitForTimeout(600); };
const errText = () => page.evaluate(() => document.querySelector('.login-card .err')?.textContent || '');
const shot = (n) => import('node:fs').then((fs) => { fs.mkdirSync(ROOT + 'test/shots', { recursive: true }); return page.screenshot({ path: ROOT + 'test/shots/' + n + '.png' }); });

await page.goto(APP);
await page.waitForSelector('#login-email');
ok(!(await page.isVisible('#reg-email')), '直接显示登录页（不需要 claude.ai，不显示注册）');
ok((await page.textContent('.login-card')).includes('WorkBuddy 账号'), '提示用 WorkBuddy 账号登录');
await shot('wb-login');
await page.fill('#login-email', 'test.user@example.com');
await page.fill('#login-pass', 'wrong');
await page.click('.login-card button:has-text("登录")');
await page.waitForTimeout(500);
ok((await errText()).includes('邮箱或密码不对'), '密码错误提示');

// 忘记密码：WorkBuddy 发邮箱验证码
await page.click('button:has-text("忘记密码？")');
await page.waitForSelector('#send-code');
ok(!(await page.isVisible('.seg button:has-text("恢复码")')), 'WorkBuddy 版没有恢复码选项');
await page.fill('#rec-email', 'test.user@example.com');
await page.click('#send-code');
await page.waitForSelector('#rec-otp');
const mail = await page.evaluate(() => window.__wbMail[0]);
ok(mail && mail.email === 'test.user@example.com', 'WorkBuddy 给邮箱发了验证码');
await shot('wb-recover');
await page.fill('#rec-otp', mail.code === '123456' ? '654321' : '123456');
await page.fill('#rec-pass', 'newpass456');
await page.fill('#rec-pass2', 'newpass456');
await page.click('button:has-text("重设密码并登录")');
await page.waitForTimeout(600);
ok((await errText()).includes('验证码不对'), '错误验证码被拒');
await page.fill('#rec-otp', mail.code);
await page.click('button:has-text("重设密码并登录")');
await page.waitForSelector('.shell');
ok(true, '验证码正确 → 改密码并直接进入');

// 数据读写
await nav('记录');
await page.click('text=+ 写一篇');
await page.fill('#entry-content', '今天在国内打开个人APP，记一笔日记，晚上吃兰州拉面。');
await page.click('text=记下');
await page.waitForTimeout(1500);
ok(await page.isVisible('text=今天去了公司，晚上吃了兰州拉面'), '日记保存 + 国产模型提炼');
const models = await page.evaluate(() => window.__wbLLM || []);
ok(models.some((m) => /^glm/.test(m)), 'AI 用的是 WorkBuddy 模型：' + [...new Set(models)].join(','));
await nav('账单');
await page.click('text=+ 记一笔');
await page.fill('input[placeholder="例如 美团"]', '兰州拉面馆');
await page.fill('input[placeholder="0.00"]', '18');
await page.click('.card button:has-text("保存")');
await page.waitForTimeout(800);
ok(await page.isVisible('text=兰州拉面馆'), '记账保存');
const ownerOk = await page.evaluate(() => (JSON.parse(localStorage.getItem('lifelog.local.v1.transactions') || '[]')[0] || {}).owner_id === 'u_wb_1');
ok(ownerOk, '写入带正确的 owner_id（WorkBuddy 账号 id）');

// 设置页
await nav('设置');
const st = await page.textContent('.main');
ok(st.includes('life-ledger-17434.app.workbuddy.host') && st.includes('微信'), '设置页显示国内网址和微信用法');
ok(st.includes('WorkBuddy（腾讯）云数据库') && !st.includes('恢复码'), '存储说明正确，没有恢复码');
await shot('wb-settings');

// 刷新保持登录；闲置 10 分钟退出
await page.reload();
await page.waitForSelector('.shell');
ok(true, '刷新后保持登录');
await page.evaluate(() => localStorage.setItem('lifelog.active.v1', String(Date.now() - 11 * 60 * 1000)));
await page.reload();
await page.waitForSelector('#login-email');
ok((await page.textContent('.login-card')).includes('自动退出'), '闲置超过 10 分钟自动退出');
ok((await page.evaluate(() => localStorage.getItem('wbmock.session'))) === null, '同时退出了 WorkBuddy 云端会话');
await page.fill('#login-pass', 'newpass456');
await page.click('.login-card button:has-text("登录")');
await page.waitForSelector('.shell');
ok(true, '新密码登录成功');

// 新功能在 WorkBuddy 上：表已建 → 正常；表未建 → 显示建表提示，不报错
await nav('身体健康');
await page.waitForSelector('#hl-sleep');
ok(true, '身体健康页正常（表已建时）');
await page.evaluate(() => { window.__noNewTables = true; });
await nav('利好消息');
await page.waitForTimeout(800);
ok((await page.textContent('.main')).includes('还差一步') && (await page.textContent('.main')).includes('migrations/'), '表未建时显示建表提示');
await nav('首页');
await page.waitForTimeout(1200);
ok((await page.textContent('.pillar-grid')).includes('待开通'), '首页板块显示「待开通」，其它照常');
await page.evaluate(() => { window.__noNewTables = false; });

// 退出按钮
await nav('设置');
await page.click('button:has-text("退出登录")');
await page.waitForSelector('#login-email');
ok((await page.inputValue('#login-email')) === 'test.user@example.com', '退出后回到登录页，邮箱已填好');

console.log('\nconsole errors:', errs.length, errs.slice(0, 5));
await browser.close();
process.exit(fails ? 1 : 0);
