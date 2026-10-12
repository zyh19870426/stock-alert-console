/* v2：把「出清/暴增」在个股上为什么成立、大盘上为什么不成立，拆干净
 *
 * v1（mkt-margin-cycle.js）发现：
 *   · 个股【时序极值】口径下，出清越多后续越涨、杠杆加得越猛后续越差，四档完全单调 —— 与直觉一致
 *   · 大盘【时序极值】口径下，杠杆率高分位后续继续大涨（趋势延续），与"暴增过热回调"的直觉相反
 * v2 要回答三个追问：
 *   A. 大盘换成「全历史分位 / 绝对水平 / 快速去杠杆」会不会不一样？（v1 用的是滚动750日分位，可能把"杠杆上行期"误当"极值"）
 *   B. 个股的「出清后反弹」是不是只是"跌多了反弹"的影子？（去杠杆与股价下跌同步 ⇒ 必须分离）
 *      → ① 双重排序（自己过去60日涨跌 × 出清程度）
 *      → ② 去杠杆度 = 余额回撤 − 股价回撤（余额跌得比股价多 = 真·去杠杆）
 *      → ③ 正交化残差（剔 自己过去涨跌 + 换手率）
 *   C. 个股"过度接盘"要看杠杆占比水平（融资余额/流通市值），全市场只有 2.6%，个股能到 10%+ ⇒ 分层
 */
const fs = require('fs')
const MKT = 'D:/mywork/_tests/_cache/mkt-rzrq.json'
const STK = 'D:/mywork/_tests/_cache/margin-corr.json'
const MD = 'D:/mywork/_tests/mkt-margin-cycle2.md'
const out = []
const P = s => { out.push(s); console.log(s) }
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN
const med = a => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const pc = v => isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%' : '—'
const f2 = v => isFinite(v) ? v.toFixed(2) : '—'
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => r.concat([b[i]]))
  for (let i = 0; i < n; i++) {
    let piv = i
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k
    if (Math.abs(M[piv][i]) < 1e-9) return null
    ;[M[i], M[piv]] = [M[piv], M[i]]
    for (let k = i + 1; k < n; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j] }
  }
  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i] }
  return x
}
function rows(list, key, edges, labels, h) {
  return labels.map((l, k) => {
    const g = list.filter(o => isFinite(o.f[key]) && isFinite(o.fw[h]) && o.f[key] >= edges[k] && o.f[key] < edges[k + 1])
    return { n: g.length, ex: mean(g.map(o => o.fw[h])), med: med(g.map(o => o.fw[h])), hit: g.length ? g.filter(o => o.fw[h] > 0).length / g.length : NaN }
  })
}
function show(title, rs, labels, base) {
  P('  ' + title)
  P('    ' + '区间'.padEnd(10) + labels.map(l => l.padStart(13)).join('') + '基准'.padStart(13))
  P('    ' + '样本数'.padEnd(9) + rs.map(r => String(r.n).padStart(13)).join('') + String(base.n).padStart(13))
  P('    ' + '未来收益'.padEnd(9) + rs.map(r => pc(r.ex).padStart(13)).join('') + pc(base.ex).padStart(13))
  P('    ' + '上涨占比'.padEnd(9) + rs.map(r => (isFinite(r.hit) ? (r.hit * 100).toFixed(1) + '%' : '—').padStart(13)).join('')
    + (isFinite(base.hit) ? (base.hit * 100).toFixed(1) + '%' : '—').padStart(13))
}

const mk = JSON.parse(fs.readFileSync(MKT, 'utf8')).rows.filter(r => r.d >= '2013-01-01' && isFinite(r.rzye) && isFinite(r.idx) && r.idx > 0 && isFinite(r.rzb))
const db = JSON.parse(fs.readFileSync(STK, 'utf8'))
const CAP = JSON.parse(fs.readFileSync('D:/mywork/_tests/_cache/stk-floatcap.json', 'utf8')).map   // 真实流通市值（亿元），腾讯 qt.gtimg.cn f[44]

/* ═══════════ A. 大盘：换三种"极值"定义 ═══════════ */
P('╔══════════════════════════════════════════════════════════╗')
P('║ A. 大盘换三种口径重测（沪深300，2013-01 ~ 2026-09）      ║')
P('╚══════════════════════════════════════════════════════════╝')
const mObs = []
{
  const ye = mk.map(r => r.rzye), lev = mk.map(r => r.rzb), idx = mk.map(r => r.idx)
  for (let i = 500; i < mk.length; i++) {
    const h500 = Math.max(...ye.slice(i - 499, i + 1)), l500 = Math.min(...ye.slice(i - 499, i + 1))
    const all = lev.slice(0, i + 1).filter(isFinite)
    const f = {
      dd500: ye[i] / h500 - 1,
      up500: ye[i] / l500 - 1,
      levAbs: lev[i],                                        // 绝对水平（%）
      levPctAll: all.length >= 500 ? all.filter(v => v <= lev[i]).length / all.length : NaN,  // 全历史分位
      chg20: i >= 20 ? ye[i] / ye[i - 20] - 1 : NaN          // 20日余额变化（快速加/去杠杆）
    }
    const fw = {}
    for (const h of [20, 60, 120]) fw[h] = (i + h < mk.length) ? idx[i + h] / idx[i] - 1 : NaN
    mObs.push({ d: mk[i].d, f, fw, ye: ye[i] })
  }
}
P('可用观测 ' + mObs.length + '\n')
const hh = 60
const mB = (() => { const a = mObs.filter(o => isFinite(o.fw[hh])); return { n: a.length, ex: mean(a.map(o => o.fw[hh])), hit: a.filter(o => o.fw[hh] > 0).length / a.length } })()

show('① 融资余额回撤（全历史距500日高点）→ 未来60日', rows(mObs, 'dd500', [-1, -0.30, -0.20, -0.10, 0.0001], ['≤−30%', '−30~−20%', '−20~−10%', '−10~0%'], hh), ['≤−30%', '−30~−20%', '−20~−10%', '−10~0%'], mB)
show('② 融资余额涨幅（距500日低点）→ 未来60日', rows(mObs, 'up500', [0, 0.10, 0.30, 0.60, 9], ['<10%', '10~30%', '30~60%', '≥60%'], hh), ['<10%', '10~30%', '30~60%', '≥60%'], mB)
show('③ 杠杆率【绝对水平】→ 未来60日', rows(mObs, 'levAbs', [0, 1.5, 2.0, 2.5, 3.0, 9], ['<1.5%', '1.5~2.0%', '2.0~2.5%', '2.5~3.0%', '>3.0%'], hh), ['<1.5%', '1.5~2.0%', '2.0~2.5%', '2.5~3.0%', '>3.0%'], mB)
show('④ 杠杆率【全历史分位】（不是滚动）→ 未来60日', rows(mObs, 'levPctAll', [0, 0.10, 0.30, 0.70, 0.90, 1.01], ['<10%', '10~30%', '30~70%', '70~90%', '>90%'], hh), ['<10%', '10~30%', '30~70%', '70~90%', '>90%'], mB)
show('⑤ 20日余额变化（快速加/去杠杆）→ 未来60日', rows(mObs, 'chg20', [-1, -0.10, -0.03, 0.03, 0.10, 9], ['≤−10%（踩踏式去杠杆）', '−10~−3%', '−3~+3%', '+3~+10%', '≥+10%（猛加）'], hh), ['≤−10%', '−10~−3%', '−3~+3%', '+3~+10%', '≥+10%'], mB)

P('  ★ 2015 去杠杆全过程（20日余额变化 ≤ −10% 的时点）→ 之后60日沪深300：')
{
  const i2 = mk.map(r => r.d).indexOf('2015-06-01')
  const evs = []
  for (let i = 500; i < mk.length - 60; i++) {
    const c = mk[i].rzye / mk[i - 20].rzye - 1
    if (c <= -0.10) evs.push({ d: mk[i].d, c, f60: mk[i + 60].idx / mk[i].idx - 1 })
  }
  const uniq = []; const seen = new Set()
  for (const e of evs) { const k = e.d.slice(0, 7); if (seen.has(k)) continue; seen.add(k); uniq.push(e) }
  uniq.slice(0, 14).forEach(e => P('    ' + e.d + '  余额20日 ' + pc(e.c) + '  → +60日 ' + pc(e.f60)))
  P('    （共 ' + uniq.length + ' 个月份，均值 +60日 ' + pc(mean(uniq.map(e => e.f60))) + '）')
}

/* ═══════════ B. 个股：出清后反弹是不是"跌多了反弹"的影子 ═══════════ */
P('\n╔══════════════════════════════════════════════════════════╗')
P('║ B. 个股：把"出清后反弹"与"跌多了反弹"拆开（131 只）      ║')
P('╚══════════════════════════════════════════════════════════╝')
const sObs = []
const byDate = new Map()
for (const code of Object.keys(db.stocks)) {
  const st = db.stocks[code]
  const fmap = new Map(); for (const r of st.f) fmap.set(r[0], r)
  const rr = []
  for (const r of st.m) { const p = fmap.get(r[0]); if (!p) continue; rr.push({ d: r[0], ye: r[1], c: p[1], turn: p[3], amt: p[5] }) }
  if (rr.length < 400) continue
  const ye = rr.map(x => x.ye), close = rr.map(x => x.c)
  // ⚠️ 杠杆占比必须用【真实流通市值】倒推流通股数，再按当日收盘算时点市值。
  //    早前用「成交额 ÷ 换手率」估市值，中位数算出 402%（荒谬）—— 因为主力净额占成交额比在个股间差异极大，估出来全废。
  const fc = CAP[code]
  const shares = (fc && fc.cap > 0 && fc.close > 0) ? fc.cap * 1e8 / fc.close : NaN
  const lev = rr.map(x => (isFinite(shares) && shares > 0 && x.c > 0) ? x.ye / (shares * x.c) * 100 : NaN)
  for (let i = 250; i < rr.length - 121; i++) {
    const h500 = Math.max(...ye.slice(Math.max(0, i - 499), i + 1))
    const c500 = Math.max(...close.slice(Math.max(0, i - 499), i + 1))
    const zddeq = close[i] / c500 - 1                                  // 股价自回撤
    const zdd = ye[i] / h500 - 1                                       // 余额自回撤
    const f = {
      dd250: zdd,
      ddGap: zdd - zddeq,                                              // 余额比股价多跌多少（真·去杠杆）
      ret60b: close[i] / close[i - 60] - 1,                            // 自己过去60日涨跌
      ret120b: close[i] / close[i - 120] - 1,
      turn: rr[i].turn,
      levLv: lev[i]
    }
    const fw = {}
    for (const h of [20, 60, 120]) fw[h] = (i + h < rr.length) ? close[i + h] / close[i] - 1 : NaN
    const o = { code, d: rr[i].d, f, fw, fwe: {} }
    sObs.push(o)
    if (!byDate.has(o.d)) byDate.set(o.d, []); byDate.get(o.d).push(o)
  }
}
for (const [, g] of byDate) for (const h of [20, 60, 120]) {
  const v = g.map(o => o.fw[h]).filter(isFinite)
  if (v.length < 15) continue
  const mu = mean(v); for (const o of g) o.fwe[h] = o.fw[h] - mu
}
const sObs2 = sObs.filter(o => byDate.get(o.d).length >= 15)
P('可用观测 ' + sObs2.length + '\n')
const LB = ['≤−30%', '−30~−20%', '−20~−10%', '−10~0%']
for (const h of [60, 120]) {
  const base = (() => { const a = sObs2.filter(o => isFinite(o.fw[h])); return { n: a.length, ex: mean(a.map(o => o.fw[h])), hit: a.filter(o => o.fw[h] > 0).length / a.length } })()
  P('── 未来 ' + h + ' 日（原始收益，基准 ' + pc(base.ex) + '）──')
  show('出清程度 dd250（余额自高点的回撤）', rows(sObs2, 'dd250', [-1, -0.30, -0.20, -0.10, 0.0001], LB, h), LB, base)
  show('去杠杆度 ddGap = 余额回撤 − 股价回撤（>0 表示余额比股价跌得多）',
    rows(sObs2, 'ddGap', [-9, -0.20, -0.05, 0.05, 0.20, 9], ['≤−20%（余额比股价抗跌）', '−20~−5%', '±5%（同步）', '+5~+20%', '≥+20%（真去杠杆）'], h),
    ['≤−20%', '−20~−5%', '±5%', '+5~+20%', '≥+20%'], base)
  P('')
}

/* 双重排序：控制自己过去60日涨跌 */
P('★ 双重排序：先按【自己过去60日涨跌】分5组，组内再看出清程度 dd250 高低半 → 未来60日')
{
  const h = 60
  const g5 = [[], [], [], [], []]
  for (const [, g] of byDate) {
    const s = g.filter(o => isFinite(o.f.ret60b) && isFinite(o.fw[h])).sort((a, b) => a.f.ret60b - b.f.ret60b)
    if (s.length < 15) continue
    s.forEach((o, i) => g5[Math.min(4, Math.floor(i * 5 / s.length))].push(o))
  }
  P('  ' + '过去60日涨跌分位'.padEnd(18) + '样本'.padStart(8) + '区间'.padStart(12)
    + '出清多(dd250低)'.padStart(17) + '出清少'.padStart(12) + '出清多−少'.padStart(13))
  const sp = []
  for (let q = 0; q < 5; q++) {
    const g = g5[q].filter(o => isFinite(o.f.dd250))
    const m = med(g.map(o => o.f.dd250))
    const hi = g.filter(o => o.f.dd250 <= m)      // dd250 越负 = 出清越多
    const lo = g.filter(o => o.f.dd250 > m)
    const a = mean(hi.map(o => o.fw[h])), b = mean(lo.map(o => o.fw[h]))
    sp.push(a - b)
    P('  ' + ('Q' + (q + 1)).padEnd(18) + String(g.length).padStart(8) + pc(med(g.map(o => o.f.ret60b))).padStart(12)
      + pc(a).padStart(17) + pc(b).padStart(12) + pc(a - b).padStart(13))
  }
  P('  → 五格均值 ' + pc(mean(sp)) + '，五格全为正的格数 ' + sp.filter(v => v > 0).length + '/5')
  P('  → 若五格普遍为正 ⇒ 在任何价格状态下，"余额出清得多"都对应更好的后续收益（不只是跌多了反弹）')
}

/* 正交化残差 */
P('\n★ 正交化：把 dd250 对 [自己过去60日涨跌, 过去120日涨跌, 换手率] 回归，用残差分5组')
{
  const h = 60, ctrls = ['ret60b', 'ret120b', 'turn']
  const R = []
  for (const [, g] of byDate) {
    const gg = g.filter(o => isFinite(o.f.dd250) && ctrls.every(c => isFinite(o.f[c])) && isFinite(o.fw[h]))
    if (gg.length < 30) continue
    const cs = ctrls.map(c => { const v = gg.map(o => o.f[c]); return { c, mu: mean(v), s: sd2(v) || 1 } })
    const X = gg.map(o => [1].concat(cs.map(k => (o.f[k.c] - k.mu) / k.s)))
    const y = gg.map(o => o.f.dd250)
    const p = ctrls.length + 1
    const A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0)
    for (let i = 0; i < X.length; i++) for (let r = 0; r < p; r++) { b[r] += X[i][r] * y[i]; for (let c2 = 0; c2 < p; c2++) A[r][c2] += X[i][r] * X[i][c2] }
    const sol = solve(A, b); if (!sol) continue
    for (let i = 0; i < X.length; i++) { let fit = 0; for (let r = 0; r < p; r++) fit += sol[r] * X[i][r]; R.push({ d: gg[i].d, res: y[i] - fit, fw: gg[i].fw[h] }) }
  }
  const byD = new Map(); for (const x of R) { if (!byD.has(x.d)) byD.set(x.d, []); byD.get(x.d).push(x) }
  const b5 = [[], [], [], [], []]
  for (const [, g] of byD) {
    const s = g.filter(x => isFinite(x.fw)).sort((a, b) => a.res - b.res)
    if (s.length < 15) continue
    s.forEach((x, i) => b5[Math.min(4, Math.floor(i * 5 / s.length))].push(x.fw))
  }
  const base = mean(R.map(x => x.fw))
  P('    ' + '残差分位'.padEnd(10) + b5.map((r, i) => ('Q' + (i + 1)).padStart(12)).join('') + '   基准'.padStart(12))
  P('    ' + '未来60日'.padEnd(9) + b5.map(r => pc(mean(r)).padStart(12)).join('') + pc(base).padStart(12))
  P('    ' + '上涨占比'.padEnd(9) + b5.map(r => ((mean(r.map(v => v > 0 ? 1 : 0)) * 100).toFixed(1) + '%').padStart(12)).join(''))
  const sp = mean(b5[0]) - mean(b5[4])   // dd250 越负（残差越小）应越好 ⇒ Q1 − Q5 为正即成立
  P('    → 残差 Q1(出清多) − Q5(出清少) = ' + pc(sp) + (Math.abs(sp) < 0.005 ? '   ⇒ 剔除价格/换手后基本无独立信息' : '   ⇒ 剔除后仍有独立信息 ✅'))
}
function sd2(a) { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1)) }

/* ═══════════ C. 个股杠杆占比水平分层 ═══════════ */
P('\n╔══════════════════════════════════════════════════════════╗')
P('║ C. 个股"过度接盘"要看杠杆占比水平（融资余额/流通市值）   ║')
P('╚══════════════════════════════════════════════════════════╝')
{
  const lv = sObs2.map(o => o.f.levLv).filter(isFinite)
  P('  个股杠杆占比分布：中位 ' + f2(med(lv)) + '% ，10/90 分位 ' + f2(lv.slice().sort((a, b) => a - b)[Math.floor(lv.length * 0.1)]) + '% / '
    + f2(lv.slice().sort((a, b) => a - b)[Math.floor(lv.length * 0.9)]) + '% ，最大 ' + f2(Math.max(...lv)) + '%')
  P('  （对照：全市场杠杆率只有 2.6% —— 大盘的"杠杆"和个股的"杠杆"根本不是一个量级）\n')
  const base = (() => { const a = sObs2.filter(o => isFinite(o.fw[60])); return { n: a.length, ex: mean(a.map(o => o.fw[60])), hit: a.filter(o => o.fw[60] > 0).length / a.length } })()
  show('按【杠杆占比水平】分层 → 未来60日',
    rows(sObs2, 'levLv', [0, 1, 2, 4, 8, 999], ['<1%', '1~2%', '2~4%', '4~8%', '>8%（过度接盘）'], 60),
    ['<1%', '1~2%', '2~4%', '4~8%', '>8%'], base)
  P('\n  ★ 高杠杆占比(>4%) × 是否暴增（自己过去60日余额变化为正=加杠杆）→ 未来60日')
  for (const [nm, lo, hi] of [['低杠杆占比 <4%', 0, 4], ['高杠杆占比 ≥4%', 4, 999]]) {
    const g = sObs2.filter(o => isFinite(o.f.levLv) && o.f.levLv >= lo && o.f.levLv < hi && isFinite(o.fw[60]))
    const up = g.filter(o => o.f.dd250 > -0.05), dn = g.filter(o => o.f.dd250 <= -0.20)
    P('    ' + nm + '：余额接近高点(未出清) ' + pc(mean(up.map(o => o.fw[60]))) + '（n=' + up.length + '，上涨占比 '
      + (up.length ? (up.filter(o => o.fw[60] > 0).length / up.length * 100).toFixed(1) + '%' : '—') + '）  vs  已出清>20% '
      + pc(mean(dn.map(o => o.fw[60]))) + '（n=' + dn.length + '，上涨占比 '
      + (dn.length ? (dn.filter(o => o.fw[60] > 0).length / dn.length * 100).toFixed(1) + '%' : '—') + '）')
  }
}

/* ═══════════ D. 稳健性：出清效应是不是只靠某一年 ═══════════ */
P('\n╔══════════════════════════════════════════════════════════╗')
P('║ D. 稳健性：个股出清效应逐年看（防"只靠 2024-09 那波"）   ║')
P('╚══════════════════════════════════════════════════════════╝')
{
  const h = 60
  const sz = sObs2.filter(o => isFinite(o.f.dd250) && isFinite(o.fw[h]))
  const years = [...new Set(sz.map(o => Number(String(o.d).slice(0, 4))))].sort()
  P('  ' + '年份'.padEnd(8) + '样本'.padStart(8) + '基准'.padStart(10)
    + '≤−30%'.padStart(12) + '−30~−20%'.padStart(12) + '−20~−10%'.padStart(12) + '−10~0%'.padStart(12) + '  出清多−少')
  for (const y of years) {
    const g = sz.filter(o => Number(String(o.d).slice(0, 4)) === y)
    if (g.length < 300) continue
    const cell = (lo, hi) => mean(g.filter(o => o.f.dd250 >= lo && o.f.dd250 < hi).map(o => o.fw[h]))
    const a = cell(-1, -0.30), b = cell(-0.30, -0.20), c = cell(-0.20, -0.10), dd = cell(-0.10, 0.001)
    P('  ' + String(y).padEnd(8) + String(g.length).padStart(8) + pc(mean(g.map(o => o.fw[h]))).padStart(10)
      + pc(a).padStart(12) + pc(b).padStart(12) + pc(c).padStart(12) + pc(dd).padStart(12)
      + ('  ' + pc(a - dd)).padStart(12) + (a - dd > 0 ? ' ✅' : ' ❌'))
  }
  // 剔除 2024-09-01 ~ 2024-12-31（大反转窗口）后重算
  const ex = sz.filter(o => !(o.d >= 20240901 && o.d <= 20241231))   // ⚠️ o.d 是 YYYYMMDD 整数，别拿字符串比
  const cell2 = (lo, hi) => mean(ex.filter(o => o.f.dd250 >= lo && o.f.dd250 < hi).map(o => o.fw[h]))
  P('  ' + '剔除2024-09~12'.padEnd(14) + String(ex.length).padStart(6) + pc(mean(ex.map(o => o.fw[h]))).padStart(10)
    + pc(cell2(-1, -0.30)).padStart(12) + pc(cell2(-0.30, -0.20)).padStart(12) + pc(cell2(-0.20, -0.10)).padStart(12) + pc(cell2(-0.10, 0.001)).padStart(12)
    + ('  ' + pc(cell2(-1, -0.30) - cell2(-0.10, 0.001))).padStart(12))
}

fs.writeFileSync(MD, '# v2：出清/暴增 —— 大盘换口径 + 个股剥离价格反转 + 杠杆占比分层\n\n```\n' + out.join('\n') + '\n```\n', 'utf8')
P('\n报告已写 ' + MD)
