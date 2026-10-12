/* 大六壬 · 核心数据层
 * 干支体系 / 五行刑冲合害 / 月将（太阳黄经） / 昼夜贵人 / 日柱时辰
 */
(function (global) {
  "use strict";
  var DLR = global.DLR = global.DLR || {};

  // ---------- 基础常量 ----------
  var GAN  = ["甲","乙","丙","丁","戊","己","庚","辛","壬","癸"];
  var ZHI  = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];
  // 月将（太阳所在宫）神将名
  var JIANG_MING = ["神后","大吉","功曹","太冲","天罡","太乙","胜光","小吉","传送","从魁","河魁","登明"];
  // 十二天将（顺序固定：贵螣朱六勾青空白常玄阴后）
  var TIANJIANG = ["贵人","螣蛇","朱雀","六合","勾陈","青龙","天空","白虎","太常","玄武","太阴","天后"];
  var JIANG_XIONG = { "贵人":1,"六合":1,"青龙":1,"太阴":1,"天后":1,"太常":1,
                      "螣蛇":-1,"朱雀":-1,"勾陈":-1,"天空":-1,"白虎":-1,"玄武":-1 };
  // 十二地支五行
  var ZHI_WX = ["水","土","木","木","土","火","火","土","金","金","土","水"];
  var GAN_WX = ["木","木","火","火","土","土","金","金","水","水"];
  // 干寄宫（阳干寄禄，阴干寄冠带）
  var JI_GONG = [2,4,5,7,5,7,8,10,11,1]; // 甲寅 乙辰 丙巳 丁未 戊巳 己未 庚申 辛戌 壬亥 癸丑
  // 昼夜贵人（甲戊庚牛羊：昼丑夜未 …… 六辛逢马虎：昼午夜寅）
  var GUI_REN = { 0:[1,7], 4:[1,7], 6:[1,7],   // 甲 戊 庚
                  1:[0,8], 5:[0,8],             // 乙 己
                  2:[11,9], 3:[11,9],           // 丙 丁
                  8:[5,3], 9:[5,3],             // 壬 癸
                  7:[6,2] };                    // 辛
  // 三刑（寅刑巳 巳刑申 申刑寅；丑刑戌 戌刑未 未刑丑；子刑卯 卯刑子；辰午酉亥自刑）
  var XING = {2:5, 5:8, 8:2, 1:10, 10:7, 7:1, 0:3, 3:0};
  var ZI_XING = {4:1, 6:1, 9:1, 11:1};
  // 六冲 / 六合 / 三合局 / 驿马 / 干合 / 孟仲季
  var CHONG = function (i){ return (i+6)%12; };
  var LIUHE = {0:1,1:0,2:11,11:2,3:10,10:3,4:9,9:4,5:8,8:5,6:7,7:6};
  var SANHE = {0:[4,8],4:[8,0],8:[0,4], 2:[6,10],6:[10,2],10:[2,6], 5:[9,1],9:[1,5],1:[5,9], 11:[3,7],3:[7,11],7:[11,3]};
  var YIMA  = {0:2,4:2,8:2, 2:8,6:8,10:8, 5:11,9:11,1:11, 11:3,3:3,7:3};
  var GANHE = {0:5,5:0,1:6,6:1,2:7,7:2,3:8,8:3,4:9,9:4};
  var MENG  = {2:1,5:1,8:1,11:1};   // 四孟 寅巳申亥
  var ZHONG = {0:1,3:1,6:1,9:1};    // 四仲 子卯午酉
  var JI    = {1:1,4:1,7:1,10:1};   // 四季 辰未戌丑

  function keZhu (a, b) { // a克b
    var WX_KE = {"木":"土","土":"水","水":"火","火":"金","金":"木"};
    return WX_KE[a] === b;
  }
  function zhiKeZhi (a, b) { return keZhu(ZHI_WX[a], ZHI_WX[b]); }
  function zhiYang (i) { return i % 2 === 0; }
  function ganYang (i) { return i % 2 === 0; }

  // ---------- 历法 ----------
  // 锚点：1949-10-01 为甲子日
  function jdnOfDate (y, mo, d) {
    return Math.floor(Date.UTC(y, mo - 1, d) / 86400000) + 2440588;
  }
  function dayGZ (y, mo, d) {
    var diff = jdnOfDate(y, mo, d) - jdnOfDate(1949, 10, 1);
    var idx = ((diff % 60) + 60) % 60;
    return { gan: idx % 10, zhi: idx % 12, index: idx };
  }
  function yearGZ (y) {
    return { gan: ((y - 4) % 10 + 10) % 10, zhi: ((y - 4) % 12 + 12) % 12 };
  }
  // 时支：23-1子 1-3丑 3-5寅 5-7卯 7-9辰 9-11巳 11-13午 13-15未 15-17申 17-19酉 19-21戌 21-23亥
  function hourZhi (h) {
    if (h >= 23 || h < 1) return 0;
    return Math.floor((h + 1) / 2) % 12;
  }
  // 昼夜：卯至申为昼，酉至寅为夜
  function isDayTime (zhi) {
    return zhi >= 3 && zhi <= 8; // 卯(3)..申(8)
  }
  // 旬首 / 旬遁干 / 空亡
  function xunInfo (dayIdx) {
    var start = dayIdx - (dayIdx % 10); // 旬首六十甲子序（天干必为甲）
    var sz = start % 12;                // 旬首地支
    return { startIdx: start, startZhi: sz,
             xunKong: [(sz + 10) % 12, (sz + 11) % 12] };
  }
  // 某支在本旬的遁干；不在本旬返回 null（即空亡或他旬之神）
  function dunGan (dayIdx, zhi) {
    var xi = xunInfo(dayIdx);
    var k = (zhi - xi.startZhi + 12) % 12;
    if (k >= 10) return null;
    return k; // 天干序（0=甲）
  }

  // ---------- 太阳黄经与月将 ----------
  // Meeus 低精度太阳黄经（精度约0.01°，对应时间误差<15分钟）
  function sunLongitude (jd) {
    var T = (jd - 2451545.0) / 36525;
    var L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    var M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * Math.PI / 180;
    var C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M)
          + (0.019993 - 0.000101 * T) * Math.sin(2 * M)
          + 0.000289 * Math.sin(3 * M);
    var lon = L0 + C - 0.00569; // 光行差修正
    lon = lon % 360; if (lon < 0) lon += 360;
    return lon;
  }
  // 月将 = 太阳所在宫：黄经每30°一宫，逢中气换将
  // [330,360)亥登明 [0,30)戌河魁 [30,60)酉从魁 [60,90)申传送 [90,120)未小吉
  // [120,150)午胜光 [150,180)巳太乙 [180,210)辰天罡 [210,240)卯太冲 [240,270)寅功曹 [270,300)丑大吉 [300,330)子神后
  function yueJiangOf (date) {
    var jd = date.getTime() / 86400000 + 2440587.5;
    var lon = sunLongitude(jd);
    var seg = Math.floor(lon / 30) * 30;
    var map = {330:11, 0:10, 30:9, 60:8, 90:7, 120:6, 150:5, 180:4, 210:3, 240:2, 270:1, 300:0};
    return { zhi: map[seg], lon: lon };
  }

  // ---------- 行年 ----------
  // 男命一岁起丙寅顺行，女命一岁起壬申逆行；虚岁=年-生年+1；年界以立春（2月4日）近似
  function xingNian (birthYear, now, male) {
    var y = now.getFullYear(), mo = now.getMonth() + 1, d = now.getDate();
    var lunarY = (mo === 1 || (mo === 2 && d < 4)) ? y - 1 : y;
    var sui = lunarY - birthYear + 1;
    if (sui < 1) sui = 1;
    var zhi, gan;
    if (male) { zhi = (2 + (sui - 1)) % 12; gan = (2 + (sui - 1)) % 10; } // 丙寅起一岁顺行
    else      { zhi = ((8 - (sui - 1)) % 12 + 12) % 12; gan = ((8 - (sui - 1)) % 10 + 10) % 10; } // 壬申起一岁逆行
    return { sui: sui, gan: gan, zhi: zhi };
  }

  DLR.GAN = GAN; DLR.ZHI = ZHI; DLR.JIANG_MING = JIANG_MING; DLR.TIANJIANG = TIANJIANG;
  DLR.JIANG_XIONG = JIANG_XIONG; DLR.ZHI_WX = ZHI_WX; DLR.GAN_WX = GAN_WX; DLR.JI_GONG = JI_GONG;
  DLR.GUI_REN = GUI_REN; DLR.XING = XING; DLR.ZI_XING = ZI_XING; DLR.CHONG = CHONG; DLR.LIUHE = LIUHE;
  DLR.SANHE = SANHE; DLR.YIMA = YIMA; DLR.GANHE = GANHE; DLR.MENG = MENG; DLR.ZHONG = ZHONG; DLR.JI = JI;
  DLR.keZhu = keZhu; DLR.zhiKeZhi = zhiKeZhi; DLR.zhiYang = zhiYang; DLR.ganYang = ganYang;
  DLR.dayGZ = dayGZ; DLR.yearGZ = yearGZ; DLR.hourZhi = hourZhi; DLR.isDayTime = isDayTime;
  DLR.xunInfo = xunInfo; DLR.dunGan = dunGan;
  DLR.sunLongitude = sunLongitude; DLR.yueJiangOf = yueJiangOf; DLR.xingNian = xingNian;
})(typeof window !== "undefined" ? window : globalThis);
