import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  acquireExportLease,
  exportAdmissionKeys,
  releaseExportLease,
} from "./export-admission";

const mock = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/redis", () => ({ getRedisClient: mock.client }));

// Explicit socket only. Never fall back to an application's Redis credentials.
const socket = process.env.EXPORT_ADMISSION_REDIS_SOCKET;
describe.skipIf(!socket)("export admission against disposable Redis", () => {
  let redis: Redis;
  const users: string[] = [];
  function user() {
    const id = `test-${randomUUID()}`;
    users.push(id);
    return id;
  }
  beforeAll(async () => {
    redis = new Redis({
      path: socket,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
    });
    await redis.connect();
    mock.client.mockReturnValue(redis);
  });
  afterAll(async () => {
    for (const id of users) await redis.del(...exportAdmissionKeys(id));
    await redis.quit();
  });
  it("admits exactly one simultaneous request for a user across calls", async () => {
    const id = user();
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => acquireExportLease(id)),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected")
        expect(result.reason).toMatchObject({ status: 429 });
    }
    const [, starts] = exportAdmissionKeys(id);
    expect(await redis.zcard(starts)).toBe(1);
    await expect(acquireExportLease(user())).resolves.toHaveProperty("token");
  });
  it("does not allow a wrong user or stale token to release active work", async () => {
    const id = user();
    const first = await acquireExportLease(id);
    expect(await releaseExportLease(user(), first.token)).toEqual({
      released: false,
    });
    expect(await releaseExportLease(id, randomUUID())).toEqual({
      released: false,
    });
    await expect(acquireExportLease(id)).rejects.toMatchObject({ status: 429 });
    expect(await releaseExportLease(id, first.token)).toEqual({
      released: true,
    });
    const second = await acquireExportLease(id);
    expect(await releaseExportLease(id, first.token)).toEqual({
      released: false,
    });
    await expect(acquireExportLease(id)).rejects.toMatchObject({ status: 429 });
    expect(await releaseExportLease(id, second.token)).toEqual({
      released: true,
    });
  });
  it("allows five starts then rejects the sixth after earlier exports finish", async () => {
    const id = user();
    for (let count = 0; count < 5; count++) {
      const lease = await acquireExportLease(id);
      await releaseExportLease(id, lease.token);
    }
    await expect(acquireExportLease(id)).rejects.toMatchObject({ status: 429 });
    const [, starts] = exportAdmissionKeys(id);
    expect(await redis.zcard(starts)).toBe(5);
    expect(await redis.pttl(starts)).toBeGreaterThan(0);
  });
  it("drops starts outside the rolling window and recovers an expired lease", async () => {
    const id = user();
    const [lease, starts] = exportAdmissionKeys(id);
    const [seconds, micros] = await redis.time();
    const now = Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
    for (let count = 0; count < 5; count++)
      await redis.zadd(starts, now - 60_001, `old-${count}`);
    await redis.set(lease, "abandoned", "PX", 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(acquireExportLease(id)).resolves.toHaveProperty("token");
    expect(await redis.zcard(starts)).toBe(1);
    expect(await redis.pttl(lease)).toBeGreaterThan(60_000);
  });
});
