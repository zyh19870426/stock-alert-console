/* 资金流「板块点击无反应」回归锁
 * 背景：2026-10-10 用户第 3 次报「资金流向的板块点击没反应，无法查看前5股票」。
 * 根因：flowOpenSheet 在**外层**又包了一层 flowRetry(flowFetchStocks, 3) —— 内层
 *       STK_EM_BUDGET_MS(1500ms) 只管单次，外层 3 次 + 指数退避(1.5s→3.9s) ⇒ 最坏 ≈10s；
 *       叠上云档下载与涨停池等待，Chrome 实测东财被封时 **20.2s** 仍停在「正在读取…」。
 * 修法：删掉外层 flowRetry；flowOpenSheet 并行预取云档并作为第二参传给 flowFetchStocks。
 * 本测试要锁住的四件事（任一被改回去都要红）：
 *   1. 弹窗路径**不得**再把 flowFetchStocks 包进重试；
 *   2. 东财被封（emGet 永挂）时，明细在一个预算量级内以 src='cloud' 返回，而不是 20s；
 *   3. flowFetchStocks 接受第二参 cloudP，且**不重复下载**云档（避免串行等待）；
 *   4. 无数据时给出诚实文案，而不是静默/无限「正在读取…」。
 * 运行：node _tests/flow-click-test.js   （jsdom，结束必须 process.exit）
 */
const fs = require('fs');
const path = require('path');
const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules';
let JSDOM, VirtualConsole;
try {
  const j = require(path.join(WS, 'jsdom'));
  JSDOM = j.JSDOM; VirtualConsole = j.VirtualConsole;
} catch (e) { console.log('SKIP：未安装 jsdom'); process.exit(0); }

const TARGET = 'D:/mywork/stock-alert-console/console.html';
const html = fs.readFileSync(TARGET, 'utf8');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' → ' + extra : '')); }
}

/* ---------- 静态锁：源码形状（不看运行结果，直接拦「改回旧写法」） ---------- */
function seg(src, startRe, endRe, from) {
  const i = src.search(startRe);
  if (i < 0) return '';
  const base = from ? src.slice(i + from) : src.slice(i);
  const j = base.search(endRe);
  return j < 0 ? base : base.slice(0, j);
}
/* 终点锚点必须用「函数定义级」的独占行，否则会被段内同名注释截断（踩过：段长 0） */
const sheetSrc = seg(html, /var flowOpenSheet = async function/, /\nvar [A-Za-z_$]/, 20);
/* ★ 负断言必须判「调用」而非「出现」：段内注释里正引用了旧实现
 *   （`旧实现 flowRetry(flowFetchStocks, 3) …`），不剥注释会假红。踩过。 */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const sheetCode = stripComments(sheetSrc);
ok(sheetSrc.length > 200, '取到 flowOpenSheet 源码段', 'len=' + sheetSrc.length);
ok(!/flowRetry\s*\(/.test(sheetCode),
  '弹窗路径不再有任何重试包裹（外层 flowRetry 已删）',
  (sheetCode.match(/flowRetry[^\n]{0,70}/) || [''])[0]);
ok(/flowFetchStocks\s*\(\s*bk\s*,\s*cloudP\s*\)/.test(sheetCode),
  '弹窗路径把已预取的 cloudP 传给 flowFetchStocks（并行取，不串行等）');
ok(/flowCloudRaw\s*\(\s*\)/.test(sheetCode),
  '弹窗路径自行先发起云档预取');

const ffsSrc = seg(html, /var flowFetchStocks = async function/, /\n\/\* 板块成分股 ∩/, 20);
ok(/=\s*async function\s*\(\s*bk\s*,\s*cloudP\s*\)/.test(ffsSrc),
  'flowFetchStocks 签名含第二参 cloudP', JSON.stringify(ffsSrc.slice(0, 40)));
ok(/cloudP\s*\|\|\s*flowCloudRaw/.test(ffsSrc),
  'flowFetchStocks 仅在未传 cloudP 时才自己去下载云档（避免重复下载）');
ok(/flowWithBudget\s*\(\s*emGet\(url\)\s*,\s*STK_EM_BUDGET_MS/.test(ffsSrc),
  '东财腿仍是「单次硬预算」，不重试');
ok(/flowWithBudget\s*\(\s*ztLoad\(\)\s*,\s*STK_EM_BUDGET_MS/.test(stripComments(sheetSrc)),
  '涨停池腿也套硬预算（池接口黑洞时不得拖住明细渲染）');

/* ---------- 动态锁：真跑一遍（jsdom，stub fetch） ---------- */
const BK_KEYS = ['BK0596', 'BK0493', 'BK1031'];
const BKS = { BK0596: '融资融券', BK0493: '电池', BK1031: '半导体' };
const STK_ROW = function (i) {
  return ['60' + (1000 + i), ['宁德时代', '比亚迪', '亿纬锂能', '赣锋锂业', '天齐锂业'][i],
    (20 - i) * 1000, (30 - i * 4), 10 + i * 7];   /* [code,name,f62万元,f3bp,f2] */
};
/* days[].con[bk] = [名称, 当日额, 涨幅bp]；同时给 mon.con 真值，让三个板块都进榜 */
const dayCon = function () { const g = {}; BK_KEYS.forEach(function (bk, k) { g[bk] = [BKS[bk], (300 - k * 100) * 1e4, 120] }); return g };
const monCon = {}; BK_KEYS.forEach(function (bk, k) { monCon[bk] = [(30000 - k * 5000), 2, 2] });
const cloudFix = {
  v: 1, updated: '2026-10-10',
  names: (function () { const n = {}; BK_KEYS.forEach(function (bk) { n[bk] = [BKS[bk], 3] }); return n })(),
  days: [{ d: '2026-10-09', con: dayCon(), ind: {} }, { d: '2026-10-10', con: dayCon(), ind: {} }],
  mon: { month: '2026-10', nTrade: 2, con: monCon, ind: {} },
  stk: { d: '2026-10-09', m: {}, s: {}, nb: {}, ns: {}, nbs: {} }
};
BK_KEYS.forEach(function (bk) {
  cloudFix.stk.m[bk] = [0, 1, 2, 3, 4].map(STK_ROW);
});

const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'https://stock-alert-console.app.workbuddy.host/?demo=0', virtualConsole: vc });
const w = dom.window;

let fetchCalls = 0, emCalls = 0;
/* 云档：走 raw / jsDelivr（flowCloudRaw 只有这两源）——正常返回 */
w.fetch = function (u) {
  fetchCalls++;
  const s = String(u);
  if (s.indexOf('flow-history.json') > -1) {
    return new Promise(function (res) {
      setTimeout(function () {
        res({ ok: true, json: function () { return Promise.resolve(cloudFix) } });
      }, 40);
    });
  }
  return Promise.reject(new Error('stub: 未预期的网络路径 ' + s.slice(0, 60)));
};
/* 东财：模拟本机 IP 被 WAF 封 —— 永挂（既不 resolve 也不 reject），复现真实「请求黑洞」 */
w.emGet = function () { emCalls++; return new Promise(function () {}); };
/* 涨停池 JSONP：同样永挂（真实症状：池接口黑洞）——弹窗不得被它拖住 */
let ztCalls = 0;
w.catJsonp = function () { ztCalls++; return new Promise(function () {}); };

setTimeout(function () {
  const t0 = Date.now();
  /* 先跑一次 flowLoad 把 FLOW.boards 填上（DemoData 关掉、云档在线） */
  w.DEMO = false;
  w.FLOW = w.FLOW || { boards: [] };
  w.flowLoad().then(function () {
    const boards = (w.FLOW && w.FLOW.boards) || [];
    ok(boards.length === 3, 'flowLoad 后 FLOW.boards 有可点板块（修复前此处常为 0）', 'n=' + boards.length);
    const callsBefore = fetchCalls;
    const t1 = Date.now();
    return w.flowOpenSheet('BK0596').then(function () {
      const dt = Date.now() - t1;
      const txt = String((w.document.getElementById('flowShStocks') || {}).textContent || '');
      ok(dt < 3000, '东财被封时明细在一个预算量级内就绪（修复前实测 20200ms）', dt + 'ms');
      ok(/宁德时代|比亚迪|亿纬锂能/.test(txt), '前 5 个股真的渲染出来了', JSON.stringify(txt.slice(0, 80)));
      ok(!/正在读取/.test(txt), '不再停留在「正在读取…」');
      /* 云档不重复下载：预取那一次 + 复用，最多再多一次（flowLoad 已含一次，10min 缓存） */
      ok(fetchCalls - callsBefore <= 1, 'flowOpenSheet 不重复下载云档（cloudP 复用生效）',
        '额外 fetch=' + (fetchCalls - callsBefore));
      ok(emCalls >= 1, '东财腿确实被尝试过（不是跳过东财直接读存档）', 'emGet=' + emCalls);
      ok(dt < 3000, '涨停池接口同时黑洞时，明细仍在一个预算量级内就绪（腿受预算保护）', dt + 'ms');
      return null;
    });
  }).then(function () {
    /* 反向锁 · 场景②：板块在榜、但云档没有它的个股明细段（模拟「云端 stk 段还没生成」）
     *  + 东财被封 ⇒ 必须是诚实文案，而不是静默/无限「正在读取…」
     *  ⚠️ 不能拿「不在 FLOW.boards 的板块码」测 —— 那种情况在 flowOpenSheet 开头就
     *     静默 return（连弹窗都不开），会读到上一次的残留文本（踩过：假红/假绿都出现过）。*/
    const keep = cloudFix.stk.m['BK1031'];
    delete cloudFix.stk.m['BK1031'];                 /* 让「半导体」命中不了云档明细 */
    w.FLOW.cloudAt = 0;                              /* 让云档缓存失效，重新读被改过的夹具 */
    const t2 = Date.now();
    return w.flowOpenSheet('BK1031').then(function () {
      const txt = String((w.document.getElementById('flowShStocks') || {}).textContent || '');
      const dt2 = Date.now() - t2;
      ok(/没有取到|没有覆盖|不可达|都取不到|云端存档还没有/.test(txt),
        '无数据时给诚实说明文案（非静默、非无限转圈）', JSON.stringify(txt.slice(0, 70)));
      ok(!/正在读取/.test(txt), '无数据时不停留在「正在读取…」', JSON.stringify(txt.slice(0, 40)));
      ok(/不受影响/.test(txt), '文案明确告知「板块级数字不受影响」（不误导）');
      ok(dt2 < 3000, '无数据路径也在预算量级内返回', dt2 + 'ms');
      cloudFix.stk.m['BK1031'] = keep;
      return null;
    });
  }).then(function () {
    console.log(pass + ' pass / ' + fail + ' fail');
    process.exit(fail ? 1 : 0);
  }).catch(function (e) {
    console.log('FAIL 异常: ' + (e && e.stack || e));
    process.exit(1);
  });
}, 400);
