#!/usr/bin/env node
/* 把 rotation.json 内嵌进 console.html 的 ROT_BUILTIN 标记位（离线兜底数据）
 *
 * 为什么必须内嵌：控制台优先读云端 rotation.json，但云端文件需要 token 才能上传。
 * 内嵌一份保证「页面一发布就有内容」，云端文件到位后会自动覆盖内嵌数据（代码里云端优先）。
 *
 * 用法：
 *   node _tests/inject-rotation.js            # 注入
 *   node _tests/inject-rotation.js --check    # 只校验标记存在，不写
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const CONSOLE = path.join(ROOT, 'stock-alert-console', 'console.html')
const DATA = path.join(ROOT, '_research', 'rotation', 'rotation.json')
const S = '/*ROT_BUILTIN_S*/', E = '/*ROT_BUILTIN_E*/'

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

const check = process.argv.indexOf('--check') >= 0
let html = fs.readFileSync(CONSOLE, 'utf8')
const re = new RegExp(esc(S) + '[\\s\\S]*?' + esc(E))
if (!re.test(html)) {
  console.error('❌ 找不到注入标记 ' + S + ' ... ' + E + '（console.html 结构被改动？）')
  process.exit(1)
}
if (check) {
  const cur = html.match(re)[0]
  console.log('✅ 标记存在，当前内嵌数据长度 ' + cur.length + ' 字节' + (cur.length < 100 ? '（仍为 null 占位）' : ''))
  process.exit(0)
}
if (!fs.existsSync(DATA)) { console.error('❌ 找不到 ' + DATA); process.exit(1) }
const data = fs.readFileSync(DATA, 'utf8').trim()
JSON.parse(data)                       /* 先验证是合法 JSON，避免写坏文件 */
const next = html.replace(re, S + data + E)
fs.writeFileSync(CONSOLE, next)
console.log('✅ 已注入 rotation.json → ROT_BUILTIN')
console.log('   数据 ' + (data.length / 1024).toFixed(1) + ' KB · console.html ' +
  fs.readFileSync(CONSOLE).length + ' 字节')
