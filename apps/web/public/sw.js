globalThis.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" ? data.title : "Onyx";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/";
  event.waitUntil(
    globalThis.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      icon: "/icon.svg",
      data: { url },
    }),
  );
});

globalThis.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? "/", globalThis.location.origin).href;
  event.waitUntil(
    globalThis.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((client) => client.url.startsWith(globalThis.location.origin));
      if (open) return open.navigate(target).then((client) => (client ?? open).focus());
      return globalThis.clients.openWindow(target);
    }),
  );
});
