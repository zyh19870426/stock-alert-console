/* 发布守卫（发布前必跑）
 * 目的：保证「监控台」与「六壬」两个项目在同一线上站点里互不影响。
 *
 * 背景（实测）：
 *   - 本工作区的发布通道恒定落到同一个应用沙箱；发布时上传的是「所指定目录」的文件，
 *     同名文件被覆盖，上次上传残留的文件不会自动清除。
 *   - 因此：六壬只能以 stock-alert-console/daliuren/ 子目录形式随监控台目录一起发布；
 *     绝不能把 daliuren 目录本身作为发布目录（那会把沙箱根 index.html 覆盖 → 抢走根路径）。
 *
 * 用法：node _tests/publish-guard.js
 * 退出码 0 = 可发布；1 = 有问题，先修再发。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = "D:/mywork";
const SRC = path.join(ROOT, "daliuren");                       // 六壬真源
const CONSOLE = path.join(ROOT, "stock-alert-console");        // 发布目录（监控台）
const SUB = path.join(CONSOLE, "daliuren");                    // 六壬在发布目录中的落点
const SIX = ["index.html", "core-data.js", "core-pan.js", "core-zhuan.js", "core-read.js", "core-jiexi.js"];

let bad = 0;
const md5 = (p) => crypto.createHash("md5").update(fs.readFileSync(p)).digest("hex");
const say = (ok, msg) => { console.log((ok ? "✅ " : "❌ ") + msg); if (!ok) bad++; };

console.log("=== 发布守卫 · 监控台 × 六壬 互不影响 ===\n");

// 1) 监控台本体在其目录根部，且未被六壬文件挤占
say(fs.existsSync(path.join(CONSOLE, "console.html")), "监控台 console.html 存在于发布目录根部");
const idx = path.join(CONSOLE, "index.html");
say(fs.existsSync(idx), "发布目录根 index.html 存在（防根路径被抢）");
if (fs.existsSync(idx)) {
  const t = fs.readFileSync(idx, "utf8");
  say(t.indexOf("console.html") >= 0 && t.indexOf("大六壬") < 0,
      "根 index.html 是跳转 console.html（不含六壬内容）");
}
say(fs.existsSync(path.join(CONSOLE, "design-preview.html")), "监控台 design-preview.html 仍在");

// 2) 六壬只准待在 daliuren/ 子目录，且与真源一致
say(fs.existsSync(SUB), "六壬位于子目录 stock-alert-console/daliuren/");
let drift = [];
SIX.forEach((f) => {
  const a = path.join(SRC, f), b = path.join(SUB, f);
  if (!fs.existsSync(a)) { say(false, "真源缺失 " + f); return; }
  if (!fs.existsSync(b)) { say(false, "发布目录缺少 daliuren/" + f); return; }
  if (md5(a) !== md5(b)) drift.push(f);
});
if (drift.length) say(false, "六壬文件与真源不一致，请先跑 `node daliuren/sync-publish.js`：" + drift.join(", "));
else say(true, "六壬 6 个文件与真源逐一致（md5 相同）");

// 3) 六壬文件不得出现在发布目录根部（会把根路径抢走）
SIX.forEach((f) => {
  if (f === "index.html") return;
  if (fs.existsSync(path.join(CONSOLE, f))) say(false, "发现六壬文件越界到发布目录根部：" + f);
});
say(true, "六壬算法模块未越界到发布目录根部");

// 4) 发布目录里不允许存在「独立六壬站点」式的副本目录
["daliuren-app", "daliuren-publish"].forEach((d) => {
  if (fs.existsSync(path.join(CONSOLE, d))) say(false, "发布目录内存在多余副本目录：" + d);
});

console.log("\n" + (bad === 0 ? "=== 守卫通过：可发布（发布目录 = stock-alert-console，entryHtml = console.html）==="
                              : "=== 守卫未通过：" + bad + " 项问题，先修复再发布 ==="));
console.log("\n铁律：① 发布目录永远是 D:\\mywork\\stock-alert-console；② 六壬改完先跑 sync-publish.js；");
console.log("      ③ 永不把 D:\\mywork\\daliuren 或任何其他目录当作发布目录。");
process.exit(bad ? 1 : 0);
