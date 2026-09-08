import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import {
  type ClassicOutboundJob,
  type ClassicOutboundQueueRefs,
  clearClassicOutboundQueue,
  drainClassicOutboundQueue,
  enqueueClassicOutboundJob,
} from "./classic-outbound-queue";

function makeRefs(): ClassicOutboundQueueRefs {
  return {
    queueRef: { current: [] },
    jobsRef: { current: new Map() },
    runningRef: { current: false },
  };
}

function job(id: string): ClassicOutboundJob {
  return {
    roomId: "room-1",
    content: `msg-${id}`,
    mentionedCoworkerIds: [],
    mentionedSokoBotIds: [],
    mentionedUserIds: [],
    clientMessageId: id,
  };
}

function message(id: string): ChatRoomMessage {
  return {
    id,
    roomId: "room-1",
    parentMessageId: null,
    content: "ok",
    createdAt: new Date(),
    deletedAt: null,
    editedAt: null,
    sender: {
      type: "user",
      user: {
        id: "u1",
        name: "Ada",
        email: "a@x.com",
        image: null,
        presence: "online",
      },
    },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    unfurls: null,
  };
}

describe("drainClassicOutboundQueue", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("releases a stalled send and retains its idempotency key for explicit retry", async () => {
    vi.useFakeTimers();
    const refs = makeRefs();
    const late = Promise.withResolvers<{ ok: true; value: ChatRoomMessage }>();
    const retry = Promise.withResolvers<{ ok: true; value: ChatRoomMessage }>();
    enqueueClassicOutboundJob(refs, job("a"), () => undefined);
    enqueueClassicOutboundJob(refs, job("b"), () => undefined);
    const send = vi
      .fn()
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce({ ok: true, value: message("server-b") })
      .mockReturnValueOnce(retry.promise);
    const onFailure = vi.fn();
    const onSuccess = vi.fn();
    const params = {
      refs,
      send,
      onFailure,
      onSuccess,
      unknownFailureMessage: "Failed",
    };
    const firstDrain = drainClassicOutboundQueue(params);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(job("a"), "Failed");
    await firstDrain;
    expect(send).toHaveBeenCalledTimes(2);
    expect(refs.jobsRef.current.get("a")).toEqual(job("a"));
    expect(refs.runningRef.current).toBe(false);

    const retryJob = refs.jobsRef.current.get("a");
    expect(retryJob).toBeDefined();
    enqueueClassicOutboundJob(refs, retryJob!, () => undefined);
    const retryDrain = drainClassicOutboundQueue(params);
    late.resolve({ ok: true, value: message("late-original") });
    await vi.advanceTimersByTimeAsync(0);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(refs.jobsRef.current.has("a")).toBe(true);
    expect(refs.runningRef.current).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2]?.[0].clientMessageId).toBe("a");

    retry.resolve({ ok: true, value: message("retry-confirmed") });
    await retryDrain;
    expect(onSuccess).toHaveBeenCalledTimes(2);
    expect(onSuccess.mock.calls[1]?.[1].id).toBe("retry-confirmed");
    expect(refs.jobsRef.current.has("a")).toBe(false);
  });

  it("starts a new room queue without waiting for the old room's pending send", async () => {
    const refs = makeRefs();
    const old = Promise.withResolvers<{ ok: true; value: ChatRoomMessage }>();
    const current = Promise.withResolvers<{
      ok: true;
      value: ChatRoomMessage;
    }>();
    const send = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise)
      .mockResolvedValue({ ok: true, value: message("server-c") });
    const onFailure = vi.fn();
    const onSuccess = vi.fn();
    const params = {
      refs,
      send,
      onFailure,
      onSuccess,
      unknownFailureMessage: "Failed",
    };
    enqueueClassicOutboundJob(refs, job("a"), () => undefined);
    const oldDrain = drainClassicOutboundQueue(params);
    clearClassicOutboundQueue(refs);
    enqueueClassicOutboundJob(
      refs,
      { ...job("b"), roomId: "room-2" },
      () => undefined,
    );
    const currentDrain = drainClassicOutboundQueue(params);
    expect(send).toHaveBeenCalledTimes(2);

    old.resolve({ ok: true, value: message("old-room") });
    await oldDrain;
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
    expect(refs.runningRef.current).toBe(true);
    enqueueClassicOutboundJob(
      refs,
      { ...job("c"), roomId: "room-2" },
      () => void drainClassicOutboundQueue(params),
    );
    expect(send).toHaveBeenCalledTimes(2);
    current.resolve({ ok: true, value: message("new-room") });
    await currentDrain;
    expect(send).toHaveBeenCalledTimes(3);
    expect(onSuccess.mock.calls.map((call) => call[0].clientMessageId)).toEqual(
      ["b", "c"],
    );
    expect(refs.runningRef.current).toBe(false);
  });

  it("keeps normal sends in order before the deadline", async () => {
    vi.useFakeTimers();
    const refs = makeRefs();
    const first = Promise.withResolvers<{ ok: true; value: ChatRoomMessage }>();
    enqueueClassicOutboundJob(refs, job("a"), () => undefined);
    enqueueClassicOutboundJob(refs, job("b"), () => undefined);
    const send = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ok: true, value: message("server-b") });
    const onSuccess = vi.fn();
    const drained = drainClassicOutboundQueue({
      refs,
      send,
      onSuccess,
      onFailure: vi.fn(),
      unknownFailureMessage: "Failed",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(1);
    first.resolve({ ok: true, value: message("server-a") });
    await drained;
    expect(onSuccess.mock.calls.map((call) => call[0].clientMessageId)).toEqual(
      ["a", "b"],
    );
  });

  it("dequeues before send so a throw does not re-loop the same head", async () => {
    const refs = makeRefs();
    enqueueClassicOutboundJob(refs, job("a"), () => undefined);
    enqueueClassicOutboundJob(refs, job("b"), () => undefined);

    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ ok: true as const, value: message("srv-b") });

    const onFailure = vi.fn();
    const onSuccess = vi.fn();

    await drainClassicOutboundQueue({
      refs,
      send,
      onFailure,
      onSuccess,
      unknownFailureMessage: "Failed",
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]?.[0]?.clientMessageId).toBe("a");
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.calls[0]?.[0]?.clientMessageId).toBe("b");
    expect(refs.queueRef.current).toEqual([]);
  });

  it("keeps job on ok:false so retry can re-enqueue", async () => {
    const refs = makeRefs();
    enqueueClassicOutboundJob(refs, job("a"), () => undefined);

    await drainClassicOutboundQueue({
      refs,
      send: async () => ({
        ok: false as const,
        error: { message: "nope" },
      }),
      onFailure: (failedJob) => {
        // Surface marks failed but leaves job map for Retry.
        expect(refs.jobsRef.current.has(failedJob.clientMessageId)).toBe(true);
      },
      onSuccess: vi.fn(),
      unknownFailureMessage: "Failed",
    });

    expect(refs.jobsRef.current.has("a")).toBe(true);
    expect(refs.queueRef.current).toEqual([]);
  });
});
