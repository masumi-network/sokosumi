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

import {
  getAblyConnectionHealthy,
  reportAblyConnectionConnected,
  setAblyConnectionHealthy,
} from "./ably-connection-health-store";
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
    setAblyConnectionHealthy(false);
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

  it("keeps the shared client when /api/ably/auth returns 401", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        keyName: "app.key",
        capability: "{}",
        timestamp: 1,
        nonce: "n",
        mac: "m",
      }),
    });
    const client = getAblyRealtimeClient();
    await invokeAuthCallback();
    reportAblyConnectionConnected(true);
    expect(getAblyConnectionHealthy()).toBe(true);

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => '{"error":"Unauthorized"}',
    });
    const authResult = await invokeAuthCallback();

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/ably/auth?clientInstanceId=inst_test01",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
    expect(authResult.token).toBeNull();
    expect(authResult.error).toEqual(expect.any(String));
    // close() is terminal for the instance AblyProvider already holds.
    // Production mixed 401 with 200 on this route in the same minute; treating
    // 401 as logout killed realtime until a page reload.
    expect(globalThis.__sokosumiAblyRealtimeClient).toBe(client);
    expect(getConstructedRealtimeClient().close).not.toHaveBeenCalled();
    expect(consoleErrorMock).toHaveBeenCalledWith(
      "Ably auth request failed",
      expect.objectContaining({ status: 401 }),
    );
    expect(getAblyConnectionHealthy()).toBe(false);
  });

  it("does not clear the singleton when /api/ably/auth returns 502", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        keyName: "app.key",
        capability: "{}",
        timestamp: 1,
        nonce: "n",
        mac: "m",
      }),
    });
    const client = getAblyRealtimeClient();
    await invokeAuthCallback();
    reportAblyConnectionConnected(true);
    expect(getAblyConnectionHealthy()).toBe(true);

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => '{"error":"Failed to create Ably token"}',
    });
    const authResult = await invokeAuthCallback();

    expect(authResult.token).toBeNull();
    expect(authResult.error).toEqual(expect.stringMatching(/502/));
    expect(globalThis.__sokosumiAblyRealtimeClient).toBe(client);
    expect(getConstructedRealtimeClient().close).not.toHaveBeenCalled();
    expect(consoleErrorMock).toHaveBeenCalled();
    expect(getAblyConnectionHealthy()).toBe(false);
  });

  it("reuses the same client after a 401 instead of building a second one", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"Unauthorized"}',
    });

    const client = getAblyRealtimeClient();
    await invokeAuthCallback();
    RealtimeMock.mockClear();

    expect(getAblyRealtimeClient()).toBe(client);
    expect(RealtimeMock).not.toHaveBeenCalled();
  });

  it("marks auth as delivering after a successful mint", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        keyName: "app.key",
        capability: "{}",
        timestamp: 1,
        nonce: "n",
        mac: "m",
      }),
    });

    getAblyRealtimeClient();
    const authResult = await invokeAuthCallback();

    expect(authResult.error).toBeNull();
    expect(authResult.token).toEqual(
      expect.objectContaining({ keyName: "app.key" }),
    );
    expect(getAblyConnectionHealthy()).toBe(false);
    reportAblyConnectionConnected(true);
    expect(getAblyConnectionHealthy()).toBe(true);
  });
});
