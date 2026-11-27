import { describe, expect, it } from "vitest";
import {
  applyVersionCapabilities,
  composeSystemPrompt,
  composeTurnPreamble,
  getSokoBotSkill,
  getSokoBotVersion,
  SOKO_BOT_VERSIONS,
} from "../versions/index.js";
import { SKILL_INDEX, splitSkillsForTurn } from "../versions/skill-index.js";

const v23 = getSokoBotVersion("cmo-v23");
const v24 = getSokoBotVersion("cmo-v24");
const strategy = getSokoBotSkill("cmo-strategy-v22").content.trim();
const brand = getSokoBotSkill("cmo-brand-brain-groups").content.trim();
const production = getSokoBotSkill("cmo-production-picked").content.trim();

function turn(occasions: string[]) {
  return { clientTurnId: null, occasions };
}
const persona = { name: "Nova" } as never;
function carried(occasions: string[]): string {
  return [
    composeSystemPrompt(v24, persona, turn(occasions)),
    composeTurnPreamble(v24, persona, turn(occasions)),
  ].join("\n");
}

describe("skill index", () => {
  it("has a use-when line for every skill of current and on-demand versions", () => {
    const current = ["cmo-v23", "v34", "v36"].map(getSokoBotVersion);
    const onDemand = SOKO_BOT_VERSIONS.filter(
      (version) => version.skillsOnDemand,
    );
    for (const version of [...current, ...onDemand])
      for (const id of version.skills)
        expect(SKILL_INDEX[id]?.useWhen, id).toBeTruthy();
  });

  it("keeps the system prompt the same for every bot and kind of turn", () => {
    const system = composeSystemPrompt(v24, persona, turn(["strategy"]));
    expect(composeSystemPrompt(v24, undefined, turn(["chat"]))).toBe(system);
    expect(system).not.toContain("Nova");
    expect(system).not.toContain(strategy);
    expect(system).toContain("- cmo-strategy-v22 (");
    expect(system).toContain(
      getSokoBotSkill("cmo-context-on-demand").content.trim(),
    );
    expect(system).toContain("call read_skill with the same id");
    expect(system.length).toBeLessThan(composeSystemPrompt(v23).length / 3);
  });

  it("gives a chat turn no skill in its first message", () => {
    const preamble = composeTurnPreamble(v24, persona, turn(["chat"]));
    expect(preamble).not.toContain("# Skills for this turn");
    expect(preamble).toContain("Nova");
  });

  it("preloads what each kind of turn always needs", () => {
    const planning = composeTurnPreamble(v24, persona, turn(["strategy"]));
    expect(planning).toContain(strategy);
    expect(planning).toContain(brand);
    expect(planning.indexOf(strategy)).toBeLessThan(planning.indexOf("Nova"));
    expect(carried(["production"])).toContain(production);
    expect(carried(["production"])).not.toContain(strategy);
    expect(carried(["daily"])).toContain(
      getSokoBotSkill("cmo-daily-watch").content.trim(),
    );
    expect(carried(["quiet", "onboarding"])).toContain(brand);
  });

  it("splits a Soko Bot's skills by route", () => {
    const v36 = getSokoBotVersion("v36");
    expect(splitSkillsForTurn(v36, ["DIRECT_RESPONSE"]).preloaded).toEqual([
      "result-cards-messaging",
    ]);
    expect(splitSkillsForTurn(v36, ["DELEGATE_TASK"]).preloaded).toEqual([
      "result-cards-messaging",
      "coworkers-and-agents-messaging",
      "taskboard",
      "conversations-handoffs",
    ]);
  });

  it("leaves versions without the flag as they were", () => {
    expect(composeSystemPrompt(v23)).not.toContain("# Your skills");
    expect(composeSystemPrompt(v23)).toContain(strategy);
    expect(composeSystemPrompt(v23, persona)).toContain("Nova");
    expect(composeTurnPreamble(v23, persona)).toBe("");
  });

  it("offers read_skill in place of read_writing_skill", () => {
    const v24Tools = applyVersionCapabilities(v24, []);
    expect(v24Tools).toContain("read_skill");
    expect(v24Tools).not.toContain("read_writing_skill");
    const v23Tools = applyVersionCapabilities(v23, ["read_skill"]);
    expect(v23Tools).toContain("read_writing_skill");
    expect(v23Tools).not.toContain("read_skill");
  });
});
