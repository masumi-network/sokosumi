/**
 * The message catalog the push service worker loads with `importScripts`.
 *
 * Named here because three places have to agree on it and none of them can
 * read it from the worker: `next.config.ts` gives it a revalidating
 * `Cache-Control`, `proxy.ts` lets it through without a session, and the
 * worker itself imports it. A test reads the path out of the worker's own
 * `importScripts` call and compares it to this, so a move fails there.
 *
 * No import from `@/lib/utils/notification-service-worker`: that module pulls
 * in zod and the notification schema, and both `next.config.ts` and the proxy
 * would carry it for one string.
 */
export const PUSH_WORKER_MESSAGES_PATH = "/ably-push-messages.js";

/**
 * Cache-Control for that catalog.
 *
 * `no-cache` means revalidate, not "do not store". The worker's registration
 * asks for `updateViaCache: "none"`, but Ably registers the same worker URL
 * with no options inside `push.activate()` (`ably/build/push.js`), and the
 * Register algorithm writes the job's mode onto an existing registration, so
 * whichever call runs last decides. Under the default, `"imports"`, an
 * imported script is checked against the HTTP cache: a release that changes
 * only a translated string leaves the worker itself byte for byte the same,
 * so the catalog is the only thing that moved and the cache would be allowed
 * to answer for it. This header holds whichever registration wins.
 */
export const PUSH_WORKER_MESSAGES_CACHE_CONTROL = "public, max-age=0, no-cache";
