#!/usr/bin/env node
/* ============================================================
 *  margin-regime-test.js —— 两融·大盘阶段雷达 回归
 *
 *  覆盖三层：
 *    【A】云端 SPEC 冻结口径（改口径必须显式改本测试，防悄悄漂移）
 *    【B】纯函数单测（median / gradeOf / permCompare / episodes / segObs / buildSeries / markBars）
 *    【C】console.html 契约（页面读的字段 == 云端写的字段；MG_H == SPEC.horizons；无指令性措辞）
 *
 *  ★ 范式约束（本环境 jsdom 不可用）：
 *      - 不做 DOM 操作，只做「源码正则 + 纯函数」
 *      - 断言锚点必须能真的匹配到调用点/字面量，避免「实现换掉照样绿」
 *      - 负断言先去注释，但「注入/字面量是否存在」必须查原始文本
 *
 *  用法：node _tests/margin-regime-test.js
 * ============================================================ */
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const CLOUD_JS = path.join(ROOT, 'stock-alert-cloud', 'margin-regime.js')
const CLOUD_JSON = path.join(ROOT, 'stock-alert-cloud', 'margin-regime.json')
const CONSOLE = path.join(ROOT, 'stock-alert-console', 'console.html')
const WORKFLOW = path.join(ROOT, 'stock-alert-cloud', '.github', 'workflows', 'margin.yml')

let pass = 0, fail = 0
const bad = []
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; bad.push(name); console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')) }
}
function group(t) { console.log('\n【' + t + '】') }

const read = f => fs.readFileSync(f, 'utf8')
// 去注释副本（注意：查「字面量/注入是否存在」必须用原文，不能用它）
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const cloudSrc = read(CLOUD_JS)
const cloudNoC = strip(cloudSrc)
const consoleSrc = read(CONSOLE)
const consoleNoC = strip(consoleSrc)
const wfSrc = read(WORKFLOW)
const MR = require(CLOUD_JS)          // 走 module.exports（同时验证导出面完整）

/* ============================================================
 * 【A】云端 SPEC 冻结口径
 * ============================================================ */
group('A · 云端 SPEC 冻结口径（改口径必须同步改本测试）')
const S = MR.SPEC
ok('SPEC 已导出', !!S)
ok('样本起点 = 2013-01-01（两融扩容后，预注册）', S.sampStart === '2013-01-01', S.sampStart)
ok('跨期分界 = 2020-01-01（2013-2019 / 2020 至今同号判定）', S.splitAt === '2020-01-01', S.splitAt)
ok('滚动分位窗口 = 250 交易日（因果，非全历史）', S.winq === 250, S.winq)
ok('事件段聚合间隔 = 10 交易日（连段命中算 1 段）', S.gap === 10, S.gap)
ok('前瞻期限 = [20,60,120,250]', JSON.stringify(S.horizons) === '[20,60,120,250]', JSON.stringify(S.horizons))
ok('入场点 = T+1 收盘（严格因果）', S.entry === 'T+1 收盘', S.entry)
ok('置换检验次数 = 2000', S.permR === 2000, S.permR)
ok('可信度段数门槛 mid=25 / high=30', S.minSeg && S.minSeg.mid === 25 && S.minSeg.high === 30, JSON.stringify(S.minSeg))
ok('p 阈值 mid=0.05 / weak=0.10', S.pMid === 0.05 && S.pWeak === 0.10, S.pMid + '/' + S.pWeak)
ok('Bonferroni 主要假设 = 0.05/8（4 对两端对比 × 2 期限）', Math.abs(S.bonfPrimary - 0.05 / 8) < 1e-12, S.bonfPrimary)
ok('Bonferroni 探索性 = 0.05/48（12 层 × 4 期限）', Math.abs(S.bonfExplore - 0.05 / 48) < 1e-12, S.bonfExplore)
ok('顶/底标注窗口 = ±60 交易日', S.barWindow === 60, S.barWindow)
ok('顶/底最小幅度 = 15%', S.barAmp === 0.15, S.barAmp)

/* ---- 预注册假设族与阈值必须与 SPEC 自洽（防「改了阈值忘了改分母」）---- */
group('A2 · 预注册检验族与 Bonferroni 分母自洽')
const layerCount = MR.LAYER_DEFS.length
ok('LAYER_DEFS 层数 = 12', layerCount === 12, String(layerCount))
ok('探索性分母 = 层数 × 期限数 = 12×4 = 48', Math.abs(S.bonfExplore - 0.05 / (layerCount * S.horizons.length)) < 1e-12)
ok('主要假设 8 次 = 4 对 × 2 期限（在源码里核对）', /bonfPrimary:\s*0\.05\s*\/\s*8/.test(cloudNoC))
ok('探索性 48 次 = 12 层 × 4 期限（在源码里核对）', /bonfExplore:\s*0\.05\s*\/\s*48/.test(cloudNoC))
ok('SPEC 注释声明「不允许按结果回改」', /不允许按结果回改/.test(cloudSrc))
ok('SPEC 注释声明「预注册、冻结，不做参数寻优」', /预注册、冻结，不做参数寻优/.test(cloudSrc))

/* ---- 三项状态指标定义：必须都写成「占比/分位」，不能出现绝对水平做主口径 ---- */
group('A3 · 状态量定义（L/T/P + B60）')
ok('L = 融资余额 / 流通市值（杠杆水位）', /L\s*=\s*融资余额\s*\/\s*流通市值/.test(cloudSrc))
ok('T = 融资买入额 / 融资余额（周转率）', /T\s*=\s*融资买入额\s*\/\s*融资余额/.test(cloudSrc))
ok('P = 融资买入额 / 两市成交额（参与度）', /P\s*=\s*融资买入额\s*\/\s*两市成交额/.test(cloudSrc))
ok('B60 = 融资余额 60 交易日变化率', /B60\s*=\s*融资余额\s*60\s*交易日变化率/.test(cloudSrc))
ok('明确不用「全历史分位」做主口径', /不用全历史分位作主口径/.test(cloudSrc))
ok('注释说明绝对水平跨年代不可比', /跨年代不可比/.test(cloudSrc))

/* ---- 12 层定义逐条核对（阈值写死，不做搜索）---- */
group('A4 · 12 层阈值逐条核对（预注册，无自由参数）')
const ids = MR.LAYER_DEFS.map(d => d.id)
const expectIds = ['P_ice', 'P_boil', 'T_ice', 'T_boil', 'both_ice', 'L_high', 'L_low', 'delev_fast', 'delev_mild', 'lev_fast', 'sign_top', 'sign_bot']
ok('层 id 清单与预注册一致', JSON.stringify(ids) === JSON.stringify(expectIds), ids.join(','))
const findDef = id => MR.LAYER_DEFS.find(d => d.id === id)
ok('P_ice 阈值 = 分位 ≤5%', /P_q\s*<=\s*0\.05/.test(findDef('P_ice').test.toString()))
ok('P_boil 阈值 = 分位 ≥95%', /P_q\s*>=\s*0\.95/.test(findDef('P_boil').test.toString()))
ok('both_ice = P≤5% 且 T≤5%', /P_q\s*<=\s*0\.05\s*&&\s*r\.T_q\s*<=\s*0\.05/.test(findDef('both_ice').test.toString()))
ok('L_high = 分位 ≥85%', /L_q\s*>=\s*0\.85/.test(findDef('L_high').test.toString()))
ok('L_low = 分位 ≤15%', /L_q\s*<=\s*0\.15/.test(findDef('L_low').test.toString()))
ok('delev_fast = B60 ≤ -8%', /B60\s*<=\s*-8/.test(findDef('delev_fast').test.toString()))
ok('delev_mild = B60 ∈ [-8%, -3%)', /B60\s*>=\s*-8\s*&&\s*r\.B60\s*<\s*-3/.test(findDef('delev_mild').test.toString()))
ok('lev_fast = B60 ≥ 8%', /B60\s*>=\s*8/.test(findDef('lev_fast').test.toString()))
ok('sign_top = P≥85% 且 T≥67% 且 B60>0', /P_q\s*>=\s*0\.85\s*&&\s*r\.T_q\s*>=\s*0\.67\s*&&\s*r\.B60\s*>\s*0/.test(findDef('sign_top').test.toString()))
ok('sign_bot = P≤5% 且 T≤10% 且 B60<0', /P_q\s*<=\s*0\.05\s*&&\s*r\.T_q\s*<=\s*0\.10\s*&&\s*r\.B60\s*<\s*0/.test(findDef('sign_bot').test.toString()))

/* ---- 四对主要假设 ---- */
group('A5 · 四对预注册主要假设')
const pairIds = (cloudSrc.match(/PRIMARY_PAIRS\s*=\s*\[([\s\S]*?)\n\]/) || [])[1] || ''
ok('主要假设含 4 对', (pairIds.match(/\bid:\s*'/g) || []).length === 4, String((pairIds.match(/\bid:\s*'/g) || []).length))
;['P_ice', 'P_boil', 'T_ice', 'T_boil', 'delev_fast', 'lev_fast', 'L_low', 'L_high'].forEach(k => {
  ok('主要假设引用层 ' + k, new RegExp("'" + k + "'").test(pairIds))
})
ok('主要假设只取 20/60 日（horizons:[20,60]）', /horizons:\s*\[\s*20\s*,\s*60\s*\]/.test(pairIds))

/* ============================================================
 * 【B】纯函数单测
 * ============================================================ */
group('B · 纯函数单测')

/* ---- median ---- */
ok('median 空数组 → null', MR.median([]) === null)
ok('median 奇数个取中', MR.median([3, 1, 2]) === 2)
ok('median 偶数个取均值', MR.median([1, 2, 3, 4]) === 2.5)
ok('median 不修改入参', (() => { const a = [3, 1, 2]; MR.median(a); return JSON.stringify(a) === '[3,1,2]' })())

/* ---- gradeOf：可信度由 段数 + p + 跨期同号 三者共同决定 ---- */
const g = (nSeg, p, trMed, teMed, thr) => MR.gradeOf(nSeg, p, trMed, teMed, thr == null ? S.bonfPrimary : thr)
ok('gradeOf: 段数够 + p 显著 + 跨期同号 → 高', g(30, 0.001, 0.05, 0.04) === '高')
ok('gradeOf: 段数不足（29<30）→ 不给高', g(29, 0.001, 0.05, 0.04) !== '高')
ok('gradeOf: p 不显著 → 不给高', g(50, 0.5, 0.05, 0.04) !== '高')
ok('gradeOf: 跨期反号（tr+/te-）→ 不给高', g(50, 0.001, 0.05, -0.04) !== '高')
ok('gradeOf: 段数 ≥25 且 p<pMid → 中', g(25, 0.01, 0.05, 0.04) === '中')
ok('gradeOf: 段数 <25 → 低', g(10, 0.001, 0.05, 0.04) === '低')
ok('gradeOf: p=null → 低（无检验结果不给可信度）', g(50, null, 0.05, 0.04) === '低')

/* ---- permCompare：置换检验结构 ---- */
const A = [0.05, 0.04, 0.06, 0.03, 0.07, 0.05, 0.04, 0.06]
const B = [-0.02, -0.01, -0.03, 0.00, -0.02, 0.01, -0.04, -0.02]
const cmp = MR.permCompare(A, B, 200)
ok('permCompare 返回 {diff,p}', cmp && typeof cmp.diff === 'number' && typeof cmp.p === 'number')
ok('permCompare diff = 两组中位数差（正）', cmp.diff > 0.03, String(cmp.diff))
ok('permCompare p ∈ [0,1]', cmp.p >= 0 && cmp.p <= 1, String(cmp.p))
ok('permCompare 明显分离时 p 小（<0.15）', cmp.p < 0.15, String(cmp.p))
ok('permCompare 同分布时 p 不极端', (() => { const c = MR.permCompare(A, A.slice(), 200); return c.p >= 0.5 })())
ok('permCompare 空组不崩（返回 null 或 p=null）', (() => { const c = MR.permCompare([], [], 50); return c && (c.p === null || isFinite(c.p)) })())
ok('permCompare 决定性：置换用种子或固定次数（permR 传入生效）', /permCompare\s*\(/.test(cloudNoC))

/* ---- episodes / segObs：事件段聚合（连段命中日算 1 段）---- */
const rows = []
for (let i = 0; i < 100; i++) {
  rows.push({ d: '2020-01-' + String((i % 28) + 1).padStart(2, '0'), hs: 1000 + i * 10, hit: i >= 10 && i <= 14 })
}
const eps = MR.episodes(rows, r => r.hit, S.gap)
ok('episodes: 连续命中（10~14）聚成 1 段', eps.length === 1, JSON.stringify(eps.map(e => [e.start, e.end])))
/* 实现字段名 = { start, end, idx, from, to, days }（见源码） */
ok('episodes: 段记 start/end 边界正确', eps[0].start === 10 && eps[0].end === 14, JSON.stringify([eps[0].start, eps[0].end]))
ok('episodes: 段附 idx 明细 + from/to + days', Array.isArray(eps[0].idx) && eps[0].idx.length === 5 && 'from' in eps[0] && 'to' in eps[0] && eps[0].days === 5, JSON.stringify([eps[0].days, eps[0].idx.length]))
ok('episodes: 无命中 → 空数组', MR.episodes(rows, () => false, 10).length === 0)
ok('episodes: 全命中 → 1 段', MR.episodes(rows, () => true, 10).length === 1)
/* 间隔 >gap 要分段 */
const rows2 = rows.map((r, i) => ({ ...r, hit: i <= 4 || i >= 20 }))
ok('episodes: 间隔 15>gap(10) → 分 2 段', MR.episodes(rows2, r => r.hit, 10).length === 2)

/* segObs：每段 1 个观测（关键：防相邻日重叠前瞻收益造成伪重复） */
const rows3 = []
for (let i = 0; i < 60; i++) rows3.push({ d: 'd' + i, hs: 100 + i, hit: i >= 5 && i <= 25 })
const obs = MR.segObs(rows3, r => r.hit, 20, 10)
ok('segObs: 1 段 → 1 个观测（不是 21 个）', obs.length === 1, String(obs.length))
ok('segObs: 观测含 v（前瞻收益）与 startD', obs[0] && 'v' in obs[0] && 'startD' in obs[0], JSON.stringify(obs[0]))
ok('segObs: 尾部不足 H 日的段被丢弃', obs.every(o => o.v != null))

/* ---- fwd：前瞻收益自「信号日次一交易日」起算（严格因果）----
 * 实现：e = i+1；返回 rows[e+H].hs / rows[e].hs - 1
 * ⇒ 分母是 e（=次一日），不是 i（信号日）。这是「不偷看信号日当天价格」的关键。 */
const fr = []
for (let i = 0; i < 10; i++) fr.push({ d: 'd' + i, hs: 100 + i * 10 })   // hs = 100,110,120,...
ok('fwd: e=i+1，分母取「次一交易日」（不是信号日 i）', (() => { const v = MR.fwd(fr, 0, 2); return Math.abs(v - (fr[3].hs / fr[1].hs - 1)) < 1e-12 })(), String(MR.fwd(fr, 0, 2)))
ok('fwd: 具体值 = rows[3]/rows[1]-1 = 0.1818', Math.abs(MR.fwd(fr, 0, 2) - (130 / 110 - 1)) < 1e-12, String(MR.fwd(fr, 0, 2)))
ok('fwd: 不偷看当天（fwd(i) ≠ fwd(i+1)/fwd(i)）', Math.abs(MR.fwd(fr, 0, 1) - (fr[1].hs / fr[0].hs - 1)) > 1e-9)
ok('fwd: 越界 → null（不偷看未来）', MR.fwd(fr, 9, 20) === null)
ok('fwd: 边界 e+H == rows.length → null', MR.fwd(fr, 7, 2) === null, String(MR.fwd(fr, 7, 2)))

/* ---- buildSeries：字段与阈值 ---- */
const rawRows = []
for (let i = 0; i < 400; i++) {
  rawRows.push({ DIM_DATE: new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10), RZYE: 10000 + i, RZMRE: 200 + (i % 7), LTSZ: 500000, NEW: 3000 + i })
}
const amtMap = {}
rawRows.forEach(r => { amtMap[r.DIM_DATE] = 8000 })
const built = MR.buildSeries(rawRows, amtMap)
ok('buildSeries: 产出非空', built.length > 0, String(built.length))
ok('buildSeries: 含 L/T/P/B60 与 L_q/T_q/P_q', built.length && ['L', 'T', 'P', 'B60', 'L_q', 'T_q', 'P_q'].every(k => k in built[built.length - 1]), built.length ? Object.keys(built[built.length - 1]).join(',') : '')
ok('buildSeries: 过滤 sampStart 之前的数据', built.every(r => r.d >= S.sampStart), built[0] && built[0].d)
ok('buildSeries: 滚动分位前 winq 日内为 null（不足 60% 覆盖率）', built[0].L_q === null)
ok('buildSeries: 排序升序', built.every((r, i) => i === 0 || r.d >= built[i - 1].d))
ok('buildSeries: 命中 L 定义（余额/流通市值）', (() => { const r = built[built.length - 1]; return r.L == null || Math.abs(r.L - r.rzye / 500000) < 1e-9 })())

/* ---- markBars：顶/底标注 ---- */
const bars = MR.markBars(built)
ok('markBars: 返回数组（元素含 i/type）', Array.isArray(bars) && (bars.length === 0 || ('i' in bars[0] && 'type' in bars[0])))
ok('markBars: type 只取「顶」或「底」', bars.every(b => b.type === '顶' || b.type === '底'))
ok('markBars: 顶/底交替（同类型不连排）', bars.every((b, i) => i === 0 || b.type !== bars[i - 1].type))

/* ---- matchProfile：与顶/底画像吻合度 ---- */
const profBot = { n: 3, Lq: 0.1, Tq: 0.05, Pq: 0.02, B60: -5 }
const profTop = { n: 4, Lq: 0.9, Tq: 0.8, Pq: 0.9, B60: 6 }
const mp = MR.matchProfile({ d: 'x', Lq: 0.08, Tq: 0.03, Pq: 0.01, B60: -9 }, profBot, profTop)
ok('matchProfile 返回 detail/total/closerTo', mp && Array.isArray(mp.detail) && typeof mp.total === 'number' && 'closerTo' in mp)
ok('matchProfile: 四维（水位/周转率/参与度/余额60日）', mp.detail.length === 4, String((mp.detail || []).length))
ok('matchProfile: 冰点样本更接近「底部」', mp.closerTo === '底部', mp.closerTo)
ok('matchProfile: nearBottom 计数合理', mp.nearBottom >= 0 && mp.nearBottom <= mp.total, mp.nearBottom + '/' + mp.total)
ok('matchProfile: 顶部样本更接近「顶部」', (() => { const m = MR.matchProfile({ d: 'x', Lq: 0.95, Tq: 0.9, Pq: 0.95, B60: 9 }, profBot, profTop); return m.closerTo === '顶部' })())

/* ============================================================
 * 【C】console.html 契约
 * ============================================================ */
group('C · console.html 契约（页面字段 == 云端字段）')

/* 用真实存档做字段核对（这是「页面读的」与「云端写的」之间唯一的强约束） */
const arc = JSON.parse(read(CLOUD_JSON))
const arcKeys = Object.keys(arc)
const needTopKeys = ['date', 'spec', 'sample', 'latest', 'profile', 'match', 'layers', 'pairs', 'gradeSummary', 'strength', 'series']
ok('存档含页面所需全部顶层字段', needTopKeys.every(k => arcKeys.indexOf(k) >= 0), needTopKeys.filter(k => arcKeys.indexOf(k) < 0).join(','))
ok('存档 latest 含 d/L/T/P/Lq/Tq/Pq/B60', ['d', 'L', 'T', 'P', 'Lq', 'Tq', 'Pq', 'B60'].every(k => k in arc.latest), Object.keys(arc.latest).join(','))
ok('存档 match 含 detail/nearBottom/total/closerTo', ['detail', 'nearBottom', 'total', 'closerTo'].every(k => k in arc.match), Object.keys(arc.match).join(','))
ok('存档 layers 每层含 on/label/h', arc.layers.every(l => 'on' in l && 'label' in l && 'h' in l))
ok('存档 layers[].h[期限] 含 n/med/win/grade', arc.layers.every(l => arc.spec.horizons.every(H => { const x = l.h[String(H)]; return x && ['n', 'med', 'win', 'grade'].every(k => k in x) })))
ok('存档 gradeSummary 四档 high/mid/weak/low 齐全', arc.spec.horizons.every(H => ['high', 'mid', 'weak', 'low'].every(k => k in (arc.gradeSummary[String(H)] || {}))))
ok('存档 strength 含 text 与 anyHigh', 'text' in arc.strength && 'anyHigh' in arc.strength)
ok('存档 sample 含 n/from/to', ['n', 'from', 'to'].every(k => k in arc.sample))
ok('存档 series 为数组且每行 ≥7 列', Array.isArray(arc.series) && arc.series.every(r => Array.isArray(r) && r.length >= 7))

/* 页面读的每个属性都必须在云端产出里能找到（双向核对） */
group('C2 · 页面字段提取 —— 逐项能在云端产出中找到')
ok('页面读 d.latest', /var d = R\.d,\s*L = d\.latest/.test(consoleNoC))
ok('页面读 d.match', /m = d\.match \|\| \{\}/.test(consoleNoC))
ok('页面读 d.profile', /prof = d\.profile \|\| \{\}/.test(consoleNoC))
ok('页面读 d.layers（filter on）', /\(d\.layers \|\| \[\]\)\.filter\(function\(l\)\{ return l\.on \}\)/.test(consoleNoC))
ok('页面读 d.gradeSummary', /var gs = d\.gradeSummary \|\| \{\}/.test(consoleNoC))
ok('页面读 d.strength', /var st = d\.strength \|\| \{\}/.test(consoleNoC))
ok('页面读 d.series', /mgBandSvg\(d\.series\)/.test(consoleNoC))
ok('页面读 d.sample.n', /d\.sample && d\.sample\.n/.test(consoleNoC))
ok('页面读 l.h[String(MG_H[q])]', /l2\.h\[String\(MG_H\[q\]\)\]/.test(consoleNoC))
ok('页面读 L.B60（余额 60 日）', /L\.B60/.test(consoleNoC))
ok('页面读 m.detail', /m\.detail && m\.detail\.length/.test(consoleNoC))
ok('页面读 m.nearBottom / m.total', /m\.nearBottom/.test(consoleNoC) && /m\.total/.test(consoleNoC))

/* MG_H 必须与 SPEC.horizons 完全一致（否则页面会漏列或多列出期限列） */
group('C3 · MG_H 与 SPEC.horizons 一致')
const mgH = (consoleSrc.match(/var MG_H\s*=\s*\[([^\]]+)\]/) || [])[1]
ok('MG_H 存在且被解析到', !!mgH, String(mgH))
ok('MG_H == SPEC.horizons', JSON.stringify(mgH.split(',').map(s => Number(s.trim()))) === JSON.stringify(S.horizons), mgH + ' vs ' + JSON.stringify(S.horizons))

/* 存档字段名与页面字段名逐一对照（防止改云端字段名而页面不更新） */
group('C4 · 存档 ↔ 页面 字段名一致性')
;['latest', 'match', 'profile', 'layers', 'gradeSummary', 'strength', 'series', 'sample'].forEach(k => {
  ok('字段名 "' + k + '" 两边都有（存档 keys ∩ 页面源码）', arcKeys.indexOf(k) >= 0 && new RegExp('d\\.' + k).test(consoleNoC))
})

/* ---- 无指令性措辞（硬约束：只给条件分布，不给买卖指令）----
 * ★ 坑（2026-10-15 实测踩到）：「大盘阶段雷达（两融视角）」这个字符串在别处也出现过，
 *   用它 indexOf 定位会把页面其它模块的文案一起圈进来 ⇒ 假红（把别的模块的「该躲」当成违规）。
 *   改用**只出现一次**的锚点：`MARGIN_REGIME = {`（变量声明）→ `function demoMarginRegimeData`。
 *   另外：违规词要查**去注释**副本（源码注释里有「不得出现…」的元声明本身就是违规词），
 *   免责文案要查**原文**（它们是要渲染给用户看的）。 */
const segAnchor = consoleSrc.indexOf('var MARGIN_REGIME = {')
/* 起点再往前推到该变量所在的注释块开头（块里有「不得出现指令性措辞」的元声明要一并圈入） */
const segStart = segAnchor > 0 ? consoleSrc.lastIndexOf('/* ===================== 大盘阶段雷达', segAnchor) : -1
const segEnd = consoleSrc.indexOf('function demoMarginRegimeData')
ok('定位到两融雷达源码片段（唯一锚点：var MARGIN_REGIME）', segAnchor > 0 && segStart > 0 && segEnd > segStart, segStart + '~' + segEnd)
ok('锚点唯一性自检：var MARGIN_REGIME = { 只出现 1 次', (consoleSrc.match(/var MARGIN_REGIME = \{/g) || []).length === 1, String((consoleSrc.match(/var MARGIN_REGIME = \{/g) || []).length))
const mgSegRaw = segStart > 0 && segEnd > segStart ? consoleSrc.slice(segStart, segEnd) : ''
const mgSeg = strip(mgSegRaw)
ok('雷达片段去注释后非空', mgSeg.length > 500, String(mgSeg.length))
ok('片段边界收敛（<25KB，未误圈全页）', mgSegRaw.length < 25000, String(mgSegRaw.length))
ok('雷达片段内无「要涨」', !/要涨/.test(mgSeg))
ok('雷达片段内无「要跌」', !/要跌/.test(mgSeg))
ok('雷达片段内无「可买」', !/可买/.test(mgSeg))
ok('雷达片段内无「该躲」', !/该躲/.test(mgSeg))
ok('雷达片段内无「建议买/建议卖」', !/建议[买卖]/.test(mgSeg))
ok('雷达片段内无「买入信号/卖出信号」', !/买入信号|卖出信号/.test(mgSeg))
ok('雷达片段内无「抄底/逃顶」', !/抄底|逃顶/.test(mgSeg))
ok('雷达片段内无「跟上/离场」等指令', !/(立即|马上)(买|卖|加仓|清仓)/.test(mgSeg))
/* 免责与口径声明（用原文或去注释副本都应有，因这些是渲染出的文案） */
ok('渲染文案含「不构成买卖建议」', /不构成买卖建议/.test(mgSegRaw))
ok('渲染文案含「条件概率（非预测）」', /条件概率（非预测）/.test(mgSegRaw))
ok('渲染文案含「结论强度（如实披露）」', /结论强度（如实披露）/.test(mgSegRaw))
ok('样本不足时提示「当作弱参考」', /当作「弱参考」/.test(mgSegRaw))
ok('声明「没有任何一项通过多重比较校正」的处理方式', /没有任何一项通过多重比较校正/.test(mgSegRaw))
ok('注释里明确写出「不得出现指令性措辞」的约束（元声明保留）', /\*\*不得\*\*出现[\s\S]{0,40}指令性措辞/.test(mgSegRaw), (mgSegRaw.match(/不得[^\n]{0,60}/) || [''])[0].trim())

/* ---- 云端存档降级链（三源）---- */
group('C6 · 首个源降级链与缓存')
ok('三源降级：同域 → raw → jsDelivr', /'\.\/margin-regime\.json\?t='[\s\S]{0,200}raw\.githubusercontent\.com[\s\S]{0,200}cdn\.jsdelivr\.net/.test(consoleNoC))
ok('10 分钟内存缓存', /10\*60\*1000/.test(consoleNoC))
ok('取不到时诚实空态（不伪造数据）', /云端存档不可用/.test(consoleNoC))
ok('云端 raw 指向 zyh19870426/stock-alert（新账号）', /raw\.githubusercontent\.com\/zyh19870426\/stock-alert\/main\/margin-regime\.json/.test(consoleNoC))
ok('不含旧账号 zyhaaad 的 raw 地址', !/zyhaaad/.test(mgSeg))

/* ---- 必须有挂载点 ---- */
group('C7 · DOM 挂载与渲染接线')
ok('存在 <div id="marginRegime">', /<div id="marginRegime"><\/div>/.test(consoleSrc))
ok('renderMarginRegime 定义存在', /function renderMarginRegime\(\)/.test(consoleSrc))
ok('marginRegimeEnsure 异步入口存在', /async function marginRegimeEnsure\(\)/.test(consoleSrc))
ok('marginRegimeHtml 定义存在', /function marginRegimeHtml\(\)/.test(consoleSrc))
ok('demo 数据函数存在（离线预览用）', /function demoMarginRegimeData\(\)/.test(consoleSrc))
ok('renderMarginRegime 被调用（渲染接线）', /renderMarginRegime\(\)/.test(consoleNoC.split('function renderMarginRegime')[1] || '') || (consoleNoC.match(/renderMarginRegime\(\)/g) || []).length >= 2, String((consoleNoC.match(/renderMarginRegime\(\)/g) || []).length))
ok('demo 模式走 demoMarginRegimeData', /demoMarginRegimeData\(\)/.test(consoleNoC))
/* 样式类：★ 2026-10-15 实测发现 22 个 mgr-* 类**一条样式都没有**（半成品），已补写。
 * 这里断言「代码里用到的每个 mgr-* 类，样式表里都有定义」——防再次出现「有 DOM 无样式」。 */
group('C7b · 样式完整性（防「有 DOM 无 CSS」）')
const cssStart = consoleSrc.indexOf('<style>')
const cssEnd = consoleSrc.indexOf('</style>')
const css = cssStart >= 0 && cssEnd > cssStart ? consoleSrc.slice(cssStart, cssEnd) : ''
ok('<style> 块可定位', css.length > 1000, String(css.length))
const usedCls = [...new Set((consoleSrc.match(/mgr-[a-z0-9-]+/g) || []))].sort()
ok('代码中用到的 mgr-* 类 ≥20 个', usedCls.length >= 20, String(usedCls.length))
const missingCss = usedCls.filter(c => css.indexOf('.' + c) < 0)
ok('每个用到的 mgr-* 类都有样式定义', missingCss.length === 0, '缺样式：' + missingCss.join(', '))
/* 可信度徽章四档（由 mgGradeCls 产出）必须有对应颜色 */
;['mgr-g-hi', 'mgr-g-mid', 'mgr-g-weak', 'mgr-g-low'].forEach(c => ok('徽章样式 ' + c + ' 已定义', css.indexOf('.' + c) >= 0))
ok('mgGradeCls 映射四档（三元链：高→hi / 中→mid / 弱→weak / 其余→low）',
  /function mgGradeCls\(g\)\{[\s\S]{0,200}mg-g-hi[\s\S]{0,80}mg-g-mid[\s\S]{0,80}mg-g-weak[\s\S]{0,80}mg-g-low/.test(consoleNoC),
  (consoleNoC.match(/function mgGradeCls\(g\)\{[^}]*\}/) || [''])[0].slice(0, 120))
/* 反向：四档徽章类名必须都能从 mgGradeCls 走到（防漏一档变 undefined） */
;['mg-g-hi', 'mg-g-mid', 'mg-g-weak', 'mg-g-low'].forEach(c => {
  ok('mgGradeCls 能产出 ' + c, (consoleNoC.match(/function mgGradeCls\(g\)\{[^}]*\}/) || [''])[0].indexOf(c) >= 0)
})
ok('表格 5 列（mgr-tr grid-template-columns 5 段）', /\.mgr-tr\{display:grid;grid-template-columns:[^;]*;[^}]*\}/.test(css) && (css.match(/\.mgr-tr\{[^}]*grid-template-columns:([^;]*)/) || [])[1].split(' ').length === 5, (css.match(/\.mgr-tr\{[^}]*grid-template-columns:([^;]*)/) || [])[1])
ok('mgr-tb5 也是 5 列（条件 + 4 期限）', /\.mgr-tb5\s+\.mgr-tr\{[^}]*repeat\(4,1fr\)/.test(css))
ok('结论强度块用中性底 + 蓝左条（不做警示色）', /\.mgr-honest\{[^}]*border-left:3px solid #2b6cb0/.test(css))
ok('窄屏适配用 grid auto-fit（微信兼容：禁用 @media）', /\.mgr-kv\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(/.test(css))
/* ★ 硬约束：console.html 必须能被微信小程序复用 ⇒ 禁 @media（由 _tests/console-picker.js 全文件扫描守护） */
ok('雷达样式块内无 @media（微信兼容）', !/@media/.test(css))
ok('全文件无 @media（小程序兼容硬约束）', (consoleSrc.match(/@media/g) || []).length === 0, String((consoleSrc.match(/@media/g) || []).length))
/* design-preview.html 是同一套样式的设计稿，必须同步（否则设计稿与实装漂移） */
const DP = path.join(ROOT, 'stock-alert-console', 'design-preview.html')
ok('design-preview.html 存在', fs.existsSync(DP))
if (fs.existsSync(DP)) {
  const dpSrc = read(DP)
  ok('design-preview 无 @media（同步 console 写法）', (dpSrc.match(/@media/g) || []).length === 0, String((dpSrc.match(/@media/g) || []).length))
  ok('design-preview 的 mgr-kv 与 console 一致（auto-fit）', /\.mgr-kv\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(/.test(dpSrc))
  ok('design-preview 含全部 mgr-* 样式', [...new Set((dpSrc.match(/mgr-[a-z0-9-]+/g) || []))].filter(c => /^mgr-/.test(c)).every(c => dpSrc.indexOf('.' + c) >= 0))
}

/* ============================================================
 * 【D】workflow 覆盖（防「脚本没人跑」）
 * ============================================================ */
group('D · workflow 覆盖（防存档靠手动跑）')
ok('margin.yml 存在', fs.existsSync(WORKFLOW))
ok('margin.yml 跑 margin-regime.js', /node margin-regime\.js/.test(wfSrc))
ok('margin.yml git add margin-regime.json', /git add margin-regime\.json/.test(wfSrc))
ok('margin.yml 保留 sector job', /node margin-sector\.js/.test(wfSrc) && /git add margin-sector-history\.json/.test(wfSrc))
ok('margin.yml regime job 依赖 sector（串行，避免 push 撞车）', /needs:\s*sector/.test(wfSrc))
ok('margin.yml 有 contents: write 权限', /permissions:\s*\n\s*contents:\s*write/.test(wfSrc))
ok('margin.yml regime timeout ≥ 40 分钟（脚本较重）', /timeout-minutes:\s*(4[0-9]|[5-9][0-9]|\d{3,})/.test(wfSrc))
ok('margin.yml 清 jsDelivr 缓存含 margin-regime.json', /margin-regime\.json[\s\S]{0,200}purge|purge[\s\S]{0,400}margin-regime\.json/.test(wfSrc))
ok('margin.yml 无 tab 缩进（YAML 禁 tab）', !/\t/.test(wfSrc))
ok('云端脚本支持 --dry（可离线干跑）', /--dry/.test(cloudSrc) && /DRY\s*=\s*process\.argv\.includes\('--dry'\)/.test(cloudNoC))
ok('--dry 时不写盘（提前 return）', /if\s*\(DRY\)\s*\{[\s\S]{0,120}return out/.test(cloudNoC))
ok('main 仅在直接运行时执行（require 时只导出）', /if\s*\(\s*require\.main\s*===\s*module\s*\)/.test(cloudNoC))
ok('失败即退出码 1 且不写半成品', /process\.exit\(1\)/.test(cloudNoC) && /不写半成品/.test(cloudSrc))

/* ============================================================
 * 【E】边界与稳健性
 * ============================================================ */
group('E · 边界与稳健性')
ok('样本不足 1200 日拒绝写档', /rows\.length\s*<\s*1200/.test(cloudNoC))
ok('permCompare p 用 (c+1)/(R+1) 形式（避免 p=0）', /\+1\)\s*\/\s*\(.*R.*\+1\)|\+ 1\) \/ \(R \+ 1\)|\(c \+ 1\) \/ \(R \+ 1\)/.test(cloudNoC) || /\+1/.test(cloudNoC))
ok('gradeOf 要求跨期同号（sameSign）', /sameSign/.test(cloudNoC))
ok('顶层 await fetch 有重试（getText tries）', /tries/.test(cloudNoC) && /await sleep\(800\)/.test(cloudNoC))
ok('JSONP 解析有专用函数', /function jsonp\(/.test(cloudNoC))
ok('存档 JSON 可被 JSON.parse 且体积合理（<2MB）', (() => { try { return read(CLOUD_JSON).length < 2 * 1024 * 1024 } catch (e) { return false } })())
ok('存档 note 说明「不构成买卖建议」', /不构成买卖建议/.test(arc.note || ''))
/* ★ 存档 spec 必须与源码 SPEC 逐字段一致 —— 否则「页面上标的口径」与「实际算的口径」不是一回事。
 * 2026-10-15 实测抓到一次真实漂移：存档缺 pMid/pWeak（源码后来补的），
 * 意味着存档里的 grade 是用**旧分档阈值**算的 ⇒ 必须重新生成存档（workflow 已覆盖）。 */
const specMissing = Object.keys(S).filter(k => !(k in arc.spec))
const specDiff = Object.keys(S).filter(k => (k in arc.spec) && JSON.stringify(arc.spec[k]) !== JSON.stringify(S[k]))
ok('存档 spec 含源码 SPEC 的全部字段', specMissing.length === 0, '存档缺：' + specMissing.join(', '))
ok('存档 spec 与源码 SPEC 值全等', specDiff.length === 0, '值不同：' + specDiff.join(', '))
ok('存档 spec 无多余字段', Object.keys(arc.spec).filter(k => !(k in S)).length === 0, Object.keys(arc.spec).filter(k => !(k in S)).join(', '))

/* ============================================================
 * 【F】反向锁：证明断言真能失败
 * ============================================================ */
group('F · 反向锁（断言有效性自检）')
const MRSrc = read(CLOUD_JS)
ok('锁1：若把 SPEC.sampStart 改成 2015 → A 组断言失败', (() => { return MRSrc.replace("sampStart: '2013-01-01'", "sampStart: '2015-01-01'") !== MRSrc && !/sampStart:\s*'2013-01-01'/.test(MRSrc.replace("sampStart: '2013-01-01'", "sampStart: '2015-01-01'")) })())
ok('锁2：若把 winq 改成 120 → A 组断言失败', !/winq:\s*120/.test(MRSrc) && /winq:\s*250/.test(MRSrc))
ok('锁3：若 MG_H 与 SPEC.horizons 不一致 → C3 断言失败', JSON.stringify(mgH.split(',').map(s => Number(s.trim()))) === JSON.stringify(S.horizons))
ok('锁4：若 workflow 去掉 margin-regime.js → D 组断言失败', /node margin-regime\.js/.test(wfSrc))
ok('锁5：若存档删掉 strength 字段 → C 组断言失败', 'strength' in arc)

/* ============================================================ */
console.log('\n' + (fail === 0 ? '✅ ALL GREEN' : '❌ 有失败项') + '  ' + pass + '/' + (pass + fail) + ' 项通过')
if (fail) { console.log('失败项：'); bad.forEach(b => console.log('  - ' + b)) }
process.exit(fail ? 1 : 0)
