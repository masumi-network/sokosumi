import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sweep, acquire, release, pending, env } = vi.hoisted(() => ({
  sweep: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  pending: [] as Promise<unknown>[],
  env: {
    CRON_SECRET: "test-secret",
    LOCK_TIMEOUT: 5000,
    LOCK_TIMEOUT_BUFFER: 1000,
  },
}));
vi.mock("@/config/env", () => ({ getEnv: () => env }));
vi.mock("@/services/chat-message-signals.service", () => ({
  sweepChatMessageSignals: sweep,
}));
vi.mock("@/services/sync-lock.service", () => ({
  syncLockService: { acquireLock: acquire, releaseLock: release },
}));
vi.mock("@vercel/functions", () => ({
  waitUntil: (work: Promise<unknown>) => pending.push(work),
}));

import mount from "./get";

function app() {
  const instance = new Hono();
  mount(instance);
  return instance;
}

beforeEach(() => {
  vi.resetAllMocks();
  pending.length = 0;
  acquire.mockResolvedValue({
    key: "chat-message-signals-sync",
    ownerToken: "o",
  });
  release.mockResolvedValue(true);
  sweep.mockResolvedValue(undefined);
});

describe("chat message signals sync", () => {
  it.each([undefined, "Bearer wrong"])(
    "requires the cron secret: %s",
    async (authorization) => {
      const response = await app().request("/chat-message-signals", {
        headers: authorization ? { authorization } : {},
      });
      expect(response.status).toBe(401);
      expect(sweep).not.toHaveBeenCalled();
    },
  );

  it("acknowledges, then sweeps once under its lock", async () => {
    const response = await app().request("/chat-message-signals", {
      headers: { authorization: "Bearer test-secret" },
    });
    expect(response.status).toBe(200);
    await Promise.all(pending);
    expect(sweep).toHaveBeenCalledOnce();
    expect(acquire).toHaveBeenCalledWith("chat-message-signals-sync");
    expect(release).toHaveBeenCalledWith("chat-message-signals-sync", "o");
  });

  it("does nothing while another sweep holds the lock", async () => {
    acquire.mockRejectedValue(new Error("LOCK_IS_LOCKED"));
    const response = await app().request("/chat-message-signals", {
      headers: { authorization: "Bearer test-secret" },
    });
    expect(response.status).toBe(409);
    expect(sweep).not.toHaveBeenCalled();
  });
});
