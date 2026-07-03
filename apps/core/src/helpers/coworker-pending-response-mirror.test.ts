import { beforeEach, describe, expect, it, vi } from "vitest";

const { getRedisClientMock, redisDelMock, redisGetMock, redisSetMock } =
  vi.hoisted(() => ({
    getRedisClientMock: vi.fn(),
    redisDelMock: vi.fn(),
    redisGetMock: vi.fn(),
    redisSetMock: vi.fn(),
  }));

vi.mock("@/lib/redis", () => ({
  getRedisClient: getRedisClientMock,
}));

import {
  clearPendingResponseMirror,
  coworkerPendingResponseRedisKey,
  getPendingResponseMirror,
  setPendingResponseMirror,
} from "./coworker-pending-response-mirror";
import { COWORKER_STREAM_LOCK_TTL_SECONDS } from "./coworker-stream-lock";

describe("coworker-pending-response-mirror", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRedisClientMock.mockReturnValue({
      get: redisGetMock,
      set: redisSetMock,
      del: redisDelMock,
    });
    redisGetMock.mockResolvedValue(null);
    redisSetMock.mockResolvedValue("OK");
    redisDelMock.mockResolvedValue(1);
  });

  it("builds the expected redis key", () => {
    expect(coworkerPendingResponseRedisKey("conv-1")).toBe(
      "coworker:pending_resp:conv-1",
    );
  });

  it("no-ops when redis is unavailable", async () => {
    getRedisClientMock.mockReturnValue(null);

    await setPendingResponseMirror("conv-1", "resp_1");
    await clearPendingResponseMirror("conv-1");
    await expect(getPendingResponseMirror("conv-1")).resolves.toBeNull();

    expect(redisSetMock).not.toHaveBeenCalled();
    expect(redisDelMock).not.toHaveBeenCalled();
    expect(redisGetMock).not.toHaveBeenCalled();
  });

  it("sets, reads, and clears the pending response mirror", async () => {
    await setPendingResponseMirror("conv-1", "resp_1");

    expect(redisSetMock).toHaveBeenCalledWith(
      coworkerPendingResponseRedisKey("conv-1"),
      "resp_1",
      "EX",
      COWORKER_STREAM_LOCK_TTL_SECONDS,
    );

    redisGetMock.mockResolvedValueOnce("resp_1");
    await expect(getPendingResponseMirror("conv-1")).resolves.toBe("resp_1");

    await clearPendingResponseMirror("conv-1");
    expect(redisDelMock).toHaveBeenCalledWith(
      coworkerPendingResponseRedisKey("conv-1"),
    );
  });
});
