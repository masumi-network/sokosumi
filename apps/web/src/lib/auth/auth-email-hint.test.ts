import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  rememberAuthEmailHint,
  rememberAuthEmailHintOnClick,
  takeAuthEmailHint,
  takeAuthEmailHintEntry,
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

  it("hands over that sign-in found no account for the email", () => {
    rememberAuthEmailHint("ada@example.com", { noAccount: true });

    expect(takeAuthEmailHintEntry()).toEqual({
      email: "ada@example.com",
      noAccount: true,
    });
    expect(takeAuthEmailHintEntry()).toBeNull();
  });

  it("does not carry an earlier no-account finding to a later email", () => {
    rememberAuthEmailHint("ada@example.com", { noAccount: true });
    rememberAuthEmailHint("bob@example.com");

    expect(takeAuthEmailHintEntry()).toEqual({
      email: "bob@example.com",
      noAccount: false,
    });
  });

  it("drops the no-account finding with the email it belongs to", () => {
    rememberAuthEmailHint("ada@example.com", { noAccount: true });
    expect(takeAuthEmailHint()).toBe("ada@example.com");
    rememberAuthEmailHintOnClick(plainClick, "bob@example.com");

    expect(takeAuthEmailHintEntry()).toEqual({
      email: "bob@example.com",
      noAccount: false,
    });
  });

  it("remembers the no-account finding for a plain click", () => {
    rememberAuthEmailHintOnClick(plainClick, "ada@example.com", {
      noAccount: true,
    });

    expect(takeAuthEmailHintEntry()).toEqual({
      email: "ada@example.com",
      noAccount: true,
    });
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
