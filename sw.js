const CACHE_NAME = 'rawasi-aden-1.0.0.20261007-pj6k';
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/ui-ux.js',
  './js/auth.js',
  './js/app.js',
  './js/events.js',
  './js/tafqeet.js',
  './js/projects.js',
  './js/project_hub.js',
  './js/project_control_ui.js',
  './js/inventory.js',
  './js/accounting.js',
  './js/hr.js',
  './js/reports.js',
  './js/settings.js',
  './js/excel-export.js',
  './images/logo.svg',
  './images/icon.svg',
  './images/logo.png',
  './manifest.json'
];

// تثبيت Service Worker وتخطي الانتظار للتفعيل الفوري
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((e) => console.warn('SW pre-cache note:', e));
    })
  );
});

// تفعيل Service Worker وتنظيف وحذف كافة الكاشات القديمة فوراً
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('SW: Deleting old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// استراتيجية Network First مع التحديث التلقائي للكاش
self.addEventListener('fetch', (event) => {
  // تمرير طلبات API مباشرة دون كاش
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // عند انقطاع الشبكة، جلب المحتوى من الكاش
        return caches.match(event.request);
      })
  );
});
