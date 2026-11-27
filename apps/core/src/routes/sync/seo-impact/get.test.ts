import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sync, prepare, acquire, release, pending, env } = vi.hoisted(() => ({
  sync: vi.fn(),
  prepare: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  pending: [] as Promise<unknown>[],
  env: {
    CRON_SECRET: "test-secret",
    LOCK_TIMEOUT: 5000,
    LOCK_TIMEOUT_BUFFER: 1000,
    SEO_IMPACT_TRACKING_ENABLED: false,
    SEO_IMPACT_DISPATCH_ENABLED: false,
  },
}));
vi.mock("@/config/env", () => ({ getEnv: () => env }));
vi.mock("@/services/seo-impact.service", () => ({ syncSeoImpact: sync }));
vi.mock("@/services/seo-impact-prepare", () => ({
  prepareSeoImpactInputs: prepare,
}));
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

const defaults = { ...env };

afterEach(() => {
  Object.assign(env, defaults);
});

beforeEach(() => {
  vi.resetAllMocks();
  pending.length = 0;
  acquire.mockResolvedValue({ key: "seo-impact-sync", ownerToken: "owner" });
  release.mockResolvedValue(true);
  sync.mockResolvedValue({ stopped: false });
  prepare.mockResolvedValue({});
});

describe("SEO impact sync route", () => {
  it("takes no lock and runs nothing while tracking is off", async () => {
    env.SEO_IMPACT_TRACKING_ENABLED = false;

    const response = await app().request("/seo-impact", { headers });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "Sync disabled" });
    expect(acquire).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
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
    expect(prepare).toHaveBeenCalledOnce();
  });

  it("keeps a minute of the tick from the inspections for preparing", async () => {
    env.SEO_IMPACT_TRACKING_ENABLED = true;
    env.SEO_IMPACT_DISPATCH_ENABLED = true;
    env.LOCK_TIMEOUT = 300_000;
    sync.mockResolvedValue({ stopped: true });

    await app().request("/seo-impact", { headers });
    await Promise.all(pending);

    const [inspecting] = sync.mock.calls[0]!;
    const [preparing] = prepare.mock.calls[0]!;
    expect(preparing.msRemaining() - inspecting.msRemaining()).toBeCloseTo(
      60_000,
      -3,
    );
  });

  it("keeps nothing back from the inspections while dispatch is off", async () => {
    env.SEO_IMPACT_TRACKING_ENABLED = true;
    env.LOCK_TIMEOUT = 300_000;
    sync.mockResolvedValue({ stopped: true });

    await app().request("/seo-impact", { headers });
    await Promise.all(pending);

    const [inspecting] = sync.mock.calls[0]!;
    const [preparing] = prepare.mock.calls[0]!;
    expect(preparing.msRemaining() - inspecting.msRemaining()).toBeCloseTo(
      0,
      -3,
    );
  });

  it("splits a short tick between the inspections and preparing", async () => {
    env.SEO_IMPACT_TRACKING_ENABLED = true;
    env.SEO_IMPACT_DISPATCH_ENABLED = true;
    env.LOCK_TIMEOUT = 60_000;
    sync.mockResolvedValue({ stopped: true });

    await app().request("/seo-impact", { headers });
    await Promise.all(pending);

    const [inspecting] = sync.mock.calls[0]!;
    const [preparing] = prepare.mock.calls[0]!;
    // 59 s of tick, LOCK_TIMEOUT less its buffer: half of it each.
    expect(preparing.msRemaining() - inspecting.msRemaining()).toBeCloseTo(
      29_500,
      -3,
    );
  });
});
