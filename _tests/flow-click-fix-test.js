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

/* 6) ★ 2026-10-13 手机「点板块弹窗完全不出来」修复 —— 三道锁
 * 根因：自动刷新/回前台/东财增量补渲每次**整体替换**两栏 DOM；手机上锁屏、切微信再回来的
 * 瞬间正要点板块 ⇒ 触摸目标被换掉 ⇒ 点击被浏览器吞掉。 */
/* 6a) flowRender：内容没变就不重建 DOM（消灭绝大多数无意义重建） */
const renderSrc = seg(src, /function flowRender\(\)\{/, /\nfunction flowMore/, 0);
const renderCode = stripComments(renderSrc);
ok(renderSrc.length > 200, '取到 flowRender 源码段', 'len=' + renderSrc.length);
ok(/FLOW\._lastIn === hIn && FLOW\._lastOut === hOut/.test(renderCode),
  'flowRender 内容不变时跳过重建（不动 DOM 才不会吞点击）');
ok(/querySelector\('\.flow-rk'\)/.test(renderCode),
  '跳过前提是列表确实在屏上（空态/加载占位必须照常画）');
ok(/FLOW\._lastIn = hIn/.test(renderCode), '跳过判断后有回写上次产物（否则永不更新）');
/* 6b) 触摸保护：flowMarkTap/flowTapBusy + 后台补渲让路 */
const bindAllSrc = seg(src, /function flowMarkTap\(\)\{/, /\nvar flowOpenSheet/, 0);
const bindAllCode = stripComments(bindAllSrc);
ok(/function flowMarkTap\(\)\{ FLOW\.tapUntil = Date\.now\(\) \+ 1400 \}/.test(bindAllCode),
  '触摸保护窗口 1.4s（flowMarkTap 为模块级同一引用，靠 addEventListener 去重）');
ok(/function flowTapBusy\(\)\{ return Date\.now\(\) < \(FLOW\.tapUntil \|\| 0\) ?\}/.test(bindAllCode),
  'flowTapBusy 判定函数存在');
ok(/addEventListener\('touchstart', flowMarkTap/.test(bindAllCode) &&
  /addEventListener\('pointerdown', flowMarkTap/.test(bindAllCode),
  '两栏都挂 touchstart + pointerdown（手机触摸 + 桌面鼠标全覆盖）');
const paintSrc = seg(src, /var paint = function\(\)\{/, /\n      paint\(\)/, 0);
const paintCode = stripComments(paintSrc);
ok(paintSrc.length > 500, '取到 flowLoad·paint 源码段', 'len=' + paintSrc.length);
ok(/if\(st\.painted && flowTapBusy\(\)\) return/.test(paintCode),
  '后台补渲撞上触摸窗口时让路（数据已存，下轮再画；首屏不受限）');
ok(/if\(flowTapBusy\(\)\)\{ setTimeout\(/.test(paintCode),
  '涨停池晚到的重渲同样受触摸保护（推迟而非丢弃）');
/* 6c) 回前台的补刷延后 1.5s（回来瞬间往往正要点第一下） */
const visSrc = seg(src, /document\.addEventListener\('visibilitychange'/, /\nfunction flowFmtYi/, 0);
const visCode = stripComments(visSrc);
ok(/setTimeout\(function\(\)\{ if\(!document\.hidden && flowPageOpen\(\)\)/.test(visCode) &&
  /,\s*1500\)/.test(visCode),
  '回前台的补刷延后 1.5s 且再次校验可见性（不再瞬间替换 DOM）');

/* 7) ★ 弹窗明细的云端腿必须有硬预算（4s），不得陪首屏的 20s 单源超时一起等 */
const fetchStkSrc = seg(src, /var flowFetchStocks = async function/, /\n\/\* 板块成分股/, 0);
const fetchStkCode = stripComments(fetchStkSrc);
ok(fetchStkSrc.length > 400, '取到 flowFetchStocks 源码段', 'len=' + fetchStkSrc.length);
ok(/var FLOW_STK_CLOUD_MS = 4000/.test(stripComments(src)),
  '弹窗云端腿预算常量 FLOW_STK_CLOUD_MS = 4000');
ok(/flowWithBudget\(cloudP2, FLOW_STK_CLOUD_MS/.test(fetchStkCode),
  '云端腿套 4s 硬预算（最坏 1.5+4=5.5s 内必有结果）');
ok(/cloud = FLOW\.cloudRaw \|\| null/.test(fetchStkCode),
  '预算超时退回内存已有存档（首屏多半已拉到，0 等待）');
ok(/src:\s*cloudFail \? 'cloudfail' : 'nostk'/.test(fetchStkCode),
  '取数失败标记为 cloudfail（与 miss=存档没覆盖 严格分开）');
ok(src.indexOf('此刻云端存档和东财实时都取不到') > 0,
  '空态文案按真实原因分流（不再把失败说成「存档还没有」）');

console.log(pass + ' pass / ' + fail + ' fail');
process.exit(fail ? 1 : 0);
