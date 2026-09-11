import { describe, expect, it } from "vitest";

import { sokoBotDisplayName } from "./soko-bot-display-name";

describe("sokoBotDisplayName", () => {
  it("uses the name the bot was given", () => {
    expect(sokoBotDisplayName({ name: "Eve" })).toBe("Eve");
  });

  it("trims a padded name", () => {
    expect(sokoBotDisplayName({ name: "  Eve  " })).toBe("Eve");
  });

  it("falls back for a bot nobody named", () => {
    expect(sokoBotDisplayName({ name: null })).toBe("Soko Bot");
    expect(sokoBotDisplayName({ name: "   " })).toBe("Soko Bot");
  });
});
