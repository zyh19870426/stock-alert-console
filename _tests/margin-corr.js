/* 两融余额 × 涨跌方向 关联性实测 —— 分析层
 *
 * 问题：融资余额（存量，T+1 披露）的变化，到底对股价涨跌方向有没有关联/预测力？
 *      并直接检验控制台「两融」那一行的四象限定性表是否成立：
 *        增+涨=加仓 / 增+跌=逆势 / 减+涨=获利了结 / 减+跌=撤退
 *
 * 数据：_tests/_cache/margin-corr.json（margin-corr-fetch.js 产出）
 *
 * 口径要点（避免未来函数）：
 *   · 两融 T+1 披露 ⇒ 用「D 日收盘后可知的融资余额」去预测「D+1 收盘起」的收益。
 *   · 收益一律用「横截面去均值」（同日全体样本等权均值）扣除市场 beta，基准 = 0。
 *   · 休市/停牌导致的跨度过大（dM5 间隔 >12 自然日、dM20 >40 日）一律丢弃。
 *
 * 产出：_tests/margin-corr-report.md + 控制台摘要
 */
const fs = require('fs')
const OUT = 'D:/mywork/_tests/_cache/margin-corr.json'
const MD = 'D:/mywork/_tests/margin-corr-raw.md'   // 原始输出（每次跑覆盖；结论报告另写 margin-corr-report.md）

const db = JSON.parse(fs.readFileSync(OUT, 'utf8'))
const HS = [1, 3, 5, 10, 20]      // 前瞻窗口
const out = []
const P = s => { out.push(s); console.log(s) }

/* ────────── 1. 构建观测样本 ────────── */
const dayN = d => Math.floor(d / 10000) * 372 + (Math.floor(d / 100) % 100) * 31 + (d % 100)   // 近似日序，仅用于跨度过虑

const obs = []
let dropped = 0
for (const code of Object.keys(db.stocks)) {
  const st = db.stocks[code]
  const fmap = new Map()
  for (const r of st.f) fmap.set(r[0], r)
  const rows = []
  for (const r of st.m) {                       // 以两融日期为主轴，价格同日必须有
    const p = fmap.get(r[0])
    if (!p) continue
    rows.push({ d: r[0], ye: r[1], jme: r[2], c: p[1], ret: p[2], turn: p[3], net: p[4], amt: p[5] })
  }
  if (rows.length < 300) continue
  for (let i = 22; i < rows.length - 22; i++) {
    const a = rows[i], m5 = rows[i - 5], m20 = rows[i - 20], p5 = rows[i - 5], p20 = rows[i - 20]
    if (![a.ye, m5.ye, m20.ye, a.c, p5.c, p20.c].every(v => isFinite(v) && v > 0)) { dropped++; continue }
    if (dayN(a.d) - dayN(m20.d) > 40) { dropped++; continue }          // 跨度异常（长停牌/长假）
    // 5 日净买入额 ÷ 5 日成交额
    let n5 = 0, a5 = 0, ok = true
    for (let k = i - 4; k <= i; k++) {
      const r = rows[k]
      if (!isFinite(r.jme) || !isFinite(r.amt) || r.amt <= 0) { ok = false; break }
      n5 += r.jme; a5 += r.amt
    }
    if (!ok || a5 <= 0) { dropped++; continue }
    // 前瞻：D+1 收盘进场（两融算完再交易，保守）
    const fw = {}
    let fwok = true
    for (const h of HS) {
      const j = i + 1 + h
      if (j >= rows.length || !isFinite(rows[j].c) || rows[j].c <= 0) { fwok = false; break }
      fw[h] = rows[j].c / rows[i + 1].c - 1
    }
    if (!fwok || !isFinite(rows[i + 1].c) || rows[i + 1].c <= 0) { dropped++; continue }
    obs.push({
      code, d: a.d, y: Math.floor(a.d / 10000),
      dM5: a.ye / m5.ye - 1, dM20: a.ye / m20.ye - 1,
      n5r: n5 / a5,                                   // 5日两融净买入 ÷ 成交额
      net5r: (() => {                                  // 同期主力净额 ÷ 成交额（对照项）
        let s = 0, t = 0
        for (let k = i - 4; k <= i; k++) { s += rows[k].net; t += rows[k].amt }
        return (isFinite(s) && t > 0) ? s / t : NaN
      })(),
      turn: a.turn, turn5: (rows[i].amt + rows[i - 1].amt + rows[i - 2].amt + rows[i - 3].amt + rows[i - 4].amt) / 5,
      zb: (() => { const mc = a.amt / (a.turn || NaN); return isFinite(mc) && mc > 0 ? a.ye / mc : NaN })(),  // 融资余额估占流通市值
      ret5b: a.c / p5.c - 1, ret20b: a.c / p20.c - 1,
      ret: a.ret,
      fw
    })
  }
}
P('样本：' + Object.keys(db.stocks).length + ' 只股票，' + obs.length + ' 个观测（丢弃 ' + dropped + ' 个不完整点）')
P('区间：' + Math.min(...obs.map(o => o.d)) + ' ~ ' + Math.max(...obs.map(o => o.d)))

/* ────────── 2. 横截面去均值（扣市场 beta）────────── */
const byDate = new Map()
for (const o of obs) { if (!byDate.has(o.d)) byDate.set(o.d, []); byDate.get(o.d).push(o) }
for (const [d, arr] of byDate) {
  for (const h of HS) {
    const v = arr.map(o => o.fw[h]).filter(isFinite)
    const mu = v.reduce((a, b) => a + b, 0) / v.length
    for (const o of arr) o['ex' + h] = o.fw[h] - mu
  }
}
// 只保留当日样本 ≥15 只的观测（横截面均值才有意义）
const obs2 = obs.filter(o => byDate.get(o.d).length >= 15)
P('横截面有效观测：' + obs2.length + '（当日样本 ≥15 只）\n')

/* ────────── 3. 统计工具 ────────── */
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN }
function med(a) { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
function sd(a) { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1)) }
function corr(x, y) {
  const p = []
  for (let i = 0; i < x.length; i++) if (isFinite(x[i]) && isFinite(y[i])) p.push([x[i], y[i]])
  if (p.length < 30) return NaN
  const mx = mean(p.map(q => q[0])), my = mean(p.map(q => q[1]))
  let sxy = 0, sxx = 0, syy = 0
  for (const [a, b] of p) { sxy += (a - mx) * (b - my); sxx += (a - mx) ** 2; syy += (b - my) ** 2 }
  return (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : NaN
}
function rank(a) {                                  // 平均秩（处理并列）
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0])
  const r = new Array(a.length)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg
    i = j + 1
  }
  return r
}
function spearman(x, y) {
  const p = []
  for (let i = 0; i < x.length; i++) if (isFinite(x[i]) && isFinite(y[i])) p.push([x[i], y[i]])
  if (p.length < 30) return NaN
  return corr(rank(p.map(q => q[0])), rank(p.map(q => q[1])))
}
function quintile(list, key) {                       // 按 key 分 5 组（横截面内分，避免时间趋势）
  const out5 = [[], [], [], [], []]
  for (const [d, group] of byDate) {
    const g = group.filter(o => isFinite(o[key])).sort((a, b) => a[key] - b[key])
    if (g.length < 15) continue
    g.forEach((o, i) => { out5[Math.min(4, Math.floor(i * 5 / g.length))].push(o) })
  }
  return out5
}
const pc = v => isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%' : '—'
const f2 = v => isFinite(v) ? v.toFixed(2) : '—'

/* ────────── 4. A. 同期关联（共线性）────────── */
P('══════ A. 同期关联：两融变化 与 同窗口股价涨跌 ══════')
const A = [
  ['当日净买入/成交额  vs  当日涨跌', obs2.map(o => o.n5r / 5), obs2.map(o => o.ret)],
  ['5日融资余额变化%   vs  过去5日涨跌', obs2.map(o => o.dM5), obs2.map(o => o.ret5b)],
  ['20日融资余额变化%  vs  过去20日涨跌', obs2.map(o => o.dM20), obs2.map(o => o.ret20b)],
  ['同期主力净额/成交额 vs  过去5日涨跌', obs2.map(o => o.net5r), obs2.map(o => o.ret5b)],
  ['5日融资余额变化%   vs  5日主力净额（两融 vs 主力资金流）', obs2.map(o => o.dM5), obs2.map(o => o.net5r)]
]
for (const [nm, x, y] of A) P('  ' + nm.padEnd(46) + ' 相关系数 ' + f2(corr(x, y)))

/* ────────── 5. B. 预测力（前瞻超额收益）────────── */
P('\n══════ B. 预测力：两融变化 → 未来超额收益（横截面去均值）══════')
const FAC = [
  ['5日融资余额变化%', 'dM5'],
  ['20日融资余额变化%', 'dM20'],
  ['5日两融净买入/成交额', 'n5r'],
  ['5日主力净额/成交额（对照）', 'net5r'],
  ['换手率（对照·已知有效）', 'turn'],
  ['融资余额估占流通市值（拥挤度）', 'zb']
]
P('  ' + '因子'.padEnd(28) + HS.map(h => ('未来' + h + '日').padStart(9)).join(' ') + '   (Spearman IC)')
for (const [nm, key] of FAC) {
  const row = HS.map(h => f2(spearman(obs2.map(o => o[key]), obs2.map(o => o['ex' + h]))))
  P('  ' + nm.padEnd(28) + row.map(s => s.padStart(9)).join(' '))
}

/* ────────── 6. C. 分组单调性 ────────── */
P('\n══════ C. 分位单调性（同日横截面分 5 组）══════')
function bucketTable(name, key, h) {
  const g = quintile(obs2, key)
  const rows = g.map(o => ({ n: o.length, ex: mean(o.map(x => x['ex' + h])), raw: mean(o.map(x => x.fw[h])), hit: mean(o.map(x => x['ex' + h] > 0 ? 1 : 0)) }))
  // ⚠️ 基准不是 50%：超额收益右偏（少数大牛股抬高均值）⇒ ex>0 的占比天然低于 50%
  const base = { ex: mean(obs2.map(x => x['ex' + h])), raw: mean(obs2.map(x => x.fw[h])), hit: mean(obs2.map(x => x['ex' + h] > 0 ? 1 : 0)) }
  P('  ' + name + '（未来 ' + h + ' 日）')
  P('    ' + '分位'.padEnd(10) + rows.map((r, i) => ('Q' + (i + 1)).padStart(12)).join('') + '   基准(全体)'.padStart(12))
  P('    ' + '超额均值'.padEnd(9) + rows.map(r => pc(r.ex).padStart(12)).join('') + pc(base.ex).padStart(12))
  P('    ' + '原始均值'.padEnd(9) + rows.map(r => pc(r.raw).padStart(12)).join('') + pc(base.raw).padStart(12))
  P('    ' + '超额胜率'.padEnd(9) + rows.map(r => (isFinite(r.hit) ? (r.hit * 100).toFixed(1) + '%' : '—').padStart(12)).join('')
    + (isFinite(base.hit) ? (base.hit * 100).toFixed(1) + '%' : '—').padStart(12))
  const mono = rows.map(r => r.ex)
  const monoOk = mono.every((v, i) => i === 0 || !isFinite(v) || !isFinite(mono[i - 1]) || (mono[i] >= mono[i - 1]) === (mono[4] >= mono[0]))
  P('    → 极差 Q5−Q1 = ' + pc(mono[4] - mono[0]) + '，单调性 ' + (monoOk ? '✅ 单调' : '❌ 非单调'))
  return { rows, spread: mono[4] - mono[0] }
}
bucketTable('A) 5日融资余额变化%  → 未来5日', 'dM5', 5)
bucketTable('B) 20日融资余额变化% → 未来20日', 'dM20', 20)
bucketTable('C) 5日两融净买入/成交额 → 未来5日', 'n5r', 5)
bucketTable('D) 5日主力净额/成交额 → 未来5日（对照）', 'net5r', 5)
bucketTable('E) 换手率 → 未来5日（对照）', 'turn', 5)

/* ────────── 7. D. 四象限（直接检验控制台定性表）────────── */
P('\n══════ D. 四象限检验：融资方向 × 过去20日价格方向 → 未来20日超额 ══════')
const quad = { 'in-up': [], 'in-dn': [], 'out-up': [], 'out-dn': [] }
for (const o of obs2) {
  if (!isFinite(o.dM20) || !isFinite(o.ret20b)) continue
  const k = (o.dM20 > 0 ? 'in' : 'out') + '-' + (o.ret20b > 0 ? 'up' : 'dn')
  quad[k].push(o)
}
const QLAB = {
  'in-up': '融资流入 + 股价涨  （控制台：杠杆在加仓 · good）',
  'in-dn': '融资流入 + 股价跌  （控制台：杠杆逆势加仓 · warn）',
  'out-up': '融资流出 + 股价涨 （控制台：杠杆获利了结 · mute）',
  'out-dn': '融资流出 + 股价跌 （控制台：杠杆在撤退 · bad）'
}
P('  ' + '象限'.padEnd(44) + '样本'.padStart(8) + '未来20日超额'.padStart(14) + '中位'.padStart(10) + '上涨占比'.padStart(10))
for (const k of ['in-up', 'in-dn', 'out-up', 'out-dn']) {
  const a = quad[k]
  P('  ' + QLAB[k].padEnd(44) + String(a.length).padStart(8) + pc(mean(a.map(o => o.ex20))).padStart(14)
    + pc(med(a.map(o => o.ex20))).padStart(10) + ((mean(a.map(o => o.ex20 > 0 ? 1 : 0)) * 100).toFixed(1) + '%').padStart(10))
}
const allEx20 = mean(obs2.map(o => o.ex20))
P('  ' + '（全体基准）'.padEnd(42) + String(obs2.length).padStart(8) + pc(allEx20).padStart(14))
P('  → 检验：好的应显著 > 0、坏的最差。若四格差异都在 ±0.5% 内 ⇒ 定性表对涨跌方向没有区分力。')
P('  ⚠️ 但四格还混着「过去20日涨跌本身的反转效应」，必须做下面的双重排序才能归因给两融。')

/* ────────── 7b. D2. 双重排序：控制价格状态后，融资方向还有没有增量 ────────── */
P('\n══════ D2. 双重排序：先按「过去20日涨跌」分组，组内再看融资方向（未来20日超额）══════')
const pg = quintile(obs2, 'ret20b')
P('  ' + '过去20日涨跌分位'.padEnd(18) + '样本'.padStart(8) + '区间'.padStart(20)
  + '融资增'.padStart(11) + '融资减'.padStart(11) + '增−减'.padStart(11))
const d2 = []
for (let q = 0; q < 5; q++) {
  const g = pg[q].filter(o => isFinite(o.dM20))
  if (g.length < 200) continue
  const hi = g.filter(o => o.dM20 > 0), lo = g.filter(o => o.dM20 <= 0)
  const mh = mean(hi.map(o => o.ex20)), ml = mean(lo.map(o => o.ex20))
  d2.push(mh - ml)
  P('  ' + ('Q' + (q + 1)).padEnd(18) + String(g.length).padStart(8)
    + (pc(med(g.map(o => o.ret20b))) + ' 涨跌').padStart(20)
    + pc(mh).padStart(11) + pc(ml).padStart(11) + pc(mh - ml).padStart(11))
}
P('  → 「增−减」五格若符号乱跳/量级都在 ±0.5% 内 ⇒ 融资方向在价格状态之外没有独立信息。')
P('  → 五格均值 ' + pc(mean(d2)) + '（同号格数 ' + d2.filter(v => v > 0).length + '/5）')

/* ────────── 7c. 反转因子本身（对照组：到底是谁在起作用）────────── */
P('\n══════ D3. 对照：过去20日涨跌（纯反转因子）→ 未来20日超额 ══════')
const r20rows = pg.map(o => ({ n: o.length, ex: mean(o.map(x => x.ex20)) }))
P('  Q1(跌最多)→Q5(涨最多)：' + r20rows.map(r => pc(r.ex)).join('  '))
P('  → Q1−Q5 = ' + pc(r20rows[0].ex - r20rows[4].ex) + '（正 = 跌多的后面反弹，即反转效应存在）')

/* ────────── 7d. D4. 正交化：剔除「过去涨跌 + 换手率」后，两融还剩什么 ────────── */
P('\n══════ D4. 正交化检验：逐日把 dM20 对 [过去20日涨跌, 换手率] 回归，用残差分5组 ══════')
P('  （两融余额变化本身与股价高度共线：融资盘跟着涨买、跌停手 ⇒ 必须剔干净才知道它有没有独立信息）')
const olsResid = (key, ctrls) => {
  const out = []
  for (const [d, group] of byDate) {
    const g = group.filter(o => isFinite(o[key]) && ctrls.every(c => isFinite(o[c])))
    if (g.length < 30) continue
    // 标准化控制变量，数值稳定
    const cs = ctrls.map(c => { const v = g.map(o => o[c]); const mu = mean(v), s = sd(v) || 1; return { c, mu, s } })
    const X = g.map(o => [1].concat(cs.map(k => (o[k.c] - k.mu) / k.s)))
    const y = g.map(o => o[key])
    const p = ctrls.length + 1
    // 正规方程 (X'X)b = X'y
    const A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0)
    for (let i = 0; i < X.length; i++) {
      for (let r = 0; r < p; r++) {
        b[r] += X[i][r] * y[i]
        for (let c2 = 0; c2 < p; c2++) A[r][c2] += X[i][r] * X[i][c2]
      }
    }
    const sol = solve(A, b)
    if (!sol) continue
    for (let i = 0; i < X.length; i++) {
      let fit = 0
      for (let r = 0; r < p; r++) fit += sol[r] * X[i][r]
      out.push({ o: g[i], res: y[i] - fit })
    }
  }
  return out
}
function solve(A, b) {                        // 高斯消元，奇异返回 null
  const n = b.length
  const M = A.map((r, i) => r.concat([b[i]]))
  for (let i = 0; i < n; i++) {
    let piv = i
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k
    if (Math.abs(M[piv][i]) < 1e-9) return null
    ;[M[i], M[piv]] = [M[piv], M[i]]
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i]
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]
    }
  }
  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n]
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]
    x[i] = s / M[i][i]
  }
  return x
}
function residTable(label, key, ctrls, h) {
  const R = olsResid(key, ctrls)
  const all = R.map(x => x.o['ex' + h]).filter(isFinite)
  const base = mean(all), baseHit = mean(all.map(v => v > 0 ? 1 : 0))
  // 用残差排序分 5 组
  const rows = [[], [], [], [], []]
  const byDR = new Map()
  for (const x of R) { if (!byDR.has(x.o.d)) byDR.set(x.o.d, []); byDR.get(x.o.d).push(x) }
  for (const [, g] of byDR) {
    const s = g.filter(x => isFinite(x.o['ex' + h])).sort((a, b) => a.res - b.res)
    if (s.length < 15) continue
    s.forEach((x, i) => rows[Math.min(4, Math.floor(i * 5 / s.length))].push(x.o['ex' + h]))
  }
  P('  ' + label + '（控制：' + ctrls.join(' + ') + '，未来 ' + h + ' 日超额）')
  P('    ' + '残差分位'.padEnd(10) + rows.map((r, i) => ('Q' + (i + 1)).padStart(12)).join('') + '   基准'.padStart(12))
  P('    ' + '超额均值'.padEnd(9) + rows.map(r => pc(mean(r)).padStart(12)).join('').padEnd(12) + pc(base).padStart(12))
  P('    ' + '超额胜率'.padEnd(9) + rows.map(r => ((mean(r.map(v => v > 0 ? 1 : 0)) * 100).toFixed(1) + '%').padStart(12)).join('').padEnd(12) + (baseHit * 100).toFixed(1) + '%')
  const sp = mean(rows[4]) - mean(rows[0])
  P('    → 残差 Q5−Q1 = ' + pc(sp) + (Math.abs(sp) < 0.005 ? '   ⇒ 剔除后基本无独立信息' : '   ⇒ 剔除后仍有残差效应'))
  return sp
}
residTable('A) 20日融资余额变化%', 'dM20', ['ret20b', 'turn'], 20)
residTable('B) 5日融资余额变化%', 'dM5', ['ret5b', 'turn'], 5)
residTable('C) 5日两融净买入/成交额', 'n5r', ['ret5b', 'turn'], 5)
residTable('D) 5日主力净额/成交额（对照）', 'net5r', ['ret5b', 'turn'], 5)
residTable('E) 换手率（对照）', 'turn', ['ret5b', 'ret20b'], 5)

/* ────────── 8. E. 分年度稳定性 ────────── */
P('\n══════ E. 分年度稳定性（四象限的未来20日超额）══════')
const years = [...new Set(obs2.map(o => o.y))].sort()
P('  ' + '年份'.padEnd(8) + ['in-up', 'in-dn', 'out-up', 'out-dn'].map(k => k.padStart(11)).join(''))
for (const y of years) {
  const sub = obs2.filter(o => o.y === y)
  if (sub.length < 300) continue
  const cells = ['in-up', 'in-dn', 'out-up', 'out-dn'].map(k => {
    const a = sub.filter(o => ((o.dM20 > 0 ? 'in' : 'out') + '-' + (o.ret20b > 0 ? 'up' : 'dn')) === k)
    return pc(mean(a.map(o => o.ex20))).padStart(11)
  })
  P('  ' + String(y).padEnd(8) + cells.join(''))
}

/* ────────── 9. F. 换手率控制下的增量 ────────── */
P('\n══════ F. 控制换手率后，两融还有没有独立信息 ══════')
const tg = quintile(obs2, 'turn')
P('  ' + '换手率分位'.padEnd(14) + '样本'.padStart(8) + '  dM5 高半 − 低半（未来5日超额）')
for (let q = 0; q < 5; q++) {
  const g = tg[q].filter(o => isFinite(o.dM5))
  const med5 = med(g.map(o => o.dM5))
  const hi = g.filter(o => o.dM5 > med5), lo = g.filter(o => o.dM5 <= med5)
  P('  ' + ('Q' + (q + 1)).padEnd(14) + String(g.length).padStart(8) + '  ' + pc(mean(hi.map(o => o.ex5)) - mean(lo.map(o => o.ex5))))
}
const hg = quintile(obs2, 'net5r')
const dg = quintile(obs2, 'dM5')
const spreadOf = g => mean(g[4].map(o => o.ex5)) - mean(g[0].map(o => o.ex5))
/* 半拆分（横截面中位数分高低半）比 Q5−Q1 更抗噪 */
function halfSpread(key, h, subset) {
  const out = []
  for (const [, group] of byDate) {
    const g = group.filter(o => isFinite(o[key]) && isFinite(o['ex' + h]) && (!subset || subset(o)))
    if (g.length < 15) continue
    const s = g.slice().sort((a, b) => a[key] - b[key])
    const hi = s.slice(Math.floor(s.length / 2)), lo = s.slice(0, Math.floor(s.length / 2))
    out.push(mean(hi.map(o => o['ex' + h])) - mean(lo.map(o => o['ex' + h])))
  }
  return mean(out)
}
P('\n  因子极差（Q5−Q1，未来5日超额）：两融余额变化 ' + pc(spreadOf(dg)) + ' ｜ 两融净买入 ' + pc(spreadOf(quintile(obs2, 'n5r')))
  + ' ｜ 主力净额 ' + pc(spreadOf(hg)) + ' ｜ 换手率 ' + pc(spreadOf(quintile(obs2, 'turn'))))
P('  半拆分（高半−低半，逐日计算再平均，更抗噪）未来5日超额：')
P('    5日融资余额变化%   ' + pc(halfSpread('dM5', 5))
  + '\n    5日两融净买入/成交额 ' + pc(halfSpread('n5r', 5))
  + '\n    5日主力净额/成交额  ' + pc(halfSpread('net5r', 5))
  + '\n    换手率             ' + pc(halfSpread('turn', 5)) + '（注意：换手率是当日量能，本身不含未来信息）')

/* ────────── 10. G. 逐股 IC（是否稳健） ────────── */
P('\n══════ G. 逐股 Spearman IC（5日融资余额变化 → 未来5日超额）══════')
const icList = []
const byCode = new Map()
for (const o of obs2) { if (!byCode.has(o.code)) byCode.set(o.code, []); byCode.get(o.code).push(o) }
for (const [code, sub0] of byCode) {
  const sub = sub0
  if (sub.length < 200) continue
  const ic = spearman(sub.map(o => o.dM5), sub.map(o => o.ex5))
  if (isFinite(ic)) icList.push(ic)
}
P('  逐股 IC 均值 ' + f2(mean(icList)) + '，中位 ' + f2(med(icList)) + '，标准差 ' + f2(sd(icList))
  + '，t 值 ' + f2(mean(icList) / (sd(icList) / Math.sqrt(icList.length)))
  + '，同向占比 ' + ((icList.filter(v => v > 0).length / icList.length) * 100).toFixed(1) + '%（' + icList.length + ' 只）')

/* ────────── 11. H. 方向命中率（最直白的「关联性」）────────── */
P('\n══════ H. 方向命中率：融资变化方向 == 未来涨跌方向（超额口径）══════')
function hitRate(name, key, h) {
  const a = obs2.filter(o => isFinite(o[key]) && isFinite(o['ex' + h]))
  const up = a.filter(o => o[key] > 0), dn = a.filter(o => o[key] <= 0)
  const rate = arr => mean(arr.map(o => ((o[key] > 0) === (o['ex' + h] > 0)) ? 1 : 0))
  const baseUp = mean(a.map(o => o['ex' + h] > 0 ? 1 : 0)) * 100
  P('  ' + name.padEnd(38)
    + '方向一致率 ' + (rate(a) * 100).toFixed(1) + '%   '
    + '｜超额上涨占比：基准 ' + baseUp.toFixed(1) + '%  '
    + '融资增段 ' + (up.length ? (mean(up.map(o => o['ex' + h] > 0 ? 1 : 0)) * 100).toFixed(1) + '%' : '—')
    + '  融资减段 ' + (dn.length ? (mean(dn.map(o => o['ex' + h] > 0 ? 1 : 0)) * 100).toFixed(1) + '%' : '—'))
}
hitRate('5日融资余额变化 → 未来5日', 'dM5', 5)
hitRate('20日融资余额变化 → 未来20日', 'dM20', 20)
hitRate('5日两融净买入/成交额 → 未来5日', 'n5r', 5)
hitRate('5日主力净额/成交额 → 未来5日（对照）', 'net5r', 5)
P('  （「方向一致率」基准 50%；「超额上涨占比」要与同行基准比，不是与 50% 比）')

fs.writeFileSync(MD, '# 两融余额 × 涨跌方向 关联性实测\n\n```\n' + out.join('\n') + '\n```\n', 'utf8')
P('\n报告已写 ' + MD)
