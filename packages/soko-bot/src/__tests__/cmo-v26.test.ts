import { describe, expect, it } from "vitest";
import {
  CMO_PLAYBOOKS_SKILL,
  cmoReadsPlaybooks,
  cmoWritingSkills,
} from "../versions/cmo-playbooks-skill.js";
import {
  CMO_STRATEGY_STEP_SKILL,
  cmoWritesStrategyStep,
} from "../versions/cmo-v25-skills.js";
import {
  CMO_COMPACT_PRODUCTION_SKILL,
  cmoCompactProduction,
} from "../versions/cmo-v26-skills.js";
import {
  CMO_VIDEO_SHAPES_SKILL,
  cmoPostsVideoShapes,
} from "../versions/cmo-video-shapes-skill.js";
import {
  applyVersionCapabilities,
  composeSystemPrompt,
  composeTurnPreamble,
  getSokoBotSkill,
  getSokoBotVersion,
} from "../versions/index.js";

describe("cmo-v26", () => {
  const v24 = getSokoBotVersion("cmo-v24");
  const v26 = getSokoBotVersion("cmo-v26");

  it("is cmo-v24 with cmo-v25's strategy step and a small-context production run", () => {
    expect(v26.systemPrompt).toBe(v24.systemPrompt);
    expect(v26.skills).toEqual([
      ...v24.skills,
      CMO_STRATEGY_STEP_SKILL,
      CMO_PLAYBOOKS_SKILL,
      CMO_COMPACT_PRODUCTION_SKILL,
      CMO_VIDEO_SHAPES_SKILL,
    ]);
    expect(cmoPostsVideoShapes(v26.skills)).toBe(true);
    expect(cmoPostsVideoShapes(v24.skills)).toBe(false);
    expect(cmoReadsPlaybooks(v26.skills)).toBe(true);
    expect(
      cmoWritingSkills(v26.skills).some((s) => s.group === "playbooks"),
    ).toBe(true);
    expect(cmoWritesStrategyStep(v26.skills)).toBe(true);
    expect(applyVersionCapabilities(v26, [])).toContain("write_strategy");
    expect(composeSystemPrompt(v26)).toContain(
      getSokoBotSkill(CMO_STRATEGY_STEP_SKILL).content.trim(),
    );
    expect(getSokoBotSkill(CMO_STRATEGY_STEP_SKILL).content).toMatch(
      /only once the owner has said what to change[^\n]*ask one question/,
    );
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
