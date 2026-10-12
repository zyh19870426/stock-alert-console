/* 大六壬 · 三传层（九宗门）
 * 贼克 / 比用 / 涉害 / 遥克 / 昴星 / 别责 / 八专 / 伏吟 / 返吟
 */
(function (global) {
  "use strict";
  var DLR = global.DLR = global.DLR || {};
  var linGong = DLR.linGong, zhiKeZhi = DLR.zhiKeZhi;
  // 地盘各宫所寄天干（十干寄宫：甲寅乙辰丙戊巳丁己未庚申辛戌壬亥癸丑）
  var GONG_GAN = { 2:[0], 4:[1], 5:[2,4], 7:[3,5], 8:[6], 10:[7], 11:[8], 1:[9] };

  // 涉害深浅：克神自所临地盘宫涉归本家，途中（不含临宫、不含本家）
  // 数"克我"之神：地支本气一重 + 宫内所寄天干各一重（通行口径）
  function shenHai (pan, z) {
    var pos = linGong(pan, z);
    var cnt = 0;
    for (var i = 1; i < 12; i++) {
      var gong = (pos + i) % 12;
      if (gong === z) break;                 // 本家止，不计
      if (zhiKeZhi(gong, z)) cnt++;           // 本气克
      var gs = GONG_GAN[gong];
      if (gs) for (var j = 0; j < gs.length; j++)
        if (DLR.keZhu(DLR.GAN_WX[gs[j]], DLR.ZHI_WX[z])) cnt++; // 寄干克
    }
    return { deep: cnt, pos: pos };
  }

  // 在候选中按涉害深浅 → 孟仲季 → 复等（阳日干上先见，阴日支上先见）取用
  function quSheHai (cands, pan, dayGZ, c1, c3) {
    var i;
    for (i = 0; i < cands.length; i++) {
      var s = shenHai(pan, cands[i].top);
      cands[i].deep = s.deep; cands[i].pos = s.pos;
    }
    var byDeep = {};
    for (i = 0; i < cands.length; i++) (byDeep[cands[i].deep] = byDeep[cands[i].deep] || []).push(cands[i]);
    var maxDeep = -1, d;
    for (d in byDeep) if (byDeep.hasOwnProperty(d) && +d > maxDeep) maxDeep = +d;
    var list = byDeep[maxDeep];
    if (list.length === 1) return { cand: list[0], rule: "涉害深浅（途中受克" + maxDeep + "度，最深）" };
    // 深浅同 → 孟仲季（孟深仲浅季当休）
    var pick = function (set) {
      var r = [];
      for (var j = 0; j < list.length; j++) if (set[list[j].pos]) r.push(list[j]);
      return r;
    };
    var m = pick(DLR.MENG), z = pick(DLR.ZHONG), j2 = pick(DLR.JI);
    var seq = m.length ? m : (z.length ? z : (j2.length ? j2 : list));
    if (seq.length === 1) return { cand: seq[0], rule: "涉害同深（各受克" + maxDeep + "度），取临" + (m.length ? "四孟" : z.length ? "四仲" : "四季") + "上神（" + (m.length ? "见机" : "察微") + "格）" };
    // 复等：柔辰刚日宜（阳日取干上神，阴日取支上神；不在候选取课序先见）
    var yangRi = DLR.ganYang(dayGZ.gan);
    for (var k = 0; k < seq.length; k++) {
      if (yangRi && seq[k].top === c1) return { cand: seq[k], rule: "复等，刚日取干上神" };
      if (!yangRi && seq[k].top === c3) return { cand: seq[k], rule: "复等，柔日取支上神" };
    }
    seq.sort(function (a, b) { return a.keIdx - b.keIdx; });
    return { cand: seq[0], rule: "复等，取先见者" };
  }

  // 主入口：求三传
  function sanChuan (dayGZ, pan, offset) {
    var gan = dayGZ.gan, zhi = dayGZ.zhi;
    var yangRi = DLR.ganYang(gan);
    var kes = DLR.siKe(dayGZ, pan);
    var c1 = kes[0].top, c3 = kes[2].top;
    var res = { chu: -1, zhong: -1, mo: -1, zong: "", keti: "", rule: "" };

    // 收集四课上下克
    var zei = [], ke = [];
    for (var i = 0; i < 4; i++) {
      var t = DLR.keType(kes[i]);
      if (t === "xiazeiShang") zei.push({ top: kes[i].top, keIdx: i });
      if (t === "shangKeXia") ke.push({ top: kes[i].top, keIdx: i });
    }
    var hasK = zei.length > 0 || ke.length > 0;

    // ---------- 伏吟 ----------
    if (offset === 0) {
      var XING = DLR.XING, ZIX = DLR.ZI_XING, CHONG = DLR.CHONG;
      var chu, rule;
      if (hasK) {
        var c = zei.length ? zei[0] : ke[0];
        chu = c.top; rule = "伏吟有克，" + (zei.length ? "下贼上" : "上克下") + "取" + DLR.ZHI[chu] + "发用";
        res.zong = "伏吟";
      } else if (yangRi) {
        chu = c1; rule = "伏吟无克，刚日取干上神" + DLR.ZHI[chu] + "发用（自任）";
        res.zong = "伏吟";
      } else {
        chu = c3; rule = "伏吟无克，柔日取支上神" + DLR.ZHI[chu] + "发用（自信）";
        res.zong = "伏吟";
      }
      var zhong, mo;
      if (ZIX[chu]) { // 初传自刑 → 中取另一上神
        zhong = (chu === c1) ? c3 : c1;
        rule += "；初传自刑，中传取" + (chu === c1 ? "支" : "干") + "上神" + DLR.ZHI[zhong];
      } else {
        zhong = XING[chu];
        rule += "；中传取初传所刑之" + DLR.ZHI[zhong];
      }
      if (ZIX[zhong]) { mo = CHONG(zhong); rule += "；中传自刑，末传取其冲" + DLR.ZHI[mo]; }
      else { mo = XING[zhong]; rule += "；末传取中传所刑之" + DLR.ZHI[mo]; }
      res.chu = chu; res.zhong = zhong; res.mo = mo; res.rule = rule;
      res.keti = res.zong + "课";
      return res;
    }

    // ---------- 返吟 ----------
    if (offset === 6) {
      if (hasK) {
        var r = faYong(zei, ke, dayGZ, pan, c1, c3);
        res.chu = r.chu; res.rule = "返吟有克，" + r.rule;
        res.zhong = pan[res.chu]; res.mo = pan[res.zhong];
        res.zong = "返吟"; res.keti = "返吟课（无依）";
        return res;
      }
      // 返吟无克仅六日（丁丑己丑辛丑丁未己未辛未）：驿马发用，中支上，末干上
      var ma = DLR.YIMA[zhi];
      res.chu = ma; res.zhong = c3; res.mo = c1;
      res.zong = "返吟"; res.keti = "返吟课（井栏）";
      res.rule = "返吟无克，取日支驿马" + DLR.ZHI[ma] + "发用，中传支上神，末传干上神";
      return res;
    }

    // ---------- 有克：贼克 / 比用 / 涉害 ----------
    if (hasK) {
      var r2 = faYong(zei, ke, dayGZ, pan, c1, c3);
      res.chu = r2.chu; res.zhong = pan[r2.chu]; res.mo = pan[res.zhong];
      res.zong = r2.zong; res.keti = r2.keti; res.rule = r2.rule;
      return res;
    }

    // ---------- 无克：遥克 ----------
    var i2, ganWX = DLR.GAN_WX[gan];
    var keGan = [], ganKe = [];
    for (i2 = 0; i2 < 4; i2++) {
      var t2 = kes[i2].top;
      if (DLR.keZhu(DLR.ZHI_WX[t2], ganWX)) keGan.push({ top: t2, keIdx: i2 });      // 神遥克日干
      else if (DLR.keZhu(ganWX, DLR.ZHI_WX[t2])) ganKe.push({ top: t2, keIdx: i2 });  // 日干遥克神
    }
    if (keGan.length > 0) {
      var g = biYong(keGan, gan) || keGan.sort(function (a, b) { return a.keIdx - b.keIdx; })[0];
      res.chu = g.top; res.zhong = pan[g.top]; res.mo = pan[res.zhong];
      res.zong = "遥克"; res.keti = "蒿矢课";
      res.rule = "四课无克，" + DLR.ZHI[g.top] + "遥克日干，蒿矢取用";
      return res;
    }
    if (ganKe.length > 0) {
      var g2 = biYong(ganKe, gan) || ganKe.sort(function (a, b) { return a.keIdx - b.keIdx; })[0];
      res.chu = g2.top; res.zhong = pan[g2.top]; res.mo = pan[res.zhong];
      res.zong = "遥克"; res.keti = "弹射课";
      res.rule = "四课无克，日干遥克" + DLR.ZHI[g2.top] + "，弹射取用";
      return res;
    }

    // ---------- 无克无遥：昴星 / 别责 / 八专 ----------
    var uniq = {}, n = 0;
    for (i2 = 0; i2 < 4; i2++) { var key = kes[i2].top + "/" + kes[i2].bottom; if (!uniq[key]) { uniq[key] = 1; n++; } }
    var sameGZ = DLR.JI_GONG[gan] === zhi; // 干支同位

    if (n === 4) { // 昴星：阳仰阴俯酉位中
      if (yangRi) {
        res.chu = pan[9]; res.zhong = c3; res.mo = c1;
        res.rule = "四课全备无克无遥，刚日仰取酉宫上神" + DLR.ZHI[res.chu] + "发用，中传支上神，末传干上神";
        res.keti = "昴星课（虎视）";
      } else {
        res.chu = linGong(pan, 9); res.zhong = c1; res.mo = c3;
        res.rule = "四课全备无克无遥，柔日俯取酉下之神" + DLR.ZHI[res.chu] + "发用，中传干上神，末传支上神";
        res.keti = "昴星课（冬蛇掩目）";
      }
      res.zong = "昴星";
      return res;
    }
    if (sameGZ || n === 2) { // 八专：阳日干上顺三，阴日四课上逆三；中末干上
      if (yangRi) {
        res.chu = (c1 + 2) % 12;
        res.rule = "干支同位两课无克无遥，刚日干上神" + DLR.ZHI[c1] + "顺数三神取" + DLR.ZHI[res.chu] + "发用";
      } else {
        var c4 = kes[3].top;
        res.chu = (c4 - 2 + 12) % 12;
        res.rule = "干支同位两课无克无遥，柔日第四课上神" + DLR.ZHI[c4] + "逆数三神取" + DLR.ZHI[res.chu] + "发用";
      }
      res.zhong = c1; res.mo = c1;
      res.zong = "八专"; res.keti = "八专课";
      return res;
    }
    // 别责：刚日干合上神，柔日支前三合；中末皆干上神
    if (yangRi) {
      var heGong = DLR.JI_GONG[DLR.GANHE[gan]];
      res.chu = pan[heGong];
      res.rule = "四课不全三课备，无克无遥，刚日取干合" + DLR.GAN[DLR.GANHE[gan]] + "寄宫" + DLR.ZHI[heGong] + "上神" + DLR.ZHI[res.chu] + "发用";
    } else {
      res.chu = (zhi + 4) % 12;
      res.rule = "四课不全三课备，无克无遥，柔日取支前三合" + DLR.ZHI[res.chu] + "发用";
    }
    res.zhong = c1; res.mo = c1;
    res.zong = "别责"; res.keti = "别责课";
    return res;
  }

  // 有克发用：贼克 → 比用 → 涉害
  function faYong (zei, ke, dayGZ, pan, c1, c3) {
    var list = zei.length ? zei : ke;
    var kind = zei.length ? "下贼上" : "上克下";
    if (list.length === 1) {
      return { chu: list[0].top, zong: "贼克", keti: zei.length ? "重审课" : "元首课",
               rule: "四课惟" + kind + "一重，取" + DLR.ZHI[list[0].top] + "发用" };
    }
    // 比用：阳日用阳阴用阴
    var b = biYong(list, dayGZ.gan);
    if (b) {
      return { chu: b.top, zong: "比用", keti: "知一课",
               rule: kind + "多重，阳日用阳阴用阴，取" + DLR.ZHI[b.top] + "发用" };
    }
    // 涉害
    var sh = quSheHai(list, pan, dayGZ, c1, c3);
    return { chu: sh.cand.top, zong: "涉害", keti: "涉害课",
             rule: "俱比俱不比，涉害取深——" + DLR.ZHI[sh.cand.top] + "（" + sh.rule + "）发用" };
  }
  // 比用过滤：与日干阴阳相比者恰一取之；0 或多个返回 null（入涉害）
  function biYong (list, ganIdx) {
    var yang = DLR.ganYang(ganIdx), r = [];
    for (var i = 0; i < list.length; i++)
      if (DLR.zhiYang(list[i].top) === yang) r.push(list[i]);
    if (r.length === 1) return r[0];
    return null;
  }

  DLR.sanChuan = sanChuan; DLR.shenHai = shenHai;
})(typeof window !== "undefined" ? window : globalThis);
