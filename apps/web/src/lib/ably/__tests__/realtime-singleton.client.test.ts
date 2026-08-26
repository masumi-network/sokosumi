import { beforeEach, describe, expect, it, vi } from "vitest";

const { RealtimeMock } = vi.hoisted(() => ({
  RealtimeMock: vi.fn(function Realtime(this: Record<string, unknown>) {
    return this;
  }),
}));

vi.mock("ably", () => ({
  default: {
    Realtime: RealtimeMock,
  },
}));

vi.mock("../ably-client-instance-id", () => ({
  getOrCreateAblyClientInstanceId: () => "inst_test01",
}));

import { getAblyRealtimeClient } from "../realtime-singleton.client";

describe("getAblyRealtimeClient", () => {
  beforeEach(() => {
    globalThis.__sokosumiAblyRealtimeClient = undefined;
    RealtimeMock.mockClear();
  });

  it("does not echo the publisher's own messages back on the shared client", () => {
    getAblyRealtimeClient();

    expect(RealtimeMock).toHaveBeenCalledWith({
      authUrl: "/api/ably/auth",
      authMethod: "POST",
      authParams: {
        clientInstanceId: "inst_test01",
      },
      echoMessages: false,
    });
  });
});
