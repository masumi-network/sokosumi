import { oauthProvider } from "@better-auth/oauth-provider";
import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEnv } from "@/config/env";
import { expectCoreLog } from "@/test/core-log";
import { jwtKeyStoreOptions } from "./auth-oauth-provider";
import { betterAuthLogger } from "./evlog-library-logs";

type MemoryDb = Record<string, Record<string, unknown>[]>;

const ISSUER_ORIGIN = "https://api.sokosumi.com";
const EXPECTED_ISSUER = `${ISSUER_ORIGIN}/auth`;
const SECRET = "coworker-request-auth-test-secret-that-is-long-enough";
const OTHER_SECRET = "another-secret-for-forked-production-jwks-in-tests";

function createTestAuth(
  db: MemoryDb,
  secret: string,
  isProduction: boolean,
  baseURL = ISSUER_ORIGIN,
) {
  return betterAuth({
    logger: betterAuthLogger,
    baseURL,
    basePath: "/auth",
    secret,
    database: memoryAdapter(db),
    plugins: [
      jwt({
        disableSettingJwtHeader: true,
        ...jwtKeyStoreOptions(isProduction),
      }),
      oauthProvider({
        loginPage: "https://app.sokosumi.com/signin",
        consentPage: "https://app.sokosumi.com/oauth/consent",
      }),
    ],
  });
}

const authState = vi.hoisted(() => ({
  current: null as ReturnType<typeof createTestAuth> | null,
}));

vi.mock("@/lib/auth", () => ({
  get auth() {
    if (!authState.current) {
      throw new Error("Test auth instance not initialized");
    }
    return authState.current;
  },
}));

import {
  getCoworkerAuthorizationHeader,
  signCoworkerRequestToken,
} from "./coworker-request-auth";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("coworker-request-auth", () => {
  let db: MemoryDb;
  let originalNodeEnv: ReturnType<typeof getEnv>["NODE_ENV"];
  let originalVercelEnv: ReturnType<typeof getEnv>["VERCEL_ENV"];

  beforeEach(() => {
    const env = getEnv();
    originalNodeEnv = env.NODE_ENV;
    originalVercelEnv = env.VERCEL_ENV;
    env.NODE_ENV = "development";
    env.VERCEL_ENV = undefined;

    db = { jwks: [] };
    authState.current = createTestAuth(db, SECRET, false);
  });

  afterEach(() => {
    const env = getEnv();
    env.NODE_ENV = originalNodeEnv;
    env.VERCEL_ENV = originalVercelEnv;
  });

  it("signs a coworker+jwt token verifiable with jose against public JWKS", async () => {
    const token = await signCoworkerRequestToken({
      coworkerBaseUrl: "https://coworker.example.com/v1/",
      userId: "user_123",
      organizationId: "org_456",
      coworkerSlug: "serviceplan-agent",
    });

    const header = decodeProtectedHeader(token);
    expect(header.typ).toBe("coworker+jwt");
    expect(header.alg).toBe("EdDSA");
    expect(typeof header.kid).toBe("string");

    const jwks = await authState.current!.api.getJwks();
    expect(jwks.keys.map((k) => k.kid)).toContain(header.kid);

    const verified = await jwtVerify(token, createLocalJWKSet(jwks), {
      issuer: EXPECTED_ISSUER,
      audience: "https://coworker.example.com/v1",
      typ: "coworker+jwt",
    });

    expect(verified.payload.iss).toBe(EXPECTED_ISSUER);
    expect(verified.payload.aud).toBe("https://coworker.example.com/v1");
    expect(verified.payload.sub).toBe("user_123");
    expect(verified.payload.org).toBe("org_456");
    expect(verified.payload.coworker).toBe("serviceplan-agent");
    expect(typeof verified.payload.iat).toBe("number");
    expect(typeof verified.payload.exp).toBe("number");
    expect(verified.payload.exp! - verified.payload.iat!).toBe(300);
    expect(verified.payload.jti).toMatch(UUID_REGEX);

    expect(Object.keys(verified.payload).sort()).toEqual([
      "aud",
      "coworker",
      "exp",
      "iat",
      "iss",
      "jti",
      "org",
      "sub",
    ]);
  });

  it("omits org in a personal chat", async () => {
    for (const organizationId of [null, undefined, "", "   "]) {
      const token = await signCoworkerRequestToken({
        coworkerBaseUrl: "https://coworker.example.com/v1",
        userId: "user_123",
        organizationId,
        coworkerSlug: "elena",
      });

      const jwks = await authState.current!.api.getJwks();
      const verified = await jwtVerify(token, createLocalJWKSet(jwks), {
        issuer: EXPECTED_ISSUER,
        audience: "https://coworker.example.com/v1",
        typ: "coworker+jwt",
      });

      expect("org" in verified.payload).toBe(false);
      expect(Object.keys(verified.payload).sort()).toEqual([
        "aud",
        "coworker",
        "exp",
        "iat",
        "iss",
        "jti",
        "sub",
      ]);
    }
  });

  it("mints a fresh jti on every call and formats Bearer authorization header", async () => {
    const first = await getCoworkerAuthorizationHeader({
      coworkerBaseUrl: "https://coworker.example.com/v1",
      userId: "user_123",
      organizationId: null,
      coworkerSlug: "elena",
    });
    const second = await getCoworkerAuthorizationHeader({
      coworkerBaseUrl: "https://coworker.example.com/v1",
      userId: "user_123",
      organizationId: null,
      coworkerSlug: "elena",
    });

    expect(first.startsWith("Bearer ")).toBe(true);
    expect(second.startsWith("Bearer ")).toBe(true);

    const jwks = createLocalJWKSet(await authState.current!.api.getJwks());
    const v1 = await jwtVerify(first.slice("Bearer ".length), jwks, {
      issuer: EXPECTED_ISSUER,
      audience: "https://coworker.example.com/v1",
      typ: "coworker+jwt",
    });
    const v2 = await jwtVerify(second.slice("Bearer ".length), jwks, {
      issuer: EXPECTED_ISSUER,
      audience: "https://coworker.example.com/v1",
      typ: "coworker+jwt",
    });

    expect(v1.payload.jti).toMatch(UUID_REGEX);
    expect(v2.payload.jti).toMatch(UUID_REGEX);
    expect(v1.payload.jti).not.toBe(v2.payload.jti);
  });

  it("uses jwtKeyStoreOptions so previews skip foreign keys and production fails loudly", async () => {
    expectCoreLog(
      "warn",
      "Skipped 1 JWKS signing key(s) encrypted with another secret",
      3,
    );

    // Seed a production key encrypted under another secret.
    const prodAuth = createTestAuth(db, OTHER_SECRET, true);
    await prodAuth.api.signJWT({ body: { payload: { sub: "seed" } } });
    expect(db.jwks).toHaveLength(1);

    // Preview / non-production skips the undecryptable key and signs with its own.
    const previewEnv = getEnv();
    previewEnv.NODE_ENV = "production";
    previewEnv.VERCEL_ENV = "preview";
    authState.current = createTestAuth(db, SECRET, false);

    const previewToken = await signCoworkerRequestToken({
      coworkerBaseUrl: "https://coworker.example.com/v1",
      userId: "user_123",
      organizationId: null,
      coworkerSlug: "elena",
    });
    const previewJwks = await authState.current.api.getJwks();
    await expect(
      jwtVerify(previewToken, createLocalJWKSet(previewJwks), {
        issuer: EXPECTED_ISSUER,
        audience: "https://coworker.example.com/v1",
        typ: "coworker+jwt",
      }),
    ).resolves.toBeDefined();
    expect(db.jwks).toHaveLength(2);

    // Production fails loudly on an undecryptable key rather than replacing it.
    const foreignOnlyDb: MemoryDb = { jwks: [db.jwks[0]!] };
    previewEnv.VERCEL_ENV = "production";
    authState.current = createTestAuth(foreignOnlyDb, SECRET, true);

    await expect(
      signCoworkerRequestToken({
        coworkerBaseUrl: "https://coworker.example.com/v1",
        userId: "user_123",
        organizationId: null,
        coworkerSlug: "elena",
      }),
    ).rejects.toThrow("Failed to decrypt private key");
  });

  it("takes iss from OIDC discovery rather than raw context.baseURL", async () => {
    authState.current = createTestAuth(
      db,
      SECRET,
      false,
      "https://API.example.test:443",
    );

    const rawContext = await authState.current.$context;
    expect(rawContext.baseURL).toBe("https://API.example.test:443/auth");

    const openIdConfig = await authState.current.api.getOpenIdConfig();
    expect(openIdConfig.issuer).toBe("https://api.example.test/auth");

    const token = await signCoworkerRequestToken({
      coworkerBaseUrl: "https://coworker.example.com/v1",
      userId: "user_123",
      organizationId: null,
      coworkerSlug: "elena",
    });

    const jwks = await authState.current.api.getJwks();
    const verified = await jwtVerify(token, createLocalJWKSet(jwks), {
      issuer: openIdConfig.issuer,
      audience: "https://coworker.example.com/v1",
      typ: "coworker+jwt",
    });
    expect(verified.payload.iss).toBe("https://api.example.test/auth");
  });

  it("refuses non-https coworker base URLs in production", async () => {
    const env = getEnv();
    env.NODE_ENV = "production";
    env.VERCEL_ENV = "production";
    authState.current = createTestAuth(db, SECRET, true);

    await expect(
      signCoworkerRequestToken({
        coworkerBaseUrl: "http://coworker.example.com/v1",
        userId: "user_123",
        organizationId: null,
        coworkerSlug: "elena",
      }),
    ).rejects.toThrow(/https/i);

    await expect(
      signCoworkerRequestToken({
        coworkerBaseUrl: "https://coworker.example.com/v1",
        userId: "user_123",
        organizationId: null,
        coworkerSlug: "elena",
      }),
    ).resolves.toEqual(expect.any(String));
  });

  it("allows http coworker base URLs outside production for local coworkers", async () => {
    const env = getEnv();
    for (const [nodeEnv, vercelEnv] of [
      ["development", undefined],
      ["production", "preview"],
    ] as const) {
      env.NODE_ENV = nodeEnv;
      env.VERCEL_ENV = vercelEnv;

      const token = await signCoworkerRequestToken({
        coworkerBaseUrl: "http://localhost:8080/v1/",
        userId: "user_123",
        organizationId: null,
        coworkerSlug: "local-agent",
      });
      const jwks = await authState.current!.api.getJwks();
      const verified = await jwtVerify(token, createLocalJWKSet(jwks), {
        issuer: EXPECTED_ISSUER,
        audience: "http://localhost:8080/v1",
        typ: "coworker+jwt",
      });
      expect(verified.payload.aud).toBe("http://localhost:8080/v1");
    }
  });

  it("rejects non-http(s) and malformed coworker base URLs everywhere", async () => {
    await expect(
      signCoworkerRequestToken({
        coworkerBaseUrl: "ftp://coworker.example.com/v1",
        userId: "user_123",
        organizationId: null,
        coworkerSlug: "elena",
      }),
    ).rejects.toThrow(/http|https/i);

    await expect(
      signCoworkerRequestToken({
        coworkerBaseUrl: "not-a-url",
        userId: "user_123",
        organizationId: null,
        coworkerSlug: "elena",
      }),
    ).rejects.toThrow(/coworkerBaseUrl/);
  });

  it("rejects when required claims are blank", async () => {
    await expect(
      signCoworkerRequestToken({
        coworkerBaseUrl: "   ",
        userId: "user_123",
        organizationId: null,
        coworkerSlug: "elena",
      }),
    ).rejects.toThrow("coworkerBaseUrl");

    await expect(
      signCoworkerRequestToken({
        coworkerBaseUrl: "https://coworker.example.com/v1",
        userId: " ",
        organizationId: null,
        coworkerSlug: "elena",
      }),
    ).rejects.toThrow("userId");

    await expect(
      signCoworkerRequestToken({
        coworkerBaseUrl: "https://coworker.example.com/v1",
        userId: "user_123",
        organizationId: null,
        coworkerSlug: "",
      }),
    ).rejects.toThrow("coworkerSlug");
  });
});
