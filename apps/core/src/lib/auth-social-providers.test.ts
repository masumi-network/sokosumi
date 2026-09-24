import { memoryAdapter } from "better-auth/adapters/memory";
import { signJWT, symmetricDecrypt } from "better-auth/crypto";
import { type BetterAuthOptions, betterAuth } from "better-auth/minimal";
import { decryptOAuthToken, setTokenUtil } from "better-auth/oauth2";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEnv } from "@/config/env";
import { auth } from "./auth";
import { accountOptions, socialProviderOptions } from "./auth-social-providers";

const { captureExceptionMock, uploadProfileImageMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  uploadProfileImageMock: vi.fn(),
}));

vi.mock("@sentry/node", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sentry/node")>()),
  captureException: captureExceptionMock,
}));

vi.mock("@/lib/blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blob")>()),
  uploadProfileImage: uploadProfileImageMock,
}));

// The token helpers read only options and secretConfig. Core's exact option
// types do not fit their generic context type, so pass just those two.
async function tokenContext() {
  const { options, secretConfig } = await auth.$context;
  const tokenOptions: BetterAuthOptions = options;
  return { options: tokenOptions, secretConfig } as Parameters<
    typeof setTokenUtil
  >[1];
}

type MemoryDb = Record<string, Record<string, unknown>[]>;

const linkingSecret = "test-secret-that-is-long-enough-for-better-auth";

// Better Auth's own link, token and refresh routes on an in-memory store. Only
// the two calls that would reach Google are stubbed.
function createLinkingAuth(
  db: MemoryDb,
  account: BetterAuthOptions["account"],
) {
  return betterAuth({
    baseURL: "https://auth.example.com",
    basePath: "/auth",
    secret: linkingSecret,
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    account,
    socialProviders: {
      google: {
        ...socialProviderOptions.google,
        verifyIdToken: async () => true,
        refreshAccessToken: async () => ({ accessToken: "ya29.refreshed" }),
      },
    },
    rateLimit: { enabled: false },
  });
}

async function signUpAndLinkGoogle(
  linkingAuth: ReturnType<typeof createLinkingAuth>,
  name: string,
) {
  const email = `${name}@example.com`;
  const signUp = await linkingAuth.api.signUpEmail({
    body: { email, name, password: "Password123!" },
    returnHeaders: true,
  });
  const headers = new Headers({
    cookie: signUp.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; "),
  });
  await linkingAuth.api.linkSocialAccount({
    body: {
      provider: "google",
      idToken: {
        token: await signJWT(
          { sub: name, email, email_verified: true, name },
          linkingSecret,
        ),
        accessToken: `ya29.${name}`,
        refreshToken: `1//${name}`,
      },
    },
    headers,
  });
  return headers;
}

function storedGoogleAccount(db: MemoryDb, sub: string) {
  const { id, accessToken, refreshToken } =
    db.account?.find(
      (row) => row.providerId === "google" && row.accountId === sub,
    ) ?? {};
  if (
    typeof id !== "string" ||
    typeof accessToken !== "string" ||
    typeof refreshToken !== "string"
  ) {
    expect.unreachable(`no Google account stored for ${sub}`);
  }
  return { id, accessToken, refreshToken };
}

describe("social provider options", () => {
  beforeEach(() => {
    captureExceptionMock.mockReset();
    uploadProfileImageMock.mockReset();
    uploadProfileImageMock.mockResolvedValue("https://blob.example/avatar.png");
  });

  it("configures Google and Microsoft social providers without requireLocalEmailVerified", () => {
    expect(socialProviderOptions.google).toEqual({
      clientId: "test-google-client-id",
      clientSecret: "test-google-client-secret",
      overrideUserInfoOnSignIn: false,
      mapProfileToUser: expect.any(Function),
    });
    expect(socialProviderOptions.microsoft).toEqual({
      clientId: "test-microsoft-client-id",
      clientSecret: "test-microsoft-client-secret",
      overrideUserInfoOnSignIn: false,
      mapProfileToUser: expect.any(Function),
    });
    expect(socialProviderOptions.google.mapProfileToUser).toBe(
      socialProviderOptions.microsoft.mapProfileToUser,
    );
    expect(accountOptions.accountLinking).toEqual({
      enabled: true,
      trustedProviders: ["google", "microsoft"],
    });
  });

  it("maps social profile pictures to user fields", async () => {
    const { mapProfileToUser } = socialProviderOptions.google;

    await expect(
      mapProfileToUser({
        name: "Andreas",
        picture: "https://cdn.example.com/avatar.png",
      }),
    ).resolves.toEqual({
      name: "Andreas",
      image: "https://cdn.example.com/avatar.png",
      emailVerified: true,
    });

    const dataUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    await expect(
      mapProfileToUser({
        name: "Andreas",
        picture: dataUri,
      }),
    ).resolves.toEqual({
      name: "Andreas",
      image: "https://blob.example/avatar.png",
      emailVerified: true,
    });
    expect(uploadProfileImageMock).toHaveBeenCalledWith(dataUri);

    await expect(
      mapProfileToUser({
        name: "Andreas",
        picture: "",
      }),
    ).resolves.toEqual({
      name: "Andreas",
      image: undefined,
      emailVerified: true,
    });
  });

  it("falls back when social profile mapping fails", async () => {
    uploadProfileImageMock.mockRejectedValueOnce(new Error("upload failed"));

    await expect(
      socialProviderOptions.google.mapProfileToUser({
        name: "Andreas",
        picture: "data:image/png;base64,invalid",
      }),
    ).resolves.toEqual({
      name: "Andreas",
      image: undefined,
      emailVerified: true,
    });
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe("stored OAuth provider tokens", () => {
  it("encrypts them with a key from BETTER_AUTH_SECRET", async () => {
    const ctx = await tokenContext();
    const token = "ya29.provider-access-token";

    const stored = await setTokenUtil(token, ctx);
    if (typeof stored !== "string") {
      expect.unreachable("setTokenUtil returned no token");
    }

    expect(stored).not.toContain(token);
    expect(
      await symmetricDecrypt({
        key: getEnv().BETTER_AUTH_SECRET,
        data: stored,
      }),
    ).toBe(token);
    expect(await decryptOAuthToken(stored, ctx)).toBe(token);
  });

  it("still reads tokens stored in plaintext before encryption", async () => {
    const ctx = await tokenContext();
    const legacy = "1//legacy-google-refresh-token";

    expect(ctx.options.account?.encryptOAuthTokens).toBe(true);
    expect(await decryptOAuthToken(legacy, ctx)).toBe(legacy);
  });

  it("cannot read them once BETTER_AUTH_SECRET is replaced in place", async () => {
    const ctx = await tokenContext();

    const stored = await setTokenUtil("ya29.provider-access-token", ctx);
    if (typeof stored !== "string") {
      expect.unreachable("setTokenUtil returned no token");
    }

    await expect(
      decryptOAuthToken(stored, { ...ctx, secretConfig: "replaced-secret" }),
    ).rejects.toThrow();
  });

  it("still reads them after rotating to BETTER_AUTH_SECRETS", async () => {
    const ctx = await tokenContext();
    const token = "ya29.provider-access-token";
    const stored = await setTokenUtil(token, ctx);
    if (typeof stored !== "string") {
      expect.unreachable("setTokenUtil returned no token");
    }
    // `secrets` is what BETTER_AUTH_SECRETS parses to; the old secret stays.
    const { secretConfig } = await betterAuth({
      secret: getEnv().BETTER_AUTH_SECRET,
      secrets: [
        { version: 2, value: "rotated-secret-that-is-long-enough-for-auth" },
      ],
      database: memoryAdapter({}),
    }).$context;
    const rotated = { ...ctx, secretConfig };

    expect(await decryptOAuthToken(stored, rotated)).toBe(token);
    const restored = await setTokenUtil(token, rotated);
    expect(restored).toMatch(/^\$ba\$2\$/);
    expect(await decryptOAuthToken(restored ?? "", rotated)).toBe(token);
  });

  it("encrypts tokens on a new link and still reads rows stored before", async () => {
    const db: MemoryDb = {
      user: [],
      session: [],
      account: [],
      verification: [],
    };
    // Core before this change: the same account options without the flag.
    const beforeChange = createLinkingAuth(db, {
      ...accountOptions,
      encryptOAuthTokens: false,
    });
    const afterChange = createLinkingAuth(db, accountOptions);
    const adaHeaders = await signUpAndLinkGoogle(beforeChange, "ada");
    const graceHeaders = await signUpAndLinkGoogle(afterChange, "grace");
    const ada = storedGoogleAccount(db, "ada");
    const grace = storedGoogleAccount(db, "grace");

    expect(ada).toMatchObject({
      accessToken: "ya29.ada",
      refreshToken: "1//ada",
    });
    expect(
      await symmetricDecrypt({ key: linkingSecret, data: grace.accessToken }),
    ).toBe("ya29.grace");
    expect(
      await symmetricDecrypt({ key: linkingSecret, data: grace.refreshToken }),
    ).toBe("1//grace");

    await expect(
      afterChange.api.getAccessToken({
        body: { accountId: ada.id },
        headers: adaHeaders,
      }),
    ).resolves.toMatchObject({ accessToken: "ya29.ada" });
    await expect(
      afterChange.api.getAccessToken({
        body: { accountId: grace.id },
        headers: graceHeaders,
      }),
    ).resolves.toMatchObject({ accessToken: "ya29.grace" });
    await expect(
      afterChange.api.refreshToken({
        body: { accountId: ada.id },
        headers: adaHeaders,
      }),
    ).resolves.toMatchObject({ refreshToken: "1//ada" });
    await expect(
      afterChange.api.refreshToken({
        body: { accountId: grace.id },
        headers: graceHeaders,
      }),
    ).resolves.toMatchObject({ refreshToken: "1//grace" });
  });
});
