/* 大六壬 · 解析文案层
 * 课体总断 / 三传分析 / 宜忌 / 时间发展与关键应期
 */
(function (global) {
  "use strict";
  var DLR = global.DLR = global.DLR || {};
  var ZHI = DLR.ZHI, GAN = DLR.GAN;

  var KETI_ZONG = {
    "元首课": "上克下为元首，君得位而事体分明。主事自上而下、名正言顺，有理有节者胜，吉事得正应，凶事亦有化解之机。",
    "重审课": "下贼上为重审，一阳在下而动，事须再三审度。主事有反复、以下犯上、先难后易，凡谋宜缓，再审周详而后行。",
    "知一课": "课有二克，比用知一。主事有两端、心有两意，取一舍一乃成，抉择时刻不宜贪多求全。",
    "涉害课": "涉害课，克深者用。主事经磨砺纠缠，过程曲折、多劳方成；受克愈深，其事愈切于身，须深谋远虑、循序渐进。",
    "蒿矢课": "神遥克日，蒿矢也。外来之扰、远方之事相干，然遥而力薄，如蒿箭之矢，来势可见而伤有限，防口舌虚惊可也。",
    "弹射课": "日遥克神，弹射也。我主动谋事、出击在先，力如弹丸，有目标则中，散漫则空；宜谋远事、外事，主动者得之。",
    "昴星课（虎视）": "刚日昴星，虎视之象。阳气独用、机事不密则凶，事贵简捷明断，宜刚不宜柔，白昼之象、公事可为。",
    "昴星课（冬蛇掩目）": "柔日昴星，冬蛇掩目。阴气掩蔽、事多暗昧，宜静观以待明，不宜造次轻动，防暗中有人窥伺。",
    "别责课": "课体不全而别责，借力之课。自身条件不备，须合外缘、借他人之力乃成；中末皆归干上，事虽借力，其终在我。",
    "八专课": "干支同位，八专之课。阴阳同居、彼我不分，事多不由己出，或与人共事纠缠一处；宜专一守一，忌多头并进。",
    "伏吟课": "天地静伏，伏吟之课。主静守、迟滞、重复、旧事再来，凡事已具而不发；大宜守成，不宜妄动，动则生悔。",
    "返吟课（无依）": "天地对冲，返吟无依。主反复动摇、去而复来、成而复变，人心不定；宜以静制动，勿随波逐流。",
    "返吟课（井栏）": "返吟无克取马，井栏之课。外境变动牵引其事，被动中起波澜，宜顺势而为，逆势强求则劳而无功。"
  };

  var QIN_YI = {
    "父母": "庇护文书、长辈提携、操劳付出之象",
    "官鬼": "压力官事、约束小人、克身之忧之象",
    "妻财": "财利所得、实务成果、妻财之象",
    "子孙": "福德解忧、喜悦化解、药石平安之象",
    "兄弟": "同类分夺、竞争平辈、耗散之象"
  };
  var JIANG_YI = {
    "贵人": "尊长提携，得贵之力","螣蛇": "惊恐怪异，缠绕虚惊","朱雀": "口舌文书，言语是非","六合": "和合婚姻，中介成全",
    "勾陈": "田土争执，牵连迟滞","青龙": "喜庆财帛，酒色恩赏","天空": "虚诈不实，事多落空","白虎": "凶伤道路，疾病血光",
    "太常": "衣食宴乐，礼制文章","玄武": "盗失暗昧，欺瞒私弊","太阴": "暗中相助，阴私之惠","天后": "恩泽妇女，闺闱之喜"
  };

  function jieXi (data) {
    var c = data.chuan, kes = data.siKe, gan = data.dayGZ.gan;
    var out = {};
    out.zongDuan = KETI_ZONG[data.sanChuanRes.keti] || "";
    out.rule = data.sanChuanRes.rule;

    // ---- 三传分析 ----
    var chuanTxt = [];
    var names = ["初传（事之发端）", "中传（过程转移）", "末传（结局归着）"];
    for (var i = 0; i < 3; i++) {
      var x = c[i];
      var t = names[i] + "：" + GAN[x.dun != null ? x.dun : gan] + ZHI[x.zhi] + "（" + ZHI[x.zhi] + "上神）";
      t += "，" + x.qin + "——" + QIN_YI[x.qin] + "；乘" + x.jiang + "，" + JIANG_YI[x.jiang];
      if (x.kong) t += "；落空亡，其象虚而不实";
      chuanTxt.push(t);
    }
    out.chuan = chuanTxt;

    // ---- 干支上神 ----
    var g1 = kes[0].top, g3 = kes[2].top;
    out.ganShang = "干上神" + ZHI[g1] + "（我之现状）：" + liuQinTxt(gan, g1, true) + "，乘" + kes[0].jiang + "，" + JIANG_YI[kes[0].jiang] + (kes[0].kong ? "；落空，自身谋虑未实" : "");
    out.zhiShang = "支上神" + ZHI[g3] + "（对方/事体现状）：" + liuQinTxt(gan, g3, false) + "，乘" + kes[2].jiang + "，" + JIANG_YI[kes[2].jiang] + (kes[2].kong ? "；落空，对方诚意或事体存虚" : "");
    // 三传气势
    var qi = chuanQi(data);
    out.qiShi = qi;

    // ---- 宜 / 忌 ----
    out.yi = yiList(data); out.ji = jiList(data);

    // ---- 时间发展 ----
    out.shiJian = shiJianTxt(data);

    // ---- 关键日期 ----
    out.keyDates = keyDates(data);
    return out;
  }

  function liuQinTxt (gan, zhi, isGan) {
    var q = DLR.liuQin(gan, zhi);
    var me = DLR.GAN_WX[gan], o = DLR.ZHI_WX[zhi];
    var rel = o === me ? "与日干比和（平稳）" : DLR.keZhu(o, me) ? "克日干（受制于势）" : DLR.keZhu(me, o) ? "日干所克（可图之利）" :
              DLR.ZHI_WX[zhi] === DLR.GAN_WX[gan] ? "比和" : ({"木":"火","火":"土","土":"金","金":"水","水":"木"})[o] === me ? "生日干（得生扶）" : "日干所生（耗泄于我）";
    return q + "，" + rel;
  }

  function chuanQi (data) {
    var c = data.chuan, a = c[0].zhi, b = c[1].zhi, d = c[2].zhi;
    var S = {"木":"火","火":"土","土":"金","金":"水","水":"木"};
    var wa = DLR.ZHI_WX[a], wb = DLR.ZHI_WX[b], wd = DLR.ZHI_WX[d];
    if (S[wa] === wb && S[wb] === wd) return "三传递生，气机流转顺畅，事虽经转折而层层相扶，顺势推进可成。";
    if (DLR.keZhu(wa, wb) && DLR.keZhu(wb, wd)) return "三传递克，气机层层受阻，每前进一步即遇一难，宜稳扎稳打、勿图速成。";
    if (DLR.keZhu(wa, wb) && S[wb] === wd) return "初传克中而中生末，先阻后顺，事开头受挫、中途转机、终得舒缓。";
    if (S[wa] === wb && DLR.keZhu(wb, wd)) return "初传生中而中克末，先顺后阻，起手容易、收尾犯难，宜早布局终局。";
    var ganWX = DLR.GAN_WX[data.dayGZ.gan];
    if (S[wd] === ganWX || wd === ganWX) return "末传生扶日干，结局于我有利，纵有波折终有归宿。";
    if (DLR.keZhu(wd, ganWX)) return "末传克日干，结局带压力而来，须防尾局生变、善后费力。";
    return "三传气机错综，吉凶互见，宜就事论事、分段经营。";
  }

  function yiList (data) {
    var yi = [], c = data.chuan, kes = data.siKe;
    var jiangChu = c.map(function (x) { return x.jiang; });
    if (jiangChu.indexOf("贵人") >= 0) yi.push("宜拜见尊长、求贵人提携，谋事有门");
    if (jiangChu.indexOf("青龙") >= 0) yi.push("宜庆贺、谋财、进取，财喜之门已开");
    if (jiangChu.indexOf("六合") >= 0) yi.push("宜合伙、媒介、谈婚论嫁，和合之事可成");
    if (c.some(function (x) { return x.qin === "妻财" && !x.kong; })) yi.push("财星入传不空，宜务实务财，图利有据");
    if (data.geJu.some(function (g) { return g.name === "三传合局"; })) yi.push("三合成局，宜合伙共谋、聚众力而成事");
    if (data.geJu.some(function (g) { return g.name === "驿马入传"; })) yi.push("驿马入传，宜出行、调动、迁居，动中得利");
    if (data.geJu.some(function (g) { return g.name === "递生"; })) yi.push("气机递生，宜循序渐进、环环相扣地推进");
    if (data.geJu.some(function (g) { return g.name === "交车相合"; })) yi.push("干支交车相合，宜合作、缔约、婚配");
    if (c[2].qin === "妻财" || c[2].qin === "子孙") if (!c[2].kong) yi.push("末传吉而不空，宜坚持到底，终局有得");
    if (DLR.keZhu(DLR.GAN_WX[data.dayGZ.gan], DLR.ZHI_WX[kes[0].top])) yi.push("干上神为日干所克，主动权在我，宜主动出手谋之");
    if (!yi.length) yi.push("课无大成之象，宜守常经营、积累待时");
    return yi;
  }

  function jiList (data) {
    var ji = [], c = data.chuan, kes = data.siKe;
    var jc = c.map(function (x) { return x.jiang; });
    if (jc.indexOf("白虎") >= 0) ji.push("白虎入传：忌远行冒险、争斗血光，行车医疗谨慎");
    if (jc.indexOf("玄武") >= 0) ji.push("玄武入传：忌轻信于人、财物露白，防暗昧欺诈");
    if (jc.indexOf("朱雀") >= 0) ji.push("朱雀入传：忌口舌争辩、文字轻许，慎签慎诺");
    if (jc.indexOf("螣蛇") >= 0) ji.push("螣蛇入传：忌自乱方寸，防怪异惊扰、无谓多疑");
    if (jc.indexOf("天空") >= 0) ji.push("天空入传：忌轻信空口许诺，事多虚而不实");
    if (c[0].kong) ji.push("初传空亡：忌仓促启动大事，动机未实、起而复罢");
    if (c[2].kong) ji.push("末传空亡：忌押注最终结果，收成恐落空，重在过程落袋");
    if (c.some(function (x) { return x.qin === "官鬼" && !x.kong; }) && DLR.keZhu(DLR.ZHI_WX[kes[0].top], DLR.GAN_WX[data.dayGZ.gan]))
      ji.push("官鬼克身：忌与官面、强者正面冲突，宜避锋守拙");
    if (data.geJu.some(function (g) { return g.name === "三传全刑"; })) ji.push("三传全刑：忌签约结盟等郑重之举，过程多刑伤反目");
    if (data.sanChuanRes.zong === "伏吟") ji.push("伏吟主静：忌妄动变更，动则生悔，宜守成");
    if (data.sanChuanRes.zong === "返吟") ji.push("返吟反复：忌一锤定音、孤注一掷，留转圜余地");
    if (data.geJu.some(function (g) { return g.name === "逆连茹"; })) ji.push("逆连茹：忌强推快进，事有折返，宜留退路");
    if (!ji.length) ji.push("课中无明显凶象，唯忌得意忘形、行险侥幸");
    return ji;
  }

  function shiJianTxt (data) {
    var c = data.chuan, z = data.sanChuanRes.zong;
    var t = "事之起：" + phaseTxt(c[0]) + "；事之中：转关在" + ZHI[c[1].zhi] + "，" + phaseTxt(c[1]) + "；事之终：归着于" + ZHI[c[2].zhi] + "，" + phaseTxt(c[2]) + "。";
    if (z === "伏吟") t += "伏吟之应迟，逢冲则动，应期多在" + ZHI[DLR.CHONG(c[0].zhi)] + "值日之期。";
    else if (z === "返吟") t += "返吟之应速而多反复，事在旬内即见分晓，成亦快、变亦快。";
    else t += "三传应期，以传支值日、合日为期，参下关键时间。";
    return t;
  }
  function phaseTxt (x) {
    var r = "在" + ZHI[x.zhi] + "（" + x.qin + "、" + x.jiang + (x.kong ? "、空亡" : "") + "）";
    return r;
  }

  // 关键应期：未来60日内 初/末传值日、空亡填实、初传合日、驿马值日，取最近5项
  function keyDates (data) {
    var out = [], base = data.dayDate;
    for (var i = 1; i <= 60 && out.length < 5; i++) {
      var d = new Date(base.getTime()); d.setDate(d.getDate() + i);
      var gz = DLR.dayGZ(d.getFullYear(), d.getMonth() + 1, d.getDate());
      var z = gz.zhi, items = [];
      if (z === data.chuan[0].zhi) items.push("初传" + ZHI[z] + "值日，事端发动/旧况重现");
      else if (z === data.chuan[2].zhi) items.push("末传" + ZHI[z] + "值日，结果应验之期");
      else if (data.xunKong.indexOf(z) >= 0 && data.chuan.some(function (x) { return x.kong && x.zhi === z; })) items.push(ZHI[z] + "空亡填实，虚事转实之期");
      else if (DLR.LIUHE[z] === data.chuan[0].zhi) items.push("与初传" + ZHI[data.chuan[0].zhi] + "六合，和合成事之期");
      else if (z === DLR.YIMA[data.dayGZ.zhi] && data.chuan.some(function (x) { return x.zhi === z; })) items.push("驿马" + ZHI[z] + "值日，变动之期");
      if (items.length) out.push({ date: d, gz: gz, text: items.join("；") });
    }
    return out;
  }

  DLR.jieXi = jieXi; DLR.KETI_ZONG = KETI_ZONG;
})(typeof window !== "undefined" ? window : globalThis);
