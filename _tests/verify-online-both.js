/* 线上双项目验收（发布后必跑）
 * 校验同域下两个项目各自正常、互不串页：
 *   /            → A股监控（跳转 console.html）
 *   /console.html→ A股监控
 *   /daliuren/   → 大六壬 · 正时起课
 * 用法：node _tests/verify-online-both.js
 */
const https = require("https");

const HOST = "stock-alert-console-51356.app.workbuddy.host";
const T = Date.now();

function get(pathname) {
  return new Promise((resolve) => {
    const req = https.get({
      hostname: HOST, path: pathname, timeout: 15000,
      headers: { "User-Agent": "wb-verify", "Cache-Control": "no-cache" }
    }, (res) => {
      let buf = "";
      res.on("data", (c) => { buf += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "" }); });
    req.on("error", () => resolve({ status: 0, body: "" }));
  });
}

function titleOf(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : "";
}

(async function () {
  const checks = [
    { path: "/?v=" + T,        expect: "A股监控", forbid: "大六壬", label: "根路径（监控台入口）" },
    { path: "/console.html?v=" + T, expect: "A股监控", forbid: "大六壬", label: "监控台 console.html" },
    { path: "/daliuren/?v=" + T,    expect: "大六壬", forbid: "A股监控", label: "六壬页 /daliuren/" },
  ];
  let bad = 0;
  for (const c of checks) {
    const r = await get(c.path);
    const t = titleOf(r.body);
    const ok = r.status === 200 && t.indexOf(c.expect) >= 0 && t.indexOf(c.forbid) < 0
               && !/正在进入监控台/.test(t); // 根路径若停在跳转页也不算通过
    console.log((ok ? "✅ " : "❌ ") + c.label.padEnd(22) + " status=" + r.status + "  title=" + (t || "(空)"));
    if (!ok) bad++;
  }
  // 六壬子资源
  for (const f of ["index.html", "core-zhuan.js", "core-jiexi.js"]) {
    const r = await get("/daliuren/" + f + "?v=" + T);
    const ok = r.status === 200 && r.body.length > 1000;
    console.log((ok ? "✅ " : "❌ ") + ("子资源 daliuren/" + f).padEnd(22) + " status=" + r.status + "  " + r.body.length + " B");
    if (!ok) bad++;
  }
  console.log("\n" + (bad === 0 ? "=== 双项目线上验收：全部通过，两项目互不影响 ===" : "=== 双项目线上验收：失败 " + bad + " 项 ==="));
  process.exit(bad ? 1 : 0);
})();
