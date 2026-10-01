import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  rememberAuthEmailHint,
  rememberAuthEmailHintOnClick,
  takeAuthEmailHint,
  takeSignUpHandover,
} from "./auth-email-hint";

describe("auth email hint", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const plainClick = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };

  it("hands the remembered email over once", () => {
    rememberAuthEmailHint("  ada@example.com ");

    expect(takeAuthEmailHint()).toBe("ada@example.com");
    expect(takeAuthEmailHint()).toBeNull();
  });

  it("hands sign-up the address sign-in found no account for, with the code's send time", () => {
    rememberAuthEmailHint("ada@example.com", { signUp: { codeSentAt: 1_000 } });

    expect(takeSignUpHandover()).toEqual({
      email: "ada@example.com",
      codeSentAt: 1_000,
    });
    expect(takeSignUpHandover()).toBeNull();
    expect(takeAuthEmailHint()).toBeNull();
  });

  it("hands sign-up the address when no code went out", () => {
    rememberAuthEmailHint("ada@example.com", { signUp: { codeSentAt: null } });

    expect(takeSignUpHandover()).toEqual({
      email: "ada@example.com",
      codeSentAt: null,
    });
  });

  it("leaves a plain hint for the email step", () => {
    rememberAuthEmailHint("ada@example.com");

    expect(takeSignUpHandover()).toBeNull();
    expect(takeAuthEmailHint()).toBe("ada@example.com");
  });

  it("does not carry an earlier handover to a later email", () => {
    rememberAuthEmailHint("ada@example.com", { signUp: { codeSentAt: 1_000 } });
    rememberAuthEmailHint("bob@example.com");

    expect(takeSignUpHandover()).toBeNull();
    expect(takeAuthEmailHint()).toBe("bob@example.com");
  });

  it("drops the handover with the email the email step took", () => {
    rememberAuthEmailHint("ada@example.com", { signUp: { codeSentAt: 1_000 } });
    expect(takeAuthEmailHint()).toBe("ada@example.com");
    rememberAuthEmailHintOnClick(plainClick, "bob@example.com");

    expect(takeSignUpHandover()).toBeNull();
  });

  it("remembers nothing for a blank email", () => {
    rememberAuthEmailHint("stale@example.com");
    rememberAuthEmailHint("   ");

    expect(takeAuthEmailHint()).toBeNull();
  });

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
    rememberAuthEmailHint("stale@example.com");
    rememberAuthEmailHintOnClick(
      { ...plainClick, ...modifier },
      "ada@example.com",
    );

    expect(takeAuthEmailHint()).toBeNull();
  });

  it("does not remember an email for a cancelled click", () => {
    rememberAuthEmailHintOnClick(
      { ...plainClick, defaultPrevented: true },
      "ada@example.com",
    );
    expect(takeAuthEmailHint()).toBeNull();
  });

  it.each(["getItem", "setItem", "removeItem"] as const)(
    "stays quiet when storage %s throws",
    (operation) => {
      vi.spyOn(window.sessionStorage, operation).mockImplementation(() => {
        throw new Error("blocked");
      });
      expect(() => rememberAuthEmailHint("ada@example.com")).not.toThrow();
      expect(() => takeAuthEmailHint()).not.toThrow();
    },
  );

  it("stays quiet when session storage is unavailable", () => {
    // Safari in private mode and blocked site data throw on access.
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => rememberAuthEmailHint("ada@example.com")).not.toThrow();
    expect(takeAuthEmailHint()).toBeNull();
  });
});
