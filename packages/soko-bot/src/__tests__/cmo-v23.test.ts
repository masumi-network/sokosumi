import { describe, expect, it } from "vitest";
import { SOKO_BOT_CMO_READ_CAPABILITIES } from "../policy.js";
import { cmoTurnSkills } from "../versions/cmo-v20-skills.js";
import {
  CMO_CONTEXT_ON_DEMAND_SKILL,
  cmoReadsOnDemand,
} from "../versions/cmo-v23-skills.js";
import {
  applyVersionCapabilities,
  getSokoBotSkill,
  getSokoBotVersion,
} from "../versions/index.js";

describe("cmo-v23", () => {
  const v22 = getSokoBotVersion("cmo-v22");
  const v23 = getSokoBotVersion("cmo-v23");

  it("is cmo-v22 with an organized context and its reads", () => {
    expect(v23.systemPrompt).toBe(v22.systemPrompt);
    expect(v23.skills).toEqual([...v22.skills, CMO_CONTEXT_ON_DEMAND_SKILL]);
    expect(cmoReadsOnDemand(v23.skills)).toBe(true);
    expect(cmoReadsOnDemand(v22.skills)).toBe(false);
    const tools = applyVersionCapabilities(v23, ["read_memory"]);
    for (const read of SOKO_BOT_CMO_READ_CAPABILITIES)
      expect(tools).toContain(read);
    expect(applyVersionCapabilities(v22, ["read_memory"])).not.toContain(
      "read_calendar",
    );
  });

  it("keeps the context skill on every turn, production included", () => {
    expect(cmoTurnSkills(v23.skills, "cmo:production:bot:1")).toContain(
      CMO_CONTEXT_ON_DEMAND_SKILL,
    );
  });

  it("tells Cuso to read before he answers, never to guess", () => {
    const skill = getSokoBotSkill(CMO_CONTEXT_ON_DEMAND_SKILL).content;
    expect(skill).toContain("Never guess what a piece says");
    expect(skill).toContain("read_calendar");
    expect(skill).toContain("save_strategy part pieces merges by id");
  });

  it("names what is new in words the owner reads", () => {
    expect(v23.whatsNew?.length).toBeGreaterThan(0);
  });
});
