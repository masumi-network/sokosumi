import { symmetricDecrypt } from "better-auth/crypto";
import type { BetterAuthOptions } from "better-auth/minimal";
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
});
