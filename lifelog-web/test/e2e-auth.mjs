/* 登录 / 恢复码 / 闲置退出 / 男女命 端到端测试 */
import { chromium } from 'playwright';
const ROOT = new URL('..', import.meta.url).pathname;
const APP = process.env.APP_URL || 'file://' + ROOT + 'dist/' + encodeURIComponent('个人APP.html');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript({ path: ROOT + 'test/mock-claude.js' });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? '✓ ' : '✗ ') + msg); };
const nav = async (l) => { await page.evaluate((l) => [...document.querySelectorAll('.nav-item')].find((x) => x.textContent.trim().endsWith(l)).click(), l); await page.waitForTimeout(600); };
const errText = () => page.evaluate(() => document.querySelector('.login-card .err')?.textContent || '');

await page.goto(APP);
await page.waitForSelector('#reg-email');
ok(true, '首次打开显示「创建账号」');
await page.fill('#reg-email', 'Test.User@Example.com');
await page.fill('#reg-pass', 'abc');
await page.fill('#reg-pass2', 'abc');
await page.click('button:has-text("创建并进入")');
await page.waitForTimeout(200);
ok((await errText()).includes('至少 6 位'), '密码太短被拦下');
await page.fill('#reg-pass', 'secret123');
await page.fill('#reg-pass2', 'secret123');
await page.click('button:has-text("创建并进入")');
await page.waitForSelector('#recovery-code');
const code = (await page.textContent('#recovery-code')).trim();
ok(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(code), '显示恢复码 ' + code);
ok(await page.isDisabled('button:has-text("进入应用")'), '未勾「已保存」不能进入');
await page.check('#code-saved');
await page.click('button:has-text("进入应用")');
await page.waitForSelector('.shell');
ok(true, '注册后进入应用');
const stored = await page.evaluate(() => JSON.stringify(window.__mockStore['data/users/user_test123/auth'] || {}));
ok(stored.includes('"hash"') && !stored.includes('secret123') && !stored.includes(code), '云端只存哈希，不存明文密码和恢复码');

await page.reload();
await page.waitForSelector('.shell');
ok(true, '刷新后保持登录');

// 退出
await nav('设置');
await page.click('button:has-text("退出登录")');
await page.waitForSelector('#login-email');
ok((await page.inputValue('#login-email')) === 'test.user@example.com', '退出后回到登录页，邮箱已填好');
await page.fill('#login-pass', 'wrongpass');
await page.click('.login-card button:has-text("登录")');
await page.waitForTimeout(800);
ok((await errText()).includes('邮箱或密码不对'), '密码错误提示');
await page.fill('#login-pass', 'secret123');
await page.click('.login-card button:has-text("登录")');
await page.waitForSelector('.shell');
ok(true, '正确密码登录成功');

// 闲置 10 分钟
await page.evaluate(() => localStorage.setItem('lifelog.active.v1', String(Date.now() - 11 * 60 * 1000)));
await page.reload();
await page.waitForSelector('#login-email');
ok((await page.textContent('.login-card')).includes('自动退出'), '超过 10 分钟没操作自动退出并提示');

// 忘记密码
await page.click('button:has-text("忘记密码？")');
await page.fill('#rec-email', 'test.user@example.com');
await page.fill('#rec-code', 'AAAA-BBBB-CCCC-DDDD');
await page.fill('#rec-pass', 'newpass456');
await page.fill('#rec-pass2', 'newpass456');
await page.click('button:has-text("重设密码并登录")');
await page.waitForTimeout(900);
ok((await errText()).includes('恢复码不对'), '错误恢复码被拒');
await page.fill('#rec-code', code.toLowerCase().replace(/-/g, ' '));
await page.click('button:has-text("重设密码并登录")');
await page.waitForSelector('#recovery-code');
const code2 = (await page.textContent('#recovery-code')).trim();
ok(code2 !== code, '重设成功并换了新恢复码');
await page.check('#code-saved');
await page.click('button:has-text("进入应用")');
await page.waitForSelector('.shell');
await nav('设置');
await page.click('button:has-text("退出登录")');
await page.waitForSelector('#login-email');
await page.fill('#login-pass', 'secret123');
await page.click('.login-card button:has-text("登录")');
await page.waitForTimeout(800);
ok((await errText()).includes('不对'), '旧密码失效');
await page.fill('#login-pass', 'newpass456');
await page.click('.login-card button:has-text("登录")');
await page.waitForSelector('.shell');
ok(true, '新密码登录成功');

// 设置里改密码
await nav('设置');
await page.click('button:has-text("修改密码")');
await page.fill('#sec-old', 'newpass456');
await page.fill('#sec-p1', 'third789');
await page.fill('#sec-p2', 'third789');
await page.click('button:has-text("保存新密码")');
await page.waitForTimeout(900);
ok((await page.textContent('.toast')).includes('密码已更新'), '设置页修改密码');

// 男 / 女命
await nav('运势');
await page.click('button:has-text("填生辰八字")');
await page.fill('#birth-year', '1990');
await page.waitForTimeout(80);
await page.fill('#birth-month', '6');
await page.waitForTimeout(80);
await page.fill('#birth-day', '20');
await page.waitForTimeout(80);
await page.locator('.editor button:has-text("保存")').last().click();
await page.waitForTimeout(300);
ok((await page.textContent('.editor')).includes('请选择性别'), '没选性别不能保存生辰');
await page.click('.editor .seg button:has-text("男")');
await page.locator('.editor button:has-text("保存")').last().click();
await page.waitForTimeout(1200);
const male = await page.textContent('.main');
ok(/顺排/.test(male) && male.includes('按男命顺排'), '男命：1990 庚午阳年 → 顺排');
await page.click('.card .seg button:has-text("女")');
await page.waitForTimeout(1200);
const female = await page.textContent('.main');
ok(/逆排/.test(female) && female.includes('按女命逆排'), '切到女命 → 逆排');
await nav('八字');
ok(await page.isVisible('.card .seg button.on:has-text("女")'), '八字页显示当前为女命');
const sp = await page.evaluate(() => JSON.stringify(Object.entries(window.__mockStore).find(([k]) => k.includes('/t/self_profile/'))?.[1] || {}));
ok(sp.includes('"gender":"女"'), '性别存进本人档案');

console.log('\nconsole errors:', errs.length, errs.slice(0, 5));
await browser.close();
process.exit(fails ? 1 : 0);
