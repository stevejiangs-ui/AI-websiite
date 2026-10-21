# 个人APP（lifelog-web）· 2.3

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
| 资讯 | 新闻关注 | 广东长江食品、台山长江食品、伦教长江中心、澳洲经济、美国经济、澳洲房市：一键搜最新 + 收藏 + AI 解读 |
| AI | 问问账本 / 专家（9 位） | 带着你的真实数据回答 |
| 全局 | 右下角「＋ 记消费」 | 任何页面 3 秒记一笔花销 |

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

## 消费记录与多格式导入（2026-10-21 新增）

侧栏「消费记录」取代了原来的「档案」页，两个标签：

- **记录**：按月 / 全部时间看支出、收入、结余，分类占比条，逐笔明细；可导出 CSV（Excel 直接开）、Markdown，或整份生活档案（经历 + 行程 + 消费）。
- **导入**：和「账单」页共用同一个导入器（`src/view-import.js` 的 `importBody()`）。

支持的导入格式与实现：

| 格式 | 怎么读 | 代码 |
|---|---|---|
| `.xlsx` | 解 zip → `sharedStrings.xml` + `sheet1.xml` | `src/importer.js` |
| `.csv` | 自动识别 UTF-8 / GBK，按表头找日期与金额列 | `src/importer.js` |
| `.docx` | 解 zip → `word/document.xml` → 剥标签取正文 | `src/doc-extract.js` |
| `.pdf` | 扫 `stream`，`FlateDecode` 用 `DecompressionStream('deflate')` 解压，再按 BT/ET、Tj、TJ 抽文字 | `src/doc-extract.js` |
| `.txt` / `.md` | 直接读文本 | `src/doc-extract.js` |

Excel / CSV 有固定表头，直接结构化解析；Word / PDF / 文本没有表头，先抠文字，
再交给 AI（`askJSON`）认成「日期 + 商户 + 金额 + 方向 + 分类」，**预览确认后才写库**。

读不出来的情况会明确提示，不会静默导入 0 条：
- 旧版 `.doc` / `.wps` 是二进制格式，浏览器解不了 → 提示另存为 `.docx`
- 扫描版 PDF 没有文字层，或字体做了子集编码 → 提示转成表格或手工粘贴

导入去重：`transactions` 表上 `(owner_id, raw_hash)` 唯一，`raw_hash` 由
`cloud.txRawHash()` 生成；重复导入同一份文件不会翻倍。

## 目录补充（2026-10-21）

```
src/view-records.js   消费记录页（记录 / 导入两个标签）
src/view-import.js    导入器（账单页与消费记录页共用）
src/doc-extract.js    docx / pdf / txt 文字提取
src/archive-doc.js    生活档案文档生成（纯函数，可直接 node 跑）
migrations/           建表 SQL（health_logs、signals）
test/verify-archive.mjs   档案文档生成 32 项
test/verify-extract.mjs   docx / pdf / 文本提取 24 项
```

## 数据库新增（2026-10-21）

`migrations/2026-10-21-health-signals.sql` 里的 DDL 是按标准 Postgres 写的，
**在 WorkBuddy 云数据库上要改两处**才能用：`owner_id` 是 `text`（不是 uuid），
权限策略要跟 `entries` 一致（`owner_id = auth.uid() OR owner_id = app.data_owner()`）。
已按这个约定建好 `health_logs` 与 `signals` 两张表。

## 2.3 更新（2026-10-22）

**升级不用建表、不用迁移，老数据一条不动。** 直接覆盖文件 → 双击 `同步.bat` → 在 WorkBuddy 说「发布一下」。

### 1. 快速记消费（右下角「＋」）

- 任何页面右下角都有「＋」（电脑上是「＋ 记消费」），首页顶部也有「今天花了 ¥X · ＋记消费」，「更多」里第一个也是它。
- 输金额 → 点分类（餐饮 / 买菜 / 交通 / 购物 / 娱乐 / 医疗 / 人情 / 住房，更多分类可展开）→ 保存。商家、日期选填；
  不选分类按商家自动归类，只填金额就归「其他」。弹层里显示「今天已花 / 本月已花」。
- 写进原来的 `transactions` 表（`source = manual`），和账单页「记一笔」同一条路：账单、财富总览、消费记录、首页都能看到，保存后当前页自动刷新。
- 聊天、专家页底部有输入框，那里不显示「＋」。代码：`src/quick-spend.js`。

### 2. 新闻关注（侧栏「财富」组 /「更多」/ 首页卡片）

固定关注 6 个话题：广东长江食品有限公司、台山市长江食品有限公司、伦教长江中心、澳洲经济、美国经济、澳洲房市。
每个话题写明「盯什么」（如澳洲房市：房价指数、清盘率、租金空置率、贷款政策、外国买家规定）。

应用自己不能上网抓新闻（浏览器跨域限制，很多源国内也打不开），所以做成三步：

1. **一键搜最新**：每个话题直达 百度资讯（按时间排序）/ 必应新闻 / Google News；公司话题加 企查查、天眼查（看工商变更、司法风险）；
   宏观话题加官方源（RBA、ABS、美联储、BLS、Domain、realestate.com.au）。会记下「几天前搜过」。
2. **收藏**：单条粘贴；或「整页粘贴 · AI 拆条」——把搜索结果页全选复制进来，AI 拆成一条条，勾选后保存；同标题不会重复收藏。
3. **AI 解读**：单条「AI 分析影响」（和利好消息同一套打分）；按话题出「AI 专题简报」（只用你收藏的新闻，资料不够会直说）；
   或直接「问经济与房产顾问」。有用的新闻可以「转到利好消息」当机会跟进。

存储：不建新表，存在现有 `signals` 表里，`source` 字段以 `关注:<话题>` 开头作标记（见 `src/news.js`）。
利好消息页会自动过滤掉这些条目，两边互不干扰；备份 / 恢复自动包含。代码：`src/news.js`、`src/view-news.js`。

### 3. 专家增加到 9 位（3×3 排列）

新增 **📈 经济与房产顾问**：带着你「新闻关注」里收藏的新闻回答澳洲 / 美国经济、澳洲房市和三个本地主体的问题。
规则写死：引用新闻要标日期；靠自身知识补充的要注明「可能不是最新」；对两家长江食品公司和伦教长江中心没有新闻依据就说不知道、
建议去企查查核实，绝不编造；不预测价格、不推荐具体股票基金楼盘。

### 数据安全

- 没有新表、没有改表结构、没有删除或改写任何老数据的代码路径。
- `signals` 表读取上限从 300 放宽到 1000，避免新闻多了把老的利好消息挤出列表。
- 端到端测试 `test/e2e-v23.mjs` 预置了老的利好消息和老账，验证升级后原样显示、内容一字未改。

### 测试

```
npm test                    # 新增 test/verify-news.mjs（32 项）
node test/e2e-v23.mjs       # 2.3 新功能端到端（32 项）
```
`test/e2e-wb.mjs` 里账单菜单名已更新为「账单 / 导入」，WorkBuddy 版端到端 21 项全过。
`e2e-basic.mjs`、`e2e-more.mjs` 仍在找改名前的菜单（「账单」「导入账单」），2.2 时就已跑不通，这次没动。

### 构建备注

全新 `npm install` 会因为 vite 8 与 esbuild 0.25 的 peer 依赖冲突报 ERESOLVE，`sync.sh` 已改为 `npm install --legacy-peer-deps`。
