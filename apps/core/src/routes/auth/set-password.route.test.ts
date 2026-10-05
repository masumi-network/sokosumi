import { APIError } from "better-auth/api";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setPasswordMock = vi.fn();

const TRUSTED_ORIGIN = "https://app.sokosumi.test";

vi.mock("@/lib/auth.js", () => ({
  auth: {
    api: {
      setPassword: (...args: unknown[]) => setPasswordMock(...args),
    },
    $context: Promise.resolve({
      isTrustedOrigin: (url: string) => url === TRUSTED_ORIGIN,
    }),
  },
}));

async function createApp() {
  const { handleSetPassword } = await import("./set-password.route.js");
  const app = new Hono();
  app.post("/set-password", handleSetPassword);
  return app;
}

function postSetPassword(
  app: Hono,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  return app.request("http://localhost/set-password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: TRUSTED_ORIGIN,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /auth/set-password bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPasswordMock.mockResolvedValue(undefined);
  });

  it("delegates to auth.api.setPassword and returns success", async () => {
    const app = await createApp();

    const response = await postSetPassword(
      app,
      { newPassword: "Password-123456" },
      { cookie: "session=test" },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    expect(setPasswordMock).toHaveBeenCalledWith({
      body: { newPassword: "Password-123456" },
      headers: expect.any(Headers),
    });
  });

  it("returns 400 for an invalid request body", async () => {
    const app = await createApp();

    const response = await postSetPassword(app, {});

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "BAD_REQUEST",
      message: "Invalid request body",
    });
    expect(setPasswordMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed JSON body", async () => {
    const app = await createApp();

    const response = await app.request("http://localhost/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: TRUSTED_ORIGIN },
      body: "not json",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "BAD_REQUEST",
      message: "Invalid request body",
    });
    expect(setPasswordMock).not.toHaveBeenCalled();
  });

  // Better Auth's router refuses these for its own endpoints; a direct
  // `auth.api` call skips the router, so the bridge must refuse them itself.
  it.each([
    ["another site's origin", { Origin: "https://docs.sokosumi.test" }],
    ["no origin", { Origin: "" }],
    ["a null origin", { Origin: "null" }],
  ])("refuses a request from %s", async (_case, headers) => {
    const app = await createApp();

    const response = await postSetPassword(
      app,
      { newPassword: "Password-123456" },
      { cookie: "session=test", ...headers },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "INVALID_ORIGIN" });
    expect(setPasswordMock).not.toHaveBeenCalled();
  });

  it("refuses a body that is not sent as JSON", async () => {
    // A form or `text/plain` post needs no CORS preflight.
    const app = await createApp();

    const response = await app.request("http://localhost/set-password", {
      method: "POST",
      headers: { "Content-Type": "text/plain", Origin: TRUSTED_ORIGIN },
      body: JSON.stringify({ newPassword: "Password-123456" }),
    });

    expect(response.status).toBe(415);
    expect(setPasswordMock).not.toHaveBeenCalled();
  });

  it("maps Better Auth API errors to JSON responses", async () => {
    setPasswordMock.mockRejectedValue(
      APIError.from("BAD_REQUEST", {
        code: "PASSWORD_ALREADY_SET",
        message: "Password already set",
      }),
    );

    const app = await createApp();

    const response = await postSetPassword(app, {
      newPassword: "Password-123456",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "PASSWORD_ALREADY_SET",
      message: "Password already set",
    });
  });
});
