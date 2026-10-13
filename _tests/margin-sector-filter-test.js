/* 2026-10-13：margin-sector.js「非题材标签板排除」纯函数回归（无网络、确定性夹具）
 * 背景：东财概念池混有指数/通道/持仓/风格类标签板，成分覆盖全市场 ⇒ 占比霸榜无意义。
 * 依据 = 2026-10-13 存档全量 160 个概念板块逐条核对（见 .workbuddy/memory/2026-10-13.md）。
 * 运行：node margin-sector-filter-test.js   （期望 ALL GREEN） */
const path = require('path')
const M = require(path.join(__dirname, '..', 'stock-alert-cloud', 'margin-sector.js'))
let pass = 0, fail = 0
function chk(n, ok, ex) { if (ok) { pass++ } else { fail++; console.log('  ❌ ' + n + (ex ? ' → ' + ex : '')) } }

console.log('==== ① isTagBoard 名单（应排除）====')
const TAG = [
  '融资融券', '沪股通', '深股通', 'MSCI中国', '富时罗素', '标准普尔',
  '小盘股', '中盘股', '大盘股', '小盘成长', '中盘价值', '大盘成长',
  '破净股', '长期破净', '破增发价股', '微利股', '高成长股', '高市净率',
  '中证500', '中证1000', '深成500', '上证380', '上证180_', '上证50',
  'HS300_', '沪深300', '央视50_', '深证100R', '创业成份', 'AH股',
  'QFII重仓', '基金重仓', '养老金', '券商金股', '东方财富热股', '独角兽',
  '权重股', '科技风格', '周期股', '金融地产风格', '股权集中', '行业龙头',
  '题材股', '最近多板', '昨日涨停', '昨日涨停_含一字', '昨日高振幅',
  '2026中报预减', '2026一季报预增', '2026三季报预增', '茅指数', '宁组合'
]
const KEEP = [
  '机器人概念', '新能源车', '华为概念', '电池技术', '一带一路', '央国企改革',
  '光伏概念', '储能概念', '国产芯片', '军工', '新材料', '通信技术', '深圳特区',
  '智能驾驶', '创新药', '区块链', '算力概念', '中特估', '中字头', '小金属概念',
  '油气资源', '乡村振兴', '大飞机', '可控核聚变', '固态电池', '电网概念',
  '银行', '半导体', '机械设备', '电子', '医药生物', '电力设备'
]
let bad = 0
for (const n of TAG) if (!M.isTagBoard(n)) { bad++; console.log('  ❌ 应排除却未排除：' + n) }
chk('★ 全部 ' + TAG.length + ' 个标签板均被识别', bad === 0)
let wrong = 0
for (const n of KEEP) if (M.isTagBoard(n)) { wrong++; console.log('  ❌ 误伤真题材：' + n) }
chk('★ 全部 ' + KEEP.length + ' 个真题材均未被误伤', wrong === 0)
chk('★ 空名/undefined 不判为标签板', M.isTagBoard('') === false && M.isTagBoard(null) === false && M.isTagBoard(undefined) === false)

console.log('==== ② buildSectorShares 过滤 + 计数 + 占比 ====')
/* 确定性夹具：BK1-3 为标签板，BK4-5 为真板块 */
const members = { BK1: ['600000', '600001'], BK2: ['600002'], BK3: ['600003'], BK4: ['600004', '600005'], BK5: ['600006'] }
const names = { BK1: ['融资融券', 3], BK2: ['小盘股', 3], BK3: ['昨日涨停', 3], BK4: ['机器人概念', 3], BK5: ['银行', 2] }
const stock = {
  '600000': { name: 'A', rzye: 100 }, '600001': { name: 'B', rzye: 100 }, '600002': { name: 'C', rzye: 50 },
  '600003': { name: 'D', rzye: 30 }, '600004': { name: 'E', rzye: 200 }, '600005': { name: 'F', rzye: 200 }, '600006': { name: 'G', rzye: 400 }
}
const r = M.buildSectorShares(members, stock, names, 1000)
const got = r.sectors.map(s => s.name).sort()
chk('★ 只剩真板块（机器人概念 + 银行）', JSON.stringify(got) === JSON.stringify(['机器人概念', '银行']), JSON.stringify(got))
chk('★ dropped 记录 3 个标签板', r.dropped.length === 3, JSON.stringify(r.dropped))
chk('★ 板块占比正确（机器人 400/1000=0.4）', Math.abs(r.sectors.find(s => s.name === '机器人概念').sharePct - 0.4) < 1e-9)
chk('★ 行业 kind=2 与题材 kind=3 都保留', r.sectors.some(s => s.kind === 2) && r.sectors.some(s => s.kind === 3))
chk('★ 降序排列', r.sectors[0].rzye >= r.sectors[r.sectors.length - 1].rzye)
chk('★ null stockMap 不崩（--nomargin 路径）', (function () { try { return M.buildSectorShares(members, null, names, 0).sectors.length === 0 } catch (e) { return false } })())
chk('★ 名单非空、无重复项', Array.isArray(M.TAG_BOARD_PREFIXES) && M.TAG_BOARD_PREFIXES.length > 50 && new Set(M.TAG_BOARD_PREFIXES).size === M.TAG_BOARD_PREFIXES.length)

console.log('通过：' + pass + '    失败：' + fail)
console.log(fail === 0 ? '结果：ALL GREEN' : '结果：存在失败项')
process.exit(fail ? 1 : 0)
