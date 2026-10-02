import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { lastLoginMethod } from "better-auth/plugins";
import { emailOTP } from "better-auth/plugins/email-otp";
import { describe, expect, it } from "vitest";

import {
  emailCodeSignIn,
  resolveEmailCodeSignUpLoginMethod,
} from "../auth-email-code-sign-in.js";

const COOKIE_NAME = "sokosumi.last_used_login_method";

// The sign-in page opens on the method this cookie names, so the way someone
// signed up must leave it too, not only a later sign-in.
function createTestAuth() {
  let emailCode = "";
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
    emailAndPassword: { enabled: true, autoSignIn: true },
    plugins: [
      emailOTP({
        sendVerificationOTP: async ({ otp }) => {
          emailCode = otp;
        },
      }),
      emailCodeSignIn(),
      lastLoginMethod({
        cookieName: COOKIE_NAME,
        customResolveMethod: resolveEmailCodeSignUpLoginMethod,
      }),
    ],
    rateLimit: { enabled: false },
  });

  function post(path: string, body: Record<string, unknown>) {
    return auth.handler(
      new Request(`https://auth.example.com/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  async function signUpWithEmailCode(
    email: string,
    fields: Record<string, unknown> = {},
  ) {
    await post("/email-otp/send-verification-otp", { email, type: "sign-in" });
    return post("/sign-in/email-otp", { email, otp: emailCode, ...fields });
  }

  return { signUpWithEmailCode };
}

function lastLoginMethodCookie(response: Response) {
  return response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`))
    ?.split(";")[0]
    ?.slice(COOKIE_NAME.length + 1);
}

describe("last login method on sign-up", () => {
  // Password sign-up sends the password with the email code.
  it("remembers a password sign-up as email", async () => {
    const { signUpWithEmailCode } = createTestAuth();

    const response = await signUpWithEmailCode("ada@example.com", {
      password: "Password123!",
    });

    expect(response.status).toBe(200);
    expect(lastLoginMethodCookie(response)).toBe("email");
  });

  it("remembers an email-code sign-up as email-otp", async () => {
    const { signUpWithEmailCode } = createTestAuth();

    const response = await signUpWithEmailCode("ada@example.com");

    expect(response.status).toBe(200);
    expect(lastLoginMethodCookie(response)).toBe("email-otp");
  });
});
