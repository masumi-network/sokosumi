import { createHash, randomUUID } from "node:crypto";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuthUserAdditionalFields } from "@sokosumi/utils";
import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins";
import { emailOTP } from "better-auth/plugins/email-otp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { emailCodeSignIn } from "./auth-email-code-sign-in";
import { recordSignUpContext } from "./auth-sign-up-context";

type Row = Record<string, unknown>;

// Owned persistence fixture: Better Auth's memory store holds users and OAuth
// clients, and the recorded sign-up contexts land in `contexts`.
const fixture = vi.hoisted(() => {
  const state = {
    db: {} as Record<string, Record<string, unknown>[]>,
    contexts: [] as Record<string, unknown>[],
    failWrite: false,
    errors: [] as unknown[],
  };
  return {
    state,
    prisma: {
      oauthClient: {
        async findUnique({
          where,
        }: {
          where: { clientId: string };
          select: { signUpOrigin: true };
        }) {
          const client = state.db.oauthClient?.find(
            (row) => row.clientId === where.clientId,
          );
          return client
            ? { signUpOrigin: (client.signUpOrigin as string) ?? null }
            : null;
        },
      },
      signUpContext: {
        async create({ data }: { data: Record<string, unknown> }) {
          if (state.failWrite) throw new Error("sign-up context unavailable");
          state.contexts.push(data);
          return data;
        },
      },
    },
  };
});
vi.mock("@/lib/db/prisma", () => ({ default: fixture.prisma }));
vi.mock("@/lib/evlog", () => ({
  tryUseLogger: () => ({
    error: (error: unknown) => fixture.state.errors.push(error),
  }),
}));

const WEB = "https://web.example.test";
const CORE = "https://core.example.test";
const CLIENT = "https://cmo.example.test/callback";
const SECRET = "owned-offline-auth-fixture-secret-32-characters";
const EMAIL = "ada@example.test";

const SIGN_UP = {
  firstName: "Ada",
  lastName: "Lovelace",
  termsAccepted: true,
  marketingOptIn: false,
};

function oauthClientRow(clientId: string, signUpOrigin?: string): Row {
  return {
    id: randomUUID(),
    clientId,
    public: true,
    disabled: false,
    skipConsent: true,
    tokenEndpointAuthMethod: "none",
    grantTypes: ["authorization_code"],
    responseTypes: ["code"],
    redirectUris: [CLIENT],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...(signUpOrigin ? { signUpOrigin } : {}),
  };
}

function createAuth(seedUsers: Row[] = []) {
  const codes = new Map<string, string>();
  fixture.state.db = {
    user: seedUsers,
    account: [],
    session: [],
    verification: [],
    jwks: [],
    oauthConsent: [],
    oauthAccessToken: [],
    oauthRefreshToken: [],
    oauthClient: [oauthClientRow("cmo", "cmo"), oauthClientRow("unset")],
  };
  const auth = betterAuth({
    baseURL: CORE,
    basePath: "/auth",
    secret: SECRET,
    database: memoryAdapter(fixture.state.db),
    trustedOrigins: [WEB, CORE],
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    user: { additionalFields: betterAuthUserAdditionalFields },
    databaseHooks: {
      user: {
        create: { after: (user) => recordSignUpContext(user.id) },
      },
    },
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      oauthProvider({
        loginPage: `${WEB}/signin`,
        consentPage: `${WEB}/oauth/consent`,
        signup: { page: `${WEB}/signup` },
      }),
      emailCodeSignIn(
        emailOTP({
          storeOTP: "encrypted",
          resendStrategy: "reuse",
          sendVerificationOTP: async ({ email, otp }) => {
            codes.set(email, otp);
          },
        }),
      ),
    ],
    rateLimit: { enabled: false },
  });

  function post(path: string, body: Row) {
    return auth.handler(
      new Request(`${CORE}/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: WEB },
        body: JSON.stringify(body),
      }),
    );
  }

  /** The signed query Web's sign-up page receives and sends back. */
  async function authorize(clientId: string): Promise<string> {
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: CLIENT,
      response_type: "code",
      scope: "openid",
      state: "client-state",
      code_challenge: createHash("sha256")
        .update("fixture-pkce-verifier-long-enough-for-validation")
        .digest("base64url"),
      code_challenge_method: "S256",
      prompt: "create",
    });
    const response = await auth.handler(
      new Request(`${CORE}/auth/oauth2/authorize?${query}`, {
        headers: { accept: "text/html", "sec-fetch-mode": "navigate" },
      }),
    );
    const signup = new URL(response.headers.get("location") ?? "");
    expect(signup.origin + signup.pathname).toBe(`${WEB}/signup`);
    return signup.searchParams.toString();
  }

  /** Email code sign-up or sign-in, with a password when given. */
  async function signInWithCode(
    options: { oauthQuery?: string; password?: string } = {},
  ) {
    await post("/email-otp/send-verification-otp", {
      email: EMAIL,
      type: "sign-in",
    });
    return post("/sign-in/email-otp", {
      email: EMAIL,
      otp: codes.get(EMAIL) ?? "",
      ...SIGN_UP,
      ...(options.password ? { password: options.password } : {}),
      ...(options.oauthQuery ? { oauth_query: options.oauthQuery } : {}),
    });
  }

  return { authorize, signInWithCode };
}

/** The one recorded sign-up context, for the one user the test created. */
function expectRecorded(origin: string, clientId: string | null) {
  expect(fixture.state.db.user).toHaveLength(1);
  expect(fixture.state.contexts).toEqual([
    { userId: fixture.state.db.user[0].id, origin, entries: {}, clientId },
  ]);
}

describe("recording the sign-up origin", () => {
  beforeEach(() => {
    fixture.state.contexts.length = 0;
    fixture.state.errors.length = 0;
    fixture.state.failWrite = false;
  });

  it("records the client's origin for an email code sign-up through it", async () => {
    const auth = createAuth();
    const oauthQuery = await auth.authorize("cmo");

    const response = await auth.signInWithCode({ oauthQuery });

    expect(response.status).toBe(200);
    expectRecorded("cmo", "cmo");
  });

  it("records the client's origin for a password sign-up through it", async () => {
    const auth = createAuth();
    const oauthQuery = await auth.authorize("cmo");

    const response = await auth.signInWithCode({
      oauthQuery,
      password: "correct horse battery",
    });

    expect(response.status).toBe(200);
    expectRecorded("cmo", "cmo");
  });

  it("records unknown for a client without a sign-up origin", async () => {
    const auth = createAuth();
    const oauthQuery = await auth.authorize("unset");

    await auth.signInWithCode({ oauthQuery });

    expectRecorded("unknown", "unset");
  });

  it("records sokosumi for a sign-up outside an OAuth request", async () => {
    const auth = createAuth();

    const response = await auth.signInWithCode();

    expect(response.status).toBe(200);
    expectRecorded("sokosumi", null);
  });

  it("records nothing when an existing user signs in through a client", async () => {
    const auth = createAuth([
      {
        id: "existing-user",
        email: EMAIL,
        name: "Ada Lovelace",
        emailVerified: true,
        termsAccepted: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const oauthQuery = await auth.authorize("cmo");

    const response = await auth.signInWithCode({ oauthQuery });

    expect(response.status).toBe(200);
    expect(fixture.state.contexts).toEqual([]);
  });

  it("logs a failed write and lets the sign-up succeed", async () => {
    fixture.state.failWrite = true;
    const auth = createAuth();
    const oauthQuery = await auth.authorize("cmo");

    const response = await auth.signInWithCode({ oauthQuery });

    expect(response.status).toBe(200);
    expect(fixture.state.db.user).toHaveLength(1);
    expect(fixture.state.errors).toEqual([
      expect.objectContaining({ message: "sign-up context unavailable" }),
    ]);
  });
});
