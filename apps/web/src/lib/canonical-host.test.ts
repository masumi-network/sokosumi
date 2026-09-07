import { createContext, runInContext } from "node:vm";

import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { NOTIFICATION_SERVICE_WORKER_URL } from "@/lib/utils/notification-service-worker";

import { handleNonCanonicalHost } from "./canonical-host";

const MAINNET_PRODUCTION = {
  vercelEnv: "production",
  network: "Mainnet",
} as const;

/** A production deployment URL, the host this whole module exists for. */
const DEPLOYMENT_HOST = "sokosumi-app-mainnet-od9mmtb7d.preview.sokosumi.com";

function request(url: string): NextRequest {
  return new NextRequest(url);
}

describe("handleNonCanonicalHost", () => {
  it("sends a production deployment host to the canonical host, path and query intact", () => {
    const response = handleNonCanonicalHost(
      request(`https://${DEPLOYMENT_HOST}/chat/rooms/abc?tab=files`),
      MAINNET_PRODUCTION,
    );

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe(
      "https://app.sokosumi.com/chat/rooms/abc?tab=files",
    );
  });

  it("uses the Preprod domain on the Preprod network", () => {
    const response = handleNonCanonicalHost(
      request("https://sokosumi-app-preprod-od9mmtb7d.preview.sokosumi.com/"),
      { vercelEnv: "production", network: "Preprod" },
    );

    expect(response?.headers.get("location")).toBe(
      "https://preprod.sokosumi.com/",
    );
  });

  it.each([
    ["//evil.example/x?a=1", "https://app.sokosumi.com/evil.example/x?a=1"],
    ["/\\/evil.example/x", "https://app.sokosumi.com/evil.example/x"],
    ["////evil.example/", "https://app.sokosumi.com/evil.example/"],
  ])(
    "never sends %s off the canonical host",
    (attackerPath, expectedLocation) => {
      // A protocol-relative pathname resolved against the canonical URL keeps
      // only the scheme, so the reader would land on the attacker's host.
      const response = handleNonCanonicalHost(
        request(`https://${DEPLOYMENT_HOST}${attackerPath}`),
        MAINNET_PRODUCTION,
      );

      const location = response?.headers.get("location");
      expect(location).toBe(expectedLocation);
      expect(new URL(location ?? "").host).toBe("app.sokosumi.com");
    },
  );

  it("leaves the canonical host alone", () => {
    expect(
      handleNonCanonicalHost(
        request("https://app.sokosumi.com/chat"),
        MAINNET_PRODUCTION,
      ),
    ).toBeNull();
  });

  it("leaves preview deployments alone, since that host is the only one they have", () => {
    expect(
      handleNonCanonicalHost(
        request(
          "https://sokosumi-app-mainnet-git-topic.preview.sokosumi.com/chat",
        ),
        { vercelEnv: "preview", network: "Mainnet" },
      ),
    ).toBeNull();
  });

  it("leaves local development alone", () => {
    expect(
      handleNonCanonicalHost(request("http://localhost:3000/chat"), {
        vercelEnv: undefined,
        network: "Mainnet",
      }),
    ).toBeNull();
  });

  it.each(["app.sokosumi.com.", "APP.SOKOSUMI.COM", "app.sokosumi.com:443"])(
    "leaves %s alone, which is the canonical host written another way",
    (host) => {
      // A reader who types the fully qualified form would otherwise be served
      // the unregistering worker on what is, to them, the app.
      expect(
        handleNonCanonicalHost(
          request(`https://${host}${NOTIFICATION_SERVICE_WORKER_URL}`),
          MAINNET_PRODUCTION,
        ),
      ).toBeNull();
    },
  );

  it("leaves the other network's canonical host alone", () => {
    // Read from the set of both canonical hosts rather than this deployment's
    // own network, so a missing or wrong NETWORK cannot answer a canonical
    // domain with a redirect to the other network.
    expect(
      handleNonCanonicalHost(request("https://preprod.sokosumi.com/chat"), {
        vercelEnv: "production",
        network: "Mainnet",
      }),
    ).toBeNull();
  });

  describe("the notification service worker", () => {
    it("is served a script rather than a page", async () => {
      const response = handleNonCanonicalHost(
        request(`https://${DEPLOYMENT_HOST}${NOTIFICATION_SERVICE_WORKER_URL}`),
        MAINNET_PRODUCTION,
      );

      expect(response?.status).toBe(200);
      expect(response?.headers.get("content-type")).toContain("javascript");
      expect(response?.headers.get("cache-control")).toBe("no-store");
    });

    it("is not redirected, which would fail the fetch and keep the old worker", () => {
      const response = handleNonCanonicalHost(
        request(`https://${DEPLOYMENT_HOST}${NOTIFICATION_SERVICE_WORKER_URL}`),
        MAINNET_PRODUCTION,
      );

      expect(response?.headers.get("location")).toBeNull();
    });

    /**
     * The worker ships as a string, so nothing compiles it. These run its
     * source in a sandbox standing in for the service worker global and drive
     * the real events, the way
     * `lib/utils/__tests__/push-service-worker-display.test.ts` drives the
     * worker in `public/`. A substring assertion would pass over a syntax
     * error, a wrong event name, or a missing `waitUntil`.
     */
    async function runStaleWorker(
      getSubscription: () => Promise<{
        unsubscribe: () => Promise<boolean>;
      } | null>,
    ) {
      const response = handleNonCanonicalHost(
        request(`https://${DEPLOYMENT_HOST}${NOTIFICATION_SERVICE_WORKER_URL}`),
        MAINNET_PRODUCTION,
      );
      const source = await response?.text();

      const listeners = new Map<string, (event: unknown) => void>();
      const unregister = vi.fn(async () => true);
      const skipWaiting = vi.fn();
      const consoleError = vi.fn();
      const self = {
        addEventListener: (type: string, listener: (event: unknown) => void) =>
          listeners.set(type, listener),
        skipWaiting,
        registration: {
          pushManager: { getSubscription },
          unregister,
        },
      };

      const context = createContext({ self, console: { error: consoleError } });
      runInContext(source ?? "", context);

      listeners.get("install")?.(undefined);

      let activated: Promise<unknown> = Promise.resolve();
      listeners.get("activate")?.({
        waitUntil: (promise: Promise<unknown>) => {
          activated = promise;
        },
      });
      await activated;

      return { unregister, skipWaiting, consoleError };
    }

    it("takes over at once, drops the subscription, then unregisters", async () => {
      const unsubscribe = vi.fn(async () => true);
      const { unregister, skipWaiting } = await runStaleWorker(async () => ({
        unsubscribe,
      }));

      expect(skipWaiting).toHaveBeenCalled();
      expect(unsubscribe).toHaveBeenCalled();
      expect(unregister).toHaveBeenCalled();
    });

    it("unregisters when this browser held no subscription", async () => {
      const { unregister } = await runStaleWorker(async () => null);

      expect(unregister).toHaveBeenCalled();
    });

    it("unregisters even when the subscription cannot be dropped", async () => {
      const { unregister, consoleError } = await runStaleWorker(() =>
        Promise.reject(new Error("push service unreachable")),
      );

      // A subscription left on an origin with no worker reaches nothing, so
      // letting go of the registration still ends the stale banners.
      expect(consoleError).toHaveBeenCalled();
      expect(unregister).toHaveBeenCalled();
    });

    it("is still served normally on the canonical host", () => {
      expect(
        handleNonCanonicalHost(
          request(`https://app.sokosumi.com${NOTIFICATION_SERVICE_WORKER_URL}`),
          MAINNET_PRODUCTION,
        ),
      ).toBeNull();
    });
  });
});
