import {
  applyVersionCapabilities,
  getSokoBotVersion,
} from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import { chooseTurnModel } from "@/lib/soko-bot/turn-model";
import {
  CMO_STRATEGY_BRIEF_MARK,
  cmoChangeKind,
  cmoStrategyBrief,
  cmoStrategyStepTurn,
  cmoStrategyStepTurnId,
} from "@/services/marketing-strategy.service";
import {
  cmoFitStrategy,
  cmoStrategyChangeBrief,
  cmoStrategyRepairPrompt,
  cmoStrategyStepSystem,
  withStrategyFix,
} from "./cmo-strategy-step";

const entry = (id: string, title: string) => ({
  id,
  date: "2026-11-27",
  channel: "linkedin",
  format: "post",
  status: "idea" as const,
  title,
});

describe("Core's strategy step", () => {
  it("merges a repair into a fresh strategy by field and by entry", () => {
    const merged = withStrategyFix(
      {
        summary: "Old summary",
        goals: ["More trials"],
        calendar: [
          entry("a", "First"),
          entry("b", "Second"),
          entry("c", "Third"),
        ],
      },
      {
        summary: "New summary",
        goals: [],
        calendar: [
          { ...entry("b", "Second, sharper") },
          { ...entry("c", "Third"), status: "skipped" },
          entry("d", "Fourth"),
        ],
      },
    );
    expect(merged.summary).toBe("New summary");
    // An empty list is filler, as in a save: the goals stay.
    expect(merged.goals).toEqual(["More trials"]);
    expect(merged.calendar?.map((item) => [item.id, item.title])).toEqual([
      ["a", "First"],
      ["b", "Second, sharper"],
      ["d", "Fourth"],
    ]);
  });

  it("names every problem in one repair message", () => {
    const prompt = cmoStrategyRepairPrompt(["one", "two"]);
    expect(prompt).toContain("these 2 problems");
    expect(prompt).toContain("- one\n- two");
  });

  it("writes from the version's strategy skill, the same for every Cuso", () => {
    const system = cmoStrategyStepSystem(getSokoBotVersion("cmo-v25"));
    expect(system).toContain("answer_strategy");
    expect(system).toContain("example posts");
    expect(system).not.toContain("# Core writes the strategy");
    expect(cmoStrategyStepSystem(getSokoBotVersion("cmo-v25"))).toBe(system);
  });

  it("asks a change to touch only what the owner named", () => {
    const brief = cmoStrategyChangeBrief("NMKR", "LinkedIn once a week");
    expect(brief).toContain("The owner asked: LinkedIn once a week");
    expect(brief).toContain("Leave out every field and entry you keep");
  });
});

describe("step turns", () => {
  const bot = "11111111-1111-4111-8111-111111111111";

  it("are plans or patches by their id, and only they are step turns", () => {
    const plan = cmoStrategyStepTurnId(bot, "plan", 1);
    const patch = cmoStrategyStepTurnId(bot, "patch", 1);
    expect(cmoStrategyStepTurn(plan)).toBe(true);
    expect(cmoChangeKind(plan)).toBeNull();
    expect(cmoStrategyStepTurn(patch)).toBe(true);
    expect(cmoChangeKind(patch)).toBe("patch");
    expect(cmoStrategyStepTurn(`cmo:strategy:${bot}:1`)).toBe(false);
  });

  it("carry the brief Core writes from after their mark", () => {
    const message = `Call write_strategy now.\n\n${CMO_STRATEGY_BRIEF_MARK}\nWrite NMKR's strategy.\nMore lines.`;
    expect(cmoStrategyBrief(message)).toBe(
      "Write NMKR's strategy.\nMore lines.",
    );
    expect(cmoStrategyBrief("Write NMKR's strategy.")).toBeNull();
  });

  it("run on the version's own model; the step writes on the strong one", () => {
    const input = {
      version: { model: "luna", strongModel: "sol" },
      preset: true,
      background: false,
      classification: { route: "MANAGE_WORK" as const },
      previous: null,
      now: new Date(),
    };
    expect(
      chooseTurnModel({
        ...input,
        clientTurnId: cmoStrategyStepTurnId(bot, "plan"),
      }).model,
    ).toBe("luna");
    expect(
      chooseTurnModel({ ...input, clientTurnId: `cmo:strategy:${bot}:1` })
        .model,
    ).toBe("sol");
  });

  it("are offered write_strategy on cmo-v25 only", () => {
    expect(
      applyVersionCapabilities(getSokoBotVersion("cmo-v25"), []),
    ).toContain("write_strategy");
    expect(
      applyVersionCapabilities(getSokoBotVersion("cmo-v23"), []),
    ).not.toContain("write_strategy");
  });
});

describe("fitting an answer to the save's schema", () => {
  it("cuts a list past its limit in code and keeps the rest", () => {
    const { strategy, issues } = cmoFitStrategy({
      summary: "Sell NMKR Studio to founders",
      campaigns: [
        {
          id: "launch",
          name: "Launch",
          message: "Mint without code",
          start: "2026-11-27",
          end: "2026-12-24",
          metric: "Studio projects",
          channels: ["x", "linkedin", "instagram", "tiktok", "youtube"],
        },
      ],
    });
    expect(issues).toEqual([]);
    expect(strategy.campaigns?.[0]?.channels).toHaveLength(4);
    expect(strategy.summary).toBe("Sell NMKR Studio to founders");
  });

  it("leaves to the repair what cutting cannot fix", () => {
    const { issues } = cmoFitStrategy({ calendar: [{ id: "a" }] });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toMatch(/^calendar\.0\./);
  });
});
