/* 「两融出清触底 / 暴增过热」在【大盘】成立、在【个股】不成立吗？—— 同一口径双尺度对照
 *
 * 上一轮（margin-corr.js）测的是【横截面】：同一天把股票互相排序。
 * 而"出清触底反弹 / 暴增过热回调"说的是【时序 + 极值】：同一个标的自己跟自己比，看极端状态之后会怎样。
 * 这是两件不同的事 —— 本脚本用【完全相同的特征定义】在两个尺度上各跑一遍。
 *
 * 市场级：东财 RPTA_RZRQ_LSHJ（沪深300 + 两市融资余额 + 融资余额占流通市值比），2010-03 ~ 2026-09
 * 个股级：_tests/_cache/margin-corr.json（131 只，2022-08 ~ 2026-08）
 *
 * 特征（两尺度同名同义）：
 *   dd250   融资余额 / 近250日最高余额 − 1   ≤0，越负 = 去杠杆/出清越彻底
 *   up250   融资余额 / 近250日最低余额 − 1   ≥0，越大 = 加杠杆越猛
 *   levPct  杠杆率（余额/流通市值）在近750日的分位
 *
 * 目标：未来 H 日的【原始收益】（"触底反弹"说的是绝对涨跌，不是相对强弱）
 */
const fs = require('fs')
const MKT = 'D:/mywork/_tests/_cache/mkt-rzrq.json'
const STK = 'D:/mywork/_tests/_cache/margin-corr.json'
const MD = 'D:/mywork/_tests/mkt-margin-cycle.md'
const out = []
const P = s => { out.push(s); console.log(s) }

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN
const med = a => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const pc = v => isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%' : '—'
const hit = a => a.length ? (a.filter(v => v > 0).length / a.length * 100).toFixed(1) + '%' : '—'

/* ─────────── 特征计算（给定余额序列 + 杠杆率序列）─────────── */
function feats(ye, lev, i) {
  const w250 = ye.slice(Math.max(0, i - 249), i + 1)
  const max250 = Math.max(...w250), min250 = Math.min(...w250)
  const w750 = lev.slice(Math.max(0, i - 749), i + 1).filter(isFinite)
  const cur = lev[i]
  const levPct = (w750.length >= 120 && isFinite(cur))
    ? w750.filter(v => v <= cur).length / w750.length : NaN
  return {
    dd250: max250 > 0 ? ye[i] / max250 - 1 : NaN,
    up250: min250 > 0 ? ye[i] / min250 - 1 : NaN,
    levPct
  }
}

/* ─────────── 分桶统计 ─────────── */
function bucket2(list, key, edges, labels, h) {
  return labels.map((l, k) => {
    const lo = edges[k], hi = edges[k + 1]
    const g = list.filter(o => isFinite(o.f[key]) && isFinite(o.fw[h]) && o.f[key] >= lo && o.f[key] < hi)
    return { n: g.length, ex: mean(g.map(o => o.fw[h])), hit: g.length ? g.filter(o => o.fw[h] > 0).length / g.length : NaN }
  })
}
function showBucket(title, rows, labels, base) {
  P('  ' + title)
  P('    ' + '区间'.padEnd(10) + labels.map(l => l.padStart(13)).join('') + '全样本基准'.padStart(13))
  P('    ' + '样本数'.padEnd(9) + rows.map(r => String(r.n).padStart(13)).join('') + String(base.n).padStart(13))
  P('    ' + '未来收益'.padEnd(9) + rows.map(r => pc(r.ex).padStart(13)).join('') + pc(base.ex).padStart(13))
  P('    ' + '上涨占比'.padEnd(9) + rows.map(r => (isFinite(r.hit) ? (r.hit * 100).toFixed(1) + '%' : '—').padStart(13)).join('')
    + (isFinite(base.hit) ? (base.hit * 100).toFixed(1) + '%' : '—').padStart(13))
}

/* ═══════════════ 1. 市场级（沪深300）═══════════════ */
P('═══════════════════════════════════════════════════════════')
P('一、市场级：两市融资余额的杠杆周期 → 沪深300 未来收益')
P('═══════════════════════════════════════════════════════════')
const mk = JSON.parse(fs.readFileSync(MKT, 'utf8')).rows
  .filter(r => r.d >= '2013-01-01' && isFinite(r.rzye) && isFinite(r.idx) && r.idx > 0 && isFinite(r.rzb))
P('样本 ' + mk.length + ' 个交易日（' + mk[0].d + ' ~ ' + mk[mk.length - 1].d + '，起于两融规模成型后）')
P('融资余额 ' + (mk[0].rzye / 1e8).toFixed(0) + ' 亿 → ' + (mk[mk.length - 1].rzye / 1e8).toFixed(0) + ' 亿；'
  + '杠杆率 ' + mk[0].rzb.toFixed(2) + '% → ' + mk[mk.length - 1].rzb.toFixed(2) + '%')

const HS = [20, 60, 120]
const mObs = []
{
  const ye = mk.map(r => r.rzye), lev = mk.map(r => r.rzb), idx = mk.map(r => r.idx)
  for (let i = 250; i < mk.length; i++) {
    const f = feats(ye, lev, i)
    const fw = {}
    let ok = true
    for (const h of HS) { const j = i + h; if (j >= mk.length) { ok = false; break } fw[h] = idx[j] / idx[i] - 1 }
    if (!ok) continue
    mObs.push({ d: mk[i].d, f, fw })
  }
}
P('可用观测 ' + mObs.length + '\n')

const LAB_DD = ['≤−30%（出清彻底）', '−30~−20%', '−20~−10%', '−10~0%']
const LAB_UP = ['<10%（基本没加）', '10~30%', '30~60%', '≥60%（暴增）']
const LAB_LV = ['<10%分位（极低）', '10~30%', '30~70%', '70~90%', '>90%分位（极高）']
for (const h of HS) {
  P('── 未来 ' + h + ' 日 ──')
  const base = { n: mObs.filter(o => isFinite(o.fw[h])).length, ex: mean(mObs.map(o => o.fw[h])), hit: mObs.filter(o => o.fw[h] > 0).length / mObs.length }
  showBucket('① 出清程度 dd250（余额距近250日高点的回撤）', bucket2(mObs, 'dd250', [-1, -0.30, -0.20, -0.10, 1], LAB_DD, h), LAB_DD, base)
  showBucket('② 加杠杆幅度 up250（余额距近250日低点的涨幅）', bucket2(mObs, 'up250', [0, 0.10, 0.30, 0.60, 9], LAB_UP, h), LAB_UP, base)
  showBucket('③ 杠杆率分位 levPct（近750日）', bucket2(mObs, 'levPct', [0, 0.10, 0.30, 0.70, 0.90, 1.01], LAB_LV, h), LAB_LV, base)
  P('')
}

/* 非重叠抽样（防重叠观测夸大显著性）*/
P('★ 剔除重叠：未来60日按每 60 个交易日抽 1 个（互不重叠）重算')
{
  const h = 60
  const s = mObs.filter((o, i) => i % 60 === 0 && isFinite(o.fw[h]))
  const base = { n: s.length, ex: mean(s.map(o => o.fw[h])), hit: s.filter(o => o.fw[h] > 0).length / s.length }
  P('  非重叠样本 ' + s.length + ' 个')
  showBucket('① 出清程度 dd250 → 未来60日', bucket2(s, 'dd250', [-1, -0.30, -0.20, -0.10, 1], LAB_DD, h), LAB_DD, base)
  showBucket('③ 杠杆率分位 levPct → 未来60日', bucket2(s, 'levPct', [0, 0.10, 0.30, 0.70, 0.90, 1.01], LAB_LV, h), LAB_LV, base)
}

/* 历史极值点回看 */
P('\n★ 历史极值点回看（验证"出清触底 / 暴增见顶"是否真有案例）')
{
  const r = mk
  const peak = i => { const w = r.slice(Math.max(0, i - 249), i + 1).map(x => x.rzye); return r[i].rzye >= Math.max(...w) }
  const trough = i => { const w = r.slice(Math.max(0, i - 249), i + 1).map(x => x.rzye); return r[i].rzye <= Math.min(...w) }
  const evs = []
  for (let i = 250; i < r.length - 1; i++) {
    if (i % 20) continue
    if (peak(i) && r[i].rzb >= 2.5) evs.push({ d: r[i].d, t: '杠杆率新高', rzb: r[i].rzb, f60: r[Math.min(r.length - 1, i + 60)] ? r[Math.min(r.length - 1, i + 60)].idx / r[i].idx - 1 : NaN })
    if (trough(i) && r[i].rzb <= 2.0) evs.push({ d: r[i].d, t: '杠杆率新低', rzb: r[i].rzb, f60: r[Math.min(r.length - 1, i + 60)] ? r[Math.min(r.length - 1, i + 60)].idx / r[i].idx - 1 : NaN })
  }
  const seen = new Set()
  const uniq = evs.filter(e => { const k = e.t + e.d.slice(0, 7); if (seen.has(k)) return false; seen.add(k); return true })
  P('  杠杆率新高事件（余额创250日新高 且 杠杆率≥2.5%）→ 之后60日沪深300：')
  uniq.filter(e => e.t === '杠杆率新高').forEach(e => P('    ' + e.d + '  杠杆率 ' + e.rzb.toFixed(2) + '%  →  +60日 ' + pc(e.f60)))
  P('  杠杆率新低事件（余额创250日新低 且 杠杆率≤2.0%）→ 之后60日沪深300：')
  uniq.filter(e => e.t === '杠杆率新低').forEach(e => P('    ' + e.d + '  杠杆率 ' + e.rzb.toFixed(2) + '%  →  +60日 ' + pc(e.f60)))
}

/* ═══════════════ 2. 个股级（同一套特征定义）═══════════════ */
P('\n═══════════════════════════════════════════════════════════')
P('二、个股级：同一套特征、同一套目标（131 只）')
P('═══════════════════════════════════════════════════════════')
const db = JSON.parse(fs.readFileSync(STK, 'utf8'))
const sObs = []
const byDate = new Map()
for (const code of Object.keys(db.stocks)) {
  const st = db.stocks[code]
  const fmap = new Map(); for (const r of st.f) fmap.set(r[0], r)
  const rows = []
  for (const r of st.m) { const p = fmap.get(r[0]); if (!p) continue; rows.push({ d: r[0], ye: r[1], c: p[1], turn: p[3], amt: p[5] }) }
  if (rows.length < 300) continue
  const ye = rows.map(r => r.ye)
  const lev = rows.map(r => { const mc = r.amt / (r.turn || NaN); return (isFinite(mc) && mc > 0) ? r.ye / mc * 100 : NaN })   // 杠杆率 %
  const close = rows.map(r => r.c)
  for (let i = 250; i < rows.length - 121; i++) {
    const f = feats(ye, lev, i)
    const c0 = rows[i].c
    const fw = {}
    for (const h of [20, 60, 120]) { const j = i + h; fw[h] = (j < rows.length && isFinite(close[j])) ? close[j] / c0 - 1 : NaN }
    const o = { code, d: rows[i].d, f, fw, fwe: {} }
    sObs.push(o)
    if (!byDate.has(o.d)) byDate.set(o.d, []); byDate.get(o.d).push(o)
  }
}
for (const [, g] of byDate) {
  for (const h of [20, 60, 120]) {
    const v = g.map(o => o.fw[h]).filter(isFinite)
    if (v.length < 15) continue
    const mu = mean(v)
    for (const o of g) o.fwe[h] = o.fw[h] - mu
  }
}
const sObs2 = sObs.filter(o => byDate.get(o.d).length >= 15)
P('可用观测 ' + sObs2.length + '\n')
for (const h of [20, 60, 120]) {
  P('── 未来 ' + h + ' 日（原始收益）──')
  const base = { n: sObs2.filter(o => isFinite(o.fw[h])).length, ex: mean(sObs2.map(o => o.fw[h])), hit: sObs2.filter(o => o.fw[h] > 0).length / sObs2.length }
  showBucket('① 出清程度 dd250', bucket2(sObs2, 'dd250', [-1, -0.30, -0.20, -0.10, 1], LAB_DD, h), LAB_DD, base)
  showBucket('② 加杠杆幅度 up250', bucket2(sObs2, 'up250', [0, 0.10, 0.30, 0.60, 9], LAB_UP, h), LAB_UP, base)
  showBucket('③ 杠杆率分位 levPct', bucket2(sObs2, 'levPct', [0, 0.10, 0.30, 0.70, 0.90, 1.01], LAB_LV, h), LAB_LV, base)
  P('')
}

/* ═══════════════ 3. 同口径并排对照 ═══════════════ */
P('═══════════════════════════════════════════════════════════')
P('三、并排对照：同一个规则，大盘 vs 个股（未来60日原始收益）')
P('═══════════════════════════════════════════════════════════')
{
  const h = 60
  const m = mObs.filter(o => isFinite(o.fw[h]))
  const s = sObs2.filter(o => isFinite(o.fw[h]))
  const mBase = mean(m.map(o => o.fw[h])), sBase = mean(s.map(o => o.fw[h]))
  const g = (list, key, lo, hi) => mean(list.filter(o => isFinite(o.f[key]) && o.f[key] >= lo && o.f[key] < hi).map(o => o.fw[h]))
  const n = (list, key, lo, hi) => list.filter(o => isFinite(o.f[key]) && o.f[key] >= lo && o.f[key] < hi).length
  P('  ' + '状态'.padEnd(30) + '大盘(沪深300)'.padStart(16) + 'n'.padStart(8) + '个股(131只)'.padStart(16) + 'n'.padStart(10))
  const ROWS = [
    ['出清彻底 dd250 ≤ −30%', 'dd250', -1, -0.30],
    ['出清中 dd250 −30~−20%', 'dd250', -0.30, -0.20],
    ['几乎没加杠杆 up250 < 10%', 'up250', 0, 0.10],
    ['加杠杆猛 up250 ≥ 60%', 'up250', 0.60, 9],
    ['杠杆率极低分位 <10%', 'levPct', 0, 0.10],
    ['杠杆率极高分位 >90%', 'levPct', 0.90, 1.01]
  ]
  for (const [nm, k, lo, hi] of ROWS) {
    P('  ' + nm.padEnd(30) + pc(g(m, k, lo, hi)).padStart(16) + String(n(m, k, lo, hi)).padStart(8)
      + pc(g(s, k, lo, hi)).padStart(16) + String(n(s, k, lo, hi)).padStart(10))
  }
  P('  ' + '【全样本基准】'.padEnd(28) + pc(mBase).padStart(16) + String(m.length).padStart(8) + pc(sBase).padStart(16) + String(s.length).padStart(10))
}

fs.writeFileSync(MD, '# 两融"出清触底 / 暴增过热"：大盘 vs 个股（同口径对照）\n\n```\n' + out.join('\n') + '\n```\n', 'utf8')
P('\n报告已写 ' + MD)
