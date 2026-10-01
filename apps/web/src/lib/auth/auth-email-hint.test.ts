import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rememberAuthEmailHint, takeAuthEmailHint } from "./auth-email-hint";

describe("auth email hint", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hands the remembered email over once", () => {
    rememberAuthEmailHint("  ada@example.com ");

    expect(takeAuthEmailHint()).toBe("ada@example.com");
    expect(takeAuthEmailHint()).toBeNull();
  });

  it("remembers nothing for a blank email", () => {
    rememberAuthEmailHint("   ");

    expect(takeAuthEmailHint()).toBeNull();
  });

  it("stays quiet when session storage is unavailable", () => {
    // Safari in private mode and blocked site data throw on access.
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => rememberAuthEmailHint("ada@example.com")).not.toThrow();
    expect(takeAuthEmailHint()).toBeNull();
  });
});
