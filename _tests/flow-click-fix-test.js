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
ok(/\$\('sheetFlow'\)\.classList\.add\('on'\)/.test(openByBkSrc),
  '★ 未命中时也真的弹窗给反馈（只写日志＝用户眼里的「点了没反应」）');
ok(/FLOW\.lastOpenAt/.test(openByBkSrc), '同一板块 0.8s 去抖（兜底与 click 不会双开）');

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
/* 6b) 触摸保护：flowMarkTap/flowTapBusy + 后台补渲让路
 * ★ 2026-10-13 二次加固（用户手机实测「弹窗完全不出来」）：只「不重画」还不够 ——
 *   真机上节点仍可能在极短窗口内被换掉、部分内核被换掉后干脆不派发 click。
 *   故加两道兜底：按下记住板块号（tapBk）；click 找不到 [data-bk] 或 click 根本没到 → 用 tapBk 打开。 */
const bindAllSrc = seg(src, /function flowMarkTap\(ev\)\{/, /\nvar flowOpenSheet/, 0);
const bindAllCode = stripComments(bindAllSrc);
ok(bindAllSrc.length > 300, '取到触摸保护源码段', 'len=' + bindAllSrc.length);
ok(/FLOW\.tapUntil = Date\.now\(\) \+ 1400/.test(bindAllCode),
  '触摸保护窗口 1.4s（flowMarkTap 为模块级同一引用，靠 addEventListener 去重）');
ok(/FLOW\.tapBk = el \? el\.getAttribute\('data-bk'\) : ''/.test(bindAllCode),
  '按下时记住手指所在板块号（供 DOM 被换掉后兜底）');
ok(/function flowTapMoved\(\)\{ FLOW\.tapBk = '' \}/.test(bindAllCode),
  'touchmove 取消兜底（滑动翻页不会被误判成点击）');
ok(/if\(FLOW\.tapBk !== bk\) return/.test(bindAllCode) && /Date\.now\(\) - at > 1500/.test(bindAllCode),
  'touchend 后 320ms 兜底：click 没到就按记下的板块打开（且不重复打开）');
ok(/addEventListener\('touchend', flowTapEnd/.test(bindAllCode) &&
  /addEventListener\('touchmove', flowTapMoved/.test(bindAllCode),
  '两栏都挂 touchend 兜底 + touchmove 取消');
ok(/if\(!bk && FLOW\.tapBk && Date\.now\(\) - \(FLOW\.tapAt \|\| 0\) < 1500\) bk = FLOW\.tapBk/.test(bindAllCode),
  'click 里找不到 [data-bk]（节点已被换掉）时用记住的板块兜底');
ok(/function flowTapBusy\(\)\{ return Date\.now\(\) < \(FLOW\.tapUntil \|\| 0\) ?\}/.test(bindAllCode),
  'flowTapBusy 判定函数存在');
ok(/addEventListener\('touchstart', flowMarkTap/.test(bindAllCode) &&
  /addEventListener\('pointerdown', flowMarkTap/.test(bindAllCode),
  '两栏都挂 touchstart + pointerdown（手机触摸 + 桌面鼠标全覆盖）');
/* 6b-2) 后台补渲统一出口：自动刷新是**新一次 flowLoad**，旧守卫护不住它的首绘 */
const idleSrc = seg(src, /function flowPaintIfIdle\(bg\)\{/, /\n\/\* ===== 板块/, 0);
const idleCode = stripComments(idleSrc);
ok(idleSrc.length > 200, '取到 flowPaintIfIdle 源码段', 'len=' + idleSrc.length);
ok(/if\(bg && flowTapBusy\(\) && \$\('flowIn'\)\.querySelector\('\.flow-rk'\)\)/.test(idleCode),
  '后台补渲撞上触摸窗口且列表在屏上时让路');
ok(/FLOW\._deferT = setTimeout\(/.test(idleCode), '让路后安排一次延迟补渲（不是丢弃）');
const paintSrc = seg(src, /var paint = function\(\)\{/, /\n      paint\(\)/, 0);
const paintCode = stripComments(paintSrc);
ok(paintSrc.length > 500, '取到 flowLoad·paint 源码段', 'len=' + paintSrc.length);
ok(/if\(!flowPaintIfIdle\(!!silent\)\) return/.test(paintCode),
  '自动刷新(silent)让路、显式刷新立刻画（旧 st.painted 守卫恰漏掉本次加载的首绘）');
ok(!/st\.painted && flowTapBusy\(\)/.test(paintCode),
  '不再使用「只护第二次补渲」的旧守卫（它是漏掉主场景的根因）');
ok(/ztLoad\(\)\.then\(function\(\)\{ flowPaintIfIdle\(true\) \}/.test(paintCode),
  '涨停池晚到的重渲同样走让路出口（推迟而非丢弃）');
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

/* 8) ★ 2026-10-13 真因锁：缺值判定不得只用 isFinite
 * `isFinite(null)` / `isFinite('')` 均为 **true**（Number(null)===0）⇒ null.toFixed() 抛
 * TypeError ⇒ flowOpenSheet→paintStat→flowFmtPct 抛异常 ⇒ 弹窗表头之后全部没填
 * ⇒ 用户看到「点板块没反应、不出前 5 个股」。这是本次网上问题的**真因**。
 * 用「提取纯函数 + 实跑」验证（纯源码正则判不出会不会抛）。 */
const fmtSrc = seg(src, /function flowNum\(v\)\{/, /\nfunction flowToday/, 0);
ok(fmtSrc.length > 150, '取到 flowNum/flowFmtYi/flowFmtPct 源码段', 'len=' + fmtSrc.length);
try {
  const F = new Function(fmtSrc + '\nreturn { flowNum: flowNum, flowFmtYi: flowFmtYi, flowFmtPct: flowFmtPct }')();
  ok(F.flowFmtPct(null) === '—', 'flowFmtPct(null) 返回「—」而不是抛 TypeError（真因）');
  ok(F.flowFmtPct('') === '—', "flowFmtPct('') 返回「—」（空串同样是 isFinite 陷阱）");
  ok(F.flowFmtYi(null) === '—', 'flowFmtYi(null) 返回「—」');
  ok(F.flowFmtYi('') === '—', "flowFmtYi('') 返回「—」");
  ok(F.flowFmtPct(1.234) === '+1.23%', '正常值仍正确 flowFmtPct(1.234)=+1.23%');
  ok(F.flowFmtPct(-2) === '-2.00%', '负值带负号 flowFmtPct(-2)=-2.00%');
  ok(F.flowFmtYi(1e8) === '+1.0亿', '正常值仍正确 flowFmtYi(1e8)=+1.0亿');
  ok(F.flowNum('3') === 3 && F.flowNum('-') === null, "数字串可转、'-' 判为缺值");
} catch (e) { ok(false, '纯函数实跑（flowFmtPct/flowFmtYi）', e.message); }
/* 8b) 弹窗必须「先占位再算表头」，且表头计算整体兜 try/catch */
const sheetSrc = seg(src, /var flowOpenSheet = async function\(bk\)\{/, /\nvar flowFetchStocks = async function/, 0);
ok(sheetSrc.length > 800, '取到 flowOpenSheet 源码段', 'len=' + sheetSrc.length);
ok(sheetSrc.indexOf('正在读取本板块主力净流入前 5…') > 0 &&
  sheetSrc.indexOf('正在读取本板块主力净流入前 5…') < sheetSrc.indexOf('paintStat(null)'),
  '先占位（正在读取…）再算表头 —— 表头异常也不会让弹窗一片空白');
ok(/logErr\('资金流·弹窗表头', e\)/.test(sheetSrc), '表头计算有 try/catch 兜底（异常不再吞掉整段渲染）');
ok(/flowNum\(b\.chg\)/.test(sheetSrc), '板块涨跌的正负判定也走 flowNum（null 不再当 0 用）');

console.log(pass + ' pass / ' + fail + ' fail');
process.exit(fail ? 1 : 0);
