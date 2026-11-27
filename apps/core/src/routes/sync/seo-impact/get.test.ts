import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sync, acquire, release, pending, env } = vi.hoisted(() => ({
  sync: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  pending: [] as Promise<unknown>[],
  env: {
    CRON_SECRET: "test-secret",
    LOCK_TIMEOUT: 5000,
    LOCK_TIMEOUT_BUFFER: 1000,
    SEO_IMPACT_TRACKING_ENABLED: false,
  },
}));
vi.mock("@/config/env", () => ({ getEnv: () => env }));
vi.mock("@/services/seo-impact.service", () => ({ syncSeoImpact: sync }));
// The lock is the first database write of a tick.
vi.mock("@/services/sync-lock.service", () => ({
  syncLockService: { acquireLock: acquire, releaseLock: release },
}));
vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn((work: Promise<unknown>) => pending.push(work)),
}));

import mount from "./get";

const headers = { authorization: "Bearer test-secret" };
function app() {
  const instance = new Hono();
  mount(instance);
  return instance;
}

beforeEach(() => {
  vi.resetAllMocks();
  pending.length = 0;
  acquire.mockResolvedValue({ key: "seo-impact-sync", ownerToken: "owner" });
  release.mockResolvedValue(true);
  sync.mockResolvedValue({});
});

describe("SEO impact sync route", () => {
  it("takes no lock and runs nothing while tracking is off", async () => {
    env.SEO_IMPACT_TRACKING_ENABLED = false;

    const response = await app().request("/seo-impact", { headers });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "Sync disabled" });
    expect(acquire).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it("checks the cron secret before the flag", async () => {
    env.SEO_IMPACT_TRACKING_ENABLED = false;

    const response = await app().request("/seo-impact", {
      headers: { authorization: "Bearer wrong" },
    });

    expect(response.status).toBe(401);
  });

  it("runs the sync under its lock while tracking is on", async () => {
    env.SEO_IMPACT_TRACKING_ENABLED = true;

    const response = await app().request("/seo-impact", { headers });
    await Promise.all(pending);

    expect(response.status).toBe(200);
    expect(acquire).toHaveBeenCalledExactlyOnceWith("seo-impact-sync");
    expect(sync).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ msRemaining: expect.any(Function) }),
    );
  });
});
