/* 板块轮动 · GitHub API base64 解码回归锁
 * 背景：2026-10-10 用户报「板块轮动页面名称乱码」。
 * 根因：rotFetchCloud 的 GitHub Contents API 路径用裸 atob 解 base64，
 *       中文 UTF-8 多字节被当 Latin-1 单字节字符 → 「å…±å°è£…å…‰å­¦(CPO)」。
 *       raw/jsDelivr 路径正常，恰好掩盖；jsdom 无 fetch 时三路全败回落内嵌快照，
 *       所以既有 DOM 测试测不出来。
 * 本测试：stub window.fetch，让**只有** GitHub API 路径成功并返回真实形状的
 *         base64 包裹（content 字段），断言 rotLoad 后板块名是正常中文。
 * 运行：node _tests/rotation-b64-test.js   （jsdom，结束必须 process.exit）
 */
const fs = require('fs');
const path = require('path');
const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules';
let JSDOM, VirtualConsole;
try {
  const j = require(path.join(WS, 'jsdom'));
  JSDOM = j.JSDOM; VirtualConsole = j.VirtualConsole;
} catch (e) { console.log('SKIP：未安装 jsdom'); process.exit(0); }

const TARGET = 'D:/mywork/stock-alert-console/console.html';
const html = fs.readFileSync(TARGET, 'utf8');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' → ' + extra : '')); }
}

const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'https://stock-alert-console.app.workbuddy.host/', virtualConsole: vc });
const w = dom.window;

/* 夹具：确定性板块名（含 UTF-8 多字节、全角括号），动态 date（不写死日期）。*/
const FIX_NAMES = ['共封装光学(CPO)', '钠离子电池', '乳品', '芯片概念', '深证成指样本股'];
const fixDate = (function(){ const d = new Date();
  // 回溯到最近一个工作日（周一~周五），避免周末夹具与「新鲜度守卫」打架
  do { d.setDate(d.getDate() - 1) } while (d.getDay() === 0 || d.getDay() === 6);
  return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
})();
const payload = { v: 1, src: 'test', date: fixDate, boards: FIX_NAMES.map(function (n, i) {
  return { code: '8810' + i, name: n, kind: 'hy', state: 'main', days: 2, date: fixDate,
    chg5: 1, chg20: 2, mf5: 50 + i, mf20: 10, amt: 100, vr5: 1, p250: 0.5, dd60: -5 };
}) };
const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');


w.fngFetch = function (u) {
  if (String(u).indexOf('api.github.com/repos/zyh19870426/stock-alert/contents/rotation.json') > -1) {
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ content: b64 }) } });
  }
  return Promise.reject(new Error('stub: 该路径在本测试中必须失败（模拟 raw/jsDelivr 不可达）'));
};

setTimeout(function () {
  w.ROT_CLOUD_TRIED=false; w.ROT_DATA=null; w.ROT_CLOUD_HINT=""; w.ROT_BUILTIN=payload; w.rotLoad().then(function (j2) {
    ok(!!j2 && !!j2.boards && j2.boards.length === FIX_NAMES.length,
      'GitHub API 路径的数据被 rotLoad 采用', j2 ? ('boards=' + (j2.boards || []).length) : 'null');
    var names = (j2 && j2.boards || []).map(function (x) { return String(x.name) });
    ok(names[0] === FIX_NAMES[0], '板块名逐字一致（base64 正确按 UTF-8 解码）', JSON.stringify(names.slice(0, 3)));
    var bad = names.filter(function (n) { return /[\uFFFD\u00C0-\u00FF]/.test(n) });
    ok(bad.length === 0, '无 Latin-1 乱码字符（à-ÿ 区不应出现在中文板块名里）', JSON.stringify(bad.slice(0, 3)));
    ok(String(w.ROT_CLOUD_HINT || '') === '', '无降级提示（不得回落内嵌快照）', String(w.ROT_CLOUD_HINT));
    /* 反向锁：用裸 atob 重建旧实现，证明该测试**真的能红**（防「假绿」） */
    var legacy = null;
    try { legacy = JSON.parse(w.atob(b64)) } catch (e) {}
    ok(!!legacy && /[\u00C0-\u00FF]/.test(JSON.stringify(legacy.boards.map(function (x) { return x.name }))),
      '反向锁：裸 atob 复现乱码 ⇒ 本夹具对旧实现确实报红');
    console.log(pass + ' pass / ' + fail + ' fail');
    process.exit(fail ? 1 : 0);
  }).catch(function (e) { console.log('FAIL rotLoad 异常: ' + e.message); process.exit(1); });
}, 300);
