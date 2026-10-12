/* 对抗性复检 补丁：把"近年还有没有效应"钉死 + 滚动衰减曲线
 * R6 非重叠 × 分段（早年 2013-2022 / 近年 2023-2026）
 * R7 滚动 2 年（500 交易日）窗口的价差曲线 —— 看衰减发生在何时
 * R8 逐年非重叠（窗口内步长 = 前瞻 H 日）
 */
const fs = require('fs')
const FILE = 'D:/mywork/_tests/_cache/margin-corr2.json'
const MD = 'D:/mywork/_tests/margin-robust2.md'
const out = []
const P = s => { out.push(s); console.log(s) }
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN
const pc = v => isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%' : '—'
const f2 = v => isFinite(v) ? v.toFixed(2) : '—'
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)) }
const onesd = x => sd(x) / Math.sqrt(x.length)
function rollMax(a, w) { const n = a.length, o = new Array(n).fill(NaN), dq = []; let h = 0; for (let i = 0; i < n; i++) { while (dq.length > h && a[dq[dq.length - 1]] <= a[i]) dq.pop(); dq.push(i); while (dq[h] < i - w + 1) h++; if (i >= w - 1) o[i] = a[dq[h]] } return o }

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

function build(W, H) {
  const byDate = new Map()
  for (const s of STK) for (let j = 0; j < s.rows.length; j++) {
    const a = s.dd[W][j], b = s.fw[H][j]
    if (!isFinite(a) || !isFinite(b)) continue
    const d = s.d[j]; let g = byDate.get(d); if (!g) { g = []; byDate.set(d, g) }
    g.push({ dd: a, fw: b })
  }
  return byDate
}
function spreadOfDay(g) {
  if (!g || g.length < 15) return NaN
  const a = g.slice().sort((x, y) => x.dd - y.dd); const k = Math.floor(a.length / 3)
  return mean(a.slice(0, k).map(x => x.fw)) - mean(a.slice(-k).map(x => x.fw))
}
const BY = { '250_60': build(250, 60), '500_60': build(500, 60), '250_20': build(250, 20), '500_120': build(500, 120) }

P('样本：' + STK.length + ' 只，' + allDates.length + ' 个交易日')
P('\n※ 非重叠 = 每 H 个交易日只取 1 天 ⇒ 前瞻窗口不重叠、观测近似独立，t 值是"干净"的')

/* ═══ R6 ═══ */
P('\n╔══════════════════════════════════════════════════════════════════════╗')
P('║ R6. 非重叠 t 值 × 分段：早年(2013-2022) vs 近年(2023-2026)            ║')
P('╚══════════════════════════════════════════════════════════════════════╝')
P('  ' + '规格'.padEnd(11) + '区间'.padEnd(12) + '价差'.padStart(10) + '非重叠t'.padStart(10) + 'N'.padStart(6) + '重叠t(参考)'.padStart(13) + '  判定')
for (const [key, H] of [['250_60', 60], ['500_60', 60], ['250_20', 20], ['500_120', 120]]) {
  const byDate = BY[key]
  for (const [seg, lo, hi] of [['2013-2022', 0, 20221231], ['2023-2026', 20230101, 99999999]]) {
    const ds = allDates.filter(d => d >= lo && d <= hi)
    const full = ds.map(d => spreadOfDay(byDate.get(d))).filter(isFinite)
    const no = ds.filter((_, i) => i % H === 0).map(d => spreadOfDay(byDate.get(d))).filter(isFinite)
    const t = mean(no) / onesd(no)
    P('  ' + key.replace('_', '→').padEnd(11) + seg.padEnd(12) + pc(mean(full)).padStart(10)
      + f2(t).padStart(10) + String(no.length).padStart(6) + f2(mean(full) / onesd(full)).padStart(13)
      + (t > 2 ? '  ✅ 显著' : '  ❌ 不显著'))
  }
}

/* ═══ R7 ═══ */
P('\n╔══════════════════════════════════════════════════════════════════════╗')
P('║ R7. 滚动 2 年（500 交易日）窗口 —— 衰减发生在什么时候                ║')
P('╚══════════════════════════════════════════════════════════════════════╝')
{
  const byDate = BY['250_60']
  const v = allDates.map(d => spreadOfDay(byDate.get(d)))
  const step = 20, win = 500
  P('  ' + '窗口结束日'.padEnd(14) + '价差(2年均值)'.padStart(14) + '  条形')
  for (let i = win; i <= v.length; i += step) {
    const seg = v.slice(i - win, i).filter(isFinite)
    if (seg.length < 200) continue
    const m = mean(seg)
    const bar = m > 0 ? '█'.repeat(Math.min(40, Math.round(m / 0.005))) : '░'.repeat(Math.min(40, Math.round(-m / 0.005)))
    P('  ' + String(allDates[i - 1]).padEnd(14) + pc(m).padStart(14) + '  ' + bar)
  }
}

/* ═══ R8 ═══ */
P('\n╔══════════════════════════════════════════════════════════════════════╗')
P('║ R8. 逐年价差（250→60），并标出该年是否落在"效应期"                  ║')
P('╚══════════════════════════════════════════════════════════════════════╝')
{
  const byDate = BY['250_60']
  const years = [...new Set(allDates.map(d => Math.floor(d / 10000)))].sort()
  for (const y of years) {
    const ds = allDates.filter(d => Math.floor(d / 10000) === y)
    const seg = ds.map(d => spreadOfDay(byDate.get(d))).filter(isFinite)
    if (seg.length < 30) continue
    const bar = mean(seg) > 0 ? '█'.repeat(Math.min(30, Math.round(mean(seg) / 0.005))) : '░'.repeat(Math.min(30, Math.round(-mean(seg) / 0.005)))
    P('  ' + String(y).padEnd(8) + pc(mean(seg)).padStart(10) + '  ' + bar)
  }
}

fs.writeFileSync(MD, '# 对抗性复检（补）\n\n```\n' + out.join('\n') + '\n```\n', 'utf8')
P('\n报告已写 ' + MD)
