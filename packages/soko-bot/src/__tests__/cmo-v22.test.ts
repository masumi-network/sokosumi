import { describe, expect, it } from "vitest";
import { cmoSaveStrategyInputSchema } from "../cmo.js";
import { marketingStrategyPlanSchema } from "../project-marketing.js";
import { cmoTurnSkills } from "../versions/cmo-v20-skills.js";
import { CMO_V21_STRATEGY_SKILL } from "../versions/cmo-v21-skills.js";
import {
  CMO_V22_STRATEGY_SKILL,
  cmoWritesExamplesOnly,
} from "../versions/cmo-v22-skills.js";
import { getSokoBotSkill, getSokoBotVersion } from "../versions/index.js";

describe("cmo-v22", () => {
  const v21 = getSokoBotVersion("cmo-v21");
  const v22 = getSokoBotVersion("cmo-v22");

  it("is cmo-v21 with example posts instead of the month's calendar", () => {
    expect(v22.systemPrompt).toBe(v21.systemPrompt);
    expect(v22.skills).toEqual(
      v21.skills.map((skill) =>
        skill === CMO_V21_STRATEGY_SKILL ? CMO_V22_STRATEGY_SKILL : skill,
      ),
    );
    expect(cmoWritesExamplesOnly(v22.skills)).toBe(true);
    expect(cmoWritesExamplesOnly(v21.skills)).toBe(false);
    expect(v22.whatsNew?.length).toBeGreaterThan(0);
  });

  // Owner, 2026-11-25: a strategy took 15 to 20 minutes before payment,
  // because Cuso wrote every post of the month into it.
  it("asks for 3 to 5 examples and leaves the month to Core", () => {
    const strategy = getSokoBotSkill(CMO_V22_STRATEGY_SKILL).content;
    expect(strategy).toContain("- calendar: only example posts, 3 to 5");
    expect(strategy).toContain(
      "Core writes the whole month from this strategy",
    );
    expect(strategy).not.toContain("every piece, day by day, for four weeks");
    expect(strategy).not.toContain("save week one with part calendar");
    expect(strategy).not.toContain("at least 16 pieces");
    // The pillars stay the month's backbone.
    expect(strategy).toContain("# Topics from the buyer's industry");
    expect(strategy).toContain(
      "Core writes every network's posts to these shares",
    );
  });

  it("leaves the strategy out of a production run", () => {
    expect(cmoTurnSkills(v22.skills, "cmo:production:bot:1")).not.toContain(
      CMO_V22_STRATEGY_SKILL,
    );
  });

  it("keeps Core's monthWriter out of what Cuso may save", () => {
    const parsed = cmoSaveStrategyInputSchema.parse({
      part: "plan",
      strategy: {
        summary: "Launch help first.",
        monthWriter: { state: "written", attempts: 1 },
      },
    });
    expect("monthWriter" in parsed.strategy).toBe(false);
    expect(
      marketingStrategyPlanSchema.shape.monthWriter.safeParse({
        state: "examples",
      }).success,
    ).toBe(true);
  });
});
