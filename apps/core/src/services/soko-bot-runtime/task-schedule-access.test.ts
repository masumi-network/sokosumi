import { describe, expect, it } from "vitest";
import type { AuthorizedSokoBotRuntime } from "../soko-bot-runtime.service";
import { taskScheduleAccess } from "./task-schedule-access";

function turn(
  overrides: { source?: string; askedByKind?: string; shared?: boolean } = {},
) {
  return {
    turn: {
      sokoBotId: "joseph",
      actingUserId: "patrick",
      versionId: "v36",
      source: overrides.source ?? "CHAT",
      chainDepth: 0,
    },
    askedByKind: overrides.askedByKind ?? "OWNER",
    reader: { sharedScope: overrides.shared ? { kind: "workspace" } : null },
  } as unknown as AuthorizedSokoBotRuntime;
}

const byOwner = { creatorUserId: "patrick", creatorSokoBotId: null };
const byBot = { creatorUserId: null, creatorSokoBotId: "joseph" };
const byJami = { creatorUserId: "jami", creatorSokoBotId: null };

describe("taskScheduleAccess", () => {
  it("lets the bot change the owner's and its own without asking", () => {
    for (const schedule of [byOwner, byBot])
      expect(taskScheduleAccess(turn(), schedule, true)).toEqual({
        youCanChange: true,
        askOwnerFirst: false,
      });
  });

  it("asks before someone else's, and acts only on the owner's own chat", () => {
    expect(taskScheduleAccess(turn(), byJami, true)).toEqual({
      youCanChange: true,
      askOwnerFirst: true,
    });
    expect(
      taskScheduleAccess(turn({ source: "SCHEDULE" }), byJami, true),
    ).toEqual({ youCanChange: false, askOwnerFirst: true });
  });

  it("follows the owner's own right, and never on a teammate's turn or a shared bot", () => {
    expect(taskScheduleAccess(turn(), byOwner, false).youCanChange).toBe(false);
    expect(
      taskScheduleAccess(turn({ askedByKind: "TEAMMATE" }), byOwner, true)
        .youCanChange,
    ).toBe(false);
    expect(
      taskScheduleAccess(turn({ shared: true }), byOwner, true).youCanChange,
    ).toBe(false);
  });
});
