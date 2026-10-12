/* 个股 → 板块 归属（2026-10-10 重建）· DOM 级测试
 *
 * 锁四件事（对应四条真实缺陷）：
 *   ① 行业必须是**东财官方行业** —— 正面锁用户点名的 4 只错例票
 *   ② 行业与题材**不得互相渗透** —— 概念不能被当成行业（旧病根：跨类别名映射）
 *   ③ BK 码与同花顺码**不得混用** —— 持仓行的资金取数必须用 BK 码（旧版传同花顺码 ⇒ 恒空）
 *   ④ 反向锁：把旧的跨类别名/错缓存塞回去，行为必须**不变**
 *
 * 运行：node _tests/bkmap-test.js
 */
const fs = require('fs');
const path = require('path');
const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules';
let JSDOM, VirtualConsole;
try {
  JSDOM = require(path.join(WS, 'jsdom')).JSDOM;
  VirtualConsole = require(path.join(WS, 'jsdom')).VirtualConsole;
} catch (e) { console.log('SKIP：未安装 jsdom（' + e.message + '）'); process.exit(0); }

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name) { if (cond) pass++; else { fail++; fails.push(name) } }

const FILE = 'D:/mywork/stock-alert-console/console.html';
const html = fs.readFileSync(FILE, 'utf8');
const FIX = JSON.parse(fs.readFileSync('D:/mywork/stock-alert-cloud/flow-history.json', 'utf8'));

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e && e.message)));

(async () => {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://stock-alert-console.app.workbuddy.host/', virtualConsole: vc,
    beforeParse(w) {
      /* 一律不发真请求：全部立刻失败，走页面的降级路径 */
      w.fetch = function () { return Promise.reject(new Error('offline-test')) };
      w.localStorage.clear();
    }
  });
  const W = dom.window;
  await new Promise(r => setTimeout(r, 300));

  console.log('===== A 结构：内嵌表就位 =====');
  ok(typeof W.BK_MAP === 'object' && W.BK_MAP, 'A1 BK_MAP 已内嵌');
  ok((W.BK_MAP.b || []).length > 300, 'A2 板块码表 ' + (W.BK_MAP.b || []).length + ' 个');
  ok(W.BK_MAP.hi > 200 && W.BK_MAP.hi < (W.BK_MAP.b || []).length, 'A3 hi 分隔行业/题材 = ' + W.BK_MAP.hi);
  ok(typeof W.BK_MAP.f === 'string' && W.BK_MAP.f.length === W.BK_MAP.hi, 'A4 f 位图长度 == hi');
  ok((W.BK_MAP.d1 || '').length > 10000, 'A5 行业段 d1 ' + (W.BK_MAP.d1 || '').length + ' 字符');
  ok((W.BK_MAP.d2 || '').length > 10000, 'A6 题材段 d2 ' + (W.BK_MAP.d2 || '').length + ' 字符');
  ok(typeof W.bkPick === 'function', 'A7 bkPick 已定义');

  console.log('\n===== B 行业＝官方（正面锁用户点名的错例） =====');
  const IND = {
    '600058': '商贸零售',   /* 旧显示「互联网电商」（'电商概念'→'互联网电商'） */
    '600611': '铁路公路',   /* 旧显示「互联网电商」 */
    '002415': '计算机设备', /* 旧显示「半导体」（'国产芯片'→'半导体'） */
    '000155': '电力',       /* 旧显示「风电设备」（'风能'→'风电设备'） */
    '600703': '光学光电子', /* 旧也对，锁住不许改坏 */
    '600519': '白酒',       /* 官方 L3「白酒Ⅲ」→ 显示剥离罗马数字后缀 */
    '300750': '锂电池',     /* 官方 L3（有资金）；L2 是「电池」，取更细的那一级 */
    '300068': '电池',       /* 官方 L3「蓄电池及其他电池」无资金 → 回退 L2「电池」 */
    '300772': '风电设备',   /* 官方 L3「风电整机」无资金 → 回退 L2「风电设备」 */
    '300106': '乳品'        /* 官方 L3（有资金） */
  };
  Object.keys(IND).forEach(c => {
    const p = W.bkPick(c, 3);
    const nm = p && p.ind ? p.ind.name : '(null)';
    ok(nm === IND[c], 'B ' + c + ' 行业应为「' + IND[c] + '」实得「' + nm + '」');
  });

  console.log('\n===== C 行业与题材不得互相渗透（结构性断言，不用名字黑名单） =====');
  /* ⚠️ 为什么不能按名字拉黑名单：「电池」「乳品」「风电设备」「半导体」**都是东财真实的
   *    行业名**（300750 的 L3 就叫「锂电池」、300106 的 L3 就叫「乳品」）。
   *    按名字判定会把这些**正确答案**误判成错误。所以改成两条与名字无关的结构性断言。 */
  const RAW = JSON.parse(fs.readFileSync('D:/mywork/_research/rotation/bk/f10-boardtype.raw.json', 'utf8')).rows;
  const officialInd = new Set(), stockIndNames = {};
  RAW.forEach(r => {
    if (r[2] !== '行业') return;
    officialInd.add(r[4]);
    (stockIndNames[r[0]] = stockIndNames[r[0]] || new Set()).add(String(r[1]).replace(/[ⅠⅡⅢⅣⅤ]\s*$/, ''));
  });
  ok(officialInd.size > 400, 'C0 官方行业 BK 集合 ' + officialInd.size + ' 个（参照系来自官方表）');
  /* C1 每个板块码的分区必须正确：行业区 ⊆ 官方行业，题材区 ∩ 官方行业 = ∅ */
  const BH = W.BK_MAP.b.slice(0, W.BK_MAP.hi), BC = W.BK_MAP.b.slice(W.BK_MAP.hi);
  const hBad = BH.filter(b => !officialInd.has(b)), cBad = BC.filter(b => officialInd.has(b));
  ok(hBad.length === 0, 'C1a 行业区 ' + BH.length + ' 个板块全部是官方行业（越界 ' + hBad.length + '：' + hBad.slice(0, 3) + '）');
  ok(cBad.length === 0, 'C1b 题材区 ' + BC.length + ' 个板块**没有一个**是官方行业（越界 ' + cBad.length + '：' + cBad.slice(0, 3) + '）');
  /* C2 ★ 最强断言：全市场每只票显示的行业名，必须等于它**自己官方行业路径**里的某一级名字。
   *    任何"从外部翻译来的名字"（互联网电商 / 半导体 / 汽车整车…）都会在这里被抓住。 */
  const allStocks = Object.keys(stockIndNames).filter(c => /^[036]\d{5}$/.test(c));
  let nmBad = [], missInd = 0;
  allStocks.forEach(c => {
    const p = W.bkPick(c, 1);
    if (!p || !p.ind) { missInd++; return }
    if (!stockIndNames[c].has(p.ind.name)) nmBad.push(c + '→' + p.ind.name)
  });
  ok(nmBad.length === 0, 'C2 全市场 ' + allStocks.length + ' 只票的行业名 100% 出自它自己的官方行业路径（越界 ' + nmBad.length + '：' + nmBad.slice(0, 4).join(' ') + '）');
  ok(missInd === 0, 'C3 全市场每只票都有行业归属（例外 ' + missInd + ' 只）');
  /* C4 题材里不得出现该票自己的官方行业名 */
  let crossBad = [];
  allStocks.forEach(c => {
    const p = W.bkPick(c, 5);
    (p.con || []).forEach(x => { if (stockIndNames[c].has(x.name)) crossBad.push(c + '→' + x.name) })
  });
  ok(crossBad.length === 0, 'C4 题材里不混入行业名（越界 ' + crossBad.length + '：' + crossBad.slice(0, 4).join(' ') + '）');
  /* C5 用户点名的具体身份 */
  const p155 = W.bkPick('000155', 5);
  ok(p155.con.some(x => x.name === '锂矿概念'), 'C5 川能动力 题材里**必须**有「锂矿概念」（实得 ' + p155.con.map(x => x.name).join('、') + '）');
  ok(p155.con.some(x => x.name === '风能'), 'C6 川能动力 题材里也有「风能」⇒ 行业=电力，风能/锂矿都是题材');
  const p058 = W.bkPick('600058', 5);
  ok(p058.con.some(x => x.name === '电商概念'), 'C7 五矿发展「电商概念」出现在**题材**里（这才是它该在的地方）');
  ok(!p058.con.some(x => x.name === '互联网电商'), 'C8 五矿发展 题材里没有同花顺的「互联网电商」');

  console.log('\n===== D 别名表必须为空（跨类映射的病根） =====');
  ok(typeof W.STKBK_ALIAS === 'object' && Object.keys(W.STKBK_ALIAS).length === 0,
    'D1 STKBK_ALIAS 为空对象（实得 ' + Object.keys(W.STKBK_ALIAS || {}).length + ' 条）');
  /* ⚠️ 必须剥注释再搜 —— 本文件的新注释里**故意**写了错例（'电商概念':'互联网电商'）
     当作反面教材，不剥注释会把自己的说明文档判成违规。 */
  const onNoCmt = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\/[^\n]*/g, '');
  ok(!/'电商概念'\s*:\s*'互联网电商'|'国产芯片'\s*:\s*'半导体'|'风能'\s*:\s*'风电设备'|'新能源汽车'\s*:\s*'汽车整车'/.test(onNoCmt),
    'D2 剥注释后源码里不存在跨类映射字面量');
  /* ★ 反向锁：把错别名塞回去，bkPick 行为必须**不变** */
  W.STKBK_ALIAS['电商概念'] = '互联网电商';
  W.STKBK_ALIAS['风能'] = '风电设备';
  W.STKBK_ALIAS['国产芯片'] = '半导体';
  ok(W.bkPick('600058', 2).ind.name === '商贸零售', 'D3 ★反向锁：塞回错别名后 600058 行业仍为「商贸零售」');
  ok(W.bkPick('002415', 2).ind.name === '计算机设备', 'D4 ★反向锁：塞回错别名后 002415 行业仍为「计算机设备」');
  ok(W.bkPick('000155', 2).ind.name === '电力', 'D5 ★反向锁：塞回错别名后 000155 行业仍为「电力」');

  console.log('\n===== E BK 码 ≠ 同花顺码（旧版持仓行恒空的真 bug） =====');
  const pk155 = W.bkPick('000155', 2);
  ok(/^BK\d+$/.test(pk155.ind.bk), 'E1 行业返回的是东财 BK 码（' + pk155.ind.bk + '）');
  ok(/^BK\d+$/.test(pk155.con[0].bk), 'E2 题材返回的也是 BK 码（' + pk155.con[0].bk + '）');
  const rotCode = pk155.rot ? String(pk155.rot.code) : '';
  ok(/^(881|884|885|886)/.test(rotCode), 'E3 轮动返回的是同花顺码（' + rotCode + '）');
  ok(pk155.ind.bk !== rotCode, 'E4 两套码制确实不同源（' + pk155.ind.bk + ' vs ' + rotCode + '）');

  console.log('\n===== F 资金取数：BK 码直连存档（零映射） =====');
  W.FLOW.cloudRaw = FIX;
  W.FLOW.cloudAt = Date.now();
  const fx = W.holdFlowStat(pk155.ind.bk);
  ok(fx && isFinite(fx.cum) && fx.cum !== 0, 'F1 行业 BK 取到当月主力净额（' + (fx && fx.cum) + '）');
  const fxOld = W.holdFlowStat(rotCode);
  ok(fxOld === null, 'F2 ★反向锁：用同花顺码去查存档恒为 null（正是旧版的失效方式，' + rotCode + '）');
  const fxCon = W.holdFlowStat(pk155.con[0].bk);
  ok(fxCon && isFinite(fxCon.cum), 'F3 题材 BK 也取到资金（' + (fxCon && fxCon.cum) + '）');

  console.log('\n===== G 持仓行渲染（端到端） =====');
  const line = W.holdBoardLine('000155');
  ok(line.indexOf('电力') >= 0, 'G1 「板块」行出现官方行业名');
  ok(line.indexOf('互联网电商') < 0 && line.indexOf('风电设备') < 0, 'G2 不出现任何被翻译错的名字');
  ok(line.indexOf('当月') >= 0, 'G3 出现「当月」资金（这一行旧版恒不显示）');
  ok(line.indexOf('题材') >= 0 && line.indexOf('锂矿概念') >= 0, 'G4 出现题材行且含「锂矿概念」');
  ok((line.match(/ev-line/g) || []).length === 2, 'G5 两行结构（板块 + 题材）');
  const none = W.holdBoardLine('');
  ok(none === '', 'G6 非法代码返回空串（不硬凑）');

  console.log('\n===== H 页面无脚本错误 =====');
  ok(errors.length === 0, 'H1 加载期间无 jsdomError（' + errors.slice(0, 3).join(' | ') + '）');

  console.log('\n' + (fail === 0 ? '✅ ALL GREEN' : '❌ 有失败') + '  通过 ' + pass + ' / 失败 ' + fail);
  if (fail) fails.forEach(f => console.log('   ✗ ' + f));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('运行异常：' + (e && e.stack || e)); process.exit(1) });
