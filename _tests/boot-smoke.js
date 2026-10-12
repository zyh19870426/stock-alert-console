/* boot 冒烟测试（2026-09-25 事故后新增）：jsdom 完整 boot 预览副本，
 * 断言零页面错误 + 关键函数定义 + 首页统计卡/推荐渲染 + 二次渲染无抛错。
 * 背景：ASI 陷阱（var x = 2 后紧跟注入 IIFE）与 G.dayBars 未防护都能过字符串验收、
 * 只有真 boot 才暴露 —— 改 console.html 后必跑本测试（需先跑 build-preview.js）。
 * 运行：node _tests/build-preview.js && node _tests/boot-smoke.js
 * （本沙盒 spawnSync 不可用 → build-preview 的 node --check 项必假失败，忽略之，
 *   但其预览副本生成与注入自检不受影响。） */
'use strict';
const fs = require('fs'), path = require('path');
const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules';
module.paths.push(WS);
const { JSDOM, VirtualConsole } = require(path.join(WS, 'jsdom'));

let html = fs.readFileSync('D:/mywork/_preview/stock-picker-preview.html', 'utf8');
/* 主脚本整体包 try/catch：eval 期同步错误也能拿到消息（jsdom 的 Uncaught 无堆栈） */
const parts = html.split('<script>');
const main = parts[2];
const ci = main.lastIndexOf('</script>');
const code = main.slice(0, ci), rest = main.slice(ci);
const wrap = 'try{\n' + code + '\n}catch(e){ console.log("CAUGHT_SYNC: " + e.message) }\n';
parts[2] = wrap + rest;
html = parts.join('<script>');

const logs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => logs.push('JSDOM_ERR: ' + e.message));
vc.on('log', (...a) => logs.push(a.join(' ')));
const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole: vc, url: 'https://local/' });
const w = dom.window;

let pass = 0, fail = 0; const fails = [];
const ok = (c, n) => { c ? pass++ : (fail++, fails.push(n)); };

setTimeout(() => {
  const errs = logs.filter(x => x.indexOf('JSDOM_ERR') >= 0 || x.indexOf('CAUGHT_SYNC') >= 0);
  ok(errs.length === 0, 'boot 零页面错误' + (errs.length ? '：' + errs[0] : ''));
  ok(typeof w.demoV3Data === 'function', '主脚本执行完整（demoV3Data 已定义；被 ASI/中断则会缺失）');
  ok(typeof w.StageCore !== 'undefined', 'StageCore 注入块可用');
  ok(typeof w.emGet === 'function' && typeof w.tencentQuotes === 'function' && typeof w.fetchT === 'function' && typeof w.onerror === 'function', '行情降级链（emGet/tencentQuotes/fetchT）与全局错误横幅就位（2026-09-28 健壮性改造）');
  ok(typeof w.flowOpen === 'function' && typeof w.flowRender === 'function' && typeof w.flowSection === 'function' && typeof w.flowPack === 'function' && typeof w.flowRank2 === 'function' && typeof w.flowCompute === 'function', '资金流向监控页（两栏TOP10+圆球+金额×天数综合排名）就位（2026-09-30）');
  ok(typeof w.catLoad === 'function' && typeof w.catStars === 'function' && typeof w.catJsonp === 'function', '消息催化页（catLoad/catStars/catJsonp）就位（2026-09-29）');
  ok(typeof w.renderDash === 'function' && typeof w.renderPicks === 'function', 'renderDash/renderPicks 已定义');
  ok(w.document.body.innerHTML.indexOf('阶段信号有效性') >= 0, '首页渲染出阶段统计卡');
  ok(w.document.body.innerHTML.indexOf('距触发最近') >= 0, '首页渲染出「距触发最近」（首页主体完整）');
  try { w.renderDash(); ok(true, 'renderDash 二次调用无抛错'); }
  catch (e) { ok(false, 'renderDash 二次调用抛错: ' + e.message); }
  try { w.renderPicks(); ok(true, 'renderPicks 二次调用无抛错'); }
  catch (e) { ok(false, 'renderPicks 二次调用抛错: ' + e.message); }

  console.log('================ boot 冒烟 ================');
  console.log('通过：' + pass + '    失败：' + fail);
  if (fail) { console.log('失败项：'); fails.forEach(f => console.log('  - ' + f)); }
  console.log(fail === 0 ? '结果：ALL GREEN' : '结果：存在失败项');
  process.exit(fail ? 1 : 0);
}, 2500);
