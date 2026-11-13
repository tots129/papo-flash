// Deixa o Papo Flash instalável e abrindo rápido.
// Sempre tenta buscar a versão nova; se estiver sem internet, usa a cópia guardada.
const CACHE = 'papoflash-v6';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'backend.js', 'calls.js', 'config.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // só os arquivos do próprio site; Firebase e Google passam direto
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});

// ------------------------------------------------------------------ avisos com o app fechado
self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch (_) {
    d = { title: 'Papo Flash', body: e.data ? e.data.text() : 'Novidade no Papo Flash' };
  }
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = wins.some((w) => w.visibilityState === 'visible');
      // app aberto na tela: ele mesmo já avisa (no iPhone é obrigatório mostrar sempre)
      if (open && !/iPhone|iPad|iPod/.test(self.navigator.userAgent)) return;
      const call = d.kind === 'call';
      await self.registration.showNotification(d.title || 'Papo Flash', {
        body: d.body || '',
        tag: d.tag || undefined,
        renotify: true,
        requireInteraction: call,
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        vibrate: call ? [500, 250, 500, 250, 500, 250, 500, 250, 500] : [200, 100, 200],
        data: { cid: d.cid || '', kind: d.kind || 'msg', at: Date.now() },
        actions: call ? [{ action: 'open', title: 'Atender' }] : [],
      });
    })()
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const cid = (e.notification.data || {}).cid || '';
  const url = new URL(cid ? `./#/c/${cid}` : './', self.registration.scope).href;
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const w = wins.find((x) => x.url.startsWith(self.registration.scope));
      if (w) {
        await w.focus().catch(() => {});
        w.postMessage({ type: 'open', cid });
        return;
      }
      await self.clients.openWindow(url);
    })()
  );
});
