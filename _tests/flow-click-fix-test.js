/* 资金流「点击没反应」修复的静态回归锁（无 jsdom，纯源码断言）
 * 背景：2026-10-11 用户第 4 次报「资金流向的页面的点击没反应」。
 * 本轮定位到 3 个**真实可复现**的实现级缺陷（不是网络问题）：
 *   ① 圆球点击只认 `circle[data-bk]`：圆球是**内联 SVG**，部分内核下 closest 对 SVG
 *      元素行为不一致 → 点球没反应（点牌子可以）。修：改 selector 为通用的 `[data-bk]`。
 *   ② 「更多·展开」的 `FLOW.showAll[k] = !FLOW.showAll[k]` 在键缺失 / undefined 时静默
 *      return（`!undefined` 变 true 但**原实现根本不写回**，因为原实现里 `!FLOW.showAll[k]`
 *      会取反后赋值 —— 看似没问题，但键名一旦与 flowSection 传入的 key 不一致就永远不翻）
 *      → 抽成 flowMore() 并加兜底回写。
 *   ③ 栏标题写死「· 题材」而列表其实是**双维综合排名**（不是字面 TOP10）→ 口径造假。
 * 本测试要锁住的四件事（任一改回去都要红）：
 *   1. 圆球/牌子点击走**通用 [data-bk]**，不再只认 circle[data-bk]；
 *   2. 点击处理器对「板块未命中」不再静默（有日志/返回 false 语义）；
 *   3. 「更多」抽成 flowMore 且带 showAll 键兜底；
 *   4. 列表标题不再写死「· 题材」。
 * 运行：node _tests/flow-click-fix-test.js
 */
const fs = require('fs');
const src = fs.readFileSync('D:/mywork/stock-alert-console/console.html', 'utf8');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' → ' + extra : '')); }
}
function seg(s, startRe, endRe, from) {
  const i = s.search(startRe);
  if (i < 0) return '';
  const base = s.slice(i + (from || 0));
  const j = base.search(endRe);
  return j < 0 ? base : base.slice(0, j);
}
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/* 1) 点击绑定：必须用通用 [data-bk]（覆盖圆形/文字/整行），不能只认 circle[data-bk] */
const bindSrc = seg(src, /function flowBindClicks\(\)\{/, /\nvar flowOpenSheet/, 0);
const bindCode = stripComments(bindSrc);
ok(bindSrc.length > 200, '取到 flowBindClicks 源码段', 'len=' + bindSrc.length);
ok(/closest\(\s*'\[data-bk\]'\s*\)/.test(bindCode),
  '点击走通用 [data-bk]（圆球是内联 SVG，只认 circle[data-bk] 会漏）');
ok(!/closest\(\s*'circle\[data-bk\]'\s*\)/.test(bindCode),
  '不再只认 circle[data-bk] 这一种选择器');
ok(/flowOpenByBk\s*\(/.test(bindCode), '点击统一走 flowOpenByBk（可统一补反馈与日志）');

/* 2) 点击处理器不再静默：flowOpenByBk 在「板块未命中」时留痕而不是无声返回 */
const openByBkSrc = seg(src, /function flowOpenByBk\(bk\)\{/, /\nfunction flowBindClicks/, 0);
ok(openByBkSrc.length > 100, '取到 flowOpenByBk 源码段', 'len=' + openByBkSrc.length);
ok(/logOp\s*\(/.test(openByBkSrc), '未命中板块时会记日志（不是静默 return）');
ok(/return\s+false/.test(openByBkSrc), 'flowOpenByBk 有明确成功/失败返回值语义');

/* 3) 「更多」：抽成 flowMore 且带 showAll 键兜底回写 */
const moreSrc = seg(src, /function flowMore\(more\)\{/, /\nfunction flowOpenByBk/, 0);
ok(moreSrc.length > 100, '取到 flowMore 源码段', 'len=' + moreSrc.length);
ok(/FLOW\.showAll\[k\s*\|\|\s*'fn'\]\s*=/.test(moreSrc),
  'showAll 键缺失时有兜底回写（否则点击表现为「没反应」）');
ok(/flowRender\(\)/.test(moreSrc), 'flowMore 会触发重渲（展开/收起可见）');

/* 4) 口径：列表标题不得再写死「· 题材」（列表是双维综合排名，不是字面 TOP10）
 * ★ 锚点必须落在**函数结束后**：段内注释就含「综合排序」字样，用超前锚点会把段切在注释处。 */
const sectSrc = seg(src, /function flowSection\(title, arr, key\)\{/, /\n\/\* 单栏/, 0) ||
                seg(src, /function flowSection\(title, arr, key\)\{/, /\nfunction flowPack/, 0);
ok(sectSrc.length > 300, '取到 flowSection 源码段', 'len=' + sectSrc.length);
ok(!/'\s*· 题材<\/div>'/.test(sectSrc), '列表标题不再写死「· 题材」');
ok(/综合排序/.test(sectSrc), '列表标题如实说明「按综合排序」（口径不再造假）');

/* 5) 域名单一真源：flowFetchToday / flowFetchHist 不得再写死 push2delay（已被标记，实测 000） */
const todaySrc = seg(src, /async function flowFetchToday\(mode\)\{/, /\nvar flowFetchHist/, 0);
ok(todaySrc.length > 300, '取到 flowFetchToday 源码段', 'len=' + todaySrc.length);
ok(!/push2delay\.eastmoney\.com/.test(stripComments(todaySrc)),
  'flowFetchToday 不再写死 push2delay（交给 emGet 域名池换域名）');
const hostsSrc = seg(src, /var EM_HOSTS = \[/, /\nvar EM_CHAN/, 0);
ok(/push2test\.eastmoney\.com/.test(hostsSrc), 'EM_HOSTS 首位是 push2test（实测唯一稳定）');
const swapSrc = seg(src, /function emSwap\(url, host\)\{/, /\nfunction fetchT/, 0);
ok(/push2\(\?:test\|delay\|his\)\?/.test(swapSrc) && !/push2ex/.test(swapSrc),
  'emSwap 正则排除 push2ex（涨停池专用路径在 push2test 上 404）');

console.log(pass + ' pass / ' + fail + ' fail');
process.exit(fail ? 1 : 0);
