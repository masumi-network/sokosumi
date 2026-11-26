import { describe, expect, it } from "vitest";
import {
  CMO_SHORT_FORM_TOOLS,
  CMO_TOOL_HIGHLIGHTS_SKILL,
  cmoHighlightsTools,
  cmoShortFormAnswer,
  cmoShortFormInputSchema,
  isCmoShortFormCall,
} from "../versions/cmo-v24-skills.js";
import { getSokoBotVersion } from "../versions/index.js";

describe("cmo-v24", () => {
  const v23 = getSokoBotVersion("cmo-v23");
  const v24 = getSokoBotVersion("cmo-v24");

  it("is cmo-v23 with tool highlights", () => {
    expect(v24.systemPrompt).toBe(v23.systemPrompt);
    expect(v24.skills).toEqual([...v23.skills, CMO_TOOL_HIGHLIGHTS_SKILL]);
    expect(cmoHighlightsTools(v24.skills)).toBe(true);
    expect(cmoHighlightsTools(v23.skills)).toBe(false);
  });

  it("tells a short-form call from a full one", () => {
    expect(
      isCmoShortFormCall("save_strategy", { shortForm: true, what: "x" }),
    ).toBe(true);
    expect(isCmoShortFormCall("save_strategy", { part: "pieces" })).toBe(false);
    expect(isCmoShortFormCall("report_update", { shortForm: true })).toBe(
      false,
    );
    expect(CMO_SHORT_FORM_TOOLS).toEqual(["save_strategy", "save_brand_brain"]);
  });

  it("keeps the short form small and says nothing was saved", () => {
    expect(
      cmoShortFormInputSchema.safeParse({
        shortForm: true,
        what: "move a post",
      }).success,
    ).toBe(true);
    expect(cmoShortFormAnswer("save_brand_brain")).toMatchObject({
      saved: false,
      next: expect.stringContaining("call it again with the whole input"),
    });
  });
});
