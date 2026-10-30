import { describe, expect, it } from "vitest";

import {
  sokoBotActingUserId,
  sokoBotScheduleActingUserId,
} from "./acting-user";

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

describe("sokoBotScheduleActingUserId", () => {
  const shared = { userId: null };

  it("runs a shared bot's rhythm for nobody, whoever created the row", () => {
    expect(
      sokoBotScheduleActingUserId({
        requestedByUserId: "member",
        systemKey: "standup",
        sokoBot: shared,
      }),
    ).toBeNull();
  });

  it("runs Cuso's own rhythms as the member who hired him", () => {
    expect(
      sokoBotScheduleActingUserId({
        requestedByUserId: "hirer",
        systemKey: "cmo-daily-run",
        sokoBot: shared,
      }),
    ).toBe("hirer");
  });

  it("runs a schedule a member wrote on Cuso for nobody", () => {
    expect(
      sokoBotScheduleActingUserId({
        requestedByUserId: "member",
        systemKey: null,
        sokoBot: shared,
      }),
    ).toBeNull();
  });
});
