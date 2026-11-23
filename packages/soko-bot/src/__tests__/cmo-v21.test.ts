import { describe, expect, it } from "vitest";
import {
  CMO_V20_STRATEGY_SKILL,
  cmoTurnSkills,
} from "../versions/cmo-v20-skills.js";
import {
  CMO_INDUSTRY_SKILL,
  CMO_V21_STRATEGY_SKILL,
  cmoReadsIndustry,
} from "../versions/cmo-v21-skills.js";
import { getSokoBotSkill, getSokoBotVersion } from "../versions/index.js";

describe("cmo-v21", () => {
  const v20 = getSokoBotVersion("cmo-v20");
  const v21 = getSokoBotVersion("cmo-v21");

  it("is cmo-v20 with industry topics and the industry research", () => {
    expect(v21.systemPrompt).toBe(v20.systemPrompt);
    expect(v21.skills).toEqual([
      ...v20.skills.map((skill) =>
        skill === CMO_V20_STRATEGY_SKILL ? CMO_V21_STRATEGY_SKILL : skill,
      ),
      CMO_INDUSTRY_SKILL,
    ]);
    expect(cmoReadsIndustry(v21.skills)).toBe(true);
    expect(cmoReadsIndustry(v20.skills)).toBe(false);
  });

  // Owner, 2026-11-23: NMKR's cmo-v20 pillars were NMKR Studio's workflow
  // steps, so every helpful tip was a product tutorial.
  it("builds pillars from the buyer's industry, never product steps", () => {
    const strategy = getSokoBotSkill(CMO_V21_STRATEGY_SKILL).content;
    expect(strategy).toContain("# Every step on every network");
    expect(strategy).not.toContain("# Pillars rest on facts");
    expect(strategy).toContain("# Topics from the buyer's industry");
    expect(strategy).toContain(
      "- pillars: the content pillars, 3 or 4 topics from the buyer's industry",
    );
    expect(strategy).toContain("about 60 educational");
    expect(strategy).toContain("Never invent a market number");
  });

  it("leaves the strategy out of a production run", () => {
    expect(cmoTurnSkills(v21.skills, "cmo:production:bot:1")).not.toContain(
      CMO_V21_STRATEGY_SKILL,
    );
    expect(cmoTurnSkills(v21.skills, "cmo:production:bot:1")).toContain(
      CMO_INDUSTRY_SKILL,
    );
  });
});
