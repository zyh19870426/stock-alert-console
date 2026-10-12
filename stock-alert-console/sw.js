/* A股监控 · Service Worker（PWA 壳缓存）
 * 策略（2026-10-10）：
 *   ★ 行情/存档数据绝不缓存——只缓存「静态壳」：
 *     · console.html / index.html / manifest / 图标 → stale-while-revalidate
 *       （先回缓存保证秒开，同时后台拉新，下次生效）
 *     · 其余请求（GitHub API、jsDelivr、东财、腾讯行情……）→ 直接透传，不碰
 *   ★ 版本号随发布走：内容更新后 bump CACHE_VERSION，旧缓存整体清除。
 *   ★ service worker 文件本身必须放站点根目录（scope 才能覆盖全站）。
 */
var CACHE_VERSION = 'sa-pwa-v1';
var SHELL = [
  './',
  './console.html',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function (c) {
      /* 个别壳文件失败不阻塞安装（比如某图标暂时 404），逐个容错 */
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return (k === CACHE_VERSION) ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var sameOrigin = (url.origin === self.location.origin);
  var isShell = sameOrigin && (
    url.pathname === '/' || url.pathname.endsWith('/') ||
    /console\.html$/.test(url.pathname) || /index\.html$/.test(url.pathname) ||
    /manifest\.webmanifest$/.test(url.pathname) ||
    /icon-(192|512)\.png$/.test(url.pathname) || /apple-touch-icon\.png$/.test(url.pathname)
  );
  if (!isShell) return;               /* 行情、API、其它静态资源一律透传 */
  if (req.headers.get('accept') && req.headers.get('accept').indexOf('text/html') > -1 &&
      !/\.html$/.test(url.pathname) && url.pathname !== '/' && !url.pathname.endsWith('/')) return;

  /* stale-while-revalidate */
  e.respondWith(
    caches.open(CACHE_VERSION).then(function (c) {
      return c.match(req, { ignoreSearch: false }).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.ok) c.put(req, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      });
    })
  );
});
