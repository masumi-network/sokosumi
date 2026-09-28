import type { ClientOptions } from "ably";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface PushClientOptions {
  clientId?: string;
  plugins: { Push: unknown };
  pushServiceWorkerUrl: string;
  authCallback: NonNullable<ClientOptions["authCallback"]>;
}

const { RestMock, PushMock, fetchToken } = vi.hoisted(() => ({
  RestMock: vi.fn(function Rest(options: PushClientOptions) {
    return {
      auth: {
        authorize: vi.fn(
          () =>
            new Promise((resolve, reject) => {
              options.authCallback({}, (error, token) => {
                if (error)
                  reject(typeof error === "string" ? new Error(error) : error);
                else resolve(token);
              });
            }),
        ),
      },
    };
  }),
  PushMock: { name: "push-plugin" },
  fetchToken: vi.fn(),
}));

vi.mock("ably", () => ({ default: { Rest: RestMock } }));
vi.mock("ably/push", () => ({ default: PushMock }));
vi.mock("./ably-client-instance-id", () => ({
  getOrCreateAblyClientInstanceId: () => "instance",
}));
vi.mock("./auth.client", () => ({
  fetchAblyBrowserAuthTokenRequest: fetchToken,
}));
vi.mock("@/lib/utils/notification-service-worker", () => ({
  getNotificationServiceWorkerUrl: () => "/notification-worker.js",
}));

import { createAblyPushClient } from "./push-client.client";

describe("createAblyPushClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchToken.mockReset();
    fetchToken.mockResolvedValue({ clientId: "reader:instance" });
  });

  it("authorizes a REST client for the current reader and browser instance", async () => {
    const client = await createAblyPushClient("reader");
    expect(client.auth.authorize).toHaveBeenCalledOnce();
    expect(fetchToken).toHaveBeenCalledExactlyOnceWith("instance");
    expect(RestMock).toHaveBeenCalledWith({
      clientId: "reader:instance",
      plugins: { Push: PushMock },
      pushServiceWorkerUrl: "/notification-worker.js",
      authCallback: expect.any(Function),
    });
  });

  it("gives the real REST SDK the identity used by push registration", async () => {
    const { Rest } = await vi.importActual<typeof import("ably")>("ably");
    fetchToken.mockResolvedValue({
      token: "local-test-token",
      clientId: "reader:instance",
      issued: Date.now(),
      expires: Date.now() + 60_000,
    });
    await createAblyPushClient("reader");
    const options = RestMock.mock.calls.at(-1)?.[0];
    if (!options) throw new Error("Push client options missing");
    // Use the actual constructor and authorize path, without network requests.
    // Ably copies auth.clientId into the local push device during registration.
    const client = new Rest({ ...options, plugins: {} });
    await client.auth.authorize();
    expect(client.auth.clientId).toBe("reader:instance");
  });

  it("creates fresh SDK clients to read shared device state between operations", async () => {
    const first = await createAblyPushClient("reader");
    const second = await createAblyPushClient("reader");
    expect(first).not.toBe(second);
    expect(RestMock).toHaveBeenCalledTimes(2);
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it.each(["other:instance", "reader:other-instance", "reader", undefined])(
    "rejects a token whose clientId is not the expected reader and instance: %s",
    async (clientId) => {
      fetchToken.mockResolvedValue({ clientId });
      await expect(createAblyPushClient("reader")).rejects.toThrow(
        "Push session changed",
      );
    },
  );

  it("rechecks ownership when the SDK refreshes authentication", async () => {
    const client = await createAblyPushClient("reader");
    fetchToken.mockResolvedValue({ clientId: "other:instance" });
    await expect(client.auth.authorize()).rejects.toThrow(
      "Push session changed",
    );
  });

  it.each([new Error("Auth unavailable"), "Auth unavailable"])(
    "rejects when token retrieval fails: %s",
    async (error) => {
      fetchToken.mockRejectedValue(error);
      await expect(createAblyPushClient("reader")).rejects.toThrow(
        "Auth unavailable",
      );
    },
  );
});
