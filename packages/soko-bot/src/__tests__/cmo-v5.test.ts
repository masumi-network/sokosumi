import { describe, expect, it } from "vitest";
import {
  CMO_AIDA_STAGES,
  marketingStrategyPlanSchema,
} from "../project-marketing.js";
import {
  CMO_SOKO_BOT_VERSION_ID,
  CMO_SOKO_BOT_VERSION_IDS,
  getSokoBotSkill,
  getSokoBotVersion,
} from "../versions/index.js";

const v4 = getSokoBotVersion("cmo-v4");
const v5 = getSokoBotVersion("cmo-v5");
const skill = getSokoBotSkill("cmo-strategy-aida")?.content ?? "";
const before = getSokoBotSkill("cmo-strategy-patches")?.content ?? "";

const plan = (funnel: object[]) =>
  marketingStrategyPlanSchema.parse({
    month: "2026-10",
    summary: "Grow LinkedIn reach with founder-led posts.",
    goals: ["More demo requests"],
    pillars: ["Product stories"],
    channels: [{ channel: "LinkedIn", cadence: "3 posts a week" }],
    calendar: [],
    funnel,
  });

const stage = (stage: string, extra: object = {}) => ({
  stage,
  goal: "Teams see a launch story",
  metric: "Profile visits",
  ...extra,
});

describe("cmo-v5", () => {
  it("is the version a new hire gets, and cmo-v4 in everything but its strategy skill", () => {
    expect(CMO_SOKO_BOT_VERSION_ID).toBe("cmo-v5");
    expect(CMO_SOKO_BOT_VERSION_IDS).toContain("cmo-v4");
    expect(v5.systemPrompt).toBe(v4.systemPrompt);
    expect(v5.capabilities).toEqual(v4.capabilities);
    expect(v5.model).toBe(v4.model);
    expect(v5.skills).toEqual(
      v4.skills.map((id) =>
        id === "cmo-strategy-patches" ? "cmo-strategy-aida" : id,
      ),
    );
  });

  it("asks for the funnel in AIDA's four stages, with Cuso's part and the owner's", () => {
    expect(CMO_AIDA_STAGES).toEqual([
      "awareness",
      "interest",
      "desire",
      "action",
    ]);
    expect(skill).toContain("always all four and in this order");
    for (const name of CMO_AIDA_STAGES) expect(skill).toContain(`${name} (`);
    expect(skill).toContain("cusoDoes");
    expect(skill).toContain("youDo");
    // The stages and the own names Cuso wrote before are gone from his skill.
    expect(skill).not.toMatch(/consideration|conversion and|loyalty/);
    expect(skill).not.toContain("name in the buyer's words");
    expect(before).toContain("name in the buyer's words");
  });

  it("changes nothing else in the strategy skill", () => {
    const funnel = (text: string) => {
      const from = text.indexOf("- funnel: the heart of the strategy");
      return [text.slice(0, from), text.slice(text.indexOf("  - owner: cuso"))];
    };
    expect(funnel(skill)).toEqual(funnel(before));
  });

  it("saves a stage with what Cuso does and what the owner does, without a name", () => {
    const { funnel } = plan(
      CMO_AIDA_STAGES.map((name) =>
        stage(name, {
          cusoDoes: "I post a launch story a day on LinkedIn.",
          youDo: "You answer demo requests within a day.",
        }),
      ),
    );
    expect(funnel.map((item) => item.stage)).toEqual(CMO_AIDA_STAGES);
    expect(funnel[0]).toMatchObject({
      cusoDoes: "I post a launch story a day on LinkedIn.",
      youDo: "You answer demo requests within a day.",
    });
    expect(funnel[0]?.name).toBeUndefined();
  });

  it("still reads a funnel saved before cmo-v5", () => {
    const { funnel } = plan([
      stage("awareness", { name: "Hear about us" }),
      stage("consideration", { name: "Look closer" }),
      stage("conversion", { name: "Start a trial" }),
      stage("loyalty", { name: "Come back" }),
    ]);
    expect(funnel.map((item) => item.name)).toEqual([
      "Hear about us",
      "Look closer",
      "Start a trial",
      "Come back",
    ]);
  });
});
