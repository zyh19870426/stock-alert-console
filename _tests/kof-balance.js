/*
 * 拳意 CLASH ARENA —— AI 对战平衡性检查
 * 目的：用「AI 打 AI」批量跑，看两个原创角色胜率是否失衡、对局是否收敛（不会出现无限连/龟缩到时间到）。
 * 运行：node _tests/kof-balance.js [场次]
 * 说明：固定种子 → 结果可复现；改帧数/AI 后重跑即可对比。
 */
'use strict';
var fs = require('fs');
var vm = require('vm');
var path = require('path');

var HTML = path.resolve(__dirname, '..', 'kof-like', 'index.html');
var src = fs.readFileSync(HTML, 'utf8');
var m = src.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.log('FAIL: 未找到内联 script'); process.exit(1); }

var SEED = parseInt(process.env.KOF_SEED || '987654321', 10);
function rnd() { SEED = (SEED * 1103515245 + 12345) & 0x7fffffff; return SEED / 0x7fffffff; }

function boot() {
  var sb = {};
  sb.window = sb;
  sb.document = { getElementById: function () { return null; } };
  sb.Math = Object.create(Math); sb.Math.random = rnd;
  sb.console = console; sb.Date = Date; sb.JSON = JSON;
  sb.isFinite = isFinite; sb.parseInt = parseInt; sb.parseFloat = parseFloat;
  vm.createContext(sb);
  vm.runInContext(m[1], sb, { filename: 'index.html' });
  return sb.window.KOF;
}
var K = boot();

var N = parseInt(process.argv[2] || '30', 10);
var MAXF = 60 * 60 * 4;                 // 4 分钟硬上限，防死循环

function oneMatch(lv) {
  K.fxReset();
  var M = K.makeMatch('xun', 'yan', lv);
  M.p[0].ai = K.makeAI(lv);            // 双 AI 对战
  M.state = 'fight';
  var hits = [0, 0], distSum = 0, frames = 0, hp = [M.p[0].hp, M.p[1].hp];
  while (M.matchWinner < 0 && frames < MAXF) {
    K.stepMatch(M);
    frames++;
    for (var i = 0; i < 2; i++) {
      if (M.p[i].hp < hp[i]) { hits[1 - i]++; hp[i] = M.p[i].hp; }
    }
    distSum += Math.abs(M.p[0].x - M.p[1].x);
  }
  return {
    winner: M.matchWinner, frames: frames,
    sec: frames / 60, hits: hits,
    dist: frames ? distSum / frames : 0,
    timeout: M.matchWinner < 0
  };
}

var win = [0, 0], timeouts = 0, secSum = 0, hitSum = [0, 0], distSum = 0;
for (var i = 0; i < N; i++) {
  var r = oneMatch(2);
  if (r.timeout) { timeouts++; console.log('  #' + i + ' 超时未分胜负'); continue; }
  win[r.winner]++;
  secSum += r.sec;
  hitSum[0] += r.hits[0]; hitSum[1] += r.hits[1];
  distSum += r.dist;
}
var done = N - timeouts;
console.log('—— ' + N + ' 场 AI(Lv2) 对战 ——');
console.log('迅 胜 ' + win[0] + ' / 岩 胜 ' + win[1] +
  '  (' + (done ? Math.round(win[0] / done * 100) : 0) + '% / ' + (done ? Math.round(win[1] / done * 100) : 0) + '%)');
console.log('平均时长 ' + (done ? (secSum / done).toFixed(1) : '-') + ' 秒');
console.log('平均命中 迅 ' + (done ? (hitSum[0] / done).toFixed(1) : '-') +
  ' / 岩 ' + (done ? (hitSum[1] / done).toFixed(1) : '-'));
console.log('平均距离 ' + (done ? (distSum / done).toFixed(0) : '-') + ' px');
console.log('超时场次 ' + timeouts);
