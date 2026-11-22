const CACHE = "mjm-workout-v1";

const FILES = [
  "./",
  "index.html",
  "schedule.html",
  "todo.html",
  "contact.html",
  "styles.css",
  "script.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "apple-touch-icon.png",
  "360_F_296191090_PGQXIC2Y8CCsrJ7fgCsDd8OuVN8uJtNY.jpg",
  "49c549e0-a247-48da-a0ec-b9f794891317.jpg",
  "ba788eb1-ce8d-418a-b7b4-f605d56e88b2.jpg",
  "b76db96d-fc23-4faa-a589-5cbd1723100b.jpg",
  "acc5cc2d-dcac-41d4-9f4e-96ead7bda1a5.jpg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(FILES.map(file => cache.add(file).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then(hit => hit || caches.match("index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(hit => {
      const refresh = fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => hit);
      return hit || refresh;
    })
  );
});
