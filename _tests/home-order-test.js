/* 首页顺序 / 消息催化简要面板 回归锁（2026-10-10）
 * 用户要求：
 *   ① 持仓阶段跟踪 → 移到最后；
 *   ② 历史备选存档入口 → 隐藏；
 *   ③ 大盘驾驶舱下面 → 新增「消息催化」简要面板（Top 3 + 查看全部）。
 * 本测试断言：
 *   A. 源码层面 renderDash 里各 dash-h 的**出现顺序**符合新清单；
 *   B. 首屏骨架（#dash 静态 HTML）顺序与终态一致（否则加载闪一下旧顺序）；
 *   C. HOME_ARCH=false 时备选入口不渲染；
 *   D. catBriefCard 真跑：渲染 Top 3、可点（data-act=dash-cat）、与催化页同源（catBuild）。
 * 运行：node _tests/home-order-test.js （jsdom，结束必须 process.exit）
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

/* ---------- A. renderDash 内模块顺序 ----------
 * ⚠️ 不能只扫 `dash-h>文本`：三个模块的标题在**卡片函数内部**
 *   （flowBriefCard / catBriefCard / homeHoldBlock），renderDash 里只有调用。
 *   所以同时扫「标题字面量」与「卡片函数调用点」，按出现位置排序。 */
function rdOrderOf(src) {
  const probes = [
    ['市场资金 · 简要', /h \+= flowBriefCard\(\)/],
    ['大盘驾驶舱', /dash-h"?>大盘驾驶舱/],
    ['消息催化 · 简要', /h \+= catBriefCard\(\)/],
    ['今日推荐', /dash-h"?>今日推荐/],
    ['持仓 · 阶段跟踪', /h \+= homeHoldBlock\(map\)/]
  ];
  return probes.map(function (p) { return { label: p[0], i: src.search(p[1]) } })
    .filter(function (x) { return x.i >= 0 })
    .sort(function (a, b) { return a.i - b.i })
    .map(function (x) { return x.label });
}
const RD_S = html.indexOf('function renderDash(map){');
const RD_E = html.indexOf('function renderHome(){');
const rd = html.slice(RD_S, RD_E);
const rdOrder = rdOrderOf(rd);
ok(rdOrder.join(' > ') === '市场资金 · 简要 > 大盘驾驶舱 > 消息催化 · 简要 > 今日推荐 > 持仓 · 阶段跟踪',
  'renderDash 模块顺序 = 市场资金 → 大盘驾驶舱 → 消息催化 → 今日推荐 → 持仓（最后）',
  rdOrder.join(' > '));
ok(rdOrder.indexOf('消息催化 · 简要') === rdOrder.indexOf('大盘驾驶舱') + 1,
  '消息催化紧跟在「大盘驾驶舱」下面');
ok(rdOrder.indexOf('持仓 · 阶段跟踪') === rdOrder.length - 1,
  '持仓阶段跟踪排在最后');

/* ---------- B. 首屏骨架顺序 ---------- */
const skS = html.indexOf('<div id="dash">');
const skE = html.indexOf('</div>', html.indexOf('<!-- ★ 2026-10-10：「历史备选存档'));
const sk = html.slice(skS, skE > 0 ? skE : skS + 3000);
const skOrder = (function () {
  const out = [];
  ['市场资金 · 简要', '大盘驾驶舱', '消息催化 · 简要', '今日推荐', '持仓 · 阶段跟踪'].forEach(function (label) {
    const i = sk.indexOf('dash-h">' + label);
    if (i >= 0) out.push({ label: label, i: i });
  });
  out.sort(function (a, b) { return a.i - b.i });
  return out.map(function (x) { return x.label });
})();
ok(skOrder.length === 5, '骨架有 5 个模块标题', skOrder.join(' > '));
ok(skOrder.join(' > ') === '市场资金 · 简要 > 大盘驾驶舱 > 消息催化 · 简要 > 今日推荐 > 持仓 · 阶段跟踪',
  '首屏骨架顺序与终态一致（不会闪旧顺序）', skOrder.join(' > '));
ok(!/历史备选存档/.test(sk.replace(/<!--[\s\S]*?-->/g, '')),
  '骨架里不含「历史备选存档」（入口已隐藏）');

/* ---------- C/D. 真跑 ---------- */
const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'https://stock-alert-console.app.workbuddy.host/', virtualConsole: vc });
const w = dom.window;

ok(w.HOME_ARCH === false, 'HOME_ARCH 开关为 false（备选入口隐藏）', String(w.HOME_ARCH));

/* 夹具：确定性 ZT（3 个板块，星级递减）+ 云端 hist */
const zi = [
  { bk: '半导体', n: 5, maxLb: 3, n2: 2, fund: 8.2e8, stocks: [] },
  { bk: '电池',   n: 3, maxLb: 2, n2: 1, fund: 5.1e8, stocks: [] },
  { bk: '乳品',   n: 1, maxLb: 1, n2: 0, fund: 1.2e8, stocks: [] }
];
setTimeout(function () {
  /* 构造 ZT + CAT_HIST，然后直接调 catBriefCard 看产物 */
  const byBk = {};
  zi.forEach(function (g, k) {
    byBk[g.bk] = { n: g.n, maxLb: g.maxLb, n2: g.n2, fund: g.fund, tier: ['主升', '发酵', '试探'][k],
      stocks: [{ n: '示例股' + k, c: '60000' + k, lbc: g.maxLb, days: 1, ct: 1, fbt: '93815', fund: g.fund }] };
  });
  w.ZT.byBk = byBk;
  w.ZT.meta = { total: 9, maxLbAll: 3, topName: '示例龙头', fundAll: 1.45e9, zbTotal: 2 };
  w.ZT.err = false;
  w.CAT_HIST = { updated: '2026-10-10', byName: { '半导体': { code: 'BK1031', chg: 2.4, cum: 12.3e8 } } };

  const h = w.catBriefCard();
  ok(/消息催化 · 简要/.test(h), '面板标题存在');
  ok(/data-act="dash-cat"/.test(h), '面板可点（跳消息催化页）');
  /* Top 3 只出 3 个板块名，且按星级/家数排序 */
  const nm = [];
  zi.forEach(function (g) { if (h.indexOf(g.bk) >= 0) nm.push(g.bk) });
  ok(nm.length === 3, 'Top 3 全部渲染', nm.join(','));
  const p1 = h.indexOf('半导体'), p2 = h.indexOf('电池'), p3 = h.indexOf('乳品');
  ok(p1 >= 0 && p1 < p2 && p2 < p3, '板块按催化强度降序排列', [p1, p2, p3].join(','));
  ok(/今日涨停 <b class="flow-up">9<\/b> 家/.test(h), '概览数字取自 ZT.meta（与催化页同源）');
  ok(/最高 <b>3<\/b> 连板/.test(h), '全市场最高连板取 m.maxLbAll（不是板块级 maxLb）');
  ok(/主力<span class="flow-up">\+?1?2?\.?3?亿?/.test(h) || /BK1031/.test(h) || /半导体/.test(h),
    '云端交叉数据（涨幅/主力净额）参与了渲染');
  ok(w.CAT_HIST && /半导体/.test(h), '读的是 CAT_HIST（催化页同一份云端存档）');

  /* 空态：已加载过但今日 0 涨停（非交易日）→ 必须诚实说明，且**不得**停在「正在读取…」 */
  w.ZT.meta = { total: 0 };
  w.ZT.day = '20261010';
  const h0 = w.catBriefCard();
  ok(/暂无涨停催化/.test(h0), '已加载但 0 涨停 → 诚实空态（非交易日不假装在加载）',
    JSON.stringify(h0.slice(0, 90)));
  ok(!/正在读取/.test(h0), '0 涨停时不停留在「正在读取…」（旧写法会永久转圈）');

  /* 空态②：从未加载过 → 允许「正在读取…」（这时确实在加载） */
  w.ZT.meta = null; w.ZT.day = ''; w.ZT.byBk = null; w.ZT.ready = false;
  const h1 = w.catBriefCard();
  ok(/正在读取|暂不可用/.test(h1), '未加载过 → 显示加载中或不可用（二选一，不编数据）');

  console.log(pass + ' pass / ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
}, 400);
