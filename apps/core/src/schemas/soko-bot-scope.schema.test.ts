import { describe, expect, it } from "vitest";

import { sharedSokoBotSummarySchema } from "./soko-bot-scope.schema";

describe("sharedSokoBotSummarySchema", () => {
  it("keeps a shared bot's avatar code, so the roster can draw its look", () => {
    const code = "v1.owl.golden.peach.crimson.l.M.original.original.none.none";
    const parsed = sharedSokoBotSummarySchema.parse({
      id: "01960001-0001-7001-8001-00000000aaaa",
      name: "Team bot",
      scope: "workspace",
      projectId: null,
      avatarSeed: null,
      avatarImageUrl: "https://blob.test/owl.webp",
      avatarCode: code,
      status: "IDLE",
      archivedAt: null,
      sharedRoomId: null,
      viewerCanManage: true,
      cuso: false,
    });
    expect(parsed.avatarCode).toBe(code);
  });
});
