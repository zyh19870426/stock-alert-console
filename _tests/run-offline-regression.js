#!/usr/bin/env node
/* eslint-disable */
/* 全量离线回归（按依赖顺序），逐项退出码，最后汇总 */
const { execFileSync } = require('child_process')
const path = require('path')
const T = (f) => path.join(__dirname, f)
const NODE = process.execPath

const STEPS = [
  { name: 'build-preview（DOM 测试前置，必须先跑）', file: T('build-preview.js') },
  /* ★ 2026-10-10 新增：归属重建后必须有专职回归。它直接读 console.html（不依赖 preview 产物）
     并自带 3 条反向锁 + 全市场结构性断言（行业名必须出自该票自己的官方路径）。 */
  { name: 'bkmap-test（个股→板块/题材归属，官方口径 + 反向锁）', file: T('bkmap-test.js') },
  { name: 'fng-core-test', file: T('fng-core-test.js') },
  { name: 'fng-fallback-test', file: T('fng-fallback-test.js') },
  { name: 'fng-heartbeat-test', file: T('fng-heartbeat-test.js') },
  { name: 'fng-extreme-test', file: T('fng-extreme-test.js') },
  { name: 'fng-ux-test', file: T('fng-ux-test.js') },
  { name: 'fng-dom-test', file: T('fng-dom-test.js') },
  { name: 'position-core-test', file: T('position-core-test.js') },
  { name: 'chip-test', file: T('chip-test.js') },
  { name: 'signal-core-test', file: T('signal-core-test.js') },
  { name: 'signals-push-test', file: T('signals-push-test.js') },
  { name: 'leader-engine-test（龙头战法纯函数）', file: T('leader-engine-test.js') },
  { name: 'style-engine-test（风格驾驶舱纯函数）', file: T('style-engine-test.js') },
  { name: 'console-logic', file: T('console-logic.js') },
  { name: 'console-check', file: T('console-check.js') },
  { name: 'position-dom-test（依赖 build-preview 产物）', file: T('position-dom-test.js') },
  /* ★ 2026-10-10 补入：这两项此前只在 _cache/ 里手跑，长期不在清单里 ⇒ 契约漂了没人发现。 */
  { name: 'mainline-check（当前主线 + 归属，自带确定性截面）', file: T('_cache/mainline-check.js') },
  { name: 'fix1010-check（首屏硬预算 + 持仓板块行 + 自激刹车）', file: T('_cache/fix1010-check.js') },
]

let fail = 0
for (const s of STEPS) {
  process.stdout.write('>> ' + s.name + '\n')
  let out = ''
  let code = 0
  try { out = execFileSync(NODE, [s.file], { encoding: 'utf8', timeout: 5 * 60 * 1000 }) } catch (e) { code = e.status || 1; out = (e.stdout || '') + (e.stderr || '') }
  const lines = out.trim().split('\n')
  for (const l of lines.slice(-6)) process.stdout.write('   ' + l + '\n')
  if (code !== 0) { fail++; process.stdout.write('   ❌ 退出码 ' + code + '\n') }
}
process.stdout.write('\n===== 回归汇总：' + (fail ? fail + ' 项失败' : '全部通过') + ' =====\n')
process.exit(fail ? 1 : 0)
