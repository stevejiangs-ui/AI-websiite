/* 个人APP Service Worker

   ⚠️ 这套缓存策略出过两次事故，改之前先读这段：

   事故一：导航请求走「缓存优先」→ 发布新版本后，桌面图标打开还是旧 index.html，
          而旧 index.html 引用的 assets/xxx-old.js 已被清理 → 白屏。用户按
          Ctrl+Shift+R 也没用，因为 PWA 独立窗口有自己的一套 SW，普通刷新清不到。
   事故二：缓存里存了一份 index.html，页面内跳转时命中旧壳 → 指向失效资源 → 白屏。

   所以现在的原则只有一条：**HTML 永远不准从缓存里优先给**。
   网络好就用网络的，网络差就用缓存兜底，断网也还能看到壳。
   带 hash 的 assets 可以放心缓存（文件名变了就是新文件，不会拿错）。

   改版发布时把 CACHE 的数字加一（sync.sh 会自动做），
   新 SW 装好立刻接管，并清掉所有旧缓存。 */

const CACHE = 'lifelog-v19';
const SHELL = ['./index.html', './manifest.webmanifest', './icon-192.png'];

self.addEventListener('install', (e) => {
  /* 立即接管，不等旧标签页关闭 */
  self.skipWaiting();
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {
        /* 任何一个装失败都不阻塞安装 */
      })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      /* 1. 删掉所有别的版本的缓存（包括本次事故留下的旧壳） */
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));

      /* 2. 当前缓存里清掉不再被引用的旧 assets，避免撑爆配额 */
      try {
        const cache = await caches.open(CACHE);
        const htmlRes = await cache.match('./index.html');
        if (htmlRes) {
          const html = await htmlRes.text();
          const alive = new Set(html.match(/assets\/[A-Za-z0-9_.-]+/g) || []);
          const reqs = await cache.keys();
          await Promise.all(
            reqs
              .filter((r) => {
                const p = new URL(r.url).pathname;
                if (!/\/assets\//.test(p)) return false;
                const name = p.replace(/^.*assets\//, 'assets/');
                return !alive.has(name);
              })
              .map((r) => cache.delete(r))
          );
        }
      } catch (err) {
        /* 清理失败不影响使用，下次激活再试 */
      }

      await self.clients.claim();
    })()
  );
});

/* 判断一个响应可用：状态正常，且内容不是错误页 */
function usableHtml(res) {
  return !!res && res.ok;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  /* ---------- 1. 页面导航：网络优先，绝不让旧 HTML 挡住新版本 ---------- */
  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        try {
          /* cache: 'no-store' 绕过浏览器 HTTP 缓存，确保拿到服务端最新壳 */
          const fresh = await fetch(req.url, { cache: 'no-store', credentials: 'same-origin' });
          if (usableHtml(fresh)) {
            const copy = fresh.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          }
          return fresh;
        } catch (err) {
          /* 断网 / 超时：退回缓存里的壳，至少能看见界面 */
          const hit = (await caches.match('./index.html')) || (await caches.match('./'));
          if (hit) return hit;
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>离线</title>' +
              '<div style="font:14px/1.8 -apple-system,sans-serif;padding:40px;text-align:center;color:#5b564e">' +
              '<p style="font-size:16px;color:#23211d">现在没有网络</p>' +
              '<p>连上网络后重新打开就好，数据都在云端，没丢。</p>' +
              '<button onclick="location.reload()" style="margin-top:12px;padding:10px 22px;border:0;border-radius:8px;background:#b5623a;color:#fff;font-size:14px">重试</button>' +
              '</div>',
            { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
          );
        }
      })()
    );
    return;
  }

  /* ---------- 2. 带 hash 的静态资源：缓存优先（文件名变了就是新文件） ---------- */
  if (/\/assets\//.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req)
            .then((res) => {
              if (res.ok) {
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
              }
              return res;
            })
            .catch(() => new Response('', { status: 504 }))
      )
    );
    return;
  }

  /* ---------- 3. 其它（manifest / 图标 / sw.js 自身）：网络优先 ---------- */
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

/* 收到「立刻接管」指令就跳过等待：新版本装上即生效，
   不用等用户把旧的标签页全部关掉（手机上根本关不干净）。 */
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  /* 页面可以主动要求清掉全部缓存（启动时发现版本对不上就用这招自救） */
  if (e.data && e.data.type === 'PURGE') {
    e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))));
  }
});
