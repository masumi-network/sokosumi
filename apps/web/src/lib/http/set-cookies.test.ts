import { describe, expect, it } from "vitest";

import {
  appendProxiedSetCookies,
  collectResponseSetCookies,
} from "./set-cookies";

const SIGNED_COOKIE =
  "__Secure-test.session_token=hwarHcP3Xz.obFIJq1K9AAkFRkeiK3Q5yCJcR2sgJxpMwXPblvnIjE%3D; Path=/; Secure; HttpOnly; SameSite=Lax";

function responseWithCookies(...cookies: string[]): Response {
  const response = new Response("{}", {
    headers: { "content-type": "application/json" },
  });
  for (const cookie of cookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

describe("collectResponseSetCookies", () => {
  it("returns each Set-Cookie line byte-identical", () => {
    const response = responseWithCookies(SIGNED_COOKIE, "plain=value; Path=/");

    expect(collectResponseSetCookies(response)).toEqual([
      SIGNED_COOKIE,
      "plain=value; Path=/",
    ]);
  });

  it("returns an empty list when no cookies were set", () => {
    expect(collectResponseSetCookies(new Response("{}"))).toEqual([]);
  });

  it("trusts an empty getSetCookie and does not fall back to a joined header", () => {
    const response = {
      headers: {
        getSetCookie: () => [],
        get: (name: string) =>
          name.toLowerCase() === "set-cookie"
            ? "a=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT, b=2; Path=/"
            : null,
      },
    } as unknown as Response;

    expect(collectResponseSetCookies(response)).toEqual([]);
  });

  it("falls back to headers.get when getSetCookie is absent", () => {
    const response = {
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "set-cookie" ? SIGNED_COOKIE : null,
      },
    } as unknown as Response;

    expect(collectResponseSetCookies(response)).toEqual([SIGNED_COOKIE]);
  });
});

describe("appendProxiedSetCookies", () => {
  it("appends every line without parsing or re-encoding", () => {
    const response = responseWithCookies(SIGNED_COOKIE, "plain=value; Path=/");
    const headers = new Headers({ "content-type": "application/json" });

    appendProxiedSetCookies(headers, response);

    expect(headers.getSetCookie()).toEqual([
      SIGNED_COOKIE,
      "plain=value; Path=/",
    ]);
    expect(headers.get("content-type")).toBe("application/json");
  });
});
