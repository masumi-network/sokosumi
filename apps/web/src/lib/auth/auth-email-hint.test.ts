import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  rememberAuthEmailHint,
  rememberAuthEmailHintOnClick,
  takeAuthEmailHint,
} from "./auth-email-hint";

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

  const plainClick = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };

  it("remembers the email for a plain click", () => {
    rememberAuthEmailHintOnClick(plainClick, "ada@example.com");

    expect(takeAuthEmailHint()).toBe("ada@example.com");
  });

  it.each([
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])("remembers nothing for a click that leaves this tab (%o)", (modifier) => {
    rememberAuthEmailHintOnClick(
      { ...plainClick, ...modifier },
      "ada@example.com",
    );

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
