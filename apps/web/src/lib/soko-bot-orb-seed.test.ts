import { describe, expect, it } from "vitest";

import { defaultOrbSeed } from "@/lib/aurora-orb";
import { defaultSokoBotOrbSeed } from "@/lib/soko-bot-orb-seed";

describe("defaultSokoBotOrbSeed", () => {
  it("seeds a personal bot from its owner", () => {
    expect(
      defaultSokoBotOrbSeed({ id: "bot_1", owner: { id: "user_1" } }),
    ).toBe(defaultOrbSeed("user_1"));
  });

  it("seeds a shared bot from its own id", () => {
    expect(defaultSokoBotOrbSeed({ id: "bot_1", owner: null })).toBe(
      defaultOrbSeed("bot_1"),
    );
  });
});
