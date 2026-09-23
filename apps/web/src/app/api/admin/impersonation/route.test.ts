import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startAdminImpersonationMock = vi.fn();
const stopAdminImpersonationMock = vi.fn();
const readRouteSessionMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClientNoRedirect: {
    startAdminImpersonation: (...args: unknown[]) =>
      startAdminImpersonationMock(...args),
    stopAdminImpersonation: (...args: unknown[]) =>
      stopAdminImpersonationMock(...args),
  },
}));

vi.mock("@/lib/auth/route-session", () => ({
  readRouteSession: (...args: unknown[]) => readRouteSessionMock(...args),
}));

import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { CoreApiRequestError } from "@/lib/clients/core.request";

import { DELETE, POST } from "./route";

const TARGET_USER = {
  id: "user_target",
  name: "Target User",
  email: "target@example.com",
};

const ADMIN_USER = {
  id: "user_admin",
  name: "Admin User",
  email: "admin@example.com",
};

const adminSession = {
  user: { id: "user_admin", role: "admin" },
  session: { id: "sess_admin", userId: "user_admin" },
} as never;

const plainSession = {
  user: { id: "user_plain", role: "user" },
  session: { id: "sess_plain", userId: "user_plain" },
} as never;

const impersonatedSession = {
  user: { id: TARGET_USER.id, role: "user" },
  session: {
    id: "sess_impersonated",
    userId: TARGET_USER.id,
    impersonatedBy: "user_admin",
  },
} as never;

// Signed session cookie exactly as Core serializes it: the base64 signature
// is URL-encoded on the wire (trailing `=` -> `%3D`). Forwarding must not
// parse or re-encode it (SOK-1080).
const SIGNED_SESSION_COOKIE =
  "__Secure-test.session_token=hwarHcP3Xz.obFIJq1K9AAkFRkeiK3Q5yCJcR2sgJxpMwXPblvnIjE%3D; Path=/; Domain=sokosumi.com; Secure; HttpOnly; SameSite=Lax";
const SESSION_DATA_COOKIE = "__Secure-test.session_data=eyJ2ZXhh.test; Path=/";

function responseWithCookies(...cookies: string[]): Response {
  const response = new Response(null, { status: 201 });
  for (const cookie of cookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

// `Sec-Fetch-*` is a forbidden request header the fetch runtime refuses to
// set programmatically, so the guard is exercised by stubbing the getter.
function withSecFetchSite(
  request: NextRequest,
  secFetchSite: string | null,
): NextRequest {
  const get = request.headers.get.bind(request.headers);
  vi.spyOn(request.headers, "get").mockImplementation((name) =>
    name.toLowerCase() === "sec-fetch-site" ? secFetchSite : get(name),
  );
  return request;
}

function postRequest(
  body: unknown,
  secFetchSite: string | null = "same-origin",
): NextRequest {
  return withSecFetchSite(
    new NextRequest("https://web.test/api/admin/impersonation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    secFetchSite,
  );
}

function deleteRequest(
  secFetchSite: string | null = "same-origin",
): NextRequest {
  return withSecFetchSite(
    new NextRequest("https://web.test/api/admin/impersonation", {
      method: "DELETE",
    }),
    secFetchSite,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  readRouteSessionMock.mockResolvedValue({
    status: "authenticated",
    session: adminSession,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/admin/impersonation", () => {
  it("starts impersonation and forwards Core cookies byte-identical", async () => {
    startAdminImpersonationMock.mockResolvedValue({
      data: { data: TARGET_USER },
      response: responseWithCookies(SIGNED_SESSION_COOKIE, SESSION_DATA_COOKIE),
    });

    const response = await POST(
      postRequest({ userId: TARGET_USER.id, reason: "  SOK-1080: x  " }),
    );

    expect(startAdminImpersonationMock).toHaveBeenCalledWith({
      userId: TARGET_USER.id,
      reason: "SOK-1080: x",
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, value: TARGET_USER });
    expect(response.headers.getSetCookie()).toEqual([
      SIGNED_SESSION_COOKIE,
      SESSION_DATA_COOKIE,
    ]);
  });

  it.each(["cross-site", "same-site", null] as const)(
    "rejects %s requests without reaching Core",
    async (secFetchSite) => {
      const response = await POST(
        postRequest(
          { userId: TARGET_USER.id, reason: "SOK-1: x" },
          secFetchSite,
        ),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        ok: false,
        error: {
          code: CommonErrorCode.UNAUTHORIZED,
          message: "Cross-site requests are not allowed",
        },
      });
      expect(startAdminImpersonationMock).not.toHaveBeenCalled();
    },
  );

  it("answers 401 for a signed-out browser", async () => {
    readRouteSessionMock.mockResolvedValue({ status: "signedOut" });

    const response = await POST(
      postRequest({ userId: TARGET_USER.id, reason: "SOK-1: x" }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: CommonErrorCode.UNAUTHENTICATED },
    });
    expect(startAdminImpersonationMock).not.toHaveBeenCalled();
  });

  it("answers 503 with a retry hint when Core cannot be asked", async () => {
    readRouteSessionMock.mockResolvedValue({
      status: "unavailable",
      reason: "timeout",
    });

    const response = await POST(
      postRequest({ userId: TARGET_USER.id, reason: "SOK-1: x" }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        message: "The service is currently unavailable.",
      },
    });
  });

  it("rejects a second impersonation while one is active", async () => {
    readRouteSessionMock.mockResolvedValue({
      status: "authenticated",
      session: impersonatedSession,
    });

    const response = await POST(
      postRequest({ userId: "user_other", reason: "SOK-1: x" }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: CommonErrorCode.BAD_INPUT,
        message:
          "Already impersonating a user. Stop the current impersonation first.",
      },
    });
    expect(startAdminImpersonationMock).not.toHaveBeenCalled();
  });

  it("rejects non-admin sessions without calling Core", async () => {
    readRouteSessionMock.mockResolvedValue({
      status: "authenticated",
      session: plainSession,
    });

    const response = await POST(
      postRequest({ userId: TARGET_USER.id, reason: "SOK-1: x" }),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(CommonErrorCode.UNAUTHORIZED);
    expect(startAdminImpersonationMock).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    const response = await POST(postRequest("{not-json"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: CommonErrorCode.BAD_INPUT, message: "Invalid JSON" },
    });
    expect(startAdminImpersonationMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ reason: "SOK-1: x" }, "User id is required"],
    [{ userId: TARGET_USER.id }, "Reason is required"],
    [{ userId: "  ", reason: "SOK-1: x" }, "User id is required"],
    [{ userId: TARGET_USER.id, reason: "   " }, "Reason is required"],
  ])("rejects invalid input: %o", async (body, message) => {
    const response = await POST(postRequest(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: CommonErrorCode.BAD_INPUT, message },
    });
    expect(startAdminImpersonationMock).not.toHaveBeenCalled();
  });

  it("proxies Core's conflict status with Core's message", async () => {
    startAdminImpersonationMock.mockRejectedValue(
      new CoreApiRequestError("Already impersonating a user", { status: 409 }),
    );

    const response = await POST(
      postRequest({ userId: TARGET_USER.id, reason: "SOK-1: x" }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: CommonErrorCode.BAD_INPUT,
        message: "Already impersonating a user",
      },
    });
  });

  it("proxies Core's forbidden for admin targets", async () => {
    startAdminImpersonationMock.mockRejectedValue(
      new CoreApiRequestError("Admin users cannot be impersonated", {
        status: 403,
      }),
    );

    const response = await POST(
      postRequest({ userId: "user_other_admin", reason: "SOK-1: x" }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: CommonErrorCode.UNAUTHORIZED,
        message: "Admin users cannot be impersonated",
      },
    });
  });

  it("answers 503 when Core is unreachable", async () => {
    startAdminImpersonationMock.mockRejectedValue(
      new CoreApiRequestError("Failed to fetch"),
    );

    const response = await POST(
      postRequest({ userId: TARGET_USER.id, reason: "SOK-1: x" }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(CommonErrorCode.INTERNAL_SERVER_ERROR);
  });

  it("returns JSON 401 when Core rejects the session", async () => {
    startAdminImpersonationMock.mockRejectedValue(
      new CoreApiRequestError("Invalid session", { status: 401 }),
    );

    const response = await POST(
      postRequest({ userId: TARGET_USER.id, reason: "SOK-1: x" }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: CommonErrorCode.UNAUTHORIZED,
        message: "Invalid session",
      },
    });
  });

  it("answers 502 when Core returns no session cookies", async () => {
    startAdminImpersonationMock.mockResolvedValue({
      data: { data: TARGET_USER },
      response: new Response(null, { status: 201 }),
    });

    const response = await POST(
      postRequest({ userId: TARGET_USER.id, reason: "SOK-1: x" }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        message: "Impersonation did not return a session",
      },
    });
  });
});

describe("DELETE /api/admin/impersonation", () => {
  it("stops impersonation for an impersonated session", async () => {
    readRouteSessionMock.mockResolvedValue({
      status: "authenticated",
      session: impersonatedSession,
    });
    stopAdminImpersonationMock.mockResolvedValue({
      data: { data: ADMIN_USER },
      response: responseWithCookies(SIGNED_SESSION_COOKIE),
    });

    const response = await DELETE(deleteRequest());

    expect(stopAdminImpersonationMock).toHaveBeenCalledWith();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, value: ADMIN_USER });
    expect(response.headers.getSetCookie()).toEqual([SIGNED_SESSION_COOKIE]);
  });

  it.each(["cross-site", "same-site", null] as const)(
    "rejects %s requests without reaching Core",
    async (secFetchSite) => {
      const response = await DELETE(deleteRequest(secFetchSite));

      expect(response.status).toBe(403);
      expect(stopAdminImpersonationMock).not.toHaveBeenCalled();
    },
  );

  it("answers 401 for a signed-out browser", async () => {
    readRouteSessionMock.mockResolvedValue({ status: "signedOut" });

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(401);
    expect(stopAdminImpersonationMock).not.toHaveBeenCalled();
  });

  it("proxies Core errors with Core's message", async () => {
    stopAdminImpersonationMock.mockRejectedValue(
      new CoreApiRequestError("Not currently impersonating a user", {
        status: 400,
      }),
    );

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: CommonErrorCode.BAD_INPUT,
        message: "Not currently impersonating a user",
      },
    });
  });
});
