import { expect, it, vi } from "vitest";

const CORE = "https://core.test";

vi.mock("../../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/auth")>();
  const auth = actual.createCmoAuth({
    baseURL: "https://app.cmo.xyz",
    coreBaseUrl: CORE,
    clientId: "cmo-client",
    clientSecret: "cmo-secret",
    secret: "a-cookie-secret-that-is-at-least-32-characters",
  });
  return { ...actual, getAuth: () => auth };
});

// Core's discovery document, read when CMO's auth is created.
vi.stubGlobal("fetch", async () =>
  Response.json({
    issuer: `${CORE}/auth`,
    authorization_endpoint: `${CORE}/auth/oauth2/authorize`,
    token_endpoint: `${CORE}/auth/oauth2/token`,
  }),
);

const { GET } = await import("./route");

it("starts Sign in at Core without a prompt, with CMO's state cookie, uncached", async () => {
  const response = await GET(new Request("https://app.cmo.xyz/signin"));

  expect(response.status).toBe(302);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const location = new URL(response.headers.get("location") ?? "");
  expect(`${location.origin}${location.pathname}`).toBe(
    `${CORE}/auth/oauth2/authorize`,
  );
  expect(location.searchParams.has("prompt")).toBe(false);
  expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
});
