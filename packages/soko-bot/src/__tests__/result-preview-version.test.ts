import { describe, expect, it } from "vitest";
import { limitSokoBotWrites, SOKO_BOT_ROUTE_CAPABILITIES } from "../policy.js";
import { sokoBotPreviewResultInputSchema } from "../result-previews.js";
import { sokoBotPostChatInputSchema } from "../tool-contracts.js";
import {
  applyVersionCapabilities,
  composeSystemPrompt,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
} from "../versions/index.js";

describe("result preview bot support", () => {
  it("keeps v21 result instructions selectable without enabling them in the current default", () => {
    expect(getSokoBotVersion("v21").id).toBe("v21");
    expect(composeSystemPrompt(getSokoBotVersion("v21"))).toContain(
      "# Chat result previews",
    );
    expect(DEFAULT_SOKO_BOT_VERSION_ID).toBe("v22");
    expect(
      composeSystemPrompt(getSokoBotVersion(DEFAULT_SOKO_BOT_VERSION_ID)),
    ).not.toContain("# Chat result previews");
  });
  it("keeps preview preparation available across owner routes and narrowed write scopes", () => {
    const version = getSokoBotVersion("v21");
    for (const capabilities of Object.values(SOKO_BOT_ROUTE_CAPABILITIES)) {
      const narrowed = limitSokoBotWrites(capabilities, []);
      expect(applyVersionCapabilities(version, narrowed)).toContain(
        "preview_result",
      );
      expect(narrowed).not.toContain("create_task");
      expect(narrowed).not.toContain("schedule_social_post");
      expect(narrowed).not.toContain("generate_image");
    }
  });
  it("provides valid preview tool calls for task, post, generation and reminder completions", () => {
    const prompt = composeSystemPrompt(getSokoBotVersion("v21"));
    const calls = [...prompt.matchAll(/preview_result\((\{[^\n]+?\})\)/g)];
    const references = calls.map(
      ([, input]) =>
        sokoBotPreviewResultInputSchema.parse(JSON.parse(input)).reference,
    );
    expect(references.map((reference) => reference.kind)).toEqual([
      "task",
      "social_post",
      "studio_job",
      "bot_schedule",
    ]);
  });
  it("accepts bounded real project choices and rejects model-authored labels", () => {
    const reference = { kind: "project_selection", projectIds: ["project-1"] };
    expect(
      sokoBotPreviewResultInputSchema.safeParse({ reference }).success,
    ).toBe(true);
    expect(
      sokoBotPreviewResultInputSchema.safeParse({
        reference: { ...reference, projectIds: [] },
      }).success,
    ).toBe(false);
    expect(
      sokoBotPreviewResultInputSchema.safeParse({
        reference: {
          ...reference,
          projectIds: Array.from({ length: 13 }, (_, i) => `project-${i}`),
        },
      }).success,
    ).toBe(false);
    expect(
      sokoBotPreviewResultInputSchema.safeParse({
        reference: { ...reference, options: [{ name: "Invented" }] },
      }).success,
    ).toBe(false);
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
