import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sync, acquire, release, pending } = vi.hoisted(() => ({
  sync: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  pending: [] as Promise<unknown>[],
}));
vi.mock("@/config/env", () => ({
  getEnv: () => ({
    CRON_SECRET: "test-secret",
    LOCK_TIMEOUT: 1200,
    LOCK_TIMEOUT_BUFFER: 1000,
  }),
}));
vi.mock("@/services/contact-capture.service", () => ({
  contactCaptureService: { sync },
}));
vi.mock("@/services/sync-lock.service", () => ({
  syncLockService: { acquireLock: acquire, releaseLock: release },
}));
vi.mock("@vercel/functions", () => ({
  waitUntil: (work: Promise<unknown>) => {
    pending.push(work);
  },
}));

import mount, { CONTACT_CAPTURE_SYNC_LOCK_KEY } from "./get";

const authorized = { headers: { authorization: "Bearer test-secret" } };

function request(init?: RequestInit) {
  const app = new Hono();
  mount(app);
  return app.request("/contact-capture", init);
}

beforeEach(() => {
  vi.resetAllMocks();
  pending.length = 0;
  acquire.mockResolvedValue({
    key: CONTACT_CAPTURE_SYNC_LOCK_KEY,
    ownerToken: "owner-1",
  });
  release.mockResolvedValue(true);
  sync.mockResolvedValue({ workspaces: 1 });
});

describe("contact capture cron", () => {
  it("answers 401 without or with a wrong secret, before taking the lock", async () => {
    expect((await request()).status).toBe(401);
    expect(
      (await request({ headers: { authorization: "Bearer nope" } })).status,
    ).toBe(401);
    expect(acquire).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it("answers 409 while another run holds the lock, and starts nothing", async () => {
    acquire.mockRejectedValue(new Error("LOCK_IS_LOCKED"));
    expect((await request(authorized)).status).toBe(409);
    expect(sync).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it("acknowledges at once, runs once in the background, and releases its own lock", async () => {
    const response = await request(authorized);
    expect(response.status).toBe(200);
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(acquire).toHaveBeenCalledWith("contact-capture-sync");
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith({ shouldContinue: expect.any(Function) });
    expect(release).toHaveBeenCalledWith("contact-capture-sync", "owner-1");
  });

  it("asks the run to stop at the deadline and still releases the lock", async () => {
    let stopped: boolean | undefined;
    sync.mockImplementation(
      async ({ shouldContinue }: { shouldContinue: () => boolean }) => {
        await new Promise((resolve) => setTimeout(resolve, 1100));
        stopped = !shouldContinue();
      },
    );
    await request(authorized);
    await Promise.all(pending);
    expect(stopped).toBe(true);
    expect(release).toHaveBeenCalledWith("contact-capture-sync", "owner-1");
  });

  it("releases the lock when the run fails", async () => {
    sync.mockRejectedValue(new Error("boom"));
    await request(authorized);
    await Promise.all(pending);
    expect(release).toHaveBeenCalledWith("contact-capture-sync", "owner-1");
  });

  it("leaves a lock another runner took over alone", async () => {
    // Compare-and-set on the owner token: a stale runner's release changes nothing.
    release.mockResolvedValue(false);
    await request(authorized);
    await Promise.all(pending);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith("contact-capture-sync", "owner-1");
  });
});
