import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

const createClientMock = vi.fn();
const getMock = vi.fn();
const patchMock = vi.fn();

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
    });
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

  it("fetches unread count, marks one read, and marks all read", async () => {
    await withTransformer(getMock, {
      data: { count: 3 },
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

    const count =
      await notificationsBrowserClient.getNotificationsUnreadCount();
    expect(count.data.count).toBe(3);
    expect(getMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/notifications/unread-count",
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
