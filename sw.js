const CACHE = "desk-shell-v2";
const SHELL = ["./", "./index.html", "./app.css", "./app.js", "./chart.js", "./manifest.json"];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function (event) {
  const url = new URL(event.request.url);
  if (url.hostname === "api.github.com") return;
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).then(function (res) {
      const copy = res.clone();
      caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(event.request);
    })
  );
});
