import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { channel } = vi.hoisted(() => ({
  channel: { state: "attached" as string },
}));

vi.mock("ably/react", () => ({
  useChannel: () => ({ channel }),
}));

import { useNotificationRealtime } from "./use-notification-realtime";

describe("useNotificationRealtime", () => {
  it("reports it is receiving while the channel is attached", () => {
    channel.state = "attached";

    const { result } = renderHook(() =>
      useNotificationRealtime({ userId: "user_1" }),
    );

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
