/* 方案 C 纯函数单测 + 东财弹性模块解析单测（离线，不发网络） */
const fs = require('fs')
const vm = require('vm')
let pass = 0, fail = 0
function chk(n, ok, ex){ ok ? pass++ : (fail++, console.log('  ❌ ' + n + (ex ? ' → ' + ex : ''))) }

/* --- 加载 c-persistence-study.js 的纯函数（只取函数，不跑 main） --- */
const src = fs.readFileSync(__dirname + '/../stock-alert-cloud/c-persistence-study.js', 'utf8')
const sandbox = { module: { exports: {} }, console, require: () => ({}), process: { argv: [] } }
vm.createContext(sandbox)
/* 去掉 require 依赖：把 em-resilient require 替换为桩 */
const patched = src.replace(/const em = require\('\.\/em-resilient'\)/, 'const em = {}')
vm.runInContext(patched, sandbox, { filename: 'cstudy.js' })
const S = sandbox.module.exports

console.log('==== ladderIntegrity ====')
chk('满梯队 [4,3,2,1] → 1.00', S.ladderIntegrity([4,3,2,1]) === 1)
chk('断层 [4,2,1] → 0.75 (缺3板)', Math.abs(S.ladderIntegrity([4,2,1]) - 0.75) < 1e-9, 'got=' + S.ladderIntegrity([4,2,1]))
chk('只有首板 [1,1,1] → 1', S.ladderIntegrity([1,1,1]) === 1)
chk('高度9但缺多档 [9,1] → 2/9', Math.abs(S.ladderIntegrity([9,1]) - 2/9) < 1e-9)
chk('空数组 → null', S.ladderIntegrity([]) === null)

console.log('==== persistScore ====')
chk('三项全有 → 均值', Math.abs(S.persistScore({sealRate:0.9, ladder:0.6, ztRank:0.3}) - 0.6) < 1e-9)
chk('缺一项 → 只在有值上平均', Math.abs(S.persistScore({sealRate:0.8, ladder:null, ztRank:0.4}) - 0.6) < 1e-9)
chk('全缺 → null', S.persistScore({}) === null)

console.log('==== rank ====')
chk('中位秩', Math.abs(S.rank([10,20,30,40], 25) - 0.5) < 1e-9)
chk('最大值 → 1', S.rank([10,20,30], 30) === 1)
chk('空数组 → null', S.rank([], 5) === null)

/* --- 东财弹性模块：_parse 与 query 组装（不发网络） --- */
console.log('==== em-resilient 纯逻辑 ====')
const emSrc = fs.readFileSync(__dirname + '/../stock-alert-cloud/em-resilient.js', 'utf8')
const sb2 = { module: { exports: {} }, console, require, Date, Math, JSON, Object, Array, String, Number, isFinite, setTimeout, clearTimeout }
vm.createContext(sb2)
vm.runInContext(emSrc, sb2, { filename: 'em.js' })
const EM = sb2.module.exports

chk('JSONP 剥离解析', (() => {
  const j = EM._parse('cb({"rc":0,"data":{"total":3}})')
  return j && j.data && j.data.total === 3
})())
chk('纯 JSON 解析', EM._parse('{"a":1}').a === 1)
chk('坏输入 → null', EM._parse('xxx') === null)
chk('域名池含 push2test 且主域名垫底',
  EM.HOSTS[0].indexOf('push2test') >= 0 && EM.HOSTS[EM.HOSTS.length-1].indexOf('push2.') === 0,
  'first=' + EM.HOSTS[0] + ' last=' + EM.HOSTS[EM.HOSTS.length-1])
chk('query 含 fs/fields/pn', (() => {
  const q = EM.clistQuery('m:0+t:6', 'f12,f14', 2, 100, 'f3', '1')
  return q.indexOf('pn=2') >= 0 && q.indexOf('fields=f12,f14') >= 0 && q.indexOf('fs=m%3A0%2Bt%3A6') >= 0 && q.indexOf('fid=f3') >= 0
})())
chk('冷却：标记后 _alive=false', (() => {
  EM._resetCool(); EM._markDead('x.com'); return EM._alive('x.com') === false
})())

console.log('通过：' + pass + '    失败：' + fail)
console.log(fail === 0 ? '结果：ALL GREEN' : '结果：存在失败项')
process.exit(fail ? 1 : 0)
