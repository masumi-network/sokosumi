import { describe, expect, it } from "vitest";

import { activeOwnedSokoBotWhere } from "./soko-bot-owned-bot-where";

describe("activeOwnedSokoBotWhere", () => {
  it("keys the bot on its id and owner and excludes archived and paused bots", () => {
    expect(activeOwnedSokoBotWhere("bot-1", "user-1")).toEqual({
      id: "bot-1",
      userId: "user-1",
      archivedAt: null,
      status: { not: "PAUSED" },
    });
  });
});
