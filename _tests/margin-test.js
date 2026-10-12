/* 两融 · 杠杆水位 —— 回归锁（★ 2026-10 用户需求：首页今日推荐下方 + 周期详情）
 * 锁住的四件事（任一被改回去都要红）：
 *   1. 首页「今日推荐」下方出现「两融 · 杠杆水位」卡，且含融资余额/占流通市值/T+1 数据日；
 *   2. 数据源是 datacenter-web 两融序列(RPTA_RZRQ_LSHJ, JSONP callback=) + 腾讯中证全指成交量；
 *   3. 详情页 pgMargin 含 20/60/120/250 四档周期，每档给余额变化/占流通市值比/两融÷成交额
 *      （均值+分位+趋势），且全程**无任何方向措辞**（只描述水位）；
 *   4. 数据不可达时给诚实说明，而非无限「正在读取…」。
 * 运行：node _tests/margin-test.js   （jsdom，结束必须 process.exit）
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
function seg(src, startRe, endRe, from) {
  const i = src.search(startRe);
  if (i < 0) return '';
  const base = from ? src.slice(i + from) : src.slice(i);
  const j = base.search(endRe);
  return j < 0 ? base : base.slice(0, j);
}
/* 两融展示层源码段（fmtWanYi → renderDash 定义前，仅含本需求新写的展示函数），
 * 用于方向禁词检查。收窄到本功能代码，避免误伤既有 demoRzrqData 等无关模块。 */
const marginSeg = seg(html, /function fmtWanYi\(/, /function renderDash\(map\)\{/, 0);
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1'); }
const marginCode = stripComments(marginSeg);   /* 先剥注释：约束说明里会举例「要涨/要跌」等禁词 */
const DIR = /要涨|要跌|可买|该躲|逢低|逢高|抄底|追高|看涨|看跌|做多|做空|买入信号|卖出信号/;

/* ---------- 静态锁 ---------- */
ok(/function marginCard\s*\(/.test(html), 'marginCard 已定义');
const rd = seg(html, /function renderDash\(map\)\{/, /\nfunction [A-Za-z_$]/, 0);
ok(/\bh \+= marginCard\(\)/.test(rd), 'renderDash 在「今日推荐」之后插入 marginCard()', JSON.stringify(rd.match(/marginCard\(\)/)));
ok(/reportName=RPTA_RZRQ_LSHJ/.test(html), '两融数据源 = datacenter-web RPTA_RZRQ_LSHJ');
ok(/jsonp\(marginUrl\(\),\s*'callback'\)/.test(html), '两融走 JSONP 且参数名 callback=（非 push2 系 cb=）');
ok(/function marginKlineUrl\(\)\s*\{[\s\S]{0,200}?ifzq\.gtimg\.cn[\s\S]{0,120}?FNG_SYMBOL/.test(html), '成交量走腾讯中证全指(sh000985) K 线');
ok(/s\.amt = vol \* MARGIN_VWAP/.test(html), '成交额(估)=成交量×近似均价（真实成交量驱动）');
ok(/function marginRatio\s*\(s\)\s*\{\s*return[\s\S]{0,90}?s\.rzye \/ s\.amt/.test(html), 'marginRatio = 两融余额 ÷ 成交额(估)');
ok(/'20','60','120','250'/.test(html), '详情页周期档位 = 20/60/120/250');
ok(marginSeg.length > 500, '取到两融源码段', 'len=' + marginSeg.length);
ok(!DIR.test(marginCode), '两融源码段（剥注释后）无任何方向措辞（只描述水位/位置）', (marginCode.match(DIR) || [''])[0]);
ok(/不构成方向判断|不构成任何方向判断/.test(marginSeg), '源码段含「不构成方向判断」声明');

/* ---------- 动态锁：真跑一遍（jsdom，stub jsonp/fetch） ---------- */
function fmt(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function genDates(n) {
  const r = [], t = new Date('2026-10-09T00:00:00');
  while (r.length < n) { const wd = t.getDay(); if (wd !== 0 && wd !== 6) r.push(fmt(t)); t.setDate(t.getDate() - 1); }
  return r;
}
const DS = genDates(30);
const marginData = DS.map(function (d, i) {
  return { DIM_DATE: d, RZYE: 2.40e12 + i * 5e9, RZMRE: 1.3e11, RZJME: (i % 2 ? 4e9 : -3e9), RZCHE: 1.3e11, LTSZ: 9.5e13 };
});
const klineData = DS.map(function (d, i) { return [d, 5500, 5570, 5585, 5423, 1.00e9 + i * 2e6]; });
function marginFixture() { return { result: { data: marginData } }; }
function klineFixture() { return { data: { sh000985: { qfqday: klineData } } }; }

const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'https://stock-alert-console.app.workbuddy.host/?demo=0', virtualConsole: vc });
const w = dom.window;

/* 立刻覆盖 jsonp/fetch（在 boot 的异步 ensure 之前），让两融走夹具、其余网络静默失败 */
w.jsonp = function (u) {
  const s = String(u);
  if (s.indexOf('RPTA_RZRQ_LSHJ') > -1) return Promise.resolve(marginFixture());
  return Promise.resolve({ result: { data: [] } });   /* 其他 JSONP（个股两融/涨停池）返回空，避免挂起 */
};
w.fetch = function (u) {
  const s = String(u);
  if (s.indexOf('ifzq.gtimg.cn') > -1 && s.indexOf('sh000985') > -1)
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve(klineFixture()) } });
  return Promise.reject(new Error('stub reject ' + s.slice(0, 40)));
};

setTimeout(function () {
  w.DEMO = false;
  w.MARGIN.ok = false; w.MARGIN.busy = false; w.MARGIN.err = '';
  Promise.resolve(w.marginEnsure()).then(function () {
    ok(w.MARGIN.ok, 'marginEnsure 成功（两融+成交量对齐）', 'err=' + w.MARGIN.err);
    ok(w.MARGIN.series.length >= 20, '对齐后样本≥20', 'n=' + w.MARGIN.series.length);
    w.renderDash({});
    const dash = w.document.getElementById('dash').innerHTML;
    ok(/两融 · 杠杆水位/.test(dash), '首页出现两融卡');
    ok(/融资余额/.test(dash) && /占流通市值/.test(dash), '卡含融资余额与占流通市值比');
    ok(/万亿/.test(dash), '融资余额以万亿级呈现（2.x万亿）');
    ok(/数据日/.test(dash), '卡标注 T+1 数据日');
    ok(/不构成方向判断/.test(dash), '卡标注「不构成方向判断」');
    ok(/两融÷成交额/.test(dash), '卡含两融÷成交额（杠杆密度）');

    /* 打开详情页 */
    w.marginOpen();
    const pg = w.document.getElementById('pgMargin').innerHTML;
    const tabs = w.document.getElementById('marginPeriodTabs').innerHTML;
    ok(/data-mp="20"|data-mp='20'/.test(tabs) && /data-mp="60"/.test(tabs) && /data-mp="120"/.test(tabs) && /data-mp="250"/.test(tabs),
      '详情页含 20/60/120/250 周期标签');
    ok(/融资余额/.test(pg) && /占流通市值比/.test(pg) && /两融÷成交额/.test(pg), '详情页含三项指标');
    ok(/分位/.test(pg), '详情页含当前分位');
    ok(/不构成任何方向判断/.test(pg), '详情页标注「不构成任何方向判断」');
    /* 切到 120 日档，验证真重渲 */
    w.renderMarginPeriod('120');
    const det120 = w.document.getElementById('marginDetail').innerHTML;
    ok(/占流通市值比/.test(det120) && /分位/.test(det120), '120 日档重渲含完整指标');

    /* 方向禁词：渲染结果里不得出现买卖/涨跌方向措辞（上升/下降/持平是历史描述，允许） */
    const rendered = dash + pg;
    ok(!/要涨|要跌|可买|该躲|逢低|逢高|抄底|追高|看涨|看跌|做多|做空|买入信号/.test(rendered),
      '渲染内容无任何方向措辞', (rendered.match(/要涨|要跌|可买|该躲|逢低|逢高|抄底|追高|看涨|看跌|做多|做空|买入信号/) || [''])[0]);

    /* 反向/诚实路径：数据不可达 → 卡片给说明，而非无限转圈 */
    w.MARGIN.ok = false; w.MARGIN.err = '两融接口无数据';
    const c = w.marginCard();
    ok(/两融数据暂不可用/.test(c), '数据不可达时卡片给诚实说明（非无限「正在读取…」）', JSON.stringify(c.slice(0, 60)));
    ok(!/正在读取/.test(c), '错误态卡片不显示「正在读取…」');

    console.log(pass + ' pass / ' + fail + ' fail');
    process.exit(fail ? 1 : 0);
  }).catch(function (e) {
    console.log('FAIL 异常: ' + (e && e.stack || e));
    process.exit(1);
  });
}, 600);
