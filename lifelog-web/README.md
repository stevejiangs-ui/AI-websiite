# 个人APP（lifelog-web）· 2.1

日记 + 账单 + 目标/任务 + 圈子人物卡 + 八字命理 的个人 Web 应用。纯前端，无框架。
**同一份代码，两个构建目标：**

| | WorkBuddy 版（主用，国内可用） | claude.ai 版 |
|---|---|---|
| 网址 | https://life-ledger-17434.app.workbuddy.host/ | claude.ai 上的私有 Artifact |
| 国内访问 | ✅ 直接打开，不用翻墙 | ❌ |
| 登录 | WorkBuddy 账号的邮箱 + 密码 | 应用内注册的邮箱 + 密码 |
| 忘记密码 | WorkBuddy 发邮箱验证码 | Gmail 发邮箱验证码 / 恢复码 |
| 数据 | WorkBuddy（腾讯）云数据库（原来的数据都在） | claude.ai 应用数据库 |
| AI | WorkBuddy 国产模型（GLM / Kimi / DeepSeek…） | Claude |
| 构建 | `npm run build:wb`（Vite） | `node build.mjs`（esbuild，单文件） |

两个版本的数据**不互通**。

## 发布 WorkBuddy 版（在你的电脑上）

1. 把这个文件夹放回原来的 WorkBuddy 项目位置（例如 `C:\Users\86138\WorkBuddy\...\lifelog-web\`），覆盖旧文件。
   - 旧的 `node_modules/` 可以保留；没有的话脚本会自动 `npm install`。
2. 双击 **`同步.bat`**（或终端运行 `bash sync.sh`）。它会：构建 → Service Worker 版本号 +1 → 同步到 `web/`。
3. 回到 WorkBuddy 说一句 **「发布一下」**。
4. 手机 Safari 打开 https://life-ledger-17434.app.workbuddy.host/ → 分享 → 添加到主屏幕。

> 构建需要 WorkBuddy 的云 SDK（`@tencent-ai/workbuddy-cloud-sdk`），在 WorkBuddy 环境里 `npm install` 能装上。

## 目录

```
index.html              页面壳（两个构建共用）
style.css               全部样式（末尾「整理版补丁」是手机适配）
vite.config.js          WorkBuddy 版构建：@platform → platform-workbuddy.js
build.mjs               claude.ai 版构建：@platform → platform-claude.js，输出单文件
sync.sh / 同步.bat      WorkBuddy 一键构建并同步到 web/
public/                 PWA：manifest、图标、sw.js（页面网络优先，不会卡旧版）
src/
  platform-workbuddy.js ★ WorkBuddy：SDK 数据库 / 登录 / 验证码找回 / 国产 AI
  platform-claude.js    ★ claude.ai：backend.js + auth.js + mailer.js
  publicConfig.js       WorkBuddy 公开配置（endpoint、publishable key）
  session.js            本机会话、10 分钟闲置退出、输错限流（两版共用）
  backend.js            claude.ai 数据层（Supabase 风格查询 → 应用数据库 / localStorage）
  auth.js / mailer.js   claude.ai 版的注册登录 / Gmail 发验证码
  cloud.js              业务数据函数（日记、账单、待办、目标、人物、生辰…）
  store.js              渲染器 h()/render()、state、toast、应用内确认框
  main.js               外壳、导航、启动、闲置退出
  view-login.js         登录 / 找回密码界面（按平台显示功能）
  view-*.js             各页面
  ai.js                 AI 对话、日记提炼、账单分类（按平台自动选模型）
  bazi.js astro.js yongshen.js birthplace.js bazi-self.js   命理核心
test/
  verify-*.mjs          命理核心回归测试
  e2e-wb.mjs            WorkBuddy 版端到端（mock-workbuddy-sdk.js 模拟 SDK）
  e2e-auth/basic/more   claude.ai 版端到端（mock-claude.js 模拟运行时）
```

## 测试

```bash
npm test        # 命理核心：节气 / 日柱 / 夏令时 / 喜用神 / TDZ
npm run e2e     # 两个版本的端到端（建议 http 起服务后设 APP_URL / WB_URL 再跑）
```

## 登录说明

- 每台设备单独登录；连续 10 分钟无操作自动退出（回到页面时按时间戳补算）。
- WorkBuddy 版：账号就是原来的 WorkBuddy 账号；忘记密码 → WorkBuddy 发 6 位验证码到邮箱 → 设新密码后直接登录。
- claude.ai 版：首次在应用里注册；密码与恢复码只存 PBKDF2 哈希；忘记密码用 Gmail 验证码或恢复码。

## 八字性别

生辰编辑里必选「男 / 女」；八字页、运势页大运卡右上角可直接切换。存在本人档案 `self_profile.gender`，决定大运顺排还是逆排（阳年男、阴年女顺排）。

## 这次整理修掉的问题

1. 滚动跳顶：每次重绘重建滚动容器，手机上勾一个待办页面就跳回顶部。
2. 记一笔表单在手机上被挤成一条缝，保存按钮被截掉。
3. 生辰输入快速切格时，数字落进上一格（如月份变成 620）。
4. 「完整备份」只导出 6 张表，人物卡、任务、待办、生辰、八字问答漏掉。现在 14 张全导出。
5. 启动失败的兜底界面自身报错，错误页显示不出来。
6. iPhone 输入框点击自动放大、底部导航被地址栏遮挡。
7. 手机上三张统计卡竖排占满一屏；toast 盖住底部导航。
