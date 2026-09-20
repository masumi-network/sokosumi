import { makeChatTypingChannelName } from "@sokosumi/utils";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorizeMock, getMock, channelsByName, ablyClient } = vi.hoisted(
  () => {
    const authorize = vi.fn();
    const get = vi.fn();
    return {
      authorizeMock: authorize,
      getMock: get,
      channelsByName: new Map<
        string,
        {
          name: string;
          subscribe: ReturnType<typeof vi.fn>;
          unsubscribe: ReturnType<typeof vi.fn>;
          publish: ReturnType<typeof vi.fn>;
          detach: ReturnType<typeof vi.fn>;
        }
      >(),
      ablyClient: {
        auth: { authorize },
        channels: { get },
        connection: { on: vi.fn(), off: vi.fn() },
      },
    };
  },
);

vi.mock("ably/react", () => ({
  useAbly: () => ablyClient,
}));

import { useRoomTyping } from "./use-room-typing";

const ROOM_ID = "room-a";
const SELF = "user_me";
const TYPING_CHANNEL = makeChatTypingChannelName(ROOM_ID);

function channelFor(name: string) {
  let channel = channelsByName.get(name);
  if (!channel) {
    channel = {
      name,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      publish: vi.fn().mockResolvedValue(undefined),
      detach: vi.fn(),
    };
    channelsByName.set(name, channel);
  }
  return channel;
}

function tokenGranting(ops: string[]) {
  return {
    capability: JSON.stringify({ [TYPING_CHANNEL]: ops }),
  };
}

function connectedHandler(): (() => void) | undefined {
  const call = ablyClient.connection.on.mock.calls.find(
    (args) => args[0] === "connected",
  );
  return call?.[1] as (() => void) | undefined;
}

/** Feed the hook an event as if it arrived from another client. */
function emit(data: unknown) {
  const channel = channelFor(TYPING_CHANNEL);
  for (const [, handler] of channel.subscribe.mock.calls) {
    (handler as (message: { data: unknown }) => void)({ data });
  }
}

describe("useRoomTyping", () => {
  beforeEach(() => {
    authorizeMock.mockReset();
    getMock.mockReset();
    channelsByName.clear();
    ablyClient.connection.on.mockReset();
    ablyClient.connection.off.mockReset();
    getMock.mockImplementation((name: string) => channelFor(name));
    authorizeMock.mockResolvedValue(tokenGranting(["publish", "subscribe"]));
  });

  it("names a teammate who is typing", async () => {
    const { result } = renderHook(() => useRoomTyping(ROOM_ID, SELF));
    await waitFor(() => {
      expect(channelFor(TYPING_CHANNEL).subscribe).toHaveBeenCalled();
    });

    act(() => {
      emit({ userId: "user_pat", state: "started", parentMessageId: null });
    });

    await waitFor(() => {
      expect(result.current.typistIds).toEqual(["user_pat"]);
    });
  });

  it("ignores a payload that claims a Thread, so it cannot light up the room", async () => {
    const { result } = renderHook(() => useRoomTyping(ROOM_ID, SELF));
    await waitFor(() => {
      expect(channelFor(TYPING_CHANNEL).subscribe).toHaveBeenCalled();
    });

    act(() => {
      emit({ userId: "user_pat", state: "started", parentMessageId: "msg_1" });
    });

    expect(result.current.typistIds).toEqual([]);
  });

  it("ignores a malformed payload", async () => {
    const { result } = renderHook(() => useRoomTyping(ROOM_ID, SELF));
    await waitFor(() => {
      expect(channelFor(TYPING_CHANNEL).subscribe).toHaveBeenCalled();
    });

    act(() => {
      emit({ userId: "", state: "started", parentMessageId: null });
      emit({ nonsense: true });
    });

    expect(result.current.typistIds).toEqual([]);
  });

  it("announces the first keystroke as an ephemeral message", async () => {
    const { result } = renderHook(() => useRoomTyping(ROOM_ID, SELF));
    await waitFor(() => {
      expect(channelFor(TYPING_CHANNEL).subscribe).toHaveBeenCalled();
    });

    act(() => {
      result.current.handleComposerChange(true);
    });

    expect(channelFor(TYPING_CHANNEL).publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "chat_typing",
        data: { userId: SELF, state: "started", parentMessageId: null },
        extras: { ephemeral: true },
      }),
    );
  });

  it("says nothing twice inside the throttle window", async () => {
    const { result } = renderHook(() => useRoomTyping(ROOM_ID, SELF));
    await waitFor(() => {
      expect(channelFor(TYPING_CHANNEL).subscribe).toHaveBeenCalled();
    });

    act(() => {
      result.current.handleComposerChange(true);
      result.current.handleComposerChange(true);
      result.current.handleComposerChange(true);
    });

    expect(channelFor(TYPING_CHANNEL).publish).toHaveBeenCalledTimes(1);
  });

  it("stops when the composer is cleared", async () => {
    const { result } = renderHook(() => useRoomTyping(ROOM_ID, SELF));
    await waitFor(() => {
      expect(channelFor(TYPING_CHANNEL).subscribe).toHaveBeenCalled();
    });

    act(() => {
      result.current.handleComposerChange(true);
      result.current.handleComposerChange(false);
    });

    expect(channelFor(TYPING_CHANNEL).publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { userId: SELF, state: "stopped", parentMessageId: null },
      }),
    );
  });

  it("stays silent when a Draft is restored without a keystroke", async () => {
    renderHook(() => useRoomTyping(ROOM_ID, SELF));
    await waitFor(() => {
      expect(channelFor(TYPING_CHANNEL).subscribe).toHaveBeenCalled();
    });

    expect(channelFor(TYPING_CHANNEL).publish).not.toHaveBeenCalled();
  });

  it("does not stop twice when it never started", async () => {
    const { result } = renderHook(() => useRoomTyping(ROOM_ID, SELF));
    await waitFor(() => {
      expect(channelFor(TYPING_CHANNEL).subscribe).toHaveBeenCalled();
    });

    act(() => {
      result.current.handleStopTyping();
      result.current.handleStopTyping();
    });

    expect(channelFor(TYPING_CHANNEL).publish).not.toHaveBeenCalled();
  });

  it("tells the room it stopped when the reader leaves", async () => {
    const { result, unmount } = renderHook(() => useRoomTyping(ROOM_ID, SELF));
    await waitFor(() => {
      expect(channelFor(TYPING_CHANNEL).subscribe).toHaveBeenCalled();
    });
    act(() => {
      result.current.handleComposerChange(true);
    });

    unmount();

    expect(channelFor(TYPING_CHANNEL).publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { userId: SELF, state: "stopped", parentMessageId: null },
      }),
    );
  });

  it("shows nobody and publishes nothing when the token grants no typing", async () => {
    authorizeMock.mockResolvedValue({ capability: JSON.stringify({}) });
    const { result } = renderHook(() => useRoomTyping(ROOM_ID, SELF));

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalled();
    });

    act(() => {
      result.current.handleComposerChange(true);
    });

    expect(channelFor(TYPING_CHANNEL).subscribe).not.toHaveBeenCalled();
    expect(channelFor(TYPING_CHANNEL).publish).not.toHaveBeenCalled();
    expect(result.current.typistIds).toEqual([]);
  });

  it("reads the room but stays quiet when the token grants subscribe only", async () => {
    authorizeMock.mockResolvedValue(tokenGranting(["subscribe"]));
    const { result } = renderHook(() => useRoomTyping(ROOM_ID, SELF));
    await waitFor(() => {
      expect(channelFor(TYPING_CHANNEL).subscribe).toHaveBeenCalled();
    });

    act(() => {
      result.current.handleComposerChange(true);
      emit({ userId: "user_pat", state: "started", parentMessageId: null });
    });

    expect(channelFor(TYPING_CHANNEL).publish).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.typistIds).toEqual(["user_pat"]);
    });
  });

  it("does not authorize twice at once when a reconnect lands mid-authorize", async () => {
    // Mount and `connected` can both enter. Without coalescing each issues its
    // own token request concurrently; the guard makes the second wait and
    // re-run after the first, so Ably never sees overlapping authorizes.
    const releases: (() => void)[] = [];
    authorizeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(() => resolve(tokenGranting(["publish", "subscribe"])));
        }),
    );

    renderHook(() => useRoomTyping(ROOM_ID, SELF));
    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalled();
    });

    // Second entry while the first authorize is still pending.
    act(() => {
      connectedHandler()?.();
    });

    // The first is still unresolved, so a second authorize here would be a
    // concurrent one.
    expect(authorizeMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      for (const release of releases) {
        release();
      }
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(channelFor(TYPING_CHANNEL).subscribe).toHaveBeenCalledTimes(1);
  });

  it("shows nobody without a room or a signed-in reader", () => {
    const { result } = renderHook(() => useRoomTyping(null, SELF));

    expect(result.current.typistIds).toEqual([]);
    expect(getMock).not.toHaveBeenCalled();
  });
});
