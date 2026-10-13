/* ============================================================================
 * flow-fresh-test.js —— 资金流「取数新鲜度 + 刷新时间显示」回归
 *
 * 背景（2026-10-13 用户报「线上资金流入流出不是最新」）：
 *   上一版三源纯竞速（谁先到用谁）实测必然由 jsDelivr 获胜（588ms vs API 9673ms），
 *   而 jsDelivr 带 12h CDN 缓存（实测 Age=11508s）⇒ 页面永远停在 3 小时前的旧存档。
 *   本测试锁定修复后的行为契约：
 *     ① 权威源（API/raw，无 CDN）先到 → 直接用，不产生冗余回调
 *     ② 兜底源（jsDelivr）先到 → 先交付（保首屏速度），权威源到达且更新 → 覆盖 + 回调重渲
 *     ③ 权威源更旧 → 不覆盖（杜绝数据倒退）
 *     ④ 全部源失败 → reject（不静默吞掉）
 *     ⑤ 并发调用共享同一次请求（首页 + 资金流页同时触发时只发一轮）
 *     ⑥ 3 分钟内走进程内缓存，不再发请求
 *
 * 范式说明：本环境 jsdom 不可用（new JSDOM 后 setTimeout 永不触发、测试恒无输出）。
 *   故此处走「纯源码抽取 + 纯函数」：从 console.html 抠出取数核心段，在 vm 里跑，
 *   fngFetch 全程 mock。不依赖 DOM、不依赖网络。
 * 运行：node _tests/flow-fresh-test.js
 * ========================================================================== */
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.resolve(__dirname, '..')
const HTML = path.join(ROOT, 'stock-alert-console', 'console.html')

let pass = 0, fail = 0
function ok(cond, msg){
  if(cond){ pass++; return true }
  fail++
  console.log('     ✗ ' + msg)
  return false
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

/* ---------- 1. 抽取被测源码 ---------- */
const html = fs.readFileSync(HTML, 'utf8')
const A = html.indexOf('/* 云端存档：**权威源优先')
const B = html.indexOf('/* 主算：mode 板块集合')
if(A < 0 || B < 0 || B <= A){
  console.log('★ 抽取失败：锚点未命中（A=' + A + ' B=' + B + '）—— 源码结构可能已改，请更新锚点')
  process.exit(1)
}
const core = html.slice(A, B)
if(core.indexOf('flowCloudRaw') < 0 || core.indexOf('flowFreshSuffix') < 0){
  console.log('★ 抽取内容不完整：缺少 flowCloudRaw 或 flowFreshSuffix')
  process.exit(1)
}
console.log('已抽取取数核心段：' + core.length + ' 字节\n')

/* ---------- 2. mock 环境 ---------- */
let PLAN = {}            // { api:{delay,data} | {fail:true,delay}, raw:..., jsd:... }
let calls = []
const sandbox = {
  console,
  setTimeout, clearTimeout,
  FLOW: { cloudRaw:null, cloudAt:0, cloudSrc:'', cloudUp:'', cloudLocal:'', cloudP:null, cloudWatchers:[] },
  b64ToUtf8: s => Buffer.from(String(s), 'base64').toString('utf8'),
  fngFetch: function(url, opt, timeout){
    const key = url.indexOf('api.github.com') >= 0 ? 'api'
              : url.indexOf('raw.githubusercontent') >= 0 ? 'raw' : 'jsd'
    calls.push(key)
    const p = PLAN[key] || { fail:true, delay:1 }
    return new Promise(function(res, rej){
      setTimeout(function(){
        if(p.fail) return rej(new Error('mock:' + key + ' failed'))
        res({ ok:true, status:200, json: function(){ return Promise.resolve(p.data) } })
      }, p.delay == null ? 1 : p.delay)
    })
  }
}
sandbox.window = sandbox
vm.createContext(sandbox)
vm.runInContext(core, sandbox, { filename:'flow-core.js' })
const G = sandbox
console.log('取数核心已载入 vm 上下文\n')

/* ---------- 3. 夹具（自带确定性截面，不吃页面内嵌快照） ---------- */
function mkFlow(updated, ndays){
  const days = []
  for(let i = 0; i < ndays; i++){
    days.push({ d: '2026-10-' + String(i + 1).padStart(2, '0'), ind:{}, con:{} })
  }
  return { names:{ BK0001:['测试板块', 3] }, days:days, updated:updated, mon:{ month:'2026-10', nTrade:ndays } }
}
function reset(){
  G.FLOW.cloudRaw = null; G.FLOW.cloudAt = 0; G.FLOW.cloudSrc = ''
  G.FLOW.cloudUp = ''; G.FLOW.cloudLocal = ''; G.FLOW.cloudP = null; G.FLOW.cloudWatchers = []
  calls = []
}
async function scene(name, plan, fn){
  PLAN = plan
  reset()
  console.log('· ' + name)
  try{ await fn() }
  catch(e){ fail++; console.log('     ✗ 异常中断：' + (e && e.message)) }
}

;(async function main(){

  /* ===== 一、纯函数 ===== */
  console.log('【一】纯函数')
  ok(G.flowIsNewer(mkFlow('2026-10-13',6), mkFlow('2026-10-12',4)) === true,  'flowIsNewer：日期更新 → true')
  ok(G.flowIsNewer(mkFlow('2026-10-12',4), mkFlow('2026-10-13',6)) === false, 'flowIsNewer：日期更旧 → false')
  ok(G.flowIsNewer(mkFlow('2026-10-13',6), mkFlow('2026-10-13',4)) === true,  'flowIsNewer：同日期比日档条数')
  ok(G.flowIsNewer(mkFlow('2026-10-13',6), mkFlow('2026-10-13',6)) === false, 'flowIsNewer：完全相同 → false')
  ok(G.flowIsNewer(mkFlow('2026-10-13',6), null) === true,  'flowIsNewer：对照为空 → true')
  ok(G.flowIsNewer(null, mkFlow('2026-10-13',6)) === false, 'flowIsNewer：自身为空 → false')
  console.log('  ✅ flowIsNewer 六例通过')

  G.FLOW.cloudUp = ''; G.FLOW.cloudLocal = ''
  ok(G.flowFreshSuffix() === '', 'flowFreshSuffix：无数据 → 空串（不能凭空编时间）')
  G.FLOW.cloudUp = '2026-10-13'; G.FLOW.cloudLocal = '15:58'
  ok(G.flowFreshSuffix() === ' · 存档 10-13 · 刷新 15:58', 'flowFreshSuffix：两层完整 → 「' + G.flowFreshSuffix() + '」')
  ok(G.flowClockSuffix() === ' · 刷新 15:58', 'flowClockSuffix：单层 → 「' + G.flowClockSuffix() + '」')
  G.FLOW.cloudLocal = ''
  ok(G.flowFreshSuffix() === ' · 存档 10-13', 'flowFreshSuffix：只有存档日 → 「' + G.flowFreshSuffix() + '」')
  G.FLOW.cloudUp = ''
  ok(G.flowFreshSuffix() === '', 'flowFreshSuffix：只有空值 → 空串')

  /* ===== 二、竞速与覆盖 ===== */
  console.log('\n【二】取数竞速与覆盖')

  await scene('① 权威源先到 → 用它，且不产生冗余回调', {
    api:{ delay:20, data: mkFlow('2026-10-13', 6) },
    raw:{ fail:true, delay:5 },
    jsd:{ delay:120, data: mkFlow('2026-10-12', 4) }
  }, async function(){
    const seen = []
    const j = await G.flowCloudRaw(false, function(x){ seen.push(x.updated) })
    ok(j && j.updated === '2026-10-13', '返回权威源的最新数据')
    ok(G.FLOW.cloudSrc === 'auth', '胜出源标记为 auth')
    ok(G.FLOW.cloudUp === '2026-10-13', '记录存档口径日')
    ok(/^\d{2}:\d{2}$/.test(G.FLOW.cloudLocal), '记录本地拉取时刻 HH:MM → ' + G.FLOW.cloudLocal)
    await sleep(250)
    ok(seen.length === 0, '不应触发覆盖回调（实际 ' + seen.length + ' 次）')
    if(!fail) console.log('  ✅ 权威源优先')
  })

  await scene('② 兜底源先到 → 先给旧数据保速度，权威源到达后覆盖 + 回调重渲', {
    api:{ delay:80, data: mkFlow('2026-10-13', 6) },
    raw:{ fail:true, delay:5 },
    jsd:{ delay:10, data: mkFlow('2026-10-12', 4) }
  }, async function(){
    const seen = []
    const before = fail
    const j = await G.flowCloudRaw(false, function(x){ seen.push(x.updated) })
    ok(j && j.updated === '2026-10-12', '首屏交付的是兜底源数据（快）')
    ok(G.FLOW.cloudSrc === 'cdn', '胜出源先标记为 cdn')
    await sleep(400)
    ok(seen.length === 1, '★ 权威源到达应触发 1 次重渲回调（实际 ' + seen.length + ' 次）')
    ok(seen[0] === '2026-10-13', '回调携带的是更新后的数据')
    ok(G.FLOW.cloudRaw && G.FLOW.cloudRaw.updated === '2026-10-13', 'FLOW.cloudRaw 已被覆盖为最新')
    ok(G.FLOW.cloudSrc === 'auth', '胜出源已改为 auth')
    if(fail === before) console.log('  ✅ 兜底不抢跑：先快后准')
  })

  await scene('③ 权威源反而更旧 → 不覆盖（杜绝数据倒退）', {
    api:{ delay:80, data: mkFlow('2026-10-12', 4) },
    raw:{ fail:true, delay:5 },
    jsd:{ delay:10, data: mkFlow('2026-10-13', 6) }
  }, async function(){
    const seen = []
    const before = fail
    const j = await G.flowCloudRaw(false, function(x){ seen.push(x.updated) })
    ok(j && j.updated === '2026-10-13', '首屏拿到较新的数据')
    await sleep(400)
    ok(seen.length === 0, '不应覆盖（实际 ' + seen.length + ' 次）')
    ok(G.FLOW.cloudRaw.updated === '2026-10-13', '数据保持较新版本')
    if(fail === before) console.log('  ✅ 不倒退')
  })

  await scene('④ 全部源失败 → reject（不静默吞掉）', {
    api:{ fail:true, delay:5 }, raw:{ fail:true, delay:5 }, jsd:{ fail:true, delay:5 }
  }, async function(){
    let err = null
    try{ await G.flowCloudRaw(false, function(){}) }catch(e){ err = e }
    ok(!!err, '应抛出错误而不是返回 null')
    if(!fail) console.log('  ✅ 失败可见')
  })

  await scene('⑤ 并发调用共享同一次请求（首页 + 资金流页同时触发）', {
    api:{ delay:30, data: mkFlow('2026-10-13', 6) },
    raw:{ fail:true, delay:5 },
    jsd:{ delay:120, data: mkFlow('2026-10-12', 4) }
  }, async function(){
    const before = fail
    const p1 = G.flowCloudRaw(false, function(){})
    const p2 = G.flowCloudRaw(false, function(){})
    ok(p1 === p2, '两次调用返回同一 promise（未重复发请求）')
    const j = await p1
    ok(j && j.updated === '2026-10-13', '共享结果正确')
    if(fail === before) console.log('  ✅ 并发去重')
  })

  await scene('⑥ 3 分钟内走进程内缓存，不再发请求', {
    api:{ delay:20, data: mkFlow('2026-10-13', 6) },
    raw:{ fail:true, delay:5 },
    jsd:{ delay:120, data: mkFlow('2026-10-12', 4) }
  }, async function(){
    const before = fail
    await G.flowCloudRaw(false)
    calls = []
    await G.flowCloudRaw(false)
    ok(calls.length === 0, '缓存期内不应再发请求（实际 ' + calls.length + ' 次）')
    if(fail === before) console.log('  ✅ 缓存生效')
  })

  /* ===== 汇总 ===== */
  console.log('\n────────────────────────────────')
  console.log(fail === 0 ? '★ ALL GREEN —— ' + pass + ' 项断言全部通过'
                         : '★ 失败 ' + fail + ' 项 / 通过 ' + pass + ' 项')
  process.exit(fail === 0 ? 0 : 1)
})()
