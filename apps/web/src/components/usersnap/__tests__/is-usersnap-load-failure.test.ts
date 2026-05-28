import { describe, expect, it } from "vitest";

import { isUsersnapLoadFailure } from "../is-usersnap-load-failure";

describe("isUsersnapLoadFailure", () => {
  it("returns true for Usersnap string rejections", () => {
    expect(
      isUsersnapLoadFailure(
        "Failed to load the widget: Wrong API key or paused project",
      ),
    ).toBe(true);
  });

  it("returns true for Error instances with the Usersnap message", () => {
    expect(
      isUsersnapLoadFailure(
        new Error("Failed to load the widget: Wrong API key or paused project"),
      ),
    ).toBe(true);
  });

  it("returns false for unrelated rejections", () => {
    expect(isUsersnapLoadFailure("Network request failed")).toBe(false);
    expect(isUsersnapLoadFailure(new Error("Network request failed"))).toBe(
      false,
    );
    expect(isUsersnapLoadFailure(null)).toBe(false);
  });
});
