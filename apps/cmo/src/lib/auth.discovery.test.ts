import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CORE = "https://core.test";

/** Core's discovery document, or a 503 while Core is not up yet. */
function discovery(up: boolean): typeof fetch {
  return async () =>
    up
      ? Response.json({
          issuer: `${CORE}/auth`,
          authorization_endpoint: `${CORE}/auth/oauth2/authorize`,
          token_endpoint: `${CORE}/auth/oauth2/token`,
          jwks_uri: `${CORE}/auth/jwks`,
          id_token_signing_alg_values_supported: ["EdDSA"],
        })
      : Response.json({ error: "unavailable" }, { status: 503 });
}

describe("getAuth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("BETTER_AUTH_URL", "https://cmo.sokosumi.localhost");
    vi.stubEnv("BETTER_AUTH_SECRET", "a-cookie-secret-of-at-least-32-chars");
    vi.stubEnv("SOKOSUMI_OAUTH_CLIENT_ID", "cmo-client");
    vi.stubEnv("SOKOSUMI_OAUTH_CLIENT_SECRET", "cmo-secret");
    vi.stubEnv("CORE_APP_BASE_URL", CORE);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("starts over when Core did not answer discovery", async () => {
    vi.stubGlobal("fetch", discovery(false));
    const { getAuth } = await import("./auth");
    const first = getAuth();
    await first.$context;

    vi.stubGlobal("fetch", discovery(true));
    const second = getAuth();
    const { socialProviders } = await second.$context;

    expect(second).not.toBe(first);
    expect(socialProviders.map((provider) => provider.id)).toContain(
      "sokosumi",
    );
  });

  it("keeps the auth once Core answered discovery", async () => {
    vi.stubGlobal("fetch", discovery(true));
    const { getAuth } = await import("./auth");
    const first = getAuth();
    await first.$context;

    expect(getAuth()).toBe(first);
  });
});
