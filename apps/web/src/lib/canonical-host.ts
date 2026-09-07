import { getCanonicalWebAppHost, getCanonicalWebAppUrl } from "@sokosumi/utils";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Keep production readers on the canonical host.
 *
 * A production deployment answers on two hosts: `app.sokosumi.com`, and the
 * per-deployment URL Vercel mints for it, whose hash changes with every
 * deploy. Both serve the same app against the same database, and Better Auth
 * trusts both, so a reader who arrives on the deployment URL is signed in and
 * sees nothing wrong. What they cannot see is that the browser ties a push
 * subscription to the origin that created it. Their notifications then come
 * from a hostname that means nothing to them, and clicking one leads back to
 * it rather than to the app.
 *
 * Preview deployments are left alone. Their per-branch host is the only host
 * they have.
 */

/**
 * Mirrors `NOTIFICATION_SERVICE_WORKER_URL`. Spelled out rather than imported
 * for the reason `proxy.ts` spells it out: that module pulls in zod and the
 * notification schema, and this runs on every request. `canonical-host.test.ts`
 * builds the path from the constant, so a rename fails there.
 */
const NOTIFICATION_SERVICE_WORKER_PATH = "/ably-push-sw.js";

/**
 * The worker a stale origin is served in place of the notification worker.
 *
 * Redirecting the reader is not enough on its own. A subscription they made on
 * this origin outlives their last visit, and the worker holding it keeps
 * rendering banners that lead back here. Only code running on this origin can
 * let go of it, so this replaces the real worker and does exactly that.
 *
 * The browser fetches a registered worker's script again on a page load in its
 * scope (MDN, Using Service Workers), which is what the reader's next click on
 * one of those banners causes. Finding a different script, it installs this
 * one, which drops the push subscription and then the registration itself.
 *
 * Deliberately without a `push` listener: by the time this is installed the
 * subscription is on its way out, and a listener would only be reached by a
 * push that raced it.
 */
const STALE_ORIGIN_SERVICE_WORKER = `/*
 * This deployment URL is not the canonical host for this app. The worker that
 * was registered here is replaced by one that unregisters itself, so push
 * notifications stop arriving from a hostname nobody recognises.
 */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const subscription =
          await self.registration.pushManager.getSubscription();
        await subscription?.unsubscribe();
      } catch (error) {
        // Unregister anyway. A subscription left behind on an origin with no
        // worker reaches nothing.
        console.error("Could not drop the stale push subscription", error);
      }

      await self.registration.unregister();
    })(),
  );
});
`;

export interface CanonicalHostParams {
  vercelEnv: string | undefined;
  network: "Mainnet" | "Preprod";
}

/**
 * Every host the app is legitimately reached on, both networks.
 *
 * Read as a set rather than compared against this deployment's own network, so
 * a `NETWORK` that is missing or wrong cannot answer `app.sokosumi.com` with a
 * redirect to the other network. Such a host never reaches the wrong
 * deployment anyway: it is aliased to one of them.
 */
const CANONICAL_HOSTS = new Set([
  getCanonicalWebAppHost("Mainnet"),
  getCanonicalWebAppHost("Preprod"),
]);

/**
 * The request's host, in the form `CANONICAL_HOSTS` is written in.
 *
 * A fully qualified name ends in a dot, and `app.sokosumi.com.` is a host the
 * reader can type. Left as it arrives it matches nothing here, and the reader
 * would be served the unregistering worker on what is, to them, the app.
 */
function normalizeHost(host: string): string {
  return host.endsWith(".") ? host.slice(0, -1) : host;
}

/** Whether this request reached a production deployment on the wrong host. */
function isNonCanonicalProductionHost(
  request: NextRequest,
  params: CanonicalHostParams,
): boolean {
  if (params.vercelEnv !== "production") {
    return false;
  }

  return !CANONICAL_HOSTS.has(normalizeHost(request.nextUrl.host));
}

/**
 * The response a non-canonical production host owes this request, or null when
 * the host is the canonical one and the request is nobody's business here.
 */
export function handleNonCanonicalHost(
  request: NextRequest,
  params: CanonicalHostParams,
): NextResponse | null {
  if (!isNonCanonicalProductionHost(request, params)) {
    return null;
  }

  const { pathname } = request.nextUrl;

  if (pathname === NOTIFICATION_SERVICE_WORKER_PATH) {
    return new NextResponse(STALE_ORIGIN_SERVICE_WORKER, {
      status: 200,
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        // The browser caps a worker script at 24 hours of caching on its own.
        // Say it outright, so the reader's next visit cannot be answered from
        // a copy of the script this one replaces.
        "cache-control": "no-store",
      },
    });
  }

  const target = new URL(getCanonicalWebAppUrl(params.network));
  // Assigned rather than resolved against the canonical URL as a base. A
  // pathname of `//evil.example/x` is protocol-relative, so resolving it keeps
  // only the scheme and sends the reader to the attacker's host. The leading
  // separators are collapsed as well, because `//evil.example/x` on our own
  // host is still a path nothing here serves.
  target.pathname = `/${pathname.replace(/^[/\\]+/, "")}`;
  target.search = request.nextUrl.search;

  // Temporary, so no browser caches the rule. A deployment URL stops being
  // reachable for smoke-testing either way, which is the cost of this
  // redirect; a cached permanent one would keep costing it after a change of
  // mind.
  return NextResponse.redirect(target, 307);
}
