# 项目长期记忆 · D:\mywork
> 本文件只放**工作方式 + 最高频硬约定**（受注入体积限制）。
> 领域口径（引擎/归属/回测/资金流页/小程序）见同目录 **`DOMAIN.md`**；逐日见 `YYYY-MM-DD.md`。

## 一、用户偏好（设计第一原则）
- ★★ **沟通以网页版为主（2026-10-10 用户明确，最高优先级）**：只在 `stock-alert-console/console.html` 推进；**小程序除非用户单独点名，一律不动、不推进**（`stock-console-mp/` 冻结）。
- 要**趋势状态判定**（低频持续），不要每日多空信号；评估「状态是否成立」，**禁前瞻收益率**；状态显「第 N 天」，切换需确认+冷却。破位/过热分有效，**下跌侧区分度远强于上涨侧**。
- 先结论、表格对比、极简指令直接执行、可复用打包输出；仓位自控；详情页只留结论；授权前追问横向影响；token 不落盘。A 股**红涨绿跌**（「跟/躲」用蓝/橙避开红绿）。
- ⚠️ 不过度避责：可说边界，但**不能用「一个规格失败」代替「整个方向失败」**——先对齐持有期/横截面/状态持续三口径。
- ⚠️ **拒绝过度工程**（流程不能比重新做一遍还长）；⚠️ **任何任务先报计划再动手**（最高优先级）。

## 二、系统与发布硬约定
1. 已上线：云端 `stock-alert-cloud/`（zyhaaad/stock-alert）+ `stock-alert-console/console.html`（stock-alert-console.app.workbuddy.host，908K 字节 / brotli 238K）。
2. 改 console.html 必跑 `_tests/` 回归；DOM 测试先 build-preview；算法单一真源（UMD 经 `inject-core.js` 注入 fng/position/signal/chip）。
3. ⚠️ `sites_deploy` 在本工作区恒定落到监控台应用：**禁止在 D:\mywork 下发布第二个目录**；第二应用只能界面发布该卡，或同域子路径（六壬 `daliuren/` → 必跑 `sync-publish.js`）。
4. 发布：sites_deploy（entryHtml=console.html、domainPrefix=stock-alert-console、static）→ 发布后**必跑 `accept-online.js`**。**发布同意不跨轮**。云端脚本必备 `--dry`；token 只走环境变量（classic 勾 `repo`+`workflow`）。★**验收清单必须跟着改动走**（只证明旧功能没退化＝虚假安全感）。
5. 交易日闸门（真源 `stock-alert-cloud/trade-day.js`）：cron 工作日制、**不认 A 股节假日**；双信号取「或」；取不到 fail-open。**上传铁律：被 require 的模块必须排在使用者之前。**
6. 坑：负断言判**调用**不判函数名（先去注释）；缺值判 `v==null||v===''`（`Number(null)===0`）；JSONP push2=`cb=`、datacenter=`callback=`；日期是 YYYYMMDD 整数；`'use strict'` 下块内 `async function` 用 `var f = async function(){}`；**同文件严禁并行 Edit**；bash 缺 coreutils → 一律 node + Windows 路径；本机代码不进 git；演示数据必须自洽。
7. ★**git 真源＝本地 `main` ↔ 远端 `zyhaaad/stock-alert-console`（默认分支 main）**。2026-09-20 该仓库被**初始化两次** ⇒ 远端 main（43 提交，含记忆）与旧本地 `master`（5 提交）**无共同祖先**，**绝不可 force**；已用「worktree 拉 origin/main → 覆盖本地最新 → 1 提交快进」收口（1eacbf5）。旧 `master` 为废弃副本，**以后一律在 `main` 上工作**。白名单含 `!.gitignore`（此前被自身 `*` 规则忽略＝真漏洞）与 `/.workbuddy/memory/`（**记忆随 clone 走**）；`_tests/_*`、`*.bak-*`、`stock-alert-console/.workbuddy/`、`.news-*cache.json` 不入库。★**推送无本机凭据**（helper-selector 非交互取不到、无 gh/无 GH_TOKEN）⇒ 需用户给 token，只走环境变量与一次性命令，**不落盘、不写 .git/config**。
8. ★★**换 GitHub 账号迁移进行中（2026-10-12 启动，旧账号 zyhaaad 已登不上）**，**用户两条硬约束**：①**旧仓只读、内容保持不动**；②**迁移完全成功前线上不受影响**。⇒ 施工顺序红线：**新仓数据链跑通（raw 探针 200）→ 配 Secrets → 才切代码地址 → 才发布**，任何一步失败控制台仍读旧仓、随时可回退。★通道：本沙盒 **github.com 的 git 传输不可靠（502）**、`api.github.com`/`raw` 通畅 ⇒ 全程走 **Git Data API**。工具：`stock-alert-cloud/tools/copy-repo.js`（旧仓**只发 GET**；代码取本地最新、`.json/.md` 数据取旧仓原样）+ `_tests/switch-repo.js`（默认 dry-run；实测 22 文件/65 行；**绝不改 `.workbuddy/memory`**、按 owner 串匹配故不误伤发布域名）。★**三把告警钥匙（SENDKEY/PUSHPLUS_TOKEN/WECOM_WEBHOOK）不在 GitHub 手上**，是第三方平台签发 ⇒ 重登原平台即可看到原值。详情见 `仓库迁移-操作清单.md`。

## 三、测试与调试铁律（★踩过最多的地方）
1. ⚠️ 沙盒 `spawnSync/execFileSync` 不可用 ⇒ **以下为已知假失败，勿重复排查**：`console-check` div 配对差 2（把 JS 字符串里的 `<div` 数进去）；`console-picker`/`build-preview` 唯失败=`node --check`（对 778KB 单块脚本不适配，改用 `new vm.Script`）；`fng-heartbeat-test` E1/E2；`position-dom-test` 读构建产物。★ `run-offline-regression.js` 用 `execFileSync` ⇒ **恒 16 项全红，必须逐项手跑**。★ **jsdom 脚本跑完必须 `process.exit()`**（否则外部超时判 SIGTERM，看着像卡死其实早已 ALL GREEN）。**判失败前先确认测试读的是哪个文件。**
2. **断言四坑（都造成「假红/假通过」）**：①正则里 `+`/`(` 等元字符不转义会被当量词（`' + j\.date` 恒不匹配）；②**去注释副本会吃掉 `/*ROT_BUILTIN_S*/` 这类注入标记** ⇒ 查「注入是否生效」必须用**原始文本**；③页面级负断言会把**既有说明文案**误判 ⇒ 圈定到**本轮新增片段**；④★锚点 `/name\(arg\)/` 会匹配到**函数定义**而非调用点 ⇒ 实现整条换掉照样绿。★**改实现契约时逐条复核「这条断言现在实际匹配到了什么」；改期望前先确认实现已按新口径走，并加反向锁（且反向锁要能真的复现——只删一个护栏常常仍 ALL GREEN）。**
3. **夹具规矩**：别写死日期/月份（9 月夹具进 10 月全落空），日期**必须从被测引擎动态取**；★**夹具严禁吃页面内嵌快照**（那是每日刷新的**数据**，一刷就集体红），必须**自带确定性截面**；只要「够证明」的**最小规模**；常量定义在函数**外**时不能用函数片段去匹配。不许为通过而放宽断言。
4. `cmd | tail` 会缓冲 → 长任务重定向日志再读。★★**jsdom 在本环境不可用**：`new JSDOM(...)` 之后 `setTimeout` 永不触发、`process.exit` 也到不了 ⇒ 外部只看到 SIGTERM「卡死」，**测试恒无输出且会被误判为「跑绿了」**（2026-10-10 踩）。⇒ **改数断言一律用「纯源码正则 + 纯函数」范式**（`flow-click-fix-test.js` 为模板）；必须读全量输出时先重定向到文件再 `cat`。

## 四、数据源裁决（会漂移，每次先探）
- ✅ 可用：`push2ex` 涨停/炸板池（只回溯约 1 月，不许包装成已验证策略）· `datacenter-web` · `qt.gtimg.cn` 实时(GBK) · 新浪 K线(≤1023 根≈4.2 年，不复权) · ★`ifzq.gtimg.cn`（无前缀；`web.ifzq` 被 WAF 封）· 同花顺板块日线。
- ❌ 不可用：东财 `push2/push2his/push2delay` **本机 fetch failed**（2026-10-10 实测，**唯一可用是 `push2test`**，200/293ms 真数据）⇒ **任何东财 URL 一律走 `emGet`/域名池，严禁写死域名**；`stock/get?fields=f127`；个股级 clist `fs=b:BK…`（连 Actions 也 502）；同花顺 `funds/*`（需 cookie 401）；腾讯 `ff_` 个股资金流。★换源**已否掉**（东财↔新浪板块名匹配率 11.8%）。★`emSwap` 正则**必须排除 `push2ex`**（涨停池专用路径在 push2test 上 404）。
- ★★**`datacenter-web` 是绕开 push2 的正解**（板块成分股 + 全市场当日主力资金 join，见 DOMAIN）。★**F10 `RPT_F10_CORETHEME_BOARDTYPE`＝唯一稳定的个股→板块源**。
- ★**WAF ≠ 限流**：整片 `http 501` + `waf.tencent.com/501page.html` ⇒ **IP 级封禁、不自愈**；第一反应**换同接口另一域名**，抓取器内置域名回退。
- ★**取数顺序：GitHub Contents API → raw → jsDelivr**（各限时 9s）。API 2s 拿当日真值；raw 本地恒 `http=000`/timeout；jsDelivr 快但**陈旧**。

## 五、云端存档契约（可移植性根基）
- **`rotation.json`**：`boards = 当日同步 + 陈旧补挂`；`count`/`counts` **只算当日同步**，`total` 才是板块总数。⚠️ `stale` 曾**跨轮粘滞** → 已修「每轮先清空再按日期重打」。
- **`flow-history.json`**：★**段顺序 `stk` 必须排在 `mon` 回补之前**；`hist` 重建**必须继承 `prev.stk`**。★**优先级铁律：东财优先 → 失败记忆（冷却 10min）→ 云端兜底 → 冷却到期自动再试东财**。
- **`fng-history.json`**：含 `v / updated / days / margin`。★**云端状态别凭记忆，一律查存档 `v` 字段。**
- ★**`flowFetchStocks`**：云端**并行预取** → 带 **1.5s 硬预算**打东财 → 取云端兜底；**不得重试**（`emGet` 单次最坏 60s，重试＝120s ⇒ 用户看到「点击没反应」）。「东财优先」**≠「无限期等东财」**。

## 六、索引
- 引擎口径 / 归属与三套码制 / 回测方法论 / 资金流页链路 / 首屏取数铁律 / 小程序与可移植性 → **`DOMAIN.md`**
- 六壬 `daliuren/`、各项日度改动 → 对应 `YYYY-MM-DD.md`
