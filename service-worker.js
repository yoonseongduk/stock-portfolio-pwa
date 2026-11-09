// 아주 단순한 서비스 워커.
// 캐시 전략은 최소한으로만 넣는다 (나중 스프린트에서 보강).
//
// 주의: index.html/style.css/app.js 내용을 바꿀 때마다 CACHE_NAME의 버전을
// 올려야 한다. 그래야 옛 캐시가 지워지고 새 파일을 받아온다.

const CACHE_NAME = "stock-app-cache-v17";
const CACHE_FILES = [
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
];

// 설치될 때: 기본 파일들을 캐시에 담아둔다.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CACHE_FILES))
  );
  self.skipWaiting();
});

// 새 서비스 워커가 활성화될 때: 이전 버전 캐시는 지운다.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// 요청이 올 때: 캐시에 있으면 캐시, 없으면 네트워크로 받아온다.
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
