import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireExportLease, releaseExportLease } from "./export-admission";

const mocks = vi.hoisted(() => ({ client: vi.fn(), evaluate: vi.fn() }));
vi.mock("@/lib/redis", () => ({ getRedisClient: mocks.client }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockReturnValue({ eval: mocks.evaluate });
  mocks.evaluate.mockResolvedValue(0);
});
afterEach(() => vi.useRealTimers());

describe("export admission dependency failures", () => {
  it("issues a fresh token for each admitted operation", async () => {
    const first = await acquireExportLease("user-a");
    const second = await acquireExportLease("user-a");
    expect(first.durationMs).toBe(45_000);
    expect(first.token).not.toBe(second.token);
  });
  it("returns 429 with the Redis retry delay", async () => {
    mocks.evaluate.mockResolvedValue(17);
    await expect(acquireExportLease("user-a")).rejects.toMatchObject({
      status: 429,
      cause: { retryAfterSeconds: 17 },
    });
  });
  it("fails closed without Redis and when connection setup fails", async () => {
    mocks.client.mockReturnValue(null);
    await expect(acquireExportLease("user-a")).rejects.toMatchObject({
      status: 503,
    });
    mocks.client.mockImplementation(() => {
      throw new Error("connection");
    });
    await expect(acquireExportLease("user-a")).rejects.toMatchObject({
      status: 503,
    });
  });
  it("fails closed when Redis rejects", async () => {
    mocks.evaluate.mockRejectedValue(new Error("offline"));
    await expect(acquireExportLease("user-a")).rejects.toMatchObject({
      status: 503,
    });
    await expect(releaseExportLease("user-a", "token")).rejects.toMatchObject({
      status: 503,
    });
  });
  it.each([null, "0", -1, 0.5, {}, []])(
    "rejects malformed admission reply %j",
    async (reply) => {
      mocks.evaluate.mockResolvedValue(reply);
      await expect(acquireExportLease("user-a")).rejects.toMatchObject({
        status: 503,
      });
    },
  );
  it.each([null, "1", 2, -1])(
    "rejects malformed release reply %j",
    async (reply) => {
      mocks.evaluate.mockResolvedValue(reply);
      await expect(releaseExportLease("user-a", "token")).rejects.toMatchObject(
        { status: 503 },
      );
    },
  );
  it("bounds a Redis operation that never settles", async () => {
    vi.useFakeTimers();
    mocks.evaluate.mockReturnValue(new Promise(() => {}));
    const result = expect(acquireExportLease("user-a")).rejects.toMatchObject({
      status: 503,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await result;
  });
});
