import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

/**
 * Writes sw.js with the list of built files, so the app opens with no network after the first visit.
 * The page is fetched from the network when there is one (a new version shows up at once) and from
 * the cache when there is none; hashed files under assets/ never change, so the cache answers first.
 */
function offline(): Plugin {
  return {
    name: 'cube6-offline',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const built = Object.keys(bundle).filter((f) => f !== 'index.html');
      const files = ['./', ...built.map((f) => './' + f), ...readdirSync('public').map((f) => './' + f)];
      const version = createHash('sha256').update(files.join('|')).digest('hex').slice(0, 12);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `const CACHE = 'cube6-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('cube6-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          if (response.ok) caches.open(CACHE).then((cache) => cache.put('./', copy));
          return response;
        })
        .catch(() => caches.match('./', { cacheName: CACHE }).then((hit) => hit || Response.error())),
    );
    return;
  }
  event.respondWith(caches.match(request, { cacheName: CACHE, ignoreVary: true }).then((hit) => hit || fetch(request)));
});
`,
      });
    },
  };
}

export default defineConfig({
  plugins: [preact(), offline()],
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1200 },
  server: { host: '0.0.0.0', allowedHosts: true },
  preview: { host: '0.0.0.0', allowedHosts: true },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 600000 },
} as any);
