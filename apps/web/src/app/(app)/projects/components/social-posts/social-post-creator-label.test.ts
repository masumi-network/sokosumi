import { describe, expect, it } from "vitest";
import { socialPostCreatorLabel } from "./social-post-creator-label";

describe("socialPostCreatorLabel", () => {
  it("shows only the name for a named user", () => {
    expect(
      socialPostCreatorLabel(
        { kind: "user", id: "user-1", name: "Alice" },
        "User",
      ),
    ).toBe("Alice");
  });

  it("falls back to the kind when a user has no name", () => {
    expect(
      socialPostCreatorLabel(
        { kind: "user", id: "user-1", name: null },
        "User",
      ),
    ).toBe("User");
  });

  it("keeps the kind prefix for a named coworker", () => {
    expect(
      socialPostCreatorLabel(
        { kind: "coworker", id: "coworker-1", name: "Scout" },
        "Coworker",
      ),
    ).toBe("Coworker · Scout");
  });

  it("shows only the kind when a coworker has no name", () => {
    expect(
      socialPostCreatorLabel(
        { kind: "coworker", id: "coworker-1", name: null },
        "Coworker",
      ),
    ).toBe("Coworker");
  });

  it("shows only the kind when Soko Bot has no name", () => {
    expect(
      socialPostCreatorLabel(
        { kind: "sokoBot", id: "bot-1", name: null },
        "Soko Bot",
      ),
    ).toBe("Soko Bot");
  });
});
