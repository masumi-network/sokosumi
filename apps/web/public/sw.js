/**
 * Web Push service worker for Sokosumi.
 * Skips OS banners when a focused window client exists (Ably path owns those).
 * Payload: { tag, title, body, url }
 */

self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(handleNotificationClick(event));
});

/**
 * @param {PushEvent} event
 */
async function handlePush(event) {
  let payload = {
    tag: "",
    title: "Sokosumi",
    body: "",
    url: "/",
  };

  try {
    if (event.data) {
      const parsed = event.data.json();
      if (parsed && typeof parsed === "object") {
        payload = {
          tag: typeof parsed.tag === "string" ? parsed.tag : payload.tag,
          title:
            typeof parsed.title === "string" && parsed.title.length > 0
              ? parsed.title
              : payload.title,
          body: typeof parsed.body === "string" ? parsed.body : payload.body,
          url:
            typeof parsed.url === "string" && parsed.url.length > 0
              ? parsed.url
              : payload.url,
        };
      }
    }
  } catch {
    // Non-JSON push payloads fall back to defaults.
  }

  const windowClients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  const hasFocusedClient = windowClients.some((client) => client.focused);
  if (hasFocusedClient) {
    return;
  }

  await self.registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag || undefined,
    data: { url: payload.url },
  });
}

/**
 * @param {NotificationEvent} event
 */
async function handleNotificationClick(event) {
  const rawUrl =
    event.notification.data &&
    typeof event.notification.data.url === "string" &&
    event.notification.data.url.length > 0
      ? event.notification.data.url
      : "/";

  const targetUrl = new URL(rawUrl, self.location.origin);
  const targetHref = targetUrl.href;
  const targetPathWithSearch = `${targetUrl.pathname}${targetUrl.search}`;

  const windowClients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  for (const client of windowClients) {
    try {
      const clientUrl = new URL(client.url);
      if (clientUrl.origin !== self.location.origin) {
        continue;
      }
      const clientPathWithSearch = `${clientUrl.pathname}${clientUrl.search}`;
      if (clientPathWithSearch === targetPathWithSearch) {
        await client.focus();
        return;
      }
    } catch {
      // Ignore malformed client URLs.
    }
  }

  await self.clients.openWindow(targetHref);
}
