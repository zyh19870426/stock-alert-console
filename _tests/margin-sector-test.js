/* 2026-10：第二步「板块 / 题材消耗两融占比」离线回归
 * ① 锚点 + 方向禁词（圈定本功能新写代码，避免误伤其他模块）
 * ② 功能级：在 vm 里跑 demoMarginSectorData / marginSectorHtml / 切换 / 诚实错误态
 * 运行：node margin-sector-test.js   （期望 ALL GREEN） */
const fs = require('fs'); const vm = require('vm');
const HTML = fs.readFileSync(__dirname + '/../stock-alert-console/console.html', 'utf8');
let pass = 0, fail = 0;
function chk(n, ok, ex){ if(ok){ pass++ } else { fail++; console.log('  ❌ ' + n + (ex ? ' → ' + ex : '')); } }
function stripCmt(s){ return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); }

/* 圈定本功能新增代码：板块模块块 + 首页 TOP3 行窗口 */
const blkA = HTML.indexOf('var MARGIN_SECTOR = {');
const blkB = HTML.indexOf('function demoMarginSectorData(){');
const segBlock = (blkA >= 0 && blkB > blkA) ? HTML.slice(blkA, blkB) : '';
const top3i = HTML.indexOf('两融最集中 TOP3');
const top3win = top3i >= 0 ? HTML.slice(top3i - 260, top3i + 260) : '';
const seg = segBlock + '\n' + top3win;

console.log('==== ① 锚点 + 方向禁词 ====');
chk('★ 片段存在（板块模块块已注入）', segBlock.length > 500, 'segLen=' + segBlock.length);
chk('★ 云端存档源 = margin-sector-history.json', /margin-sector-history\.json/.test(seg));
chk('★ 双源降级 raw.githubusercontent + jsDelivr', /raw\.githubusercontent\.com\/zyh19870426\/stock-alert\/main\/margin-sector-history\.json/.test(seg) && /cdn\.jsdelivr\.net\/gh\/zyh19870426\/stock-alert@main\/margin-sector-history\.json/.test(seg));
chk('★ pgMargin 含板块面板容器 id="marginSector"', /id="marginSector"/.test(HTML));
chk('★ 行业/题材切换按钮 data-mk="2"/"3"', /data-mk="2"/.test(seg) && /data-mk="3"/.test(seg));
chk('★ 首页卡含「两融最集中 TOP3」行', /两融最集中 TOP3/.test(seg));
chk('★ 面板声明「不构成方向判断」', /不构成方向判断/.test(seg));
chk('★ 诚实错误态「两融板块数据暂不可用」', /两融板块数据暂不可用/.test(seg));
chk('★ 板块口径注明「板块两融=成分股融资余额之和」', /板块两融=成分股融资余额之和/.test(seg));
chk('★ 片段无方向禁词（要涨/要跌/可买/该躲）', !/要涨|要跌|可买|该躲/.test(seg));

console.log('==== ② 功能级：demo 数据 + 渲染 + 切换 + 错误态 ====');
/* 通用 DOM 桩 */
function stubEl(){
  return {
    _on:{}, style:{}, dataset:{}, _attr:{}, classList:{ add(){}, remove(){}, contains(){ return false }, toggle(){} },
    innerHTML:'', textContent:'', value:'',
    addEventListener(t,f){ this._on[t]=f }, removeEventListener(){},
    getAttribute(k){ return this._attr[k] != null ? this._attr[k] : null },
    setAttribute(k,v){ this._attr[k]=v },
    querySelectorAll(){ return [] }, querySelector(){ return null }, closest(){ return null },
    appendChild(){}, focus(){}, click(){}, classListContains(){ return false }
  };
}
const els = {};
const documentStub = {
  getElementById(id){ return els[id] || (els[id] = stubEl()) },
  querySelector(){ return null }, querySelectorAll(){ return [] },
  addEventListener(){}, createElement(){ return stubEl() }, body: stubEl(), documentElement: stubEl()
};
const store = {};
const sandbox = {
  console, document: documentStub,
  window: null, location: { href:'https://x/', search:'?demo=1', hash:'', protocol:'https:', host:'x' },
  history: { pushState(){}, replaceState(){} }, navigator: { userAgent:'node' },
  fetch: function(){ return Promise.reject(new Error('no-net')) },
  XMLHttpRequest: function(){}, WebSocket: function(){},
  requestAnimationFrame(f){ return 0 }, cancelAnimationFrame(){},
  setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Object, Array, String, Number, Boolean, isFinite, parseFloat, parseInt, RegExp,
  localStorage: { getItem(k){ return store[k]||null }, setItem(k,v){ store[k]=v }, removeItem(k){ delete store[k] } },
  getComputedStyle: function(){ return {} },
  addEventListener(){}, removeEventListener(){}
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
sandbox.G = { quoteMap:{} };

let api = null;
try {
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi; let m, last=null;
  while((m=re.exec(HTML))) if(m[1].trim().length > (last?last.length:0)) last = m[1];
  vm.createContext(sandbox);
  vm.runInContext(last, sandbox, { filename:'console.main.js' });
  api = sandbox;
} catch(e){ console.log('  ⚠️ 脚本加载异常（桩不完整）：' + e.message); }

if(api && api.demoMarginSectorData){
  const d = api.demoMarginSectorData();
  chk('★ demo 板块数据：行业+题材共 55 个', d.sectors.length === 55, 'n=' + d.sectors.length);
  chk('★ demo 板块数据：含 kind=2 与 kind=3', d.sectors.some(x=>x.kind===2) && d.sectors.some(x=>x.kind===3));
  const sumShare = d.sectors.reduce((a,b)=>a+(b.sharePct||0),0);
  chk('★ demo 板块数据：sharePct 合计≈1（归一到 total）', Math.abs(sumShare-1) < 1e-6, 'sum=' + sumShare.toFixed(6));
  chk('★ demo 板块数据：每个板块含 rzye/成员数/名称', d.sectors.every(x=>x.rzye>0 && x.members>0 && x.name));

  api.MARGIN_SECTOR.ok = true; api.MARGIN_SECTOR.err=''; api.MARGIN_SECTOR.date=d.date;
  api.MARGIN_SECTOR.sectors = d.sectors; api.MARGIN_SECTOR.kind='2';
  const htmlInd = api.marginSectorHtml();
  chk('★ 面板渲染：含「板块 / 题材消耗两融占比」标题', /板块 \/ 题材消耗两融占比/.test(htmlInd));
  chk('★ 面板渲染：含「不构成方向判断」', /不构成方向判断/.test(htmlInd));
  chk('★ 面板渲染：含「数据日」戳（T+1 标注）', /数据日/.test(htmlInd) && /T\+1/.test(htmlInd));
  const indList = d.sectors.filter(x=>x.kind===2).sort((a,b)=>b.sharePct-a.sharePct);
  chk('★ 面板渲染：行业视图含 TOP1 行业名', htmlInd.indexOf(esc(indList[0].name)) >= 0);
  chk('★ 面板渲染：含行业切换按钮（data-mk=2）', /data-mk="2"/.test(htmlInd));
  chk('★ 面板渲染：demo 30 行业（<50）→ 无截断提示、无折叠控件', !/仅列前/.test(htmlInd) && !/其他（/.test(htmlInd) && !/展开全部|收起|data-mex/.test(htmlInd));

  api.MARGIN_SECTOR.kind='3';
  const htmlCon = api.marginSectorHtml();
  const conList = d.sectors.filter(x=>x.kind===3).sort((a,b)=>b.sharePct-a.sharePct);
  chk('★ 面板渲染：题材视图含 TOP1 题材名', htmlCon.indexOf(esc(conList[0].name)) >= 0);
  chk('★ 面板渲染：题材视图同样无折叠控件', !/展开全部|收起|data-mex|其他（/.test(htmlCon));

  /* ★ 2026-10-13：显示条数 TOP 12 → 固定前 50（尾部零星不展示、不聚合、不可展开）—— 用 >50 条夹具验证截断 */
  const big = [];
  for(let i=0;i<60;i++) big.push({ bk:'I'+i, name:'行业'+i, kind:2, rzye:(60-i)*1e8, sharePct:(60-i)/2000, members:20+i });
  for(let i=0;i<55;i++) big.push({ bk:'C'+i, name:'题材'+i, kind:3, rzye:(55-i)*1e8, sharePct:(55-i)/2000, members:20+i });
  api.MARGIN_SECTOR.sectors = big; api.MARGIN_SECTOR.kind='2';
  const hBig = api.marginSectorHtml();
  const nRow = (hBig.match(/class="ms-row"/g)||[]).length;
  chk('★ 截断：行业 60 条只渲染前 50 条', nRow === 50, 'rows=' + nRow);
  chk('★ 截断：TOP1「行业0」在、第 51 名「行业50」不在', hBig.indexOf('行业0') >= 0 && hBig.indexOf('行业50') < 0);
  chk('★ 截断：无「其他（N 个）」聚合行', !/其他（/.test(hBig));
  chk('★ 截断：无可点展开/收起控件', !/data-mex/.test(hBig) && !/展开全部/.test(hBig) && !/收起/.test(hBig));
  chk('★ 截断：提示总数与截断阈值「共 60 个行业…仅列前 50」', /共 60 个行业/.test(hBig) && /仅列前 50/.test(hBig));
  api.MARGIN_SECTOR.kind='3';
  const hBig3 = api.marginSectorHtml();
  chk('★ 截断：题材 55 条只渲染前 50 条', (hBig3.match(/class="ms-row"/g)||[]).length === 50);
  chk('★ 截断：题材提示「共 55 个题材」', /共 55 个题材/.test(hBig3));

  api.MARGIN_SECTOR.ok=false; api.MARGIN_SECTOR.err='云端存档不可用';
  const htmlErr = api.marginSectorHtml();
  chk('★ 面板渲染：错误态诚实文案「两融板块数据暂不可用」', /两融板块数据暂不可用/.test(htmlErr));
  chk('★ 面板渲染：错误态无方向禁词', !/要涨|要跌|可买|该躲/.test(htmlErr));
} else {
  chk('★ 功能级执行（demoMarginSectorData 可调用）', false, '脚本未成功加载到沙箱');
}

function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }

console.log('通过：' + pass + '    失败：' + fail);
console.log(fail === 0 ? '结果：ALL GREEN' : '结果：存在失败项');
process.exit(fail ? 1 : 0);
