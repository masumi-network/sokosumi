import { symmetricDecrypt } from "better-auth/crypto";
import type { BetterAuthOptions } from "better-auth/minimal";
import { decryptOAuthToken, setTokenUtil } from "better-auth/oauth2";
import { describe, expect, it } from "vitest";
import { getEnv } from "@/config/env";
import { auth } from "./auth";

// The token helpers read only options and secretConfig. Core's exact option
// types do not fit their generic context type, so pass just those two.
async function tokenContext() {
  const { options, secretConfig } = await auth.$context;
  const tokenOptions: BetterAuthOptions = options;
  return { options: tokenOptions, secretConfig } as Parameters<
    typeof setTokenUtil
  >[1];
}

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
