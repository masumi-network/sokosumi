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
const skill = getSokoBotSkill("cmo-strategy-every-network")?.content ?? "";
const before = getSokoBotSkill("cmo-strategy-weekly")?.content ?? "";

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
        id === "cmo-strategy-patches" ? "cmo-strategy-every-network" : id,
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

  it("plans every live social network, with or without an account", () => {
    expect(skill).toContain(
      "every live social network in the menu is in the strategy, whether the business has an account there or not",
    );
    expect(skill).toContain("Never put a social network in proposals");
    expect(skill).toContain("leftOut");
    expect(skill).toContain(
      "they wait finished until the account is connected",
    );
    // The rule it replaces: networks without an account, two at most.
    expect(skill).not.toContain("at most two (LinkedIn");
    expect(skill).not.toContain("a network with no profile in the Brand Brain");
    expect(before).toContain("at most two (LinkedIn");
  });

  it("sends a talking video to every network that takes one, YouTube among them", () => {
    expect(skill).toContain(
      "list every other network in the strategy that takes a talking_video in its alsoOn",
    );
    expect(skill).toContain('it is in channels with the cadence "1 a week"');
  });

  it("keeps cmo-v3's pace per network, its roles and its week by week saves", () => {
    for (const kept of [
      "all_in: three a day on X and two a day on LinkedIn, Facebook and Instagram",
      "a side channel gets two or three a week whatever the pace",
      "save week one with part calendar, then each later week with part patch",
      "plan at most four a month",
    ])
      expect(skill).toContain(kept);
  });

  it("leaves a network out with its reason, on the saved strategy", () => {
    const saved = plan([]);
    expect(saved.leftOut).toEqual([]);
    expect(
      marketingStrategyPlanSchema.parse({
        ...saved,
        leftOut: [{ channel: "X", why: "Diners do not look for lunch on X." }],
      }).leftOut,
    ).toEqual([{ channel: "x", why: "Diners do not look for lunch on X." }]);
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
