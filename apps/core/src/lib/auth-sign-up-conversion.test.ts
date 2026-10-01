import { createHash } from "node:crypto";
import { oauthProvider } from "@better-auth/oauth-provider";
import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimSignUpConversion,
  oauthSignUpOptions,
  recordSignUpConversion,
  takeSignUpConversionRedirect,
} from "./auth-sign-up-conversion";

const { createManyMock, findFirstMock, deleteManyMock } = vi.hoisted(() => ({
  createManyMock: vi.fn(),
  findFirstMock: vi.fn(),
  deleteManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        verification: { findFirst: findFirstMock, deleteMany: deleteManyMock },
      }),
    verification: {
      createMany: createManyMock,
      findFirst: findFirstMock,
      deleteMany: deleteManyMock,
    },
  },
}));

const USER_ID = "user-1";
const NOW = new Date("2026-10-01T12:00:00.000Z");

describe("social sign-up conversion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: NOW });
  });

  it("records an account a social provider's callback creates", async () => {
    await recordSignUpConversion(USER_ID, {
      path: "/callback/:id",
      params: { id: "google" },
    });

    const row = {
      expiresAt: new Date("2026-10-01T13:00:00.000Z"),
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(createManyMock).toHaveBeenCalledWith({
      data: [
        {
          identifier: `sign-up-conversion:${USER_ID}`,
          value: "google",
          ...row,
        },
        {
          identifier: `sign-up-conversion-redirect:${USER_ID}`,
          value: "google",
          ...row,
        },
      ],
    });
  });

  it("records a new account completed by the preview OAuth proxy", async () => {
    await recordSignUpConversion(USER_ID, {
      path: "/callback/:id/oauth-proxy",
      params: { id: "microsoft" },
    });
    expect(createManyMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["an email sign-up", { path: "/sign-up/email" }],
    ["an email code sign-in", { path: "/sign-in/email-otp" }],
    ["a native id token sign-in", { path: "/sign-in/social" }],
    [
      "an unknown provider's callback",
      { path: "/callback/:id", params: { id: "github" } },
    ],
    ["an account created outside a request", undefined],
  ])("records nothing for %s", async (_label, ctx) => {
    await recordSignUpConversion(USER_ID, ctx);

    expect(createManyMock).not.toHaveBeenCalled();
  });

  it("hands out the redirect through Web once", async () => {
    deleteManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(takeSignUpConversionRedirect(USER_ID)).resolves.toBe(true);
    await expect(takeSignUpConversionRedirect(USER_ID)).resolves.toBe(false);
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: {
        identifier: `sign-up-conversion-redirect:${USER_ID}`,
        expiresAt: { gt: NOW },
        value: { in: ["google", "microsoft"] },
      },
    });
  });

  it("hands the provider to the first claim only", async () => {
    findFirstMock.mockResolvedValue({ id: "row-1", value: "microsoft" });
    let claimed = false;
    deleteManyMock.mockImplementation(async ({ where }) => {
      if (!("id" in where)) return { count: 0 };
      const count = claimed ? 0 : 1;
      claimed = true;
      return { count };
    });

    await expect(claimSignUpConversion(USER_ID)).resolves.toBe("microsoft");
    await expect(claimSignUpConversion(USER_ID)).resolves.toBeNull();
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { id: "row-1", expiresAt: { gt: NOW } },
    });
  });

  it("drops the redirect through Web once a page has counted the sign-up", async () => {
    findFirstMock.mockResolvedValue({ id: "row-1", value: "google" });
    deleteManyMock.mockResolvedValue({ count: 1 });

    await claimSignUpConversion(USER_ID);

    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { identifier: `sign-up-conversion-redirect:${USER_ID}` },
    });
  });

  it("claims nothing for a user with no pending sign-up", async () => {
    findFirstMock.mockResolvedValue(null);

    await expect(claimSignUpConversion(USER_ID)).resolves.toBeNull();
    expect(deleteManyMock).not.toHaveBeenCalledWith({
      where: { id: expect.anything() },
    });
  });
});

const WEB = "https://app.example.com";
const CLIENT_REDIRECT_URI = "https://cmo.example.com/callback";

// Better Auth's own OAuth provider on an in-memory store, with Core's sign-up
// options. The pending row itself comes from the Prisma mock above.
async function signedInAuthorize() {
  const auth = betterAuth({
    baseURL: "https://auth.example.com",
    basePath: "/auth",
    secret: "test-secret-that-is-long-enough-for-better-auth",
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
      jwks: [],
      oauthClient: [
        {
          id: "client-row-1",
          clientId: "cmo-client",
          public: true,
          disabled: false,
          skipConsent: true,
          tokenEndpointAuthMethod: "none",
          grantTypes: ["authorization_code"],
          responseTypes: ["code"],
          redirectUris: [CLIENT_REDIRECT_URI],
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      oauthAccessToken: [],
      oauthRefreshToken: [],
      oauthConsent: [],
    }),
    emailAndPassword: { enabled: true },
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      oauthProvider({
        loginPage: `${WEB}/signin`,
        consentPage: `${WEB}/oauth/consent`,
        signup: oauthSignUpOptions(WEB),
      }),
    ],
    rateLimit: { enabled: false },
  });

  const signUp = await auth.api.signUpEmail({
    body: {
      email: "new@example.com",
      password: "a-long-enough-password",
      name: "New Person",
    },
    asResponse: true,
  });
  const cookie = signUp.headers.getSetCookie().join("; ");

  const query = new URLSearchParams({
    client_id: "cmo-client",
    redirect_uri: CLIENT_REDIRECT_URI,
    response_type: "code",
    scope: "openid",
    state: "state-1",
    code_challenge: createHash("sha256")
      .update("a-code-verifier-that-is-long-enough-for-pkce-checks")
      .digest("base64url"),
    code_challenge_method: "S256",
  });
  const response = await auth.handler(
    new Request(`https://auth.example.com/auth/oauth2/authorize?${query}`, {
      headers: { cookie, accept: "text/html", "sec-fetch-mode": "navigate" },
    }),
  );
  return response.headers.get("location") ?? "";
}

describe("oauthSignUpOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a pending social sign-up through Web's sign-up hand-back", async () => {
    deleteManyMock.mockResolvedValue({ count: 1 });

    const location = await signedInAuthorize();

    expect(location.startsWith(`${WEB}/signup?`)).toBe(true);
    expect(new URL(location).searchParams.get("client_id")).toBe("cmo-client");
  });

  it("lets the authorization go on when the lookup fails", async () => {
    deleteManyMock.mockRejectedValue(new Error("database unavailable"));

    const location = await signedInAuthorize();

    expect(location.startsWith(`${CLIENT_REDIRECT_URI}?`)).toBe(true);
  });

  it("lets a counted or once-redirected sign-up go straight on to the client", async () => {
    deleteManyMock.mockResolvedValue({ count: 0 });

    const location = await signedInAuthorize();

    expect(location.startsWith(`${CLIENT_REDIRECT_URI}?`)).toBe(true);
    expect(new URL(location).searchParams.has("code")).toBe(true);
  });
});
