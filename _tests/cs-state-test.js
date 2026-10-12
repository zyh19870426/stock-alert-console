/* 大盘「承接性」状态引擎 单测（离线，DOM 桩，不发网络）
 * 覆盖：三个子维度 + 合成 + 分档 + 分布 + 连续天数 + demo 渲染
 * 运行：node cs-state-test.js   （期望 ALL GREEN） */
const fs = require('fs'), vm = require('vm'), path = require('path')
const HTML = fs.readFileSync(path.join(__dirname, '..', 'stock-alert-console', 'console.html'), 'utf8')

function el(){
  return { _on:{}, style:{}, dataset:{}, _attr:{},
    classList:{ add(){}, remove(){}, contains:()=>false, toggle(){} },
    innerHTML:'', textContent:'', value:'',
    addEventListener(t,fn){ this._on[t]=fn }, removeEventListener(){},
    getAttribute(k){ return this._attr[k] ?? null }, setAttribute(k,v){ this._attr[k]=v },
    querySelectorAll:()=>[], querySelector:()=>null, closest:()=>null,
    appendChild(){}, focus(){}, click(){}, remove(){}, parentNode:null }
}
const els = {}
const doc = { getElementById:id=>els[id]||(els[id]=el()), querySelector:()=>null, querySelectorAll:()=>[],
  addEventListener(){}, createElement:()=>el(), body:el(), documentElement:el(), head:el() }
const sb = { console, document:doc, location:{href:'',search:'',hash:''}, window:null,
  history:{pushState(){},replaceState(){}}, fetch:()=>Promise.reject(new Error('no')),
  XMLHttpRequest:function(){}, setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, isFinite, parseFloat, parseInt,
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}}, sessionStorage:{getItem:()=>null,setItem(){}},
  navigator:{userAgent:'n'}, requestAnimationFrame:()=>0, cancelAnimationFrame(){},
  addEventListener(){}, removeEventListener(){}, getComputedStyle:()=>({}) }
sb.window = sb; sb.globalThis = sb; sb.G = { quoteMap:{} }

const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi
let m, last = null
while((m = re.exec(HTML))) if(m[1].trim().length > (last?last.length:0)) last = m[1]
vm.createContext(sb)
vm.runInContext(last, sb, { filename:'console.main.js' })

let pass = 0, fail = 0
const ck = (n, ok, ex) => { ok ? pass++ : (fail++, console.log('  ❌ ' + n + (ex ? ' → ' + ex : ''))) }

console.log('==== C1 封板质量 ====')
ck('csSealRate 69/(69+14)', Math.abs(sb.csSealRate(69,14) - 69/83) < 1e-9)
ck('csSealRate 无炸板数据 → null', sb.csSealRate(69, null) === null)
ck('csSealRate 零涨停 → null', sb.csSealRate(0, 5) === null)
ck('csSealRate 全封板 → 1', sb.csSealRate(50, 0) === 1)

console.log('==== C2 涨跌宽度 ====')
ck('csBreadth 2600/5400', Math.abs(sb.csBreadth(2600,5400) - 2600/5400) < 1e-9)
ck('csBreadth 越界钳位 ≤1', sb.csBreadth(9999, 100) === 1)
ck('csBreadth 负值钳位 ≥0', sb.csBreadth(-5, 100) === 0)
ck('csBreadth 无总数 → null', sb.csBreadth(100, 0) === null)

console.log('==== C3 量价匹配 ====')
ck('放量涨 → 0.9', sb.csVolPrice(1.2, 1.3) === 0.9)
ck('缩量涨 → 0.6', sb.csVolPrice(0.5, 0.8) === 0.6)
ck('缩量跌 → 0.4', sb.csVolPrice(-0.5, 0.8) === 0.4)
ck('放量跌 → 0.1', sb.csVolPrice(-1.0, 1.3) === 0.1)
ck('缺值 → null', sb.csVolPrice(null, 1.1) === null)

console.log('==== 合成承接分 ====')
ck('csScore 三项等权', Math.abs(sb.csScore({seal:0.9, breadth:0.6, volpx:0.3}) - 0.6) < 1e-9)
ck('csScore 缺一项只在有值上平均', Math.abs(sb.csScore({seal:0.8, breadth:null, volpx:0.4}) - 0.6) < 1e-9)
ck('csScore 全缺 → null', sb.csScore({}) === null)

console.log('==== 分档 ====')
ck('0.66 → 强', sb.csLevel(0.66) === '强')
ck('0.40 → 一般', sb.csLevel(0.40) === '一般')
ck('0.39 → 弱', sb.csLevel(0.39) === '弱')
ck('null → —', sb.csLevel(null) === '—')

console.log('==== 分布 / 连续天数 ====')
const ser = [{level:'强',score:0.8},{level:'强',score:0.7},{level:'一般',score:0.5},{level:'弱',score:0.3},{level:'强',score:0.9}]
const d = sb.csDist(ser)
ck('csDist 强3 一般1 弱1（n=5）', d.strong===3 && d.mid===1 && d.weak===1 && d.n===5, JSON.stringify(d))
ck('csDist 占比合计=1', Math.abs(d.pStrong+d.pMid+d.pWeak - 1) < 1e-9)
ck('csStats 最新=强 连续1（上一条是弱）', sb.csStats(ser).level==='强' && sb.csStats(ser).streak===1)
ck('csStats 连续3日弱 → streak=3',
  sb.csStats([{level:'弱',score:0.2},{level:'弱',score:0.3},{level:'弱',score:0.1}]).streak===3)
ck('csStats 空 → null', sb.csStats([]) === null)

console.log('==== 单日评分整合 ====')
const day = sb.csDayScore(69, 14, {chg:0.8, volRatio:1.15}, {up:2800, total:5400})
ck('csDayScore 三项齐 → 有分有档', day.score != null && ['强','一般','弱'].indexOf(day.level) >= 0, 'score='+day.score)
ck('csDayScore 缺宽度也能算（缩量涨）', sb.csDayScore(50, 10, {chg:0.3, volRatio:0.9}, null).score != null)

console.log('==== demo 渲染 ====')
const demo = sb.demoCsSeries()
ck('demo 序列非空', demo.length > 0)
ck('demo 每项含 level/score/d', demo.every(x => x.level && x.score != null && x.d))
sb.CS.series = demo; sb.CS.day = demo[demo.length-1]; sb.CS.date = demo[demo.length-1].d
sb.CS.stats = sb.csStats(demo); sb.CS.dist = sb.csDist(demo); sb.CS.ok = true
const html = sb.csHtml()
ck('csHtml 含「大盘承接性 · 状态」', /大盘承接性 · 状态/.test(html))
ck('csHtml 含「不构成任何方向判断」', /不构成任何方向判断/.test(html))
ck('csHtml 含状态分布（强/一般/弱）', /强 /.test(html) && /一般 /.test(html) && /弱 /.test(html))
ck('csHtml 无方向禁词（要涨/要跌/可买/该躲）', !/要涨|要跌|可买|该躲/.test(html))

console.log('通过：' + pass + '    失败：' + fail)
console.log(fail === 0 ? '结果：ALL GREEN' : '结果：存在失败项')
process.exit(fail ? 1 : 0)
