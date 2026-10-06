import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { emailOTP } from "better-auth/plugins/email-otp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuthCaptchaPlugin } from "./auth-captcha.js";
import { CAPTCHA_PASS_IDENTIFIER_PREFIX } from "./auth-captcha-pass.js";
import {
  SIGN_UP_EMAIL_STATUS_PATH,
  signUpEmailStatus,
} from "./auth-sign-up-email-status.js";

// A real Better Auth instance with the captcha plugin in front, as in Core.
function createTestAuth({ rateLimited = false } = {}) {
  const sendEmail = vi.fn();
  const verification: { identifier: string; expiresAt: Date }[] = [];
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
        {
          id: "user-2",
          email: "grace@example.com",
          name: "Grace Hopper",
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      session: [],
      account: [
        {
          id: "account-1",
          userId: "user-2",
          providerId: "credential",
          accountId: "user-2",
          password: "hashed-password",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "account-2",
          userId: "user-1",
          providerId: "google",
          accountId: "google-1",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      verification,
    }),
    emailAndPassword: { enabled: true },
    plugins: [
      createAuthCaptchaPlugin("test-secret"),
      signUpEmailStatus(),
      emailOTP({ sendVerificationOTP: sendEmail }),
    ],
    rateLimit: rateLimited
      ? { enabled: true, storage: "memory" }
      : { enabled: false },
  });
  function ask(
    body: unknown,
    token: string | null = "token",
    clientIp = "203.0.113.7",
  ) {
    return auth.handler(
      new Request(`https://auth.example.com/auth${SIGN_UP_EMAIL_STATUS_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": clientIp,
          ...(token ? { "x-captcha-response": token } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  }
  function sendCode(email: string, captchaResponse: string, type = "sign-in") {
    return auth.handler(
      new Request(
        "https://auth.example.com/auth/email-otp/send-verification-otp",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-captcha-response": captchaResponse,
          },
          body: JSON.stringify({ email, type }),
        },
      ),
    );
  }
  async function askForPass(email: string) {
    const body: { captchaPass: string } = await (await ask({ email })).json();
    return body.captchaPass;
  }
  return { ask, sendCode, askForPass, sendEmail, verification };
}

const CAPTCHA_PASS = expect.stringMatching(/^pass_[\w-]{32}$/);

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
    expect(await response.json()).toEqual({
      exists: true,
      hasPassword: false,
      captchaPass: CAPTCHA_PASS,
    });
  });

  // Sign-in opens on the password for it rather than emailing a code, which
  // would remove the password of an account whose address is unproven.
  it("says whether the account has a password", async () => {
    passCaptcha();
    const { ask } = createTestAuth();

    const response = await ask({ email: "grace@example.com" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      exists: true,
      hasPassword: true,
      captchaPass: CAPTCHA_PASS,
    });
  });

  it("says a free email does not exist", async () => {
    passCaptcha();
    const { ask } = createTestAuth();

    const response = await ask({ email: "linus@example.com" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      exists: false,
      hasPassword: false,
      captchaPass: CAPTCHA_PASS,
    });
  });

  it("accepts the OAuth request the auth client adds to every call", async () => {
    passCaptcha();
    const { ask } = createTestAuth();

    const response = await ask({
      email: "ada@example.com",
      oauth_query: "client_id=cmo&exp=1772367377&sig=signed-value",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      exists: true,
      hasPassword: false,
      captchaPass: CAPTCHA_PASS,
    });
  });

  it("answers nothing about the account beyond that", async () => {
    passCaptcha();
    const { ask } = createTestAuth();

    const body = await (await ask({ email: "ada@example.com" })).json();

    expect(Object.keys(body)).toEqual(["exists", "hasPassword", "captchaPass"]);
  });

  // A visitor Cloudflare wants to see solves one check for Continue, not one
  // for the status and another for the code.
  it("lets one sign-in code to the same address skip a second captcha", async () => {
    const fetchMock = passCaptcha();
    const { askForPass, sendCode, sendEmail } = createTestAuth();
    const pass = await askForPass("Ada@Example.com");

    const sent = await sendCode("ada@example.com", pass);

    expect(sent.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    // Only the status question went to Cloudflare.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const replayed = await sendCode("ada@example.com", pass);
    expect(replayed.status).toBe(403);
    expect(await replayed.json()).toMatchObject({
      code: "VERIFICATION_FAILED",
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  // The expired-verifications-purge sync finds expired passes by this prefix.
  it("stores a pass under the prefix the purge deletes", async () => {
    passCaptcha();
    const { askForPass, verification } = createTestAuth();

    await askForPass("ada@example.com");

    expect(verification).toHaveLength(1);
    expect(verification[0]?.identifier).toMatch(
      new RegExp(`^${CAPTCHA_PASS_IDENTIFIER_PREFIX}`),
    );
    expect(verification[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses a pass for another address and uses it up", async () => {
    passCaptcha();
    const { askForPass, sendCode, sendEmail } = createTestAuth();
    const pass = await askForPass("ada@example.com");

    expect((await sendCode("grace@example.com", pass)).status).toBe(403);
    expect((await sendCode("ada@example.com", pass)).status).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses a pass for anything but a sign-in code", async () => {
    passCaptcha();
    const { askForPass, sendCode, sendEmail } = createTestAuth();
    const pass = await askForPass("ada@example.com");

    const sent = await sendCode("ada@example.com", pass, "forget-password");

    expect(sent.status).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses a pass after ten minutes", async () => {
    passCaptcha();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { askForPass, sendCode, sendEmail } = createTestAuth();
      const pass = await askForPass("ada@example.com");

      vi.advanceTimersByTime(10 * 60 * 1_000 + 1);

      expect((await sendCode("ada@example.com", pass)).status).toBe(403);
      expect(sendEmail).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a made-up pass", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { sendCode, sendEmail } = createTestAuth();

    const sent = await sendCode("ada@example.com", `pass_${"x".repeat(32)}`);

    expect(sent.status).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
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

  // Through the handler, not the plugin's rule object: the rule only works if
  // Better Auth hands its matcher the path in the form the matcher expects.
  it("answers ten questions a minute from one address and refuses the eleventh", async () => {
    passCaptcha();
    const { ask } = createTestAuth({ rateLimited: true });

    for (let question = 1; question <= 10; question += 1) {
      const response = await ask({ email: `person-${question}@example.com` });
      expect(response.status, `question ${question}`).toBe(200);
    }

    const refused = await ask({ email: "ada@example.com" });
    expect(refused.status).toBe(429);
    expect(await refused.json()).not.toHaveProperty("exists");

    // The limit is per client address.
    const elsewhere = await ask(
      { email: "ada@example.com" },
      "token",
      "198.51.100.23",
    );
    expect(elsewhere.status).toBe(200);
  });
});
