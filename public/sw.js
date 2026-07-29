/**
 * Service worker: the game keeps working without a network.
 *
 * Hand-written rather than generated, and it caches at *runtime* rather than
 * pre-listing the build output. The reason is the build itself: Vite hashes
 * asset filenames, so a pre-cache list would have to be produced by a plugin
 * and kept in step with every build. Caching what the page actually asks for
 * needs no build integration at all and is correct by construction — whatever
 * the game loaded once, it can load again.
 *
 * Two strategies, chosen by what the request is:
 *
 * - **Navigations go to the network first.** A stale HTML shell pointing at
 *   asset filenames that no longer exist is the classic way to brick a PWA on
 *   the first deploy after install. The cache is the fallback, not the source.
 * - **Everything else comes from the cache first.** Assets are hashed, so a
 *   cached one can never be the wrong version of itself, and serving it
 *   instantly is the whole point.
 */

const CACHE = "battlecamp-v1";

self.addEventListener("install", (event) => {
  // Nothing to pre-fetch: the first visit fills the cache as it loads. Skip
  // waiting so an updated worker takes over rather than sitting behind the old
  // one until every tab is closed — on a phone that can be days.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older versions of this worker, so a stale build does
      // not sit on the device forever.
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/** Put a copy in the cache, ignoring failures — a full disk must not break a load. */
async function remember(request, response) {
  if (!response || !response.ok || response.type === "opaque") return;
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  } catch {
    // Storage full or unavailable. The page already has its response.
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only plain GETs are cacheable, and only same-origin ones are ours to serve.
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          await remember(request, fresh);
          return fresh;
        } catch {
          // Offline. Any cached shell will do — the query string carries the
          // match settings, so an exact URL match would miss almost always.
          const cached = await caches.match(request, { ignoreSearch: true });
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      const fresh = await fetch(request);
      await remember(request, fresh);
      return fresh;
    })(),
  );
});
