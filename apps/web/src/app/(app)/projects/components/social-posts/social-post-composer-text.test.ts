import { describe, expect, it } from "vitest";
import {
  type SocialPostComposerText,
  socialPostTextFor,
  socialPostTextWrite,
} from "./social-post-composer-text";

const empty: SocialPostComposerText = {
  shared: "",
  byConnectionId: {},
  lastSharedEditId: null,
};

describe("socialPostTextFor", () => {
  it("returns the shared text until an account has its own", () => {
    expect(
      socialPostTextFor("x", { shared: "Hello", byConnectionId: {} }),
    ).toBe("Hello");
    expect(
      socialPostTextFor("li", {
        shared: "Hello",
        byConnectionId: { li: "Hello longer" },
      }),
    ).toBe("Hello longer");
    expect(
      socialPostTextFor("x", {
        shared: "Hello",
        byConnectionId: { li: "Hello longer" },
      }),
    ).toBe("Hello");
  });

  it("keeps an empty override", () => {
    expect(
      socialPostTextFor("x", { shared: "Hello", byConnectionId: { x: "" } }),
    ).toBe("");
  });
});

describe("socialPostTextWrite", () => {
  it("keeps one shared text while editing the same account", () => {
    const first = socialPostTextWrite("x", "Hello", empty, true);
    const next = socialPostTextWrite("x", "Hello both", first, true);
    expect(next.shared).toBe("Hello both");
    expect(next.byConnectionId).toEqual({});
    expect(next.lastSharedEditId).toBe("x");
    expect(socialPostTextFor("li", next)).toBe("Hello both");
  });

  it("forks the next account after the reader switches", () => {
    const shared = socialPostTextWrite("x", "Short for X", empty, true);
    const forked = socialPostTextWrite(
      "li",
      "Longer for LinkedIn",
      shared,
      true,
    );
    expect(socialPostTextFor("x", forked)).toBe("Short for X");
    expect(socialPostTextFor("li", forked)).toBe("Longer for LinkedIn");
  });

  it("writes back to shared when only one account is left", () => {
    const forked = socialPostTextWrite(
      "x",
      "Only X",
      {
        shared: "Hello",
        byConnectionId: { x: "Custom" },
        lastSharedEditId: "x",
      },
      false,
    );
    expect(forked.shared).toBe("Only X");
    expect(forked.byConnectionId).toEqual({});
  });
});
