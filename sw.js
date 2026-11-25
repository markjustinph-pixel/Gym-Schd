const CACHE = "mjm-workout-v7";

const FILES = [
  "./",
  "index.html",
  "schedule.html",
  "todo.html",
  "contact.html",
  "macros.html",
  "macros.css",
  "macros.js",
  "styles.css",
  "script.js",
  "planner.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "apple-touch-icon.png",
  "360_F_296191090_PGQXIC2Y8CCsrJ7fgCsDd8OuVN8uJtNY.jpg",
  "images/49c549e0-a247-48da-a0ec-b9f794891317.jpg",
  "images/ba788eb1-ce8d-418a-b7b4-f605d56e88b2.jpg",
  "images/b76db96d-fc23-4faa-a589-5cbd1723100b.jpg",
  "images/acc5cc2d-dcac-41d4-9f4e-96ead7bda1a5.jpg"
];

const EXERCISES = [
  "incline-barbell-bench-press",
  "flat-barbell-bench-press",
  "close-grip-dumbbell-press",
  "rope-push-down",
  "close-grip-reverse-push-down-rope-push-down",
  "lat-pull-down",
  "chin-up",
  "barbell-rows",
  "zottman-curl",
  "seated-hammer-curl",
  "seated-dumbbell-curl",
  "single-arm-lateral-raises",
  "face-pull",
  "dumbbell-overhead-press",
  "reverse-barbell-curl",
  "cross-body-hammer-curl",
  "stiff-legged-deadlift",
  "barbell-squat",
  "crunch",
  "leg-raises",
  "pendley-rows",
  "pull-up",
  "deadlift",
  "up-right-rows",
  "decline-push-up",
  "incline-push-up"
];

const TYPES = ["avif", "gif", "webp", "jpg", "png"];

async function saveExercise(cache, slug) {
  for (const type of TYPES) {
    const path = `images/${slug}.${type}`;
    try {
      const response = await fetch(path, { cache: "reload" });
      if (response.ok) {
        await cache.put(path, response);
        return;
      }
    } catch (error) {
      return;
    }
  }
}

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all([
        ...FILES.map(file => cache.add(file).catch(() => null)),
        ...EXERCISES.map(slug => saveExercise(cache, slug))
      ]))
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

  if (request.destination === "image") {
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
    return;
  }

  event.respondWith(
    fetch(request, { cache: "no-cache" })
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
