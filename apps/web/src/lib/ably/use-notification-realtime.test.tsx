import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { channel, channelListeners, connection, envMock, useChannelMock } =
  vi.hoisted(() => {
    const channelListeners = new Map<
      string,
      Set<(change: { resumed: boolean }) => void>
    >();
    return {
      channelListeners,
      channel: {
        state: "attached" as string,
        on: (
          event: string,
          listener: (change: { resumed: boolean }) => void,
        ) => {
          const listeners = channelListeners.get(event) ?? new Set();
          listeners.add(listener);
          channelListeners.set(event, listeners);
        },
        off: (
          event: string,
          listener: (change: { resumed: boolean }) => void,
        ) => {
          channelListeners.get(event)?.delete(listener);
        },
      },
      connection: { state: "connected" as string },
      envMock: {
        NEXT_PUBLIC_NETWORK: "Mainnet" as const,
        NEXT_PUBLIC_VERCEL_ENV: "production" as "production" | "preview",
        NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: "main" as string | undefined,
      },
      useChannelMock: vi.fn(),
    };
  });

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => envMock,
}));

vi.mock("ably/react", () => ({
  useAbly: () => ({ connection }),
  useChannel: (...args: unknown[]) => {
    useChannelMock(...args);
    return { channel };
  },
}));

import { useNotificationRealtime } from "./use-notification-realtime";

describe("useNotificationRealtime", () => {
  beforeEach(() => {
    channelListeners.clear();
    channel.state = "attached";
    connection.state = "connected";
    useChannelMock.mockClear();
  });

  function emitChannelState(event: string, resumed: boolean) {
    act(() => {
      for (const listener of channelListeners.get(event) ?? []) {
        listener({ resumed });
      }
    });
  }

  it("reconciles after the initial channel attachment, after the REST snapshot", () => {
    channel.state = "attaching";
    const onSubscribed = vi.fn();
    renderHook(() =>
      useNotificationRealtime({ userId: "user_1", onSubscribed }),
    );
    expect(onSubscribed).not.toHaveBeenCalled();

    channel.state = "attached";
    emitChannelState("attached", false);

    expect(onSubscribed).toHaveBeenCalledTimes(1);
  });

  it("reconciles missed notifications when an attached channel loses continuity", () => {
    const onSubscribed = vi.fn();
    const { unmount } = renderHook(() =>
      useNotificationRealtime({ userId: "user_1", onSubscribed }),
    );
    expect(onSubscribed).toHaveBeenCalledTimes(1);

    emitChannelState("update", true);
    expect(onSubscribed).toHaveBeenCalledTimes(1);
    emitChannelState("update", false);
    expect(onSubscribed).toHaveBeenCalledTimes(2);
    emitChannelState("attached", false);
    expect(onSubscribed).toHaveBeenCalledTimes(3);

    unmount();
    emitChannelState("attached", false);
    expect(onSubscribed).toHaveBeenCalledTimes(3);
  });

  it("listens only to its preview branch notification channel", () => {
    envMock.NEXT_PUBLIC_VERCEL_ENV = "preview";
    envMock.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF = "fix/push-urls";

    renderHook(() => useNotificationRealtime({ userId: "user_1" }));

    expect(useChannelMock).toHaveBeenCalledWith(
      "notifications:preview:mainnet:branch_fix%2Fpush-urls:user_user_1",
      "notification_created",
      expect.any(Function),
    );
  });

  it("reports it is receiving while the channel is attached", () => {
    channel.state = "attached";

    const { result } = renderHook(() =>
      useNotificationRealtime({ userId: "user_1" }),
    );

    expect(result.current.isReceivingNotifications()).toBe(true);
  });

  it("does not suppress push while an attached channel has lost its connection", () => {
    channel.state = "attached";
    connection.state = "connected";
    const { result } = renderHook(() =>
      useNotificationRealtime({ userId: "user_1" }),
    );
    connection.state = "disconnected";
    expect(result.current.isReceivingNotifications()).toBe(false);
    connection.state = "connected";
    expect(result.current.isReceivingNotifications()).toBe(true);
  });

  it("reports it is not receiving once the channel detaches", () => {
    channel.state = "attached";
    const { result } = renderHook(() =>
      useNotificationRealtime({ userId: "user_1" }),
    );

    channel.state = "detached";

    // Read at call time. A detach does not re-render this hook, and the
    // service worker asks long after the page mounted.
    expect(result.current.isReceivingNotifications()).toBe(false);
  });
});
