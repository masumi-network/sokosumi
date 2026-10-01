import { describe, expect, it } from "vitest";

import { sokoBotSourceLabel } from "./soko-bot-message-footer";

const meta = (soko_bot: Record<string, unknown>) => ({
  soko_bot: { turn_id: "turn-1", ...soko_bot },
});

describe("sokoBotSourceLabel", () => {
  it("names where an unprompted message came from", () => {
    expect(sokoBotSourceLabel(meta({ source: "INGEST" }))).toEqual({
      kind: "inbox",
    });
    expect(sokoBotSourceLabel(meta({ source: "EVENT" }))).toEqual({
      kind: "taskUpdate",
    });
    expect(
      sokoBotSourceLabel(meta({ source: "SCHEDULE", schedule_key: "standup" })),
    ).toEqual({ kind: "standup" });
    expect(
      sokoBotSourceLabel(
        meta({ source: "SCHEDULE", schedule_key: "weekly-wrap" }),
      ),
    ).toEqual({ kind: "weeklyWrap" });
    expect(
      sokoBotSourceLabel(
        meta({ source: "SCHEDULE", schedule_name: "Monday check-in" }),
      ),
    ).toEqual({ kind: "scheduled", name: "Monday check-in" });
  });

  it("labels nothing on replies or non-bot messages", () => {
    expect(sokoBotSourceLabel(meta({ source: "CHAT" }))).toBeNull();
    expect(sokoBotSourceLabel(meta({}))).toBeNull();
    expect(sokoBotSourceLabel({})).toBeNull();
    expect(sokoBotSourceLabel(null)).toBeNull();
  });
});
