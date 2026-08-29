// Smart Teacher — المعلم الذكي
// Service Worker: network-first (باش الأستاذ/التلميذ يشوفو آخر نسخة ديما إيلا كان نت)
// + تحديث تلقائي: أي تعديل فهاذ الملف (بتغيير CACHE_VERSION) كيخلي المتصفح يكتشف نسخة جديدة
// وينشطها فورًا (skipWaiting + clients.claim)، والصفحة كتعاود التحميل تلقائيًا بفضل الكود فـ index.html.
const CACHE_VERSION = 'smart-teacher-v2';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// دعم إضافي: إلا بعتت الصفحة رسالة SKIP_WAITING (احتياطًا)، ننشط النسخة الجديدة فورًا
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // ما نديرو cache للـ POST (طلبات الذكاء الاصطناعي / Firestore)

  event.respondWith(
    fetch(req)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
