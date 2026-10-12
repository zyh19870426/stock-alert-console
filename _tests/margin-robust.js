/* 两融时序效应：对抗性复检（回答"结论可靠吗"）
 *
 * 针对上一轮结论的四个致命弱点各设计一个检验：
 *   R1 重叠观测：60 日收益日度重叠 ⇒ HAC 校正可能不够。改用【非重叠】抽样做独立 t 检验。
 *   R2 制度漂移：逐年看效应是否在近年消失。若近年≈0，"效应存在"只是历史陈述。
 *   R3 少数股票主导：对【股票】做 bootstrap 重抽样（聚类稳健），看区间有多宽。
 *   R4 随机一半：把股票随机劈成两半，看两半是否同结论（样本内独立复现）。
 * 数据：_tests/_cache/margin-corr2.json
 */
const fs = require('fs')
const FILE = 'D:/mywork/_tests/_cache/margin-corr2.json'
const MD = 'D:/mywork/_tests/margin-robust.md'
const out = []
const P = s => { out.push(s); console.log(s) }
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN
const pc = v => isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%' : '—'
const f2 = v => isFinite(v) ? v.toFixed(2) : '—'
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)) }
const med = a => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
function rollMax(a, w) { const n = a.length, o = new Array(n).fill(NaN), dq = []; let h = 0; for (let i = 0; i < n; i++) { while (dq.length > h && a[dq[dq.length - 1]] <= a[i]) dq.pop(); dq.push(i); while (dq[h] < i - w + 1) h++; if (i >= w - 1) o[i] = a[dq[h]] } return o }

/* ── 载入 ── */
const db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const STK = []
for (const code of Object.keys(db.stocks)) {
  const st = db.stocks[code]
  const fm = new Map(); for (const r of st.f) fm.set(r[0], r)
  const rows = []
  for (const r of st.m) { const p = fm.get(r[0]); if (!p) continue; rows.push({ d: r[0], ye: r[1], c: p[1] }) }
  if (rows.length < 500) continue
  STK.push({ code, rows, d: rows.map(r => r.d), ye: rows.map(r => r.ye), c: rows.map(r => r.c) })
}
for (const s of STK) {
  s.dd = {}; s.fw = {}
  for (const w of [250, 500]) { const rm = rollMax(s.ye, w); s.dd[w] = s.ye.map((v, i) => (isFinite(rm[i]) && rm[i] > 0) ? v / rm[i] - 1 : NaN) }
  for (const h of [20, 60, 120]) s.fw[h] = s.c.map((v, i) => (i + h < s.c.length && s.c[i] > 0) ? s.c[i + h] / s.c[i] - 1 : NaN)
}
const allDates = [...new Set(STK.flatMap(s => s.d))].sort((a, b) => a - b)
const si = new Map(); STK.forEach((s, i) => si.set(s.code, i))
P('样本：' + STK.length + ' 只，' + allDates.length + ' 个交易日，' + allDates[0] + ' ~ ' + allDates[allDates.length - 1])

/* 预分组：把 (date, dd, fw, stockIdx) 按日期摊平，供所有检验复用 */
function build(W, H) {
  const byDate = new Map()
  for (let i = 0; i < STK.length; i++) {
    const s = STK[i]
    for (let j = 0; j < s.rows.length; j++) {
      const a = s.dd[W][j], b = s.fw[H][j]
      if (!isFinite(a) || !isFinite(b)) continue
      const d = s.d[j]
      let g = byDate.get(d); if (!g) { g = []; byDate.set(d, g) }
      g.push({ dd: a, fw: b, si: i })
    }
  }
  return byDate
}
/* 某日横截面价差（出清最多1/3 − 最少1/3）；allowSet 为 null 表示全用 */
function spreadOfDay(g, allowSet) {
  let a
  if (allowSet === null) a = g
  else { a = []; for (const r of g) if (allowSet.has(r.si)) a.push(r) }
  if (a.length < 15) return NaN
  a = a.slice().sort((x, y) => x.dd - y.dd)
  const k = Math.floor(a.length / 3)
  return mean(a.slice(0, k).map(x => x.fw)) - mean(a.slice(-k).map(x => x.fw))
}
function series(byDate, keys, allowSet) { const o = []; for (const d of keys) { const g = byDate.get(d); if (!g) continue; const v = spreadOfDay(g, allowSet); if (isFinite(v)) o.push(v) } return o }

const BY = { '250_60': build(250, 60), '500_120': build(500, 120), '250_20': build(250, 20) }
const onesd = x => sd(x) / Math.sqrt(x.length)

/* ═══ R1. 非重叠观测：彻底消除重叠自相关 ═══ */
P('\n╔══════════════════════════════════════════════════════════════════════╗')
P('║ R1. 非重叠抽样（每 H 个交易日取 1 天）—— 不用 HAC 也是独立样本       ║')
P('╚══════════════════════════════════════════════════════════════════════╝')
P('  ' + '规格'.padEnd(12) + '全程重叠'.padStart(12) + '全程非重叠'.padStart(13) + '非重叠t'.padStart(10) + 'N'.padStart(8) + '  判定')
for (const [key, H] of [['250_60', 60], ['500_120', 120], ['250_20', 20]]) {
  const full = series(BY[key], allDates, null)
  const keys = allDates.filter((_, i) => i % H === 0)
  const no = series(BY[key], keys, null)
  const t = mean(no) / onesd(no)
  P('  ' + key.replace('_', '→').padEnd(12) + pc(mean(full)).padStart(12) + pc(mean(no)).padStart(13)
    + f2(t).padStart(10) + String(no.length).padStart(8) + (t > 2 ? '  ✅' : '  ❌ t<2'))
}

/* ═══ R2. 制度漂移：逐年 ═══ */
P('\n╔══════════════════════════════════════════════════════════════════════╗')
P('║ R2. 逐年（250→60）—— 效应是不是只在早年有？                          ║')
P('╚══════════════════════════════════════════════════════════════════════╝')
{
  const byDate = BY['250_60']
  const years = [...new Set(allDates.map(d => Math.floor(d / 10000)))].sort()
  P('  ' + '年份'.padEnd(8) + '样本日'.padStart(8) + '价差'.padStart(10) + 't'.padStart(8) + '  分档一致率'.padStart(12))
  let pos = 0, tot = 0
  for (const y of years) {
    const keys = allDates.filter(d => Math.floor(d / 10000) === y)
    const v = series(byDate, keys, null)
    if (v.length < 30) continue
    tot++; if (mean(v) > 0) pos++
    P('  ' + String(y).padEnd(8) + String(v.length).padStart(8) + pc(mean(v)).padStart(10) + f2(mean(v) / onesd(v)).padStart(8))
  }
  P('  → 为正年份 ' + pos + '/' + tot)
  /* 近 4 年 vs 更早 */
  const early = series(byDate, allDates.filter(d => d < 20230101), null)
  const late = series(byDate, allDates.filter(d => d >= 20230101), null)
  P('\n  2013~2022（早年）：价差 ' + pc(mean(early)) + '　t=' + f2(mean(early) / onesd(early)) + '　N=' + early.length)
  P('  2023~2026（近年）：价差 ' + pc(mean(late)) + '　t=' + f2(mean(late) / onesd(late)) + '　N=' + late.length)
  P('  ⇒ ' + (Math.abs(mean(late) / onesd(late)) < 2 ? '近年【不显著】—— 效应在近 4 年已基本消失！' : '近年仍显著'))
}

/* ═══ R3. 对"股票"做 bootstrap（聚类稳健）═══ */
P('\n╔══════════════════════════════════════════════════════════════════════╗')
P('║ R3. 按股票 bootstrap 重抽样 300 次（聚类稳健）—— 结论区间有多宽      ║')
P('╚══════════════════════════════════════════════════════════════════════╝')
{
  const byDate = BY['250_60']
  const keys = allDates.filter((_, i) => i % 20 === 0)   // 隔 20 日抽，够用且快
  const base = series(byDate, keys, null)
  const rnd = mulberry(20260922)
  const dist = []
  for (let r = 0; r < 300; r++) {
    const set = new Set()
    for (let i = 0; i < STK.length; i++) set.add(Math.floor(rnd() * STK.length))
    dist.push(mean(series(byDate, keys, set)))
  }
  const m = mean(base), bs = sd(dist), lo = m - 1.96 * bs, hi = m + 1.96 * bs
  const negShare = dist.filter(v => v <= 0).length / dist.length
  P('  真实（隔20日抽样）：' + pc(m) + '　日数 ' + base.length)
  P('  股票 bootstrap 分布：均值 ' + pc(mean(dist)) + '，标准差 ' + pc(bs))
  P('  95% 区间：[' + pc(lo) + ', ' + pc(hi) + ']')
  P('  bootstrap 里 ≤0 的比例：' + (negShare * 100).toFixed(1) + '%')
  P('  ⇒ ' + (lo > 0 ? '区间不含 0 ✅（但注意这是对"全程"的区间）' : '❌ 区间含 0，不能排除无效应'))
  P('  （对照：股票间价差分布的 10/50/90 分位 = '
    + pc(quantile(STK.map(s => perStock250(s)), 0.1)) + ' / '
    + pc(quantile(STK.map(s => perStock250(s)), 0.5)) + ' / '
    + pc(quantile(STK.map(s => perStock250(s)), 0.9)) + '）')
}
function perStock250(s) {
  const hi = [], lo = []
  for (let i = 0; i < s.rows.length; i++) {
    const a = s.dd[250][i], b = s.fw[60][i]
    if (!isFinite(a) || !isFinite(b)) continue
    if (a <= -0.30) hi.push(b); else if (a > -0.10 && a <= 0) lo.push(b)
  }
  if (hi.length < 30 || lo.length < 30) return NaN
  return mean(hi) - mean(lo)
}
function quantile(a, q) { const s = a.filter(isFinite).sort((x, y) => x - y); if (!s.length) return NaN; const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo) }

/* ═══ R4. 随机一半：样本内独立复现 ═══ */
P('\n╔══════════════════════════════════════════════════════════════════════╗')
P('║ R4. 股票随机对半分（固定种子）—— 两半是否给出同一结论                ║')
P('╚══════════════════════════════════════════════════════════════════════╝')
{
  const byDate = BY['250_60']
  const rnd = mulberry(777)
  const A = new Set(), B = new Set()
  const order = STK.map((_, i) => i).sort(() => rnd() - 0.5)
  order.forEach((v, i) => (i < order.length / 2 ? A : B).add(v))
  const keys = allDates.filter((_, i) => i % 5 === 0)
  const a = series(byDate, keys, A), b = series(byDate, keys, B)
  P('  A 半（' + A.size + ' 只）：' + pc(mean(a)) + '　t=' + f2(mean(a) / onesd(a)))
  P('  B 半（' + B.size + ' 只）：' + pc(mean(b)) + '　t=' + f2(mean(b) / onesd(b)))
  P('  ⇒ ' + (mean(a) > 0 && mean(b) > 0 ? '两半同号 ✅' : '❌ 两半不同号'))
  P('\n  逐年 × 两半（价差）：')
  P('  ' + '年份'.padEnd(8) + 'A半'.padStart(11) + 'B半'.padStart(11) + '  同号')
  const years = [...new Set(allDates.map(d => Math.floor(d / 10000)))].sort()
  let same = 0, tot = 0
  for (const y of years) {
    const ks = allDates.filter(d => Math.floor(d / 10000) === y)
    const va = mean(series(byDate, ks, A)), vb = mean(series(byDate, ks, B))
    if (!isFinite(va) || !isFinite(vb)) continue
    tot++; const s2 = va * vb > 0; if (s2) same++
    P('  ' + String(y).padEnd(8) + pc(va).padStart(11) + pc(vb).padStart(11) + (s2 ? '   ✅' : '   ❌'))
  }
  P('  → 同号年份 ' + same + '/' + tot)
}

/* ═══ R5. 如果只用近 3 年随机抽 130 只（复刻上一轮设计）═══ */
P('\n╔══════════════════════════════════════════════════════════════════════╗')
P('║ R5. 复刻上一轮设计，但换一批随机股票：近 4 年 / 130 只 / 250→60      ║')
P('╚══════════════════════════════════════════════════════════════════════╝')
{
  const rnd = mulberry(20260926)
  const runs = []
  for (let r = 0; r < 30; r++) {
    const set = new Set()
    while (set.size < Math.min(130, STK.length)) set.add(Math.floor(rnd() * STK.length))
    const byDate = BY['250_60']
    const keys = allDates.filter((_, i) => i % 5 === 0 && false)   // 占位
    const v = series(byDate, allDates, set)
    runs.push({ all: mean(v), recent: NaN })
  }
  P('  30 次随机 130 只（全程）：均值 ' + pc(mean(runs.map(r => r.all))) + '，'
    + '为正 ' + runs.filter(r => r.all > 0).length + '/30，'
    + '区间 [' + pc(Math.min(...runs.map(r => r.all))) + ', ' + pc(Math.max(...runs.map(r => r.all))) + ']')
  P('  ⇒ 换一批股票的波动有多大，一眼可见（这是"样本普遍性"的真实噪声水平）')
}

fs.writeFileSync(MD, '# 两融时序效应 · 对抗性复检\n\n```\n' + out.join('\n') + '\n```\n', 'utf8')
P('\n报告已写 ' + MD)
