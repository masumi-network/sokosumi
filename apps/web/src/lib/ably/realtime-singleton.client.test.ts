import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { RealtimeMock, PushMock } = vi.hoisted(() => ({
  RealtimeMock: vi.fn(function Realtime(
    this: { close: ReturnType<typeof vi.fn> },
    _options: unknown,
  ) {
    this.close = vi.fn();
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

import { getNotificationServiceWorkerUrl } from "@/lib/utils/notification-service-worker";

import { getAblyRealtimeClient } from "./realtime-singleton.client";

interface RealtimeAuthCallback {
  (
    data: unknown,
    callback: (error: string | null, token: unknown) => void,
  ): void;
}

interface RealtimeClientOptions {
  authUrl?: string;
  authMethod?: string;
  authParams?: { clientInstanceId?: string };
  authCallback?: RealtimeAuthCallback;
  echoMessages?: boolean;
}

function getConstructedRealtimeClient(): {
  close: ReturnType<typeof vi.fn>;
} {
  const constructed = RealtimeMock.mock.instances[0];
  if (!constructed) {
    throw new Error("Ably.Realtime was not constructed");
  }
  return constructed;
}

function getRealtimeClientOptions(): RealtimeClientOptions {
  const options = RealtimeMock.mock.calls[0]?.[0] as
    | RealtimeClientOptions
    | undefined;
  if (!options) {
    throw new Error("Ably.Realtime was not constructed");
  }
  return options;
}

async function invokeAuthCallback(): Promise<{
  error: string | null;
  token: unknown;
}> {
  const { authCallback } = getRealtimeClientOptions();
  if (!authCallback) {
    throw new Error("expected authCallback on the shared Realtime client");
  }

  return new Promise((resolve) => {
    authCallback({}, (error, token) => {
      resolve({ error, token });
    });
  });
}

describe("getAblyRealtimeClient", () => {
  const fetchMock = vi.fn();
  const consoleErrorMock = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);

  beforeEach(() => {
    globalThis.__sokosumiAblyRealtimeClient = undefined;
    RealtimeMock.mockClear();
    fetchMock.mockReset();
    consoleErrorMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterAll(() => {
    consoleErrorMock.mockRestore();
  });

  it("does not echo the publisher's own messages back on the shared client", () => {
    getAblyRealtimeClient();

    // Only the echo option is this test's concern. The shared client also
    // carries the push plugin and worker URL (SOK-875), so an exhaustive
    // object here breaks on every unrelated option the client gains.
    expect(RealtimeMock).toHaveBeenCalledWith(
      expect.objectContaining({
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
        pushServiceWorkerUrl: getNotificationServiceWorkerUrl(),
      }),
    );
  });

  it("owns token fetch via authCallback instead of Ably authUrl XHR", () => {
    getAblyRealtimeClient();

    const options = getRealtimeClientOptions();
    expect(options.authCallback).toEqual(expect.any(Function));
    expect(options.authUrl).toBeUndefined();
    expect(options.authMethod).toBeUndefined();
    expect(options.authParams).toBeUndefined();
  });

  it("clears the shared singleton when /api/ably/auth returns 401", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"Unauthorized"}',
    });

    getAblyRealtimeClient();
    const authResult = await invokeAuthCallback();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ably/auth?clientInstanceId=inst_test01",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
    expect(authResult.token).toBeNull();
    expect(authResult.error).toEqual(expect.any(String));
    expect(globalThis.__sokosumiAblyRealtimeClient).toBeUndefined();
    expect(getConstructedRealtimeClient().close).toHaveBeenCalled();
    expect(consoleErrorMock).not.toHaveBeenCalled();
  });

  it("does not clear the singleton when /api/ably/auth returns 502", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => '{"error":"Failed to create Ably token"}',
    });

    const client = getAblyRealtimeClient();
    const authResult = await invokeAuthCallback();

    expect(authResult.token).toBeNull();
    expect(authResult.error).toEqual(expect.stringMatching(/502/));
    expect(globalThis.__sokosumiAblyRealtimeClient).toBe(client);
    expect(getConstructedRealtimeClient().close).not.toHaveBeenCalled();
    expect(consoleErrorMock).toHaveBeenCalled();
  });

  it("recreates a client after a 401 so a later remount can reconnect", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"Unauthorized"}',
    });

    getAblyRealtimeClient();
    await invokeAuthCallback();
    RealtimeMock.mockClear();

    const nextClient = getAblyRealtimeClient();
    expect(RealtimeMock).toHaveBeenCalledTimes(1);
    expect(globalThis.__sokosumiAblyRealtimeClient).toBe(nextClient);
  });
});
