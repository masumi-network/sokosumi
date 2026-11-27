import {
  applyVersionCapabilities,
  getSokoBotVersion,
  type MarketingStrategyPlan,
} from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import { chooseTurnModel } from "@/lib/soko-bot/turn-model";
import { toolEndedTurn } from "@/lib/soko-bot/turn-parts";
import {
  CMO_STRATEGY_BRIEF_MARK,
  cmoChangeKind,
  cmoStrategyBrief,
  cmoStrategyStepTurn,
  cmoStrategyStepTurnId,
  withMarketingFiles,
} from "@/services/marketing-strategy.service";
import {
  type CmoStepAnswer,
  cmoChangeCalendar,
  cmoFitStrategy,
  cmoRepairLoop,
  cmoSaveAnswer,
  cmoStepChange,
  cmoStepDecision,
  cmoStrategyChangeBrief,
  cmoStrategyRepairPrompt,
  cmoStrategyStepAnswer,
  cmoStrategyStepSystem,
  refusalProblems,
  type SaveOutcome,
  type StrategyAnswer,
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

  it("keeps a skipped entry in a patch, where it drops a saved one", () => {
    const merged = withStrategyFix(
      {},
      { calendar: [{ ...entry("c", "Third"), status: "skipped" }] },
      true,
    );
    expect(merged.calendar?.map((item) => item.status)).toEqual(["skipped"]);
  });

  it("tells a second repair what is left or came with the fix", () => {
    expect(cmoStrategyRepairPrompt(["one"], 2)).toContain(
      "left or came with the fix",
    );
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

  it("lists the calendar as the owner sees it, under the ids a patch names (Codex round 15)", () => {
    // An approved month: the Feb Reel was renamed on its post, and the owner
    // added a post outside the plan.
    const plan = [
      { ...entry("ig-feb-2", "Routing in 20 seconds"), date: "2027-02-02" },
      entry("li-1", "One link for the team"),
    ];
    const posts = [
      {
        entryId: "ig-feb-2",
        entry: {
          ...entry("post-111", "Round-robin in 20 seconds"),
          date: "2027-02-03",
          channel: "instagram",
          format: "reel",
          status: "scheduled" as const,
          socialPostId: "post-111",
        },
      },
      {
        entryId: null,
        entry: {
          ...entry("post-222", "Our booking page, live"),
          channel: "x",
          status: "draft" as const,
        },
      },
    ];
    const calendar = cmoChangeCalendar(plan, posts);
    const brief = cmoStrategyChangeBrief(
      "Cal.com",
      "Make the Feb Reel a talking video",
      calendar,
    );
    expect(brief).toContain(
      "- ig-feb-2 · 2027-02-03 · instagram/reel · scheduled ·  · Round-robin in 20 seconds",
    );
    expect(brief).not.toContain("Routing in 20 seconds");
    expect(brief).toContain(
      "- post-222 · 2026-11-27 · x/post · draft ·  · Our booking page, live (outside the plan)",
    );
    expect(brief).toContain("3 in all");
    expect(brief).toContain("Never ask the owner for an entry");
    expect(brief).toContain("change every field and entry that rests on it");
  });

  it("refuses a bare call outside a step turn, whatever the message says", () => {
    const bot = "11111111-1111-4111-8111-111111111111";
    const pasted = `Please do this.\n\n${CMO_STRATEGY_BRIEF_MARK}\nWrite a new strategy.`;
    expect(() =>
      cmoStepChange(undefined, { clientTurnId: "chat:1", userMessage: pasted }),
    ).toThrow(/call it with change/);
    expect(() =>
      cmoStepChange(undefined, {
        clientTurnId: `cmo:strategy:${bot}:fix:1:1`,
        userMessage: "Fix the offer section.",
      }),
    ).toThrow(/save_strategy/);
    expect(
      cmoStepChange(undefined, {
        clientTurnId: cmoStrategyStepTurnId(bot, "plan"),
        userMessage: pasted,
      }),
    ).toBeNull();
    expect(
      cmoStepChange(undefined, {
        clientTurnId: cmoStrategyStepTurnId(bot, "patch"),
        userMessage:
          "Call write_strategy now.\nThe owner asked: LinkedIn weekly",
      }),
    ).toBe("LinkedIn weekly");
    expect(
      cmoStepChange("Add TikTok", { clientTurnId: "chat:1", userMessage: "" }),
    ).toBe("Add TikTok");
  });

  it("shows a written piece filed as a Project file as the owner sees it (Codex)", () => {
    const article = {
      ...entry("seo-1", "Calendly alternative for teams"),
      channel: "seo",
      format: "article",
    };
    const hydrated = withMarketingFiles(
      { calendar: [article] } as unknown as MarketingStrategyPlan,
      new Map([
        [
          "seo-1",
          { fileId: "file-1", media: [], searchAd: null, adCampaign: null },
        ],
      ]),
    );
    const brief = cmoStrategyChangeBrief(
      "Cal.com",
      "Retitle the article",
      cmoChangeCalendar(hydrated.calendar, []),
    );
    expect(brief).toContain(
      "- seo-1 · 2026-11-27 · seo/article · draft ·  · Calendly alternative for teams",
    );
  });

  it("lists every entry of a long month, never cutting the last", () => {
    const month = Array.from({ length: 1_001 }, (_, index) =>
      entry(`e-${index + 1}`, `Post ${index + 1}`),
    );
    const brief = cmoStrategyChangeBrief(
      "NMKR",
      "Move post 1001",
      cmoChangeCalendar(month, []),
    );
    expect(brief).toContain("1001 in all");
    expect(brief).toContain("- e-1001 · ");
  });

  it("asks a change to touch only what the owner named", () => {
    const brief = cmoStrategyChangeBrief("NMKR", "LinkedIn once a week");
    expect(brief).toContain("The owner asked: LinkedIn once a week");
    expect(brief).toContain("Leave out every field and entry you keep");
  });
});

describe("steps in one turn", () => {
  const now = 1_000_000;
  const start = (step: number, change: string | null, at = now - 1_000) => ({
    step,
    change,
    at,
  });

  it("starts the first step", () => {
    expect(cmoStepDecision([], new Set(), "LinkedIn weekly", now)).toEqual({
      kind: "start",
      step: 1,
    });
  });

  it("starts a second change once the first ended (Neon round 1)", () => {
    expect(
      cmoStepDecision(
        [start(1, "LinkedIn weekly")],
        new Set([1]),
        "Add TikTok",
        now,
      ),
    ).toEqual({ kind: "start", step: 2 });
  });

  it("waits for the same request while it writes, and refuses another", () => {
    const starts = [start(1, "LinkedIn weekly")];
    expect(cmoStepDecision(starts, new Set(), "LinkedIn weekly", now)).toEqual({
      kind: "wait",
      step: 1,
    });
    expect(cmoStepDecision(starts, new Set(), "Add TikTok", now)).toEqual({
      kind: "busy",
    });
  });

  it("reads a finished step's answer when the same request comes again", () => {
    expect(cmoStepDecision([start(1, null)], new Set([1]), null, now)).toEqual({
      kind: "done",
      step: 1,
    });
  });

  it("lets a step that died without an end give way", () => {
    expect(
      cmoStepDecision(
        [start(1, "LinkedIn weekly", now - 7 * 60_000)],
        new Set(),
        "Add TikTok",
        now,
      ),
    ).toEqual({ kind: "start", step: 2 });
  });
});

describe("the repair loop keeps what was tried apart from what was saved", () => {
  type Save = {
    strategy: StrategyAnswer;
    outcome: SaveOutcome;
  };
  /** Runs the real loop with scripted saves and repairs. */
  const run = async (input: {
    part: "all" | "patch";
    first: CmoStepAnswer;
    outcomes: SaveOutcome[];
    repairs: CmoStepAnswer[];
  }) => {
    const saves: Save[] = [];
    const end = await cmoRepairLoop({
      part: input.part,
      first: input.first,
      save: async (_round, strategy, issues) => {
        const outcome =
          issues.length > 0
            ? { versionId: null, problems: [...issues] }
            : (input.outcomes.shift() ?? { versionId: null, problems: ["?"] });
        saves.push({ strategy, outcome });
        return outcome;
      },
      repair: async () => {
        const next = input.repairs.shift();
        if (!next) throw new Error("no repair scripted");
        return next;
      },
      mayRepair: () => true,
    });
    return { end, saves };
  };
  const answer = (
    strategy: StrategyAnswer,
    toOwner: string,
  ): CmoStepAnswer => ({ strategy, toOwner, issues: [] });

  it("never reports a refused last save as a success", async () => {
    const { end } = await run({
      part: "all",
      first: answer(
        { summary: "Starts on LinkedIn" },
        "It starts on LinkedIn.",
      ),
      outcomes: [
        { versionId: "v1", problems: ["example a is not whole"] },
        {
          versionId: null,
          problems: refusalProblems(
            "save_strategy saved nothing: an example names a pillar the strategy does not have.",
          ),
        },
        {
          versionId: null,
          problems: ["still refused"],
        },
      ],
      repairs: [
        answer({ summary: "Starts on X" }, "It starts on X."),
        answer({ summary: "Starts on X now" }, "It starts on X."),
      ],
    });
    expect(end).toEqual({
      state: "saved",
      versionId: "v1",
      // The owner hears the saved version's line, not a refused try's.
      toOwner: "It starts on LinkedIn.",
      fixed: 0,
      left: ["example a is not whole"],
    });
  });

  it("takes the owner's line from the answer whose save landed", async () => {
    const { end } = await run({
      part: "all",
      first: answer(
        { summary: "Starts on LinkedIn" },
        "It starts on LinkedIn.",
      ),
      outcomes: [
        { versionId: "v1", problems: ["LinkedIn is not one of its networks"] },
        { versionId: "v1", problems: [] },
      ],
      repairs: [answer({ summary: "Starts on X" }, "It starts on X.")],
    });
    expect(end).toMatchObject({
      toOwner: "It starts on X.",
      fixed: 1,
      left: [],
    });
  });

  it("carries a refused patch's corrections into the next try", async () => {
    const { saves, end } = await run({
      part: "patch",
      first: answer({ summary: "Weekly LinkedIn" }, "LinkedIn is weekly."),
      outcomes: [
        { versionId: null, problems: ["first refused"] },
        { versionId: null, problems: ["second refused"] },
        { versionId: "v2", problems: [] },
      ],
      repairs: [
        answer({ goals: ["More Studio trials"] }, "LinkedIn is weekly."),
        answer(
          { audience: "Founders launching tokens" },
          "LinkedIn is weekly.",
        ),
      ],
    });
    expect(saves.map((save) => save.outcome.problems)).toEqual([
      ["first refused"],
      ["second refused"],
      [],
    ]);
    expect(saves.at(-1)?.strategy).toMatchObject({
      summary: "Weekly LinkedIn",
      goals: ["More Studio trials"],
      audience: "Founders launching tokens",
    });
    expect(end).toMatchObject({ state: "saved", versionId: "v2" });
  });

  it("sends a change's next try only what is not saved yet", async () => {
    const { saves } = await run({
      part: "patch",
      first: answer({ summary: "Weekly LinkedIn" }, "LinkedIn is weekly."),
      outcomes: [
        { versionId: "v2", problems: ["the goal names no product"] },
        { versionId: "v2", problems: [] },
      ],
      repairs: [
        answer({ goals: ["More Studio trials"] }, "LinkedIn is weekly."),
      ],
    });
    expect(saves[1]?.strategy).toEqual({
      goals: ["More Studio trials"],
      calendar: [],
    });
  });

  it("fails when nothing was ever saved", async () => {
    const { end } = await run({
      part: "all",
      first: answer({}, "It starts on X."),
      outcomes: [
        { versionId: null, problems: ["a"] },
        { versionId: null, problems: ["b"] },
        { versionId: null, problems: ["c"] },
      ],
      repairs: [answer({}, ""), answer({}, "")],
    });
    expect(end).toMatchObject({ state: "failed" });
  });

  it("reads a one-line refusal as its own problem", () => {
    expect(
      refusalProblems(
        "save_strategy saved nothing: the summary has 24 words; keep it to 20.",
      ),
    ).toEqual([
      "save_strategy saved nothing: the summary has 24 words; keep it to 20.",
    ]);
    expect(
      refusalProblems(
        "save_strategy saved nothing: the strategy breaks a hard rule.\n- Rule one\n- Rule two",
      ),
    ).toEqual(["Rule one", "Rule two"]);
  });

  it("checks the saved version's calendar on a save that sent none", async () => {
    const outcome = await cmoSaveAnswer(
      {
        runtime: {
          executeTool: async () => ({ versionId: "v3", problems: [] }),
        } as never,
        input: { toolCallId: "call" } as never,
      },
      2,
      "patch",
      { goals: ["More Studio trials"] },
      [],
      async () => ["example b's title is not in German"],
    );
    expect(outcome).toEqual({
      versionId: "v3",
      problems: ["example b's title is not in German"],
    });
  });
});

describe("what write_strategy answers", () => {
  const saved = {
    state: "saved" as const,
    versionId: "v1",
    toOwner: "LinkedIn now posts once a week.",
    fixed: 1,
    left: [],
  };
  const ends = (strategyTurn: boolean) =>
    toolEndedTurn([
      {
        toolResults: [{ output: cmoStrategyStepAnswer(saved, strategyTurn) }],
      },
    ]);

  it("ends a strategy turn with the owner's sentence", () => {
    expect(ends(true)).toContain("LinkedIn now posts once a week.");
  });

  it("lets a chat go on to the rest of the owner's request", () => {
    expect(ends(false)).toBeUndefined();
    expect(cmoStrategyStepAnswer(saved, false)).toMatchObject({
      toOwner: "LinkedIn now posts once a week.",
      next: expect.stringContaining("Do the rest"),
    });
    expect(
      cmoStrategyStepAnswer({ state: "failed", reason: "x" }, false),
    ).toMatchObject({ next: expect.stringContaining("rest of the owner") });
  });

  it("says a chat change waits for approval and moved no post", () => {
    const answer = cmoStrategyStepAnswer(saved, false, true);
    expect(answer).toMatchObject({
      written: true,
      upcomingPosts: expect.stringContaining("unchanged"),
      next: expect.stringContaining("takes effect once they approve it"),
    });
    expect(answer.next).not.toContain("The strategy is saved.");
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
