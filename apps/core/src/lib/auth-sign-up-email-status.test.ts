import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuthCaptchaPlugin } from "./auth-captcha.js";
import {
  SIGN_UP_EMAIL_STATUS_PATH,
  signUpEmailStatus,
} from "./auth-sign-up-email-status.js";

// A real Better Auth instance with the captcha plugin in front, as in Core.
function createTestAuth() {
  const auth = betterAuth({
    baseURL: "https://auth.example.com",
    basePath: "/auth",
    secret: "test-secret-that-is-long-enough-for-better-auth",
    database: memoryAdapter({
      user: [
        {
          id: "user-1",
          email: "ada@example.com",
          name: "Ada Lovelace",
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      session: [],
      account: [],
      verification: [],
    }),
    emailAndPassword: { enabled: true },
    plugins: [createAuthCaptchaPlugin("test-secret"), signUpEmailStatus()],
    rateLimit: { enabled: false },
  });
  function ask(body: unknown, token: string | null = "token") {
    return auth.handler(
      new Request(`https://auth.example.com/auth${SIGN_UP_EMAIL_STATUS_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { "x-captcha-response": token } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  }
  return { ask };
}

function passCaptcha() {
  const fetchMock = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(Response.json({ success: true, action: "auth" })),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("sign-up email status", () => {
  it("says an email that has an account exists, whatever its case", async () => {
    passCaptcha();
    const { ask } = createTestAuth();

    const response = await ask({ email: "Ada@Example.com" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ exists: true });
  });

  it("says a free email does not exist", async () => {
    passCaptcha();
    const { ask } = createTestAuth();

    const response = await ask({ email: "grace@example.com" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ exists: false });
  });

  it("answers nothing about the account beyond that", async () => {
    passCaptcha();
    const { ask } = createTestAuth();

    const body = await (await ask({ email: "ada@example.com" })).json();

    expect(Object.keys(body)).toEqual(["exists"]);
  });

  it.each([{}, { email: "not-an-email" }, { email: 1 }])(
    "rejects a request without a valid email: %o",
    async (body) => {
      passCaptcha();
      const { ask } = createTestAuth();

      expect((await ask(body)).status).toBe(400);
    },
  );

  it("answers nobody without a captcha token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { ask } = createTestAuth();

    const response = await ask({ email: "ada@example.com" }, null);

    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty("exists");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers nobody whose captcha token Cloudflare rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          success: false,
          "error-codes": ["invalid-input-response"],
        }),
      ),
    );
    const { ask } = createTestAuth();

    const response = await ask({ email: "ada@example.com" });

    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("exists");
  });

  it("allows ten questions a minute from one address", () => {
    const [rule] = signUpEmailStatus().rateLimit;

    expect(rule.pathMatcher(SIGN_UP_EMAIL_STATUS_PATH)).toBe(true);
    expect(rule.pathMatcher("/sign-up/email")).toBe(false);
    expect(rule).toMatchObject({ window: 60, max: 10 });
  });
});
