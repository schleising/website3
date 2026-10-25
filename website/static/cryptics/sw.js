"use strict";

const CRYPTICS_CACHE_VERSION = "cryptics-webapp-v1";
const CRYPTICS_SHELL_URLS = [
  "/",
  "/anagrams/",
  "/thesaurus/",
  "/abbreviations/",
  "/css/base.css?v1.3.2",
  "/css/dropdown-menus.css?v1.3.1",
  "/css/right-nav.css?v1.1.0",
  "/css/cryptics/cryptics.css?v1.0.6",
  "/js/base.js?v1.2.23",
  "/js/site-select-menu.js?v1.0.7",
  "/js/cryptics/suggest.js?v1.0.2",
  "/js/cryptics/anagram.js?v1.0.1",
  "/js/cryptics/thesaurus.js?v1.0.3",
  "/js/cryptics/abbreviations.js?v1.0.4",
  "/js/cryptics/pwa.js?v1.0.0",
  "/icons/cryptics/android-chrome-192x192.png?v1.0.0",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CRYPTICS_CACHE_VERSION).then((cache) => cache.addAll(CRYPTICS_SHELL_URLS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CRYPTICS_CACHE_VERSION)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CRYPTICS_CACHE_VERSION).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
