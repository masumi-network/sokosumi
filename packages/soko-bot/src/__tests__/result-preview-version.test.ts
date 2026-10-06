import { describe, expect, it } from "vitest";
import { sokoBotPostChatInputSchema } from "../tool-contracts.js";
import {
  composeSystemPrompt,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
} from "../versions/index.js";

describe("result preview bot support", () => {
  it("adds a selectable version with result instructions without changing the default", () => {
    expect(getSokoBotVersion("v21").id).toBe("v21");
    expect(composeSystemPrompt(getSokoBotVersion("v21"))).toContain(
      "# Chat result previews",
    );
    expect(DEFAULT_SOKO_BOT_VERSION_ID).toBe("v19");
  });
  it("bounds explicit room attachments and preserves ordinary text posts", () => {
    expect(
      sokoBotPostChatInputSchema.safeParse({ roomId: "room", content: "Done" })
        .success,
    ).toBe(true);
    expect(
      sokoBotPostChatInputSchema.safeParse({
        roomId: "room",
        content: "Done",
        resultReferences: Array.from({ length: 7 }, () => ({
          kind: "task",
          id: "task",
        })),
      }).success,
    ).toBe(false);
  });
});
