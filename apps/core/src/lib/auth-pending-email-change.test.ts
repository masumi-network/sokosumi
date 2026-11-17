import type { BetterAuthOptions } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { signJWT } from "better-auth/crypto";
import { betterAuth } from "better-auth/minimal";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACKNOWLEDGE_EMAIL_CHANGE_PATH,
  CANCEL_EMAIL_CHANGE_PATH,
  EMAIL_CHANGE_STATUS_PATH,
  pendingEmailChange,
  REQUEST_EMAIL_CHANGE_PATH,
} from "./auth-pending-email-change.js";

const BASE = "https://auth.example.com/auth";
const ACCOUNT = "https://app.example.com/account";
const DONE = `${ACCOUNT}?emailChange=1`;
const REFUSED = `${ACCOUNT}?emailChange=1&error=INVALID_TOKEN`;
const SECRET = "test-secret-that-is-long-enough-for-better-auth";
const EXPIRES_IN = 3600;

/** A promise the test opens by hand, to stop Better Auth mid-flow. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  let reach = () => {};
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  return { open, opened, reach, reached };
}

// A real Better Auth instance with Core's email change setup.
async function signedInAuth() {
  const links: string[] = [];
  const hooks: { beforeUpdate?: () => Promise<void> } = {};
  const auth = betterAuth({
    baseURL: "https://auth.example.com",
    basePath: "/auth",
    secret: SECRET,
    trustedOrigins: ["https://app.example.com"],
    rateLimit: { enabled: false },
    // As Core: with UUID ids the adapter replaces any other id it is given.
    advanced: { database: { generateId: "uuid" } },
    // Each write goes straight to the store, as each statement does to the
    // row it locks in Postgres; the memory adapter's own transaction merges
    // snapshots instead and would hide those locks.
    // A transaction runs its callback on the adapter itself, as Better Auth's
    // fallback would.
    database: (options: BetterAuthOptions) => {
      const adapter = memoryAdapter({
        user: [],
        session: [],
        account: [],
        verification: [],
      })(options);
      return {
        ...adapter,
        transaction: (run) => run(adapter),
      } satisfies typeof adapter;
    },
    databaseHooks: {
      user: {
        update: {
          before: async () => {
            await hooks.beforeUpdate?.();
          },
        },
      },
    },
    emailAndPassword: { enabled: true },
    emailVerification: {
      sendVerificationEmail: async ({ url }) => {
        links.push(url);
      },
    },
    user: { changeEmail: { enabled: true } },
    disabledPaths: ["/change-email"],
    plugins: [
      pendingEmailChange({ expiresIn: EXPIRES_IN, accountUrl: ACCOUNT }),
    ],
  });

  async function signUp(email: string) {
    const { headers, response } = await auth.api.signUpEmail({
      body: { email, password: "password-1234", name: "Person" },
      returnHeaders: true,
    });
    return {
      id: response.user.id,
      cookie: (headers.get("set-cookie") ?? "").split(";")[0] ?? "",
    };
  }
  const ada = await signUp("ada@example.com");
  const context = await auth.$context;

  function call(path: string, init: RequestInit = {}, cookie = ada.cookie) {
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

  /** Asks for a change and returns the link it mailed, or "" for none. */
  async function request(newEmail: string): Promise<string> {
    const sent = links.length;
    const response = await call(REQUEST_EMAIL_CHANGE_PATH, {
      method: "POST",
      body: JSON.stringify({ newEmail }),
    });
    expect(response.status).toBe(200);
    return links.length > sent ? links.at(-1)! : "";
  }

  async function cancel(): Promise<{ cancelled: boolean }> {
    return (await call(CANCEL_EMAIL_CHANGE_PATH, { method: "POST" })).json();
  }

  async function status(): Promise<{
    pending: { newEmail: string } | null;
    completed: { newEmail: string } | null;
  }> {
    return (await call(EMAIL_CHANGE_STATUS_PATH)).json();
  }

  async function open(url: string, cookie = "") {
    const response = await auth.handler(
      new Request(url, { headers: cookie ? { cookie } : {} }),
    );
    return response.headers.get("location");
  }

  async function email() {
    return (await context.internalAdapter.findUserById(ada.id))?.email;
  }

  const pendingRows = async () =>
    (
      await context.adapter.findMany<{ identifier: string }>({
        model: "verification",
      })
    ).filter((row) => row.identifier.startsWith("pending-email-change:"))
      .length;

  return {
    ada,
    call,
    cancel,
    email,
    hooks,
    open,
    pendingRows,
    request,
    signUp,
    status,
  };
}

describe("pendingEmailChange", () => {
  beforeEach(() => {
    // Every request below lands in the same second, unless a test moves on.
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-11-15T10:00:00Z"),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the change as waiting, applies it, then reports it done once", async () => {
    const { call, email, open, request, status } = await signedInAuth();

    const link = await request("Ada@New.example");
    expect(await status()).toEqual({
      pending: { newEmail: "ada@new.example" },
      completed: null,
    });

    expect(await open(link)).toBe(DONE);
    expect(await email()).toBe("ada@new.example");
    expect(await status()).toEqual({
      pending: null,
      completed: { newEmail: "ada@new.example" },
    });

    await call(ACKNOWLEDGE_EMAIL_CHANGE_PATH, { method: "POST" });
    expect((await status()).completed).toBeNull();
  });

  it("keeps a cancelled link dead when the same address is asked for in the same second", async () => {
    const { cancel, email, open, request, status } = await signedInAuth();

    const cancelled = await request("ada@new.example");
    expect(await cancel()).toEqual({ cancelled: true });
    expect((await status()).pending).toBeNull();
    const fresh = await request("ada@new.example");
    expect(fresh).not.toBe(cancelled);

    expect(await open(cancelled)).toBe(REFUSED);
    expect(await email()).toBe("ada@example.com");
    expect(await open(fresh)).toBe(DONE);
    expect(await email()).toBe("ada@new.example");
  });

  it("retires the link a same-second resend replaced", async () => {
    const { email, open, request } = await signedInAuth();

    const first = await request("ada@new.example");
    const second = await request("ada@new.example");

    expect(await open(first)).toBe(REFUSED);
    expect(await email()).toBe("ada@example.com");
    expect(await open(second)).toBe(DONE);
  });

  it("retires a replaced link even when the address comes back (B, C, B)", async () => {
    const { email, open, request } = await signedInAuth();

    const firstB = await request("b@new.example");
    const c = await request("c@new.example");
    const secondB = await request("b@new.example");

    expect(await open(firstB)).toBe(REFUSED);
    expect(await open(c)).toBe(REFUSED);
    expect(await email()).toBe("ada@example.com");
    expect(await open(secondB)).toBe(DONE);
    expect(await email()).toBe("b@new.example");
  });

  it("never reports a cancel for a change a live link is applying, however long it takes", async () => {
    const { cancel, email, hooks, open, request, status } =
      await signedInAuth();
    const link = await request("slow@new.example");

    // Stop the link after it took the request, before the email update.
    const paused = gate();
    hooks.beforeUpdate = async () => {
      paused.reach();
      await paused.opened;
    };
    const opening = open(link);
    await paused.reached;

    // Long past the link's own expiry: no lease runs out.
    vi.advanceTimersByTime((EXPIRES_IN + 600) * 1000);
    expect(await cancel()).toEqual({ cancelled: false });

    paused.open();
    expect(await opening).toBe(DONE);
    expect(await email()).toBe("slow@new.example");
    expect((await status()).completed).toEqual({
      newEmail: "slow@new.example",
    });
  });

  it("refuses a link opened after a cancel", async () => {
    const { cancel, email, open, request } = await signedInAuth();
    const link = await request("ada@new.example");

    expect(await cancel()).toEqual({ cancelled: true });
    expect(await open(link)).toBe(REFUSED);
    expect(await email()).toBe("ada@example.com");
  });

  it.each([
    ["an unsigned", "unsigned"],
    ["a wrongly signed", "other-secret"],
  ])(
    "records no completion for %s link naming the current address",
    async (_case, how) => {
      const { ada, email, open, status } = await signedInAuth();
      const claims = {
        purpose: "sokosumi-email-change",
        userId: ada.id,
        email: "ada@example.com",
        updateTo: "ada@example.com",
        generation: "x",
      };
      const token =
        how === "unsigned"
          ? `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.forged`
          : await signJWT(claims, "another-secret-that-is-long-enough", 600);

      expect(await open(`${BASE}/email-change/confirm?token=${token}`)).toBe(
        REFUSED,
      );
      expect(await email()).toBe("ada@example.com");
      expect(await status()).toEqual({ pending: null, completed: null });
    },
  );

  it("leaves the request intact when a copy of its link is tampered with", async () => {
    const { email, open, request, status } = await signedInAuth();
    const link = new URL(await request("ada@new.example"));
    const [header, payload, signature] = link.searchParams
      .get("token")!
      .split(".");
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
    const tampered = Buffer.from(
      JSON.stringify({ ...claims, email: "someone@example.com" }),
    ).toString("base64url");
    link.searchParams.set("token", `${header}.${tampered}.${signature}`);

    expect(await open(link.toString())).toBe(REFUSED);
    expect(await email()).toBe("ada@example.com");
    expect((await status()).pending).toEqual({ newEmail: "ada@new.example" });
  });

  it("refuses Better Auth's own change links, even validly signed", async () => {
    const { ada, email, open, status } = await signedInAuth();
    const token = await signJWT(
      {
        email: "ada@example.com",
        updateTo: "other@new.example",
        requestType: "change-email-verification",
        userId: ada.id,
      },
      SECRET,
      600,
    );

    const location = await open(
      `${BASE}/verify-email?token=${token}&callbackURL=${encodeURIComponent(ACCOUNT)}`,
    );
    expect(location).toContain("error=INVALID_TOKEN");
    expect(await email()).toBe("ada@example.com");
    expect(await status()).toEqual({ pending: null, completed: null });
  });

  it("refuses an expired link", async () => {
    const { email, open, request } = await signedInAuth();
    const link = await request("ada@new.example");

    vi.advanceTimersByTime((EXPIRES_IN + 1) * 1000);
    expect(await open(link)).toBe(REFUSED);
    expect(await email()).toBe("ada@example.com");
  });

  it("refuses a link opened while someone else is signed in", async () => {
    const { email, open, request, signUp } = await signedInAuth();
    const link = await request("ada@new.example");
    const grace = await signUp("grace@example.com");

    expect(await open(link, grace.cookie)).toBe(REFUSED);
    expect(await email()).toBe("ada@example.com");
  });

  it("keeps one request when two are made at once", async () => {
    const { call, pendingRows, status } = await signedInAuth();

    await Promise.all(
      ["one@new.example", "two@new.example"].map((newEmail) =>
        call(REQUEST_EMAIL_CHANGE_PATH, {
          method: "POST",
          body: JSON.stringify({ newEmail }),
        }),
      ),
    );

    expect(await pendingRows()).toBe(1);
    expect((await status()).pending).not.toBeNull();
  });

  it("shows a request to an address with an account as waiting, with no mail", async () => {
    const { request, signUp, status } = await signedInAuth();
    await signUp("taken@new.example");

    expect(await request("taken@new.example")).toBe("");
    expect((await status()).pending).toEqual({
      newEmail: "taken@new.example",
    });
  });

  it("leaves Better Auth's uncancellable /change-email closed", async () => {
    const { call } = await signedInAuth();

    const response = await call("/change-email", {
      method: "POST",
      body: JSON.stringify({ newEmail: "ada@new.example" }),
    });
    expect(response.status).toBe(404);
  });
});
