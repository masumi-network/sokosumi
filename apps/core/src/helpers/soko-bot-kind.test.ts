import { describe, expect, it } from "vitest";

import {
  isPersonalSokoBot,
  isSharedSokoBot,
  sharedSokoBotScopeKind,
} from "./soko-bot-kind";

describe("isPersonalSokoBot", () => {
  it("is true only for a bot with an owner", () => {
    expect(isPersonalSokoBot({ userId: "owner" })).toBe(true);
    expect(isPersonalSokoBot({ userId: null })).toBe(false);
  });
});

describe("isSharedSokoBot", () => {
  it("is true only for a bot without an owner", () => {
    expect(isSharedSokoBot({ userId: null })).toBe(true);
    expect(isSharedSokoBot({ userId: "owner" })).toBe(false);
  });
});

describe("sharedSokoBotScopeKind", () => {
  it("names a bot with a Project a project bot", () => {
    expect(sharedSokoBotScopeKind("project_1")).toBe("project");
  });

  it("names a bot without a Project a workspace bot", () => {
    expect(sharedSokoBotScopeKind(null)).toBe("workspace");
  });
});
