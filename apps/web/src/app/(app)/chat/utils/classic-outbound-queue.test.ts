import { describe, expect, it, vi } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import {
  type ClassicOutboundJob,
  type ClassicOutboundQueueRefs,
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
    mentionedOrchestratorIds: [],
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
