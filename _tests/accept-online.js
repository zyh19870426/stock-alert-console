/* 线上验收（端到端）：确认「发布出去的页面」真的包含本轮所有功能，且与本地一致
 * 覆盖：恐贪核心注入 + 备源顺序与超时 + 三项 UX 优化 + V3 持仓账本
 * 运行：node _tests/accept-online.js
 *      GH_TOKEN=ghp_xxx node _tests/accept-online.js   # 顺带验证 GitHub API 备源（免匿名限流）
 */
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');

const LF = '\n';
const ok = b => b ? '✅' : '❌';
let pass = 0, fail = 0;
const chk = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log(ok(cond) + ' ' + name + (extra ? '  ' + extra : ''));
};
/* 从整页源码里截一段（用于「某个函数里到底写了什么」这类断言） */
const between = (src, a, b) => {
  const i = src.indexOf(a); if (i < 0) return '';
  const j = src.indexOf(b, i + a.length); if (j < 0) return src.slice(i);
  return src.slice(i, j);
};

function get(url, opts = {}) {
  return new Promise(resolve => {
    const req = https.get(url, { headers: opts.headers || {}, timeout: 20000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', e => resolve({ status: 0, body: '', err: String(e.message) }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', err: 'timeout' }); });
  });
}

const SITE = 'https://stock-alert-console.app.workbuddy.host';
const REPO = 'zyhaaad/stock-alert';
const GH = process.env.GH_TOKEN || '';

(async () => {
  console.log('======== 线上端到端验收 ========' + LF);

  const local = fs.readFileSync('D:/mywork/stock-alert-console/console.html', 'utf8');
  const localMd5 = crypto.createHash('md5').update(local).digest('hex');
  const r1 = await get(SITE + '/console.html');
  const on = r1.body;
/* ⚠️ 负断言（「某段代码必须不存在」）要判**真实代码**，不能判裸词 ——
   注释里常写着「已删掉 X」的说明，裸词会被自己的注释误伤（2026-09-20 踩过）。 */
/* ⚠️ 负断言必须判「去注释后的源码」：/* *\/ 块注释、// 行注释、**还有 HTML 注释**都要剥掉，
   否则「已撤下」的说明性注释会把自己误伤（本项目已踩三次）。 */
const onNoCmt = on.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
  /* ★ 2026-10-10：剥行注释必须放过 URL 里的 `://`。
     旧写法 `l.replace(/\/\/.*$/, '')` 会把 `'https://push2.eastmoney.com/...'` 整行后半切掉，
     ⇒ **目标串只在 URL 里出现时永远判不到**（实测：[F7] flowFetchStocks 顺序断言假失败）。
     只剥「前面不是冒号」的 `//`。 */
  .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
  const onlineMd5 = crypto.createHash('md5').update(on).digest('hex');

  chk('线上 /console.html 可访问 (HTTP 200)', r1.status === 200, 'status=' + r1.status);
  chk('线上与本地字节一致 (md5)', onlineMd5 === localMd5, onlineMd5.slice(0, 12) + ' vs ' + localMd5.slice(0, 12));

  const r1b = await get(SITE + '/');
  chk('根路径自动跳转 console.html', r1b.body.indexOf('console.html') >= 0, r1b.body.length + 'B');

  /* ---------- 恐贪（既有） ---------- */
  chk('含恐贪核心标记 FNG-CORE-BEGIN（且仅 1 个）', (on.match(/FNG-CORE-BEGIN/g) || []).length === 1);
  chk('含恐贪入口卡 fg-entry 与详情页 pgFng', on.indexOf('fg-entry') >= 0 && on.indexOf('pgFng') >= 0);
  chk('吸顶容器 #fngSticky + position:sticky', on.indexOf('id="fngSticky"') >= 0 && /\.fg-sticky\.on\{[^}]*position:sticky/.test(on));
  chk('分阶段建议卡 #fngAdvCard', on.indexOf('id="fngAdvCard"') >= 0 && on.indexOf('id="fngAdvDo"') >= 0);

  const code = on.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  chk('无「观望为主」类空话（已剥离注释）', !/观望为主/.test(code));
  chk('曲线游标 + touch-action:pan-y', on.indexOf('id="fngCursor"') >= 0 && on.indexOf('touch-action:pan-y') >= 0);

  /* 备源顺序与超时 */
  {
    const i = on.indexOf('async function fngLoadRaw');
    const seg = on.slice(i, i + 2400);
    const iJ = seg.indexOf('cdn.jsdelivr.net'), iR = seg.indexOf('raw.githubusercontent.com');
    chk('备源顺序：jsDelivr 在 raw 之前', iJ > 0 && iR > iJ);
    chk('每次抓取带超时（AbortController）', on.indexOf('AbortController') >= 0);
  }

  /* ---------- V3 持仓账本 ---------- */
  chk('含持仓核心标记 POSITION-CORE-BEGIN（且仅 1 个）', (on.match(/POSITION-CORE-BEGIN/g) || []).length === 1);
  chk('含持仓核心标记 POSITION-CORE-END（且仅 1 个）', (on.match(/POSITION-CORE-END/g) || []).length === 1);
  chk('持仓核心已挂到 window（root.PositionCore）', on.indexOf('root.PositionCore') >= 0);

  {
    const B = '/* ==== POSITION-CORE-BEGIN ==== */', E = '/* ==== POSITION-CORE-END ==== */';
    const i = on.indexOf(B), j = on.indexOf(E);
    const core = fs.readFileSync('D:/mywork/stock-alert-cloud/position-core.js', 'utf8');
    const onlineInner = (i >= 0 && j > i) ? on.slice(i + B.length, j).trim() : '';
    chk('线上注入的持仓核心与本地 position-core.js 逐字一致', !!onlineInner && onlineInner === core.trim());
  }

  /* ---------- 三页分离规格（2026-09-16 用户确认）：监控 / 持仓 / 推荐各自独立 ---------- */
  /* ★ 2026-09-20 晚定稿：持仓不再记账 → 汇总卡**渲染函数与样式整体删除**，不再留死代码。
     （演进：先撤 pfBox 调用 → 函数变零调用方死代码 → 用户确认「改成负向断言、对结论产出与界面展示
       均无影响」后清除。删掉的是纯渲染函数，不碰 position-core 的 portfolioOf/pnlClass/FEE_NOTE。） */
  chk('★ 持仓汇总卡渲染函数 renderPortfolio 已整体删除（零调用方死代码，不随包下发）',
    onNoCmt.indexOf('renderPortfolio') < 0);
  chk('★ 监控页不再有个股持仓行渲染函数 posLineHtml', on.indexOf('function posLineHtml') < 0);
  /* ★ 2026-09-20：持仓不再记成本/股数 → 顶部汇总卡（浮盈/市值/成本合计）整体撤下 */
  {
    const rh = between(on, 'function renderHoldings(map)', 'function bindHoldingCards(box)');
    chk('★ 持仓页不再渲染汇总卡（pfBox / renderPortfolio 均无残留）',
      on.indexOf('id="pfBox"') < 0 && rh.indexOf('pfBox') < 0 &&
      rh.indexOf('renderPortfolio') < 0);
  }
  chk('★ 监控列表不再渲染汇总卡（renderActive 只画监控卡）', onNoCmt.indexOf('renderPortfolio') < 0);
  chk('★ 监控卡内联录入面板已无成本/股数输入框', on.indexOf('class="e-cost"') < 0 && on.indexOf('class="e-qty"') < 0);
  chk('★ 统一添加页按用途分面板：监控面板放条件/目标价，持仓面板**不再要成本/股数**（2026-09-20）',
    on.indexOf('id="pnlMonitor"') >= 0 && on.indexOf('id="pnlHolding"') >= 0 &&
    on.indexOf('id="fCond"') >= 0 && on.indexOf('id="fTarget"') >= 0 &&
    on.indexOf('id="hCost"') < 0 && on.indexOf('id="hQty"') < 0);
  chk('统一添加页讲清「两份清单互相独立」',
    on.indexOf('两份清单互相独立') >= 0 && on.indexOf('两份独立清单') >= 0);
  /* ⚠️ 判「记账口径会不会出现在页面上」：函数删掉后，正确判法是**去注释源码里一个都不许有**
     （注释里可以说明「已删除」，所以必须用 onNoCmt，不能搜全文件）。 */
  chk('★ 持仓不再记账：记账口径（持仓浮盈 / 成本合计 / 持仓市值）在去注释源码里一个都不剩',
    onNoCmt.indexOf('持仓浮盈') < 0 && onNoCmt.indexOf('成本合计') < 0 &&
    onNoCmt.indexOf('持仓市值') < 0);
  chk('「没记持仓」有独立文案（不等于 0 元）', on.indexOf('还没有持仓记录') >= 0);
  chk('★ 汇总卡样式 .pf* 已随函数一并清除（不留无用样式）',
    on.indexOf('.pf{') < 0 && on.indexOf('.pf-lbl{') < 0 && on.indexOf('.pf-val{') < 0);
  chk('★ 旧持仓行样式 .pos 已移除', !/\.pos\{display:flex/.test(on));

  chk('持仓清单访问入口仍被多处消费（holdingsOf）', on.indexOf('var hs = holdingsOf()') >= 0);
  chk('有了独立的持仓清单访问入口', on.indexOf('function holdingsOf()') >= 0 && on.indexOf('function posCore()') >= 0);
  chk('含「我的持仓」页 pgHoldings', on.indexOf('id="pgHoldings"') >= 0);
  chk('★ 持仓页不再自带表单（录入统一在首页入口，这里只有跳转按钮）',
    on.indexOf('id="btnGoAddHolding"') >= 0 && on.indexOf('id="hCode"') < 0 && on.indexOf('id="hName"') < 0 &&
    on.indexOf('id="hManualFields"') < 0 && on.indexOf('id="hQuery"') < 0);
  chk('「更多」菜单里有持仓入口', on.indexOf('id="rowHoldings"') >= 0);
  chk('★ 首页不再有「管理持仓」按钮（汇总卡搬进持仓页）', on.indexOf('id="btnGoHoldings"') < 0);
  chk('页面讲清了"两批股票"', on.indexOf('两批股票') >= 0);
  chk('★ 个股卡的「＋ 记录持仓」入口已下线', on.indexOf('data-act="posEdit"') < 0 && on.indexOf('＋ 记录持仓') < 0);
  chk('删监控不连带删持仓（归档不再存成本）', on.indexOf('只删监控，「我的持仓」里这条记录会保留') >= 0);
  chk('老配置自动迁移已接入启动流程', on.indexOf('PC0.migrateLegacy(G.cfg.stocks, G.cfg.holdings)') >= 0);
  chk('演示数据也分成了两份清单（demoCfg 含 holdings 数组）', on.indexOf('    holdings: [') >= 0);
  {
    // demoCfg 里 holdings 之前的那段 = 监控清单，里面不该再出现 cost/qty
    const i0 = on.indexOf('function demoCfg');
    const j0 = on.indexOf('    holdings: [', i0);
    const seg = (i0 >= 0 && j0 > i0) ? on.slice(i0, j0) : '';
    chk('演示的监控项上不再挂 cost/qty', seg.length > 0 && seg.indexOf('cost:') < 0 && seg.indexOf('qty:') < 0);
  }

  /* ---------- AI 备选推荐页（第三个独立页面） ---------- */
  chk('含信号核心标记 SIGNAL-CORE-BEGIN（且仅 1 个）', (on.match(/SIGNAL-CORE-BEGIN/g) || []).length === 1);
  chk('信号核心已挂到 window（root.SignalCore）', on.indexOf('root.SignalCore') >= 0);
  {
    const B = '/* ==== SIGNAL-CORE-BEGIN ==== */', E = '/* ==== SIGNAL-CORE-END ==== */';
    const i = on.indexOf(B), j = on.indexOf(E);
    const core = fs.readFileSync('D:/mywork/stock-alert-cloud/signal-core.js', 'utf8');
    const onlineInner = (i >= 0 && j > i) ? on.slice(i + B.length, j).trim() : '';
    chk('线上注入的信号核心与本地 signal-core.js 逐字一致', !!onlineInner && onlineInner === core.trim());
  }
  /* ★ 2026-09-17 新增第 6 条规则：持仓股连续 ≥2 天开收盘站上 5 日线 → 提醒卖出（云端推送）
     ★ 同日追加前提：只有均线多头排列（MA5 > MA10 > MA20 > MA30）才判断，其他情况不触发 */
  chk('信号规则版本已升到 R4（2026-09-24 站上口径收紧为全天都在；改规则必须升版本，胜率按版本分开统计）', on.indexOf("RULE_VERSION = 'R4'") >= 0);
  chk('★ 线上核心含多头排列前提 maAlign（MA5>MA10>MA20>MA30 才判断）',
    on.indexOf('function maAlign(') >= 0 && on.indexOf('maAlign: maAlign') >= 0 &&
    on.indexOf('alignMas: [5, 10, 20, 30]') >= 0);
  chk('★ ma5Streak 真的被前提挡（非多头排列直接 days:0 / sig:null，不硬算）',
    on.indexOf('if (!al.ok) {') >= 0 && on.indexOf('aligned: false,') >= 0 && on.indexOf('aligned: true,') >= 0);
  chk('★ 线上核心含新规则 MA5_STREAK_EXIT（连续站上 5 日线 → 卖出提醒）',
    on.indexOf("rule: 'MA5_STREAK_EXIT'") >= 0 && on.indexOf('ma5ExitDays') >= 0);
  chk('★ 推送规则本体也显式挡了前提（不是只靠 ma5Streak）',
    on.indexOf('if (!maAlign(bars, i).ok) return null;') >= 0);
  /* ★ 2026-09-17：胜率必须**按版本隔离**（用户选「只统计当前版本」） */
  chk('★ 线上核心的 winrateStats 支持按版本隔离（opt.onlyVersion，含未标版本的老数据要排除）',
    on.indexOf('function winrateStats(judged, opt)') >= 0 &&
    on.indexOf('var onlyVer = (opt && opt.onlyVersion) ? String(opt.onlyVersion) : null;') >= 0 &&
    on.indexOf("if (onlyVer && String(list[i] && list[i].ruleVersion) !== onlyVer) continue;") >= 0);
  chk('★ 新规则与 HOT_MA5_BIAS 的区别写进注释（前者不看乖离）', on.indexOf('不加乖离条件') >= 0 || on.indexOf('不加 5 日乖离条件') >= 0);
  chk('★ 线上核心含 signalsForList（清单过滤的单一真源：卖出提醒只对持仓股发）',
    on.indexOf('function signalsForList(') >= 0 && on.indexOf('signalsForList: signalsForList') >= 0);
  /* 推送链路在 signals.js 里（不在 console.html 内），所以这里读本地文件 + 云端那份 */
  {
    const sigLocal = fs.readFileSync('D:/mywork/stock-alert-cloud/signals.js', 'utf8');
    chk('推送文案已拆出 buildMessage（可单测，不用肉眼看）',
      sigLocal.indexOf('function buildMessage(') >= 0 && sigLocal.indexOf('module.exports = { main: main, buildMessage: buildMessage }') >= 0);
    chk('云端任务真的走了 signalsForList（口径不在两处各写一遍）',
      sigLocal.indexOf('S.signalsForList((r && r.signals) || [], listOf[code])') >= 0);
    chk('★ signals.js --report 也按版本隔离统计（并且把排除了多少条如实打出来）',
      sigLocal.indexOf('S.winrateStats(all, { onlyVersion: S.RULE_VERSION })') >= 0 &&
      sigLocal.indexOf('const skippedOld = all.length - counted') >= 0);
    {
      const revLocal = fs.readFileSync('D:/mywork/stock-alert-cloud/review.js', 'utf8');
      chk('★ 规则体检（review.js）按版本隔离统计，且备选池行带上逐条 ruleVersion',
        revLocal.indexOf('S.winrateStats(allRows, { onlyVersion: S.RULE_VERSION })') >= 0 &&
        revLocal.indexOf('ruleVersion: p.ruleVersion') >= 0);
      chk('★ 体检报告必须说明「排除了多少条旧版本」（否则样本 0 看起来像坏了）',
        revLocal.indexOf('条更早版本（R2 及以前）的信号已排除') >= 0 &&
        revLocal.indexOf('还没有信号入库') >= 0);
    }
    {
      const scrLocal = fs.readFileSync('D:/mywork/stock-alert-cloud/screener.js', 'utf8');
      chk('★ 备选池引擎已重构为龙头战法（情绪周期 + 防接盘硬过滤 + 买点纪律 + L2 版本）',
        scrLocal.indexOf('function classifyCycle(') >= 0 &&
        scrLocal.indexOf('function guardReject(') >= 0 &&
        scrLocal.indexOf('function scoreBoard(') >= 0 &&
        scrLocal.indexOf('function scoreDip(') >= 0 &&
        scrLocal.indexOf("const PICK_VERSION = 'L2'") >= 0 &&
        scrLocal.indexOf('dipMaxLbc: 2') >= 0 &&
        scrLocal.indexOf('弱转强观察池') >= 0 &&
        scrLocal.indexOf('一字板买不进') >= 0 &&
        scrLocal.indexOf('高开 >7% 放弃') >= 0);
    }

    /* 云端文件内容检查：404=还没传（真失败）；403=匿名限流（不判失败，给 token 可解） */
    const cloudFile = async (rel) => {
      const r = await get('https://api.github.com/repos/' + REPO + '/contents/' + rel, { headers: { 'User-Agent': 'accept', ...(GH ? { Authorization: 'token ' + GH } : {}) } });
      let text = '';
      try { text = Buffer.from(String(JSON.parse(r.body).content || '').replace(/\n/g, ''), 'base64').toString('utf8'); } catch (e) {}
      return { status: r.status, text: text };
    };
    const needIn = async (rel, label, keys) => {
      const f = await cloudFile(rel);
      if (f.status === 403) { console.log('ℹ️  ' + rel + ' 匿名读被限流（HTTP 403），跳过内容核验 —— 设 GH_TOKEN 可解'); return; }
      const miss = keys.filter(k => f.text.indexOf(k) < 0);
      chk(label + (f.status === 200 ? '' : '（HTTP ' + f.status + '）'),
        f.status === 200 && miss.length === 0,
        f.status === 200 ? (miss.length ? '缺 ' + miss.join(' / ') : '含') : '云端还没这个文件');
    };
    await needIn('signals.js', '★ 云端 signals.js 已含清单过滤、buildMessage 与按版本统计',
      ['signalsForList', 'function buildMessage(', 'onlyVersion: S.RULE_VERSION']);
    await needIn('signal-core.js', '★ 云端 signal-core.js 已含 MA5_STREAK_EXIT（R3 + 多头排列前提）、按版本统计与 signalsForList',
      ["'MA5_STREAK_EXIT'", "RULE_VERSION = 'R4'", 'signalsForList', 'function maAlign(', 'onlyVersion']);
    await needIn('review.js', '★ 云端 review.js 已按版本隔离统计（否则规则体检还是新旧混算）',
      ['onlyVersion: S.RULE_VERSION', 'ruleVersion: p.ruleVersion']);
  await needIn('screener.js', '★ 云端 screener.js 已是龙头战法引擎（情绪周期/防接盘过滤/买点纪律/L2 版本）',
    ['function classifyCycle(', 'function guardReject(', 'function scoreBoard(', 'function scoreDip(',
      "const PICK_VERSION = 'L2'", 'dipMaxLbc: 2', '弱转强观察池', '一字板买不进', '高开 >7% 放弃', "ruleVersion = 'LEGACY'"]);
  await needIn('style.js', '★ 云端 style.js 已是风格驾驶舱引擎（S1：七档判定 + 优选闸门）',
    ["const STYLE_VERSION = 'S1'", 'function classifyStyle(', 'function psGate(', 'function idxStyle(',
      'function themeLeaders(', 'function scoreCandidate(', 'function guardCandidate(', 'function passFlow(',
      'push2delay.eastmoney.com', '宁可空仓']);
  /* 交易日历 param 修复（2026-09-19）：screener fetchTradingDates 必须三逗号（day,,,n）
     ⚠️ 匿名 API 常被限流（HTTP 403）：按项目口径「403=没读到≠失败」→ 跳过，不判失败。 */
  try {
    const scr = await cloudFile('screener.js')
    if (scr.status === 403) {
      console.log('ℹ️  screener.js 匿名读被限流（HTTP 403），跳过交易日历 param 核验 —— 设 GH_TOKEN 可解')
    } else {
      chk('★ 云端 screener.js 交易日历 param 已修复（day,,,n，情绪周期不再静默降级）',
        scr.status === 200 && scr.text.indexOf('param=sh000985,day,,,') >= 0)
    }
  } catch (e) { chk('★ 云端 screener.js 交易日历 param 已修复（day,,,n，情绪周期不再静默降级）', false) }
  }
  chk('含「AI 备选推荐」页 pgPicks', on.indexOf('id="pgPicks"') >= 0);
  chk('「更多」菜单里有推荐入口 rowPicks', on.indexOf('id="rowPicks"') >= 0);
  chk('推荐页读 picks-history.json（三源降级）', on.indexOf('picks-history.json') >= 0 && on.indexOf('async function picksLoadRaw') >= 0);
  chk('推荐页写明排除口径（不含 ST、不含科创板）', on.indexOf('不含 ST、不含科创板') >= 0);
  chk('推荐页写明胜负口径（10 个交易日 ±2%）', on.indexOf('10 个交易日 ±2%') >= 0);
  chk('推荐页渲染推荐理由与买卖纪律', on.indexOf('pick-ul') >= 0 && on.indexOf('买卖纪律') >= 0);

  /* ---------- 快捷切换条 + 持仓页搜索 ---------- */
  chk('★ 首页切换条已去掉：仅持仓页/推荐页各保留一条 vtabs', (on.match(/class="vtabs"/g) || []).length === 2 && on.indexOf('<div class="wrap">') >= 0);
  chk('主视图内不再有 vtabs（仪表盘卡片即导航）', (() => { const i = on.indexOf('<div class="wrap">'), j = on.indexOf('id="dash"', i); return i >= 0 && j > i && on.slice(i, j).indexOf('class="vtabs"') < 0; })());
  chk('切换条含「今日推荐」项（用户口径文案）', on.indexOf('>今日推荐<') >= 0);
  chk('切换逻辑 switchView/syncViewTabs 已接入', on.indexOf('function switchView(v)') >= 0 && on.indexOf('function syncViewTabs()') >= 0);
  chk('行情刷新有防重入锁', on.indexOf('G.priceBusy') >= 0);
  chk('★ 添加只有一个入口：FAB 与「记一笔持仓」都进统一添加页', on.indexOf('function openAdd(tab)') >= 0 && on.indexOf("openAdd('holding')") >= 0);
  chk('★ 统一添加页复用搜索主通道（srFetchItems/srBranch 单一真源，无第二套搜索）',
    on.indexOf('SR_LAST = srBranch(items, q, 20)') >= 0 && on.indexOf('await srFetchItems(q)') >= 0 &&
    on.indexOf('async function hSearch') < 0 && on.indexOf('id="hQuery"') < 0);
  chk('★ 手输降级通道保留（默认收起，搜不到时可手输 6 位代码）', on.indexOf('id="srFallback" hidden') >= 0 && on.indexOf('id="btnManual"') >= 0);

  /* ---------- ★ 统一添加页（2026-09-17 用户需求：监控/持仓合并成一个入口） ---------- */
  chk('★ 添加页含用途分段（开提醒 / 记持仓）', on.indexOf('id="addSeg"') >= 0 &&
    on.indexOf('data-tab="monitor"') >= 0 && on.indexOf('data-tab="holding"') >= 0);
  chk('★ 选出股票前不摊表单（#addForm 默认 hidden，选中才展开）',
    on.indexOf('id="addForm" hidden') >= 0 && on.indexOf('function addFormSync()') >= 0);
  chk('★ 提交后给结果确认卡（addOkShow），而不是默默关页',
    on.indexOf('function addOkHtml(kind, title, sub, otherTab)') >= 0 &&
    on.indexOf('function addOkShow(kind, title, sub, code)') >= 0 &&
    on.indexOf('data-ok="again"') >= 0);
  chk('★ 结果卡的下一步出口：再添加一只 / 顺便做另一件事 / 去看清单',
    on.indexOf('顺便记持仓') >= 0 && on.indexOf('顺便开提醒') >= 0 && on.indexOf('去看我的持仓') >= 0);
  chk('★ 已在监控 / 已记持仓 → 走更新而不是拦住（按钮文案随之变）',
    on.indexOf("s.mon ? '更新监控条件' : '开始监控'") >= 0 && on.indexOf("s.hold ? '更新持仓' : '保存持仓'") >= 0);
  chk('★ 现状条说明「它在哪份清单里、这次保存会发生什么」',
    on.indexOf('function addStateOf(code)') >= 0 && on.indexOf('已在监控清单') >= 0 &&
    on.indexOf('已记持仓') >= 0 && on.indexOf('会覆盖原') >= 0);
  chk('★ 现状条给「去改另一边」快捷入口', on.indexOf('data-go="holding"') >= 0 && on.indexOf('data-go="monitor"') >= 0);
  chk('★ 候选行 / 选中卡标出「监控中 / 持仓中」',
    on.indexOf('function addTagsHtml(code)') >= 0 && on.indexOf('class="ro mon"') >= 0 && on.indexOf('class="ro hold"') >= 0);
  /* ★ 2026-09-20：持仓不再记成本/股数 → 预填只带出监控侧的条件与目标价 */
  chk('★ 预填已有值：已监控带出原条件与目标价（持仓侧已无成本/股数可预填）',
    on.indexOf('function addFillFields()') >= 0 && on.indexOf('s.mon && s.stock.condition') >= 0 &&
    on.indexOf('s.mon && s.stock.target') >= 0 &&
    onNoCmt.indexOf('s.holding.cost') < 0 && onNoCmt.indexOf('s.holding.qty') < 0);
  chk('★ 首页仪表盘空态两卡按用途直达（data-tab=monitor/holding）',
    on.indexOf("openAdd(t.getAttribute('data-tab') || '')") >= 0);
  /* ⚠️ 判「有没有写另一份清单」必须看**真实写操作**（`G.cfg.stocks` / `G.cfg.holdings`），
     不能用裸词 `holdings` —— addStock 里就有一句注释写着「成本/股数属于另一份清单 cfg.holdings」，
     裸词会被自己写的注释误伤（本项目的老坑）。 */
  chk('★ 两份清单互不串写：加监控不写 holdings，记持仓不写 stocks',
    between(on, 'async function addStock()', '/* ---------- 搜索流程').indexOf('G.cfg.holdings') < 0 &&
    between(on, 'async function addHolding()', '/* ★ 2026-09-17：hLookupName').indexOf('G.cfg.stocks') < 0);

  /* ---------- 首页仪表盘（2026-09-16 用户需求：首页只留恐贪 + 三块卡） ---------- */
  chk('首页仪表盘容器 #dash 存在', on.indexOf('id="dash"') >= 0);
  chk('全部监控列表默认收起 + 返回按钮 homeBack', on.indexOf('id="homeBack"') >= 0 && on.indexOf('function renderHome') >= 0);
  chk('最近触发光标：nearestStock（已达条件优先，按差距百分比排序）', on.indexOf('function nearestStock') >= 0 && on.indexOf("data-act=\"dash-near\"") >= 0);
  chk('点最近触发卡展开全部监控（openFullList/backToDash）', on.indexOf('function openFullList') >= 0 && on.indexOf('function backToDash') >= 0);
  chk('日线数据源：腾讯个股日线（与前高/均线同源接口）', on.indexOf('async function fetchDailyBars') >= 0 && on.indexOf('appstock/app/fqkline/get') >= 0);
  /* ★ 2026-09-22 二次改版：V3 三源投票整行撤下，持仓卡改称「阶段跟踪」（不再叫「主力博弈」） */
  chk('仪表盘三卡：距触发最近/持仓·阶段跟踪/今日推荐', on.indexOf('距触发最近') >= 0 && on.indexOf('持仓 · 阶段跟踪') >= 0 && on.indexOf('今日推荐') >= 0);
  chk('点持仓行进持仓页并自动展开（focusHolding）', on.indexOf('G.focusHolding') >= 0 && on.indexOf("acts.classList.add('open')") >= 0);
  chk('★ 持仓卡「开价格提醒」操作已整体移除', on.indexOf('data-act="hgMonitor"') < 0 && on.indexOf('function addMonitoredFromHolding') < 0);

  /* ---------- ★ 首屏不白板 + 刷新不闪（2026-09-17 用户反馈「刷新时变白板」） ----------
     根因：① #dash 静态为空，boot() 要等 loadConfig/loadState 两轮网络才画得出内容；
          ② 行情每次回来都 innerHTML 全量重画，数据没变也重建 DOM → 闪 + 跳动。
     修复：骨架屏 + 本地缓存秒开 + 内容签名「没变就不动 DOM」。 */
  {
    const i0 = on.indexOf('<div id="dash">');
    const seg0 = i0 >= 0 ? on.slice(i0, i0 + 420) : '';
    chk('★ #dash 首屏骨架已内嵌（不再是空 div —— 打开就有形，不是白板）', i0 >= 0 && seg0.indexOf('class="sk') > 0);
    chk('★ 骨架条带脉动动画', /\.sk\{[^}]*skpulse/.test(on));
  }
  chk('★ 统一「有变化才重画」入口 paint(el, html, key)',
    on.indexOf('function paint(el, html, key)') >= 0 &&
    ["paint(box, h, 'dashSig')", "paint(box, html, 'actSig')", "paint(box, html, 'holdSig')", "paint(box, html, 'pickSig')"]
      .every(k => on.indexOf(k) >= 0));
  chk('★ 本地缓存：打开先用上次数据铺满，再后台静默刷新',
    on.indexOf('var CACHE_KEY') >= 0 && on.indexOf('function readCache()') >= 0 &&
    on.indexOf('function writeCache()') >= 0 && on.indexOf('function clearCache()') >= 0 &&
    on.indexOf('function paintFromCache()') >= 0);
  {
    const bi = on.indexOf('async function boot()');
    const bseg = bi >= 0 ? on.slice(bi, bi + 3200) : '';
    chk('★ boot 先画缓存、再去联网（顺序反了首屏还是白板）',
      bi >= 0 && bseg.indexOf('paintFromCache()') > 0 && bseg.indexOf('paintFromCache()') < bseg.indexOf('await loadConfig()'));
    chk('★ 刷新失败时保留缓存数据，不清空页面', bseg.indexOf('下面是上次的数据') >= 0);
    chk('boot 成功写缓存；换仓库/恢复备份时作废旧缓存',
      bseg.indexOf('writeCache()') >= 0 && on.indexOf('clearCache()') >= 0);
  }

  /* ---------- ★ 透视模式（2026-09-17 用户需求：看清散户在干什么，站到主力那边） ----------
     取代了原来的「走势/机会/风险」评测：原来那套是干巴巴的技术面描述，
     用户要的是从 A 股交易本质出发 —— 散户在割肉还是追高接筹码、主力在建仓还是派发。 */
  chk('★ 旧评测已整体下线（evalFromBars/evalEnsure/demoEvalData 全无）',
    on.indexOf('function evalFromBars') < 0 && on.indexOf('function evalEnsure') < 0 && on.indexOf('function demoEvalData') < 0);
  chk('★ 旧评测当日缓存 G.evalCache 已移除', on.indexOf('G.evalCache') < 0);
  chk('★ 干巴巴的走势/机会/风险三要素已移除（评测标签无残留）',
    on.indexOf('ev-k">走势') < 0 && on.indexOf('ev-k">机会') < 0 && on.indexOf('ev-k">风险') < 0 &&
    on.indexOf('>机会<') < 0 && on.indexOf('>风险<') < 0);
  chk('恐贪页的「走势」曲线卡仍在（只删评测标签，没误删恐贪页）',
    on.indexOf('>走势<') >= 0 && on.indexOf('id="fngChart"') >= 0 && on.indexOf('id="fngTabs"') >= 0);
  chk('★ 旧评测摘要样式 hg-eval 已清除（不留死代码）', on.indexOf('hg-eval') < 0);

  chk('含透视核心标记 CHIP-CORE-BEGIN（且仅 1 个）', (on.match(/CHIP-CORE-BEGIN/g) || []).length === 1);
  chk('含透视核心标记 CHIP-CORE-END（且仅 1 个）', (on.match(/CHIP-CORE-END/g) || []).length === 1);
  chk('透视核心已挂到 window（root.ChipCore）', on.indexOf('root.ChipCore') >= 0);
  {
    const B = '/* ==== CHIP-CORE-BEGIN ==== */', E = '/* ==== CHIP-CORE-END ==== */';
    const i = on.indexOf(B), j = on.indexOf(E);
    const core = fs.readFileSync('D:/mywork/stock-alert-cloud/chip-core.js', 'utf8');
    const onlineInner = (i >= 0 && j > i) ? on.slice(i + B.length, j).trim() : '';
    chk('线上注入的透视核心与本地 chip-core.js 逐字一致', !!onlineInner && onlineInner === core.trim());
  }
  chk('九件事判定齐备：散户割肉/追高/抄底 + 主力建仓/派发/锁仓 + 站队结论',
    ['judgeRetail', 'judgeMain', 'judgeStance'].every(f => on.indexOf('function ' + f + '(m)') >= 0));
  chk('筹码分布 + 主力/散户成本 + 获利盘 + 集中度 + 支撑压力',
    ['chipsDistribution', 'analyzeChips', 'flowStats', 'volumeStats'].every(f => on.indexOf('function ' + f + '(') >= 0));

  chk('透视存档读取 chips-history.json（三源降级）',
    on.indexOf('chips-history.json') >= 0 && on.indexOf('async function chipsLoadRaw') >= 0);
  {
    const i = on.indexOf('async function chipsLoadRaw');
    const seg = on.slice(i, i + 3200);
    const iJ = seg.indexOf('cdn.jsdelivr.net'), iR = seg.indexOf('raw.githubusercontent.com');
    const iA = seg.indexOf('contents/chips-history.json?ref=main');
    /* ⚠️ 2026-09-22 改判：原来锁的是「jsDelivr 在 raw 之前」（当时理由是"CDN 国内可达、raw 是黑洞"）。
       实测 jsDelivr 的 gh 缓存**滞后可达数天** —— 于是"能连上"变成了"连着旧数据"，
       归档新增字段（如 holders）好几天都不出现。现在先走**不进 CDN 的 GitHub API**，
       CDN/raw 只作兜底；raw 仍排在 CDN 之后（该网络是黑洞，让它垫底少等 8 秒）。 */
    chk('★ 透视备源顺序：GitHub API（不进 CDN）在 jsDelivr 之前', iA > 0 && iJ > iA);
    chk('透视兜底顺序：jsDelivr 在 raw 之前（raw 在本网络是黑洞，垫底）', iJ > 0 && iR > iJ);
    chk('透视每次抓取带超时（API 9000ms / 备源 8000ms）', seg.indexOf(', 9000)') > 0 && seg.indexOf(', 8000)') > 0);
  }
  chk('存档缺这只时就地实时算（chipLiveFrom，东财资金流 JSONP）',
    on.indexOf('async function chipLiveFrom') >= 0 && on.indexOf('push2his.eastmoney.com') >= 0);
  chk('透视入口 chipEnsure 有幂等签名 + 防重入（防 renderDash 死循环）',
    on.indexOf('G.chipSig') >= 0 && on.indexOf('G.chipBusy') >= 0);
  chk('透视数据到位后重画仪表盘与持仓页（renderChipViews）',
    on.indexOf('function renderChipViews()') >= 0 && on.indexOf('chipEnsure()') >= 0);
  chk('云端算筹码的理由写进代码（资金流接口在手机浏览器不可靠）',
    on.indexOf('手机浏览器') >= 0 && on.indexOf('T+1') >= 0);

  /* 5 日线连续站上（用户指定口径：开盘收盘都站上才算；≥2天提示卖出/1天只标天数/0天不显示） */
  chk('5 日线连续站上口径在 SignalCore（ma5Streak，逐日各用截止当日的 5 日线）',
    on.indexOf('function ma5Streak(bars, endIdx)') >= 0 && on.indexOf('ma5Streak: ma5Streak') >= 0);
  chk('本地封装 ma5Of 调 SignalCore.ma5Streak', on.indexOf('SC.ma5Streak(bars)') >= 0);
  chk('★ 5 日线标识三态：≥2 天橙色告警 / 1 天灰弱化 / 0 天不渲染',
    on.indexOf('.hg-ma5 .m5-badge') >= 0 && on.indexOf('.hg-ma5.watch') >= 0 &&
    on.indexOf('天站上 5 日线') >= 0 && on.indexOf('if(!st || !st.days) return') >= 0);

  /* ---------- ★ 主力博弈 V3 显示（2026-09-17 用户需求：把 V3 多源核验结论显示在持仓页，
         替换原来的「散户/主力行为」判定显示；口径与 mobile_monitor V3 同源） ---------- */
  /* ★ 2026-09-22 二次改版：V3 判定摘要（v3BriefHtml）从持仓列表撤下 —— 它在同一张卡里给出
     第二个「主力方向」，与展开区的「阶段」行互相矛盾。列表只留 5 日线标识。函数保留可回退。 */
  chk('★ 持仓列表只留 5 日线标识（V3 判定摘要已撤下）',
    on.indexOf('var pvHtml = ma5Html(h.code)') >= 0 && on.indexOf('v3BriefHtml(h.code)') < 0 &&
    on.indexOf('function v3BriefHtml(code)') >= 0);
  chk('★ 展开区渲染持仓详情（v3DetailHtml）', on.indexOf('v3DetailHtml(h.code)') >= 0);
  chk('★ 旧透视渲染调用已下线、函数保留可回退（chipBriefHtml/chipDetailHtml 只剩定义）',
    on.indexOf('chipBriefHtml(h.code)') < 0 && on.indexOf('chipDetailHtml(h.code)') < 0 &&
    on.indexOf('function chipBriefHtml(code)') >= 0 && on.indexOf('function chipDetailHtml(code)') >= 0);
  chk('V3 三源：当日涨跌（行情）/ 当日主力净额（东财 fflow）/ 20 日趋势（腾讯日K）',
    on.indexOf('fetchDailyBars(h.code, V3_BARS)') >= 0 && on.indexOf('push2his.eastmoney.com') >= 0 &&
    /* 2026-09-20「只留结论」：三源明细格（①②③）已撤下界面，但取数管道与翻译函数必须还在 */
    on.indexOf('v3sign(q.chg)') >= 0 && on.indexOf('v3sign(mainNet)') >= 0 &&
    on.indexOf('v3sign(v.ret20)') >= 0 && on.indexOf('function v3SrcNote(') >= 0 &&
    onNoCmt.indexOf('① 当日涨跌') < 0);
  chk('V3 常量与 mobile_monitor 同源（AGREE_RATIO=0.66 / MIN_SOURCES=2 勿改）',
    on.indexOf('V3_AGREE_RATIO = 0.66') >= 0 && on.indexOf('V3_MIN_SOURCES = 2') >= 0);
  chk('V3 判定三态齐备：主信号 / 数据冲突下修 / 源不足观察（+趋势持有）',
    ["'normal'", "'downgrade'", "'observe'", "'trend'"].every(s => on.indexOf(s) >= 0));
  chk('★ 趋势跟随条件：连续 ≥3 天冲突 + 20 日涨 >15%（对齐 v3_engine.run）',
    on.indexOf('v.conflictDays >= 3') >= 0 && on.indexOf('v.ret20 > 0.15') >= 0);
  chk('V3 冲突天数跨日持久 + 同日幂等（localStorage v3_state，对齐 scheduler.daily_job）',
    on.indexOf('sa_v3_state_v1') >= 0 && on.indexOf('rec.lastDate !== today') >= 0 &&
    on.indexOf('old && old.at === today') >= 0);
  chk('★ 数据缺失不伪造：有效源不足 2 个只观察、冲突计数不动',
    on.indexOf("v.state = 'observe'") >= 0 && on.indexOf("if(srcs.length < V3_MIN_SOURCES)") >= 0);
  /* ★ 2026-09-22 二次改版：v3Ensure 不再自动调用 —— V3 全界面撤下后 G.v3Map 已无消费者，
     继续跑只会给每只持仓多发 2 个请求（东财资金流 JSONP 易限流）而用户什么也看不到。
     算法与入口函数全部保留（v3Sig/v3Busy 幂等保护仍在），随时可一行接回来。 */
  chk('★ V3 入口已停止自动调用（产出无消费点，省每只 2 个请求）；函数与幂等保护保留',
    /chipEnsure\(\)/.test(on) && !/^\s*v3Ensure\(\)/m.test(on) &&
    on.indexOf('async function v3Ensure(') >= 0 &&
    on.indexOf('G.v3Sig') >= 0 && on.indexOf('G.v3Busy') >= 0);
  /* 2026-09-20「只留结论」：三源明细 / 共识票数 / 冲突天数 / 置信度属推理中间量，已从详情页撤下 */
  /* ★ 2026-09-22 二次改版：详情页顺序改成 ①阶段 → ②中长线 → ③散户 → ④股东；
     「主力」行（V3）整行撤下，综合研判与大盘两行也撤下 —— 界面上不再有两个互相矛盾的方向结论。 */
  chk('★ 详情页只留 阶段 / 中长线 / 散户 / 股东，推理中间量与记账信息全部撤下',
    on.indexOf("阶段 → '") >= 0 && on.indexOf('h += retailLineHtml(code)') >= 0 &&
    on.indexOf('中长线 → ') >= 0 && on.indexOf('h += holderLineHtml(code)') >= 0 &&
    on.indexOf('cd-act') >= 0 &&
    /* ★ 二次改版负断言：「主力（参考）」行已不在详情页（必须判去注释源码） */
    onNoCmt.indexOf('主力（参考）') < 0 &&
    /* 2026-09-20 追加撤下：风险控制（止损位）与仓位那两行 */
    /* ⚠️ 必须判**调用**（h += …），不能只搜函数名——`function mlStopHtml(code){` 的定义本身就含
       `mlStopHtml(code)`，按函数名搜会永远失败（这两个函数是刻意保留可回退的）。 */
    onNoCmt.indexOf('h += mlStopHtml(code)') < 0 && onNoCmt.indexOf('h += mlPositionHtml(code, ws)') < 0 &&
    onNoCmt.indexOf('多源共识') < 0 && onNoCmt.indexOf('冲突天数') < 0 &&
    (function () { /* 详情页整段不得再拼任何指标格（cd-row / cd-v）*/
      const i = on.indexOf('function v3DetailHtml(');
      if (i < 0) return false;
      const j = on.indexOf('function demoV3Data(', i);
      const seg = on.slice(i, j > i ? j : i + 9000);
      return seg.indexOf('cd-row') < 0 && seg.indexOf('cd-v') < 0;
    })());
  /* ★ 2026-09-22 新增：两融余额变化（持仓股）—— 用户要求「持仓股票加上这只股票的两融余额变化分析」。
     数据源东财 datacenter-web RPTA_WEB_RZRQ_GGMX：**无 CORS 但支持 JSONP(callback=)**
     ⇒ 浏览器可直连，不走云端落档（与股东户数那条「必须走云端」的路子相反）。 */
  chk('★ 两融余额行已接进详情页，顺序 散户 → 两融 → 股东',
    on.indexOf('function rzrqLineHtml(') >= 0 &&
    on.indexOf('h += rzrqLineHtml(code)') >= 0 &&
    (function () {
      const i = on.indexOf('function v3DetailHtml(');
      if (i < 0) return false;
      const j = on.indexOf('function demoV3Data(', i);
      const seg = on.slice(i, j > i ? j : i + 9000);
      const a = seg.indexOf('retailLineHtml(code)'), b = seg.indexOf('rzrqLineHtml(code)'), c = seg.indexOf('holderLineHtml(code)');
      return a > 0 && b > a && c > b;
    })());
  chk('★ 两融走 JSONP 直连且显式传 callback 参数名（datacenter-web 用 cb= 会退回纯 JSON ⇒ 永远超时）',
    on.indexOf('RPTA_WEB_RZRQ_GGMX') >= 0 &&
    on.indexOf("jsonp(rzrqUrl(code), 'callback')") >= 0 &&
    on.indexOf('function jsonp(url, param)') >= 0 &&
    on.indexOf("(param || 'cb')") >= 0);
  chk('★ 两融加载幂等（sign+busy）且在持仓页触发 —— 不幂等会让 renderHoldings 无限重画',
    on.indexOf('async function rzrqEnsure(') >= 0 &&
    on.indexOf('RZRQ.busy') >= 0 && on.indexOf('RZRQ.sig === sig') >= 0 &&
    (function () {
      const i = on.indexOf('function renderHoldings(');
      if (i < 0) return false;
      const j = on.indexOf('function bindHoldingCards(', i);
      return on.slice(i, j > i ? j : i + 3000).indexOf('rzrqEnsure()') >= 0;
    })());
  chk('★ 两融是纯展示：阶段 / 中长线 / 综合研判 / 排序里都不读它（按函数段判，不误伤相邻函数）',
    (function () {
      const fns = ['stageOf', 'stageFeat', 'weekStage', 'fusionVerdict', 'v3Head'];
      for (const fn of fns) {
        const i = onNoCmt.indexOf('function ' + fn + '(');
        if (i < 0) continue;
        const j = onNoCmt.indexOf('\nfunction ', i + 10);
        const seg = onNoCmt.slice(i, j < 0 ? i + 6000 : j).toLowerCase();
        if (seg.indexOf('rzrq') >= 0) return false;
      }
      return true;
    })());
  chk('★ 两融缺字段不硬编 0：ETF 的 RZYEZB 是 null，必须先判 null 再转数字（Number(null)===0 的坑）',
    on.indexOf('function rzrqNorm(') >= 0 &&
    on.indexOf("(zr == null || zr === '') ? null : Number(zr)") >= 0);
  chk('★ 展示层：三源翻译成交易行为词（拉升/吸筹/建仓区…），不再干巴巴说方向',
    on.indexOf('function v3SrcNote(') >= 0 && on.indexOf('function v3Head(') >= 0 && on.indexOf('function v3Sub(') >= 0 &&
    ['拉升', '回落', '吸筹', '派发', '建仓区', '阴跌'].every(k => on.indexOf(k) >= 0));
  chk('★ 展示层：主标题覆盖五类核心场景（放量突破/回补吸筹/拉高诱多/主力持续派发/高位出货完毕）',
    ['放量突破', '回补吸筹', '拉高诱多', '主力持续派发', '高位出货完毕'].every(k => on.indexOf(k) >= 0));
  chk('★ 展示层：用户点的口语词都在（弱回流/良性回踩/撤退嫌疑/低位吸筹/主力建仓拉升）',
    ['弱回流', '良性回踩', '撤退嫌疑', '低位吸筹', '主力建仓拉升'].every(k => on.indexOf(k) >= 0));
  chk('★ 展示层：操作建议结合自己的持仓成本（出厂前文案必须带上成本）',
    on.indexOf('function v3Advice(') >= 0 && on.indexOf('PC.fmtNum(h.cost, 2)') >= 0 &&
    on.indexOf('浮盈') >= 0 && on.indexOf('已被套') >= 0);
  chk('★ ★ 展示层不编目标价 —— v3Advice 全文只讲已发生的事实，不含「目标价」三字', (function () {
    var i = on.indexOf('function v3Advice(');
    if (i < 0) return false;
    var body = on.slice(i, i + 1400);
    var j = body.indexOf('function v3BriefHtml(');   // 截到下一个函数为止
    return (j > 0 ? body.slice(0, j) : body).indexOf('目标价') < 0 && i >= 0;
  })());
  chk('★ 展示层：缺源如实说「缺数据」，不伪装成走平', on.indexOf('缺数据') >= 0);
  chk('★ 价格结构 v2.1 已移植上线（与 mobile_monitor Python 引擎同口径）',
    on.indexOf('function v3PsRow(') >= 0 && on.indexOf('function psCalc(') >= 0 &&
    on.indexOf('PS_VR_LOW = 1.2') >= 0 && on.indexOf('PS_VR_HIGH = 3.0') >= 0 &&
    on.indexOf('PS_PCT_JUMP = 7.0') >= 0 && on.indexOf('PS_VR_REV = 1.5') >= 0);
  chk('★ 价格结构四增强齐备：诱多硬过滤/破位硬条件/VR加分+天量待确认/反转首日豁免',
    on.indexOf('force_no_trade') >= 0 && on.indexOf('sell_bias') >= 0 &&
    on.indexOf('reversal_exempt') >= 0 && on.indexOf('pending_confirm') >= 0);
  chk('★ 持仓页不再显示「V3」版本号标识（2026-09-19 用户要求）',
    on.indexOf('chip-title">主力博弈 V3') < 0 && on.indexOf("'以 V3 为准'") < 0 &&
    on.indexOf("ev-k\">V3") < 0 &&
    /* ★ 2026-09-22：连「主力博弈」这个块标题本身也去掉了（顺序改成中长线在前，整块再叫它已不成立） */
    on.indexOf('chip-title">主力博弈') < 0);
  chk('★ 散户行为行已放回（2026-09-19）：首页短标签 + 详情完整说明，且纯展示不参与 V3 投票',
    on.indexOf('function retailLineHtml(') >= 0 && on.indexOf('h += retailLineHtml(code)') >= 0 &&
    on.indexOf('ev-k">散户') >= 0 && on.indexOf('shortTag(rtChip.tag)') >= 0 &&
    on.indexOf("G.chipMap && G.chipMap[code]") >= 0 && on.indexOf('V3_AGREE_RATIO = 0.66') >= 0);
  /* ★ 2026-09-22 二次改版：散户行**只讲散户** —— 存档 desc 里夹着「而主力正在卖给他们」
     「主力在悄悄给货」这类独立的主力结论，等于在同一张卡里给出第二个方向声音。
     现在按 key/tag 换成本行自己的中性说明（保留事实段：股价变动 + 净买卖金额）。 */
  chk('★ 散户行不再替主力发言：走 retailBody 中性化，不直接输出存档 desc',
    on.indexOf('var RETAIL_TAIL') >= 0 && on.indexOf('function retailBody(') >= 0 &&
    /* ⚠️ 必须**限定在 retailLineHtml 函数体内**判 —— 旧透视 chipDetailHtml 里还留着
       `esc(p.retail.desc)`（该函数已不在界面调用，刻意保留可回退），
       拿全量源码判负断言会永远红（已验证：就踩在这上面）。 */
    (function () {
      var i = on.indexOf('function retailLineHtml(');
      if (i < 0) return false;
      var j = on.indexOf('function holderTrendSvg');
      var seg = on.slice(i, j > i ? j : i + 2500);
      var segNo = seg.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      return segNo.indexOf('esc(retailBody(') >= 0 && segNo.indexOf('p.retail.desc') < 0;
    })());
  chk('★ 散户行切分要兼容三种分隔符（破折号带/不带空格 + 逗号带出主力分句），否则整段原样漏出',
    on.indexOf("' —— ', '——', '，主力', ',主力'") >= 0);
  chk('★ 云端同源 chip-core.js 的散户 desc 也已中性化（判定条件/tone/key 未动）',
    on.indexOf('不再写「而主力正在卖给他们」') >= 0);
  /* ★ 2026-09-22：综合研判 F4 的**算法层**全部保留（首页「综合」行仍在消费），
     但持仓详情页不再渲染这一行 —— 用户要求去掉（它常与主力博弈打架，看得到反而干扰判断）。 */
  chk('★ 综合研判 F4 算法层仍在（2026-09-22 起详情页撤下渲染，首页「综合」行仍在消费）',
    on.indexOf("FUSION_VERSION = 'F4'") >= 0 && on.indexOf('function fusionVerdict(') >= 0 &&
    on.indexOf('ev-k">综合') >= 0 &&
    on.indexOf("why:'破位+主力派发'") >= 0 && on.indexOf("fvD.pullback ? '（回踩）'") >= 0 &&
    on.indexOf('retailLineHtml') >= 0 &&
    /* 详情页已撤下：负断言必须判**去注释**源码（注释里提过「综合研判」会误伤 raw 断言） */
    onNoCmt.indexOf('综合研判（次要参考）') < 0 && onNoCmt.indexOf('以上面主力博弈为准') < 0);
  /* ★ 2026-09-22 二次改版：持仓详情重排 —— 阶段最先、中长线其次，主力行撤下，不再挂块标题 */
  chk('★ 持仓详情：阶段渲染在中长线之前，主力行撤下，且整块不再挂「主力博弈」标题',
    (function () {
      const vd = onNoCmt.match(/function v3DetailHtml\(code\)\{[\s\S]*?\n\}/);
      if (!vd) return false;
      const b = vd[0];
      const iSt = b.indexOf('阶段 → '), iMl = b.indexOf('中长线 → ');
      return iSt > 0 && iMl > iSt && b.indexOf('chip-title') < 0 &&
        b.indexOf('mlToneClass(ws.key)') >= 0 &&
        /* 主力行撤下：详情页不得再引用 V3 的任何产出（v3Head / G.v3Map） */
        b.indexOf('v3Head(') < 0 && b.indexOf('G.v3Map') < 0 &&
        /* 大盘环境行也一并撤下（首页驾驶舱卡已承担） */
        b.indexOf('mlMarketCtx()') < 0;
    })());
  chk('★ 中长线按信息类型分色：四态四色（蓝=建仓区 / 橙=高位过热 / 紫=下跌未完 / 灰=趋势中）',
    on.indexOf('function mlToneClass(') >= 0 && on.indexOf('mlToneClass(ws.key)') >= 0 &&
    on.indexOf('.cd-act.mlk-buy{') >= 0 && on.indexOf('.cd-act.mlk-sell{') >= 0 &&
    on.indexOf('.cd-act.mlk-wait{') >= 0 && on.indexOf('.cd-act.mlk-flat{') >= 0 &&
    on.indexOf('.ev-line .mlk-buy{') >= 0);
  /* ★ 2026-09-22 二次改版：V3 主力行撤下，首页持仓行变成 阶段 → 中长线 → 5日线 → 散户
   * ★ 2026-10-10：持仓块已从 renderDash **整段抽到 homeHoldBlock(map)**（为把它移到首页最后），
   *   所以断言必须改成取 homeHoldBlock 段。⚠️ 原来用 `/function renderDash\(map\)\{[\s\S]*?\n\}/`
   *   非贪婪匹配，抽走后只能匹配到 renderDash 内第一个 `\n}` ⇒ 段里根本没有持仓行，会假红。
   *   这里**不是放宽标准**：阶段/中长线/5日线/散户的顺序、主力行必须缺失、两个高亮标记，
   *   一条不少，只是换了被断言的位置。 */
  chk('★ 首页持仓行顺序 = 阶段 → 中长线 → 5日线 → 散户（主力行已撤下），5 日线提醒整行高亮 + 「重点」标记',
    (function () {
      const b = between(onNoCmt, 'function homeHoldBlock(map){', 'function renderDash(map){');
      if (b.length < 500) return false;
      const pSt = b.indexOf('ev-k">阶段'), pMl = b.indexOf('ev-k">中长线'),
        p5 = b.indexOf('ev-k">5日线'), pMn = b.indexOf('ev-k">主力'), pRt = b.indexOf('ev-k">散户');
      return pSt > 0 && pMl > pSt && p5 > pMl && pRt > p5 &&
        /* ★ 二次改版：主力行必须已经没有（否则又会与阶段行互相矛盾） */
        pMn < 0 &&
        b.indexOf('ev-hot5') >= 0 && b.indexOf('pill ev-hot') >= 0;
    })());
  chk('★ CSS 定义 .ev-line.ev-hot5（5 日线高亮是实体样式，不是空 class）',
    on.indexOf('.ev-line.ev-hot5{') >= 0);
  chk('★ 中长线关键位置引擎 S2（2026-09-20 换版）：周/月级四维度 + 波段定性（本态第 N 天）',
    on.indexOf("STAGE_VERSION = 'S2'") >= 0 && on.indexOf('function weekStage(') >= 0 &&
    on.indexOf('ev-k">中长线') >= 0 && on.indexOf('中长线 → ') >= 0 &&
    on.indexOf('sa_ml_state_v1') >= 0 &&
    on.indexOf('function mlRunDays(') >= 0 && on.indexOf('波段定性') >= 0 &&
    on.indexOf("' · 第 ' + rd + ' 天'") >= 0);
  chk('★ 阶段信号有效性统计（2026-09-25）：StageCore 注入块 + 首页统计卡片 + localStorage 快照',
    on.indexOf('/* ==== STAGE-CORE-BEGIN ==== */') >= 0 &&
    on.indexOf('stageStatsFromFeeds') >= 0 &&
    on.indexOf('function stageStatsCard(') >= 0 &&
    on.indexOf('function computeStageStats(') >= 0 &&
    on.indexOf("sa_stage_stats_v1") >= 0 &&
    on.indexOf('阶段信号有效性 · 历史统计') >= 0);
  chk('★ 2026-09-25 线上事故双修复：UMD 前导分号（防 ASI 把 var x=2 拼成 2(...)）+ G.dayBars 未就位防护',
    on.indexOf(';(function (root, factory) {') >= 0 &&
    on.indexOf('(G.dayBars || {})[hs[i].code]') >= 0);
  chk('★ S2 建仓区位置闸门（剔除「暴涨暴跌后半山腰当低位」）+ 已删掉被证明冗余的「60日涨<15%」',
    on.indexOf('var ML_LOW_GATE = 0.30') >= 0 && on.indexOf('premLow < ML_LOW_GATE') >= 0 &&
    on.indexOf('premLow') >= 0 && on.indexOf('+24.6%') >= 0 &&
    onNoCmt.indexOf('ret60 < 0.15') < 0);
  chk('★ S2 同周期支撑/压力 + 高位过热卖点（替换旧「派发完毕」）',
    on.indexOf('var ML_SUP_GATE = 0.15') >= 0 && on.indexOf('supDist < ML_SUP_GATE') >= 0 &&
    on.indexOf('wLo20') >= 0 && on.indexOf('wHi20') >= 0 &&
    on.indexOf('topWarn') >= 0 &&
    on.indexOf('var ML_SELL_MA5 = 0.05') >= 0 && on.indexOf("m.key = 'sell-overheat'") >= 0 &&
    on.indexOf('distribute-done') < 0);
  chk('★ S2 卖点区间级口径（躲对率 76%）+ 旧「派发完毕」停用原因已写清（躲对率仅 50%）',
    on.indexOf('躲对率 76%') >= 0 && on.indexOf('躲对率仅 50%') >= 0);
  chk('★ S2 买点「说清代价」（每只每年 0.45 段 / 建仓期平均还要浮亏 −2.9%）',
    on.indexOf('0.45 段') >= 0 && on.indexOf('0.45 次') >= 0 && on.indexOf('2.9%') >= 0);
  /* ★ 2026-09-20 晚：持仓不再记成本 → 止损位失去基准，风控块从详情页撤下
     （mlStopLoss / mlStopHtml 保留在代码里可回退，只是不再被调用）*/
  chk('★ S2 风控已撤下界面但仍可回退：ML_STOP 与 mlStopLoss/mlStopHtml 保留，详情页不再调用',
    on.indexOf('var ML_STOP = 0.10') >= 0 && on.indexOf('function mlStopLoss(') >= 0 &&
    on.indexOf('function mlStopHtml(') >= 0 &&
    onNoCmt.indexOf('h += mlStopHtml(code)') < 0);
  chk('★ S2 筹码维度已接入 ChipCore（只展示 + 给卖点分级，不参与触发判定）',
    on.indexOf('mainCost: mainCost, mcDev: mcDev') >= 0 && on.indexOf('m.chipGrade') >= 0 &&
    on.indexOf('mcDev >= 0.15') >= 0 && on.indexOf('chipadd-report') >= 0 &&
    /* 2026-09-20 详情页精简：口径小字撤下界面（分级不触发的保证由上面的 chipGrade 单测锁定）*/
    onNoCmt.indexOf('不参与触发判定') < 0);
  chk('★ S2 大盘环境已接入（恐贪指数 + 风格驾驶舱，只标注、不参与触发）',
    on.indexOf('function mlMarketCtx(') >= 0 && on.indexOf('function mlMarketEnsure(') >= 0 &&
    on.indexOf('function mlFngZone(') >= 0 &&
    /* ★ 2026-09-22：详情页已不再渲染大盘行 ⇒ 改判**首页驾驶舱卡的真实调用/渲染**。
       ⚠️ 必须用 onNoCmt：raw 判会被注释里残留的「大盘风格 / 仅环境标注」字样骗过（假绿）。 */
    onNoCmt.indexOf('var mkD = mlMarketCtx()') >= 0 && onNoCmt.indexOf('仅环境标注') >= 0 &&
    onNoCmt.indexOf('恐贪 ') >= 0 &&
    onNoCmt.indexOf('无法回测') < 0);
  /* ★ 2026-09-20：首页「今日推荐」上方加大盘驾驶舱概览卡，点进驾驶舱详情 */
  chk('★ 首页新增大盘驾驶舱概览卡（排在今日推荐上方，点进驾驶舱详情）',
    on.indexOf('data-act="dash-style"') >= 0 && on.indexOf('大盘驾驶舱') >= 0 &&
    on.indexOf("act === 'dash-style'") >= 0 && on.indexOf('openStyle()') >= 0 &&
    (function(){ /* 概览卡必须排在「今日推荐」之前
        ⚠️ 只在 renderDash 里比顺序：#dash 的**首屏骨架**里也有一份 `dash-h">今日推荐`
        （静态占位卡，位置在文件更前面），搜全文件会把骨架当成渲染顺序。 */
      const i0 = on.indexOf('function renderDash(map)');
      if (i0 < 0) return false;
      /* ★ 2026-09-24：renderDash 顶部新增涨停置顶区块（≈1.4KB），8000 字窗口会把 dash-style 推出界，
         检查意图只是「renderDash 内 驾驶舱卡在今日推荐之前」，窗口放宽到 14000。 */
      const seg = on.slice(i0, i0 + 14000);
      const i = seg.indexOf('data-act="dash-style"');
      const j = seg.indexOf('dash-h">今日推荐');
      return i >= 0 && j >= 0 && i < j;
    })());
  chk('★ 详情页只留结论与状态（2026-09-20 用户要求：小字备注、推理过程、中间指标格全部撤下）',
    on.indexOf('function cdCell(k, v, unit, tone)') >= 0 &&
    on.indexOf('.cd-stat{') >= 0 && on.indexOf('.cd-v.good{') >= 0 &&
    on.indexOf('pos250 > ML_SELL_POS') >= 0 && on.indexOf('mcDev >= 0.15') >= 0 &&
    (function(){
      const i = on.indexOf('function v3DetailHtml(');
      if (i < 0) return false;
      const j = on.indexOf('function demoV3Data(', i);
      const seg = on.slice(i, j > i ? j : i + 9000);
      /* 判渲染产物：v3DetailHtml 里不得再拼任何 cd-note 小字块 */
      return seg.indexOf('class="cd-note"') < 0 && seg.indexOf('cd-stat') >= 0;
    })());
  chk('★ 结论文案 **强调** 渲染为粗体（不再把字面星号显示给用户）',
    on.indexOf('function mdB(') >= 0 && on.indexOf('mdB(esc(ws.advice))') >= 0);
  /* ★ 2026-09-20：详情块原来继承了胶囊样式的 border-radius:999px + 1px 边框（「圆弧线框」），已去掉 */
  chk('★ 详情块不再套胶囊「圆弧线框」',
    on.indexOf('.chip.cd-block{') >= 0 && on.indexOf('class="chip cd-block"') >= 0);
  /* ★ 2026-09-20 晚：仓位那一行也撤下界面（用户要求），函数保留可回退 */
  chk('★ 仓位一行已撤下界面但仍可回退：mlPositionHtml 保留，详情页不再调用',
    on.indexOf('function mlPositionHtml(') >= 0 &&
    on.indexOf('你自己控') >= 0 && on.indexOf('别全进全出') >= 0 &&
    onNoCmt.indexOf('h += mlPositionHtml(code, ws)') < 0 &&
    on.indexOf('function mlPosTarget(') < 0 && on.indexOf('var ML_BASE') < 0 &&
    on.indexOf('收益 ÷ 回撤') < 0);
  chk('★ S2 大盘懒加载不主动重画（靠行情轮询自然刷新，避免 renderDash 无限循环）',
    (function(){
      const i = on.indexOf('function mlMarketEnsure(');
      if (i < 0) return false;
      const seg = on.slice(i, i + 600);
      return seg.indexOf('renderDash') < 0 && seg.indexOf('renderActive') < 0;
    })());
  chk('★ 短期「综合」已改为只在结论变化时提示（用户为中长线，不做每日信号）',
    on.indexOf("'sa_ml_f4_v1'") >= 0 && on.indexOf('结论有变化') >= 0);
  chk('★ 行情已带流通市值 f21（中长线引擎算「主力净额÷流通市值」需要）',
    on.indexOf('f14,f21') >= 0 && on.indexOf('mv:Number(d.f21)') >= 0);
  chk('★ 中长线引擎复用 chipEnsure 同一份日K（零额外请求）',
    on.indexOf('G.dayBars[h.code] = bars') >= 0 && on.indexOf('G.dayBars && G.dayBars[code]') >= 0);
  chk('★ 持仓结论文案不再带彩色圆点图标（2026-09-19 用户要求，避免半个 emoji 变方块）',
    !/[\u{1F7E2}\u{1F7E1}\u{1F7E0}\u{1F534}\u{26AA}\u{26D4}\u{23F3}\u{FFFD}]/u.test(on));
  chk('★ 结构裁决优先级（硬裁决改写标题，否则以主力博弈为准）+ 无板块数据保守路径',
    on.indexOf('function psRuling(') >= 0 && on.indexOf('不操作(诱多过滤)') >= 0 &&
    on.indexOf('强减仓(破位+主力派发)') >= 0 && on.indexOf('待确认(天量)') >= 0);
  chk('★ 价格结构复用 v3Ensure 同一份日K（零额外请求），演示数据带 ps',
    /var psRow = v3PsRow\(bars\)/.test(on) && on.indexOf('ps:{ score:') >= 0);
  chk('演示模式 V3 数据 demoV3Data（预览/快照可复现）', on.indexOf('function demoV3Data()') >= 0);
  chk('演示模式旧透视数据 demoChipData 保留可回退', on.indexOf('function demoChipData()') >= 0);
  chk('★ 持仓重画保留展开状态（异步回来不收起面板）',
    on.indexOf('var openSet') >= 0 || on.indexOf('openSet[') >= 0);
  chk('V3 配色沿用避开红绿（红涨绿跌语义不被污染）',
    on.indexOf('红/绿') >= 0 || on.indexOf('红涨绿跌') >= 0);

  /* ---------- 持仓 / 推荐 实时价（2026-09-17 用户反馈：这两处都没取实时价） ---------- */
  chk('★ 持仓卡显示实时价（.hg-pxrow 现价 + 当日涨跌）', on.indexOf('hg-pxrow') >= 0 && on.indexOf('.hg-px{font-size:25px') >= 0);
  chk('★ 持仓卡不再有「监控中/未监控」标识', on.indexOf('hg-tag') < 0 && on.indexOf("(mon ? '监控中' : '未监控')") < 0);
  chk('★ 汇总卡不再统计「没开提醒」', on.indexOf('只没开提醒') < 0);
  chk('★ 持仓统计条只报条数（2026-09-20：成本合计已撤）',
    on.indexOf("'共 ' + rows.length + ' 条持仓'") >= 0 && onNoCmt.indexOf('成本合计') < 0);
  chk('★ 推荐卡显示实时价 + 较推荐日涨跌', on.indexOf('较推荐日') >= 0 && on.indexOf('pick-sub') >= 0);
  chk('★ 取价范围已纳入持仓清单（根因修复）', on.indexOf('for(var i2=0;i2<hs.length;i2++) need.push(hs[i2])') >= 0);
  chk('★ 取价范围已纳入推荐存档', on.indexOf('for(var i3=0;i3<pk.length;i3++) need.push(pk[i3])') >= 0);
  chk('行情批量分批抓取（QUOTE_CHUNK=50，避免 URL 过长）', on.indexOf('QUOTE_CHUNK') >= 0);
  chk('★ 行情回来后重渲持仓页/推荐页（否则一直停在加载中）',
    on.indexOf("if($('pgHoldings').classList.contains('on')) renderHoldings(map)") >= 0 &&
    on.indexOf('if(PICKS.data) renderPicks()') >= 0);
  chk('打开推荐页时补齐推荐股行情', on.indexOf('缺价就补一次行情') >= 0);
  chk('演示行情含推荐股 000651（预览/快照可复现）', on.indexOf("'0.000651'") >= 0);

  /* ---------- 归档三层可达性 ---------- */
  const apiUrl = 'https://api.github.com/repos/' + REPO + '/contents/fng-history.json';
  const rApi = await get(apiUrl, { headers: { 'User-Agent': 'accept', ...(GH ? { Authorization: 'token ' + GH } : {}) } });
  let apiDays = null;
  try { const j = JSON.parse(rApi.body); if (j.content) apiDays = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')).days.length; } catch (e) {}
  if (rApi.status === 403) {
    console.log('ℹ️  ① GitHub API 匿名读被限流（HTTP 403），跳过判定 —— 设 GH_TOKEN 可解');
  } else {
    chk('① GitHub API 归档可达', rApi.status === 200 && apiDays > 0, 'status=' + rApi.status + ' days=' + (apiDays || '-'));
  }

  /* ⚠️ jsDelivr 对同一 IP 的密集请求会直接掉连接（status=0）—— 和 GitHub 匿名 403 是同一类问题：
     **瞬时抖动 ≠ 归档不可用**（手工探测同一条 URL 就返回 200）。所以重试 3 次；仍失败打 ℹ️ 不判失败。 */
  let rJsd = { status: 0, body: '' }, jsdDays = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    rJsd = await get('https://cdn.jsdelivr.net/gh/' + REPO + '@main/fng-history.json', { headers: { 'User-Agent': 'accept' } });
    jsdDays = null;
    try { jsdDays = JSON.parse(rJsd.body).days.length; } catch (e) {}
    if (rJsd.status === 200 && jsdDays > 0) break;
    if (attempt < 3) await new Promise(r => setTimeout(r, 1500));
  }
  if (jsdDays > 0) chk('② cdn.jsdelivr.net 归档可达（免鉴权，国内可达）', true, 'status=' + rJsd.status + ' days=' + jsdDays);
  else console.log('ℹ️  jsDelivr 连续 3 次没读到（status=' + rJsd.status + '）—— 属瞬时抖动或同 IP 密集请求被限，' +
    '手工复核同一条 URL 通常返回 200，不计失败');

  const rRaw = await get('https://raw.githubusercontent.com/' + REPO + '/main/fng-history.json', { headers: { 'User-Agent': 'accept' } });
  console.log('ℹ️  raw.githubusercontent.com 状态=' + rRaw.status + '（本网络不可达为已知，已置于备源末位，不判失败）');

  if (apiDays && jsdDays) chk('归档天数一致（API vs jsDelivr）', apiDays === jsdDays, apiDays + '/' + jsdDays);

  /* ---------- 云端代码是否已上线（仓库里有本轮的 V1/V2 文件） ---------- */
  /* ⚠️ 匿名读 GitHub API 会被限流（HTTP 403）。403 说明"没读到"，不等于"文件不在"，
     所以只把 404 判为失败；403 打成提示（设 GH_TOKEN 可解）。 */
  for (const f of ['push.js', 'heartbeat.js', 'position-core.js', 'signal-core.js', 'chip-core.js', 'signals.js', 'screener.js', 'chips.js', 'review.js', 'style.js']) {
    const r = await get('https://api.github.com/repos/' + REPO + '/contents/' + f, { headers: { 'User-Agent': 'accept', ...(GH ? { Authorization: 'token ' + GH } : {}) } });
    if (r.status === 403) { console.log('ℹ️  云端 ' + f + ' 匿名读被限流（HTTP 403），跳过判定'); continue; }
    chk('云端仓库已含 ' + f, r.status === 200, 'status=' + r.status);
  }

  /* 透视存档 chips-history.json（由 chips.js 每日收盘生成；未上线前只提示不判失败） */
  {
    const rC1 = await get('https://cdn.jsdelivr.net/gh/' + REPO + '@main/chips-history.json', { headers: { 'User-Agent': 'accept' } });
    let n = null;
    try { n = Object.keys(JSON.parse(rC1.body).stocks || {}).length; } catch (e) {}
    if (rC1.status === 200 && n) {
      chk('透视存档 chips-history.json 云端可达（含筹码/主力/散户/站队）', n > 0, 'stocks=' + n);
      let one = null;
      try { const j = JSON.parse(rC1.body); one = j.stocks[Object.keys(j.stocks)[0]]; } catch (e) {}
      chk('存档条目结构完整（retail/main/stance 三块判定都在）',
        !!one && !!one.retail && !!one.main && !!one.stance,
        one ? (Object.keys(one).join('/')) : '-');

      /* ★ 2026-09-22：股东人数（holders，季度多期）—— 由 chips.js 抓东财 F10 写入。
         ⚠️ 必须走 API 读：CDN 的 gh 缓存滞后可达数天，用 CDN 会误判成"还没写进去"。
         上线首日归档还没跑，故此条**只提示不判失败**，等归档真带上再断言数量。 */
      let hb = null;
      try {
        const rH = await get('https://api.github.com/repos/' + REPO + '/contents/chips-history.json?ref=main&t=' + Date.now(),
          { headers: { 'User-Agent': 'accept', ...(GH ? { Authorization: 'token ' + GH } : {}) } });
        if (rH.status === 200 && rH.body) {
          const meta = JSON.parse(rH.body);
          if (meta && meta.content) hb = JSON.parse(Buffer.from(String(meta.content).replace(/\s/g, ''), 'base64').toString('utf8'));
        }
      } catch (e) { /* 读不到就退化成提示 */ }
      if (hb && hb.stocks) {
        const ks = Object.keys(hb.stocks);
        let withH = 0, periods = 0;
        for (const k of ks) {
          const h = hb.stocks[k].holders;
          if (Array.isArray(h) && h.length >= 2) { withH++; periods = Math.max(periods, h.length); }
        }
        if (withH > 0) {
          chk('★ 归档含股东人数（holders 多期，最新 ' + periods + ' 期）', withH > 0, withH + '/' + ks.length + ' 只');
        } else {
          console.log('ℹ️  股东人数尚未进归档（holders 0/' + ks.length + ' 只）—— 2026-09-22 起由 chips.js 抓东财 F10 写入，等下一轮 16:05 收盘任务');
        }
      }
    } else {
      console.log('ℹ️  chips-history.json 尚未上线（status=' + rC1.status + '）—— 需先跑 tools/upload.js 传 chip-core.js/chips.js 并首次执行 chips.js');
    }
  }

  /* 风格驾驶舱存档 style-history.json（由 style.js 每日收盘生成；未上线前只提示不判失败） */
  {
    const rS1 = await get('https://cdn.jsdelivr.net/gh/' + REPO + '@main/style-history.json', { headers: { 'User-Agent': 'accept' } });
    let snap = null;
    try { const j = JSON.parse(rS1.body); snap = Array.isArray(j.days) && j.days[j.days.length - 1]; } catch (e) {}
    if (rS1.status === 200 && snap) {
      chk('风格存档 style-history.json 云端可达（style/cycle/picks 齐全）',
        !!snap.style && !!snap.cycle && Array.isArray(snap.picks) && snap.picks.length <= 3,
        'date=' + snap.date + ' style=' + (snap.style && snap.style.name) + ' picks=' + (snap.picks || []).length);
    } else {
      console.log('ℹ️  style-history.json 尚未上线（status=' + rS1.status + '）—— 需先上传 style.js 并首次执行 style.js');
    }
  }

  /* ---------- 推荐机制 v3「共振漏斗」已上线（2026-10-07） ---------- */
  {
    const need = [
      ['RECON 模块存在（漏斗主入口）', /var RECON = \{/, 'reconEnsure'],
      ['L0 涨停池解析抽成纯函数 ztParse（单一真源）', /function ztParse\(pool\)/, 'ztParse'],
      ['指定交易日取池 ztLoadDay 已上线', /var ztLoadDay = async function\(day\)/, ''],
      ['★ 只缓存过去交易日（当日盘中会增长，不许缓存）', /if\(!isToday && ZT_DAY\[day\]\) return ZT_DAY\[day\]/, ''],
      ['炸板池来源 zbLoadDay（弱转强观察）', /var zbLoadDay = async function\(day\)/, ''],
      ['L1 位置指标 reconBars（腾讯前复权日线）', /var reconBars = async function\(code\)/, ''],
      ['L2 分类 reconClassify（A/B/C 三型）', /function reconClassify\(bk, st, q\)/, ''],
      ['位置闸门：p20>55% 只观察', /q\.p20 > 0\.55/, ''],
      ['位置闸门：p20>35% 降级', /q\.p20 > 0\.35/, ''],
      ['低吸门槛 p20<25% 且站上 5 日线', /q\.p20 < 0\.25 && q\.upMa5/, ''],
      ['交易日回溯（当日池空 → 找最近有数据的交易日）', /reconDays\(RECON_LOOKBACK\)/, ''],
      ['候选请求上限 60（高板优先截断）', /var RECON_MAXC = 60/, ''],
      ['渲染：共振漏斗实时区块', /function renderRecon\(\)/, ''],
      ['推荐页新容器 reconBox', /id="reconBox"/, ''],
      ['首页「今日推荐 · 共振漏斗」入口', /今日推荐 · 共振漏斗/, ''],
      ['首页后台预取改成订阅式（修掉「别人在跑我就不管」的死角 · 2026-10-07）',
        /reconWhenReady\(function\(\)\{ renderDash\(G\.quoteMap\) \}\)/, ''],
      ['诚实边界写进页面（1 个月回溯 + 不构成投资建议）', /只回溯约 1 个月/, ''],
      ['核心档阈值未被放宽（n≥6 且 maxLb≥3 且 n2≥3）', /if\(n >= 6 && maxLb >= 3 && n2 >= 3\) return '核心'/, ''],
      ['演示数据 reconDemo（自洽，不联网）', /function reconDemo\(\)/, ''],
      ['旧存档降级为「历史备选存档 · 云端」', /历史备选存档 · 云端/, ''],
      ['保留旧存档排除口径披露（不含 ST、不含科创板）', /不含 ST、不含科创板/, ''],
      ['★ 明确披露共振漏斗不做 ST/科创板剔除（口径差异不许含糊）', /不做 ST \/ 科创板剔除/, '']
    ];
    let miss = 0;
    for (const [name, re] of need) { if (!re.test(on)) { miss++; console.log('❌ 线上缺：' + name); } }
    chk('共振漏斗 v3：' + need.length + ' 项标记全部出现在线上页面', miss === 0, miss ? ('缺 ' + miss + ' 项') : '');
  }

  /* ---------- 风格驾驶舱「★ 主线板块 · 对应个股」已上线（2026-10-07） ----------
     用户原话：「题材主升浪中不仅要有板块，还要有板块对应的优秀个股。不要让我去找个股。」
     背景：云端 style.js 段 4 的优选依赖东财资金流接口，任一环 502 就整条停算
     （09-24 / 09-30 两天恰好都是题材主升浪，线上 pickNote 就是「优选停算：…502 Bad Gateway」）。
     所以驾驶舱必须有一条不依赖云端 cron 的个股来源。 */
  {
    const need2 = [
      ['★ 驾驶舱新增「主线板块 · 对应个股」分区', /主线板块 · 对应个股/, 'styleBoardPicksHtml'],
      ['板块内个股渲染函数已上线', /function styleBoardPicksHtml\(st\)/, ''],
      ['板块内个股按连板高度降序（龙头自然在前）', /\(q\.lbc - p\.lbc\) \|\| \(q\.fund - p\.fund\)/, ''],
      ['云端主线板块置顶并标「云端主线」', /云端主线/, ''],
      ['个股带共振分类徽标（复用 RECON_TYPE_COLOR 单一真源）', /RECON_TYPE_COLOR\[rec\.type\]/, ''],
      ['每只个股有「＋记持仓」入口', /data-act="styHold" data-code=/, ''],
      ['只挂「核心/主升/发酵」达标档板块', /filter\(function\(b\)\{ return RECON_TIER_OK\[b\.tier\] \}\)/, ''],
      ['无达标板块时明说（「无主线」本身是信息，不报错）', /没有「核心 \/ 主升 \/ 发酵」档板块/, ''],
      ['RECON 不可用时给降级说明而不是空白', /拿不到涨停池：/, ''],
      ['诚信边界：1 个月回溯 + 核心档从未触发 + 不构成投资建议', /东财涨停池只回溯约 1 个月/, ''],
      ['★ RECON 完成回调订阅机制（reconWhenReady/reconFlush）', /function reconWhenReady\(cb\)/, ''],
      ['驾驶舱打开时订阅 RECON 完成（不依赖云端 cron）', /reconWhenReady\(function\(\)\{ renderStyle\(\) \}\)/, ''],
      ['演示数据板块带 stocks（空数组会画空卡片）', /B_CAR\.leader = B_CAR\.stocks\[0\]/, '']
    ];
    let miss2 = 0;
    for (const [name, re] of need2) { if (!re.test(on)) { miss2++; console.log('❌ 线上缺：' + name); } }
    chk('驾驶舱主线板块个股：' + need2.length + ' 项标记全部出现在线上页面', miss2 === 0, miss2 ? ('缺 ' + miss2 + ' 项') : '');
  }

  /* ---------- 板块轮动状态看板已上线（2026-10-07） ----------
     用户原话：「告诉我当前市场各板块题材，哪个是在主升、哪个在见顶退潮、哪个在启动、
     哪个在底部衰竭、哪个在资金潜伏、哪个在下跌趋势、哪个在加速高潮……我只要一个可用的结果。」
     数据源：同花顺板块日线（东财 push2his 本机间歇 UND_ERR_SOCKET → 不作判定输入）。
     口径：mf5 比例，跨板块可比；**概念板块成分重叠，故绝不展示净额绝对值**。 */
  {
    const need3 = [
      ['板块轮动页容器 pgRotation', /id="pgRotation"/, ''],
      ['首页入口「板块轮动」（带计数）', /id="rowRotation"/, ''],
      ['入口计数 rotFillCnt（主升/启动）', /function rotFillCnt\(\)/, ''],
      ['八态顺序表 ROT_ORDER（climax→…→range）',
        /var ROT_ORDER = \['climax', 'main', 'ignition', 'accumulate', 'exhaust', 'ebb', 'down', 'range'\]/, ''],
      ['八态文案 + 配色 + 依据 ROT_META', /var ROT_META = \{/, ''],
      ['渲染函数 renderRotation', /function renderRotation\(\)/, ''],
      ['打开函数 openRotation', /function openRotation\(\)/, ''],
      ['云端存档加载 rotLoad', /function rotLoad\(\)/, ''],
      ['云端存档拉取 rotFetchCloud（jsDelivr → GitHub API 双通道）', /function rotFetchCloud\(\)/, ''],
      ['内嵌兜底数据段（云端拉不到也照常可用）', /\/\*ROT_BUILTIN_S\*\//, ''],
      ['按状态分组渲染（含「另有 N 个未列出」如实提示）', /另有 ' \+ \(list\.length - ROT_MAX\)/, ''],
      ['震荡整理默认折叠（默认展开会让榜单被中性板块淹没）', /folded = \(s === 'range'\)/, ''],
      /* ---- 口径守卫 ---- */
      ['★ 标题写明 mf5 定义', /mf5 =（上涨日成交额 − 下跌日成交额）÷ 成交额/, ''],
      ['★ 明确「跨板块可比」', /跨板块可比/, ''],
      ['★ 明确「概念板块成分重叠，故不看净额绝对值」', /概念板块成分重叠，故不看净额绝对值/, ''],
      /* ---- 诚实边界（不许把「主升」包装成买入信号） ---- */
      ['★ 加速高潮后短跑输 + 明确 t 与所过阈值档',
        /此后 5 日跑输板块均值 1\.18%（块自举 t=−3\.14，过 24 规格 α=0\.10 档 2\.99）/, ''],
      ['★ 见顶退潮后短跑输 + 明确过 Bonferroni 3.28',
        /此后 5 日跑输板块均值 0\.19%（块自举 t=−3\.53，过 24 规格 Bonferroni 3\.28）/, ''],
      ['★ 主升标签注明「之后 20 日超额 −0.46%，并不占优」', /回测中该标签之后 20 日超额 −0\.46%（t=−1\.52），并不占优/, ''],
      ['★ 启动标签注明不显著（不夸大）', /回测中之后 20 日超额 −0\.38%（t=−1\.36），不显著/, ''],
      ['★ 资金潜伏标签注明不显著', /回测中之后 20 日超额 −0\.31%（t=−1\.55），不显著/, ''],
      ['★ 下跌趋势注明「之后并未继续跑输」（不迎合直觉）', /该标签之后并未继续跑输（20 日超额 −0\.08%/, ''],
      ['★ 底部衰竭注明「未过多重检验」且给出真实样本量', /块自举 t 仅 \+1\.56、样本仅 1750 板块-日，未过多重检验/, ''],
      ['★ 页面顶部承认预注册序关系被否定', /预注册的「启动≳主升 &gt; 震荡 &gt; 潜伏」序关系被数据否定/, '']
    ];
    let miss3 = 0;
    for (const [name, re] of need3) { if (!re.test(on)) { miss3++; console.log('❌ 线上缺：' + name); } }
    chk('板块轮动看板：' + need3.length + ' 项标记全部出现在线上页面', miss3 === 0, miss3 ? ('缺 ' + miss3 + ' 项') : '');

    /* 负断言：判「渲染代码」，不判数据与注释 */
    const noNetAmt = !/净流入（亿）/.test(on);
    chk('★ 板块轮动页不展示净额绝对值（mf5 口径守卫）', noNetAmt,
      noNetAmt ? '' : '出现「净流入（亿）」——mf5 是比例口径，展示净额会误导');

    /* 内嵌兜底数据必须真有内容（不是空壳），且字段已按当前口径（无已废弃的 net5） */
    const rS = on.indexOf('/*ROT_BUILTIN_S*/'), rE = on.indexOf('/*ROT_BUILTIN_E*/');
    let nState = 0;
    if (rS >= 0 && rE > rS) nState = (on.slice(rS, rE).match(/"state":"/g) || []).length;
    chk('内嵌兜底数据非空（板块状态条数 ≥ 100）', nState >= 100, '条数=' + nState);

    const rEnd = on.indexOf('function renderStyle(');
    const rotJs = (rS >= 0 && rEnd > rS) ? on.slice(rS, rEnd) : '';
    const noNet5 = rotJs.indexOf('net5') < 0;
    chk('★ 已废弃的 net5（净额亿）字段未残留（数据 + 渲染代码）', noNet5,
      noNet5 ? '' : '仍出现 net5 —— 该字段属被否定的口径，必须清干净');
  }

  /* ---------- 当前市场主线 + 个股板块归属（2026-10-08） ----------
     用户原话：「板块这块，你只需要能判断出当前市场的主线是什么，在什么阶段，需要怎么操作，
     哪些个股适合参与即可。」＋「①持仓/自选板块诊断可以先做」。
     口径预注册：_research/rotation/PREREG-MAINLINE.md（5 条硬门槛 + 单键排序，无权重参数）。 */
  {
    const need4 = [
      ['主线卡容器 rotMain（在 rotBody 之前，置顶）', /id="rotMain"><\/div>\s*<div id="rotBody">/, ''],
      ['主线扫描 mainScan', /function mainScan\(\)/, ''],
      ['主线渲染 renderMainline', /function renderMainline\(\)/, ''],
      ['主线个股填充 mainStkFill', /function mainStkFill\(sel\)/, ''],
      ['★ 成分股口径 mainStkOf（主线板块 → 当天涨停股）', /function mainStkOf\(x\)/, ''],
      ['★ 当天涨停集中行业 mainZtTop（零映射聚合）', /function mainZtTop\(k\)/, ''],
      ['★ 个股块标注匹配来源「按成分股比对」', /按成分股比对/, ''],
      ['★ 空态附带「当天涨停最集中的行业」', /当天涨停最集中的行业/, ''],
      ['操作口径表 ROT_DO（8 个状态全覆盖）', /var ROT_DO = \{/, ''],
      ['退潮/过热风险块 mainRiskHtml', /function mainRiskHtml\(\)/, ''],
      ['诚实边界 mainNoteHtml', /function mainNoteHtml\(\)/, ''],
      /* ---- 预注册门槛（改口径会立刻报红） ---- */
      ['★ C1 资金强度 ≥ 95 分位', /Math\.floor\(0\.95 \* \(mf\.length - 1\)\)/, ''],
      ['★ C5 成交额 ≥ 25 分位', /Math\.floor\(0\.25 \* \(amt\.length - 1\)\)/, ''],
      ['★ C3 状态限 启动/主升/资金潜伏', /x\.state === 'main' \|\| x\.state === 'ignition' \|\| x\.state === 'accumulate'/, ''],
      ['★ C4 已持续 ≥ 2 天', /x\.days >= 2/, ''],
      ['★ 排序键只有 mf5（不做加权打分）', /\(b\.mf5 - a\.mf5\) \|\| \(b\.chg5 - a\.chg5\)\s*\}\)\s*\n\s*MAIN\.thrs/, ''],
      ['★ 无主线时如实说「没有形成主线」', /这个交易日没有形成主线/, ''],
      /* ---- 诚实边界（不许把「主线」包装成买入信号） ---- */
      ['★ 明写「这是描述，不是买入信号」', /这是描述，不是买入信号/, ''],
      ['★ 写出 Bonferroni 门槛 |t| > 3.71', /\|t\| &gt; 3\.71/, ''],
      ['★ 写出构念效度的交叉证据（风格驾驶舱 · 汽车零部）', /题材主升浪 · 汽车零部/, ''],
      ['★ 明写「唯一过检验的方向是负向」', /唯一过检验的方向是负向/, ''],
      ['★ 明写涨停池只回溯约 1 个月、无长周期回测支撑', /涨停池只回溯约 1 个月，无长周期回测支撑/, ''],
      ['★ 明写不构成投资建议', /不构成投资建议/, ''],
      /* ---- 操作口径（引用回测，不写主观判断） ---- */
      ['★ 见顶退潮＝规避（唯一过 Bonferroni 的负向信号）', /规避。24 个规格里唯一过 Bonferroni 3\.28 的负向信号/, ''],
      ['★ 加速高潮＝不追高', /不追高；已有仓位考虑减/, ''],
      ['★ 主升明确写「它不是买入信号」', /但它<b>不是买入信号<\/b>/, ''],
      /* ---- 个股 → 板块归属 ----
         ★ 2026-10-10：前两条已改名为**轮动归属**（同花顺码，只用来读轮动状态 / mf5，纯同名匹配）。
            个股「行业 / 题材」归属改走东财官方 BK_MAP —— 校验见 F12 段。 */
      ['轮动归属解码（同花顺码）stkbkDec', /function stkbkDec\(\)/, ''],
      ['轮动归属取板（同花顺码）stkbkPick', /function stkbkPick\(code\)/, ''],
      ['★ 官方归属选择器 bkPick', /function bkPick\(code, k\)/, ''],
      ['★ 官方内嵌表 BK_MAP（东财 BK 码，与资金存档同源）', /var BK_MAP = \/\*BK_MAP_S\*\//, ''],
      ['★ 官方表解码器 bkInit', /function bkInit\(\)/, ''],
      ['持仓/监控卡标签 stkbkTagHtml', /function stkbkTagHtml\(code\)/, ''],
      ['内嵌轮动映射表 STKBK_MAP（同花顺码）', /var STKBK_MAP = \/\*STKBK_HY_S\*\//, ''],
      ['★ 东财接口用 callback= 而非 cb=', /callback=' \+ cb/, ''],
      ['★ 演示模式不联网', /typeof DEMO !== 'undefined' && DEMO/, ''],
      ['持仓卡已接板块标签', /stkbkTagHtml\(h\.code\)/, ''],
      ['监控卡已接板块标签', /stkbkTagHtml\(st\.code\)/, '']
    ];
    let miss4 = 0;
    for (const [name, re] of need4) { if (!re.test(on)) { miss4++; console.log('❌ 线上缺：' + name); } }
    chk('★ 当前主线 + 板块归属：' + need4.length + ' 项标记全部出现在线上页面', miss4 === 0, miss4 ? ('缺 ' + miss4 + ' 项') : '');

    /* 负断言：不许出现「买入 / 推荐 / 建议买」这类把描述包装成信号的措辞 */
    const mainJs = (() => {
      const a = on.indexOf('/*<<<MAINLINE_BEGIN>>>*/'), b = on.indexOf('/*<<<MAINLINE_END>>>*/');
      return (a >= 0 && b > a) ? on.slice(a, b) : '';
    })();
    const noBuy = !/建议买|可以买|值得买|可以介入|稳赚|必涨/.test(mainJs);
    chk('★ 主线模块内不出现「建议买/可以买/必涨」式措辞', noBuy, noBuy ? '' : '出现推荐性措辞 —— 回测不支持');

    /* 内嵌映射必须真有内容（不是空壳） */
    const hs = on.indexOf('/*STKBK_HY_S*/'), he = on.indexOf('/*STKBK_HY_E*/');
    let nStk = 0;
    if (hs >= 0 && he > hs) nStk = (on.slice(hs, he).match(/;/g) || []).length + 1;
    chk('★ 内嵌个股→板块映射非空（覆盖 ≥ 4000 只）', nStk >= 4000, '条数=' + nStk);
  }

  /* ---------- 腾讯日线公网可达（盘中实时用，共振漏斗 L1 位置指标的数据源） ---------- */
  /* ★ 2026-10-07 改域名：`web.ifzq.gtimg.cn` 已被腾讯 **WAF** 整片封成 http 501
     （响应体是 waf.tencent.com/501page.html，IP 级、不是高频限流、不会几小时自愈）。
     同一个接口**去掉 `web.` 前缀**完全正常 → 改用它，让这条断言恢复实际意义。 */
  const rQ = await get('https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000985,day,,,20,qfq', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  let klen = 0;
  try { klen = JSON.parse(rQ.body).data.sh000985.day.length; } catch (e) {}
  if (rQ.status === 501) {
    /* 若连不带 web. 的域名也 501，说明是更外层的 WAF/限流。与 raw.githubusercontent.com 同性质：
       **本网络/本机条件导致，不判代码失败**。其它失败模式（非 200/非 501、超时、bars=0）仍判失败。 */
    console.log('ℹ️  腾讯日线接口 status=501（WAF/限流，非接口改版）—— 不判失败；' +
      '但共振漏斗 L1 位置指标此刻会降级为「位置未知」，属预期降级路径')
  } else {
    chk('腾讯日线接口公网可达（共振漏斗 L1 位置指标数据源）', rQ.status === 200 && klen >= 15, 'status=' + rQ.status + ' bars=' + klen);
  }

  /* ---------- ★ 2026-10-09 六项修复 · 线上验收 ----------
     fix1009-check 验的是**本地**文件；这一段验**线上那一份**，
     防止「改了没发出去 / 发出去的是旧包」。断言只锁语义片段，不锁完整声明行。 */
  {
    /* F1 板块轮动实时更新：ROT_CLOUD_TRIED 与 ROT_DATA 解耦。
       旧实现 `if (ROT_DATA && ROT_DATA.boards…) return`，而启动块会先把内置快照塞进
       ROT_DATA ⇒ 永远早退，页面**永久停在旧日期**，云端更新也读不到。 */
    chk('★ [F1] 线上含 ROT_CLOUD_TRIED（云端存档「是否已尝试」标记）', on.indexOf('ROT_CLOUD_TRIED') >= 0);
    const rotFn = between(onNoCmt, 'function rotLoad()', 'function rotFillCnt');
    chk('★ [F1] rotLoad 早退条件已改为 ROT_CLOUD_TRIED', /if\s*\(\s*ROT_CLOUD_TRIED\s*\)/.test(rotFn));
    chk('★ [F1] rotLoad 不再拿「ROT_DATA 非空」当早退条件（那是永久停在旧快照的根因）',
      !/ROT_DATA\s*&&\s*ROT_DATA\.boards/.test(rotFn));

    /* F2 资金流：多域名通道链 + 两侧独立容错 + 诚实降级文案 */
    chk('★ [F2] 东财通道含多域名回退表 EM_HOSTS', on.indexOf('var EM_HOSTS') >= 0);
    chk('★ [F2] 前 5 个股失败时明说「板块级不受影响」', on.indexOf('板块级的当日 / 当月主力净额不受影响') >= 0);
    chk('★ [F2] 当日增量两侧独立容错（流入 / 流出各自 catch 有独立 tag）',
      on.indexOf('资金流·当日流入侧') >= 0 && on.indexOf('资金流·当日流出侧') >= 0);
    chk('★ [F2] 前 5 个股失败已接入异常日志', on.indexOf('资金流·板块前5个股') >= 0);

    /* F3 首页资金简要：口径月回退 + stale 标记（旧实现只筛当月 → 云端几个月没更新就空榜） */
    chk('★ [F3] flowBriefFromCloud 含口径月回退 mref', on.indexOf('mref') >= 0);
    chk('★ [F3] 卡片标 stale（沿用存档月并如实写出口径月）', on.indexOf('stale') >= 0);

    /* F4 距触发最近已隐藏（代码保留，开关可回退） */
    chk('★ [F4] DASH_NEAR 开关存在且默认 false', /var DASH_NEAR = false/.test(onNoCmt));
    chk('★ [F4] 首页骨架的「距触发最近」区块已用 HTML 注释下线',
      /<!--\s*<div class="dash-h">距触发最近<\/div>/.test(on));
    chk('★ [F4] renderDash 中该模块渲染被 if (DASH_NEAR) 守卫',
      /if \(DASH_NEAR\) \{[\s\S]{0,240}距触发最近/.test(onNoCmt));

    /* F5 题材属性分类（把「融资融券/深股通」这类宽基属性与真题材区分开） */
    chk('★ [F5] 含题材属性分类器（BK_KIND 定义 + bkKind 函数）',
      on.indexOf('BK_KIND') >= 0 && on.indexOf('function bkKind') >= 0);
    chk('★ [F5] 含逐名解释表 BK_KIND_NOTE', on.indexOf('BK_KIND_NOTE') >= 0);
    chk('★ [F5] 详情卡渲染属性块 flowKindBlock', on.indexOf('function flowKindBlock') >= 0);
    chk('★ [F5] 融资融券有明确释义（点明是杠杆资金整体，不代表某题材在崩）',
      /融资融券/.test(on) && /杠杆资金/.test(on));

    /* F6 操作异常日志（系统自检） */
    chk('★ [F6] 异常日志存储键 sa_errlog_v1', on.indexOf('sa_errlog_v1') >= 0);
    chk('★ [F6] 含 logErr / logFlush / logDiagText 三个入口',
      on.indexOf('function logErr') >= 0 && on.indexOf('function logFlush') >= 0 && on.indexOf('function logDiagText') >= 0);
    chk('★ [F6] 捕获同步异常与漏接 Promise', on.indexOf('window.onerror') >= 0 && on.indexOf('unhandledrejection') >= 0);
    chk('★ [F6] token 打码（ghp_ / github_pat_ 脱敏后再入库）',
      on.indexOf('ghp_***') >= 0 && on.indexOf('github_pat_***') >= 0);

    /* ===== F7（2026-10-10）东财被封 → 个股明细改走 datacenter-web 云端预生成 =====
     * 验收要点：**线上那一份**必须真的把「读云端存档」放在主路径、把 push2 个股 clist 降为回退，
     * 并且空态文案不能再甩锅"限流"（真因是 IP 级封禁）。 */
    chk('★ [F7] 个股明细改读云端预生成（flowStkFromCloud 定义 + 调用都在）',
      /* ⚠️ 别写成 'function flowStkFromCloud'：实现是 `var flowStkFromCloud = function(...)`，
         这种「把声明行当字面串」的断言会永久假失败（坑 ⑯，2026-10-10 又踩一次）。 */
      /flowStkFromCloud\s*=\s*function/.test(onNoCmt) && /flowStkFromCloud\(cloud,\s*bk\)/.test(onNoCmt));
    chk('★ [F7] 存档单位换算：万元→元（×1e4）、bp→%（÷100）、null→NaN',
      /\?\s*NaN\s*:\s*r\[2\]\s*\*\s*1e4/.test(onNoCmt) && /\?\s*NaN\s*:\s*r\[3\]\s*\/\s*100/.test(onNoCmt));
    chk('★ [F7] flowFetchStocks 云端兜底仍在（flowCloudRaw + cloud.stk 守卫）',
      (function () {
        const fn = between(onNoCmt, 'var flowFetchStocks = async function', 'var flowFetchZtCount');
        return fn.indexOf('flowCloudRaw') >= 0 && /if\s*\(cloud\s*&&\s*cloud\.stk\)\s*\{/.test(fn);
      })());
    chk('★ [F7] 无 stk 段 → 立即空态（不打被封的接口）',
      /src:\s*'nostk'/.test(onNoCmt) && /src:\s*'miss'/.test(onNoCmt));
    chk('★ [F7] 弹窗按新契约取 rows（st.rows）', /var rows = st\.rows \|\| \[\]/.test(onNoCmt));
    chk('★ [F7] 显式标注「云端预生成 · 数据日」（不让人误读成盘中实时）',
      /云端预生成/.test(on) && /数据日/.test(on) && /<\/div>'\s*\+\s*h/.test(onNoCmt));
    chk('★ [F7] 明说是收盘口径', on.indexOf('非盘中实时') >= 0);
    chk('★ [F7] 来源行样式 .flow-stocks .src 已上线', /\.flow-stocks \.src\{/.test(on));
    chk('★ [F7] 空态如实说「云端存档还没有个股明细段」', on.indexOf('云端存档还没有「个股明细」段') >= 0);
    chk('★ [F7] 旧的「东财接口限流」归因已从个股明细空态移除',
      on.indexOf('常见原因：①东财接口限流') < 0);
    chk('★ [F7] 降级路径记入自检流水（logOp 资金流·个股明细为空）',
      on.indexOf("logOp('资金流·个股明细为空'") >= 0);

    /* ===== F8（2026-10-10）「连续天数塌成 ±1 + 扩散度/★核心消失」的修复 =====
     * 报障原话：「流入的数据都是连续3天的，现在变成1天了…每一行都显示了核心、扩散度的情况，
     *   现在又没了」。两重根因：日档断档（当月累计退化） + 扩散度只有东财实时一个来源（被封后全空）。
     * 验收要点：线上必须①把云端收盘口径的板块状态接进扩散度/领涨，并**显式标「收」**；
     *   ②页头覆盖度三态，不许在 nTrade 缺失时谎称「全月真值」。 */
    chk('★ [F8] 扩散度/领涨支持云端兜底（flowBreadthCopy 三参数）',
      /function flowBreadthCopy\(b,\s*rt,\s*bs\)/.test(onNoCmt));
    chk('★ [F8] 优先级：实时 > 云端（useRt / useBs 判定）',
      /var useRt = !!\(rt && isFinite\(rt\.nUp\)/.test(onNoCmt) && /var useBs = !useRt && !!\(bs && bs\.length >= 7/.test(onNoCmt));
    chk('★ [F8] 来源标记 live/cloud（收盘口径不冒充实时）',
      /b\.brSrc = useRt \? 'live' : \(useBs \? 'cloud' : ''\)/.test(onNoCmt));
    chk('★ [F8] 领涨涨幅由存档 bp 换算成 %（bs[6] / 100）',
      /bs\[6\] \/ 100/.test(onNoCmt));
    chk('★ [F8] 行内「扩散 X%」带「收」标记（class="cal" + title 说明口径）',
      on.indexOf('class="cal" title="云端收盘口径自算') >= 0);
    chk('★ [F8] .cal 样式已上线', /\.flow-rk \.ztc \.cal\{font-style:normal/.test(on));
    chk('★ [F8] 图例解释「带 收 = 云端收盘口径自算」', on.indexOf('带 <b>收</b> = 云端收盘口径自算') >= 0);
    chk('★ [F8] 云端板块状态表接入榜单（cst = cloud.stk.s）',
      /var cst = \(cloud\.stk && cloud\.stk\.s\) \|\| null/.test(onNoCmt));
    chk('★ [F8] 当月累计覆盖度：每板块 nCov 已进榜单对象', /nCov:mon\[bk2\]\[2\]/.test(onNoCmt));
    chk('★ [F8] 页头覆盖度三态：完整 / 不完整 / 未知',
      on.indexOf("'当月累计·覆盖度未知'") >= 0 &&
      on.indexOf("个交易日（不完整，云端回补中）") >= 0 &&
      on.indexOf("'当月累计·全月真值（' + nTrade + ' 个交易日）'") >= 0);
    chk('★ [F8] 旧的两态写法已下线（nTrade 缺失时会口径造假成「全月真值」）',
      !/var covTxt = \(nTrade && covMed < nTrade\)/.test(onNoCmt));

    /* ===== F9（2026-10-10）优先级铁律 + 领涨并列 =====
     * 用户原话：「数据如果东财的是比较优秀的，就要优先获取东财，只有获取不到才选备用接口。
     *   不是把东财去掉。」+「领涨的对吗，锂矿概念，之前显示的领涨是科力远。」
     * 两件事：① 个股明细必须**东财优先 → 失败记忆(冷却 10min) → 云端兜底 → 冷却到期自动再试东财**
     *   （恒读存档 = 东财一旦恢复也切不回去 = 违背铁律）；② 板块内涨幅并列时取谁必须**确定性**
     *   （净额↓ → 代码↑），否则成分表返回顺序一变结论就变（不可复现）。 */
    /* ⚠️ 2026-10-10 二次改写：为「优先东财」又「不让首屏拖死」，最终实现是
         ① var cloudP = flowCloudRaw() 先**并行预取**存档 → ② 带 1.5s 硬预算打东财
         → ③ await cloudP 取兜底。⇒ 判据只能是「东财的等待/判定在云端**取用**之前」，
         不能再要求「在 flowCloudRaw 字面之前」（那是并行预取，不是优先读云端）。 */
    chk('★ [F9] 并行预取存档 → 打东财 → 再取存档（东财判定在云端取用之前）',
      (function () {
        const fn = between(onNoCmt, 'var flowFetchStocks = async function', 'var FLOW_ZTMAP = {}');
        /* ★ 2026-10-10：变量名由 cloudP 改为 cloudP2（cloudP 成了可选入参），
           判据从「字面 var cloudP = flowCloudRaw()」改为「段内首次 flowCloudRaw()」+
           「await cloudP2」。顺序要求一条不少：预取 → 东财 → await 兜底。 */
        const iCp = fn.indexOf('flowCloudRaw()');
        const iP = fn.indexOf('push2.eastmoney.com');
        const iC = fn.indexOf('await cloudP2');
        return fn.length > 200 && iCp >= 0 && iP > iCp && iC > iP;
      })());
    chk('★ [F9] 东财仍按主力净额 f62 降序取前 5（官方口径不变）',
      /fid=f62/.test(onNoCmt) && /fs=b:'\s*\+\s*bk/.test(onNoCmt));
    chk('★ [F9] 失败记忆：冷却常量 10 分钟已上线', /var STK_COOL_MS = 10 \* 60 \* 1000/.test(onNoCmt));
    chk('★ [F9] 冷却窗内跳过东财（不白等）',
      /if\(Date\.now\(\) >= \(FLOW\.stkCoolUntil \|\| 0\)\)\{/.test(onNoCmt));
    chk('★ [F9] 东财成功即清零冷却（冷却到期自动再试东财）',
      /FLOW\.stkCoolUntil = 0; return \{ rows: diff\.slice\(0,5\), src:'live'/.test(onNoCmt));
    chk('★ [F9] 东财失败写冷却时间戳',
      /FLOW\.stkCoolUntil = Date\.now\(\) \+ STK_COOL_MS/.test(onNoCmt));
    chk('★ [F9] 东财失败记入自检流水（logOp 资金流·个股明细东财失败）',
      on.indexOf("logOp('资金流·个股明细东财失败'") >= 0);
    chk('★ [F9] 领涨并列只数已接入（b.nLead，读存档第 8 位 bs[7]）',
      /b\.nLead = \(useRt \|\| !useBs\) \? 0 : \(bs\[7\] > 1 \? bs\[7\] : 0\)/.test(onNoCmt));
    chk('★ [F9] 并列时界面如实标注「（并列N只）」（榜单行 + 详情卡两处）',
      (on.match(/（并列' \+ b[0-9]?\.nLead \+ '只）/g) || []).length >= 2);

    /* ===== F10（2026-10-10 第二轮）四项报障的线上锁 =====
     * 用户原话：「1.资金流向的板块，点击没反应，打不开前5个股的明细了。2.首页的股票价格触达监控
     *   去掉，但是页面要在更多里能找到。3.板块轮动页面的数据还是停留在9月30号。
     *   4.首页持仓股中需要增加显示该股票所在的板块题材资金流入流出情况，天数，板块阶段是。」
     * ① 根因：把「东财优先」实现成了「**无限期等**东财」——emGet = 4 域名 fetch(各 10s) +
     *   2 域名 JSONP(各 10s)，单次最坏 60s，再 ×2 次重试 = 120s ⇒ 用户看到的是「点击没反应」。
     *   修法（用户拍板）：1.5s 硬预算 + 云端**并行**预取 + 这一层取消重试（失败已有 10 分钟冷却兜底）。 */
    chk('★ [F10] 东财硬预算常量 1.5s 已上线', /var STK_EM_BUDGET_MS = 1500/.test(onNoCmt));
    chk('★ [F10] 通用硬预算包装器 flowWithBudget(p, ms, tag) 存在',
      /var flowWithBudget = function\(p, ms, tag\)/.test(onNoCmt));
    chk('★ [F10] 东财调用套上硬预算（不再无限期等）',
      /flowWithBudget\(emGet\(url\), STK_EM_BUDGET_MS, '东财个股明细'\)/.test(onNoCmt));
    chk('★ [F10] 个股明细这一层不再 flowRetry（重试会把 60s 上限翻倍成 120s）',
      (function () {
        const fn = between(onNoCmt, 'var flowFetchStocks = async function', 'var FLOW_ZTMAP = {}');
        return fn.length > 200 && fn.indexOf('flowRetry') < 0;
      })());
    chk('★ [F10] 云端存档并行预取 → 东财 → 再取存档（两段耗时不相加）',
      (function () {
        const fn = between(onNoCmt, 'var flowFetchStocks = async function', 'var FLOW_ZTMAP = {}');
        /* ★ 2026-10-10：同 [F9] —— 变量改名 cloudP→cloudP2，判据改为首次 flowCloudRaw()。 */
        const iCp = fn.indexOf('flowCloudRaw()');
        const iP = fn.indexOf('push2.eastmoney.com');
        const iC = fn.indexOf('await cloudP2');
        return iCp >= 0 && iP > iCp && iC > iP;
      })());
    /* ★ [F13 补充] 弹窗路径同样必须「并行预取 → 东财 → 兜底」——
     *   这是本轮修复的核心，且**只能**在 flowOpenSheet 里成立（首屏 flowLoad 是另一条链）。 */
    chk('★ [F13] 弹窗路径也是「并行预取 → 明细 → 谁先到用谁」（与首屏同口径）',
      (function () {
        const fn = between(onNoCmt, 'var flowOpenSheet = async function', '\nvar ');
        const iCp = fn.indexOf('flowCloudRaw()');
        const iF = fn.indexOf('flowFetchStocks(bk, cloudP)');
        return fn.length > 200 && iCp >= 0 && iF > iCp;
      })());
    /* ② 价格触达监控：首页撤下，入口移到「更多」 */
    chk('★ [F10] 「更多」面板里有「价格触达监控」入口', /id="rowMonitor"><span>价格触达监控<\/span>/.test(on));
    chk('★ [F10] 该入口带条数（mCnt）', /<span class="cnt" id="mCnt">/.test(on));
    chk('★ [F10] 点击 → 关面板 + 打开全部监控清单',
      /\$\('rowMonitor'\)\.addEventListener\('click', function\(\)\{ closeSheet\(\); openFullList\(\) \}\)/.test(onNoCmt));
    /* ③ 板块轮动不再停在 9/30（实测 jsDelivr CDN 会返回陈旧 commit：当天 09:53 那版只有 277/589 板块） */
    chk('★ [F10] 取数顺序 = GitHub API → raw → jsDelivr（CDN 陈旧的 jsDelivr 不再排链首）',
      (function () {
        const rf = between(onNoCmt, 'function rotFetchCloud()', 'function rotLoad()');
        const a = rf.indexOf('api.github.com/repos/zyhaaad/stock-alert/contents/rotation.json');
        const b = rf.indexOf('raw.githubusercontent.com');
        const c = rf.indexOf('cdn.jsdelivr.net');
        return a >= 0 && b > a && c > b;
      })());
    chk('★ [F10] 新鲜度守卫：云端比内嵌快照还旧时不许覆盖（页面不能往回退）',
      /var older = !!\(ROT_BUILTIN && ROT_BUILTIN\.date && j\.date && String\(j\.date\) < String\(ROT_BUILTIN\.date\)\)/.test(onNoCmt));
    chk('★ [F10] 页头有独立降级提示位 rotHint', /id="rotHint"/.test(on));
    chk('★ [F10] 内嵌兜底快照已刷新（不再是 9/30）',
      (function () {
        const m = on.match(/var ROT_BUILTIN = \/\*ROT_BUILTIN_S\*\/\{"v":1,"src":"ths","date":"(\d{8})"/);
        return !!m && m[1] > '20260930';
      })());
    /* ④ 持仓卡的「板块 · 阶段 · 资金」行（零额外请求，全用已到手的存档/映射） */
    chk('★ [F10] holdFlowStat / holdBoardLine 已上线',
      /function holdFlowStat\(bk\)/.test(onNoCmt) && /function holdBoardLine\(code\)/.test(onNoCmt));
    /* ★ 2026-10-10 重建：归属不再走同花顺码映射（那是用户报障「五矿发展→互联网电商」的病根），
       改为东财官方口径 bkPick（BK 码，与资金存档同源）。旧断言 `/stkbkPick\(code\)/` 匹配到的
       是**函数定义**而非调用点 ⇒ 归属整条换掉它照样绿（假通过），一并修掉。 */
    chk('★ [F10] 板块归属走东财官方 bkPick（BK 码，与资金存档同源）',
      /pk = \(typeof bkPick === 'function'\) \? bkPick\(code, 2\)/.test(onNoCmt));
    chk('★ [F10] 负向锁：holdBoardLine 里没有 stkbkPick 调用（归属不再经同花顺映射）',
      (function () {
        const i = onNoCmt.indexOf('function holdBoardLine(code)');
        const j = onNoCmt.indexOf('var flowBriefEnsure', i);
        return i > 0 && j > i && onNoCmt.slice(i, j).indexOf('stkbkPick(') < 0;
      })());
    chk('★ [F10] mf5 显示为「资金强度」（不得叫「主力资金」——口径量级完全不同）',
      on.indexOf('资金强度 ') >= 0);
    chk('★ [F10] 持仓卡循环里真的调用了 holdBoardLine', /h \+= holdBoardLine\(hh\.code\)/.test(onNoCmt));
    chk('★ [F10] 轮动数据到达后重绘首页（否则持仓板块行会一直空着）',
      (function () {
        const i = onNoCmt.indexOf('rotLoad().then(function(){ rotFillCnt(); rotRefreshTags();');
        return i > 0 && onNoCmt.indexOf('renderDash(', i) > i;
      })());

    /* ===== F11（2026-10-10 第三轮）「点击没反应」的两个真根因 =====
     * 用户原话（第二次报）：「资金流向监控，点击还是没反应，打不开前5股票。」
     * 根因①（页面级首屏被东财拖死）：上轮只给**弹窗内**的个股明细加了预算，页面级 flowLoad 仍是
     *   `await Promise.all([云端, flowRetry(flowFetchToday, 2)])` ⇒ 实测 emGet 单次 20.5s、
     *   两侧 ≈41s、×2 次重试 ≈123s ⇒ FLOW.boards 恒为空、榜单根本没渲染。
     * 根因②（★ 本轮新发现，此前完全没被意识到）：flowBriefEnsure ↔ renderDash **自激**。
     *   旧实现失败时 `ins` 仍为 null、`loading` 又重置 false，却**无条件** renderDash()；
     *   而 renderDash → holdBoardLine → holdFlowStat 拿不到数据 → 又调 flowBriefEnsure()
     *   ⇒「渲染 → 补数 → 失败 → 再渲染」无限自激。jsdom 实测：6s 内 renderDash 触发 **103 次**、
     *   holdBoardLine 412 次，微任务队列塞满、定时器被饿死 ⇒ **整页点击失效**。
     *   触发条件很普通：**有持仓**（才走 holdBoardLine）+ 云端 flow-history 取不到。
     *   回归锁：_tests/_cache/flow-firstpaint-check.js（23 项）+ flowbrief-loop-check.js（15 项，含反向锁）。 */
    const fLoad = between(onNoCmt, 'async function flowLoad(force){', 'function flowOpen(){');
    chk('★ [F11] 页面级首屏改用东财硬预算常量 2.5s', /var FLOW_EM_BUDGET_MS = 2500/.test(onNoCmt));
    chk('★ [F11] 东财板块清单套上同一个硬预算包装器',
      /flowWithBudget\(flowFetchToday\(FLOW\.mode\), FLOW_EM_BUDGET_MS, '东财板块清单'\)/.test(onNoCmt));
    chk('★ [F11] 页面级这一层也不再 flowRetry（41s 会被重试放大成 123s）',
      fLoad.length > 400 && fLoad.indexOf('flowRetry') < 0);
    chk('★ [F11] 不再同时等两条腿（`Promise.all([pC, pE])` 就是首屏被拖死的入口）',
      fLoad.indexOf('Promise.all([pC, pE])') < 0 && fLoad.indexOf('var pC =') < 0);
    chk('★ [F11] 首屏只等云端：`await flowCloudRaw()` → 定义 paint → 调用 paint()', (function () {
      /* ⚠️ 不能用注释串作锚点：onNoCmt 已经把注释剥掉了（第一版就栽在这，假红 1 条）。
         只锚代码：云端 await → `var paint = function(){` → `paint()` 调用，三者顺序必须成立。 */
      const iC = fLoad.indexOf('st.cloud = await flowCloudRaw()');
      const iDef = fLoad.indexOf('var paint = function(){');
      const iCall = fLoad.indexOf('paint()', iDef + 1);
      return iC >= 0 && iDef > iC && iCall > iDef;
    })());
    chk('★ [F11] 唯一会等东财的情形被限定死：**只有云端挂了**才 `await emP`（且已带 2.5s 预算）',
      (function () {
        const iC = fLoad.indexOf('st.cloud = await flowCloudRaw()');
        const iWait = fLoad.indexOf('if(!st.cloud && !st.emErr && emP){');
        const iAwaitEm = fLoad.indexOf('await emP', iWait);
        const iDef = fLoad.indexOf('var paint = function(){');
        return iC >= 0 && iWait > iC && iAwaitEm > iWait && iDef > iWait;
      })());
    chk('★ [F11] 东财晚到会补渲一次（预算内到了就带「今日盘中增量」重画）',
      /emP\.then\(function\(\)\{ if\(st\.tmap\)\{ try\{ paint\(\) \}/.test(onNoCmt));
    chk('★ [F11] 冷却期不再是「死胡同 return」（旧版冷却期连云端都不渲染）',
      fLoad.indexOf('东财接口限流冷却中') < 0 && fLoad.indexOf('var left = Math.ceil') < 0);
    chk('★ [F11] 冷却期改为在口径行如实注明（不假装有实时）',
      /stampTxt \+= ' · 东财冷却中（'/.test(onNoCmt));
    chk('★ [F11] 冷却期跳过东财那条腿（不刺激风控）',
      /var emP = cooling \? null/.test(onNoCmt));

    const fbe = between(onNoCmt, 'var flowBriefEnsure = async function(){', 'function v3Sub(code){');
    chk('★ [F11] 资金简要补数：新增失败退避字段 nextTry / tries',
      /FLOW_BRIEF\.nextTry = 0; FLOW_BRIEF\.tries = 0/.test(onNoCmt) &&
      /if\(FLOW_BRIEF\.err && Date\.now\(\) < FLOW_BRIEF\.nextTry\) return/.test(onNoCmt));
    chk('★ [F11] ★ 失败**绝不重渲**（旧版的自激入口就是「失败后无条件 renderDash」）', (function () {
      const iOk = fbe.indexOf('if(!ok){');
      const iRen = fbe.indexOf('renderDash', Math.max(0, iOk));
      return iOk >= 0 && iRen > iOk && fbe.slice(iOk, iRen).indexOf('return') > 0;
    })());
    chk('★ [F11] 退避单调递增且有上限（60s→2m→4m…上限 30 分钟）',
      /Math\.min\(30 \* 60 \* 1000, 60 \* 1000 \* Math\.pow\(2, FLOW_BRIEF\.tries - 1\)\)/.test(onNoCmt));
    chk('★ [F11] 退避写入自检流水（用户要求的「操作异常要有日志」）',
      on.indexOf("logOp('首页·资金简要取数失败·已退避'") >= 0);
    chk('★ [F11] 成功路径仍然重渲一次（刹车不能把功能踩死）',
      /try\{ renderDash\(G\.quoteMap \|\| \{\}\) \}catch\(e2\)\{\}/.test(onNoCmt));
  }

  /* ===== F12（2026-10-10 第四轮）个股 → 板块 / 题材 归属**全量重建** =====
   * 用户原话：「股票的板块题材自检下是否正确，五矿发展显示的是互联网电商，海康卫视显示的半导体，
   *   大众交通显示的互联网电商，这块的数据要准确，不要误导错乱。川能动力到底是风电设备，还是锂矿。」
   * 四层根因（逐条对上线上）：
   *   ① 跨类别名映射：旧 STKBK_ALIAS 里 '电商概念'→'互联网电商'、'国产芯片'→'半导体'、
   *      '风能'→'风电设备' ⇒ **概念被翻译成行业** —— 这就是五矿发展/大众交通/海康威视那三条的直接来源。
   *   ② 概念层恒被丢弃：匹配不到同花顺同名板块就 return ⇒「锂矿」这类永远不显示。
   *   ③ ★ 真 bug：stkbkPick 返回**同花顺码**（884125），而 holdFlowStat 查的 flow-history 键**全是 BK 码**
   *      ⇒ 恒 undefined ⇒ 持仓页「板块当月资金 + 连入连出天数」**从来没出过数**（静默失效，不报错）。
   *   ④ 父子行业靠全市场共现推断 ⇒ 噪声（884101 商用载客车 → 881281 电池）。
   * 重建：归属改为东财官方 F10 CORETHEME_BOARDTYPE（94,952 行）直出 —— 每只票恰好 L1/L2/L3 一条链，
   *   零歧义、零共现推断；BK 码与资金存档同源（实测 524/524 全对上、名字不一致 0 个）。
   * 回归锁：_tests/bkmap-test.js（46 项，含 3 条反向锁 + 变异测试确认有牙齿）。
   */
  const bmTxt = (on.match(/var BK_MAP = \/\*BK_MAP_S\*\/([\s\S]*?)\/\*BK_MAP_E\*\//) || [])[1];
  let BM = null;
  try { BM = JSON.parse(bmTxt); } catch (e) { BM = null; }
  chk('★ [F12] 官方归属表 BK_MAP 已线上（六字段 b/n/hi/f/d1/d2 齐备）',
    !!BM && Array.isArray(BM.b) && Array.isArray(BM.n) && typeof BM.d1 === 'string' && typeof BM.d2 === 'string');
  if (BM) {
    chk(`★ [F12] 行业区 ${BM.hi} / 题材区 ${BM.b.length - BM.hi} / 合计 ${BM.b.length}（行业只取 BOARD_TYPE=行业）`,
      BM.hi === 237 && BM.b.length === 427 && BM.b.length - BM.hi === 190);
    chk('★ [F12] 三张表长度自洽（n 与 b 同长同序、f 位图长度 = 行业区长度且只含 0/1）',
      BM.n.length === BM.b.length && BM.f.length === BM.hi && /^[01]+$/.test(BM.f));
    chk('★ [F12] 板块码全部是东财 BK 码形态（与资金存档同源的前提）',
      BM.b.every(c => /^BK\d{4}$/.test(String(c))));
    chk(`★ [F12] 编码体积 d1=${Math.round(BM.d1.length / 1024)}KB / d2=${Math.round(BM.d2.length / 1024)}KB（覆盖全市场 5,238 只票）`,
      BM.d1.length > 20000 && BM.d2.length > 60000);
    /* ★ 排除表真的生效了：通道 / 宽基 / 风格 / 机构榜 / 事件 / 形态 六类**不许进题材区**。
       判据是「名字的语义类别」而**不是覆盖率阈值** —— 覆盖 1422 只的「央国企改革」（真政策题材）保留。
       覆盖股数少的「蓝宝石」（真产业题材）也保留。 */
    const BAN = ['融资融券', '深股通', '沪股通', '创业板综', '深成500', 'HS300_', 'MSCI中国',
      '小盘股', '红利股', '破净股', '机构重仓', 'QFII重仓', '东方财富热股',
      '次新股', '昨日高振幅', '近期新高', '最近多板'];
    const bLeft = BAN.filter(n => BM.n.indexOf(n) >= 0);
    chk('★ [F12] 排除表生效：通道/宽基/风格/机构榜/事件/形态 均未进题材区' +
      (bLeft.length ? '（★ 残留 ' + bLeft.join('/') + '）' : ''), bLeft.length === 0);
    /* 反向锁：真题材必须在。否则「排干净」也可能只是把整张表清空了。 */
    chk('★ [F12] 反向锁：真题材仍在（锂矿概念 / 锂电池 都在表里，不是清空式排除）',
      BM.n.indexOf('锂矿概念') >= 0 && BM.n.indexOf('锂电池') >= 0 && BM.n.indexOf('央国企改革') >= 0);
  }
  /* 别名表：跨类别名映射的病根，必须整体为空 */
  chk('★ [F12] 负向锁：STKBK_ALIAS 已整体清空（跨类别名映射的病根）', /var STKBK_ALIAS = \{\}/.test(onNoCmt));
  chk('★ [F12] 负向锁：剥注释后源码里不存在跨类映射字面量（概念被翻成行业）',
    !/'电商概念'\s*:\s*'互联网电商'|'国产芯片'\s*:\s*'半导体'|'风能'\s*:\s*'风电设备'|'新能源汽车'\s*:\s*'汽车整车'/.test(onNoCmt));
  chk('★ [F12] 本地缓存已升版 v2（v1 是用旧别名表匹配出来的，必须整体失效）', /sa_stkbk_v2/.test(onNoCmt));
  /* ★ 真 bug 的反向锁：持仓行取资金传的必须是**官方 BK 码**，不能是同花顺码 */
  chk('★ [F12] ★ 持仓行资金取数传官方 BK 码 holdFlowStat(pk.ind.bk)（修掉「恒 undefined」的真 bug）',
    /holdFlowStat\(pk\.ind\.bk\)/.test(onNoCmt));
  chk('★ [F12] 题材行同样按 BK 码取资金 holdFlowStat(pk.con[i].bk)',
    /holdFlowStat\(pk\.con\[i\]\.bk\)/.test(onNoCmt));
  chk('★ [F12] 持仓行渲染成「板块 / 题材」两行',
    /ev-k">板块<\/span>/.test(on) && /ev-k">题材<\/span>/.test(on));

  /* ===== [F13] 2026-10-10：资金流点击修复 + 首页排序改版 + 消息催化简要面板 =====
   * ★ 验收清单必须跟着改动走（只证明旧功能没退化＝虚假安全感）。 */
  LF && console.log(LF + '---- [F13] 资金流点击 / 首页排序 / 消息催化 ----');
  const F13 = (() => {
    const out = [];
    const add = (n, ok, ex) => out.push({ n, ok, ex });
    /* --- ① 资金流点击：不得再有外层重试包裹 --- */
    const sheet = between(onNoCmt, 'var flowOpenSheet = async function', '\nvar ');
    add('★ [F13] 弹窗路径不再有任何 flowRetry 包裹（外层重试已删，20.2s→1.5s 的根因）',
      sheet.length > 200 && !/flowRetry\s*\(/.test(sheet));
    add('★ [F13] 弹窗路径把已并行预取的 cloudP 传给 flowFetchStocks',
      /flowFetchStocks\s*\(\s*bk\s*,\s*cloudP\s*\)/.test(sheet));
    add('★ [F13] flowFetchStocks 接受第二参 cloudP 且只在未传时才自己下载云档',
      /flowFetchStocks = async function\s*\(\s*bk\s*,\s*cloudP\s*\)/.test(onNoCmt) &&
      /cloudP\s*\|\|\s*flowCloudRaw/.test(onNoCmt));
    add('★ [F13] 涨停池腿也套硬预算（池接口黑洞时不得拖住明细渲染）',
      /flowWithBudget\s*\(\s*ztLoad\(\)\s*,\s*STK_EM_BUDGET_MS/.test(sheet));
    add('★ [F13] 明细为空时给诚实文案并写自检流水（不静默、不甩锅"限流"）',
      /资金流·个股明细为空/.test(on) && /不受影响/.test(on));
    /* --- ② 首页排序 --- */
    add('★ [F13] 新增 HOME_ARCH 开关且默认 false（历史备选存档入口已隐藏）',
      /var HOME_ARCH = false/.test(onNoCmt));
    add('★ [F13] 持仓阶段跟踪已抽成 homeHoldBlock(map)（移到首页最后）',
      /function homeHoldBlock\(map\)/.test(onNoCmt) && /h \+= homeHoldBlock\(map\)/.test(onNoCmt));
    /* ★ 只圈定**首页骨架 #dash 段**判 —— 推荐页里有一份同名的「历史备选存档」标题
     *   （884 行，属正常功能，用户只要求隐藏首页入口），全局判会假红。踩过。 */
    const sk = between(onNoCmt, '<div id="dash">', 'id="homeBack"');
    add('★ [F13] 首页骨架「历史备选存档」已下线（不与终态打架）',
      sk.length > 100 && !/历史备选存档/.test(sk), 'skLen=' + sk.length);
    add('★ [F13] 推荐页里的备选存档区**未受影响**（隐藏的只是首页入口，不是功能）',
      /dash-h">历史备选存档 · 云端/.test(onNoCmt) && /function renderPicks|switchView\('picks'\)/.test(onNoCmt));
    /* 顺序：必须**圈定在 renderDash 段内**比较 —— 否则 indexOf 会命中外部的
     * 函数定义 / 别处的同名串（踩过：拿到 iDash=48222 这种「定义处」坐标导致假红）。*/
    const rd = between(on, 'function renderDash(map){', 'function renderHome(){');
    const iFlow = rd.indexOf('h += flowBriefCard()');
    const iDash = rd.indexOf('dash-h">大盘驾驶舱');
    const iCat = rd.indexOf('h += catBriefCard()');
    const iPick = rd.indexOf('dash-h">今日推荐');
    const iHold = rd.indexOf('h += homeHoldBlock(map)');
    add('★ [F13] renderDash 顺序 = 市场资金→大盘驾驶舱→消息催化→今日推荐→持仓（最后）',
      iFlow > 0 && iFlow < iDash && iDash < iCat && iCat < iPick && iPick < iHold,
      [iFlow, iDash, iCat, iPick, iHold].join(','));
    /* --- ③ 消息催化简要面板 --- */
    add('★ [F13] 首页新增「消息催化 · 简要」面板（Top 3 + 查看全部入口）',
      /消息催化 · 简要/.test(on) && /data-act="dash-cat"/.test(on));
    add('★ [F13] 面板点击可跳消息催化页（dash-cat → catOpen）',
      /act === 'dash-cat'\)\s*catOpen\(\)/.test(onNoCmt));
    add('★ [F13] 归因单一真源 catBuild(z, hist)：催化页与首页共用（防两处口径漂移）',
      /function catBuild\(z, hist\)/.test(onNoCmt) &&
      /var built = catBuild\(z, hist\)/.test(onNoCmt) && /catBuild\(z, CAT_HIST\)/.test(onNoCmt));
    add('★ [F13] 概览「高度」取 m.maxLbAll（全市场），不是板块级 g.maxLb',
      /maxLbcAll:\s*m\.maxLbAll/.test(onNoCmt));
    add('★ [F13] 非交易日（0 涨停）给诚实空态，不停留在「正在读取…」（旧写法永久转圈）',
      /今日暂无涨停催化/.test(on) && /everLoaded/.test(onNoCmt));
    const bad = out.filter(x => !x.ok);
    if (LF && bad.length) bad.forEach(x => console.log('   ❌ ' + x.n + (x.ex ? ' → ' + x.ex : '')));
    return out;
  })();
  F13.forEach(x => chk(x.n, x.ok, x.ex));

  /* ===== [F14] 2026-10：两融 · 杠杆水位（第一步）线上验收 =====
   * 首页卡 + 周期详情页（20/60/120/250）+ 数据源 + 方向禁词 + 诚实错误路径。
   * ★ 验收清单必须跟着改动走：不只证明旧功能没退化。 */
  LF && console.log(LF + '---- [F14] 两融 · 杠杆水位 ----');
  const F14 = (() => {
    const out = [];
    const add = (n, ok, ex) => out.push({ n, ok, ex });
    /* --- ① 首页卡锚点 --- */
    add('★ [F14] 首页「两融 · 杠杆水位」卡已上线（marginCard 锚点）',
      /dash-h">两融 · 杠杆水位/.test(on));
    add('★ [F14] 该卡标注「仅描述水位，不构成方向判断」',
      /不构成方向判断/.test(on));
    /* --- ② 数据源（两处浏览器侧直连，零跨仓依赖）--- */
    add('★ [F14] 两融序列源 = 东财 datacenter-web RPTA_RZRQ_LSHJ',
      /RPTA_RZRQ_LSHJ/.test(onNoCmt));
    add('★ [F14] 大盘成交量源 = 腾讯 web.ifzq.gtimg.cn 中证全指(sh000985)',
      /web\.ifzq\.gtimg\.cn/.test(onNoCmt) && /FNG_SYMBOL/.test(onNoCmt));
    add('★ [F14] 成交额(估) = 成交量 × 近似均价（s.amt = vol * MARGIN_VWAP）',
      /s\.amt = vol \* MARGIN_VWAP/.test(onNoCmt));
    add('★ [F14] 杠杆密度口径 = 两融余额 ÷ 成交额（marginRatio = rzye / amt）',
      /function marginRatio\(s\)\{/.test(onNoCmt) && /s\.rzye \/ s\.amt/.test(onNoCmt));
    /* --- ③ 周期详情页 + 四档 --- */
    add('★ [F14] 详情页 pgMargin 已上线',
      /id="pgMargin"/.test(on));
    add('★ [F14] 四档周期 tab 20/60/120/250 已注入',
      /\['20','60','120','250'\]/.test(onNoCmt));
    add('★ [F14] 详情页点开路由 dash-margin → marginOpen',
      /act === 'dash-margin'\)\s*marginOpen\(\)/.test(onNoCmt));
    add('★ [F14] 刷新按钮接 marginLoad(true)（强制重取）',
      /\$\('marginRefreshBtn'\)\.addEventListener\('click', function\(\)\{ marginLoad\(true\) \}\)/.test(onNoCmt));
    add('★ [F14] 详情页声明「不构成任何方向判断，也不是买卖建议」',
      /不构成任何方向判断，也不是买卖建议/.test(on));
    /* --- ④ 方向禁词（圈定本功能新写展示代码，避开 demoRzrqData 等无关模块）--- */
    const mSeg = between(onNoCmt, 'function fmtWanYi(', 'function renderDash(map){');
    add('★ [F14] 本功能代码段无方向禁词（要涨/要跌/可买/该躲）',
      mSeg.length > 500 && !/要涨|要跌|可买|该躲/.test(mSeg), 'segLen=' + mSeg.length);
    /* --- ⑤ 诚实错误路径（数据不可达不得永久转圈）--- */
    add('★ [F14] 数据不可达给诚实文案「两融数据暂不可用」(非永久「正在读取…」)',
      /两融数据暂不可用/.test(on));
    add('★ [F14] 详情页 err 态诚实说明「数据暂不可用：」',
      /数据暂不可用：/.test(on));
    add('★ [F14] 杠杆密度近似已注明（市场均价长期稳定，趋势等同真实两融÷成交额）',
      /市场均价长期稳定/.test(on));
    const bad = out.filter(x => !x.ok);
    if (LF && bad.length) bad.forEach(x => console.log('   ❌ ' + x.n + (x.ex ? ' → ' + x.ex : '')));
    return out;
  })();
  F14.forEach(x => chk(x.n, x.ok, x.ex));

  /* ===== [F15] 2026-10：第二步 板块 / 题材消耗两融占比（线上验收） =====
   * 首页 TOP3 行 + pgMargin 第三节面板 + 云端存档源 + 行业/题材切换 + 方向禁词 + 诚实错误态。
   * ★ 验收清单必须跟着改动走：不只证明旧功能没退化。 */
  LF && console.log(LF + '---- [F15] 板块/题材消耗两融占比 ----');
  const F15 = (() => {
    const out = [];
    const add = (n, ok, ex) => out.push({ n, ok, ex });
    const sA = onNoCmt.indexOf('var MARGIN_SECTOR = {');
    const sB = onNoCmt.indexOf('function demoMarginSectorData(){');
    const seg = (sA >= 0 && sB > sA) ? onNoCmt.slice(sA, sB) : '';
    const t3 = onNoCmt.indexOf('两融最集中 TOP3');
    const t3win = t3 >= 0 ? onNoCmt.slice(t3 - 260, t3 + 260) : '';
    const segAll = seg + '\n' + t3win;
    add('★ [F15] 首页「两融 · 杠杆水位」卡含「两融最集中 TOP3」行',
      /两融最集中 TOP3/.test(on));
    add('★ [F15] pgMargin 已含板块面板容器 id="marginSector"',
      /id="marginSector"/.test(on));
    add('★ [F15] 板块两融源 = 云端 margin-sector-history.json',
      /margin-sector-history\.json/.test(onNoCmt));
    add('★ [F15] 双源降级 raw.githubusercontent + jsDelivr（同 flowCloudRaw 范式）',
      /raw\.githubusercontent\.com\/zyhaaad\/stock-alert\/main\/margin-sector-history\.json/.test(onNoCmt) &&
      /cdn\.jsdelivr\.net\/gh\/zyhaaad\/stock-alert@main\/margin-sector-history\.json/.test(onNoCmt));
    add('★ [F15] 行业/题材切换按钮已注入（data-mk="2"/"3"）',
      /data-mk="2"/.test(onNoCmt) && /data-mk="3"/.test(onNoCmt));
    add('★ [F15] 面板声明「不构成方向判断」',
      /不构成方向判断/.test(seg));
    add('★ [F15] 诚实错误态「两融板块数据暂不可用」（非永久转圈）',
      /两融板块数据暂不可用/.test(on));
    add('★ [F15] 板块口径注明「板块两融=成分股融资余额之和」',
      /板块两融=成分股融资余额之和/.test(seg));
    add('★ [F15] 本功能代码段无方向禁词（要涨/要跌/可买/该躲）',
      segAll.length > 500 && !/要涨|要跌|可买|该躲/.test(segAll), 'segLen=' + segAll.length);
    const bad = out.filter(x => !x.ok);
    if (LF && bad.length) bad.forEach(x => console.log('   ❌ ' + x.n + (x.ex ? ' → ' + x.ex : '')));
    return out;
  })();
  F15.forEach(x => chk(x.n, x.ok, x.ex));

  /* ===== [F16] 2026-10-11：大盘「承接性」状态引擎（线上验收） =====
   * 当日状态（强/一般/弱）+ 变化趋势（状态条 + 迷你走势）+ 周期分布 + 连续同状态天数。
   * ★ 口径硬约束：只描述事实与位置，**不写方向措辞**，必须标注「不构成方向判断」。 */
  LF && console.log(LF + '---- [F16] 大盘承接性状态 ----');
  const F16 = (() => {
    const out = [];
    const add = (n, ok, ex) => out.push({ n, ok, ex });
    const sA = onNoCmt.indexOf('var CS = {');
    const sB = onNoCmt.indexOf('function demoCsSeries(){');
    const csSeg = (sA >= 0 && sB > sA) ? onNoCmt.slice(sA, sB) : '';
    const sC = onNoCmt.indexOf('function csSparkline(');
    const sD = onNoCmt.indexOf('function renderCs(');
    const csRender = (sC >= 0 && sD > sC) ? onNoCmt.slice(sC, sD) : '';
    const csAll = csSeg + '\n' + csRender;
    add('★ [F16] pgMargin 已含承接性容器 id="csPanel"', /id="csPanel"/.test(on));
    add('★ [F16] 承接性三因子齐备：C1 封板质量 / C2 涨跌宽度 / C3 量价匹配',
      /csSealRate/.test(onNoCmt) && /csBreadth/.test(onNoCmt) && /csVolPrice/.test(onNoCmt));
    add('★ [F16] 等权合成 + 三档阈值（0.66 / 0.40）',
      /function csScore\(/.test(onNoCmt) && /0\.66/.test(csSeg) && /0\.4/.test(csSeg));
    add('★ [F16] 状态分档函数 csLevel + 配色 csLevelCls 已注入',
      /function csLevel\(/.test(onNoCmt) && /function csLevelCls\(/.test(onNoCmt));
    add('★ [F16] 趋势：迷你走势 csSparkline + 状态条 csStatusStrip 已注入',
      /function csSparkline\(/.test(onNoCmt) && /function csStatusStrip\(/.test(onNoCmt));
    add('★ [F16] 周期分布 csDist + 连续同状态天数（csStats.streak）已注入',
      /function csDist\(/.test(onNoCmt) && /function csStats\(/.test(onNoCmt));
    add('★ [F16] 历史日回溯走 ztLoadDay（当日走 ztLoad）',
      /ztLoadDay/.test(onNoCmt) && /csEnsure/.test(onNoCmt));
    add('★ [F16] 涨跌宽度用 push2test clist 统计上涨家数（csBreadthToday）',
      /csBreadthToday/.test(onNoCmt));
    add('★ [F16] 面板标注「不构成方向判断」',
      /不构成方向判断/.test(csRender) || /不构成方向判断/.test(on));
    add('★ [F16] 三档命名 = 强/一般/弱（状态词，非方向词）',
      /'强'/.test(csSeg) && /'一般'/.test(csSeg) && /'弱'/.test(csSeg));
    add('★ [F16] 本功能代码段无方向禁词（要涨/要跌/可买/该躲/看多/看空）',
      csAll.length > 800 && !/要涨|要跌|可买|该躲|看多|看空/.test(csAll), 'segLen=' + csAll.length);
    add('★ [F16] demo 序列自洽（demoCsSeries 存在，演示模式不空白）',
      /function demoCsSeries\(/.test(onNoCmt));
    const bad = out.filter(x => !x.ok);
    if (LF && bad.length) bad.forEach(x => console.log('   ❌ ' + x.n + (x.ex ? ' → ' + x.ex : '')));
    return out;
  })();
  F16.forEach(x => chk(x.n, x.ok, x.ex));

  /* ===== [F17] 2026-10-11：资金流页「点击没反应」实现级修复（线上验收） =====
   * ① 圆球点击改通用 [data-bk]（圆球是内联 SVG，只认 circle[data-bk] 会漏）
   * ② 「更多」抽成 flowMore 且 showAll 键缺失有兜底回写
   * ③ 点击统一走 flowOpenByBk（未命中不静默）
   * ④ 栏标题不再写死「· 题材」（列表是双维综合排名）
   * ⑤ flowFetchToday 不再写死 push2delay（已被东财标记，交给域名池换域名） */
  LF && console.log(LF + '---- [F17] 资金流点击修复 ----');
  const F17 = (() => {
    const out = [];
    const add = (n, ok, ex) => out.push({ n, ok, ex });
    const sA = onNoCmt.indexOf('function flowMore(more){');
    const sB = onNoCmt.indexOf('function flowBindClicks(){');
    const moreSeg = (sA >= 0 && sB > sA) ? onNoCmt.slice(sA, sB) : '';
    const sC = onNoCmt.indexOf('function flowBindClicks(){');
    const sD = onNoCmt.indexOf('var flowOpenSheet = async function');
    const bindSeg = (sC >= 0 && sD > sC) ? onNoCmt.slice(sC, sD) : '';
    add('★ [F17] 圆球/牌子点击走通用 [data-bk]（不再只认 circle[data-bk]）',
      /closest\(\s*'\[data-bk\]'\s*\)/.test(bindSeg) && !/closest\(\s*'circle\[data-bk\]'\s*\)/.test(bindSeg));
    add('★ [F17] 点击统一走 flowOpenByBk（未命中不静默、留日志）',
      /function flowOpenByBk\(/.test(onNoCmt) && /logOp/.test(onNoCmt));
    add('★ [F17] 「更多」抽成 flowMore 且 showAll 有兜底回写',
      /function flowMore\(more\)\{/.test(onNoCmt) && /FLOW\.showAll\[k\s*\|\|\s*'fn'\]\s*=/.test(moreSeg));
    add('★ [F17] 栏标题不再写死「· 题材」（综合排序如实标注）',
      !/' · 题材<\/div>'/.test(on) && /综合排序/.test(on));
    add('★ [F17] flowFetchToday 不再写死 push2delay（走 emGet 域名池）',
      !/push2delay\.eastmoney\.com/.test(between(onNoCmt, 'async function flowFetchToday(mode){', 'var flowFetchHist')));
    add('★ [F17] EM_HOSTS 首位 = push2test（实测唯一稳定域名）',
      /var EM_HOSTS = \['push2test\.eastmoney\.com'/.test(onNoCmt));
    add('★ [F17] emSwap 排除 push2ex（涨停池专用路径在 push2test 上 404）',
      between(onNoCmt, 'function emSwap(url, host){', 'function fetchT') && !/push2ex/.test(between(onNoCmt, 'function emSwap(url, host){', 'function fetchT')));
    const bad = out.filter(x => !x.ok);
    if (LF && bad.length) bad.forEach(x => console.log('   ❌ ' + x.n + (x.ex ? ' → ' + x.ex : '')));
    return out;
  })();
  F17.forEach(x => chk(x.n, x.ok, x.ex));

  console.log(LF + '================ 汇总 ================');
  console.log('通过：' + pass + '    失败：' + fail);
  console.log(fail === 0 ? '结果：ALL GREEN' : '结果：存在失败项');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
