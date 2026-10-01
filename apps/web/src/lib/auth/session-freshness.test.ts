import { describe, expect, it } from "vitest";

import { isSessionNotFreshError } from "./session-freshness";

describe("isSessionNotFreshError", () => {
  it("recognises the fresh-session middleware's code", () => {
    expect(isSessionNotFreshError({ code: "SESSION_NOT_FRESH" })).toBe(true);
  });

  it("recognises a passwordless delete refused for session age", () => {
    expect(isSessionNotFreshError({ code: "SESSION_EXPIRED" })).toBe(true);
  });

  it("ignores every other error", () => {
    expect(isSessionNotFreshError({ code: "INVALID_PASSWORD" })).toBe(false);
    expect(isSessionNotFreshError({ message: "no code" })).toBe(false);
    expect(isSessionNotFreshError(null)).toBe(false);
  });
});
