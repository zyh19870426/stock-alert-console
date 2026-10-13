/* 发布漂移巡检：本地发布目录 ↔ 线上站点 逐文件比对（md5）
 * 用法：node _tests/publish-drift.js [--dir=...] [--site=...]
 * 目的：回答「还有没有没发布到线上的内容」——列出 线上缺失 / 内容不同 / 一致 三类。
 * ⚠️ 只读：只发 GET，不写任何远端。
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const args = {}
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
  if (m) args[m[1]] = m[2] === undefined ? true : m[2]
}
const ROOT = path.resolve(args.dir || 'D:/mywork/stock-alert-console')
const SITE = args.site || process.env.SITE_URL || 'https://stock-alert-console-51356.app.workbuddy.host'

/* 与发布无关的本机文件：抓取缓存 / 备份 / VCS / 编辑器 */
const SKIP = [
  /(^|[\\/])\.git([\\/]|$)/,
  /(^|[\\/])\.workbuddy([\\/]|$)/,
  /(^|[\\/])node_modules([\\/]|$)/,
  /\.bak-\d+$/,
  /(^|[\\/])\.news-/,          /* 消息面抓取缓存，不属发布内容 */
  /(^|[\\/])\.DS_Store$/
]

function walk(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name
    if (SKIP.some(re => re.test(r))) continue
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) walk(abs, r, out)
    else out.push(r)
  }
  return out
}

const md5 = b => crypto.createHash('md5').update(b).digest('hex')

async function get(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(),
        { headers: { 'User-Agent': 'publish-drift' }, redirect: 'follow' })
      const buf = Buffer.from(await r.arrayBuffer())
      return { status: r.status, buf }
    } catch (e) {
      if (i === 1) return { status: 0, buf: Buffer.alloc(0), err: String(e.message) }
      await new Promise(r => setTimeout(r, 800))
    }
  }
}

(async () => {
  const files = walk(ROOT, '', []).sort()
  console.log('发布目录：' + ROOT)
  console.log('线上站点：' + SITE)
  console.log('待比对文件：' + files.length + ' 个')
  console.log('')
  const same = [], diff = [], missing = [], err = []
  for (const f of files) {
    const lb = fs.readFileSync(path.join(ROOT, f))
    const r = await get(SITE + '/' + f.split('/').map(encodeURIComponent).join('/'))
    if (r.status === 0) { err.push({ f, e: r.err }); continue }
    if (r.status !== 200) { missing.push({ f, status: r.status }); continue }
    const lh = md5(lb), rh = md5(r.buf)
    if (lh === rh) same.push(f)
    else diff.push({ f, l: lb.length, r: r.buf.length, lh, rh })
  }
  /* 输出：先列问题，再列概览 */
  if (missing.length) {
    console.log('■ 线上缺失（本地有、站点取不到）')
    for (const x of missing) console.log('    HTTP ' + x.status + '  ' + x.f)
    console.log('')
  }
  if (diff.length) {
    console.log('■ 内容不同（本地已改、线上还是旧的）')
    for (const x of diff) console.log('    ' + x.f + '   本地 ' + x.l + 'B/' + x.lh.slice(0, 8) + '   线上 ' + x.r + 'B/' + x.rh.slice(0, 8))
    console.log('')
  }
  if (err.length) {
    console.log('■ 网络失败（需重试）')
    for (const x of err) console.log('    ' + x.f + '  ' + x.e)
    console.log('')
  }
  console.log('================ 概览 ================')
  console.log('  一致     ：' + same.length)
  console.log('  内容不同 ：' + diff.length)
  console.log('  线上缺失 ：' + missing.length)
  console.log('  网络失败 ：' + err.length)
  console.log('')
  console.log(diff.length === 0 && missing.length === 0
    ? '★ 本地发布目录与线上完全一致（' + same.length + ' 个文件）'
    : '★ 存在漂移：见上方明细')
  process.exit(0)
})()
