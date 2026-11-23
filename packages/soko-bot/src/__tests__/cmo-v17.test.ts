import { describe, expect, it } from "vitest";
import {
  CMO_MONTH_POINTS_SKILL,
  cmoMarksPoints,
  cmoRevisedWritingSkills,
  cmoTurnSkills,
} from "../versions/cmo-v17-skills.js";
import { composeSystemPrompt, getSokoBotVersion } from "../versions/index.js";
import { WRITING_SKILLS, writingSkillsBrief } from "../writing-skills/index.js";

describe("cmo-v17", () => {
  const v15 = getSokoBotVersion("cmo-v15");
  const v17 = getSokoBotVersion("cmo-v17");

  it("is cmo-v15 with the points skill, and not the default", () => {
    expect(v17.skills).toEqual([...v15.skills, CMO_MONTH_POINTS_SKILL]);
    expect(cmoMarksPoints(v17.skills)).toBe(true);
    expect(cmoMarksPoints(v15.skills)).toBe(false);
  });

  it("writes LinkedIn by its own skill and keeps every other network's", () => {
    const revised = cmoRevisedWritingSkills(v17.skills, WRITING_SKILLS);
    expect(revised.map((skill) => skill.id)).toEqual(["linkedin"]);
    expect(revised[0]!.audience).toBeTruthy();
    const brief = writingSkillsBrief(["linkedin", "x"], revised);
    expect(brief).toContain("Never cite the business's own site");
    expect(brief).toContain('<skill id="x">');
    expect(cmoRevisedWritingSkills(v15.skills, WRITING_SKILLS)).toEqual([]);
  });

  it("leaves the strategy and Brand Brain skills out of a production run only", () => {
    const run = "cmo:production:bot:1:1:0";
    expect(cmoTurnSkills(v17.skills, run)).not.toContain(
      "cmo-brand-brain-groups",
    );
    expect(cmoTurnSkills(v17.skills, "chat:1")).toEqual(v17.skills);
    expect(cmoTurnSkills(v15.skills, run)).toEqual(v15.skills);
    const full = composeSystemPrompt(v17);
    const production = composeSystemPrompt(v17, undefined, {
      clientTurnId: run,
    });
    expect(full.length - production.length).toBeGreaterThan(60_000);
  });
});
