import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { channel, envMock, useChannelMock } = vi.hoisted(() => ({
  channel: { state: "attached" as string },
  envMock: {
    NEXT_PUBLIC_NETWORK: "Mainnet" as const,
    NEXT_PUBLIC_VERCEL_ENV: "production" as "production" | "preview",
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: "main" as string | undefined,
  },
  useChannelMock: vi.fn(),
}));

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => envMock,
}));

vi.mock("ably/react", () => ({
  useChannel: (...args: unknown[]) => {
    useChannelMock(...args);
    return { channel };
  },
}));

import { useNotificationRealtime } from "./use-notification-realtime";

describe("useNotificationRealtime", () => {
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
