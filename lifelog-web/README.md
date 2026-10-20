# 个人APP（lifelog-web）· 整理版 2.0

日记 + 账单 + 目标/任务 + 圈子人物卡 + 八字命理 的个人 Web 应用。
纯前端，无框架，打包成**一个 HTML 文件**，发布在 claude.ai 上，手机电脑共用一份数据。

## 和旧版（WorkBuddy 版）的区别

| | 旧版 | 整理版 |
|---|---|---|
| 托管 | life-ledger-17434.app.workbuddy.host | claude.ai artifact（私有链接） |
| 登录 | 邮箱 + 密码，邮箱验证码找回 | 邮箱 + 密码，10 分钟无操作自动退出；忘记密码用**邮箱验证码**重设（经你连接的 Gmail 发信），恢复码作备用 |
| 数据 | WorkBuddy 云数据库 | claude.ai 应用数据库，存在 `data/users/<你的id>/` 私有目录，分享链接别人也看不到 |
| AI | WorkBuddy 的 GLM / Kimi / DeepSeek | Claude（用你自己的额度，首次使用会弹授权） |
| 构建 | Vite + npm 依赖 | esbuild 一条命令，产物单文件 |

**搬旧数据**：在旧网站「设置 → 导出数据 → 完整备份 JSON」导出，新应用「设置 → 从备份恢复」选这个文件即可。

## 目录

```
index.html        页面壳（启动画面），构建时把 CSS/JS 内联进来
style.css         全部样式（文件末尾「整理版补丁」是手机适配）
build.mjs         构建脚本 → dist/个人APP.html
src/
  mailer.js       发验证码邮件（Gmail 连接器）
  auth.js         ★ 登录：注册 / 登录 / 邮箱验证码重设 / 恢复码重设 / 改密码 / 闲置退出（PBKDF2 哈希）
  view-login.js   登录界面
  backend.js      ★ 数据后端：Supabase 风格查询 → claude.ai db / 本机 localStorage；AI → Claude
  cloud.js        业务数据函数（日记、账单、待办、目标、人物、生辰…）
  store.js        极简渲染器 h()/render()、全局 state、toast、应用内确认框 ask()/askText()
  main.js         外壳、导航、路由、启动
  ai.js           AI 对话、日记提炼、账单分类
  exporter.js     导出（JSON/CSV/纯文本）
  view-*.js       各页面
  bazi.js astro.js yongshen.js birthplace.js bazi-self.js   命理核心（真太阳时、节气、四柱、大运、喜用神）
test/
  verify-*.mjs    命理核心回归测试（node 直接跑）
  e2e-*.mjs       端到端测试（Playwright，手机尺寸），用 mock-claude.js 模拟 claude.ai 运行时
```

## 构建与测试

```bash
npm install            # 只需要 esbuild 和 playwright（测试用）
npm run build          # → dist/个人APP.html
npm test               # 命理核心：节气 / 日柱 / 夏令时 / 喜用神 / TDZ 检查
npm run e2e            # 端到端：登录/恢复码/闲置退出、男女命、记日记、记账、导入、导出、恢复、AI、删除、刷新持久化
                       # 建议用 http 起服务后设 APP_URL 再跑（file:// 下无头浏览器偶尔会丢 localStorage）
```

`dist/个人APP.html` 直接双击也能用（本机模式：数据存浏览器，AI 不可用）。

## 登录说明（auth.js）

- 第一次打开注册：邮箱 + 密码，同时生成 16 位恢复码（只显示一次，作备用）。
- 忘记密码：给注册邮箱发 6 位验证码（10 分钟有效，错 5 次作废，60 秒内不能重发），通过 claude.ai 连接的 Gmail `send_message` 发出（`src/mailer.js`）。验证码只存哈希。
- 密码和恢复码只存 PBKDF2-SHA256 哈希（加盐、15 万次迭代），在 `data/users/<uid>/auth`。
- 每台设备单独登录；连续 10 分钟无操作自动退出（回到页面时按时间戳补算）。
- 连续输错 5 次锁 30 秒，之后翻倍，最长 15 分钟。
- 这是应用锁，数据本身没有用密码加密。恢复码也丢了：在 Claude 里请它删除 `data/users/me/auth` 这条记录即可重新注册，数据不受影响。

## 八字性别

生辰编辑里必选「男 / 女」；八字页、运势页大运卡右上角也能直接切换。存在本人档案 `self_profile.gender`，与「圈子 → 我」同一字段。决定大运顺排还是逆排（阳年男、阴年女顺排）。

## 存储说明（backend.js）

- 每张表一行一个文档：`data/users/<uid>/t/<表名>/<id>`，多设备同时改不同记录互不覆盖。
- 表在第一次用到时整表拉到内存，之后本地查询；写入同时落库。
- 页面从后台切回来时缓存作废，自动拉最新（手机上改了，电脑切回来就能看到）。
- 上限：每个应用约 25,000 条记录、单条 256KB。账单常年导入的话，几年内都够用。

## 这次修掉的问题

1. **滚动跳顶**：每次重绘都会重建滚动容器，手机上往下翻、勾一个待办，页面就跳回最上面。
2. **记一笔表单手机上没法用**：写死 6 列，商户/金额输入框被挤成一条缝，保存按钮被截掉；且排在三张统计卡下面。
3. **「完整备份」不完整**：只导出 6 张表，人物卡、任务、待办、生辰、八字问答都漏了。现在 14 张表全导出。
4. **启动失败兜底界面自身报错**：把虚拟节点直接 `appendChild`，出错时连错误页都显示不出来。
5. **删除按钮在嵌入页里失灵**：浏览器 `confirm()/prompt()` 在 claude.ai 嵌入页里可能被禁用，改为应用内弹层。
6. **iPhone 输入框点击放大**：输入框字号 < 16px 触发 Safari 自动缩放；`100vh` 被地址栏遮挡底部导航，改用 `100dvh`。
7. 手机上三张统计卡竖排占满一屏 → 改为一行紧凑显示；toast 不再盖住底部导航。
8. 删除了已无用的部分：WorkBuddy SDK、登录/找回密码/自动登出、账号配对码、Service Worker 与缓存自愈、Windows 快捷方式脚本。
