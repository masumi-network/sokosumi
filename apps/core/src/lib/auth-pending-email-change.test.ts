import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACKNOWLEDGE_EMAIL_CHANGE_PATH,
  CANCEL_EMAIL_CHANGE_PATH,
  CLAIM_TTL_MS,
  EMAIL_CHANGE_STATUS_PATH,
  pendingEmailChange,
  recordEmailChangeLink,
} from "./auth-pending-email-change.js";

const BASE = "https://auth.example.com/auth";
const CALLBACK = "https://app.example.com/account";
const REFUSED = `${CALLBACK}?error=INVALID_TOKEN`;
const EXPIRES_IN = 3600;

/** A promise the test opens by hand, to stop Better Auth mid-flow. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  let reached = () => {};
  const isReached = new Promise<void>((resolve) => {
    reached = resolve;
  });
  return { open, opened, reached, isReached };
}

// A real Better Auth instance with Core's change-email setup.
async function signedInAuth() {
  const links: string[] = [];
  const hooks: {
    beforeUpdate?: () => Promise<void>;
    afterUpdate?: () => Promise<void>;
  } = {};
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
    databaseHooks: {
      user: {
        update: {
          before: async () => {
            await hooks.beforeUpdate?.();
          },
          after: async () => {
            await hooks.afterUpdate?.();
          },
        },
      },
    },
    emailAndPassword: { enabled: true },
    emailVerification: {
      sendVerificationEmail: async ({ url, token }) => {
        await recordEmailChangeLink(() => auth.$context, token, EXPIRES_IN);
        links.push(url);
      },
    },
    user: { changeEmail: { enabled: true } },
    plugins: [pendingEmailChange({ expiresIn: EXPIRES_IN })],
  });

  const { headers } = await auth.api.signUpEmail({
    body: { email: "ada@example.com", password: "password-1234", name: "Ada" },
    returnHeaders: true,
  });
  const cookie = (headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  // Better Auth sends a change link only from a verified address.
  const context = await auth.$context;
  const userId = (await context.internalAdapter.findUserByEmail(
    "ada@example.com",
  ))!.user.id;
  await context.internalAdapter.updateUser(userId, { emailVerified: true });

  function call(path: string, init: RequestInit = {}) {
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

  async function changeEmail(newEmail: string): Promise<string> {
    const sent = links.length;
    const response = await call("/change-email", {
      method: "POST",
      body: JSON.stringify({ newEmail, callbackURL: CALLBACK }),
    });
    expect(response.status).toBe(200);
    // Each request is a second apart, so each link is a different token.
    vi.advanceTimersByTime(1100);
    return links.length > sent ? links.at(-1)! : "";
  }

  async function status(): Promise<{
    pending: { newEmail: string } | null;
    completed: { newEmail: string } | null;
  }> {
    return (await call(EMAIL_CHANGE_STATUS_PATH)).json();
  }

  async function openLink(url: string) {
    const response = await auth.handler(new Request(url));
    return response.headers.get("location");
  }

  async function email() {
    return (await context.internalAdapter.findUserById(userId))?.email;
  }

  const pendingRows = async () =>
    (
      await context.adapter.findMany<{ identifier: string }>({
        model: "verification",
      })
    ).filter((row) => row.identifier.startsWith("pending-email-change:"))
      .length;

  return { call, changeEmail, status, openLink, email, hooks, pendingRows };
}

describe("pendingEmailChange", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the change as waiting, applies it, then reports it done once", async () => {
    const { call, changeEmail, status, openLink, email } = await signedInAuth();

    const link = await changeEmail("Ada@New.example");
    expect(await status()).toEqual({
      pending: { newEmail: "ada@new.example" },
      completed: null,
    });

    expect(await openLink(link)).toBe(CALLBACK);
    expect(await email()).toBe("ada@new.example");
    expect(await status()).toEqual({
      pending: null,
      completed: { newEmail: "ada@new.example" },
    });

    await call(ACKNOWLEDGE_EMAIL_CHANGE_PATH, { method: "POST" });
    expect((await status()).completed).toBeNull();
  });

  it("keeps a cancelled link dead after the same address is asked for again", async () => {
    const { call, changeEmail, status, openLink, email } = await signedInAuth();

    const cancelled = await changeEmail("ada@new.example");
    await call(CANCEL_EMAIL_CHANGE_PATH, { method: "POST" });
    expect((await status()).pending).toBeNull();
    const fresh = await changeEmail("ada@new.example");
    expect(fresh).not.toBe(cancelled);

    expect(await openLink(cancelled)).toBe(REFUSED);
    expect(await email()).toBe("ada@example.com");
    expect(await openLink(fresh)).toBe(CALLBACK);
    expect(await email()).toBe("ada@new.example");
  });

  it("retires a replaced link even when the address comes back (B, C, B)", async () => {
    const { changeEmail, openLink, email } = await signedInAuth();

    const firstB = await changeEmail("b@new.example");
    const c = await changeEmail("c@new.example");
    const secondB = await changeEmail("b@new.example");

    expect(await openLink(firstB)).toBe(REFUSED);
    expect(await openLink(c)).toBe(REFUSED);
    expect(await email()).toBe("ada@example.com");
    expect(await openLink(secondB)).toBe(CALLBACK);
    expect(await email()).toBe("b@new.example");
  });

  it("does not let a resend revive the link it replaced", async () => {
    const { changeEmail, openLink, email } = await signedInAuth();

    const first = await changeEmail("ada@new.example");
    await changeEmail("ada@new.example");

    expect(await openLink(first)).toBe(REFUSED);
    expect(await email()).toBe("ada@example.com");
  });

  it("refuses a cancel while a link is changing the email", async () => {
    const { call, changeEmail, status, openLink, email, hooks } =
      await signedInAuth();
    const link = await changeEmail("ada@new.example");

    // Stop Better Auth after the link claimed its request, before the update.
    const paused = gate();
    hooks.beforeUpdate = async () => {
      paused.reached();
      await paused.opened;
    };
    const opening = openLink(link);
    await paused.isReached;

    const cancel = await call(CANCEL_EMAIL_CHANGE_PATH, { method: "POST" });
    expect(cancel.status).toBe(409);

    paused.open();
    expect(await opening).toBe(CALLBACK);
    expect(await email()).toBe("ada@new.example");
    expect(await status()).toEqual({
      pending: null,
      completed: { newEmail: "ada@new.example" },
    });
  });

  it("leaves a newer request in place when an older link finishes", async () => {
    const { changeEmail, status, openLink, hooks } = await signedInAuth();
    const link = await changeEmail("first@new.example");

    // Stop after the email changed, before the plugin releases the claim.
    const paused = gate();
    hooks.afterUpdate = async () => {
      paused.reached();
      await paused.opened;
    };
    const opening = openLink(link);
    await paused.isReached;
    hooks.afterUpdate = undefined;
    await changeEmail("second@new.example");

    paused.open();
    await opening;
    expect((await status()).pending).toEqual({
      newEmail: "second@new.example",
    });
  });

  it("keeps one request when two are made at once", async () => {
    const { call, pendingRows, status } = await signedInAuth();

    await Promise.all(
      ["one@new.example", "two@new.example"].map((newEmail) =>
        call("/change-email", {
          method: "POST",
          body: JSON.stringify({ newEmail, callbackURL: CALLBACK }),
        }),
      ),
    );

    expect(await pendingRows()).toBe(1);
    expect((await status()).pending).not.toBeNull();
  });

  it("lets a link be retried once a failed change lets go of it", async () => {
    const { changeEmail, openLink, email, hooks } = await signedInAuth();
    const link = await changeEmail("ada@new.example");

    hooks.beforeUpdate = async () => {
      throw new Error("database unavailable");
    };
    expect(await openLink(link)).not.toBe(CALLBACK);
    expect(await email()).toBe("ada@example.com");

    // A thrown update skips the after hook, so the claim lapses on its own.
    hooks.beforeUpdate = undefined;
    vi.advanceTimersByTime(CLAIM_TTL_MS + 1);
    expect(await openLink(link)).toBe(CALLBACK);
    expect(await email()).toBe("ada@new.example");
  });

  it("claims nothing for a forged link and drops an expired request", async () => {
    const { changeEmail, status, openLink, email } = await signedInAuth();
    const link = await changeEmail("ada@new.example");

    const url = new URL(link);
    const [header, payload] = url.searchParams.get("token")!.split(".");
    url.searchParams.set("token", `${header}.${payload}.forged`);
    expect(await openLink(url.toString())).toBe(REFUSED);
    expect((await status()).pending).toEqual({ newEmail: "ada@new.example" });

    vi.advanceTimersByTime((EXPIRES_IN + 1) * 1000);
    expect((await status()).pending).toBeNull();
    expect(await openLink(link)).not.toBe(CALLBACK);
    expect(await email()).toBe("ada@example.com");
  });

  it("shows a request to an address with an account as waiting, with no link", async () => {
    const { call, changeEmail, status } = await signedInAuth();
    await call("/sign-up/email", {
      method: "POST",
      body: JSON.stringify({
        email: "taken@new.example",
        password: "password-1234",
        name: "Taken",
      }),
    });

    expect(await changeEmail("taken@new.example")).toBe("");
    expect((await status()).pending).toEqual({
      newEmail: "taken@new.example",
    });
  });
});
