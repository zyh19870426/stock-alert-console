/* 大六壬 · 盘面层
 * 月将加时成天盘 → 四课 → 十二天将
 */
(function (global) {
  "use strict";
  var DLR = global.DLR = global.DLR || {};

  // 天地盘：天盘[y] = 地盘 y 宫之上的天盘神；月将对准时支
  function tianPan (jiang, shi) { // 月将支序, 时支序
    var offset = (jiang - shi + 12) % 12;
    var pan = [];
    for (var y = 0; y < 12; y++) pan.push((y + offset) % 12);
    return { pan: pan, offset: offset };
  }
  // 天盘中某神所临地盘宫
  function linGong (pan, zhi) {
    for (var y = 0; y < 12; y++) if (pan[y] === zhi) return y;
    return -1;
  }

  // 四课：一课干上神（以干寄宫取），二课其一之上；三课日支上神，四课三之上
  // 下神：一课记日干本身（判克用干五行），其余记地支
  function siKe (dayGZ, pan) {
    var gan = dayGZ.gan, zhi = dayGZ.zhi;
    var gGong = DLR.JI_GONG[gan];
    var c1 = pan[gGong];            // 一课上神
    var c2 = pan[c1];               // 二课上神
    var c3 = pan[zhi];              // 三课上神
    var c4 = pan[c3];               // 四课上神
    return [
      { top: c1, bottom: gGong, bottomIsGan: true,  ganIdx: gan },
      { top: c2, bottom: c1,    bottomIsGan: false },
      { top: c3, bottom: zhi,   bottomIsGan: false },
      { top: c4, bottom: c3,    bottomIsGan: false }
    ];
  }
  // 课中上下克：返回 -1 无克 / +1 上克下(下受克) / …（top克bottom 或 bottom克top）
  function keType (ke) {
    var topWX = DLR.ZHI_WX[ke.top];
    var botWX = ke.bottomIsGan ? DLR.GAN_WX[ke.ganIdx] : DLR.ZHI_WX[ke.bottom];
    if (DLR.keZhu(topWX, botWX)) return "shangKeXia";  // 上克下
    if (DLR.keZhu(botWX, topWX)) return "xiazeiShang"; // 下贼上
    return null;
  }

  // 十二天将：先定昼夜贵人所乘之神，再看贵人临何宫定顺逆
  // 贵人临地盘亥子丑寅卯辰六宫顺布，临巳午未申酉戌六宫逆布
  function buTianJiang (dayGanIdx, shiZhi, pan) {
    var dayTime = DLR.isDayTime(shiZhi);
    var pair = DLR.GUI_REN[dayGanIdx];
    var guiZhi = dayTime ? pair[0] : pair[1];   // 贵人所乘之天盘神
    var pos = linGong(pan, guiZhi);             // 贵人临地盘之宫
    var shun = (pos >= 11 || pos <= 4);         // 亥子丑寅卯辰 → 顺
    // 天将序（贵螣朱六勾青空白常玄阴后）配到天盘十二神
    var jiangOnZhi = {}; // 天盘支序 -> 天将序
    for (var k = 0; k < 12; k++) {
      var z = shun ? (guiZhi + k) % 12 : ((guiZhi - k) % 12 + 12) % 12;
      jiangOnZhi[z] = k;
    }
    return { dayTime: dayTime, guiZhi: guiZhi, guiPos: pos, shun: shun, jiangOnZhi: jiangOnZhi };
  }
  // 某天盘神之上所乘天将名
  function jiangOf (jiangOnZhi, zhi) { return DLR.TIANJIANG[jiangOnZhi[zhi]]; }

  DLR.tianPan = tianPan; DLR.linGong = linGong; DLR.siKe = siKe;
  DLR.keType = keType; DLR.buTianJiang = buTianJiang; DLR.jiangOf = jiangOf;
})(typeof window !== "undefined" ? window : globalThis);
