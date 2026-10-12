#!/usr/bin/env node
/* eslint-disable */
/**
 * switch-repo.js · 仓库地址「切换器」（换 GitHub 账号/仓库名时用）
 * ------------------------------------------------------------
 * 把代码里写死的旧 owner（默认 zyhaaad）批量换成新 owner，并支持顺带改仓库名。
 *
 * ★ 默认 **dry-run**：只打印「哪个文件、哪几行、改成什么」，不写盘。加 --apply 才落盘。
 * ★ 明确排除历史与产物，**绝不改**：
 *      .workbuddy/memory/**       ← 记忆是历史记录，改写会篡改事实
 *      _tests/_cache/**           ← 生成的缓存
 *      _research/** _recon/**     ← 一次性侦察脚本与数据快照
 *      *.bak-* *.log node_modules
 * ★ 只换 GitHub 上下文里的 owner 串；WorkBuddy 发布域名
 *   `stock-alert-console.app.workbuddy.host` 里虽然也有同名片段，但**不含 owner**，
 *   本脚本按「owner 串」整体匹配，故不会被误伤（仓库改名规则也限定在 GH_REPO/GITHUB_REPOSITORY 上下文）。
 *
 * 用法：
 *   node _tests/switch-repo.js --owner=<新用户名>                  # 预览
 *   node _tests/switch-repo.js --owner=<新用户名> --apply           # 落盘
 *   node _tests/switch-repo.js --owner=<新用户名> --engine=xxx --console=yyy --apply
 *
 * 参数：
 *   --owner    必填，新 GitHub 用户名
 *   --engine   可选，云端脚本仓名（默认沿用 stock-alert）
 *   --console  可选，控制台仓名（默认沿用 stock-alert-console）
 *   --old      可选，旧用户名（默认 zyhaaad）
 *   --apply    真正写盘
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const args = {}
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
  if (m) args[m[1]] = m[2] === undefined ? true : m[2]
}
const OLD_OWNER = args.old || 'zyhaaad'
const NEW_OWNER = args.owner
const OLD_ENGINE = 'stock-alert'
const OLD_CONSOLE = 'stock-alert-console'
const NEW_ENGINE = args.engine || OLD_ENGINE
const NEW_CONSOLE = args.console || OLD_CONSOLE
const APPLY = !!args.apply

if (!NEW_OWNER) {
  console.error('缺少 --owner=<新 GitHub 用户名>')
  process.exit(1)
}
if (NEW_OWNER === OLD_OWNER && NEW_ENGINE === OLD_ENGINE && NEW_CONSOLE === OLD_CONSOLE) {
  console.error('新 owner / 仓库名与旧值完全相同，无需切换')
  process.exit(1)
}

const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/* ---------- 替换规则：长串在前，避免 stock-alert-console 被 stock-alert 截断 ---------- */
const RULES = [
  [OLD_OWNER + '/' + OLD_CONSOLE, NEW_OWNER + '/' + NEW_CONSOLE],
  [OLD_OWNER + '/' + OLD_ENGINE, NEW_OWNER + '/' + NEW_ENGINE]
]
// owner 单独出现（GH_OWNER 默认值、占位文案等）
if (NEW_OWNER !== OLD_OWNER) RULES.push([OLD_OWNER, NEW_OWNER])

/* 仓库名单独出现的场合：仅当改名时启用，且限定在 GitHub 上下文里，
   避免误伤 stock-alert-console.app.workbuddy.host 这类发布域名 */
const REPO_RULES = []
if (NEW_ENGINE !== OLD_ENGINE) {
  REPO_RULES.push({
    re: new RegExp("(GH_REPO \\|\\| ')" + esc(OLD_ENGINE) + "(')", 'g'),
    to: '$1' + NEW_ENGINE + '$2'
  })
  REPO_RULES.push({
    re: new RegExp("(GITHUB_REPOSITORY \\|\\| ')" + esc(OLD_ENGINE) + "(')", 'g'),
    to: '$1' + NEW_ENGINE + '$2'
  })
}
if (NEW_CONSOLE !== OLD_CONSOLE) {
  REPO_RULES.push({
    re: new RegExp('(控制台\\+测试单独建 )`?' + esc(OLD_CONSOLE) + '`?( 仓)', 'g'),
    to: '$1' + NEW_CONSOLE + '$2'
  })
}

/* ---------- 扫描范围 ---------- */
const INC_DIRS = ['stock-alert-console', 'stock-alert-cloud', 'fusion-tracker', 'stock-console-mp/tools', '_tests']
const INC_FILES = ['股票监控系统-需求与方案说明.md', '主力博弈监测系统-验收报告.md', 'WORKBUDDY_TASKS.md']
const EXC_PATH = [
  /(^|[\\/])\.workbuddy([\\/]|$)/,        // ★ 记忆是历史，绝不改
  /(^|[\\/])_cache([\\/]|$)/,
  /(^|[\\/])_research([\\/]|$)/,
  /(^|[\\/])_recon([\\/]|$)/,
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])\.git([\\/]|$)/,
  // ★ 本脚本自身与搬家器自身：它们的「旧 owner 默认值」必须保持 zyhaaad，
  //   否则改完自己就找不到源仓了（自伤）
  /(^|[\\/])switch-repo\.js$/,
  /(^|[\\/])copy-repo\.js$/,
  /\.bak-\d+$/, /\.log$/, /^_tmp_/, /(^|[\\/])_[\s\S]*\.txt$/
]
const EXT_OK = /\.(js|mjs|cjs|html|json|yml|yaml|md|ts|tsx|py|wxml|wxss)$/i

function walk(abs, rel, out) {
  let ents
  try { ents = fs.readdirSync(abs, { withFileTypes: true }) } catch (e) { return }
  for (const e of ents) {
    const r = rel ? rel + '/' + e.name : e.name
    if (EXC_PATH.some(re => re.test(r))) continue
    const a = path.join(abs, e.name)
    if (e.isDirectory()) walk(a, r, out)
    else if (EXT_OK.test(e.name)) out.push({ rel: r, abs: a })
  }
}

const files = []
for (const d of INC_DIRS) walk(path.join(ROOT, d), d, files)
for (const f of INC_FILES) {
  const abs = path.join(ROOT, f)
  if (fs.existsSync(abs)) files.push({ rel: f, abs })
}

/* ---------- 应用 ---------- */
function applyRules(text) {
  let out = text
  for (const [from, to] of RULES) {
    if (from === to) continue
    out = out.split(from).join(to)
  }
  for (const r of REPO_RULES) out = out.replace(r.re, r.to)
  return out
}

const changed = []
for (const f of files) {
  const before = fs.readFileSync(f.abs, 'utf8')
  const after = applyRules(before)
  if (after === before) continue
  const bl = before.split('\n'), al = after.split('\n')
  const hits = []
  for (let i = 0; i < bl.length; i++) {
    if (bl[i] !== al[i]) hits.push({ line: i + 1, before: bl[i].trim(), after: al[i].trim() })
  }
  changed.push({ rel: f.rel, abs: f.abs, hits, after })
}

/* ---------- 报告 ---------- */
console.log('旧 owner：' + OLD_OWNER + '   新 owner：' + NEW_OWNER)
console.log('仓库名：  ' + OLD_ENGINE + ' / ' + OLD_CONSOLE + '  →  ' + NEW_ENGINE + ' / ' + NEW_CONSOLE)
console.log('模式：    ' + (APPLY ? '★ 执行写入' : 'dry-run（不加 --apply 不会写盘）'))
console.log('扫描：    ' + files.length + ' 个文件')
console.log('')

const totalHits = changed.reduce((n, c) => n + c.hits.length, 0)
if (!changed.length) {
  console.log('没有任何文件包含旧地址 —— 无需切换（可能已经切过了）')
  process.exit(0)
}

for (const c of changed) {
  console.log('■ ' + c.rel + '  （' + c.hits.length + ' 行）')
  for (const h of c.hits.slice(0, 3)) {
    console.log('    L' + h.line)
    console.log('      - ' + h.before.slice(0, 150))
    console.log('      + ' + h.after.slice(0, 150))
  }
  if (c.hits.length > 3) console.log('    … 另有 ' + (c.hits.length - 3) + ' 行同类改动')
  console.log('')
}

console.log('================ 汇总 ================')
console.log('  涉及文件 ' + changed.length + ' 个 / 改动行 ' + totalHits + ' 行')

if (!APPLY) {
  console.log('\n（dry-run 结束。逐条确认后加 --apply 执行）')
  process.exit(0)
}

let written = 0
for (const c of changed) {
  fs.writeFileSync(c.abs, c.after, 'utf8')
  written++
}
console.log('  ✅ 已写盘 ' + written + ' 个文件')
console.log('\n★ 切换后的必做动作（顺序不能颠倒）：')
console.log('  1) 跑回归：node _tests/publish-guard.js 与逐项回归')
console.log('  2) 重新生成预览：node _tests/console-check.js（design-preview.html 是它的产物）')
console.log('  3) 发布控制台后跑 _tests/accept-online.js 验收')
