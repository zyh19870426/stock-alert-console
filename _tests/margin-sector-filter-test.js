/* 2026-10-13：margin-sector.js 后端「过滤 + 命名」口径回归（纯函数、无网络、确定性夹具）
 * 覆盖四道剔除：① 非题材标签板（前缀 / 关键词包含 / 年份业绩快报）
 *              ② 层级重复（东财同板块的 Ⅱ/Ⅲ 同值双行）
 *              ③ 零星小板块（成分 < MIN_BOARD_MEMBERS）
 *              ④ 无名板块（不在行业/概念分类，无 kind）
 * 以及展示名口语化：aliasOf 映射 + applyAlias 同 tab 重名回退。
 * 依据 = 全量 443 个概念板块 + 333 个行业板块逐条扫描（见 .workbuddy/memory/2026-10-13.md）。
 * 运行：node margin-sector-filter-test.js   （期望 ALL GREEN） */
const path = require('path')
const M = require(path.join(__dirname, '..', 'stock-alert-cloud', 'margin-sector.js'))
let pass = 0, fail = 0
function chk(n, ok, ex) { if (ok) { pass++ } else { fail++; console.log('  ❌ ' + n + (ex ? ' → ' + ex : '')) } }

console.log('==== ① isTagBoard：标签板必须排除 ====')
const TAG = [
  /* 指数 / 通道 */
  '融资融券', '沪股通', '深股通', 'MSCI中国', '富时罗素', '标准普尔',
  '中证500', '中证1000', '深成500', '上证380', '上证180_', '上证50',
  'HS300_', '沪深300', '央视50_', '深证100R', '创业成份', '创业板综', 'AH股',
  /* 持仓 / 榜单 */
  'QFII重仓', '基金重仓', '机构重仓', '社保重仓', '养老金', '券商金股',
  '东方财富热股', '独角兽', '证金持股',
  /* 市值 / 风格 */
  '小盘股', '中盘股', '大盘股', '小盘成长', '中盘价值', '大盘成长',
  '权重股', '科技风格', '周期股', '金融地产风格', '先进制造风格',
  /* 财务 / 行情 / 资质特征（本轮新增） */
  '破净股', '长期破净', '破增发价股', '微利股', '高成长股', '高市净率', '低市净率', '红利破净股',
  '2026中报预增', '2026中报预减', '2026中报扭亏', '2026中报首亏', '2025三季报预增', '2026一季报预减',
  '昨日涨停', '昨日高振幅', '昨日首板', '昨日连板_含一字', '最近多板',
  '题材股', '行业龙头', '股权集中', '股权分散', '股权激励', '股权转让', '举牌',
  '百元股', '低价股', '次新股', '专精特新', '转债标的',
  '参股银行', '参股券商', '参股保险', '参股期货', '参股新三板',
  '茅指数', '宁组合'
]
let bad = 0
for (const n of TAG) if (!M.isTagBoard(n)) { bad++; console.log('  ❌ 应排除却未排除：' + n) }
chk('★ 全部 ' + TAG.length + ' 个标签板均被识别', bad === 0)

console.log('==== ② isTagBoard：真板块零误伤（含区域/政策类，予以保留）====')
const KEEP = [
  /* 真题材 */
  '机器人概念', '人形机器人', '新能源车', '华为概念', '电池技术', '一带一路', '央国企改革',
  '光伏概念', '储能概念', '国产芯片', '军工', '新材料', '通信技术', '深圳特区',
  '智能驾驶', '创新药', '区块链', '算力概念', '中特估', '中字头', '小金属概念',
  '油气资源', '乡村振兴', '大飞机', '可控核聚变', '固态电池', '电网概念',
  '西部大开发', '长江三角', '雄安新区', '海南自贸', '京津冀', '东北振兴',
  '低空经济', '商业航天', '互联网金融', '创投', '节能环保', '液冷服务器',
  'DeepSeek概念', 'AI眼镜', '苹果概念', '存储芯片', '数据中心', '信创',
  /* 真行业 */
  '银行', '半导体', '机械设备', '电子', '医药生物', '电力设备', '非银金融',
  '通信设备', '汽车零部件', '家用电器', '房地产', '农林牧渔', '建筑装饰'
]
let wrong = 0
for (const n of KEEP) if (M.isTagBoard(n)) { wrong++; console.log('  ❌ 误伤真板块：' + n) }
chk('★ 全部 ' + KEEP.length + ' 个真板块均未被误伤', wrong === 0)
chk('★ 空名/undefined 不判为标签板', M.isTagBoard('') === false && M.isTagBoard(null) === false && M.isTagBoard(undefined) === false)
chk('★ 名单非空、无重复项', M.TAG_BOARD_PREFIXES.length > 60 &&
  new Set(M.TAG_BOARD_PREFIXES).size === M.TAG_BOARD_PREFIXES.length &&
  M.TAG_BOARD_WORDS.length > 10 && new Set(M.TAG_BOARD_WORDS).size === M.TAG_BOARD_WORDS.length)

console.log('==== ③ aliasOf：展示名口语化 ====')
const ALIAS = [
  ['印制电路板', 'PCB'], ['光通信模块', '光模块'], ['CPO概念', 'CPO'],
  ['数字芯片设计', '芯片设计'], ['通信网络设备及器件', '通信网络设备'],
  ['证券Ⅲ', '券商'], ['证券Ⅱ', '券商'], ['保险Ⅱ', '保险'], ['白酒Ⅱ', '白酒'],
  ['IT服务Ⅱ', 'IT服务'], ['家用电器', '家电'], ['元件', '电子元件'],
  ['垂直应用软件', '应用软件'], ['车联网(车路云)', '车联网'],
  ['华为概念', '华为'], ['储能概念', '储能'], ['半导体概念', '半导体'],
  ['半导体', '半导体'], ['机器人概念', '机器人'], ['银行', '银行']
]
let aerr = 0
for (const [src, want] of ALIAS) {
  const got = M.aliasOf(src)
  if (got !== want) { aerr++; console.log('  ❌ aliasOf(' + src + ') = ' + got + '，期望 ' + want) }
}
chk('★ 全部 ' + ALIAS.length + ' 条口语化映射正确', aerr === 0)
chk('★ 未命中且无「概念」后缀的名字原样返回', M.aliasOf('低空经济') === '低空经济' && M.aliasOf('') === '')

console.log('==== ④ dedupeHierarchy：层级重复（Ⅱ/Ⅲ 同值双行）====')
const raw4 = [
  { name: '银行', kind: 2, members: 5, rzye: 2000 },
  { name: '银行Ⅱ', kind: 2, members: 5, rzye: 2000 },
  { name: '银行Ⅲ', kind: 2, members: 5, rzye: 2000 },
  { name: '半导体', kind: 2, members: 50, rzye: 5000 },
  { name: '银行', kind: 3, members: 5, rzye: 2000 }
]
const d4 = M.dedupeHierarchy(raw4)
chk('★ 同键同值三条合一（银行 / 银行Ⅱ / 银行Ⅲ）', d4.out.filter(x => x.kind === 2 && x.name.indexOf('银行') === 0).length === 1,
  JSON.stringify(d4.out.map(x => x.name)))
chk('★ 保留名称更短者（银行 优于 银行Ⅱ）', d4.out.some(x => x.kind === 2 && x.name === '银行'))
chk('★ 记录被合并项数（2 条）', d4.dup.length === 2, JSON.stringify(d4.dup))
chk('★ 不同 kind 不误合并（kind=3 的银行保留）', d4.out.filter(x => x.kind === 3).length === 1)
const d5 = M.dedupeHierarchy([
  { name: 'A', kind: 2, members: 5, rzye: 100 },
  { name: 'AⅡ', kind: 2, members: 7, rzye: 100 }
])
chk('★ 成分数不同的同名不合并（真不同板块）', d5.out.length === 2, 'len=' + d5.out.length)

console.log('==== ⑤ buildSectorShares：四道剔除 + 计数 + 别名 ====')
/* 确定性夹具：成分股与金额全部自造，不依赖任何外部数据 */
const members = {}, names = {}, stock = {}
let ci = 0
function add(bk, nm, kind, n, each) {
  const cs = []
  for (let i = 0; i < n; i++) { ci++; const code = String(600000 + ci); cs.push(code); stock[code] = { name: '股' + ci, rzye: each } }
  members[bk] = cs
  if (nm) names[bk] = [nm, kind]
}
add('BK1', '融资融券', 3, 8, 100)        /* 标签板 → ① 排除 */
add('BK2', '2026中报预增', 3, 8, 100)    /* 年份业绩 → ① 排除 */
add('BK3', '参股银行', 3, 8, 100)        /* 关键词包含 → ① 排除 */
add('BK4', '机器人概念', 3, 6, 200)      /* 真题材 1200 → 保留并口语化为「机器人」 */
add('BK5', '银行', 2, 5, 400)            /* 真行业 2000 */
add('BK6', '银行Ⅱ', 2, 5, 400)          /* 与 BK5 同值 → ② 层级重复 */
add('BK7', '微小概念', 3, 3, 50)         /* 真题材但成分 3 < 5 → ③ 零星 */
add('BK9', '医疗器械概念', 3, 6, 100)    /* 口语化后与 BK10 撞名 → 双方回退原名 */
add('BK10', '医疗器械', 3, 6, 100)
ci++; const orphan = String(700000 + ci)
members['BK8'] = [orphan]; stock[orphan] = { name: '孤', rzye: 10 }   /* 无 names 条目 → ④ 无名 */

const TOTAL = 10000
const r = M.buildSectorShares(members, stock, names, TOTAL)
const got = r.sectors.map(s => s.name).sort()
chk('★ 输出恰为 4 条（4 真板块）', r.sectors.length === 4, JSON.stringify(got))
chk('★ 名称已口语化：机器人概念 → 机器人', got.indexOf('机器人') >= 0 && got.indexOf('机器人概念') < 0, JSON.stringify(got))
chk('★ 同值双行只留一条：银行', got.filter(n => n.indexOf('银行') === 0).length === 1, JSON.stringify(got))
chk('★ ① 标签板进 dropped（3 个）', r.dropped.length === 3, JSON.stringify(r.dropped))
chk('★ ② 层级重复进 dupDropped（银行Ⅱ）', r.dupDropped.length === 1 && r.dupDropped[0] === '银行Ⅱ', JSON.stringify(r.dupDropped))
chk('★ ③ 零星小板块进 thinDropped（微小概念）', r.thinDropped.length === 1 && r.thinDropped[0] === '微小概念', JSON.stringify(r.thinDropped))
chk('★ ④ 无名板块被跳过（unnamed=1）', r.unnamed === 1, 'unnamed=' + r.unnamed)
chk('★ 无名板块未产出（无 BK 开头名）', !r.sectors.some(s => /^BK\d+/.test(s.name)))
chk('★ 同 tab 重名 → 双方回退原名', got.indexOf('医疗器械') >= 0 && got.indexOf('医疗器械概念') >= 0, JSON.stringify(got))
chk('★ 每行都带 full（原名可溯源）', r.sectors.every(s => typeof s.full === 'string' && s.full.length > 0))
chk('★ 占比正确（银行 2000/10000=0.2）', Math.abs(r.sectors.find(s => s.name === '银行').sharePct - 0.2) < 1e-9)
chk('★ 降序排列', r.sectors[0].rzye >= r.sectors[r.sectors.length - 1].rzye)
chk('★ kind=2 与 kind=3 都保留', r.sectors.some(s => s.kind === 2) && r.sectors.some(s => s.kind === 3))
chk('★ null stockMap 不崩（--nomargin 路径）', (function () { try { return M.buildSectorShares(members, null, names, 0).sectors.length === 0 } catch (e) { return false } })())
chk('★ 零星下限为 5（可审计常量）', M.MIN_BOARD_MEMBERS === 5, 'MIN=' + M.MIN_BOARD_MEMBERS)

console.log('通过：' + pass + '    失败：' + fail)
console.log(fail === 0 ? '结果：ALL GREEN' : '结果：存在失败项')
process.exit(fail ? 1 : 0)
