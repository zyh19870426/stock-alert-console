/* 过拟合 / 迎合观点 专项审计
 *
 * 用户质疑：① 测试是不是迎合了我的观点（选择性报告）② 250 日窗口是不是挑出来的
 *          ③ 样本是否具有普遍性
 *
 * 本脚本用四种手段回答：
 *   A. 参数网格全披露 —— 把 (回看窗口 × 前瞻窗口) 整张表都打出来，不做选择性汇报
 *   B. 严格推断 —— 日度横截面价差序列 + Newey-West HAC t 值（重叠观测自相关已处理）
 *   C. 两个安慰剂检验 —— 破时间对齐 / 破横截面配对，看真实效应是否落在噪声带内
 *   D. 时间外分割 —— 前 60% 日期训练、后 40% 独立验证
 *
 * 数据：_tests/_cache/margin-corr2.json（若已扩样）否则 margin-corr.json
 */
const fs = require('fs')
const D2 = 'D:/mywork/_tests/_cache/margin-corr2.json'
const D1 = 'D:/mywork/_tests/_cache/margin-corr.json'
let FILE = process.argv[2] || (fs.existsSync(D2) ? D2 : D1)
/* 若指定/默认文件正在被写入（JSON 截断），回退到另一份 */
try { JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch (e) {
  const alt = FILE === D2 ? D1 : D2
  console.log('⚠️ ' + FILE.split('/').pop() + ' 无法解析（可能正在写入），回退 ' + alt.split('/').pop())
  FILE = alt
}
const MD = process.argv[3] || 'D:/mywork/_tests/margin-overfit-audit.md'
const out = []
const P = s => { out.push(s); console.log(s) }
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN
const pc = v => isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%' : '—'
const f2 = v => isFinite(v) ? v.toFixed(2) : '—'

/* 滚动最大值（单调队列 O(n)） */
function rollMax(a, w) {
  const n = a.length, out = new Array(n).fill(NaN), dq = []
  let head = 0
  for (let i = 0; i < n; i++) {
    while (dq.length > head && a[dq[dq.length - 1]] <= a[i]) dq.pop()
    dq.push(i)
    while (dq[head] < i - w + 1) head++
    if (i >= w - 1) out[i] = a[dq[head]]
  }
  return out
}
/* Newey-West(Bartlett) HAC t 值 */
function nwT(x, lag) {
  const n = x.length; if (n < 20) return NaN
  const m = mean(x)
  let s = 0
  for (let i = 0; i < n; i++) s += (x[i] - m) * (x[i] - m)
  s /= n
  for (let l = 1; l <= lag; l++) {
    let gl = 0
    for (let i = l; i < n; i++) gl += (x[i] - m) * (x[i - l] - m)
    gl /= n
    s += 2 * (1 - l / (lag + 1)) * gl
  }
  if (s <= 0) return NaN
  return m / Math.sqrt(s / n)
}
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }

/* ═══════════ 载入并构建序列 ═══════════ */
const db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const STK = []
for (const code of Object.keys(db.stocks)) {
  const st = db.stocks[code]
  const fm = new Map(); for (const r of st.f) fm.set(r[0], r)
  const rows = []
  for (const r of st.m) { const p = fm.get(r[0]); if (!p) continue; rows.push({ d: r[0], ye: r[1], c: p[1], turn: p[3] }) }
  if (rows.length < 500) continue
  STK.push({ code, rows, d: rows.map(r => r.d), ye: rows.map(r => r.ye), c: rows.map(r => r.c), turn: rows.map(r => r.turn) })
}
const allDates = [...new Set(STK.flatMap(s => s.d))].sort((a, b) => a - b)
P('数据文件 ' + FILE.split('/').pop())
P('样本：' + STK.length + ' 只股票，' + allDates.length + ' 个交易日，' + allDates[0] + ' ~ ' + allDates[allDates.length - 1])
P('（每只票两融 ' + STK[0].rows.length + ' 条左右；扩样后应显著变长）\n')

const WS = [20, 30, 60, 120, 250, 500]
const HZ = [20, 60, 120]

/* 预先算好每只票、每个窗口的 dd（越负 = 出清越多）与各前瞻收益 */
for (const s of STK) {
  s.dd = {}; s.fw = {}
  for (const w of WS) {
    const rm = rollMax(s.ye, w)
    s.dd[w] = s.ye.map((v, i) => (isFinite(rm[i]) && rm[i] > 0) ? v / rm[i] - 1 : NaN)
  }
  for (const h of HZ) s.fw[h] = s.c.map((v, i) => (i + h < s.c.length && s.c[i] > 0) ? s.c[i + h] / s.c[i] - 1 : NaN)
  s.dIdx = new Map(); s.d.forEach((d, i) => s.dIdx.set(d, i))
}

/* 计算某 (W,H) 的日度横截面价差与 IC —— 返回逐日序列，便于 HAC 与分割；
   ddOverride/fwOverride 供安慰剂使用 */
function dailyStats(W, H, ddOverride, fwOverride, permSeed) {
  const byDate = new Map()
  for (let si = 0; si < STK.length; si++) {
    const s = STK[si]
    const dd = (typeof ddOverride === 'function') ? ddOverride(s, si) : s.dd[W]
    const fw = (typeof fwOverride === 'function') ? fwOverride(s, si) : s.fw[H]
    for (let i = 0; i < s.rows.length; i++) {
      const a = dd[i], b = fw[i]
      if (!isFinite(a) || !isFinite(b)) continue
      const d = s.d[i]
      if (!byDate.has(d)) byDate.set(d, [])
      byDate.get(d).push([a, b, si])
    }
  }
  const spreads = [], ics = [], hiAll = [], loAll = [], pctAll = [], baseAll = [], rows = []
  for (const d of allDates) {
    let g = byDate.get(d)
    if (!g || g.length < 15) continue
    g = g.slice()
    if (permSeed !== undefined) {                       // 安慰剂 P2：日内随机置换 dd（打破"自己 vs 自己"的配对）
      const rnd = mulberry(permSeed + d % 100000)
      const dds = g.map(x => x[0])
      for (let i = dds.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [dds[i], dds[j]] = [dds[j], dds[i]] }
      g = g.map((x, i) => [dds[i], x[1], x[2]])
    }
    const sorted = g.slice().sort((a, b) => a[0] - b[0])
    const k = Math.floor(sorted.length / 3)             // 出清最多 1/3 vs 最少 1/3
    const hi = sorted.slice(0, k), lo = sorted.slice(-k)
    const mh = mean(hi.map(x => x[1])), ml = mean(lo.map(x => x[1]))
    spreads.push(mh - ml)
    hiAll.push(...hi.map(x => x[1])); loAll.push(...lo.map(x => x[1])); pctAll.push(...g.map(x => x[1]))
    // Spearman IC
    const r1 = rankOf(sorted.map(x => x[0])), r2 = rankOf(sorted.map(x => x[1]))
    ics.push(corrArr(r1, r2))
    rows.push({ d, mh, ml })
  }
  return { spreads, ics, hiAll, loAll, pctAll, rows }
}
function rankOf(a) { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1 } return r }
function corrArr(x, y) { const n = x.length; if (n < 3) return NaN; const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2 } return (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : NaN }
const empSD = a => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)) }

/* ═══════════ A. 参数网格全披露 ═══════════ */
P('╔══════════════════════════════════════════════════════════════════════╗')
P('║ A. 参数网格全披露（不打乱顺序、不做筛选）                            ║')
P('║    单元 = 出清最多1/3 − 出清最少1/3 的「原始收益」价差               ║')
P('╚══════════════════════════════════════════════════════════════════════╝')
P('  ' + '回看窗口＼前瞻'.padEnd(16) + HZ.map(h => ('未来' + h + '日').padStart(18)).join(''))
const grid = []
for (const W of WS) {
  const cells = []
  for (const H of HZ) {
    const st = dailyStats(W, H)
    const sp = mean(st.spreads), t = nwT(st.spreads, H)
    grid.push({ W, H, sp, t, hitHi: st.hiAll.filter(v => v > 0).length / st.hiAll.length, hitLo: st.loAll.filter(v => v > 0).length / st.loAll.length, n: st.pctAll.length })
    cells.push((pc(sp) + ' t=' + f2(t)).padStart(18))
  }
  P('  ' + (W + '日').padEnd(16) + cells.join(''))
}
const pos = grid.filter(g => g.sp > 0), sig = grid.filter(g => g.t > 2)
P('\n  网格共 ' + grid.length + ' 个规格：价差为正 ' + pos.length + '/' + grid.length
  + '，HAC t>2 ' + sig.length + '/' + grid.length)
P('  全部规格的中位价差 ' + pc(median(grid.map(g => g.sp))) + '，中位 t ' + f2(median(grid.map(g => g.t))))
P('  ⚠️ 多个规格同时检验 ⇒ 单看"最好那个"没有意义。下面给 Bonferroni 参考线：α=0.05 时约需 |t| > '
  + f2(invNorm(1 - 0.05 / (2 * grid.length))))
function median(a) { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
function invNorm(p) { // Acklam 近似
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01]
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]
  const pl = 0.02425
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1) }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1) }
  const q = p - 0.5, r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

/* ═══════════ B. 谁更灵敏/更准确（用户问题2）═══════════ */
P('\n╔══════════════════════════════════════════════════════════════════════╗')
P('║ B. 窗口灵敏度对比（用户问题②）：哪个回看窗口更灵敏/更准确            ║')
P('╚══════════════════════════════════════════════════════════════════════╝')
P('  判据：① 价差（越大越"灵敏"）② HAC t（越大越"可信"）③ 上涨占比差（出清多−出清少）④ 单调性')
const mono = (W, H) => {
  const byDate = new Map()
  for (const s of STK) for (let i = 0; i < s.rows.length; i++) {
    const a = s.dd[W][i], b = s.fw[H][i]
    if (!isFinite(a) || !isFinite(b)) continue
    const d = s.d[i]; if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push([a, b])
  }
  const b5 = [[], [], [], [], []]
  for (const [, g] of byDate) {
    if (g.length < 15) continue
    const s2 = g.sort((x, y) => x[0] - y[0])
    s2.forEach((x, i) => b5[Math.min(4, Math.floor(i * 5 / s2.length))].push(x[1]))
  }
  const m = b5.map(mean)
  const mon = m.every((v, i) => i === 0 || (v <= m[i - 1]))      // dd 升序 ⇒ 收益应递减
  return { m, mon }
}
P('  ' + '窗口'.padEnd(8) + '前瞻'.padStart(7) + '价差'.padStart(10) + 'HAC t'.padStart(9)
  + '出清多胜率'.padStart(11) + '出清少胜率'.padStart(11) + '胜率差'.padStart(9) + '分位单调'.padStart(10) + '样本'.padStart(9))
for (const W of WS) for (const H of HZ) {
  const g = grid.find(x => x.W === W && x.H === H)
  const mo = mono(W, H)
  P('  ' + (W + '日').padEnd(8) + String(H).padStart(7) + pc(g.sp).padStart(10) + f2(g.t).padStart(9)
    + (g.hitHi * 100).toFixed(1).padStart(10) + '%' + (g.hitLo * 100).toFixed(1).padStart(10) + '%'
    + ((g.hitHi - g.hitLo) * 100).toFixed(1).padStart(8) + '%' + (mo.mon ? '✅' : '❌').padStart(10)
    + String(g.n).padStart(9))
}

/* ═══════════ C. 安慰剂检验 ═══════════ */
P('\n╔══════════════════════════════════════════════════════════════════════╗')
P('║ C. 安慰剂检验：真实效应是否落在噪声带内                              ║')
P('╚══════════════════════════════════════════════════════════════════════╝')
const WSEL = [60, 250], HSEL = 60, R = 20
for (const W of WSEL) {
  const real = mean(dailyStats(W, HSEL).spreads)
  // P1：把自己票的两融序列在时间轴上循环平移 ⇒ 保留自身形态、破坏与价格的时间对齐
  const p1 = []
  for (let r = 0; r < R; r++) {
    const rnd = mulberry(9000 + r * 17 + W)
    const st = dailyStats(W, HSEL, (s) => {
      const n = s.ye.length, sh = W + Math.floor(rnd() * (n - 2 * W - 10))
      const outA = new Array(n).fill(NaN)
      for (let i = 0; i + sh < n; i++) outA[i] = s.dd[W][i + sh]
      return outA
    })
    p1.push(mean(st.spreads))
  }
  // P2：日内随机置换 dd（打破"自己 vs 自己"的配对）
  const p2 = []
  for (let r = 0; r < R; r++) p2.push(mean(dailyStats(W, HSEL, undefined, undefined, 7000 + r * 31).spreads))
  const sd1 = empSD(p1), sd2 = empSD(p2)
  const z1 = (real - mean(p1)) / sd1, z2 = (real - mean(p2)) / sd2
  P('  窗口 ' + W + '日 × 前瞻' + HSEL + '日：真实价差 ' + pc(real))
  P('    P1 循环平移安慰剂：均值 ' + pc(mean(p1)) + '，标准差 ' + pc(sd1) + ' → 真实值 z = ' + f2(z1)
    + (Math.abs(z1) > 2 ? '  ✅ 超出噪声带' : '  ❌ 落在噪声带内'))
  P('    P2 日内置换安慰剂：均值 ' + pc(mean(p2)) + '，标准差 ' + pc(sd2) + ' → 真实值 z = ' + f2(z2)
    + (Math.abs(z2) > 2 ? '  ✅ 超出噪声带' : '  ❌ 落在噪声带内'))
  P('    （P1 分布 ' + p1.map(v => (v * 100).toFixed(1)).join(' ') + '）')
}

/* ═══════════ D. 时间外分割 ═══════════ */
P('\n╔══════════════════════════════════════════════════════════════════════╗')
P('║ D. 时间外分割：前 60% 日期 vs 后 40% 日期（独立验证）                ║')
P('╚══════════════════════════════════════════════════════════════════════╝')
P('  ' + '窗口×前瞻'.padEnd(16) + '训练段(前60%)'.padStart(22) + '验证段(后40%)'.padStart(22) + '  同号')
for (const W of WS) for (const H of HZ) {
  const st = dailyStats(W, H)
  const half = Math.floor(st.rows.length * 0.6)
  const a = st.rows.slice(0, half), b = st.rows.slice(half)
  const sa = mean(a.map(r => r.mh - r.ml)), sb = mean(b.map(r => r.mh - r.ml))
  const ta = nwT(a.map(r => r.mh - r.ml), H), tb = nwT(b.map(r => r.mh - r.ml), H)
  P('  ' + (W + '日 → ' + H + '日').padEnd(16)
    + (pc(sa) + ' t=' + f2(ta)).padStart(22) + (pc(sb) + ' t=' + f2(tb)).padStart(22)
    + (sa * sb > 0 ? '   ✅' : '   ❌'))
}

/* ═══════════ E. 分档边界敏感性（自我暴露：阈值是我们挑的）═══════════ */
P('\n╔══════════════════════════════════════════════════════════════════════╗')
P('║ E. 分档边界敏感性 —— 同一份数据，换分档方式结果能差多少              ║')
P('╚══════════════════════════════════════════════════════════════════════╝')
function spreadWith(W, H, classify) {          // classify(dd) → 'hi'(出清多) / 'lo'(出清少) / null
  const byDate = new Map()
  for (const s of STK) for (let i = 0; i < s.rows.length; i++) {
    const a = s.dd[W][i], b = s.fw[H][i]
    if (!isFinite(a) || !isFinite(b)) continue
    const k = classify(a); if (!k) continue
    const d = s.d[i]; if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push([k, b])
  }
  const sp = [], hiAll = [], loAll = []
  for (const [, g] of byDate) {
    const hi = g.filter(x => x[0] === 'hi').map(x => x[1]), lo = g.filter(x => x[0] === 'lo').map(x => x[1])
    if (hi.length < 3 || lo.length < 3) continue
    sp.push(mean(hi) - mean(lo)); hiAll.push(...hi); loAll.push(...lo)
  }
  return { sp: mean(sp), t: nwT(sp, H), nHi: hiAll.length, nLo: loAll.length, hitHi: hiAll.filter(v => v > 0).length / hiAll.length, hitLo: loAll.filter(v => v > 0).length / loAll.length }
}
/* 按当日横截面分位切分 */
function byQuantile(W, H, qLo, qHi) {
  const byDate = new Map()
  for (const s of STK) for (let i = 0; i < s.rows.length; i++) {
    const a = s.dd[W][i], b = s.fw[H][i]
    if (!isFinite(a) || !isFinite(b)) continue
    const d = s.d[i]; if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push([a, b])
  }
  for (const [d, g] of byDate) {
    g.sort((x, y) => x[0] - y[0])
    g.forEach((x, i) => { const p = i / (g.length - 1); x.push(p <= qLo ? 'hi' : (p >= qHi ? 'lo' : null)) })
  }
  const sp = [], hiAll = [], loAll = []
  for (const [, g] of byDate) {
    const hi = g.filter(x => x[2] === 'hi').map(x => x[1]), lo = g.filter(x => x[2] === 'lo').map(x => x[1])
    if (!hi.length || !lo.length) continue
    sp.push(mean(hi) - mean(lo)); hiAll.push(...hi); loAll.push(...lo)
  }
  return { sp: mean(sp), t: nwT(sp, H), nHi: hiAll.length, nLo: loAll.length, hitHi: hiAll.filter(v => v > 0).length / hiAll.length, hitLo: loAll.filter(v => v > 0).length / loAll.length }
}
for (const [W, H] of [[250, 60], [120, 120]]) {
  P('\n  窗口 ' + W + '日 × 前瞻 ' + H + '日：')
  P('    ' + '分档方式'.padEnd(40) + '价差'.padStart(10) + 'HAC t'.padStart(9) + '出清多胜率'.padStart(11) + '出清少胜率'.padStart(11) + '样本'.padStart(9))
  const defs = [
    ['★ 我上一轮用的绝对阈值（≤−20% vs >−10%）', spreadWith(W, H, v => v <= -0.20 ? 'hi' : (v > -0.10 ? 'lo' : null))],
    ['★ 我上一轮用的四档（≤−30% vs −10~0%）', spreadWith(W, H, v => v <= -0.30 ? 'hi' : (v > -0.10 ? 'lo' : null))],
    ['横截面三分位（各 1/3）', byQuantile(W, H, 1 / 3, 2 / 3)],
    ['横截面五分位（各 1/5）', byQuantile(W, H, 0.2, 0.8)],
    ['横截面十分位（各 1/10）', byQuantile(W, H, 0.1, 0.9)],
    ['横截面 40/60 分位（各 40%）', byQuantile(W, H, 0.4, 0.6)]
  ]
  const vals = []
  for (const [nm, r] of defs) {
    vals.push(r.sp)
    P('    ' + nm.padEnd(40) + pc(r.sp).padStart(10) + f2(r.t).padStart(9)
      + (r.hitHi * 100).toFixed(1).padStart(10) + '%' + (r.hitLo * 100).toFixed(1).padStart(10) + '%'
      + String(r.nHi + r.nLo).padStart(9))
  }
  P('    → 同一份数据，价差从 ' + pc(Math.min(...vals)) + ' 到 ' + pc(Math.max(...vals))
    + '（差 ' + pc(Math.max(...vals) - Math.min(...vals)) + '）⇒ 分档边界是自由度，必须如实披露')
}

/* ═══════════ G. 池化均值 vs 日度价差：为什么上一轮的数字更漂亮 ═══════════ */
P('\n╔══════════════════════════════════════════════════════════════════════╗')
P('║ G. 同一 dd250 绝对分档，两种算法对照                                 ║')
P('║    池化 = 把全部样本倒进桶里算均值（上一轮用这法，会被时间聚集放大） ║')
P('║    日度 = 每个交易日单独算桶均值，再对日期等权平均（更稳健）         ║')
P('╚══════════════════════════════════════════════════════════════════════╝')
{
  const W = 250, H = 60
  const BUCK = [['≤−30%', v => v <= -0.30], ['−30~−20%', v => v > -0.30 && v <= -0.20], ['−20~−10%', v => v > -0.20 && v <= -0.10], ['−10~0%', v => v > -0.10 && v <= 0]]
  const pool = {}, byD = new Map()
  for (const s of STK) for (let i = 0; i < s.rows.length; i++) {
    const a = s.dd[W][i], b = s.fw[H][i]
    if (!isFinite(a) || !isFinite(b)) continue
    for (const [nm, f] of BUCK) {
      if (!f(a)) continue
      ;(pool[nm] = pool[nm] || []).push(b)
      const d = s.d[i]; if (!byD.has(d)) byD.set(d, {}); const g = byD.get(d)
      ;(g[nm] = g[nm] || []).push(b)
      break
    }
  }
  const dm = {}
  for (const [nm] of BUCK) { const v = []; for (const [, g] of byD) if (g[nm] && g[nm].length >= 3) v.push(mean(g[nm])); dm[nm] = { m: mean(v), n: v.length } }
  P('  ' + '区间'.padEnd(12) + '池化样本'.padStart(10) + '池化均值'.padStart(12) + '日度均值(等权)'.padStart(16) + '日度样本日数'.padStart(14))
  for (const [nm] of BUCK) P('  ' + nm.padEnd(12) + String(pool[nm].length).padStart(10) + pc(mean(pool[nm])).padStart(12) + pc(dm[nm].m).padStart(16) + String(dm[nm].n).padStart(14))
  const pk = mean(pool['≤−30%']) - mean(pool['−10~0%']), dk = dm['≤−30%'].m - dm['−10~0%'].m
  P('  → 极差：池化 ' + pc(pk) + '　日度 ' + pc(dk) + '　⇒ 池化把效应放大了 ' + f2(pk / dk) + ' 倍')
  P('  为什么：桶的成员在时间上高度聚集（大跌期大家都离高点远），池化均值等于')
  P('  　给"某个历史时段"加权。日度等权把时段差异抵消掉了。')
  /* 时段聚集证据：各桶的日期分布中位年份 */
  P('\n  时段聚集证据：各桶样本落在 2024-09 之后的比例')
  for (const [nm, f] of BUCK) {
    let a = 0, b = 0
    for (const s of STK) for (let i = 0; i < s.rows.length; i++) {
      const x = s.dd[W][i]; if (!isFinite(x) || !f(x)) continue
      b++; if (s.d[i] >= 20240901) a++
    }
    P('    ' + nm.padEnd(12) + (b ? (a / b * 100).toFixed(1) : '—') + '%')
  }
}

/* ═══════════ H. 逐股普遍性：有多少只票自己身上也成立 ═══════════ */
P('\n╔══════════════════════════════════════════════════════════════════════╗')
P('║ H. 逐股普遍性：把样本拆到每只票，多少只票身上也成立                  ║')
P('╚══════════════════════════════════════════════════════════════════════╝')
{
  const W = 250, H = 60
  const per = []
  for (const s of STK) {
    const hi = [], lo = []
    for (let i = 0; i < s.rows.length; i++) {
      const a = s.dd[W][i], b = s.fw[H][i]
      if (!isFinite(a) || !isFinite(b)) continue
      if (a <= -0.30) hi.push(b); else if (a > -0.10 && a <= 0) lo.push(b)
    }
    if (hi.length >= 30 && lo.length >= 30) per.push({ code: s.code, sp: mean(hi) - mean(lo), n: hi.length + lo.length })
  }
  const pos = per.filter(p => p.sp > 0).length, nul = per.filter(p => p.sp === 0).length
  const med = median(per.map(p => p.sp))
  /* 符号检验：n 个独立符号 ~ Binomial(n, 0.5)，取正态近似 */
  const k = pos, n = per.length, zs = (k + 0.5 - n / 2) / Math.sqrt(n / 4)
  P('  合格样本（两桶各 ≥30 个观测）：' + per.length + ' 只')
  P('  价差为正（出清多 > 出清少）：' + pos + ' 只（' + (pos / per.length * 100).toFixed(1) + '%）')
  P('  价差中位 ' + pc(med) + '　均值 ' + pc(mean(per.map(p => p.sp))))
  P('  符号检验 z = ' + f2(zs) + (zs > 1.96 ? '  ✅ 方向不是随机' : '  ❌ 与"抛硬币"无法区分'))
  P('  最好 5 只：' + per.slice().sort((a, b) => b.sp - a.sp).slice(0, 5).map(p => p.code + ' ' + pc(p.sp)).join('　'))
  P('  最差 5 只：' + per.slice().sort((a, b) => a.sp - b.sp).slice(0, 5).map(p => p.code + ' ' + pc(p.sp)).join('　'))
  /* 分年份同样做逐股 */
  P('\n  逐年逐股（价差为正的股票占比）：')
  const years = [...new Set(allDates.map(d => Math.floor(d / 10000)))].sort()
  for (const y of years) {
    const arr = []
    for (const s of STK) {
      const hi = [], lo = []
      for (let i = 0; i < s.rows.length; i++) {
        if (Math.floor(s.d[i] / 10000) !== y) continue
        const a = s.dd[W][i], b = s.fw[H][i]
        if (!isFinite(a) || !isFinite(b)) continue
        if (a <= -0.30) hi.push(b); else if (a > -0.10 && a <= 0) lo.push(b)
      }
      if (hi.length >= 20 && lo.length >= 20) arr.push(mean(hi) - mean(lo))
    }
    if (arr.length < 8) continue
    const p2 = arr.filter(v => v > 0).length
    P('    ' + String(y).padEnd(8) + String(arr.length).padStart(6) + ' 只　正占比 ' + (p2 / arr.length * 100).toFixed(1) + '%　中位 ' + pc(median(arr)))
  }
}

/* ═══════════ F. 样本普遍性 ═══════════ */
P('\n╔══════════════════════════════════════════════════════════════════════╗')
P('║ F. 样本普遍性：分年份 / 分板块 / 分市值                              ║')
P('╚══════════════════════════════════════════════════════════════════════╝')
{
  const W = 250, H = 60
  const CAPF = 'D:/mywork/_tests/_cache/stk-floatcap.json'
  const CAP = fs.existsSync(CAPF) ? JSON.parse(fs.readFileSync(CAPF, 'utf8')).map : {}
  const med0 = (() => { const a = Object.values(CAP).map(x => x.cap).filter(isFinite).sort((x, y) => x - y); return a[a.length >> 1] })()
  P('  分段 = 出清最多 1/3 − 出清最少 1/3 的原始收益价差（窗口' + W + ' × 前瞻' + H + '）')
  P('  市值中位（有市值数据的 ' + Object.keys(CAP).length + ' 只）：' + f2(med0) + ' 亿\n')
  // 年份
  P('  【分年份】')
  P('    ' + '年份'.padEnd(10) + '样本'.padStart(9) + '价差'.padStart(11) + 'HAC t'.padStart(9) + '出清多胜率'.padStart(11) + '出清少胜率'.padStart(11))
  const years = [...new Set(allDates.map(d => Math.floor(d / 10000)))].sort()
  for (const y of years) {
    const byDate = new Map()
    for (const s of STK) for (let i = 0; i < s.rows.length; i++) {
      const a = s.dd[W][i], b = s.fw[H][i]
      if (!isFinite(a) || !isFinite(b) || Math.floor(s.d[i] / 10000) !== y) continue
      const d = s.d[i]; if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push([a, b])
    }
    const sp = [], hiA = [], loA = []
    for (const [, g] of byDate) {
      if (g.length < 15) continue
      g.sort((x, y) => x[0] - y[0]); const k = Math.floor(g.length / 3)
      const hi = g.slice(0, k).map(x => x[1]), lo = g.slice(-k).map(x => x[1])
      sp.push(mean(hi) - mean(lo)); hiA.push(...hi); loA.push(...lo)
    }
    if (sp.length < 20) continue
    P('    ' + String(y).padEnd(10) + String(hiA.length + loA.length).padStart(9) + pc(mean(sp)).padStart(11)
      + f2(nwT(sp, H)).padStart(9) + (hiA.filter(v => v > 0).length / hiA.length * 100).toFixed(1).padStart(10) + '%'
      + (loA.filter(v => v > 0).length / loA.length * 100).toFixed(1).padStart(10) + '%')
  }
  // 板块
  const boardOf = c => /^68/.test(c) ? '科创板' : (/^30/.test(c) ? '创业板' : (/^(60|00)/.test(c) ? '主板' : '其他'))
  P('\n  【分板块】')
  P('    ' + '板块'.padEnd(10) + '股票数'.padStart(9) + '样本'.padStart(9) + '价差'.padStart(11) + 'HAC t'.padStart(9) + '出清多胜率'.padStart(11) + '出清少胜率'.padStart(11))
  for (const bd of ['主板', '创业板', '科创板']) {
    const list = STK.filter(s => boardOf(s.code) === bd)
    if (!list.length) continue
    const byDate = new Map()
    for (const s of list) for (let i = 0; i < s.rows.length; i++) {
      const a = s.dd[W][i], b = s.fw[H][i]
      if (!isFinite(a) || !isFinite(b)) continue
      const d = s.d[i]; if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push([a, b])
    }
    const sp = [], hiA = [], loA = []
    for (const [, g] of byDate) {
      if (g.length < 8) continue
      g.sort((x, y) => x[0] - y[0]); const k = Math.max(1, Math.floor(g.length / 3))
      const hi = g.slice(0, k).map(x => x[1]), lo = g.slice(-k).map(x => x[1])
      sp.push(mean(hi) - mean(lo)); hiA.push(...hi); loA.push(...lo)
    }
    if (sp.length < 20) continue
    P('    ' + bd.padEnd(10) + String(list.length).padStart(9) + String(hiA.length + loA.length).padStart(9)
      + pc(mean(sp)).padStart(11) + f2(nwT(sp, H)).padStart(9)
      + (hiA.filter(v => v > 0).length / hiA.length * 100).toFixed(1).padStart(10) + '%'
      + (loA.filter(v => v > 0).length / loA.length * 100).toFixed(1).padStart(10) + '%')
  }
  // 市值
  P('\n  【分市值】（流通市值，仅有市值数据的股票）')
  P('    ' + '市值分层'.padEnd(12) + '股票数'.padStart(9) + '样本'.padStart(9) + '价差'.padStart(11) + 'HAC t'.padStart(9) + '出清多胜率'.padStart(11) + '出清少胜率'.padStart(11))
  const buckets = [['小盘 <50亿', 0, 50], ['中盘 50~150亿', 50, 150], ['大盘 ≥150亿', 150, 1e9]]
  for (const [nm, lo, hi] of buckets) {
    const list = STK.filter(s => CAP[s.code] && CAP[s.code].cap >= lo && CAP[s.code].cap < hi)
    if (list.length < 3) { P('    ' + nm.padEnd(12) + String(list.length).padStart(9) + '   （样本太少，跳过）'); continue }
    const byDate = new Map()
    for (const s of list) for (let i = 0; i < s.rows.length; i++) {
      const a = s.dd[W][i], b = s.fw[H][i]
      if (!isFinite(a) || !isFinite(b)) continue
      const d = s.d[i]; if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push([a, b])
    }
    const sp = [], hiA = [], loA = []
    for (const [, g] of byDate) {
      if (g.length < 6) continue
      g.sort((x, y) => x[0] - y[0]); const k = Math.max(1, Math.floor(g.length / 3))
      const hi = g.slice(0, k).map(x => x[1]), lo = g.slice(-k).map(x => x[1])
      sp.push(mean(hi) - mean(lo)); hiA.push(...hi); loA.push(...lo)
    }
    if (sp.length < 20) continue
    P('    ' + nm.padEnd(12) + String(list.length).padStart(9) + String(hiA.length + loA.length).padStart(9)
      + pc(mean(sp)).padStart(11) + f2(nwT(sp, H)).padStart(9)
      + (hiA.filter(v => v > 0).length / hiA.length * 100).toFixed(1).padStart(10) + '%'
      + (loA.filter(v => v > 0).length / loA.length * 100).toFixed(1).padStart(10) + '%')
  }
  // 两融历史长度（代表样本期内可用时间）
  P('\n  【按两融历史长度】（长 = 该票样本期更完整）')
  P('    ' + '历史长度'.padEnd(14) + '股票数'.padStart(9) + '样本'.padStart(9) + '价差'.padStart(11) + 'HAC t'.padStart(9))
  for (const [nm, lo, hi] of [['< 900 条', 0, 900], ['900~1500 条', 900, 1500], ['≥1500 条', 1500, 99999]]) {
    const list = STK.filter(s => s.rows.length >= lo && s.rows.length < hi)
    if (list.length < 3) { P('    ' + nm.padEnd(14) + String(list.length).padStart(9) + '   （太少，跳过）'); continue }
    const byDate = new Map()
    for (const s of list) for (let i = 0; i < s.rows.length; i++) {
      const a = s.dd[W][i], b = s.fw[H][i]
      if (!isFinite(a) || !isFinite(b)) continue
      const d = s.d[i]; if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push([a, b])
    }
    const sp = [], nSamp = []
    for (const [, g] of byDate) {
      if (g.length < 6) continue
      g.sort((x, y) => x[0] - y[0]); const k = Math.max(1, Math.floor(g.length / 3))
      sp.push(mean(g.slice(0, k).map(x => x[1])) - mean(g.slice(-k).map(x => x[1])))
      nSamp.push(g.length)
    }
    if (sp.length < 20) continue
    P('    ' + nm.padEnd(14) + String(list.length).padStart(9) + String(nSamp.reduce((x, y) => x + y, 0)).padStart(9)
      + pc(mean(sp)).padStart(11) + f2(nwT(sp, H)).padStart(9))
  }
}

fs.writeFileSync(MD, '# 过拟合 / 迎合观点 专项审计\n\n```\n' + out.join('\n') + '\n```\n', 'utf8')
P('\n报告已写 ' + MD)
