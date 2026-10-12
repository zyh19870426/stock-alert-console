/* ============================================================
 * FundEngine —— ETF 抱团周期选基引擎（预注册口径，无自由参数）
 * 算法单一真源：浏览器 <script> 与 Node 测试共用本文件。
 *
 * v1 预注册判定（全部阈值固定，禁止按结果回调）：
 *   ① 流动性闸门   MA20(成交额) >= 1.0 亿元（成交额=量(手)*100*收）
 *   ② 上升趋势     C > MA20 > MA60 且 MA60 今日 > MA60 十日前
 *   ③ 退潮硬闸门   近20日涨幅 > 25%  →  暴涨透支，剔除
 *                  或 C < MA20 且 MA5 < MA20 → 已回落/退潮，剔除
 *   ④ 抱团周期定位 最近一次 MA5 上穿 MA60 距今 D 个交易日：
 *                  D <= 15 → 初期；15 < D <= 60 → 中期；D > 60 → 老周期
 *                  120 日窗口内无金叉 → 老周期
 *   ⑤ 资金跟进     MA5(成交额)/MA60(成交额) >= 1.2，否则「趋势向上但资金未跟进」
 *
 * v2 预注册增量（classify(bars, {v2:true, mktBad:bool})，2026-10-11 定稿，
 *   动机=回测发现中期组为负贡献；校验=样本内(≤2026-03)定型+样本外(≥2026-04)一次）：
 *   ⑥ 大盘总闸门   opts.mktBad=true 时全池停推（mktBad 由外部按指数计算：
 *                  C<MA20且MA5<MA20，或 MA60 十日前下行且 C<MA60）
 *   ⑦ 中期状态复核 拟判中期时每日复核：量比>=1.0 且 C>MA20 且
 *                  MA20今日>=MA20五日前，任一失守 → midExit（中期状态失守）
 *   ⑧ 衰竭探测     量比>=1.2 且 近5日收益<=0（放量滞涨=出货嫌疑）→ exhaust
 *
 * 持仓保护层（v3，bt3.js 三规则对比后选型，2026-10-11 定稿）：
 *   ⑨ 离场线       收盘 < MA10（日线）→ 离场。零自由参数。
 *                  周线/月线级（MA10周/MA10月）已回测否决：7月急跌单笔最深
 *                  -29%/-44%，仅日线能把最差亏损锁在 -10% 以内（最差-10.1%）。
 * ============================================================ */
(function (root) {
  'use strict';

  // ---- 预注册常量（唯一允许调整口径的位置，调整即视为新版本重跑校验）----
  var K = {
    LIQ_MIN_AMT: 1e8,      // 流动性：MA20 成交额下限（元）
    COOL_GAIN20: 0.25,     // 退潮闸门：近20日涨幅上限
    VOL_RATIO_MIN: 1.2,    // 资金跟进：5日均额/60日均额 下限
    INIT_MAX_DAYS: 15,     // 抱团初期上限（金叉距今交易日）
    MID_MAX_DAYS: 60,      // 抱团中期上限
    CROSS_WINDOW: 120,     // 金叉搜索窗口（交易日）
    MIN_BARS: 75,          // 最少样本数（MA60 + 10日前对比）
    KLINE_LOOKBACK: 120,   // 图表展示根数
    // ---- v2 增量 ----
    MID_MIN_RATIO: 1.0,    // ⑦ 中期资金未撤下限
    SLOPE_LOOKBACK: 5,     // ⑦ MA20 斜率回看（交易日）
    EXHAUST_DAYS: 5        // ⑧ 衰竭探测回看（交易日）
  };

  function sma(arr, n) {
    var out = new Array(arr.length).fill(null), sum = 0;
    for (var i = 0; i < arr.length; i++) {
      sum += arr[i];
      if (i >= n) sum -= arr[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  // bars: [{date, open, close, high, low, vol}] 按时间升序
  function buildIndicators(bars) {
    var closes = bars.map(function (b) { return b.close; });
    var vols = bars.map(function (b) { return b.vol; });
    // 成交额估算：量(手)*100*收
    var amts = bars.map(function (b) { return b.amt != null ? b.amt : b.vol * 100 * b.close; });
    return {
      closes: closes, vols: vols, amts: amts,
      ma5: sma(closes, 5), ma10: sma(closes, 10), ma20: sma(closes, 20), ma60: sma(closes, 60),
      amtMa5: sma(amts, 5), amtMa60: sma(amts, 60)
    };
  }

  // 最近一次 MA5 上穿 MA60 的下标（仅扫 CROSS_WINDOW 窗口），无则 -1
  function findLastCross(ind) {
    var m5 = ind.ma5, m60 = ind.ma60;
    var n = m5.length, start = Math.max(1, n - K.CROSS_WINDOW);
    var found = -1;
    for (var i = start; i < n; i++) {
      if (m5[i - 1] != null && m60[i - 1] != null && m5[i] != null && m60[i] != null) {
        if (m5[i - 1] <= m60[i - 1] && m5[i] > m60[i]) found = i;
      }
    }
    return found;
  }

  /**
   * 主判定：返回 { verdict, stage, crowdDay, g20, volRatio, crossIdx, reasons }
   * verdict: init|mid|late|cool|downtrend|flatside|noInflow|illiquid|insufficient
   *          v2 增量: mktGate|midExit|exhaust
   * opts: { v2:bool, mktBad:bool } —— 不传=纯 v1 行为
   */
  function classify(bars, opts) {
    opts = opts || {};
    if (!bars || bars.length < K.MIN_BARS) {
      return { verdict: 'insufficient', stage: null, crowdDay: null, g20: null, volRatio: null, crossIdx: -1, reasons: ['样本不足(<75根)'] };
    }
    var ind = buildIndicators(bars);
    var n = bars.length;
    var C = ind.closes[n - 1];
    var ma20 = ind.ma20[n - 1], ma60 = ind.ma60[n - 1];
    var ma5 = ind.ma5[n - 1];
    var ma60Back = ind.ma60[n - 11]; // 十日前
    var c20 = ind.closes[n - 21];    // 20 个交易日前收盘
    var g20 = c20 ? C / c20 - 1 : null;
    var volRatio = (ind.amtMa60[n - 1] != null && ind.amtMa60[n - 1] > 0)
      ? ind.amtMa5[n - 1] / ind.amtMa60[n - 1] : null;
    var amtMa20 = sma(ind.amts, 20)[n - 1];

    var reasons = [];
    // ① 流动性
    if (amtMa20 == null || amtMa20 < K.LIQ_MIN_AMT) {
      return { verdict: 'illiquid', stage: null, crowdDay: null, g20: g20, volRatio: volRatio, crossIdx: -1, reasons: ['流动性不足：MA20成交额 ' + fmtYi(amtMa20) + ' < 1亿'] };
    }
    // ⑥ 大盘总闸门（仅 v2）
    if (opts.v2 && opts.mktBad) {
      return { verdict: 'mktGate', stage: null, crowdDay: null, g20: g20, volRatio: volRatio, crossIdx: -1, reasons: ['大盘闸门：市场环境转坏，全池停推'] };
    }
    // ③ 退潮硬闸门（先于一切多头判定）
    if (g20 != null && g20 > K.COOL_GAIN20) {
      return { verdict: 'cool', stage: null, crowdDay: null, g20: g20, volRatio: volRatio, crossIdx: -1, reasons: ['退潮闸门：近20日涨幅 ' + pct(g20) + ' > 25%，暴涨透支'] };
    }
    if (C < ma20 && ma5 < ma20) {
      return { verdict: 'cool', stage: null, crowdDay: null, g20: g20, volRatio: volRatio, crossIdx: -1, reasons: ['退潮闸门：C<MA20 且 MA5<MA20，已回落'] };
    }
    // ② 上升趋势
    var up = C > ma20 && ma20 > ma60 && ma60Back != null && ma60 > ma60Back;
    if (!up) {
      var why = (C <= ma20) ? '收盘未站上MA20' : (ma20 <= ma60 ? 'MA20 未上穿 MA60' : 'MA60 走平或下行');
      // 区分：下跌 vs 横盘（用 MA60 十日前方向）
      var falling = ma60Back != null && ma60 < ma60Back;
      return {
        verdict: falling ? 'downtrend' : 'flatside', stage: null, crowdDay: null,
        g20: g20, volRatio: volRatio, crossIdx: -1,
        reasons: [falling ? '下跌趋势：' + why : '非上升趋势：' + why]
      };
    }
    // ④ 抱团周期定位
    var crossIdx = findLastCross(ind);
    var crowdDay = crossIdx >= 0 ? (n - 1 - crossIdx) : null;
    if (crowdDay == null || crowdDay > K.MID_MAX_DAYS) {
      return { verdict: 'late', stage: null, crowdDay: crowdDay, g20: g20, volRatio: volRatio, crossIdx: crossIdx, reasons: ['老周期：MA5/MA60 金叉距今 ' + (crowdDay == null ? '>120日' : crowdDay + '日')] };
    }
    var stage = crowdDay <= K.INIT_MAX_DAYS ? 'init' : 'mid';
    // ⑦ 中期状态复核（仅 v2）：中期不靠日历天数，靠状态每日维持
    if (opts.v2 && stage === 'mid') {
      var ma20Back5 = ind.ma20[n - 1 - K.SLOPE_LOOKBACK];
      var failMsg = null;
      if (volRatio != null && volRatio < K.MID_MIN_RATIO) failMsg = '量比 ' + volRatio.toFixed(2) + ' < ' + K.MID_MIN_RATIO + '（资金撤离）';
      else if (C <= ma20) failMsg = '收盘跌破 MA20';
      else if (ma20Back5 != null && ma20 < ma20Back5) failMsg = 'MA20 斜率转负';
      if (failMsg) {
        return { verdict: 'midExit', stage: null, crowdDay: crowdDay, g20: g20, volRatio: volRatio, crossIdx: crossIdx, reasons: ['中期状态失守：' + failMsg] };
      }
    }
    // ⑧ 衰竭探测（仅 v2）：放量滞涨 = 出货嫌疑
    if (opts.v2 && volRatio != null && volRatio >= K.VOL_RATIO_MIN) {
      var c5 = ind.closes[n - 1 - K.EXHAUST_DAYS];
      var r5 = c5 ? C / c5 - 1 : null;
      if (r5 != null && r5 <= 0) {
        return { verdict: 'exhaust', stage: null, crowdDay: crowdDay, g20: g20, volRatio: volRatio, crossIdx: crossIdx, reasons: ['衰竭探测：量比 ' + volRatio.toFixed(2) + ' ≥ 1.2 但近5日收益 ' + pct(r5) + ' ≤ 0，放量滞涨'] };
      }
    }
    // ⑤ 资金跟进
    if (volRatio == null || volRatio < K.VOL_RATIO_MIN) {
      return { verdict: 'noInflow', stage: null, crowdDay: crowdDay, g20: g20, volRatio: volRatio, crossIdx: crossIdx, reasons: ['趋势向上但资金未跟进：量比 ' + (volRatio == null ? '-' : volRatio.toFixed(2)) + ' < 1.2'] };
    }
    return {
      verdict: stage,
      stage: stage,
      stageLabel: stage === 'init' ? '抱团初期' : '抱团中期',
      crowdDay: crowdDay, g20: g20, volRatio: volRatio, crossIdx: crossIdx,
      reasons: [
        '趋势：C>MA20>MA60，MA60 上行',
        '金叉距今 ' + crowdDay + ' 个交易日（' + (stage === 'init' ? '≤15' : '15~60') + '）',
        '量比 ' + volRatio.toFixed(2) + ' ≥ 1.2',
        '近20日涨幅 ' + pct(g20) + '（未触发25%退潮闸门）'
      ]
    };
  }

  function pct(x) { return x == null ? '-' : (x * 100).toFixed(1) + '%'; }
  function fmtYi(x) { return x == null ? '-' : (x / 1e8).toFixed(2) + '亿'; }

  var engine = { K: K, buildIndicators: buildIndicators, findLastCross: findLastCross, classify: classify, pct: pct, fmtYi: fmtYi };
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;
  root.FundEngine = engine;
})(typeof window !== 'undefined' ? window : globalThis);
