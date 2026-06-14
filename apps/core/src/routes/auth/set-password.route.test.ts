import { APIError } from "better-auth/api";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setPasswordMock = vi.fn();

vi.mock("@/lib/auth.js", () => ({
  auth: {
    api: {
      setPassword: (...args: unknown[]) => setPasswordMock(...args),
    },
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
