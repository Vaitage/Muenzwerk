// Münzwerk – Service Worker nur für Mitteilungen (Web Push). Er speichert nichts
// zwischen: Die App lädt ihre Daten immer frisch vom Pi.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "Münzwerk", {
    body: data.body || "",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: data.tag || "muenzwerk",
    data: { url: data.url || "/" },
  }));
});

// Antippen öffnet die App (oder holt sie nach vorn)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.location.origin) && "focus" in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
