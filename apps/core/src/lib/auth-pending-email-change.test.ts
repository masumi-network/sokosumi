import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { describe, expect, it } from "vitest";

import {
  CANCEL_EMAIL_CHANGE_PATH,
  PENDING_EMAIL_CHANGE_PATH,
  pendingEmailChange,
} from "./auth-pending-email-change.js";

const BASE = "https://auth.example.com/auth";
const CALLBACK = "https://app.example.com/account";

// A real Better Auth instance with Core's change-email setup.
async function signedInAuth() {
  const links: { to: string; url: string }[] = [];
  const auth = betterAuth({
    baseURL: "https://auth.example.com",
    basePath: "/auth",
    secret: "test-secret-that-is-long-enough-for-better-auth",
    trustedOrigins: ["https://app.example.com"],
    rateLimit: { enabled: false },
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
    }),
    emailAndPassword: { enabled: true },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        links.push({ to: user.email, url });
      },
    },
    user: { changeEmail: { enabled: true } },
    plugins: [pendingEmailChange({ expiresIn: 3600 })],
  });

  const { headers } = await auth.api.signUpEmail({
    body: { email: "ada@example.com", password: "password-1234", name: "Ada" },
    returnHeaders: true,
  });
  const cookie = (headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  // Better Auth sends a change link only from a verified address.
  const context = await auth.$context;
  const found =
    await context.internalAdapter.findUserByEmail("ada@example.com");
  await context.internalAdapter.updateUser(found!.user.id, {
    emailVerified: true,
  });

  async function call(path: string, init: RequestInit = {}) {
    return auth.handler(
      new Request(`${BASE}${path}`, {
        ...init,
        headers: {
          cookie,
          origin: "https://app.example.com",
          "content-type": "application/json",
        },
      }),
    );
  }

  async function changeEmail(newEmail: string) {
    const response = await call("/change-email", {
      method: "POST",
      body: JSON.stringify({ newEmail, callbackURL: CALLBACK }),
    });
    expect(response.status).toBe(200);
    return links.at(-1)!.url;
  }

  async function pending() {
    return (await call(PENDING_EMAIL_CHANGE_PATH)).json();
  }

  async function openLink(url: string) {
    const response = await auth.handler(new Request(url));
    const email = (await context.internalAdapter.findUserById(found!.user.id))
      ?.email;
    return { location: response.headers.get("location"), email };
  }

  return { call, changeEmail, pending, openLink };
}

describe("pendingEmailChange", () => {
  it("shows the change as waiting and applies it when the link opens", async () => {
    const { changeEmail, pending, openLink } = await signedInAuth();

    const link = await changeEmail("Ada@New.example");
    expect(await pending()).toMatchObject({ newEmail: "ada@new.example" });

    const { location, email } = await openLink(link);
    expect(location).toBe(CALLBACK);
    expect(email).toBe("ada@new.example");
    expect(await pending()).toBeNull();
  });

  it("refuses a link after the change is cancelled", async () => {
    const { call, changeEmail, pending, openLink } = await signedInAuth();

    const link = await changeEmail("ada@new.example");
    await call(CANCEL_EMAIL_CHANGE_PATH, { method: "POST" });
    expect(await pending()).toBeNull();

    const { location, email } = await openLink(link);
    expect(location).toBe(`${CALLBACK}?error=INVALID_TOKEN`);
    expect(email).toBe("ada@example.com");
  });

  it("retires the older link when another address is asked for", async () => {
    const { changeEmail, openLink } = await signedInAuth();

    const first = await changeEmail("one@new.example");
    const second = await changeEmail("two@new.example");

    expect((await openLink(first)).email).toBe("ada@example.com");
    expect((await openLink(second)).email).toBe("two@new.example");
  });
});
