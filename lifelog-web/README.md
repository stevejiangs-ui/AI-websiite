# 个人APP（lifelog-web）· 2.2

围绕 **发财、家庭幸福、开心、身体健康、形象得体** 的个人人生仪表盘：记录所有小事、管钱、照顾家人、健康打卡、穿搭相册、收集对自己有利的外部消息，再加上八字命理和 AI 顾问。纯前端，无框架。

## 功能地图

| 板块 | 页面 | 做什么 |
|---|---|---|
| 首页 | 仪表盘 | 一句话记（AI 自动归类）、今日建议（综合全部数据 + 八字）、六大板块状态、家人提醒、待办、目标 |
| 记录 | 记录 / 目标任务 / 工作与生活 | 日记（AI 提炼要点、待办、人物、花销，自动归类到板块）、目标与日程 |
| 财富 | 财富总览 / 账单 / 导入 / 利好消息 | 收支、预算、净资产；支付宝/微信账单导入；外部机会收集 + AI 判断利弊与行动 |
| 家庭 | 家人与圈子 | 人物卡；首页提醒家人生日、多久没联系，一键「今天联系了」 |
| 身心 | 身体健康 / 穿搭形象 | 每日打卡（心情、精力、睡眠、体重、运动、步数、喝水）+ 30 天趋势 + AI 建议；穿搭拍照相册 + 按场合和幸运色的 AI 穿搭建议 |
| 命理 | 八字 / 运势 | 排盘、喜用神、大运流年（男女命）、每日运势 |
| AI | 问问账本 / 专家 | 带着你的真实数据回答 |

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

0. **2.2 首次发布前建表一次**：把 `migrations/2026-10-21-health-signals.sql` 发给 WorkBuddy，说「按这个文件建表，权限规则和 entries 表一样」。
   没建表也能发布：身体健康、利好消息两个页面会显示建表提示，其它功能照常。
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
migrations/             WorkBuddy 新表的建表 SQL（health_logs、signals）
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
  view-home.js          首页仪表盘：一句话记、今日建议、六大板块、家人提醒
  view-health.js        身体健康打卡 + 趋势 + AI 建议
  view-looks.js         穿搭形象相册（照片前端压缩）+ AI 穿搭建议
  view-signals.js       利好消息收集 + AI 利弊分析
  lucky.js              从八字推今天的喜用五行、幸运色、方位
  view-*.js             其它页面
  ai.js                 AI 对话、日记提炼、账单分类（按平台自动选模型）
  bazi.js astro.js yongshen.js birthplace.js bazi-self.js   命理核心
test/
  verify-*.mjs          命理核心回归测试
  e2e-wb.mjs            WorkBuddy 版端到端（mock-workbuddy-sdk.js 模拟 SDK）
  e2e-auth/basic/more   claude.ai 版端到端（mock-claude.js 模拟运行时）
  e2e-life.mjs          2.2 新功能端到端（仪表盘、健康、穿搭、利好消息、家人提醒）
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

0. 首页磁贴和统计卡点了只报「操作失败」：它们从 main.js 动态导入了一个没导出的 go()。现在用事件跳转。
1. 滚动跳顶：每次重绘重建滚动容器，手机上勾一个待办页面就跳回顶部。
2. 记一笔表单在手机上被挤成一条缝，保存按钮被截掉。
3. 生辰输入快速切格时，数字落进上一格（如月份变成 620）。
4. 「完整备份」只导出 6 张表，人物卡、任务、待办、生辰、八字问答漏掉。现在 14 张全导出。
5. 启动失败的兜底界面自身报错，错误页显示不出来。
6. iPhone 输入框点击自动放大、底部导航被地址栏遮挡。
7. 手机上三张统计卡竖排占满一屏；toast 盖住底部导航。
