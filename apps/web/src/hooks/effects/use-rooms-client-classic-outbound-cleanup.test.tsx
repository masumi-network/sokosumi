import { render } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { describe, expect, it } from "vitest";

import type {
  ClassicOutboundJob,
  ClassicOutboundQueueRefs,
} from "@/app/chat/utils/classic-outbound-queue";
import { useRoomsClientClassicOutboundCleanup } from "./use-rooms-client-classic-outbound-cleanup";

function makeJob(id: string): ClassicOutboundJob {
  return {
    roomId: "room-1",
    content: "hello",
    mentionedCoworkerIds: [],
    mentionedSokoBotIds: [],
    mentionedUserIds: [],
    clientMessageId: id,
  };
}

function makeQueueRefs(): ClassicOutboundQueueRefs {
  return {
    queueRef: { current: ["job-1"] },
    jobsRef: {
      current: new Map([["job-1", makeJob("job-1")]]),
    },
    runningRef: { current: true },
  };
}

function seed(refs: ClassicOutboundQueueRefs, id: string) {
  refs.queueRef.current.push(id);
  refs.jobsRef.current.set(id, makeJob(id));
  refs.runningRef.current = true;
}

describe("useRoomsClientClassicOutboundCleanup", () => {
  it("clears both queues on mount, room change, Activity hide/reveal, and unmount", () => {
    const channelRefs = makeQueueRefs();
    const threadRefs = makeQueueRefs();

    function Probe({ roomId }: { roomId: string | null }) {
      useRoomsClientClassicOutboundCleanup(roomId, channelRefs, threadRefs);
      return null;
    }

    const { rerender, unmount } = render(
      <Activity mode="visible">
        <Probe roomId="room-1" />
      </Activity>,
    );
    expect(channelRefs.queueRef.current).toEqual([]);
    expect(channelRefs.jobsRef.current.size).toBe(0);
    expect(channelRefs.runningRef.current).toBe(false);
    expect(threadRefs.queueRef.current).toEqual([]);
    expect(threadRefs.jobsRef.current.size).toBe(0);
    expect(threadRefs.runningRef.current).toBe(false);

    // Enqueue in room-1, then switch rooms: cleanup clears both queues.
    seed(channelRefs, "ch-2");
    seed(threadRefs, "th-2");
    rerender(
      <Activity mode="visible">
        <Probe roomId="room-2" />
      </Activity>,
    );
    expect(channelRefs.queueRef.current).toEqual([]);
    expect(threadRefs.queueRef.current).toEqual([]);

    // Enqueue, then hide under Activity: cleanup clears both queues.
    seed(channelRefs, "ch-3");
    seed(threadRefs, "th-3");
    rerender(
      <Activity mode="hidden">
        <Probe roomId="room-2" />
      </Activity>,
    );
    expect(channelRefs.queueRef.current).toEqual([]);
    expect(threadRefs.queueRef.current).toEqual([]);

    // Seed while hidden, then reveal: setup clears both queues.
    seed(channelRefs, "ch-4");
    seed(threadRefs, "th-4");
    rerender(
      <Activity mode="visible">
        <Probe roomId="room-2" />
      </Activity>,
    );
    expect(channelRefs.queueRef.current).toEqual([]);
    expect(threadRefs.queueRef.current).toEqual([]);

    // Seed and unmount: cleanup clears both queues.
    seed(channelRefs, "ch-5");
    seed(threadRefs, "th-5");
    unmount();
    expect(channelRefs.queueRef.current).toEqual([]);
    expect(threadRefs.queueRef.current).toEqual([]);
  });

  it("clears queues on both StrictMode mount passes", () => {
    const channelRefs = makeQueueRefs();
    const threadRefs = makeQueueRefs();
    let clearCount = 0;
    const origClear = channelRefs.jobsRef.current.clear.bind(
      channelRefs.jobsRef.current,
    );
    channelRefs.jobsRef.current.clear = () => {
      clearCount += 1;
      origClear();
    };

    function Probe() {
      useRoomsClientClassicOutboundCleanup("room-1", channelRefs, threadRefs);
      return null;
    }

    const { unmount } = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    // StrictMode mount runs setup -> cleanup -> setup = 3 clears on channelRefs.
    expect(clearCount).toBe(3);

    unmount();
    expect(clearCount).toBe(4);
  });
});
