import { TURNSTILE_ALWAYS_PASS_SECRET } from "@sokosumi/utils";
import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { magicLink } from "better-auth/plugins/magic-link";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuthCaptchaPlugin } from "./auth-captcha.js";

function createTestAuth(
  { secretKey }: { secretKey?: string } = { secretKey: "test-secret" },
) {
  const sendEmail = vi.fn();
  const auth = betterAuth({
    baseURL: "https://auth.example.com",
    basePath: "/auth",
    secret: "test-secret-that-is-long-enough-for-better-auth",
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
    }),
    user: { changeEmail: { enabled: true } },
    emailAndPassword: { enabled: true, sendResetPassword: sendEmail },
    emailVerification: { sendOnSignUp: true, sendVerificationEmail: sendEmail },
    plugins: [
      createAuthCaptchaPlugin(secretKey),
      magicLink({ sendMagicLink: sendEmail }),
    ],
    rateLimit: { enabled: false },
  });
  function post(path: string, token?: string) {
    return auth.handler(
      new Request(`https://auth.example.com/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { "x-captcha-response": token } : {}),
        },
        body: JSON.stringify({
          email: "person@example.com",
          name: "Person",
          password: "Password123!",
        }),
      }),
    );
  }
  return { auth, post, sendEmail };
}

afterEach(() => vi.unstubAllGlobals());

describe("auth email abuse protection", () => {
  it("still blocks missing tokens when the dummy always-pass secret is set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { post, sendEmail } = createTestAuth({
      secretKey: TURNSTILE_ALWAYS_PASS_SECRET,
    });
    expect((await post("/sign-in/email")).status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts Cloudflare's dummy secret when siteverify omits action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ success: true })),
    );
    const { post, sendEmail } = createTestAuth({
      secretKey: TURNSTILE_ALWAYS_PASS_SECRET,
    });
    expect((await post("/sign-up/email", "XXXX.DUMMY.TOKEN.XXXX")).status).toBe(
      200,
    );
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("allows signup without a challenge when no secret is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { auth, post, sendEmail } = createTestAuth({});

    expect((await auth.$context).getPlugin("captcha")).toBeNull();
    expect((await post("/sign-up/email")).status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "/sign-up/email",
    "/sign-in/email",
    "/send-verification-email",
    "/sign-in/magic-link",
    "/request-password-reset",
  ])("blocks %s without a token before sending mail", async (path) => {
    const { post, sendEmail } = createTestAuth();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await post(path);
    expect(response.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["invalid-input-response", "timeout-or-duplicate"])(
    "rejects %s tokens",
    async (code) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            Response.json({ success: false, "error-codes": [code] }),
          ),
      );
      const { post, sendEmail } = createTestAuth();
      expect((await post("/sign-up/email", "rejected-token")).status).toBe(403);
      expect(sendEmail).not.toHaveBeenCalled();
    },
  );

  it("requires a fresh challenge for email changes even with an existing session", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(Response.json({ success: true, action: "auth" })),
        ),
    );
    const { auth, post, sendEmail } = createTestAuth();
    const signup = await post("/sign-up/email", "signup-token");
    expect(signup.status).toBe(200);
    const cookie = signup.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const headers = {
      cookie,
      origin: "https://auth.example.com",
      "content-type": "application/json",
    };
    const request = new Request("https://auth.example.com/auth/change-email", {
      method: "POST",
      headers,
      body: JSON.stringify({ newEmail: "another@example.com" }),
    });
    expect((await auth.handler(request)).status).toBe(400);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const verifiedRequest = new Request(
      "https://auth.example.com/auth/change-email",
      {
        method: "POST",
        headers: { ...headers, "x-captcha-response": "change-token" },
        body: JSON.stringify({ newEmail: "another@example.com" }),
      },
    );
    expect((await auth.handler(verifiedRequest)).status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("rejects a real secret when siteverify omits action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ success: true })),
    );
    const { post, sendEmail } = createTestAuth();
    expect((await post("/sign-up/email", "token")).status).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects a valid token from a different action", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ success: true, action: "another-form" }),
        ),
    );
    const { post, sendEmail } = createTestAuth();
    expect((await post("/sign-up/email", "wrong-action")).status).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not send mail when Cloudflare is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 })),
    );
    const { post, sendEmail } = createTestAuth();
    expect((await post("/sign-up/email", "token")).ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("allows signup and subsequent email actions only after validation", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(Response.json({ success: true, action: "auth" })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { post, sendEmail } = createTestAuth();
    for (const path of [
      "/sign-up/email",
      "/send-verification-email",
      "/sign-in/magic-link",
      "/request-password-reset",
    ]) {
      expect((await post(path, `token-for-${path}`)).status).toBe(200);
    }
    expect(sendEmail).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
