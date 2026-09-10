import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type StateListener = (change: Record<string, unknown>) => void;

const { ablyClient, channel, channelListeners, connectionListeners } =
  vi.hoisted(() => {
    const channelListeners = new Set<StateListener>();
    const connectionListeners = new Set<StateListener>();
    const channel = {
      state: "attaching",
      on: vi.fn((listener: StateListener) => channelListeners.add(listener)),
      off: vi.fn((listener: StateListener) =>
        channelListeners.delete(listener),
      ),
    };
    return {
      channel,
      channelListeners,
      connectionListeners,
      ablyClient: {
        connection: {
          state: "connected",
          on: (listener: StateListener) => connectionListeners.add(listener),
          off: (listener: StateListener) =>
            connectionListeners.delete(listener),
        },
        channels: { get: vi.fn(() => channel) },
      },
    };
  });

vi.mock("ably/react", () => ({ useAbly: () => ablyClient }));

import {
  reportAblyAuthOk,
  setAblyConnectionHealthy,
  useAblyConnectionHealthy,
} from "./ably-connection-health-store";
import { useSelectedRoomChannelHealth } from "./use-selected-room-channel-health";

function emitChannel(change: Record<string, unknown>) {
  if (typeof change.current === "string") channel.state = change.current;
  for (const listener of channelListeners) listener(change);
}

function emitConnection(change: Record<string, unknown>) {
  if (typeof change.current === "string") {
    ablyClient.connection.state = change.current;
  }
  for (const listener of connectionListeners) listener(change);
}

function mount(selectedRoomId: string | null = "room-a") {
  const onHealthChange = vi.fn();
  const onContinuityLost = vi.fn();
  const hook = renderHook(
    (props: { selectedRoomId: string | null }) =>
      useSelectedRoomChannelHealth({
        selectedRoomId: props.selectedRoomId,
        onHealthChange,
        onContinuityLost,
      }),
    { initialProps: { selectedRoomId } },
  );
  return { ...hook, onHealthChange, onContinuityLost };
}

describe("useSelectedRoomChannelHealth", () => {
  beforeEach(() => {
    channelListeners.clear();
    connectionListeners.clear();
    channel.state = "attaching";
    channel.on.mockClear();
    channel.off.mockClear();
    ablyClient.connection.state = "connected";
    ablyClient.channels.get.mockClear();
    setAblyConnectionHealthy(false);
  });

  it("observes the room channel without attaching it", () => {
    mount();
    expect(ablyClient.channels.get).toHaveBeenCalledWith(
      "chat_rooms:room_room-a",
    );
    expect(channel.on).toHaveBeenCalledTimes(1);
  });

  it("reports healthy only while connected and attached, once per change", () => {
    const { onHealthChange } = mount();
    expect(onHealthChange).toHaveBeenLastCalledWith(false);

    act(() => emitChannel({ current: "attached", resumed: false }));
    expect(onHealthChange).toHaveBeenLastCalledWith(true);
    act(() => emitChannel({ current: "attached", resumed: true }));
    expect(onHealthChange).toHaveBeenCalledTimes(2);

    act(() =>
      emitConnection({ current: "disconnected", previous: "connected" }),
    );
    expect(onHealthChange).toHaveBeenLastCalledWith(false);
  });

  it("ignores the first attach but reports a later re-attach without resume", () => {
    const { onContinuityLost } = mount();

    act(() => emitChannel({ current: "attached", resumed: false }));
    expect(onContinuityLost).not.toHaveBeenCalled();

    act(() => emitChannel({ current: "attached", resumed: true }));
    expect(onContinuityLost).not.toHaveBeenCalled();

    // An `update` event: attached → attached with the gap unrecovered.
    act(() =>
      emitChannel({
        current: "attached",
        previous: "attached",
        resumed: false,
      }),
    );
    expect(onContinuityLost).toHaveBeenCalledTimes(1);
    expect(onContinuityLost).toHaveBeenCalledWith("room-a");
  });

  it("treats an already attached channel's re-attach as a gap", () => {
    channel.state = "attached";
    const { onContinuityLost } = mount();
    act(() => emitChannel({ current: "attached", resumed: false }));
    expect(onContinuityLost).toHaveBeenCalledTimes(1);
  });

  it("reports failed and suspended channels", () => {
    const { onContinuityLost } = mount();
    act(() => emitChannel({ current: "suspended" }));
    act(() => emitChannel({ current: "failed" }));
    expect(onContinuityLost).toHaveBeenCalledTimes(2);
  });

  it("reports the connection returning after a drop, not a first connect", () => {
    const { onContinuityLost } = mount();
    act(() => emitConnection({ current: "connected", previous: "connecting" }));
    expect(onContinuityLost).not.toHaveBeenCalled();
    act(() =>
      emitConnection({ current: "connected", previous: "disconnected" }),
    );
    expect(onContinuityLost).toHaveBeenCalledTimes(1);
  });

  it("stops observing a room that is no longer open", () => {
    const { rerender, onContinuityLost, onHealthChange } = mount();
    rerender({ selectedRoomId: null });
    expect(channel.off).toHaveBeenCalledTimes(1);
    expect(onHealthChange).toHaveBeenLastCalledWith(false);
    act(() => emitChannel({ current: "failed" }));
    expect(onContinuityLost).not.toHaveBeenCalled();
  });

  it("mirrors the connection state into the SDK-free health store once auth has succeeded", () => {
    reportAblyAuthOk(true);
    mount();
    const { result } = renderHook(() => useAblyConnectionHealthy());
    expect(result.current).toBe(true);
    act(() => emitConnection({ current: "suspended", previous: "connected" }));
    expect(result.current).toBe(false);
  });
});
