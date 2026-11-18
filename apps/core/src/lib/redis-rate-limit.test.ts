import { strict as assert } from "node:assert";
import { once } from "node:events";
import { createServer } from "node:net";
import { expect, it, vi } from "vitest";

import { getRedisRateLimitClient } from "@/lib/redis";
import { causeMessage, expectCoreLog } from "@/test/core-log";
import { incrementRedisRateLimit } from "./redis-rate-limit";

let redisUrl: string;
vi.mock("@/config/env", () => ({ getEnv: () => ({ REDIS_URL: redisUrl }) }));

it("fails open and flushes timed-out commands when a ready socket goes silent", async () => {
  await using server = createServer((socket) => socket.resume()).listen(
    0,
    "127.0.0.1",
  );
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  redisUrl = `redis://127.0.0.1:${address.port}/?lazyConnect=true`;
  const warnings = expectCoreLog("warn", "Redis connection failed");
  const client = getRedisRateLimitClient();
  assert(client);

  try {
    // Use TCP readiness so the server can stay entirely silent.
    Object.assign(client.options, {
      protocol: 2,
      disableClientInfo: true,
      enableReadyCheck: false,
    });
    await client.connect();

    const closed = new Promise<boolean>((resolve) => {
      client.once("close", () => resolve(true));
      AbortSignal.timeout(3_000).addEventListener(
        "abort",
        () => resolve(false),
        { once: true },
      );
    });
    const calls = ["test:one", "test:two"].map((key) =>
      incrementRedisRateLimit(key, 60),
    );
    expect(client.commandQueue.length).toBe(2);
    expect(await Promise.all(calls)).toEqual([undefined, undefined]);
    const socketClosed = await closed;
    expect(client.commandQueue.length).toBe(0);
    expect(socketClosed).toBe(true);
    expect(causeMessage(warnings[0]?.cause)).toContain("Socket timeout.");
  } finally {
    client.disconnect();
  }
});
