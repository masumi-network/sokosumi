import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { sessionMock, refreshMock } = vi.hoisted(() => ({
  sessionMock: { current: null as unknown },
  refreshMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ refresh: refreshMock }));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: Record<string, unknown>) =>
      await handler({ ...params, session: sessionMock.current }),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSessionOrRedirect: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "better-auth.session=admin" }),
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: vi.fn(),
}));

vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getServerCoreApiBaseUrl: () => "http://core.test/v1",
  getCoreApiBaseUrl: () => "http://core.test/v1",
}));

import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";

import { setAdminPreprodAccessAction } from "./action";

const ADMIN_SESSION = { user: { id: "admin_1", role: "admin" } };
const MEMBER_SESSION = { user: { id: "user_9", role: "user" } };

const ACCESS = {
  enabled: true,
  changes: [
    {
      id: "change_1",
      createdAt: "2026-11-27T10:00:00.000Z",
      enabled: true,
      reason: "SOK-123",
      operator: { id: "admin_1", name: "Ada Admin" },
    },
  ],
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("setAdminPreprodAccessAction", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionMock.current = ADMIN_SESSION;
    refreshMock.mockReset();
    fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        data: ACCESS,
        meta: { timestamp: "2026-11-27T10:00:01.000Z" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  function lastRequest(): Request {
    const [input, init] = fetchMock.mock.calls.at(-1) as [
      RequestInfo,
      RequestInit | undefined,
    ];
    return new Request(input, init);
  }

  it("sends the user's switch to Core with the admin's session cookie and the trimmed reason", async () => {
    const result = await setAdminPreprodAccessAction({
      target: { type: "user", id: "user_1" },
      enabled: true,
      reason: "  SOK-123  ",
    });

    const request = lastRequest();
    expect(request.method).toBe("PUT");
    expect(request.url).toBe(
      "http://core.test/v1/admin/users/user_1/preprod-access",
    );
    expect(request.headers.get("cookie")).toBe("better-auth.session=admin");
    expect(await request.json()).toEqual({ enabled: true, reason: "SOK-123" });
    expect(result).toEqual({
      ok: true,
      value: {
        enabled: true,
        changes: [
          {
            ...ACCESS.changes[0],
            createdAt: new Date("2026-11-27T10:00:00.000Z"),
          },
        ],
      },
    });
  });

  it("renders the page again after Core answered", async () => {
    await setAdminPreprodAccessAction({
      target: { type: "user", id: "user_1" },
      enabled: true,
      reason: "SOK-123",
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("lets Core's sign-in redirect through", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { message: "Unauthorized" }),
    );

    await expect(
      setAdminPreprodAccessAction({
        target: { type: "user", id: "user_1" },
        enabled: true,
        reason: "SOK-123",
      }),
    ).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });

  it("sends an Organization's switch to its slug", async () => {
    await setAdminPreprodAccessAction({
      target: { type: "organization", slug: "acme" },
      enabled: false,
      reason: "SOK-9",
    });

    const request = lastRequest();
    expect(request.url).toBe(
      "http://core.test/v1/admin/organizations/acme/preprod-access",
    );
    expect(await request.json()).toEqual({ enabled: false, reason: "SOK-9" });
  });

  it("refuses a non-admin session before it calls Core", async () => {
    sessionMock.current = MEMBER_SESSION;

    const result = await setAdminPreprodAccessAction({
      target: { type: "user", id: "user_1" },
      enabled: true,
      reason: "SOK-123",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      error: { code: CommonErrorCode.UNAUTHORIZED },
    });
  });

  it.each([
    ["", "an empty reason"],
    ["   ", "a blank reason"],
    ["x".repeat(501), "a reason over 500 characters"],
  ])("sends nothing for %#: %s", async (reason) => {
    const result = await setAdminPreprodAccessAction({
      target: { type: "user", id: "user_1" },
      enabled: true,
      reason,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      error: { code: CommonErrorCode.BAD_INPUT },
    });
  });

  it.each([
    [
      403,
      "Preprod access cannot be changed while impersonating",
      CommonErrorCode.UNAUTHORIZED,
    ],
    [404, "User not found", CommonErrorCode.NOT_FOUND],
    [422, "Reason is required", CommonErrorCode.BAD_INPUT],
  ])("passes Core's %i on with its message", async (status, message, code) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(status, { message }));

    const result = await setAdminPreprodAccessAction({
      target: { type: "user", id: "user_1" },
      enabled: true,
      reason: "SOK-123",
    });

    expect(result).toEqual({ ok: false, error: { code, message } });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
