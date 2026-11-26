import { describe, expect, it } from "vitest";
import {
  CMO_COMPACT_PRODUCTION_SKILL,
  cmoCompactProduction,
} from "../versions/cmo-v26-skills.js";
import {
  composeTurnPreamble,
  getSokoBotSkill,
  getSokoBotVersion,
} from "../versions/index.js";

describe("cmo-v26", () => {
  const v24 = getSokoBotVersion("cmo-v24");
  const v26 = getSokoBotVersion("cmo-v26");

  it("is cmo-v24 with a small-context production run", () => {
    expect(v26.systemPrompt).toBe(v24.systemPrompt);
    expect(v26.skills).toEqual([...v24.skills, CMO_COMPACT_PRODUCTION_SKILL]);
    expect(v26.skillsOnDemand).toBe(true);
    expect(cmoCompactProduction(v26.skills)).toBe(true);
    expect(cmoCompactProduction(v24.skills)).toBe(false);
  });

  it("preloads the small-context skill on production runs only", () => {
    const skill = getSokoBotSkill(CMO_COMPACT_PRODUCTION_SKILL).content.trim();
    const turn = (occasions: string[]) => ({ clientTurnId: null, occasions });
    expect(composeTurnPreamble(v26, undefined, turn(["production"]))).toContain(
      skill,
    );
    expect(composeTurnPreamble(v26, undefined, turn(["chat"]))).not.toContain(
      skill,
    );
  });
});
