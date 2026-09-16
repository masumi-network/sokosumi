import { describe, expect, it, vi } from "vitest";

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

  it("treats an empty getSetCookie() as authoritative, ignoring the joined header", () => {
    const response = new Response("{}");
    vi.spyOn(response.headers, "getSetCookie").mockReturnValue([]);
    vi.spyOn(response.headers, "get").mockReturnValue(
      "a=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/, b=2; Path=/",
    );

    expect(collectResponseSetCookies(response)).toEqual([]);
  });

  it("falls back to the single header when getSetCookie() is unavailable", () => {
    const response = responseWithCookies("plain=value; Path=/");
    Object.assign(response.headers, { getSetCookie: undefined });

    expect(collectResponseSetCookies(response)).toEqual([
      "plain=value; Path=/",
    ]);
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
