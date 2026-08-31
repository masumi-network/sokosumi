import { beforeEach, describe, expect, it, vi } from "vitest";

const { RealtimeMock, PushMock } = vi.hoisted(() => ({
  RealtimeMock: vi.fn(function Realtime(this: Record<string, unknown>) {
    return this;
  }),
  PushMock: { name: "ably-push-plugin" },
}));

vi.mock("ably", () => ({
  default: {
    Realtime: RealtimeMock,
  },
}));

vi.mock("ably/push", () => ({
  default: PushMock,
}));

vi.mock("./ably-client-instance-id", () => ({
  getOrCreateAblyClientInstanceId: () => "inst_test01",
}));

import { NOTIFICATION_SERVICE_WORKER_URL } from "@/lib/utils/notification-service-worker";

import { getAblyRealtimeClient } from "./realtime-singleton.client";

describe("getAblyRealtimeClient", () => {
  beforeEach(() => {
    globalThis.__sokosumiAblyRealtimeClient = undefined;
    RealtimeMock.mockClear();
  });

  it("does not echo the publisher's own messages back on the shared client", () => {
    getAblyRealtimeClient();

    // Only the echo option is this test's concern. The shared client also
    // carries the push plugin and worker URL (SOK-875), so an exhaustive
    // object here breaks on every unrelated option the client gains.
    expect(RealtimeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authUrl: "/api/ably/auth",
        authMethod: "POST",
        authParams: {
          clientInstanceId: "inst_test01",
        },
        echoMessages: false,
      }),
    );
  });

  /**
   * Push rides this shared client because ably-js accepts plugins only in the
   * constructor. Miss either option and the settings switch activates nothing,
   * with no error until a reader turns push on.
   */
  it("carries the push plugin and the worker URL", () => {
    getAblyRealtimeClient();

    expect(RealtimeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        plugins: { Push: PushMock },
        pushServiceWorkerUrl: NOTIFICATION_SERVICE_WORKER_URL,
      }),
    );
  });
});
