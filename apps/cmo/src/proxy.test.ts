import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";

import { renewSession } from "./lib/auth";
import { proxy } from "./proxy";

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
