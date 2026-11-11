// 서비스 워커: 홈 화면 설치(PWA)와 오프라인 사용을 위해 앱 파일을 저장해 둔다.
// 설계: design/05_서비스워커.md
//
// - 네트워크가 되면 항상 서버의 최신 파일을 먼저 받아 쓰고(받은 파일은 저장해 둔다),
//   인터넷이 안 될 때만 저장해 둔 파일을 쓴다. 그래서 파일을 고친 뒤 캐시 버전을 올리는 것을
//   깜빡해도 최신 화면이 나온다.
// - 그래도 파일을 바꿀 때는 version.js 의 APP_VERSION 을 올린다. 옛 저장본을 지우기 위해서다.
//   (저장본 이름과 앱 화면의 버전 표시가 같은 값을 쓴다)

importScripts("./version.js"); // APP_VERSION, APP_BUILD_DATE
const CACHE_NAME = `stock-app-cache-${APP_VERSION}`;
const CACHE_FILES = [
  "./index.html",
  "./style.css",
  "./version.js",
  "./js/alert_rules.js",
  "./js/signals.js",
  "./js/fundamentals.js",
  "./js/fund_signals.js",
  "./js/market_status.js",
  "./js/stock_view.js",
  "./js/inbox.js",
  "./js/glossary.js",
  "./app.js",
  "./manifest.json",
];

// 설치될 때: 기본 파일들을 서버에서 새로 받아 저장한다(브라우저 임시 저장소를 거치지 않는다).
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        CACHE_FILES.map((file) =>
          fetch(file, { cache: "reload" }).then((res) => {
            if (!res.ok) throw new Error(`${file} 응답 ${res.status}`);
            return cache.put(file, res);
          })
        )
      )
    )
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

// 요청이 올 때: 같은 주소(앱 파일)만 다룬다. 시세 서비스 같은 외부 호출은 그대로 통과시킨다.
// 네트워크가 되면 최신 파일을 받아 저장하고, 안 되면 저장해 둔 파일(없으면 첫 화면)을 쓴다.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(req)
          .then((cached) => cached || (req.mode === "navigate" ? caches.match("./index.html") : Response.error()))
      )
  );
});
