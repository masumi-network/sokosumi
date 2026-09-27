import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

const createClientMock = vi.fn();
const getMock = vi.fn();
const patchMock = vi.fn();
const postMock = vi.fn();
const putMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("@/lib/clients/utils/core-api-base-url.browser", () => ({
  getBrowserCoreApiBaseUrl: () => "https://api.sokosumi.com/v1",
}));

vi.mock("@/lib/clients/generated/core/client", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

async function withTransformer(
  mock: ReturnType<typeof vi.fn>,
  payload: unknown,
) {
  mock.mockImplementation(
    async (options: {
      responseTransformer?: (data: unknown) => Promise<unknown>;
    }) => {
      let data = payload;
      if (options.responseTransformer) {
        data = await options.responseTransformer(structuredClone(payload));
      }
      return {
        data,
        response: new Response("{}", { status: 200 }),
      };
    },
  );
}

describe("core.notifications.browser.client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    createClientMock.mockReturnValue({
      get: getMock,
      patch: patchMock,
      post: postMock,
      put: putMock,
      delete: deleteMock,
    });
  });

  it("sends activation, revision-bound subscription, and removal through Core", async () => {
    const result = {
      id: "consent",
      revision: 3,
      revoked: false,
      replaceDevice: true,
    };
    const meta = { timestamp: "2026-09-27T00:00:00Z" };
    await withTransformer(postMock, { data: result, meta });
    await withTransformer(putMock, { data: { subscribed: true }, meta });
    await withTransformer(deleteMock, { data: { success: true }, meta });
    const { notificationsBrowserClient: client } = await import(
      "./core.notifications.browser.client"
    );
    const input = { deviceId: "old", readerInitiated: false };
    expect((await client.beginPushActivation(input)).data).toEqual(result);
    await client.subscribePushDevice(
      { id: "new" },
      { consentId: "consent", revision: 3 },
    );
    await client.revokePushDevice({ id: "old" });
    expect(postMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/notifications/push-devices/activations",
        body: input,
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(putMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/notifications/push-devices/{id}/subscription",
        path: { id: "new" },
        body: { consentId: "consent", revision: 3 },
      }),
    );
    expect(deleteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/notifications/push-devices/{id}",
        path: { id: "old" },
        cache: "no-store",
      }),
    );
    expect(createClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("records coarse details with cookies, JSON, and a bounded request", async () => {
    await withTransformer(patchMock, {
      data: { success: true },
      meta: { timestamp: "2026-09-27T00:00:00Z" },
    });
    const { notificationsBrowserClient } = await import(
      "./core.notifications.browser.client"
    );
    const body = { browser: "Chrome", operatingSystem: "macOS" } as const;
    await notificationsBrowserClient.updatePushDeviceBrowser(
      { id: "device" },
      body,
    );
    expect(patchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/notifications/push-devices/{id}/browser",
        path: { id: "device" },
        body,
        headers: { "Content-Type": "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(createClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("converts recorded registration dates and leaves old devices undated", async () => {
    const registeredAt = "2026-09-26T12:00:00.000Z";
    await withTransformer(getMock, {
      data: [
        {
          id: "new",
          platform: "browser",
          formFactor: "desktop",
          state: "active",
          registeredAt,
        },
        {
          id: "old",
          platform: "browser",
          formFactor: "desktop",
          state: "active",
        },
      ],
      meta: { timestamp: "2026-09-27T00:00:00Z" },
    });
    const { notificationsBrowserClient } = await import(
      "./core.notifications.browser.client"
    );
    const response = await notificationsBrowserClient.getPushDevices();
    expect(response.data[0].registeredAt).toEqual(new Date(registeredAt));
    expect(response.data[1].registeredAt).toBeUndefined();
    expect(response.meta.timestamp).toBeInstanceOf(Date);
  });

  it("reads push devices with cookies and without caching", async () => {
    const devices = [
      {
        id: "device-1",
        platform: "browser",
        formFactor: "desktop",
        state: "active",
      },
    ];
    await withTransformer(getMock, {
      data: devices,
      meta: { timestamp: "2026-09-27T00:00:00Z", requestId: "request-1" },
    });
    const { notificationsBrowserClient } = await import(
      "./core.notifications.browser.client"
    );
    const response = await notificationsBrowserClient.getPushDevices();
    expect(response.data).toEqual(devices);
    expect(createClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: "include" }),
    );
    expect(getMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/notifications/push-devices",
        cache: "no-store",
      }),
    );
  });

  it("creates a cookie-credentials client and lists notifications", async () => {
    await withTransformer(getMock, {
      data: [
        {
          id: "n1",
          userId: "u1",
          kind: "JOB",
          referenceId: "job_1",
          eventId: "evt_1",
          messageKey: "Notifications.Job.completed",
          messageParams: {},
          metadata: null,
          isRead: false,
          readAt: null,
          createdAt: "2026-04-02T12:00:00.000Z",
        },
      ],
      meta: {
        timestamp: "2026-04-02T12:00:00.000Z",
        requestId: "req_1",
        pagination: { nextCursor: null, limit: 10 },
      },
    });

    const { notificationsBrowserClient } = await import(
      "./core.notifications.browser.client"
    );
    const response = await notificationsBrowserClient.getNotifications({
      limit: 10,
    });

    expect(createClientMock).toHaveBeenCalledWith({
      baseUrl: "https://api.sokosumi.com/v1",
      credentials: "include",
      headers: { "x-sokosumi-web-build-version": "1" },
    });
    expect(getMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/notifications",
        query: { limit: 10 },
        cache: "no-store",
      }),
    );
    expect(response.data[0]?.id).toBe("n1");
    expect(response.data[0]?.createdAt).toBeInstanceOf(Date);
    expect(response.meta.timestamp).toBeInstanceOf(Date);
  });

  it("fetches counts, marks one read, and marks all read", async () => {
    await withTransformer(getMock, {
      data: { unread: 3, needsAction: 1, mentions: 0 },
      meta: {
        timestamp: "2026-04-02T12:00:00.000Z",
        requestId: "req_count",
      },
    });

    let patchCall = 0;
    patchMock.mockImplementation(
      async (options: {
        responseTransformer?: (data: unknown) => Promise<unknown>;
      }) => {
        patchCall += 1;
        const payload =
          patchCall === 1
            ? {
                data: {
                  id: "n1",
                  userId: "u1",
                  kind: "JOB",
                  referenceId: "job_1",
                  eventId: "evt_1",
                  messageKey: "Notifications.Job.completed",
                  messageParams: {},
                  metadata: null,
                  isRead: true,
                  readAt: "2026-04-02T12:05:00.000Z",
                  createdAt: "2026-04-02T12:00:00.000Z",
                },
                meta: {
                  timestamp: "2026-04-02T12:05:00.000Z",
                  requestId: "req_read",
                },
              }
            : {
                data: { updatedCount: 3 },
                meta: {
                  timestamp: "2026-04-02T12:06:00.000Z",
                  requestId: "req_all",
                },
              };

        let data: unknown = structuredClone(payload);
        if (options.responseTransformer) {
          data = await options.responseTransformer(data);
        }
        return {
          data,
          response: new Response("{}", { status: 200 }),
        };
      },
    );

    const { notificationsBrowserClient } = await import(
      "./core.notifications.browser.client"
    );

    const counts = await notificationsBrowserClient.getNotificationsCounts();
    expect(counts.data).toEqual({ unread: 3, needsAction: 1, mentions: 0 });
    expect(getMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/notifications/counts",
        cache: "no-store",
      }),
    );

    const marked = await notificationsBrowserClient.patchNotificationRead({
      id: "n1",
    });
    expect(marked.data.isRead).toBe(true);
    expect(marked.data.readAt).toBeInstanceOf(Date);
    expect(patchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/notifications/{id}/read",
        path: { id: "n1" },
        cache: "no-store",
      }),
    );

    await notificationsBrowserClient.patchNotificationsReadAll();
    expect(patchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/notifications/read-all",
        cache: "no-store",
      }),
    );

    await notificationsBrowserClient.patchNotificationsRead({
      kind: "TASK",
      referenceId: "task-1",
    });
    expect(patchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/notifications/read",
        body: { kind: "TASK", referenceId: "task-1" },
        cache: "no-store",
      }),
    );

    await notificationsBrowserClient.patchNotificationsRead({ ids: ["n1"] });
    expect(patchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/notifications/read",
        body: { ids: ["n1"] },
        cache: "no-store",
      }),
    );
  });

  it("does not import createCoreClient, core.shared, or sdk.gen", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const source = await readFile(
      resolve(
        process.cwd(),
        "src/lib/clients/core.notifications.browser.client.ts",
      ),
      "utf8",
    );

    expect(source).not.toMatch(/createCoreClient/);
    expect(source).not.toMatch(/core\.shared/);
    expect(source).not.toMatch(/sdk\.gen/);
  });
});
