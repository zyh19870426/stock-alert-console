#!/usr/bin/env node
/* eslint-disable */
/**
 * push-repo.js · 本地 git 仓 → 远端 GitHub 仓（走 API，不依赖 git push）
 * ------------------------------------------------------------
 * 为什么需要它：本机网络对 github.com 的 **git 写入通道**（git-receive-pack，POST）
 * 被代理拦成 `CONNECT tunnel failed, response 502`，重试 4 次全失败；
 * 而 **api.github.com 通畅**。⇒ 用 Git Data API（blob→tree→commit→ref）代替 git push。
 *
 * 与 git push 的差异（必须知道）：
 *   - 内容**逐字节一致**（按 index 里的全部 tracked 文件重建完整 tree）；
 *   - 但**只产生 1 个提交，不保留本地提交历史**（迁移场景可接受；远端原有的
 *     历史会作为父提交继续留着）。
 *   - 文件清单取自 `git ls-files` ⇒ 完全遵循 .gitignore 与白名单，不会把
 *     未跟踪的调试产物、缓存带上远端。
 *
 * 优化：内容未变的文件直接**复用远端已有 blob sha**，不重复上传（只发一次 tree 请求）。
 *
 * 用法（默认 dry-run）：
 *   GH_TOKEN=xxx node _tests/push-repo.js --to=zyh19870426/stock-alert-console
 *   GH_TOKEN=xxx node _tests/push-repo.js --to=zyh19870426/stock-alert-console --apply
 *   GH_TOKEN=xxx node _tests/push-repo.js --to=zyh19870426/stock-alert --patch --apply
 *
 * 参数：
 *   --to        必填，owner/repo
 *   --branch    默认 main
 *   --dir       本地仓目录，默认当前目录
 *   --apply     真正写入（不带则只打印计划）
 *   --allow-empty 无任何变化时也建一个提交（默认跳过）
 *   --patch     ★ 补丁模式：tree 带 base_tree，**只替换清单内变化的文件，远端其它文件原样保留**。
 *               用于「本地只持有一部分文件」的仓（如引擎仓 stock-alert：本地只有代码，
 *               运行期数据存档 state.json/rotation.json/… 只存在于远端）。
 *               不加此开关 = 完整树模式（远端多余的会被移除），仅适用于本地=全量镜像的仓。
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN

const args = {}
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
  if (m) args[m[1]] = m[2] === undefined ? true : m[2]
}
const TO = args.to
const BRANCH = args.branch || 'main'
const DIR = path.resolve(args.dir || process.cwd())
const APPLY = !!args.apply
const ALLOW_EMPTY = !!args['allow-empty']
const PATCH = !!args.patch
// ★ 本沙盒 spawnSync/execFileSync 不可用（EBUSY），所以文件清单由外部 shell 先落成文件：
//   git -c core.quotepath=false ls-files -s > <list>
const LIST = args.list ? path.resolve(args.list) : path.join(DIR, '_push_list.txt')

if (!TO || !/^[^/]+\/[^/]+$/.test(TO)) {
  console.error('缺少或格式错误：--to=<owner/repo>')
  process.exit(1)
}
if (!TOKEN && APPLY) {
  console.error('缺少 GH_TOKEN 环境变量（只从环境变量读，不落盘）')
  process.exit(1)
}

const H = () => {
  const h = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'stock-alert-repo-pusher', 'X-GitHub-Api-Version': '2022-11-28' }
  if (TOKEN) h['Authorization'] = 'Bearer ' + TOKEN
  return h
}
async function api(method, url, body) {
  const res = await fetch(url, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, H()), body: body ? JSON.stringify(body) : undefined })
  let json = null
  try { json = await res.json() } catch (e) {}
  return { status: res.status, ok: res.ok, json }
}
const API = 'https://api.github.com/repos/' + TO

/* git blob sha1：sha1("blob <len>\0" + content)，用来和远端 sha 比对避免重复上传 */
function blobSha(buf) {
  return crypto.createHash('sha1').update('blob ' + buf.length + '\x00').update(buf).digest('hex')
}

/* 文件清单来自外部 shell 生成的 `git ls-files -s` 输出 ⇒ 自动遵循 .gitignore；
   mode 保留可执行位。路径用 %XX 转义时需 core.quotepath=false。 */
function indexFiles() {
  if (!fs.existsSync(LIST)) {
    throw new Error('缺少文件清单 ' + LIST + '\n  请先生成：git -c core.quotepath=false ls-files -s > ' + LIST)
  }
  const raw = fs.readFileSync(LIST, 'utf8')
  const list = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const m = /^(\d{6}) ([0-9a-f]{40}) (\d+)\t([\s\S]+)$/.exec(line)
    if (!m) continue
    const mode = m[1] === '100755' ? '100755' : (m[1] === '120000' ? '120000' : '100644')
    list.push({ path: m[4], mode, abs: path.join(DIR, m[4]) })
  }
  return list.sort((a, b) => (a.path < b.path ? -1 : 1))
}

async function remoteTree() {
  const r = await api('GET', API + '/git/trees/' + BRANCH + '?recursive=1')
  if (!r.ok) return null
  return r.json.tree.filter(x => x.type === 'blob')
}

/* 补丁模式：取当前分支的 tree sha 作为 base_tree，未列出的远端文件自动继承 */
async function baseTreeSha() {
  const r = await api('GET', API + '/git/trees/' + BRANCH)
  if (!r.ok) throw new Error('取 base_tree 失败 HTTP ' + r.status)
  return r.json.sha
}

/* ★ 空仓陷阱：Git Data API 在完全没有提交的仓库上建 blob 会 409 "Git Repository is empty"
   ⇒ 先用 Contents API 落一个占位提交把仓库初始化出来。
   正式提交的 tree 不带 base_tree（是只含清单内路径的完整树），占位文件不会残留。 */
async function ensureInit() {
  const ref = await api('GET', API + '/git/ref/heads/' + BRANCH)
  if (ref.ok) return null
  const b = await api('PUT', API + '/contents/.push-bootstrap', {
    message: 'init: bootstrap（推送占位，随后由正式提交覆盖）',
    content: Buffer.from('bootstrap\n').toString('base64')
  })
  if (!b.ok) throw new Error('初始化空仓失败 HTTP ' + b.status + ' ' + JSON.stringify(b.json).slice(0, 200))
  if (!b.json || !b.json.commit) throw new Error('初始化空仓失败：返回无 commit')
  const info = await api('GET', API)
  const def = (info.json && info.json.default_branch) || BRANCH
  if (def !== BRANCH) {
    const mk = await api('POST', API + '/git/refs', { ref: 'refs/heads/' + BRANCH, sha: b.json.commit.sha })
    if (!mk.ok) throw new Error('建 ' + BRANCH + ' 分支失败 HTTP ' + mk.status + ' ' + JSON.stringify(mk.json).slice(0, 200))
    await api('PATCH', API, { default_branch: BRANCH })
    await api('DELETE', API + '/git/refs/heads/' + def)
    return '已初始化（默认分支 ' + def + ' → ' + BRANCH + '）'
  }
  return '已初始化首个提交'
}

;(async () => {
  console.log('本地仓：' + DIR)
  console.log('目标：  ' + TO + '@' + BRANCH)
  console.log('模式：  ' + (APPLY ? '★ 执行写入' : 'dry-run（只打印）'))
  console.log('')

  const files = indexFiles()
  console.log('git index 中的 tracked 文件：' + files.length + ' 个')

  const remote = await remoteTree()
  const remoteMap = {}
  if (remote) for (const x of remote) remoteMap[x.path] = x.sha

  const items = []
  for (const f of files) {
    let buf
    try { buf = fs.readFileSync(f.abs) } catch (e) { console.log('  ⚠️ 读取失败，跳过：' + f.path); continue }
    const sha = blobSha(buf)
    const changed = remoteMap[f.path] !== sha
    items.push({ path: f.path, mode: f.mode, buf, sha, changed })
  }
  const changedItems = items.filter(x => x.changed)
  const missing = remote ? files.filter(f => !remoteMap[f.path]) : []
  const extra = remote ? remote.filter(x => !files.find(f => f.path === x.path)) : []

  console.log('  新增（远端没有）  ：' + missing.length)
  console.log('  修改（内容不同）  ：' + changedItems.length)
  console.log('  未被跟踪的远端文件：' + extra.length + (extra.length ? (PATCH ? '  → 补丁模式：原样保留' : '  → 本次会从树里移除') : ''))
  console.log('')
  if (missing.length) {
    console.log('  —— 新增 --')
    for (const m of missing.slice(0, 40)) console.log('     + ' + m.path)
    if (missing.length > 40) console.log('     … 另有 ' + (missing.length - 40) + ' 个')
  }
  if (changedItems.length) {
    console.log('  —— 修改 --')
    for (const m of changedItems.slice(0, 40)) console.log('     M ' + m.path + '  (' + (m.buf.length / 1024).toFixed(1) + 'K)')
    if (changedItems.length > 40) console.log('     … 另有 ' + (changedItems.length - 40) + ' 个')
  }
  if (extra.length) {
    console.log('  —— ' + (PATCH ? '远端独有（补丁模式：原样保留）' : '将在远端被移除') + ' --')
    for (const m of extra.slice(0, 20)) console.log('     - ' + m.path)
    if (extra.length > 20) console.log('     … 另有 ' + (extra.length - 20) + ' 个')
  }
  console.log('')
  console.log('  合计：需上传 ' + changedItems.length + ' 个 / 复用已有 blob ' + (items.length - changedItems.length) + ' 个')

  if (!APPLY) { console.log('\n（dry-run 结束。确认无误后加 --apply 执行）'); return }

  const nothingToDo = PATCH ? !changedItems.length : (!changedItems.length && !extra.length)
  if (nothingToDo && !ALLOW_EMPTY) {
    console.log('\n远端内容已与本地一致，无需提交。')
    return
  }

  const init = await ensureInit()
  if (init) console.log('  仓库状态：' + init + '\n')

  const changedPaths = new Set(changedItems.map(x => x.path))
  const tree = []
  let i = 0
  for (const it of items) {
    if (!it.changed) { tree.push({ path: it.path, mode: it.mode, type: 'blob', sha: it.sha }); continue }
    i++
    const b = await api('POST', API + '/git/blobs', { content: it.buf.toString('base64'), encoding: 'base64' })
    if (!b.ok) throw new Error('建 blob 失败 ' + it.path + ' HTTP ' + b.status + ' ' + JSON.stringify(b.json).slice(0, 160))
    tree.push({ path: it.path, mode: it.mode, type: 'blob', sha: b.json.sha })
    process.stdout.write('\r  上传 ' + i + '/' + changedItems.length + '  ' + it.path.slice(0, 50).padEnd(52))
  }
  if (i) process.stdout.write('\r' + ' '.repeat(84) + '\r')

  const t = await api('POST', API + '/git/trees', PATCH
    ? { base_tree: await baseTreeSha(), tree: tree.filter(x => changedPaths.has(x.path)) }
    : { tree })
  if (!t.ok) throw new Error('建 tree 失败 HTTP ' + t.status + ' ' + JSON.stringify(t.json).slice(0, 200))

  const ref = await api('GET', API + '/git/ref/heads/' + BRANCH)
  const parents = ref.ok && ref.json && ref.json.object ? [ref.json.object.sha] : []

  let msg = args.message || ('sync: 本地 ' + DIR.split(/[\\/]/).pop() + ' 同步（' + items.length + ' 文件）')
  const c = await api('POST', API + '/git/commits', { message: msg, tree: t.json.sha, parents })
  if (!c.ok) throw new Error('建提交失败 HTTP ' + c.status + ' ' + JSON.stringify(c.json).slice(0, 200))

  if (parents.length) {
    const u = await api('PATCH', API + '/git/refs/heads/' + BRANCH, { sha: c.json.sha, force: false })
    if (!u.ok) throw new Error('更新分支失败 HTTP ' + u.status + ' ' + JSON.stringify(u.json).slice(0, 200))
  } else {
    const u = await api('POST', API + '/git/refs', { ref: 'refs/heads/' + BRANCH, sha: c.json.sha })
    if (!u.ok) throw new Error('建分支失败 HTTP ' + u.status + ' ' + JSON.stringify(u.json).slice(0, 200))
  }
  console.log('  提交：' + c.json.sha.slice(0, 7))

  const after = await remoteTree()
  const n = after ? after.length : 0
  console.log('  校验：远端现有 ' + n + ' 文件 / 本地 ' + items.length + (n === items.length ? '  ✅ 齐' : '  ❌ 不一致'))
  const j = await api('GET', API)
  if (j.ok) console.log('  仓库：' + j.json.full_name + '  size=' + j.json.size + 'K  default_branch=' + j.json.default_branch)
})().catch(e => { console.error('\n出错：' + (e && e.message ? e.message : e)); process.exit(1) })
