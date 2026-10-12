/* 大六壬 · 解读数据层
 * 六亲 / 遁干空亡 / 格局识别 / 起课总入口
 */
(function (global) {
  "use strict";
  var DLR = global.DLR = global.DLR || {};
  var ZHI = DLR.ZHI, GAN = DLR.GAN;

  // 六亲：以日干为我
  var SHENG = {"木":"火","火":"土","土":"金","金":"水","水":"木"};
  function liuQin (ganIdx, zhi) {
    var me = DLR.GAN_WX[ganIdx], o = DLR.ZHI_WX[zhi];
    if (o === me) return "兄弟";
    if (DLR.keZhu(o, me)) return "官鬼";
    if (DLR.keZhu(me, o)) return "妻财";
    if (SHENG[o] === me) return "父母";
    if (SHENG[me] === o) return "子孙";
    return "";
  }

  // 格局识别（可靠的常用格）
  function geJu (data) {
    var gs = [];
    var c = data.chuan, kes = data.siKe;
    var a = c[0].zhi, b = c[1].zhi, d = c[2].zhi;
    // 三合局
    var s = [a, b, d].sort(function (x, y) { return x - y; });
    if ((s[1] - s[0] === 4 && s[2] - s[1] === 4) || (s[0] === 0 && s[1] === 4 && s[2] === 8) ||
        (s[0] + 12 - s[2] === 4 && s[1] - s[0] === 4)) {
      gs.push({ name: "三传合局", text: "三传" + ZHI[a] + ZHI[b] + ZHI[d] + "合成局，众力同向，事有聚合而成之象" });
    }
    // 连茹（顺连：i,i+1,i+2）
    if ((b - a + 12) % 12 === 1 && (d - b + 12) % 12 === 1) gs.push({ name: "顺连茹", text: "三传连茹顺行，事势连绵推进、一气呵成" });
    if ((a - b + 12) % 12 === 1 && (b - d + 12) % 12 === 1) gs.push({ name: "逆连茹", text: "三传逆连茹，事有回退折返之象，宜缓不宜急" });
    // 三刑全
    var trio = [[2,5,8],[1,10,7],[0,3,0]];
    for (var t = 0; t < 3; t++) {
      var set = {};
      set[a] = 1; set[b] = 1; set[d] = 1;
      var ok = trio[t][0] !== trio[t][2] ? (set[trio[t][0]] && set[trio[t][1]] && set[trio[t][2]]) : false;
      if (ok) gs.push({ name: "三传全刑", text: "三传" + ZHI[a] + ZHI[b] + ZHI[d] + "全刑，过程多刑伤消耗、生波澜" });
    }
    if (a === b && b === d && data.sanChuanRes.zong !== "伏吟") gs.push({ name: "三传纯一", text: "初中末传同为" + ZHI[a] + "，事专一而少变化，吉凶皆应速" });
    // 递生 / 递克
    if (DLR.ZHI_WX[a] !== DLR.ZHI_WX[b] && SHENG[DLR.ZHI_WX[a]] === DLR.ZHI_WX[b] && SHENG[DLR.ZHI_WX[b]] === DLR.ZHI_WX[d])
      gs.push({ name: "递生", text: "三传递相生，层层相扶，事情环环相扣、顺次而成" });
    if (DLR.keZhu(DLR.ZHI_WX[a], DLR.ZHI_WX[b]) && DLR.keZhu(DLR.ZHI_WX[b], DLR.ZHI_WX[d]))
      gs.push({ name: "递克", text: "三传递相克，层层受阻，进展中有连环困难" });
    // 空亡入传
    var kongs = data.xunKong;
    if (kongs.indexOf(a) >= 0) gs.push({ name: "初传空亡", text: "初传" + ZHI[a] + "空亡，事端未实、动机尚虚，或起而复罢" });
    if (kongs.indexOf(d) >= 0) gs.push({ name: "末传空亡", text: "末传" + ZHI[d] + "空亡，结局难落实，收获恐落空，宜求诸过程" });
    // 驿马入传
    var ma = DLR.YIMA[data.dayGZ.zhi];
    if (a === ma || b === ma || d === ma) gs.push({ name: "驿马入传", text: "驿马" + ZHI[ma] + "入传，事主动迁、出行、变动、调转，静中求动" });
    // 贵人登天门
    if (data.tianJiang.guiZhi === 11 && data.tianJiang.guiPos === 11) gs.push({ name: "贵人登天门", text: "贵人乘亥临亥，天门开，百事吉庆，宜求贵人、谋大事" });
    // 干上神=支上神
    if (kes[0].top === kes[2].top) gs.push({ name: "干支同上神", text: "干上神与支上神同为" + ZHI[kes[0].top] + "，人我同心、彼我同气，事易协同" });
    // 交车相合：干上神与日支合、支上神与干寄宫合
    if (DLR.LIUHE[kes[0].top] === data.dayGZ.zhi && DLR.LIUHE[kes[2].top] === DLR.JI_GONG[data.dayGZ.gan])
      gs.push({ name: "交车相合", text: "干支交车相合，两情相契、内外相就，合伙婚姻皆顺" });
    // 日干被克（干上神克日干）
    if (DLR.keZhu(DLR.ZHI_WX[kes[0].top], DLR.GAN_WX[data.dayGZ.gan]))
      gs.push({ name: "干上神克日", text: "干上神" + ZHI[kes[0].top] + "克日干，我受制于当前局势，压力在身、不宜强出头" });
    return gs;
  }

  // 起课总入口
  // opts: { date: Date, male: bool, birthYear: int, jiang: int|null(自动), topic: string }
  function qiKe (opts) {
    var date = opts.date;
    var h = date.getHours();
    var dayDate = new Date(date.getTime());
    if (h >= 23) dayDate.setDate(dayDate.getDate() + 1); // 晚子时归属次日（23点换日）
    var dg = DLR.dayGZ(dayDate.getFullYear(), dayDate.getMonth() + 1, dayDate.getDate());
    var shi = DLR.hourZhi(h);
    var yj = opts.jiang != null ? { zhi: opts.jiang, lon: null } : DLR.yueJiangOf(date);
    var tp = DLR.tianPan(yj.zhi, shi);
    var kes = DLR.siKe(dg, tp.pan);
    var tj = DLR.buTianJiang(dg.gan, shi, tp.pan);
    var sc = DLR.sanChuan(dg, tp.pan, tp.offset);
    var xi = DLR.xunInfo(dg.index);
    var xn = opts.birthYear ? DLR.xingNian(opts.birthYear, date, opts.male) : null;

    var data = {
      date: date, dayDate: dayDate, hour: h,
      dayGZ: dg, shiZhi: shi, yueJiang: yj.zhi, tianPan: tp.pan, offset: tp.offset,
      siKe: kes, tianJiang: tj, sanChuanRes: sc, xunKong: xi.xunKong,
      xingNian: xn, topic: opts.topic || "general",
      chuan: [
        { zhi: sc.chu,  pos: DLR.linGong(tp.pan, sc.chu)  },
        { zhi: sc.zhong, pos: DLR.linGong(tp.pan, sc.zhong) },
        { zhi: sc.mo,   pos: DLR.linGong(tp.pan, sc.mo)   }
      ]
    };
    // 三传配 天将/遁干/空亡/六亲
    for (var i = 0; i < 3; i++) {
      var z = data.chuan[i].zhi;
      data.chuan[i].jiang = DLR.jiangOf(tj.jiangOnZhi, z);
      data.chuan[i].dun = DLR.dunGan(dg.index, z);
      data.chuan[i].kong = xi.xunKong.indexOf(z) >= 0;
      data.chuan[i].qin = liuQin(dg.gan, z);
    }
    // 四课上神配天将
    for (var k = 0; k < 4; k++) {
      kes[k].jiang = DLR.jiangOf(tj.jiangOnZhi, kes[k].top);
      kes[k].kong = xi.xunKong.indexOf(kes[k].top) >= 0;
    }
    data.geJu = geJu(data);
    return data;
  }

  DLR.liuQin = liuQin; DLR.geJu = geJu; DLR.qiKe = qiKe;
})(typeof window !== "undefined" ? window : globalThis);
