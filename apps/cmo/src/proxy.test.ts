import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";

import { renewSession } from "./lib/auth";
import { config, proxy } from "./proxy";

vi.mock("./lib/auth", () => ({
  getAuth: vi.fn(() => ({})),
  renewSession: vi.fn(),
}));

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

it.each(["/signup", "/signin"])(
  "keeps renewal redirects and outages uncached on %s",
  async (path) => {
    const cookie =
      "__Secure-cmo.account_data=rotated; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; Secure; SameSite=Lax; Path=/";
    for (const status of [204, 503]) {
      vi.mocked(renewSession).mockResolvedValue(
        new Response(null, {
          status,
          headers: { "set-cookie": cookie },
        }),
      );

      const response = await proxy(
        new NextRequest(`https://app.cmo.xyz${path}`),
      );

      expect(response.status).toBe(status === 503 ? 503 : 307);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.getSetCookie()).toEqual([cookie]);
    }
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
