/* stage-core 单元测试：阶段引擎迁移 + 有效性统计
 * 运行：node _tests/stage-core-test.js
 * 覆盖：特征计算、raw 阈值（六态各一）、段切分（防抖/单日抖动不切）、单段度量、聚合口径
 */
const SC = require('D:/mywork/stock-alert-cloud/stage-core.js');
let pass = 0, fail = 0; const fails = [];
const ok = (c, n) => { c ? pass++ : (fail++, fails.push(n)); };
const eq = (a, b, n) => ok(a === b, n + '（期望 ' + b + '，实际 ' + a + '）');
const near = (a, b, tol, n) => ok(Math.abs(a - b) <= (tol || 1e-9), n + '（期望≈' + b + '，实际 ' + a + '）');

/* ---------- 夹具 ---------- */
function mkBars(closes) {
  return closes.map((c, i) => ({ d: '2026-' + String(Math.floor(i / 28) + 1).padStart(2, '0') + '-' + String((i % 28) + 1).padStart(2, '0'), o: c, c: c, h: c * 1.001, l: c * 0.999, v: 1000 }));
}
const flat = (n, p) => new Array(n).fill(p);

/* ---------- A. stageFeatAt 数学 ---------- */
{
  const closes = flat(70, 10).concat([9.5, 9.0]);
  const bars = mkBars(closes);
  const f = SC.stageFeatAt(bars, bars.length - 1, 2.5);
  ok(!!f, 'A1 特征可算');
  near(f.c, 9.0, 1e-9, 'A2 c=最新收盘');
  near(f.h60, 10.01, 1e-9, 'A3 60日最高含盘中上影（10×1.001）');
  near(f.ma60, (58 * 10 + 9.5 + 9.0) / 60, 1e-9, 'A4 MA60 手算一致');
  near(f.ddHi, 9.0 / 10.01 - 1, 1e-9, 'A5 距60日高点回撤');
  near(f.ret20, 9.0 / 10 - 1, 1e-9, 'A6 20日涨幅（c20=10）');
  near(f.upLo, 9.0 / (9.0 * 0.999) - 1, 1e-3, 'A7 距60日低点涨幅（最低下影在末日军 8.991）');
  eq(f.turn, 2.5, 'A8 换手透传');
  ok(SC.stageFeatAt(bars, 59, NaN) === null, 'A9 不足 61 根 → null');
  var tNaN = SC.stageFeatAt(bars, bars.length - 1, NaN).turn;
  ok(tNaN !== tNaN, 'A10 换手缺失 → NaN（引擎降级口径；NaN!==NaN 须自比较）');
}

/* ---------- B. stageRawFromFeat：六态阈值（直接喂特征对象，无歧义） ---------- */
{
  const f = (ddHi, aboveMa60, ret20, upLo, turn) => ({ c: 10, h60: 10, l60: 10, ma60: 10, ddHi, aboveMa60, ret20, upLo, turn: turn === undefined ? NaN : turn });
  eq(SC.stageRawFromFeat(f(-0.20, -0.05, -0.12, -0.10)).raw, 'down-shift', 'B1 破位分≥2 且 ddHi≤-8% → 转势下跌');
  eq(SC.stageRawFromFeat(f(-0.10, 0.01, -0.02, -0.10)).raw, 'pullback', 'B2 破位分<2 → 健康回调（结构未破）');
  eq(SC.stageRawFromFeat(f(-0.05, 0.01, 0.25, 0.35, 4)).raw, 'top-risk', 'B3 过热分 3/3（ddHi>-8% 不落破位分支）→ 见顶风险');
  eq(SC.stageRawFromFeat(f(-0.05, 0.01, 0.10, 0.35)).raw, 'overheat', 'B4 无换手时 2 项中 1 项 → 过热警戒（差 1 项）');
  eq(SC.stageRawFromFeat(f(-0.05, 0.01, 0.10, 0.35, 4)).raw, 'overheat', 'B5 有换手 3 项中 2 项（差 1 项）→ 过热警戒');
  eq(SC.stageRawFromFeat(f(-0.05, 0.01, 0.25, 0.35)).raw, 'top-risk', 'B5b 无换手 2 项中 2 项（满需）→ 见顶风险');
  eq(SC.stageRawFromFeat(f(0.0, 0.01, 0.10, 0.20)).raw, 'up-cont', 'B6 过热分支 2 项可计 0 分 → 上涨中继');
  eq(SC.stageRawFromFeat(f(0.0, 0.01, 0.0, 0.10)).raw, 'trend', 'B7 都不在分支 → 趋势运行中');
  const rc = SC.stageRawFromFeat(f(-0.20, -0.05, -0.12, -0.10));
  eq(rc.brkHit, 3, 'B8 破位分回传（展示用）');
  eq(rc.hotHit, 0, 'B9 过热分回传');
  /* ★ 高位回落剔除（2026-09-26）：确认日 ret20≥15% 或 MA60 上方≥20% → 不给健康回调 */
  eq(SC.stageRawFromFeat(f(-0.09, 0.18, 0.16, 0.05)).raw, 'down-shift', 'B10 高位回落剔除：ret20≥15% → 转势下跌（旧规则为 pullback）');
  eq(SC.stageRawFromFeat(f(-0.085, 0.21, 0.14, 0.05)).raw, 'down-shift', 'B11 高位回落剔除：MA60 上方≥20% → 转势下跌');
  eq(SC.stageRawFromFeat(f(-0.09, 0.05, 0.05, 0.05)).raw, 'pullback', 'B12 低位+贴均线仍保留健康回调');
  ok(SC.stageRawFromFeat(f(-0.09, 0.18, 0.16, 0.05)).highPos === true, 'B13 highPos 标志回传');
  /* 深回撤提示层 */
  ok(SC.pullbackDepthWarn(-0.10) === null, 'B14 浅回撤无提示');
  ok(SC.pullbackDepthWarn(-0.17) && SC.pullbackDepthWarn(-0.17).level === 'mid', 'B15 -17% → mid 提示');
  ok(SC.pullbackDepthWarn(-0.22) && SC.pullbackDepthWarn(-0.22).level === 'deep', 'B16 -22% → deep 提示');
  ok(SC.pullbackDepthWarn(NaN) === null, 'B17 缺值无提示');
}

/* ---------- C. stageEpisodes：段切分 ---------- */
{
  /* 场景 A：平台 70 根 @10 → 跌到 8.5（i=71 当日 ret20=-0.0999…>-0.1（IEEE754）为 pullback 抖动；
     down-shift 首现 i=72、确认 i=73）→ 跳回 9.7 两日（upLo=+14.2%<15% → trend 确认 i=78） */
  const barsA = mkBars(flat(70, 10).concat([9.5, 9.0, 8.5, 8.5, 8.5, 8.5, 8.5, 9.7, 9.7]));
  const epsA = SC.stageEpisodes(barsA, { confirm: 2 });
  ok(epsA.length >= 2, 'C1 场景A切出 ≥2 段（初始 trend 段 + 转势下跌段）');
  const dsA = epsA.find(function(e2){ return e2.key === 'down-shift' });
  ok(!!dsA, 'C2 切出转势下跌段');
  eq(dsA.s, 73, 'C3 确认日 = 连续第 2 天（i=73）');
  eq(dsA.e, 78, 'C4 终止切换日 = trend 确认日（i=78）');
  eq(dsA.next, 'trend', 'C5 终止后进入趋势运行中');
  eq(epsA[0].key, 'trend', 'C5b 首段是初始 trend（i=60 确立）');
  ok(epsA.every(e2 => e2.e > e2.s), 'C6 所有段 e>s');

  /* 场景 B：单日抖动（pullback 只出现 1 天）→ 不切段 */
  const barsB = mkBars(flat(70, 10).concat([9.05, 9.95, 10.0, 10.0]));
  const epsB = SC.stageEpisodes(barsB, { confirm: 2 });
  ok(!epsB.some(e2 => e2.key === 'pullback'), 'C7 单日健康回调抖动不切段（防抖）');

  /* 场景 C：健康回调段（9.05 两天确认 → 回 10 两日切 trend） */
  const barsC = mkBars(flat(70, 10).concat([9.05, 9.05, 9.05, 9.95, 10.0]));
  const epsC = SC.stageEpisodes(barsC, { confirm: 2 });
  const pc = epsC.find(e2 => e2.key === 'pullback');
  ok(!!pc, 'C8 场景C切出健康回调段');
  eq(pc.s, 71, 'C9 回调确认日 i=71');
  eq(pc.next, 'trend', 'C10 终止后回到趋势');
}

/* ---------- D. 单段度量 ---------- */
{
  /* 尾部 6 根：70:9.5 71:9.0 72:8.5 73:8.5 74:10.5 75:10.5
     down-shift 于 i=71 起始、i=72 确认；trend 于 i=74 起始、i=75 确认 */
  const bars = mkBars(flat(70, 10).concat([9.5, 9.0, 8.5, 8.5, 10.5, 10.5]));
  const oc = SC.stageEpisodeOutcome(bars, { key: 'down-shift', s: 72, e: 75, next: 'trend' });
  ok(!!oc, 'D1 度量可算');
  near(oc.ret, 10.5 / 8.5 - 1, 1e-9, 'D2 ret = 终止日收盘/确认日收盘 - 1（跳回 10.5 → +23.5%）');
  near(oc.minRet, 0, 1e-9, 'D3 期间最深收盘回撤（未再创新低 = 0）');
  near(oc.maxRet, 10.5 / 8.5 - 1, 1e-9, 'D4 期间最高收盘涨幅 = 期末价');
  eq(oc.days, 3, 'D5 持续天数 = e - s');
}

/* ---------- E. 聚合口径 ---------- */
{
  const feedA = { bars: mkBars(flat(70, 10).concat([9.5, 9.0, 8.5, 8.5, 8.5, 8.5, 8.5, 10.5, 10.5])), turnAt: null };
  const st = SC.stageStatsFromFeeds([feedA], { confirm: 2 });
  eq(st['down-shift'].n, 1, 'E1 转势下跌样本 1 段');
  ok(/平均累计涨跌幅/.test(st['down-shift'].text) && /下跌概率/.test(st['down-shift'].text), 'E2 转势下跌文案含口径指标');
  eq(st['pullback'].n, 0, 'E3 无回调段 → n=0');
  ok(st['pullback'].text === undefined, 'E4 n=0 无文案（页面显示无样本）');

  const feedC = { bars: mkBars(flat(70, 10).concat([9.05, 9.05, 9.05, 9.95, 10.0])), turnAt: null };
  const st2 = SC.stageStatsFromFeeds([feedC], { confirm: 2 });
  eq(st2['pullback'].n, 1, 'E5 健康回调样本 1 段');
  ok(/继续回调/.test(st2['pullback'].text) && /转为转势下跌/.test(st2['pullback'].text) && /收复信号日收盘/.test(st2['pullback'].text), 'E6 回调文案四指标齐全');
  eq(st2['pullback'].recoverProb, 1, 'E7 本例期间收盘回到信号日上方 → 收复概率 100%');
  eq(st2['pullback'].toDownProb, 0, 'E8 终止进 trend → 转下跌概率 0%');

  /* 多股聚合：两段 down-shift（一正一负 ret 不易构造，验证 n 累加与均值口径） */
  const st3 = SC.stageStatsFromFeeds([feedA, feedA], { confirm: 2 });
  eq(st3['down-shift'].n, 2, 'E9 多持仓样本累加');
  near(st3['down-shift'].avgRet, (10.5 / 8.5 - 1), 1e-9, 'E10 均值口径 = ret 的算术平均');

  /* 换手透传：turnAt 恒 4 → 过热分支可用 3 项；末尾 4 根平台让 overheat 段终止（未终止段不计入） */
  const hotBars = mkBars(flat(70, 10).concat([10.4, 10.8, 11.2, 11.6, 12.0, 12.4, 12.8, 13.2, 13.2, 13.2, 13.2]));
  const st4 = SC.stageStatsFromFeeds([{ bars: hotBars, turnAt: () => 4 }], { confirm: 2 });
  ok(st4['top-risk'].n >= 1 || st4['overheat'].n >= 1, 'E11 连续急涨 + 高换手 → 切出过热/见顶段');
}

console.log('');
console.log('================ 汇总 ================');
console.log('通过：' + pass + '    失败：' + fail);
if (fail) { console.log('失败项：'); fails.forEach(f => console.log('  - ' + f)); }
console.log(fail === 0 ? '结果：ALL GREEN' : '结果：存在失败项');
process.exit(fail ? 1 : 0);
