// Hosn Obe – Service Worker: macht das Spiel installierbar und ohne Netz spielbar.
// Die Seite selbst kommt immer frisch aus dem Netz, damit Updates sofort da sind.
// Nur ohne (oder bei sehr langsamem) Netz springt die gespeicherte Kopie ein.
const CACHE = 'hob-v1';
const CORE = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Alfa+Slab+One&display=swap';
const LIBS = [
  'https://cdn.jsdelivr.net/npm/mqtt@5.10.4/dist/mqtt.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js'
];
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];
const PAGE_TIMEOUT = 4000;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    // Schrift und Bibliotheken einzeln: fällt eine aus, soll das die Installation nicht verhindern
    await Promise.all([...LIBS, FONT_CSS].map(u => store(c, u).catch(() => {})));
    try {
      const css = await (await c.match(FONT_CSS)).text();
      const fonts = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1]);
      await Promise.all(fonts.map(u => store(c, u).catch(() => {})));
    } catch (err) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate' && url.origin === location.origin) e.respondWith(page(e));
  else if (url.origin === location.origin || CDN_HOSTS.includes(url.hostname)) e.respondWith(asset(e, url));
});

async function store(c, u){
  const res = await fetch(u, {mode: 'cors', credentials: 'omit'});
  if (!res.ok) throw new Error(res.status);
  await c.put(u, res);
}

// Seite: zuerst Netz (am Server nachfragen, ob es eine neue Version gibt), sonst Kopie
async function page(e){
  const c = await caches.open(CACHE);
  const net = fetch(e.request.url, {cache: 'no-cache', credentials: 'same-origin'}).then(res => {
    if (res.ok && !res.redirected) e.waitUntil(c.put('./', res.clone()));
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  try {
    return await Promise.race([net, new Promise((_, no) => setTimeout(() => no(new Error('langsam')), PAGE_TIMEOUT))]);
  } catch (err) {
    return (await c.match('./')) || net;
  }
}

// Icons, Schrift, Bibliotheken: sofort aus dem Speicher, im Hintergrund auffrischen
async function asset(e, url){
  const c = await caches.open(CACHE), cdn = CDN_HOSTS.includes(url.hostname);
  const hit = await c.match(e.request, {ignoreVary: true, ignoreSearch: !cdn});
  // CDN immer mit CORS holen: so ist die Antwort lesbar und darf gespeichert werden
  const net = (cdn ? fetch(url.href, {mode: 'cors', credentials: 'omit'}) : fetch(e.request))
    .then(res => { if (res.ok) e.waitUntil(c.put(cdn ? url.href : e.request, res.clone())); return res; });
  if (hit){ e.waitUntil(net.catch(() => {})); return hit; }
  return net;
}
