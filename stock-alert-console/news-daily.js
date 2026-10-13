#!/usr/bin/env node
/* ============================================================
 * news-daily.js · 每日消息面数据管道（2026-10-11）
 * ------------------------------------------------------------
 * 职责：抓取新浪 7×24 快讯 → 固定词表分类（利好/利空/中性）+
 *       重要度/影响力打分 → 关联板块/个股映射 → 对 T+1 及更早
 *       的消息预计算 T+1/T+3/T+5 回测 → 合并去重写 news-history.json
 * 输出：与 console.html 同目录 news-history.json（页面三源降级读取，
 *       同域优先 → raw.githubusercontent → jsDelivr）
 * 调度：WorkBuddy 每日 20:05 自动任务跑一次（收盘后）
 *
 * ★★ 预注册规则（无自由参数，改动必须同时改 console.html 内嵌副本）★★
 *   方向：goodStrong/badStrong 命中计 2 分，good/bad 计 1 分（词去重）；
 *         g>b→利好，b>g→利空，否则中性。
 *   重要度 imp：命中 policy 主体词→3；关联板块或个股≥1→2；否则 1。
 *   影响力 inf（仅方向≠中性）：imp=3 或 关联数(bk+st)≥4→3；
 *         关联数≥1→2；否则 1。中性消息 inf=0。
 *   回测口径：T0=消息发布日当日（北京时间）该代码第一个交易日 K 线；
 *         TN=T0 后第 N 根日线收盘相对 T0 收盘涨跌幅（%）。
 *         命中=方向一致（利好 TN>0 / 利空 TN<0）。
 *         只对「发布日 < 今天」的消息计算（严格避免未来函数）；
 *         bt 已含 t5 的不再重算（冻结），t5 未成熟的重算。
 *   板块名单：云端 zyh19870426/stock-alert flow-history.json（与消息催化同源）。
 *   个股名单：新浪 hs_a 全量列表。
 * ============================================================ */
'use strict'
const fs = require('fs')
const path = require('path')

const HERE = __dirname
const OUT = path.join(HERE, 'news-history.json')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'

/* ---------- 预注册词表 ---------- */
const RULES = {
  goodStrong: ['利好', '降准', '降息', '增持', '回购', '中标', '业绩预增', '预盈', '净利润增', '扭亏', '获批', '批准通过', '重大合同', '签署重大'],
  good: ['超预期', '创新高', '历史新高', '涨价', '提价', '订单', '签约', '战略合作', '达成合作', '补贴', '免税', '减税', '稳增长', '研发布局', '扩产'],
  badStrong: ['利空', '减持', '立案', '留置', '罚款', '处罚', '警示函', '问询函', '监管函', '预亏', '商誉减值', '计提减值', '退市', '违约', '破产', '诉讼', '仲裁', '下修', '下调评级', '质押爆仓', '停产', '爆炸', '火灾', '调查', '强制退市'],
  bad: ['降价', '裁员', '终止', '撤回', '失败', '风险提示', '解禁', '亏损', '下滑', '回落'],
  policy: ['国务院', '国常会', '中央政治局', '央行', '中国人民银行', '证监会', '金融监管总局', '发改委', '财政部', '工信部', '商务部', '住建部', '国家能源局', '国家统计局', '美联储', '欧央行', '欧洲央行', '日本央行', 'LPR', 'MLF', '逆回购', '存款准备金', 'GDP', 'CPI', 'PPI', 'PMI', '社融', '关税', '十五五', '新国九条', '中办', '国办'],
  exBoards: ['融资融券', '转融券', '沪股通', '深股通', '机构重仓', '基金重仓', '社保重仓', 'QFII重仓', '上证50', '上证180', '上证380', '沪深300', '中证500', '中证800', '中证1000', '创业板综', '昨日涨停', '昨日连板', '昨日触板', '昨日涨停_含一字', '百元股', 'ST股', '次新股', '破净股', '低价股', '高股息', 'AH股', 'B股', 'GDR', '标准普尔', '富时罗素', 'MSCI中国', '茅指数', '宁组合', '预亏预减', '预盈预增', '壳资源', '并购重组']
}

/* ---------- 工具 ---------- */
function bjNow() {
  const d = new Date(Date.now() + (480 + new Date().getTimezoneOffset()) * 60000)
  const p = n => (n < 10 ? '0' : '') + n
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}
function bjToday() { return bjNow().slice(0, 10) }
function fnv(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0 }
  return h.toString(36)
}
async function fetchText(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 14000)
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://finance.sina.com.cn/' }, signal: ac.signal })
      clearTimeout(tm)
      if (r.ok) return await r.text()
    } catch (e) { if (i === tries - 1) throw e }
    await new Promise(res => setTimeout(res, 700))
  }
  throw new Error('fetch fail ' + url.slice(0, 60))
}
const fetchJson = async (url, tries) => JSON.parse(await fetchText(url, tries))
const sleep = ms => new Promise(res => setTimeout(res, ms))
/* K 线专用短超时抓取：代理配额墙/挂起风险高，单源 7s、单次重试，绝不长时间挂起 */
async function klFetch(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 7000)
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://finance.sina.com.cn/' }, signal: ac.signal })
      clearTimeout(tm)
      if (r.ok) return await r.text()
    } catch (e) { if (i === 1) throw e }
    await sleep(300)
  }
  throw new Error('kl fail')
}

/* ---------- ① 新浪 7×24 快讯 ---------- */
async function fetchSinaNews(pages) {
  const out = []
  for (let pg = 1; pg <= pages; pg++) {
    let list = []
    try {
      const u = 'https://zhibo.sina.com.cn/api/zhibo/feed?page=' + pg + '&page_size=100&zhibo_id=152&tag_id=0&dire=f&dpc=1&r=' + Math.random()
      const j = await fetchJson(u)
      list = (j && j.result && j.result.data && j.result.data.feed && j.result.data.feed.list) || []
    } catch (e) { console.log('  sina p' + pg + ' fail: ' + e.message) }
    for (const it of list) {
      const x = String(it.rich_text || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim()
      const t = String(it.create_time || '')
      if (x && /^\d{4}-\d{2}-\d{2}/.test(t)) out.push({ t, x })
    }
    await sleep(180)
  }
  return out
}

/* ---------- ② 名单：板块（云端 flow-history）+ 个股（新浪全量） ---------- */
async function loadBoardMap() {
  const urls = [
    'https://raw.githubusercontent.com/zyh19870426/stock-alert/main/flow-history.json',
    'https://cdn.jsdelivr.net/gh/zyh19870426/stock-alert@main/flow-history.json'
  ]
  for (const u of urls) {
    try {
      const j = JSON.parse(await fetchText(u))
      if (j && j.names) {
        const m = {}
        for (const bk in j.names) m[j.names[bk][0]] = { c: bk, t: j.names[bk][1] } // t: 2=行业 3=概念
        if (Object.keys(m).length > 50) return m
      }
    } catch (e) { /* try next */ }
  }
  throw new Error('板块名单加载失败（flow-history 三源均不可达）')
}
async function loadStockMap() {
  const m = {}
  for (let pg = 1; pg <= 60; pg++) {
    let rows = []
    try {
      const u = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=' + pg + '&num=100&sort=symbol&asc=1&node=hs_a&symbol=&_s_r_a=page&r=' + Math.random()
      const txt = await fetchText(u)
      rows = txt.trim() === 'null' || !txt.trim() ? [] : JSON.parse(txt)
    } catch (e) { if (pg === 1) throw new Error('个股名单首页失败: ' + e.message); break }
    if (!rows.length) break
    for (const r of rows) if (/^\d{6}$/.test(r.code || '')) m[r.name] = r.code
    if (rows.length < 100) break
    await sleep(120)
  }
  if (Object.keys(m).length < 3000) throw new Error('个股名单过少: ' + Object.keys(m).length)
  return m
}

/* ---------- ③ 分类 + 打分 + 关联 ---------- */
function uniqHits(text, words) {
  let s = 0; const hit = []
  for (const w of words) if (text.indexOf(w) >= 0) { s++; hit.push(w) }
  return { s, hit }
}
/* 重大核心判定（预注册，无自由参数）：有方向且有关联(imp>=2)，或政策宏观(imp==3)。
   严格口径——纯中性无关联(imp1)、中性板块闲聊(imp2)、方向词单机命中(利好/利空 imp1)均判噪音。 */
function coreOf(dir, imp) { return (dir !== '中性' && imp >= 2) || imp === 3 }
function classify(text, boardMap, stockMap) {
  const g1 = uniqHits(text, RULES.good), g2 = uniqHits(text, RULES.goodStrong)
  const b1 = uniqHits(text, RULES.bad), b2 = uniqHits(text, RULES.badStrong)
  const g = g1.s + g2.s * 2, b = b1.s + b2.s * 2
  const dir = g > b ? '利好' : (b > g ? '利空' : '中性')
  const pol = uniqHits(text, RULES.policy)
  /* 关联板块：全名子串匹配，排除指数/持股类泛化板块；行业优先 */
  const bkHits = []
  for (const nm in boardMap) {
    if (nm.length < 2 || RULES.exBoards.indexOf(nm) >= 0) continue
    if (text.indexOf(nm) >= 0) bkHits.push(nm)
  }
  bkHits.sort((a, c) => (boardMap[a].t === 2 ? 0 : 1) - (boardMap[c].t === 2 ? 0 : 1) || c.length - a.length)
  const bks = bkHits.slice(0, 6).map(nm => [boardMap[nm].c, nm])
  /* 关联个股：名称子串 + 文中 6 位代码 */
  const stHits = []
  for (const nm in stockMap) {
    if (nm.length < 2) continue
    if (text.indexOf(nm) >= 0) stHits.push(nm)
  }
  stHits.slice(0, 5).forEach(nm => { if (!stHits.slice(0, 5).includes(nm)) return })
  const sts = stHits.slice(0, 5).map(nm => [stockMap[nm], nm])
  const codeM = text.match(/[\(（]([013]\d{5})[\)）]/g) || []
  for (const cm of codeM) {
    const c = (cm.match(/\d{6}/) || [''])[0]
    if (c && !sts.some(v => v[0] === c)) {
      const nm = Object.keys(stockMap).find(k => stockMap[k] === c)
      if (nm && sts.length < 6) sts.push([c, nm])
    }
  }
  const relN = bks.length + sts.length
  let imp = 1
  if (pol.s > 0) imp = 3
  else if (relN > 0) imp = 2
  let inf = 0
  if (dir !== '中性') inf = (imp === 3 || relN >= 4) ? 3 : (relN >= 1 ? 2 : 1)
  return {
    dir, imp, inf, core: coreOf(dir, imp),
    g: g1.hit.concat(g2.hit), b: b1.hit.concat(b2.hit),
    bks, sts
  }
}

/* ---------- ④ 回测（腾讯前复权主源 / 新浪备源 / 东财仅板块；磁盘缓存 + 限速） ----------
 * ★ 预注册补充：每条消息回测只取前 3 个关联个股 + 前 3 个关联板块（sts/bks 存储不截断，仅回测取前3）。
 *   板块 K 线只有东财有（push2his，secid=90.BKxxxx）；东财被限流时板块 bt 留空，
 *   由后续运行自动补算（bt.t5 未成熟即重算）。个股主源腾讯 qfq（与控制台 fetchDailyBars 同源）。 */
const CACHE_FILE = path.join(HERE, '.news-kline-cache.json')
let klineCache = new Map()   // key: sym (shXXXXXX/bjXXXXXX/BKxxxxxx) → [{d,c}] | null
let cacheDirty = false
let failStreak = 0
let quotaHit = false   // 单进程出站配额墙（代理 501）：命中即停止本轮抓取，交给下一轮新进程
try {
  const cj = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
  if (cj && cj.day === bjToday() && cj.map) klineCache = new Map(Object.entries(cj.map))
} catch (e) { /* 无缓存 */ }
function saveKlineCache() {
  if (!cacheDirty) return
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify({ day: bjToday(), map: Object.fromEntries(klineCache) })) } catch (e) {}
}
function symOf(code) {
  if (/^BK/.test(code)) return code                       // 板块走东财 secid=90.BKxxxx
  return (/^(6)/.test(code) ? 'sh' : (/^(4|8|92)/.test(code) ? 'bj' : 'sz')) + code
}
function secidOf(code) {
  if (/^BK/.test(code)) return '90.' + code               // ★ 90.BK0428（原 '90.'+去BK 是错的）
  return (/^6/.test(code) ? '1.' : '0.') + code
}
async function getKline(code) {
  const sym = symOf(code)
  if (klineCache.has(sym)) return klineCache.get(sym)
  let bars = null
  if (/^BK/.test(code)) {
    /* 板块：仅东财（被限流时快失败返回 null，本轮跳过、后续补算；不挂起） */
    try {
      const u = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secidOf(code) + '&klt=101&fqt=1&fields1=f1,f2,f3&fields2=f51,f53&lmt=45&end=20500101&r=' + Math.random()
      const j = JSON.parse(await klFetch(u))
      bars = (j && j.data && j.data.klines || []).map(s => { const p = s.split(','); return { d: p[0], c: parseFloat(p[1]) } }).filter(v => isFinite(v.c))
      if (!bars.length) bars = null
    } catch (e) { bars = null }
  } else {
    /* 个股：腾讯 qfq 主源 → 新浪备源（均快失败）；不回退东财（避免配额墙后东财挂起拖垮整轮） */
    try {
      const u = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + sym + ',day,,,45,qfq&_=' + Date.now()
      const j = JSON.parse(await klFetch(u))
      const node = j && j.data && j.data[sym]
      const rows = node && (node.qfqday || node.day)
      if (rows && rows.length) bars = rows.map(r => ({ d: r[0], c: parseFloat(r[2]) })).filter(v => isFinite(v.c))
    } catch (e) { /* 新浪备源 */ }
    if (!bars) {
      try {
        const u = 'https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=' + sym + '&scale=240&ma=no&datalen=45&r=' + Math.random()
        const arr = JSON.parse(await klFetch(u))
        if (Array.isArray(arr) && arr.length) bars = arr.map(v => ({ d: String(v.day || '').slice(0, 10), c: parseFloat(v.close) })).filter(v => v.d && isFinite(v.c))
      } catch (e) { /* 两源皆败 → null，下一轮续 */ }
    }
  }
  /* ★ 只有成功结果才写缓存：失败(null)不落盘，否则下次运行会命中坏缓存永远拿不到数据 */
  if (bars) { klineCache.set(sym, bars); cacheDirty = true }
  /* 限速 + 配额墙检测：基础间隔 350ms；连续 15 个代码全源失败 → 判定为单进程配额耗尽，
     置 quotaHit 让 backtest 提前结束本轮（下一轮全新进程继续补算，避免无谓冷却堆积） */
  if (!bars) {
    failStreak++
    if (failStreak >= 15) { quotaHit = true; console.log('  [配额墙] 连续 ' + failStreak + ' 个代码无数据，本轮停止，下一轮续'); await sleep(800); return bars }
  } else failStreak = 0
  await sleep(350)
  return bars
}
function retFor(bars, msgDate, n) {
  if (!bars || !bars.length) return null
  let i0 = -1
  for (let i = 0; i < bars.length; i++) if (bars[i].d >= msgDate) { i0 = i; break }
  if (i0 < 0 || i0 + n >= bars.length) return null
  const c0 = bars[i0].c
  if (!c0) return null
  return (bars[i0 + n].c / c0 - 1) * 100
}
async function backtest(pool, codes, today) {
  /* 只做抓取与计算；pool/codes 由 collectPool 预先收集 */
  if (!pool.length) { saveKlineCache(); return 0 }
  const arr = codes
  console.log('  回测：' + pool.length + ' 条消息 / ' + arr.length + ' 个代码（段2独立进程）')
  for (const c of arr) { if (quotaHit) break; await getKline(c) }
  saveKlineCache()
  for (const m of pool) {
    const calc = list => {
      const acc = { t1: [], t3: [], t5: [] }
      for (const v of list.slice(0, 3)) {
        const bars = klineCache.get(symOf(v[0]))
        const d = (m.t || '').slice(0, 10)
        const t1 = retFor(bars, d, 1), t3 = retFor(bars, d, 3), t5 = retFor(bars, d, 5)
        if (t1 != null) acc.t1.push(t1)
        if (t3 != null) acc.t3.push(t3)
        if (t5 != null) acc.t5.push(t5)
      }
      const mean = a => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null
      const r2 = v => v == null ? null : +v.toFixed(2)
      return {
        n: acc.t1.length,
        t1: r2(mean(acc.t1)), t3: r2(mean(acc.t3)), t5: r2(mean(acc.t5)),
        h1: acc.t1.length ? +(acc.t1.filter(v => m.dir === '利好' ? v > 0 : v < 0).length / acc.t1.length * 100).toFixed(0) : null
      }
    }
    const sR = calc(m.sts), bR = calc(m.bks)
    /* ★ 只有真正取到 K 线（s/b 任一 n>0）才落盘并打 at 戳；
       否则留 m.bt 为空，下一轮 --bt 进程（全新配额+磁盘缓存）继续补算。
       否则 quota 截断的消息会被打上 at=today 永久跳过，回测永远填不满。 */
    if (sR.n > 0 || bR.n > 0) m.bt = { at: bjNow(), s: sR, b: bR }
  }
  return pool.length
}

/* ---------- ④b 两段式执行 ----------
 * 本地代理对单进程出站请求有配额（实测 ~68 个后新连接一律 501），且沙箱禁止子进程（spawn EBUSY）。
 * ⇒ 拆两段跑（自动化用 `node news-daily.js && node news-daily.js --bt`）：
 *   段1（默认）：抓新闻 + 分类 + 关联 + 写 news-history.json + 导出待回测代码表
 *   段2（--bt）：全新进程、仅做 K 线抓取与回测计算，写回 news-history.json */
const CODES_FILE = path.join(HERE, '.news-bt-codes.json')
function collectPool(msgs, today) {
  const pool = []
  const codes = new Set()
  for (const m of msgs) {
    const d = (m.t || '').slice(0, 10)
    if (!d || d >= today) continue
    const mature = (m.bt && m.bt.s && m.bt.s.t5 != null && (!m.bt.b || !m.bks.length || m.bt.b.t5 != null)) ||
                   (m.bt && m.bt.at && m.bt.at.slice(0, 10) === today)   // 今日已尝试过（含东财限流失败），不再重试
    if (mature) continue
    if (!m.bks.length && !m.sts.length) continue
    m.sts.slice(0, 3).forEach(v => codes.add(v[0]))
    m.bks.slice(0, 3).forEach(v => codes.add(v[0]))
    pool.push(m)
  }
  return { pool, codes: [...codes] }
}

/* ---------- 主流程 ---------- */
function summarize(keep, t0) {
  const today = bjToday()
  const todayMsgs = keep.filter(m => m.t.slice(0, 10) === today)
  const cnt = s => todayMsgs.filter(m => m.dir === s).length
  const bts = keep.filter(m => m.bt && m.bt.s && m.bt.s.h1 != null)
  const hitGood = bts.filter(m => m.dir === '利好')
  const hitBad = bts.filter(m => m.dir === '利空')
  const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) + '%' : '—'
  console.log('  今日: 利好 ' + cnt('利好') + ' / 利空 ' + cnt('利空') + ' / 中性 ' + cnt('中性'))
  console.log('  已回测: 利好 ' + hitGood.length + ' 条 T1均值 ' + avg(hitGood.map(m => m.bt.s.t1)) +
    ' 命中 ' + avg(hitGood.map(m => m.bt.s.h1)) + ' | 利空 ' + hitBad.length + ' 条 T1均值 ' + avg(hitBad.map(m => m.bt.s.t1)))
  console.log('[done] ' + ((Date.now() - t0) / 1000).toFixed(1) + 's → ' + OUT)
}
async function main() {
  const t0 = Date.now()
  const today = bjToday()
  console.log('[news-daily] ' + bjNow() + '  today=' + today + (process.argv[2] === '--bt' ? '  [段2:回测]' : '  [段1:抓取]'))
  const old = fs.existsSync(OUT) ? (function () { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')) } catch (e) { return null } })() : null
  const byId = new Map()
  if (old && Array.isArray(old.msgs)) for (const m of old.msgs) byId.set(m.id, m)

  if (process.argv[2] !== '--bt') {
    /* ---------- 段1：抓新闻 + 分类 + 关联 ---------- */
    const raw = await fetchSinaNews(12)
    console.log('  快讯抓取: ' + raw.length + ' 条')
    const boardMap = await loadBoardMap()
    console.log('  板块名单: ' + Object.keys(boardMap).length)
    const stockMap = await loadStockMap()
    console.log('  个股名单: ' + Object.keys(stockMap).length)
    let added = 0
    for (const r of raw) {
      const id = fnv(r.t + '|' + r.x.slice(0, 80))
      if (byId.has(id)) continue
      const c = classify(r.x, boardMap, stockMap)
      byId.set(id, {
        id, t: r.t, x: r.x.slice(0, 300),
        dir: c.dir, imp: c.imp, inf: c.inf, core: c.core,
        bks: c.bks, sts: c.sts
      })
      added++
    }
    console.log('  新增: ' + added + ' 条（库内共 ' + byId.size + '）')
    for (const m of [...byId.values()]) if (m.core === undefined) m.core = coreOf(m.dir, m.imp)
    const msgs = [...byId.values()]
    const { pool, codes } = collectPool(msgs, today)
    fs.writeFileSync(CODES_FILE, JSON.stringify(codes))
    console.log('  待回测: ' + pool.length + ' 条消息 / ' + codes.length + ' 个代码 → ' + CODES_FILE)

    const cut = new Date(Date.parse(today + 'T00:00:00+08:00') - 120 * 86400000).toISOString().slice(0, 10)
    const keep = msgs.filter(m => (m.t || '').slice(0, 10) >= cut)
    keep.sort((a, b) => (a.t < b.t ? 1 : -1))
    fs.writeFileSync(OUT, JSON.stringify({ v: 1, updated: bjNow(), rules: RULES, msgs: keep }))
    console.log('  保留 ' + keep.length + ' 条（≥' + cut + '）')
    summarize(keep, t0)
    console.log('[next] 继续执行: node news-daily.js --bt')
    return
  }

  /* ---------- 段2：K 线抓取 + 回测（全新进程，无前置请求耗配额） ---------- */
  if (!old) { console.log('  无存档，先跑段1'); return }
  const msgs = old.msgs
  for (const m of msgs) if (m.core === undefined) m.core = coreOf(m.dir, m.imp)
  const { pool, codes } = collectPool(msgs, today)
  if (!pool.length) { console.log('  无待回测消息'); return }
  const btN = await backtest(pool, codes, today)
  const cut = new Date(Date.parse(today + 'T00:00:00+08:00') - 120 * 86400000).toISOString().slice(0, 10)
  const keep = msgs.filter(m => (m.t || '').slice(0, 10) >= cut)
  keep.sort((a, b) => (a.t < b.t ? 1 : -1))
  fs.writeFileSync(OUT, JSON.stringify({ v: 1, updated: bjNow(), rules: old.rules || RULES, msgs: keep }))
  console.log('  回测重算: ' + btN + ' 条；保留 ' + keep.length + ' 条（≥' + cut + '）')
  summarize(keep, t0)
}
if (process.argv[2] === '--bt-worker') {
  /* 已废弃（沙箱禁子进程）——保留占位避免误用 */
  console.error('--bt-worker 已废弃：用两段式 `node news-daily.js && node news-daily.js --bt`')
  process.exit(1)
} else {
  main().catch(e => { console.error('[fatal] ' + (e && e.stack || e)); process.exit(1) })
}
