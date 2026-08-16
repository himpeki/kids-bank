// 静的アセット用 Service Worker。
// ねらい: 回線が不調・CDNが応答しない・GitHub Pagesのキャッシュが壊れた応答を
// 返した…といった場合でも、端末に保存済みの前回ファイルで必ず画面を出す
// (「真っ白のまま数分待つ」を構造的に無くす)。
// 方針: stale-while-revalidate — キャッシュがあれば即返し、裏でこっそり更新する。
// 更新は次回起動時に反映される(1回遅れ)。
// Firestore・認証のAPI通信(firestore.googleapis.com 等)は一切触らず素通しする。
const CACHE = "okb-static-v1";

const PRECACHE = [
  "./",
  "./index.html",
  "./child.html",
  "./parent.html",
  "./register.html",
  "./setup.html",
  "./print.html",
  "./manifest.webmanifest",
  "./css/base.css",
  "./css/child.css",
  "./css/parent.css",
  "./css/print.css",
  "./js/config.js",
  "./js/firebase-init.js",
  "./js/db.js",
  "./js/auth.js",
  "./js/tx.js",
  "./js/interest.js",
  "./js/ui.js",
  "./js/charts.js",
  "./js/quiz-pool.js",
  "./js/presets.js",
  "./icons/icon-192.png",
  "./icons/icon-180.png",
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.9/dist/chart.umd.min.js",
  "https://cdn.jsdelivr.net/npm/qrcode@1.4.4/build/qrcode.min.js",
];

// 静的アセットとして扱うホスト。ここに無いホスト(Firestore/認証API)は素通し
const STATIC_HOSTS = new Set([
  self.location.host,
  "www.gstatic.com",
  "cdn.jsdelivr.net",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
]);

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 1件の失敗でインストール全体を止めない(残りは実行時キャッシュで拾える)
    await Promise.allSettled(PRECACHE.map((u) => cache.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!STATIC_HOSTS.has(url.host)) return;

  // 自サイトのURLはクエリを無視して照合する(QRカードの ?f=..&t=.. 付きURLでも
  // キャッシュ済みの index.html / register.html が即出るように)。
  // fonts.googleapis.com などはクエリがファイル指定なのでそのまま照合する
  const matchOpts = url.host === self.location.host ? { ignoreSearch: true } : undefined;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, matchOpts);
    const network = fetch(req).then((res) => {
      // opaque は no-cors 読み込み(フォントCSS等)の正常応答
      if (res.ok || res.type === "opaque") cache.put(req, res.clone()).catch(() => {});
      return res;
    });
    if (cached) {
      e.waitUntil(network.catch(() => {})); // 裏で更新だけしておく
      return cached;
    }
    return network;
  })());
});
