import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";

import { renewSession } from "./lib/auth";
import { config, proxy } from "./proxy";

/** CMO's public origin, as `getAuth().options.baseURL` reports it. */
const cmo = vi.hoisted(() => ({ baseURL: "https://app.cmo.xyz" }));

vi.mock("./lib/auth", () => ({
  getAuth: vi.fn(() => ({ options: { baseURL: cmo.baseURL } })),
  renewSession: vi.fn(),
}));

afterEach(() => {
  cmo.baseURL = "https://app.cmo.xyz";
  vi.unstubAllEnvs();
  vi.mocked(renewSession).mockReset();
});

const BRANCH_ALIAS = "https://sokosumi-cmo-git-sok-1-fix.preview.cmo.xyz";

it("moves a preview's deployment URL to its branch alias, where sign in lands", async () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  cmo.baseURL = BRANCH_ALIAS;

  const response = await proxy(
    new NextRequest(
      "https://sokosumi-cmo-abc123.preview.cmo.xyz/signin?ref=mail",
    ),
  );

  expect(response.status).toBe(308);
  expect(response.headers.get("location")).toBe(
    `${BRANCH_ALIAS}/signin?ref=mail`,
  );
  expect(renewSession).not.toHaveBeenCalled();
});

it("keeps a protocol-relative path on the branch alias", async () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  cmo.baseURL = BRANCH_ALIAS;

  const response = await proxy(
    new NextRequest(
      "https://sokosumi-cmo-abc123.preview.cmo.xyz//evil.example/x",
    ),
  );

  expect(response.headers.get("location")).toBe(
    `${BRANCH_ALIAS}//evil.example/x`,
  );
});

it.each([
  ["a preview on its branch alias", "preview", `${BRANCH_ALIAS}/`],
  // Behind a local proxy, Next.js sees its own host, not CMO's origin.
  ["local development", undefined, "http://cmo-internal:3100/"],
  ["production", "production", "https://sokosumi-cmo.vercel.app/"],
])("keeps the host for %s", async (_case, vercelEnv, url) => {
  vi.stubEnv("VERCEL_ENV", vercelEnv);
  if (vercelEnv === "preview") cmo.baseURL = BRANCH_ALIAS;
  vi.mocked(renewSession).mockResolvedValue(
    new Response(null, { status: 204 }),
  );

  const response = await proxy(new NextRequest(url));

  expect(response.headers.has("location")).toBe(false);
  expect(renewSession).toHaveBeenCalledOnce();
});

it("leaves Better Auth's routes, including the OAuth callback, on their host", () => {
  expect(
    unstable_doesMiddlewareMatch({
      config,
      nextConfig: {},
      url: "/api/auth/callback/sokosumi",
    }),
  ).toBe(false);
});

it("returns Core outages without rendering the page or losing rotated cookies", async () => {
  const cookies = [
    "__Secure-cmo.account_data.0=first; HttpOnly; Secure; Path=/",
    "__Secure-cmo.account_data.1=second; HttpOnly; Secure; Path=/",
  ];
  const headers = new Headers();
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  vi.mocked(renewSession).mockResolvedValue(
    new Response(null, { status: 503, headers }),
  );

  const response = await proxy(new NextRequest("https://app.cmo.xyz/"));

  expect(response.status).toBe(503);
  expect(response.headers.getSetCookie()).toEqual(cookies);
  expect(response.headers.has("location")).toBe(false);
  expect(response.headers.has("x-middleware-next")).toBe(false);
});

// Renewal's caching does not depend on the path, so one page stands for all.
it("keeps renewal redirects and outages uncached", async () => {
  const cookie =
    "__Secure-cmo.account_data=rotated; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; Secure; SameSite=Lax; Path=/";
  for (const status of [204, 503]) {
    vi.mocked(renewSession).mockResolvedValue(
      new Response(null, {
        status,
        headers: { "set-cookie": cookie },
      }),
    );

    const response = await proxy(new NextRequest("https://app.cmo.xyz/"));

    expect(response.status).toBe(status === 503 ? 503 : 307);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.getSetCookie()).toEqual([cookie]);
  }
});

it.each([
  ["/", "/?error=signed_out"],
  ["/?error=state_mismatch", "/?error=signed_out"],
  // A link still starts sign in; the route ignores the reason.
  ["/signin", "/signin?error=signed_out"],
])(
  "names the reason when renewal signs the person out on %s",
  async (path, target) => {
    const cleared = "__Secure-cmo.session_token=; Max-Age=0; Path=/";
    vi.mocked(renewSession).mockResolvedValue(
      new Response(null, { status: 401, headers: { "set-cookie": cleared } }),
    );

    const response = await proxy(new NextRequest(`https://app.cmo.xyz${path}`));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://app.cmo.xyz${target}`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.getSetCookie()).toEqual([cleared]);
  },
);

it.each([
  ["purpose", "prefetch"],
  ["next-router-prefetch", "1"],
  ["next-router-segment-prefetch", "/_tree"],
  ["sec-purpose", "prefetch;prerender"],
])("skips renewal for speculative requests carrying %s", (name, value) => {
  expect(
    unstable_doesMiddlewareMatch({
      config,
      nextConfig: {},
      url: "/signup",
      headers: { [name]: value },
    }),
  ).toBe(false);
  expect(
    unstable_doesMiddlewareMatch({
      config,
      nextConfig: {},
      url: "/signup",
      headers: {},
    }),
  ).toBe(true);
});
