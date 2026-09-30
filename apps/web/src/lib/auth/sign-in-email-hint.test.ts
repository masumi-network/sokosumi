import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  rememberSignInEmailHint,
  takeSignInEmailHint,
} from "./sign-in-email-hint";

describe("sign-in email hint", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hands the remembered email over once", () => {
    rememberSignInEmailHint("  ada@example.com ");

    expect(takeSignInEmailHint()).toBe("ada@example.com");
    expect(takeSignInEmailHint()).toBeNull();
  });

  it("remembers nothing for a blank email", () => {
    rememberSignInEmailHint("   ");

    expect(takeSignInEmailHint()).toBeNull();
  });

  it("stays quiet when session storage is unavailable", () => {
    // Safari in private mode and blocked site data throw on access.
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => rememberSignInEmailHint("ada@example.com")).not.toThrow();
    expect(takeSignInEmailHint()).toBeNull();
  });
});
