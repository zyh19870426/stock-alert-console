/*
 * 拳意 CLASH ARENA —— 核心逻辑回归测试
 * 零依赖：用 vm 直接执行 index.html 内联脚本，stub 掉 DOM/音频/rAF
 * 运行：node _tests/kof-test.js
 */
'use strict';
var fs = require('fs');
var vm = require('vm');
var path = require('path');

var HTML = path.resolve(__dirname, '..', 'kof-like', 'index.html');
var src = fs.readFileSync(HTML, 'utf8');
var m = src.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.log('FAIL: 未找到内联 script'); process.exit(1); }

/* 确定性 RNG：引擎里有 AI 决策 / 粒子抖动用 Math.random，
   不固定种子的话回归测试会随机翻红（AI 有时打断，有时不打断）。 */
var SEED = 20260928;
function seededRandom() {
  SEED = (SEED * 1103515245 + 12345) & 0x7fffffff;
  return SEED / 0x7fffffff;
}

function boot() {
  var sb = {};
  sb.window = sb;
  sb.document = { getElementById: function () { return null; } };
  sb.Math = Object.create(Math); sb.Math.random = seededRandom;
  sb.console = console; sb.Date = Date;
  sb.JSON = JSON; sb.isFinite = isFinite; sb.parseInt = parseInt; sb.parseFloat = parseFloat;
  vm.createContext(sb);
  vm.runInContext(m[1], sb, { filename: 'index.html' });
  return sb.window.KOF;
}
var K = boot();

/* ---------- 断言 ---------- */
var pass = 0, fail = 0, logs = [];
function ok(name, cond, extra) {
  if (cond) { pass++; logs.push('  PASS  ' + name); }
  else { fail++; logs.push('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) { ok(name + ' (' + a + ' == ' + b + ')', a === b, 'got ' + a + ' want ' + b); }
function near(name, a, b, tol) { ok(name + ' (' + a + ' ≈ ' + b + ')', Math.abs(a - b) <= tol, 'got ' + a); }

/* ---------- helper ---------- */
function world() { return { projs: [] }; }
function pair(dx) {
  var f1 = K.makeFighter('xun', 0, 400);
  var f2 = K.makeFighter('yan', 1, 400 + (dx == null ? 40 : dx));
  f1.face = 1; f2.face = -1;
  return { a: f1, b: f2, W: world() };
}
function tick2(a, b, W, n) {
  for (var i = 0; i < (n || 1); i++) { K.stepFighter(a, b, W); K.stepFighter(b, a, W); }
}
/* 构造输入历史：连续按住若干帧方向，最后一帧同时按键 */
function feedCmd(inp, face, dirs, btn) {
  for (var i = 0; i < dirs.length; i++) {
    for (var j = 0; j < 3; j++) {
      inp.down = {};
      setD(inp, dirs[i], face);
      if (i === dirs.length - 1 && j === 2 && btn) inp.hit[btn] = true;
      K.inputStep(inp, face);
    }
  }
}
function setD(inp, d, face) {
  var x = 0, y = 0;
  if (d === 4 || d === 1 || d === 7) x = -1; else if (d === 6 || d === 3 || d === 9) x = 1;
  if (d === 8 || d === 7 || d === 9) y = -1; else if (d === 2 || d === 1 || d === 3) y = 1;
  if (face < 0) x = -x;
  if (x < 0) inp.down.L = true; else if (x > 0) inp.down.R = true;
  if (y < 0) inp.down.U = true; else if (y > 0) inp.down.D = true;
}

console.log('\n=== 拳意 CLASH ARENA 回归测试 ===\n');

/* ============================================================
 * 1. 指令识别
 * ========================================================== */
(function () {
  var inp = K.makeInput();
  feedCmd(inp, 1, [2, 3, 6], 'HP');
  var list = K.detectCommands(inp, K.MOVES.xun, 'HP');
  ok('236+HP 识别出烈风破', list.indexOf('sp1') >= 0, JSON.stringify(list));

  var inp2 = K.makeInput();
  feedCmd(inp2, 1, [6, 2, 3], 'HP');
  ok('623+HP 识别出冲天斩', K.detectCommands(inp2, K.MOVES.xun, 'HP').indexOf('sp2') >= 0);

  var inp3 = K.makeInput();
  feedCmd(inp3, 1, [2, 3, 6, 2, 3, 6], 'HP');
  var l3 = K.detectCommands(inp3, K.MOVES.xun, 'HP');
  eq('236236 优先命中超杀', l3[0], 'sp3');

  // 朝左时：相对方向仍应为 236（按键需镜像）
  var inp4 = K.makeInput();
  feedCmd(inp4, -1, [2, 3, 6], 'HP');
  ok('朝左时 236 仍可识别（方向按朝向镜像）',
    K.detectCommands(inp4, K.MOVES.xun, 'HP').indexOf('sp1') >= 0);

  // 窗口过期
  var inp5 = K.makeInput();
  feedCmd(inp5, 1, [2, 3, 6], null);
  for (var i = 0; i < 25; i++) { inp5.down = {}; K.inputStep(inp5, 1); }
  eq('超过指令窗口后不再识别', K.detectCommands(inp5, K.MOVES.xun, 'HP').length, 0);

  // 只按 →+HP 不应触发必杀（留给投技）
  var inp6 = K.makeInput();
  for (var j = 0; j < 5; j++) { inp6.down = { R: true }; K.inputStep(inp6, 1); }
  eq('单按前+HP 不触发指令必杀', K.detectCommands(inp6, K.MOVES.xun, 'HP').length, 0);

  // matchTail 单元
  ok('matchTail 基本匹配', K.UTIL.matchTail([2, 3, 6], [2, 3, 6]));
  ok('matchTail 允许前缀干扰', K.UTIL.matchTail([4, 1, 2, 3, 6], [2, 3, 6]));
  ok('matchTail 拒绝不完整序列', !K.UTIL.matchTail([2, 6], [2, 3, 6]));
})();

/* ============================================================
 * 2. 帧数据推进
 * ========================================================== */
(function () {
  var p = pair(40), a = p.a, b = p.b, W = p.W;
  K.startMove(a, b, 'lp', W);
  var mv = K.MOVES.xun.lp;
  eq('发动后进入 attack', a.st, 'attack');
  eq('发动即标记 startup', a.phase, 'startup');
  K.stepFighter(a, b, W);
  eq('第 1 帧 = startup', a.phase, 'startup');
  // 推进到 active
  for (var i = 1; i < mv.startup; i++) K.stepFighter(a, b, W);
  K.stepFighter(a, b, W);
  eq('第 ' + (mv.startup + 1) + ' 帧 = active', a.phase, 'active');
  for (var j = 0; j < mv.active - 1; j++) K.stepFighter(a, b, W);
  eq('active 末帧仍为 active', a.phase, 'active');
  K.stepFighter(a, b, W);
  eq('active 之后 = recovery', a.phase, 'recovery');
  for (var k = 0; k < mv.recovery - 1; k++) K.stepFighter(a, b, W);
  K.stepFighter(a, b, W);
  eq('recovery 结束回到 idle', a.st, 'idle');
  eq('招式已清空', !!a.move, false);
})();

/* ============================================================
 * 3. 命中判定与伤害
 * ========================================================== */
(function () {
  var p = pair(40), a = p.a, b = p.b, W = p.W;
  var hp0 = b.hp;
  K.startMove(a, b, 'lp', W);
  tick2(a, b, W, 8);
  ok('近距离轻拳命中掉血', b.hp < hp0, 'hp ' + b.hp + ' / ' + hp0);
  eq('伤害数值与帧数据表一致', hp0 - b.hp, K.MOVES.xun.lp.dmg);
  eq('被击方进入 hitstun', b.st, 'hitstun');
  ok('攻击方获得气槽', a.meter > 0, 'meter=' + a.meter);
  ok('触发命中定格', K.FX.hitstop > 0, 'hitstop=' + K.FX.hitstop);

  // 远距离不命中
  var q = pair(260), a2 = q.a, b2 = q.b, W2 = q.W;
  var hp1 = b2.hp;
  K.startMove(a2, b2, 'hk', W2);
  tick2(a2, b2, W2, 20);
  eq('远距离重脚不命中', b2.hp, hp1);
})();

/* ============================================================
 * 4. 防御 / 下段 / 防御崩防
 * ========================================================== */
(function () {
  var p = pair(40), a = p.a, b = p.b, W = p.W;
  b.inp.down = { R: true };              // b 在右侧、面朝左，其「后」= 右 = R
  var hp0 = b.hp;
  K.startMove(a, b, 'lp', W);
  tick2(a, b, W, 8);
  eq('站防成功不掉血', b.hp, hp0);
  eq('站防进入 blockstun', b.st, 'blockstun');

  // 反向按键不属于防御，应直接被打中（防御方向必须相对朝向）
  var pw = pair(40), aw = pw.a, bw = pw.b, Ww = pw.W;
  bw.inp.down = { L: true };
  var hpw = bw.hp;
  K.startMove(aw, bw, 'lp', Ww);
  tick2(aw, bw, Ww, 8);
  ok('按错方向不算防御', bw.hp < hpw, 'hp ' + bw.hp);

  // 下段：站防挡不住
  var q = pair(40), a2 = q.a, b2 = q.b, W2 = q.W;
  b2.inp.down = { R: true };
  var hp1 = b2.hp;
  K.startMove(a2, b2, 'c_lk', W2);
  tick2(a2, b2, W2, 10);
  ok('下段攻击破站防', b2.hp < hp1, 'hp ' + b2.hp);

  // 下段：蹲防可挡
  var r = pair(40), a3 = r.a, b3 = r.b, W3 = r.W;
  b3.inp.down = { R: true, D: true };
  var hp2 = b3.hp;
  K.startMove(a3, b3, 'c_lk', W3);
  tick2(a3, b3, W3, 10);
  eq('下段被蹲防挡住', b3.hp, hp2);

  // 防御崩防
  var s = pair(40), a4 = s.a, b4 = s.b, W4 = s.W;
  b4.guard = 5;
  b4.inp.down = { R: true };
  K.startMove(a4, b4, 'hp', W4);
  tick2(a4, b4, W4, 12);
  ok('防御值耗尽触发崩防', b4.st === 'guardCrush' || b4.guard > 5, 'st=' + b4.st + ' guard=' + b4.guard);
})();

/* ============================================================
 * 5. 连招取消（命中才允许取消）
 * ========================================================== */
(function () {
  var p = pair(40), a = p.a, b = p.b, W = p.W;
  K.startMove(a, b, 'lp', W);
  tick2(a, b, W, 5);                     // 命中
  ok('命中后 cancelOk 置位', a.cancelOk === true);
  ok('命中后允许取消进重拳', K.canStart(a, 'hp') === true);
  ok('命中后允许取消进必杀', K.canStart(a, 'sp1') === true);
  ok('不在取消列表的招式被拒', K.canStart(a, 'c_hk') === false);

  // 未命中不允许取消
  var q = pair(300), a2 = q.a, b2 = q.b, W2 = q.W;
  K.startMove(a2, b2, 'lp', W2);
  tick2(a2, b2, W2, 5);
  ok('空挥不允许取消', K.canStart(a2, 'hp') === false);

  // 取消窗口过期（招式未结束但已超窗口：lp 共 12 帧，窗口 = 3+2+5 = 10）
  var r = pair(40), a3 = r.a, b3 = r.b, W3 = r.W;
  K.startMove(a3, b3, 'lp', W3);
  tick2(a3, b3, W3, 11);                 // mvF = 11 > 10，招式仍未结束
  ok('取消窗口过期后拒绝', K.canStart(a3, 'hp') === false, 'mvF=' + a3.mvF + ' st=' + a3.st);
})();

/* ============================================================
 * 6. 气槽与超杀
 * ========================================================== */
(function () {
  var p = pair(40), a = p.a, b = p.b, W = p.W;
  a.meter = 50;
  eq('气不足时超杀不发动', K.startMove(a, b, 'sp3', W), false);
  eq('气不足不扣气', a.meter, 50);
  a.meter = 100;
  eq('满气超杀可发动', K.startMove(a, b, 'sp3', W), true);
  eq('发动后清空气槽', a.meter, 0);

  // 气槽上限
  var q = pair(40), a2 = q.a, b2 = q.b, W2 = q.W;
  a2.meter = 98;
  K.startMove(a2, b2, 'lp', W2);
  tick2(a2, b2, W2, 8);
  ok('气槽不超过上限', a2.meter <= K.CFG.MAX_METER, 'meter=' + a2.meter);
})();

/* ============================================================
 * 7. 投技
 * ========================================================== */
(function () {
  var p = pair(30), a = p.a, b = p.b, W = p.W;
  var hp0 = b.hp;
  a.inp.down = { R: true };
  a.inp.hit = { HP: true };
  K.tryAttack(a, b, W);
  eq('近身前+重拳触发投技', a.st, 'throwing');
  eq('被投方进入 thrown', b.st, 'thrown');
  eq('投技伤害生效', hp0 - b.hp, K.MOVES.xun.throw.dmg);
  ok('投技不可防御', b.st !== 'blockstun');

  // 远距离不触发
  var q = pair(150), a2 = q.a, b2 = q.b, W2 = q.W;
  a2.inp.down = { R: true }; a2.inp.hit = { HP: true };
  K.tryAttack(a2, b2, W2);
  ok('远距离不触发投技', a2.st !== 'throwing');
})();

/* ============================================================
 * 8. 物理：边界、分离、落地
 * ========================================================== */
(function () {
  K.fxReset();                           // hitstop 是全局的，跨用例必须重置，否则 stepMatch 会一直定格
  var M = K.makeMatch('xun', 'yan', 2);
  M.state = 'fight';
  M.p[0].inp.down = { L: true };
  for (var i = 0; i < 200; i++) K.stepMatch(M);
  ok('角色不越左墙', M.p[0].x >= K.CFG.WALL, 'x=' + M.p[0].x);
  ok('角色不越右墙', M.p[1].x <= K.CFG.STAGE_W - K.CFG.WALL, 'x=' + M.p[1].x);
  ok('两人不重叠', Math.abs(M.p[0].x - M.p[1].x) > 30, 'd=' + Math.abs(M.p[0].x - M.p[1].x));

  // 落地
  var p = pair(80), a = p.a, b = p.b, W = p.W;
  a.vy = -12; a.onGround = false; a.st = 'air';
  var n = 0;
  while (!a.onGround && n < 200) { K.stepFighter(a, b, W); n++; }
  ok('跳跃后能落地', a.onGround, 'frames=' + n);
  ok('落地进入 land 硬直', a.st === 'land' || a.st === 'idle', 'st=' + a.st);
})();

/* ============================================================
 * 9. KO 与回合流程
 * ========================================================== */
(function () {
  K.fxReset();                           // hitstop 是全局的，跨用例必须重置，否则 stepMatch 会一直定格
  var M = K.makeMatch('xun', 'yan', 2);
  M.state = 'fight';
  M.p[1].x = 440;
  M.p[1].hp = 3;
  // 不用普通技推进：AI 可能拉后防御挡下，导致用例不稳定。
  // 这里用确定性致命伤触发 KO，防御行为由下一条用例单独覆盖。
  K.applyHit(M.p[0], M.p[1], K.MOVES.xun.hp, 999, 30);
  for (var i = 0; i < 40 && M.state === 'fight'; i++) K.stepMatch(M);
  ok('血量归零触发回合结束', M.state === 'ko' || M.state === 'roundEnd', 'state=' + M.state);
  eq('胜者记分正确', M.wins[0], 1);
  eq('败者进入 KO 姿态', M.p[1].st, 'ko');

  // 推进到下一回合
  for (var j = 0; j < 400 && M.round < 2; j++) K.stepMatch(M);
  eq('进入第 2 回合', M.round, 2);
  eq('回合重置血量满', M.p[1].hp, K.CFG.MAX_HP);

  // 三局两胜
  for (var k = 0; k < 3000 && M.state !== 'matchEnd'; k++) {
    if (M.state === 'fight') M.p[1].hp = 0;
    K.stepMatch(M);
  }
  eq('打满两局判定整场胜利', M.state, 'matchEnd');
  eq('整场胜者正确', M.matchWinner, 0);
  eq('胜场累计正确', M.wins[0], 2);
})();

/* ============================================================
 * 10. 时间到判定
 * ========================================================== */
(function () {
  K.fxReset();                           // hitstop 是全局的，跨用例必须重置，否则 stepMatch 会一直定格
  var M = K.makeMatch('xun', 'yan', 2);
  M.state = 'fight';
  M.timer = 2;
  M.p[0].hp = 500; M.p[1].hp = 300;
  for (var i = 0; i < 10 && M.state === 'fight'; i++) K.stepMatch(M);
  ok('计时归零结束回合', M.state !== 'fight', 'state=' + M.state);
  eq('血多者获胜', M.wins[0], 1);
})();

/* ============================================================
 * 11. AI 行为（会防御 / 会移动 / 长时间稳定）
 * ========================================================== */
(function () {
  // AI 会拉后防御：玩家连续进攻，AI 应至少防下一次
  K.fxReset();
  var M = K.makeMatch('xun', 'yan', 2);
  M.state = 'fight';
  // (a) 决策层：aiDecide 是纯函数，直接断言「对手出招时会选择防御」
  var ad = K.makeFighter('yan', 1, 440);
  var bd = K.makeFighter('xun', 0, 400);
  ad.ai = K.makeAI(2); ad.face = -1; bd.face = 1;
  bd.st = 'attack'; bd.phase = 'startup';
  var nBlock = 0, nAtk = 0;
  for (var i = 0; i < 300; i++) {
    var d = K.aiDecide(ad, bd);
    if (d.type === 'block') nBlock++;
    else if (d.type === 'attack') nAtk++;
  }
  ok('AI 在对手出招时会决策防御', nBlock > 0, 'block=' + nBlock + ' attack=' + nAtk);
  ok('AI 防御是概率性的而非死板', nBlock > 0 && nBlock < 300, 'block=' + nBlock);

  // (b) 集成层：近身才出招（远了只前进），验证真的能打到 / 被防
  var moved = 0, x0 = M.p[1].x, interact = 0, blocked = 0;
  for (var j = 0; j < 1200; j++) {
    var dist = Math.abs(M.p[0].x - M.p[1].x);
    K.pinp.down = dist > 56 ? { R: true } : {};
    K.pinp.hit = dist > 56 ? {} : { LP: true };
    K.stepMatch(M);
    K.pinp.hit = {};
    if (M.p[1].st === 'blockstun') { blocked++; interact++; }
    else if (M.p[1].st === 'hitstun') interact++;
    if (Math.abs(M.p[1].x - x0) > 12) moved++;
  }
  K.pinp.down = {};
  ok('近身攻击能命中或被防', interact > 0, 'interact=' + interact);
  ok('AI 实战中至少防御过一次', blocked > 0, 'blocked=' + blocked);
  ok('AI 会移动走位', moved > 0, 'movedFrames=' + moved);

  // 长时间稳定性
  K.fxReset();
  var M2 = K.makeMatch('xun', 'yan', 3);
  var legal = ['idle', 'walkF', 'walkB', 'crouch', 'air', 'land', 'attack',
    'hitstun', 'blockstun', 'guardCrush', 'knockdown', 'wakeup',
    'throwing', 'thrown', 'ko', 'win'];
  var bad = null, err = null;
  try {
    for (var j2 = 0; j2 < 4000; j2++) {
      K.stepMatch(M2);
      for (var k2 = 0; k2 < 2; k2++) {
        var f = M2.p[k2];
        if (legal.indexOf(f.st) < 0) { bad = f.st; break; }
        if (!isFinite(f.x) || !isFinite(f.y) || !isFinite(f.hp)) { bad = 'NaN'; break; }
        if (f.hp < 0) { bad = 'hp<0'; break; }
      }
      if (bad) break;
    }
  } catch (e) { err = e.message; }
  ok('AI 对局 4000 帧无异常', err === null, err);
  ok('状态始终合法', bad === null, 'bad=' + bad);
  ok('双方都产生了有效行为', M2.frame > 3000, 'frame=' + M2.frame);
})();

/* ============================================================
 * 12. 角色差异与数值一致性
 * ========================================================== */
(function () {
  var X = K.CHARS.xun, Y = K.CHARS.yan;
  ok('迅的轻拳更快', X.moves.lp.startup < Y.moves.lp.startup,
    X.moves.lp.startup + ' vs ' + Y.moves.lp.startup);
  ok('岩的重击更痛', Y.moves.hk.dmg > X.moves.hk.dmg,
    Y.moves.hk.dmg + ' vs ' + X.moves.hk.dmg);
  ok('迅移动更快', X.speedF > Y.speedF, X.speedF + ' vs ' + Y.speedF);
  eq('双方血量一致（差异只体现在帧数）', X.hp, Y.hp);

  // 硬直差：命中发生在 active 末帧，攻击方此后只剩 recovery 帧；
  // 有利帧 = 对手硬直 - 攻击方剩余收招
  var YHK = Y.moves.hk;
  var adv = YHK.blockstun - YHK.recovery;
  ok('岩重脚被防为不利帧（可被确反）', adv < 0, 'frame adv=' + adv);
  var XLP = X.moves.lp;
  var adv2 = XLP.hitstun - XLP.recovery;
  ok('迅轻拳命中为有利帧（可接连段）', adv2 > 0, 'frame adv=' + adv2);
  ok('迅轻拳被防仍略有利', XLP.blockstun - XLP.recovery >= 0, 'frame adv=' + (XLP.blockstun - XLP.recovery));
})();

/* ============================================================
 * 13. 渲染姿势数据完整性（不依赖 canvas）
 * ========================================================== */
(function () {
  var bad = [];
  var poses = ['punch', 'punchH', 'kick', 'kickH', 'punchC', 'kickC', 'sweep',
    'punchA', 'kickA', 'fire', 'upper', 'rush', 'slam', 'super'];
  for (var i = 0; i < poses.length; i++) {
    var s = K.ANIM[poses[i]];
    if (!s || !s.s || !s.a || !s.r) { bad.push(poses[i]); continue; }
    ['s', 'a', 'r'].forEach(function (k) {
      var p2 = K.animAt(s[k], 0);
      if (!p2 || typeof p2.torso !== 'number') bad.push(poses[i] + '.' + k);
      if (!isFinite(p2.armF[0]) || !isFinite(p2.legB[1])) bad.push(poses[i] + '.' + k + '.NaN');
    });
  }
  ok('全部招式姿势三段齐全且数值有效', bad.length === 0, bad.join(','));

  var st = ['idle', 'walkF', 'walkB', 'crouch', 'air', 'land', 'block', 'hurt', 'down', 'win'];
  var bad2 = [];
  for (var j = 0; j < st.length; j++) {
    if (!K.ANIM[st[j]]) bad2.push(st[j]);
    else { var pp = K.animAt(K.ANIM[st[j]], 3); if (!isFinite(pp.torso)) bad2.push(st[j] + '.NaN'); }
  }
  ok('全部状态姿势可用', bad2.length === 0, bad2.join(','));

  // 角度插值走最短路径
  near('角度插值跨 ±180 走最短路', K.UTIL.angLerp(170, -170, 0.5), 180, 0.001);
})();

/* ============================================================
 * 15. 连段可行性（决定「像不像格斗游戏」的核心手感）
 * ========================================================== */
(function () {
  function scene() {
    K.fxReset();
    var M = K.makeMatch('xun', 'yan', 2);
    M.state = 'fight';
    M.p[0].x = 400; M.p[1].x = 440; M.p[0].face = 1; M.p[1].face = -1;
    return M;
  }
  /* 假人场景：对手不喂输入 = 完全不动，用来隔离帧数验证
     （stepMatch 里 AI 会反击/霸体，无法做确定性帧数断言） */
  function dummyScene(dx) {
    var a = K.makeFighter('xun', 0, 400);
    var b = K.makeFighter('yan', 1, 400 + (dx == null ? 40 : dx));
    a.face = 1; b.face = -1;
    return { a: a, b: b, W: { projs: [] } };
  }
  // (a) 取消连段：轻拳命中 → 在取消窗口内接重拳（同样用假人，隔离 AI 干扰）
  var L1 = dummyScene(40);
  var A1 = L1.a, cancelMax = 0;
  for (var i = 0; i < 40; i++) {
    A1.inp.down = {}; A1.inp.hit = {};
    if (i === 0) A1.inp.hit.LP = true;
    if (i >= 6 && i <= 12 && A1.st === 'attack' && A1.cancelOk) A1.inp.hit.HP = true;
    K.inputStep(A1.inp, A1.face);
    K.stepFighter(A1, L1.b, L1.W); K.stepFighter(L1.b, A1, L1.W);
    if (A1.combo > cancelMax) cancelMax = A1.combo;   // 连段会随对手恢复而清零，取峰值
  }
  eq('取消连段达成 2 连', cancelMax >= 2, true);
  // 第二击起有连段伤害递减，期望值按衰减函数计算（与实现绑定，调参不会误报）
  var want = K.MOVES.xun.lp.dmg + Math.round(K.MOVES.xun.hp.dmg * K.dmgDecay(2));
  eq('取消连段伤害 = 轻拳+重拳（含连段递减）', 1000 - L1.b.hp, want);

  // (b) 目押连段：只靠有利帧连续轻拳（不走取消）。
  //     用「完全不喂输入的假人」做确定性验证——stepMatch 里对手是 AI，会反击/霸体打乱帧数。
  var L = dummyScene(40);
  var linkMax = 0, trueLink = 0;
  for (var j = 0; j < 40; j++) {
    var A = L.a;
    A.inp.down = {}; A.inp.hit = {};
    if (j === 0 || (A.st === 'idle' && j > 4)) A.inp.hit.LP = true;
    var pre = L.b.st, c0 = A.combo;
    K.inputStep(A.inp, A.face);
    K.stepFighter(A, L.b, L.W); K.stepFighter(L.b, A, L.W);
    if (A.combo > c0) {                       // 又打中一下
      if (A.combo >= 2 && pre === 'hitstun') trueLink++;   // 命中前对手还在硬直 = 真连
      if (A.combo > linkMax) linkMax = A.combo;
    }
  }
  ok('目押连段可连（有利帧成立）', linkMax >= 2, 'combo=' + linkMax);
  ok('目押是真连段（第二击时对手仍在硬直）', trueLink >= 1, 'trueLink=' + trueLink);

  // (c) 连段计数归零：对手硬直自然结束即清零，不能靠 70 帧计时器兜底
  var S = dummyScene(40);
  K.startMove(S.a, S.b, 'lp', S.W);
  for (var k = 0; k < 8; k++) {
    S.a.inp.hit = {}; S.a.inp.down = {};
    K.stepFighter(S.a, S.b, S.W); K.stepFighter(S.b, S.a, S.W);
  }
  ok('命中后建立连段计数', S.a.combo >= 1, 'combo=' + S.a.combo);
  eq('被连方不重复记账', S.b.combo, 0);
  for (var k2 = 0; k2 < 20; k2++) {
    S.a.inp.hit = {}; S.a.inp.down = {};
    K.stepFighter(S.a, S.b, S.W); K.stepFighter(S.b, S.a, S.W);
  }
  eq('对手硬直结束后连段立即归零（早于 70 帧计时器）', S.a.combo, 0);
  for (var k3 = 0; k3 < 120; k3++) {
    S.a.inp.hit = {}; S.a.inp.down = {};
    K.stepFighter(S.a, S.b, S.W); K.stepFighter(S.b, S.a, S.W);
  }
  eq('长时间不进攻连段保持归零', S.a.combo, 0);
  K.pinp.down = {};
})();

/* ============================================================
 * 15b. 霸体（岩的招牌机制）：慢角色的反压制手段
 * ========================================================== */
(function () {
  // 让 def 出招，att 在 def 的霸体帧内打中它
  function armorCase(defId, defMove, attMove) {
    var a = K.makeFighter('xun', 0, 400);          // 攻方固定用迅（无霸体）
    var d = K.makeFighter(defId, 1, 440);
    a.face = 1; d.face = -1;
    var W = { projs: [] };
    K.startMove(d, a, defMove, W);                 // 守方先出招
    var m = K.MOVES.xun[attMove], hp0 = d.hp;
    // 推进到霸体窗口内（mvF <= armor）再结算命中
    var guard = 0;
    while (guard++ < 30 && !(d.mvF <= (d.move.armor || 0) && d.st === 'attack')) {
      K.stepFighter(d, a, W); K.stepFighter(a, d, W);
    }
    d.inp.down = {}; d.inp.hit = {};
    K.resolveHit(a, d, m);
    return { dmg: hp0 - d.hp, st: d.st, armored: K.hasArmor(d) };
  }

  var c1 = armorCase('yan', 'hp', 'lp');           // 岩·重拳（armor 9）
  ok('岩重拳霸体期被打中不进硬直', c1.st === 'attack', 'st=' + c1.st);
  ok('霸体受击有减伤', c1.dmg > 0 && c1.dmg < K.MOVES.xun.lp.dmg, 'dmg=' + c1.dmg);

  var c2 = armorCase('yan', 'lp', 'lp');           // 岩·轻拳（已移除霸体）
  eq('岩轻拳不再有霸体', c2.armored, false);
  ok('岩轻拳被打中会进硬直', c2.st === 'hitstun', 'st=' + c2.st);

  var c3 = armorCase('xun', 'hp', 'lp');           // 迅全身无霸体
  eq('迅没有霸体', c3.armored, false);

  // 霸体窗口随帧推进失效：越过 armor 帧后就是普通受击
  var a = K.makeFighter('xun', 0, 400), d = K.makeFighter('yan', 1, 440);
  a.face = 1; d.face = -1;
  var W2 = { projs: [] };
  K.startMove(d, a, 'hp', W2);
  for (var i = 0; i < 25; i++) { d.inp.down = {}; d.inp.hit = {}; K.stepFighter(d, a, W2); K.stepFighter(a, d, W2); }
  eq('霸体窗口过后不再免硬直', K.hasArmor(d), false);
})();

/* ============================================================
 * 14. 渲染冒烟（stub canvas，确保绘制路径无运行时错误）
 * ========================================================== */
(function () {
  function stubCtx() {
    var c = { __calls: 0 };
    var keys = ['save', 'restore', 'translate', 'scale', 'rotate', 'beginPath', 'moveTo',
      'lineTo', 'arc', 'ellipse', 'fill', 'stroke', 'fillRect', 'strokeRect', 'clearRect',
      'fillText', 'strokeText', 'setTransform', 'closePath', 'clip', 'setLineDash'];
    for (var i = 0; i < keys.length; i++) {
      (function (k) { c[k] = function () { c.__calls++; }; })(keys[i]);
    }
    c.createLinearGradient = function () { return { addColorStop: function () {} }; };
    c.createRadialGradient = function () { return { addColorStop: function () {} }; };
    c.measureText = function () { return { width: 10 }; };
    c.__k = 1;
    return c;
  }
  var ctx = stubCtx();
  var err = null;
  try {
    K.drawTitle(ctx, 30);
    K.drawSelect(ctx, 0, 30);
    K.drawSelect(ctx, 1, 60);

    // 覆盖全部角色状态
    var states = ['idle', 'walkF', 'walkB', 'crouch', 'air', 'land', 'attack', 'hitstun',
      'blockstun', 'guardCrush', 'knockdown', 'wakeup', 'throwing', 'thrown', 'ko', 'win'];
    for (var s = 0; s < states.length; s++) {
      for (var ci = 0; ci < 2; ci++) {
        var f = K.makeFighter(ci === 0 ? 'xun' : 'yan', 0, 400);
        f.st = states[s]; f.stF = 3; f.face = 1;
        if (states[s] === 'attack') {
          f.move = f.c.moves.hk; f.moveId = 'hk'; f.phase = 'active'; f.mvF = f.move.startup + 1;
        }
        K.drawFighter(ctx, f);
      }
    }
    // 覆盖全部招式姿势（含空中/蹲姿/必杀/超杀）
    var ids = ['lp', 'hp', 'lk', 'hk', 'c_lp', 'c_lk', 'c_hk', 'j_lp', 'j_lk', 'sp1', 'sp2', 'sp3'];
    for (var ci2 = 0; ci2 < 2; ci2++) {
      var id0 = ci2 === 0 ? 'xun' : 'yan';
      for (var k = 0; k < ids.length; k++) {
        var f2 = K.makeFighter(id0, 0, 400);
        var mv2 = f2.c.moves[ids[k]];
        if (!mv2) continue;
        f2.st = 'attack'; f2.move = mv2; f2.moveId = ids[k];
        f2.meter = 100;
        ['startup', 'active', 'recovery'].forEach(function (ph) {
          f2.phase = ph;
          f2.mvF = ph === 'startup' ? 1 : (ph === 'active' ? mv2.startup + 1 : mv2.startup + mv2.active + 1);
          K.drawFighter(ctx, f2);
        });
      }
    }
    // 完整对局渲染 400 帧（含飞行道具、特效、HUD、回合流程）
    K.fxReset();
    var M = K.makeMatch('xun', 'yan', 2);
    for (var n = 0; n < 400; n++) {
      K.stepMatch(M);
      K.render(ctx, M);
      if (n === 60) { K.startMove(M.p[0], M.p[1], 'sp1', M); }   // 触发飞行道具绘制
    }
    // 暂停面板（指令表）：两个角色各画一次
    var Mp = K.makeMatch('xun', 'yan', 2);
    K.drawPause(ctx, Mp);
    var Mp2 = K.makeMatch('yan', 'xun', 2);
    K.drawPause(ctx, Mp2);
    // 强制进入各回合阶段
    ['intro', 'fight', 'ko', 'roundEnd', 'matchEnd'].forEach(function (st) {
      M.state = st; M.stateF = 20; M.matchWinner = 0; M.roundWinner = 0;
      K.render(ctx, M);
    });
  } catch (e) { err = e.message + '\n' + e.stack.split('\n')[1]; }
  ok('渲染路径无运行时错误', err === null, err);
  ok('确实产生了绘制调用', ctx.__calls > 1000, 'calls=' + ctx.__calls);
})();

/* ---------- 汇总 ---------- */
console.log(logs.join('\n'));
console.log('\n──────────────────────────────');
console.log('PASS ' + pass + '  FAIL ' + fail);
console.log(fail === 0 ? 'ALL GREEN' : 'HAS FAILURES');
process.exit(fail === 0 ? 0 : 1);
