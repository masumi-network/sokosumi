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

const ROOM_SCOPE = { roomId: "room-1" };
const THREAD_SCOPE = {
  roomId: "room-1",
  parentMessageId: "parent-msg-1",
};

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

  it("builds room-scoped and thread-scoped redis keys", () => {
    expect(coworkerPendingResponseRedisKey(ROOM_SCOPE)).toBe(
      "coworker:pending_resp:room:room-1",
    );
    expect(coworkerPendingResponseRedisKey(THREAD_SCOPE)).toBe(
      "coworker:pending_resp:room:room-1:thread:parent-msg-1",
    );
    expect(
      coworkerPendingResponseRedisKey({
        roomId: "room-1",
        parentMessageId: "  ",
      }),
    ).toBe("coworker:pending_resp:room:room-1");
  });

  it("no-ops when redis is unavailable", async () => {
    getRedisClientMock.mockReturnValue(null);

    await setPendingResponseMirror(ROOM_SCOPE, "resp_1");
    await clearPendingResponseMirror(ROOM_SCOPE);
    await expect(getPendingResponseMirror(ROOM_SCOPE)).resolves.toBeNull();

    expect(redisSetMock).not.toHaveBeenCalled();
    expect(redisDelMock).not.toHaveBeenCalled();
    expect(redisGetMock).not.toHaveBeenCalled();
  });

  it("sets, reads, and clears the pending response mirror for a room", async () => {
    await setPendingResponseMirror(ROOM_SCOPE, "resp_1");

    expect(redisSetMock).toHaveBeenCalledWith(
      coworkerPendingResponseRedisKey(ROOM_SCOPE),
      "resp_1",
      "EX",
      COWORKER_STREAM_LOCK_TTL_SECONDS,
    );

    redisGetMock.mockResolvedValueOnce("resp_1");
    await expect(getPendingResponseMirror(ROOM_SCOPE)).resolves.toBe("resp_1");

    await clearPendingResponseMirror(ROOM_SCOPE);
    expect(redisDelMock).toHaveBeenCalledWith(
      coworkerPendingResponseRedisKey(ROOM_SCOPE),
    );
  });
});
