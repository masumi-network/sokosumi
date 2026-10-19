import { describe, expect, it } from "vitest";

import { sokoBotActingUserId } from "./acting-user";

describe("sokoBotActingUserId", () => {
  it("acts for the member who asked", () => {
    expect(
      sokoBotActingUserId({
        requestedByUserId: "teammate",
        sokoBot: { userId: "owner" },
      }),
    ).toBe("teammate");
  });

  it("acts for a personal bot's owner when the bot started on its own", () => {
    expect(
      sokoBotActingUserId({
        requestedByUserId: null,
        sokoBot: { userId: "owner" },
      }),
    ).toBe("owner");
  });
});
