/* 大盘两融信号的过拟合审计
 *
 * 背景：上一轮我在大盘上试了 4 个定义（滚动750日分位 → 距500日高点回撤 / 绝对水平 / 20日变化），
 *      **只汇报了成功的那几个** —— 这是典型的规格搜索，必须用统一网格 + 多重检验校正重做。
 *
 * 输出：所有规格一律列出，配 HAC t 值、Bonferroni 参考线、安慰剂（循环平移）、时间外分割。
 */
const fs = require('fs')
const MKT = 'D:/mywork/_tests/_cache/mkt-rzrq.json'
const MD = 'D:/mywork/_tests/mkt-overfit-audit.md'
const out = []
const P = s => { out.push(s); console.log(s) }
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN
const median = a => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const pc = v => isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%' : '—'
const f2 = v => isFinite(v) ? v.toFixed(2) : '—'
function nwT(x, lag) {
  const n = x.length; if (n < 20) return NaN
  const m = mean(x); let s = 0
  for (let i = 0; i < n; i++) s += (x[i] - m) ** 2
  s /= n
  for (let l = 1; l <= lag; l++) { let gl = 0; for (let i = l; i < n; i++) gl += (x[i] - m) * (x[i - l] - m); gl /= n; s += 2 * (1 - l / (lag + 1)) * gl }
  if (s <= 0) return NaN
  return m / Math.sqrt(s / n)
}
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
function invNorm(p) {
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

const mk = JSON.parse(fs.readFileSync(MKT, 'utf8')).rows.filter(r => r.d >= '2013-01-01' && isFinite(r.rzye) && isFinite(r.idx) && r.idx > 0 && isFinite(r.rzb))
P('大盘样本 ' + mk.length + ' 个交易日（' + mk[0].d + ' ~ ' + mk[mk.length - 1].d + '）')
P('沪深300 ' + mk[0].idx.toFixed(0) + ' → ' + mk[mk.length - 1].idx.toFixed(0) + '；融资余额 '
  + (mk[0].rzye / 1e8).toFixed(0) + '亿 → ' + (mk[mk.length - 1].rzye / 1e8).toFixed(0) + '亿\n')

const ye = mk.map(r => r.rzye), idx = mk.map(r => r.idx), lev = mk.map(r => r.rzb), N = mk.length
function rollMax(a, w) { const o = new Array(a.length).fill(NaN), dq = []; let h = 0; for (let i = 0; i < a.length; i++) { while (dq.length > h && a[dq[dq.length - 1]] <= a[i]) dq.pop(); dq.push(i); while (dq[h] < i - w + 1) h++; if (i >= w - 1) o[i] = a[dq[h]] } return o }
function rollMin(a, w) { const o = new Array(a.length).fill(NaN), dq = []; let h = 0; for (let i = 0; i < a.length; i++) { while (dq.length > h && a[dq[dq.length - 1]] >= a[i]) dq.pop(); dq.push(i); while (dq[h] < i - w + 1) h++; if (i >= w - 1) o[i] = a[dq[h]] } return o }

/* 因子定义整个网格 */
const WM = [60, 120, 250, 500]
const HZ = [20, 60, 120, 250]
const FACT = []
for (const w of WM) {
  const rm = rollMax(ye, w), rn = rollMin(ye, w)
  FACT.push({ name: 'dd' + w + '（余额距' + w + '日高点回撤，越负=越出清）', key: 'dd' + w, dir: -1, v: ye.map((v, i) => isFinite(rm[i]) && rm[i] > 0 ? v / rm[i] - 1 : NaN) })
  FACT.push({ name: 'up' + w + '（余额距' + w + '日低点涨幅，越大=加杠杆越猛）', key: 'up' + w, dir: -1, v: ye.map((v, i) => isFinite(rn[i]) && rn[i] > 0 ? v / rn[i] - 1 : NaN) })
}
FACT.push({ name: 'chg20（20日余额变化率，越大=加杠杆越快）', key: 'chg20', dir: -1, v: ye.map((v, i) => i >= 20 && ye[i - 20] > 0 ? v / ye[i - 20] - 1 : NaN) })
FACT.push({ name: 'chg60（60日余额变化率）', key: 'chg60', dir: -1, v: ye.map((v, i) => i >= 60 && ye[i - 60] > 0 ? v / ye[i - 60] - 1 : NaN) })
FACT.push({ name: 'levAbs（杠杆率绝对水平 %）', key: 'levAbs', dir: -1, v: lev })
FACT.push({ name: 'levPctAll（杠杆率全历史分位）', key: 'levPctAll', dir: -1, v: lev.map((v, i) => { const a = lev.slice(0, i + 1).filter(isFinite); return a.length >= 500 ? a.filter(x => x <= v).length / a.length : NaN }) })
P('因子定义共 ' + FACT.length + ' 个 × 前瞻 ' + HZ.length + ' 个 = ' + (FACT.length * HZ.length) + ' 个规格（全部列出，不筛选）\n')

/* 单因子单前瞻。
   ⚠️ 阈值必须用【滚动 750 日分位】算，不能用全样本分位 —— 全样本阈值是"用未来信息定分档"，会自我美化。 */
function rollThresh(fv, win, q, step) {
  const n = fv.length, th = new Array(n).fill(NaN)
  let last = NaN
  for (let i = 0; i < n; i++) {
    if (i % step === 0) {
      const a = fv.slice(Math.max(0, i - win + 1), i + 1).filter(isFinite)
      if (a.length < 250) last = NaN
      else { a.sort((x, y) => x - y); last = a[Math.min(a.length - 1, Math.floor(a.length * q))] }
    }
    th[i] = last
  }
  return th
}
function stat(fv, H) {
  const th1 = rollThresh(fv, 750, 1 / 3, 5), th2 = rollThresh(fv, 750, 2 / 3, 5)
  const pairs = []
  const n = Math.min(N, fv.length)
  for (let i = 0; i < n; i++) {
    if (i + H >= n || !isFinite(fv[i]) || !isFinite(idx[i + H]) || !isFinite(th1[i])) continue
    pairs.push({ i, f: fv[i], r: idx[i + H] / idx[i] - 1 })
  }
  if (pairs.length < 200) return null
  const lo = pairs.filter(p => p.f <= th1[p.i]), hi = pairs.filter(p => p.f >= th2[p.i])
  if (lo.length < 50 || hi.length < 50) return null
  const a = mean(lo.map(p => p.r)), b = mean(hi.map(p => p.r))
  const spread = a - b
  // 按时间顺序每 H 天一个块，得到块序列后 HAC（重叠观测的自相关已处理）
  const blocks = []
  for (let st = 0; st + H < pairs.length; st += H) {
    const seg = pairs.slice(st, st + H)
    const l = seg.filter(p => p.f <= th1[p.i]), h2 = seg.filter(p => p.f >= th2[p.i])
    if (l.length >= 2 && h2.length >= 2) blocks.push(mean(l.map(p => p.r)) - mean(h2.map(p => p.r)))
  }
  return { spread, t: nwT(blocks, 4), hitLo: lo.filter(p => p.r > 0).length / lo.length, hitHi: hi.filter(p => p.r > 0).length / hi.length, n: pairs.length }
}

P('╔══════════════════════════════════════════════════════════════════════════════╗')
P('║ 全部规格一览（价差 = 最出清侧 − 最加杠杆侧；正值 = 出清后更强）              ║')
P('╚══════════════════════════════════════════════════════════════════════════════╝')
P('  ' + '因子'.padEnd(38) + HZ.map(h => ('未来' + h + '日').padStart(17)).join(''))
const all = []
for (const f of FACT) {
  const cells = []
  for (const H of HZ) {
    const r = stat(f.v, H)
    if (!r) { cells.push('—'.padStart(17)); continue }
    all.push({ name: f.name, H, spread: r.spread, t: r.t, hitDiff: r.hitLo - r.hitHi })
    cells.push((pc(r.spread) + ' t=' + f2(r.t)).padStart(17))
  }
  P('  ' + f.name.padEnd(38) + cells.join(''))
}
const pos = all.filter(a => a.spread > 0).length
const sig = all.filter(a => a.t > 2).length
P('\n  共 ' + all.length + ' 个规格：价差为正 ' + pos + '/' + all.length + '，HAC t>2 ' + sig + '/' + all.length)
P('  中位价差 ' + pc(median(all.map(a => a.spread))) + '，中位 t ' + f2(median(all.map(a => a.t))))
P('  Bonferroni 参考线（α=0.05，' + all.length + ' 个规格）：|t| > ' + f2(invNorm(1 - 0.05 / (2 * all.length))))

/* 安慰剂：循环平移大盘余额序列 */
P('\n╔══════════════════════════════════════════════════════════════════════════════╗')
P('║ 安慰剂：把余额序列在时间轴上循环平移 150 次，看真实价差是否超出噪声          ║')
P('╚══════════════════════════════════════════════════════════════════════════════╝')
for (const [key, w] of [['dd250', 250], ['dd500', 500], ['chg20', null]]) {
  const f = FACT.find(x => x.key === key)
  const real = stat(f.v, 60)
  const pl = []
  for (let r = 0; r < 150; r++) {
    const rnd = mulberry(4000 + r * 13 + w)
    const sh = 60 + Math.floor(rnd() * (N - 300))
    const shifted = new Array(N).fill(NaN)
    for (let i = 0; i + sh < N; i++) shifted[i] = f.v[i + sh]
    const s = stat(shifted, 60)
    if (s) pl.push(s.spread)
  }
  const m = mean(pl), sd = Math.sqrt(pl.reduce((s, v) => s + (v - m) ** 2, 0) / (pl.length - 1))
  const se = sd / Math.sqrt(pl.length)
  const diff = real.spread - m
  const tDiff = diff / Math.sqrt(sd * sd + sd * sd / pl.length)
  P('  ' + key + ' × 未来60日：真实价差 ' + pc(real.spread) + '（HAC t=' + f2(real.t) + '）')
  P('    安慰剂均值 ' + pc(m) + '（中位 ' + pc(median(pl)) + '，标准差 ' + pc(sd) + '，n=' + pl.length + '）')
  P('    真实 − 安慰剂 = ' + pc(diff) + ' → 近似 t = ' + f2(tDiff)
    + (Math.abs(tDiff) > 2 ? '  ✅ 超出噪声' : '  ❌ 落在噪声带内（不能排除是运气）'))
}

/* 时间外分割 */
P('\n╔══════════════════════════════════════════════════════════════════════════════╗')
P('║ 时间外分割：2013-2019 vs 2020-2026                                          ║')
P('╚══════════════════════════════════════════════════════════════════════════════╝')
P('  ' + '因子'.padEnd(38) + '前半段(2013-2019)'.padStart(22) + '后半段(2020-2026)'.padStart(22) + '  同号')
for (const f of FACT) {
  const cells = []
  const vals = []
  for (const seg of [[0, mk.findIndex(r => r.d >= '2020-01-01')], [mk.findIndex(r => r.d >= '2020-01-01'), N]]) {
    // 分段：把不需要的区段置 NaN
    const v2 = f.v.map((v, i) => (i >= seg[0] && i < seg[1]) ? v : NaN)
    const r = stat(v2, 60)
    vals.push(r ? r.spread : NaN)
    cells.push(r ? pc(r.spread) : '—')
  }
  P('  ' + f.name.slice(0, 36).padEnd(38) + cells[0].padStart(22) + cells[1].padStart(22)
    + (vals[0] * vals[1] > 0 ? '   ✅' : '   ❌'))
}

fs.writeFileSync(MD, '# 大盘两融信号的过拟合审计\n\n```\n' + out.join('\n') + '\n```\n', 'utf8')
P('\n报告已写 ' + MD)
