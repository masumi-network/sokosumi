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
import {
  getAblyRealtimeClient,
  subscribeToAblyRealtimeClient,
} from "./realtime-singleton.client";

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

function getConstructedRealtimeClient(index = 0): {
  close: ReturnType<typeof vi.fn>;
} {
  const constructed = RealtimeMock.mock.instances[index];
  if (!constructed) {
    throw new Error("Ably.Realtime was not constructed");
  }
  return constructed;
}

function mockUnauthorized(): void {
  fetchMockValue({
    ok: false,
    status: 401,
    text: async () => '{"error":"Unauthorized"}',
  });
}

function mockTokenFor(clientId: string): void {
  fetchMockValue({
    ok: true,
    status: 200,
    json: async () => ({ clientId, keyName: "key", mac: "mac" }),
  });
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

const fetchMock = vi.fn();

function fetchMockValue(response: unknown): void {
  fetchMock.mockResolvedValue(response);
}

describe("getAblyRealtimeClient", () => {
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
    // The status is the only signal that tells a real logout from an outage.
    expect(consoleErrorMock).toHaveBeenCalledWith(
      "Ably auth request failed",
      expect.objectContaining({ status: 401 }),
    );
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
    mockUnauthorized();

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

  /**
   * ably-js re-runs the auth callback on its own backoff and never gives up on
   * our auth failure, so a tab left open after a logout would POST
   * /api/ably/auth every 30s for the life of the page.
   */
  it("retires the client once 401s prove the session is really gone", async () => {
    mockUnauthorized();

    const client = getAblyRealtimeClient();
    await invokeAuthCallback();
    await invokeAuthCallback();

    // Two is still a blip — Core reported timed-out session reads as 401.
    expect(globalThis.__sokosumiAblyRealtimeClient).toBe(client);
    expect(getConstructedRealtimeClient().close).not.toHaveBeenCalled();

    await invokeAuthCallback();

    expect(getConstructedRealtimeClient().close).toHaveBeenCalled();
    expect(globalThis.__sokosumiAblyRealtimeClient).toBeUndefined();

    // Dropping the global is what makes close() survivable: the next mount
    // builds a working client instead of holding a dead one.
    mockTokenFor("user-b:inst_test01");
    expect(getAblyRealtimeClient()).not.toBe(client);
  });

  it("does not count a 502 towards the session-loss limit", async () => {
    fetchMockValue({
      ok: false,
      status: 502,
      text: async () => '{"error":"Failed to create Ably token"}',
    });

    const client = getAblyRealtimeClient();
    await invokeAuthCallback();
    await invokeAuthCallback();
    await invokeAuthCallback();
    await invokeAuthCallback();

    // An outage must stay retriable however long it lasts.
    expect(globalThis.__sokosumiAblyRealtimeClient).toBe(client);
    expect(getConstructedRealtimeClient().close).not.toHaveBeenCalled();
  });

  it("forgets earlier 401s once a token comes back", async () => {
    const client = getAblyRealtimeClient();

    mockUnauthorized();
    await invokeAuthCallback();
    await invokeAuthCallback();

    mockTokenFor("user-a:inst_test01");
    await invokeAuthCallback();

    mockUnauthorized();
    await invokeAuthCallback();
    await invokeAuthCallback();

    expect(globalThis.__sokosumiAblyRealtimeClient).toBe(client);
    expect(getConstructedRealtimeClient().close).not.toHaveBeenCalled();
  });

  /**
   * Core mints `${userId}:${clientInstanceId}`. ably-js rejects a token whose
   * clientId contradicts the one the client latched (40102) and fails the
   * connection terminally, which no retry and no remount can undo while the
   * global still points at that client.
   */
  it("retires the client when a second user signs in to the tab", async () => {
    mockTokenFor("user-a:inst_test01");

    const client = getAblyRealtimeClient();
    const firstResult = await invokeAuthCallback();
    expect(firstResult.error).toBeNull();

    mockTokenFor("user-b:inst_test01");
    const secondResult = await invokeAuthCallback();

    expect(secondResult.token).toBeNull();
    expect(secondResult.error).toEqual(expect.any(String));
    expect(getConstructedRealtimeClient().close).toHaveBeenCalled();
    expect(globalThis.__sokosumiAblyRealtimeClient).toBeUndefined();

    const replacement = getAblyRealtimeClient();
    expect(replacement).not.toBe(client);
    expect(getConstructedRealtimeClient(1).close).not.toHaveBeenCalled();
  });

  /**
   * A callback that was already in flight when its own client was retired
   * must not close the replacement. Closing whatever happens to be global at
   * settle time kills a healthy client built for the user who just signed in,
   * and a counter left armed retires that replacement on its first failure.
   */
  it("does not let a late 401 from a retired client close its replacement", async () => {
    mockUnauthorized();

    const client = getAblyRealtimeClient();
    const retiredCallback = getRealtimeClientOptions().authCallback;
    if (!retiredCallback) {
      throw new Error("expected an authCallback");
    }
    await invokeAuthCallback();
    await invokeAuthCallback();
    await invokeAuthCallback();

    expect(globalThis.__sokosumiAblyRealtimeClient).toBeUndefined();

    const replacement = getAblyRealtimeClient();
    expect(replacement).not.toBe(client);

    // A fourth 401 settles on the retired client's own closure.
    await new Promise<void>((resolve) => {
      retiredCallback({}, () => resolve());
    });

    expect(globalThis.__sokosumiAblyRealtimeClient).toBe(replacement);
    expect(getConstructedRealtimeClient(1).close).not.toHaveBeenCalled();
  });

  it("rebuilds the client for mounted providers after an identity change", async () => {
    mockTokenFor("user-a:inst_test01");

    getAblyRealtimeClient();
    await invokeAuthCallback();

    const listener = vi.fn();
    const unsubscribe = subscribeToAblyRealtimeClient(listener);

    mockTokenFor("user-b:inst_test01");
    await invokeAuthCallback();

    // Without the notification a mounted provider keeps the closed client and
    // stays silent for the rest of the page's life.
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("does not rebuild for a signed-out browser", async () => {
    mockUnauthorized();

    getAblyRealtimeClient();
    const listener = vi.fn();
    const unsubscribe = subscribeToAblyRealtimeClient(listener);

    await invokeAuthCallback();
    await invokeAuthCallback();
    await invokeAuthCallback();

    // Rebuilding here would restart the polling the retire just stopped.
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  /**
   * A TokenRequest without a clientId does not contradict the latched one, so
   * ably-js accepts it. Treating a missing clientId as a changed identity
   * would retire a healthy client on a routine renewal.
   */
  it("keeps the client when a renewal carries no clientId", async () => {
    mockTokenFor("user-a:inst_test01");

    const client = getAblyRealtimeClient();
    await invokeAuthCallback();

    fetchMockValue({
      ok: true,
      status: 200,
      json: async () => ({ keyName: "key", mac: "mac" }),
    });
    const renewal = await invokeAuthCallback();

    expect(renewal.error).toBeNull();
    expect(globalThis.__sokosumiAblyRealtimeClient).toBe(client);
    expect(getConstructedRealtimeClient().close).not.toHaveBeenCalled();
  });

  it("keeps serving the same user across token renewals", async () => {
    mockTokenFor("user-a:inst_test01");

    const client = getAblyRealtimeClient();
    await invokeAuthCallback();
    const renewal = await invokeAuthCallback();

    expect(renewal.error).toBeNull();
    expect(globalThis.__sokosumiAblyRealtimeClient).toBe(client);
    expect(getConstructedRealtimeClient().close).not.toHaveBeenCalled();
  });
});
