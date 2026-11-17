import { beforeEach, describe, expect, it, vi } from "vitest";
import { coreLogEvents, expectCoreLogWhys } from "@/test/core-log";

const { getRedisClientMock, redisHsetMock, redisHdelMock } = vi.hoisted(() => ({
  getRedisClientMock: vi.fn(),
  redisHsetMock: vi.fn(),
  redisHdelMock: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({ getRedisClient: getRedisClientMock }));

import {
  trackLateCoworkerResponse,
  untrackLateCoworkerResponse,
} from "./coworker-late-responses";

const RESPONSE_ID = "019fc7e4-e4bd-7005-900c-66e44d33f5e4";
// ioredis quotes the server's or a proxy's reply in its error.
const REDIS_REPLY = new Error("ERR proxy reply: 'Ada private note'");

beforeEach(() => {
  vi.clearAllMocks();
  getRedisClientMock.mockReturnValue({
    hset: redisHsetMock,
    hdel: redisHdelMock,
  });
});

describe("coworker late responses", () => {
  it("keeps Redis's reply out of the log when tracking fails", async () => {
    const errors = expectCoreLogWhys(
      "error",
      "A coworker response that may outlive its stream was not tracked",
      ["Writing the late-response entry to Redis failed"],
    );
    redisHsetMock.mockRejectedValue(REDIS_REPLY);

    await expect(
      trackLateCoworkerResponse({
        responseId: RESPONSE_ID,
        roomId: "room_1",
        parentMessageId: null,
        coworkerId: "coworker_1",
        userId: "user_1",
        organizationId: null,
        startedAtMs: 0,
      }),
    ).resolves.toBeUndefined();

    expect(errors[0]?.cause).toBeUndefined();
    expect(errors[0]?.event).toMatchObject({
      responseId: RESPONSE_ID,
      failure: { errorName: "Error" },
    });
    expect(JSON.stringify(coreLogEvents())).not.toContain("Ada private");
  });

  it("keeps Redis's reply out of the log when untracking fails", async () => {
    const errors = expectCoreLogWhys(
      "error",
      "A delivered coworker response was not removed from the late responses",
      ["Deleting the late-response entry from Redis failed"],
    );
    redisHdelMock.mockRejectedValue(REDIS_REPLY);

    await expect(
      untrackLateCoworkerResponse(RESPONSE_ID),
    ).resolves.toBeUndefined();

    expect(errors[0]?.cause).toBeUndefined();
    expect(JSON.stringify(coreLogEvents())).not.toContain("Ada private");
  });
});
